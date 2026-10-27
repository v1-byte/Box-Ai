// JNI untuk Box AI: memuat model GGUF dan menghasilkan token lewat llama.cpp.
// Ditulis untuk API llama.cpp pada tag di CMakeLists.txt (LLAMA_CPP_TAG). Jika tag diganti,
// periksa ulang nama fungsi (llama_model_load_from_file, llama_init_from_model, llama_vocab_*, ...).
//
// Konteks (KV cache) dibuat baru untuk setiap generate() dan dibebaskan setelahnya:
// lebih sederhana dan tahan terhadap perubahan API KV, dengan biaya prompt-eval ulang per pesan.

#include <jni.h>
#include <android/log.h>
#include <atomic>
#include <mutex>
#include <string>
#include <vector>
#include <cstring>
#include "llama.h"

#define TAG "BoxAI-JNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace {
std::mutex g_mu;                       // melindungi g_model
llama_model *g_model = nullptr;
std::atomic<bool> g_stop{false};
bool g_backend_ready = false;

void quiet_log(ggml_log_level level, const char *text, void *) {
    if (level >= GGML_LOG_LEVEL_ERROR) __android_log_print(ANDROID_LOG_ERROR, TAG, "%s", text);
}

// Panjang awalan UTF-8 yang lengkap (sisanya adalah karakter terpotong di batas token).
size_t valid_utf8_prefix(const std::string &s) {
    size_t i = s.size();
    // mundur maksimal 3 byte mencari awal karakter multibyte yang belum lengkap
    for (size_t back = 1; back <= 4 && back <= s.size(); ++back) {
        unsigned char c = (unsigned char) s[s.size() - back];
        if ((c & 0xC0) == 0x80) continue;          // byte lanjutan
        size_t need = (c >= 0xF0) ? 4 : (c >= 0xE0) ? 3 : (c >= 0xC0) ? 2 : 1;
        if (need > back) i = s.size() - back;      // belum lengkap
        break;
    }
    return i;
}

jbyteArray to_bytes(JNIEnv *env, const std::string &s, size_t n) {
    jbyteArray arr = env->NewByteArray((jsize) n);
    if (arr && n) env->SetByteArrayRegion(arr, 0, (jsize) n, reinterpret_cast<const jbyte *>(s.data()));
    return arr;
}

std::string jstr(JNIEnv *env, jstring s) {
    if (!s) return "";
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string r(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return r;
}
}  // namespace

