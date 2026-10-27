package com.boxai.app

import android.os.ParcelFileDescriptor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * Pembungkus Kotlin untuk runtime GGUF (llama.cpp via JNI). Semua pekerjaan berat berjalan di satu
 * thread latar belakang (serial), tidak pernah di main thread.
 */
class LlamaEngine {
    interface Listener {
        /** Kembalikan false untuk menghentikan generasi. */
        fun onToken(text: String): Boolean
        fun onProgress(percent: Int) {}
        fun onDone()
        fun onError(message: String)
    }

    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "boxai-llama").apply { isDaemon = true } }
    private val generation = AtomicLong(0)

    @Volatile var loadedModelId: String = ""
        private set
    @Volatile var loadedName: String = ""
        private set
    private var pfd: ParcelFileDescriptor? = null

    val available: Boolean = try { System.loadLibrary("boxai_jni"); true } catch (_: Throwable) { false }

    val isLoaded: Boolean get() = loadedModelId.isNotEmpty()

    fun load(resolved: ModelManager.Resolved, modelId: String, onResult: (ok: Boolean, message: String) -> Unit) {
        if (!available) { onResult(false, "Runtime GGUF tidak tersedia di build ini"); return }
        stop()
        worker.execute {
            val err = try {
                unloadInternal()
                nativeLoad(resolved.path)
            } catch (t: Throwable) { t.message ?: "Gagal memuat model" }
            if (err.isEmpty()) {
                pfd = resolved.pfd
                loadedModelId = modelId
                loadedName = resolved.display
                onResult(true, "")
            } else {
                try { resolved.pfd?.close() } catch (_: Exception) { }
                onResult(false, err)
            }
        }
    }

    fun unload() {
        stop()
        worker.execute { unloadInternal() }
    }

    private fun unloadInternal() {
        if (available) nativeUnload()
        try { pfd?.close() } catch (_: Exception) { }
        pfd = null
        loadedModelId = ""
        loadedName = ""
    }

    fun stop() {
        generation.incrementAndGet()
        if (available) nativeStop()
    }

    fun generate(
        roles: Array<String>, contents: Array<String>,
        temp: Float, topP: Float, maxTokens: Int, nCtx: Int, threads: Int,
        listener: Listener
    ) {
        if (!available || !isLoaded) { listener.onError("Model belum dimuat. Pilih model lalu ketuk Gunakan."); return }
        val myGen = generation.incrementAndGet()
        nativeStop()   // hentikan generasi lama; worker serial menunggu giliran
        worker.execute {
            if (generation.get() != myGen) { return@execute }   // digantikan permintaan yang lebih baru
            val sink = object : Any() {
                // dipanggil dari JNI: onToken([B)Z
                @Suppress("unused")
                fun onToken(bytes: ByteArray): Boolean {
                    if (generation.get() != myGen) return false
                    return listener.onToken(String(bytes, Charsets.UTF_8))
                }
                @Suppress("unused")
                fun onProgress(percent: Int) {
                    if (generation.get() == myGen) listener.onProgress(percent.coerceIn(0, 100))
                }
            }
            val err = try {
                nativeGenerate(roles, contents, temp, topP, maxTokens, nCtx, threads, sink)
            } catch (t: Throwable) { t.message ?: "Generasi gagal" }
            if (generation.get() != myGen) return@execute
            if (err.isEmpty()) listener.onDone() else listener.onError(err)
        }
    }

    fun shutdown() {
        stop()
        worker.execute { unloadInternal() }
        worker.shutdown()
    }

    private external fun nativeLoad(path: String): String
    private external fun nativeUnload()
    private external fun nativeStop()
    private external fun nativeGenerate(
        roles: Array<String>, contents: Array<String>, temp: Float, topP: Float,
        maxTokens: Int, nCtx: Int, nThreads: Int, sink: Any
    ): String
}