extern "C" {

// Mengembalikan "" bila sukses, selain itu pesan galat.
JNIEXPORT jstring JNICALL
Java_com_boxai_app_LlamaEngine_nativeLoad(JNIEnv *env, jobject, jstring jpath) {
    std::lock_guard<std::mutex> lk(g_mu);
    if (!g_backend_ready) {
        llama_log_set(quiet_log, nullptr);
        llama_backend_init();
        g_backend_ready = true;
    }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    std::string path = jstr(env, jpath);
    llama_model_params mp = llama_model_default_params();
    mp.use_mmap = true;
    mp.n_gpu_layers = 0;
    g_model = llama_model_load_from_file(path.c_str(), mp);
    if (!g_model) return env->NewStringUTF("Model gagal dimuat (file rusak, arsitektur tidak didukung, atau RAM kurang)");
    return env->NewStringUTF("");
}

JNIEXPORT void JNICALL
Java_com_boxai_app_LlamaEngine_nativeUnload(JNIEnv *, jobject) {
    g_stop = true;
    std::lock_guard<std::mutex> lk(g_mu);
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
}

JNIEXPORT void JNICALL
Java_com_boxai_app_LlamaEngine_nativeStop(JNIEnv *, jobject) { g_stop = true; }

// roles/contents: pesan percakapan. Callback: sink.onToken(ByteArray) -> Boolean (false = hentikan).
// Mengembalikan "" bila sukses/dihentikan, selain itu pesan galat.
JNIEXPORT jstring JNICALL
Java_com_boxai_app_LlamaEngine_nativeGenerate(JNIEnv *env, jobject, jobjectArray roles, jobjectArray contents,
                                              jfloat temp, jfloat topP, jint maxTokens, jint nCtx, jint nThreads,
                                              jobject sink) {
    std::lock_guard<std::mutex> lk(g_mu);
    if (!g_model) return env->NewStringUTF("Model belum dimuat");
    g_stop = false;

    jclass sinkCls = env->GetObjectClass(sink);
    jmethodID onToken = env->GetMethodID(sinkCls, "onToken", "([B)Z");
    if (!onToken) return env->NewStringUTF("Callback tidak valid");

    const llama_vocab *vocab = llama_model_get_vocab(g_model);

    // ---- susun prompt dengan chat template model (fallback ChatML) ----
    const jsize n = env->GetArrayLength(roles);
    std::vector<std::string> r_store(n), c_store(n);
    std::vector<llama_chat_message> msgs(n);
    for (jsize i = 0; i < n; ++i) {
        jobject ro = env->GetObjectArrayElement(roles, i);
        jobject co = env->GetObjectArrayElement(contents, i);
        r_store[i] = jstr(env, (jstring) ro);
        c_store[i] = jstr(env, (jstring) co);
        if (ro) env->DeleteLocalRef(ro);
        if (co) env->DeleteLocalRef(co);
        msgs[i] = {r_store[i].c_str(), c_store[i].c_str()};
    }
    const char *tmpl = llama_model_chat_template(g_model, nullptr);
    if (!tmpl) tmpl = "chatml";
    std::vector<char> fbuf(1 << 14);
    int32_t len = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, fbuf.data(), (int32_t) fbuf.size());
    if (len > (int32_t) fbuf.size()) {
        fbuf.resize(len + 1);
        len = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, fbuf.data(), (int32_t) fbuf.size());
    }
    if (len < 0) {   // template bawaan tidak dikenali -> ChatML
        tmpl = "chatml";
        len = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, fbuf.data(), (int32_t) fbuf.size());
        if (len > (int32_t) fbuf.size()) {
            fbuf.resize(len + 1);
            len = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, fbuf.data(), (int32_t) fbuf.size());
        }
    }
    if (len < 0) return env->NewStringUTF("Chat template tidak didukung");
    std::string prompt(fbuf.data(), (size_t) len);

    // ---- tokenisasi ----
    int32_t n_tok = -llama_tokenize(vocab, prompt.c_str(), (int32_t) prompt.size(), nullptr, 0, true, true);
    if (n_tok <= 0) return env->NewStringUTF("Tokenisasi gagal");
    std::vector<llama_token> toks(n_tok);
    if (llama_tokenize(vocab, prompt.c_str(), (int32_t) prompt.size(), toks.data(), n_tok, true, true) < 0)
        return env->NewStringUTF("Tokenisasi gagal");

    const int ctx_len = nCtx < 256 ? 256 : nCtx;
    if (n_tok >= ctx_len - 8)
        return env->NewStringUTF("Percakapan terlalu panjang untuk ukuran konteks. Naikkan ukuran konteks atau mulai chat baru.");

    // ---- konteks ----
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t) ctx_len;
    cp.n_batch = (uint32_t) (ctx_len < 512 ? ctx_len : 512);
    cp.n_threads = nThreads < 1 ? 1 : nThreads;
    cp.n_threads_batch = cp.n_threads;
    llama_context *ctx = llama_init_from_model(g_model, cp);
    if (!ctx) return env->NewStringUTF("Konteks gagal dibuat (RAM tidak cukup?). Turunkan ukuran konteks.");

    // ---- sampler ----
    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (temp <= 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(topP, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }

    std::string err;
    std::string pending;                       // byte UTF-8 yang belum lengkap
    // ---- evaluasi prompt per potongan ----
    int32_t pos = 0;
    while (pos < n_tok && !g_stop) {
        int32_t chunk = n_tok - pos;
        if (chunk > (int32_t) cp.n_batch) chunk = (int32_t) cp.n_batch;
        llama_batch b = llama_batch_get_one(toks.data() + pos, chunk);
        if (llama_decode(ctx, b) != 0) { err = "Gagal memproses prompt"; break; }
        pos += chunk;
    }

    // ---- generasi ----
    int produced = 0;
    int32_t n_cur = n_tok;
    while (err.empty() && !g_stop && produced < maxTokens && n_cur < ctx_len) {
        llama_token tok = llama_sampler_sample(smpl, ctx, -1);
        if (llama_vocab_is_eog(vocab, tok)) break;

        char piece[256];
        int32_t pl = llama_token_to_piece(vocab, tok, piece, sizeof(piece), 0, false);
        if (pl > 0) {
            pending.append(piece, (size_t) pl);
            size_t ok = valid_utf8_prefix(pending);
            if (ok > 0) {
                jbyteArray arr = to_bytes(env, pending, ok);
                jboolean cont = env->CallBooleanMethod(sink, onToken, arr);
                env->DeleteLocalRef(arr);
                if (env->ExceptionCheck()) { env->ExceptionClear(); break; }
                pending.erase(0, ok);
                if (!cont) break;
            }
        }
        ++produced;

        llama_batch nb = llama_batch_get_one(&tok, 1);
        if (llama_decode(ctx, nb) != 0) { err = "Gagal menghasilkan token"; break; }
        ++n_cur;
    }

    llama_sampler_free(smpl);
    llama_free(ctx);
    return env->NewStringUTF(err.c_str());
}

}  // extern "C"
