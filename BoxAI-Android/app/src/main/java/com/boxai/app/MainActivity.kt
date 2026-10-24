package com.boxai.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import android.app.ActivityManager
import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlinx.coroutines.*
import dev.ffmpegkit.llama.Llama
import dev.ffmpegkit.llama.LlamaConfig
import dev.ffmpegkit.llama.LlamaModel

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge: biarkan WebView full screen, safe-area diurus CSS
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#08090C"))
            // Jangan pakai padding native untuk system bars — CSS env(safe-area) sudah cukup
            fitsSystemWindows = false
        }
        setContentView(webView)

        // Hanya pad bottom saat keyboard muncul (IME). System bars → CSS.
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            // Keyboard: naikkan konten. System bars: biarkan 0 (CSS handle).
            val bottom = if (ime.bottom > 0) ime.bottom else 0
            v.setPadding(0, 0, 0, bottom)
            // Kirim tinggi keyboard ke JS agar composer bisa menyesuaikan
            val kb = (ime.bottom / resources.displayMetrics.density).toInt()
            webView.evaluateJavascript("window.__kbHeight=$kb;window.dispatchEvent(new Event('boxkb'));", null)
            WindowInsetsCompat.CONSUMED
        }

        val loader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            textZoom = 100
            // Performa & kompatibilitas
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                safeBrowsingEnabled = false
            }
        }

        webView.addJavascriptInterface(
            Bridge(this, scope) { js -> runOnUiThread { webView.evaluateJavascript(js, null) } },
            "BoxNative"
        )

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "appassets.androidplatform.net") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                // Pastikan safe-area CSS aktif setelah load
                view?.evaluateJavascript(
                    """
                    document.documentElement.style.setProperty('--sat', getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)') || '0px');
                    document.documentElement.style.setProperty('--sab', getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)') || '0px');
                    """.trimIndent(), null
                )
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl("https://appassets.androidplatform.net/www/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        scope.cancel()
        webView.destroy()
        super.onDestroy()
    }
}

/** Jembatan JS <-> Android: unduhan model, file, info perangkat, dan mesin LLM (llama.cpp). */
class Bridge(
    private val ctx: Context,
    private val scope: CoroutineScope,
    private val post: (String) -> Unit
) {
    private val dm get() = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private fun dir(): File = (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).also { it.mkdirs() }
    private fun safe(n: String) = n.isNotBlank() && !n.contains('/') && !n.contains('\\') && n != "." && n != ".."

    private fun clean(s: String) = s.replace(Regex("<[^>]+>"), "").replace("&amp;", "&").replace("&quot;", "\"")
        .replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">").trim()

    @Volatile private var currentModel: LlamaModel? = null
    @Volatile private var currentModelPath: String? = null
    private val engineLock = Any()

    @JavascriptInterface fun webSearch(id: Int, query: String) {
        Thread {
            val out = JSONObject().put("results", JSONArray())
            try {
                val c = java.net.URL("https://html.duckduckgo.com/html/?q=" + java.net.URLEncoder.encode(query, "UTF-8"))
                    .openConnection() as java.net.HttpURLConnection
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Android) BoxAI")
                c.connectTimeout = 10000; c.readTimeout = 10000
                val html = c.inputStream.bufferedReader().use { it.readText() }
                val links = Regex("""class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL).findAll(html).toList()
                val snips = Regex("""class="result__snippet"[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL).findAll(html).toList()
                val arr = JSONArray()
                for (i in 0 until minOf(5, links.size)) {
                    var u = links[i].groupValues[1].replace("&amp;", "&")
                    Regex("uddg=([^&]+)").find(u)?.let { u = java.net.URLDecoder.decode(it.groupValues[1], "UTF-8") }
                    if (u.startsWith("//")) u = "https:$u"
                    arr.put(JSONObject().put("title", clean(links[i].groupValues[2])).put("url", u)
                        .put("snippet", if (i < snips.size) clean(snips[i].groupValues[1]) else ""))
                }
                out.put("results", arr)
            } catch (e: Exception) { out.put("error", "Pencarian gagal: " + (e.message ?: "koneksi")) }
            post("window.BoxSearch&&BoxSearch.cb($id,$out)")
        }.start()
    }

    @JavascriptInterface fun engineAvailable(): Boolean = true

    @JavascriptInterface fun generate(json: String) {
        scope.launch(Dispatchers.Default) {
            try {
                val o = JSONObject(json)
                val modelName = o.optString("model", "")
                if (modelName.isBlank() || !safe(modelName)) {
                    post("window.BoxEngine&&BoxEngine.error('Model tidak valid')")
                    return@launch
                }
                val modelFile = File(dir(), modelName)
                if (!modelFile.exists()) {
                    post("window.BoxEngine&&BoxEngine.error('File model tidak ditemukan: $modelName')")
                    return@launch
                }

                val nCtx = o.optInt("n_ctx", 2048).coerceIn(512, 8192)
                val maxTok = o.optInt("max_tokens", 512).coerceIn(16, 4096)
                val temp = o.optDouble("temp", 0.7).toFloat().coerceIn(0f, 2f)
                val topP = o.optDouble("top_p", 0.9).toFloat().coerceIn(0f, 1f)
                val threads = Runtime.getRuntime().availableProcessors().coerceIn(1, 8)

                val model = synchronized(engineLock) {
                    val path = modelFile.absolutePath
                    if (currentModel != null && currentModelPath == path) {
                        currentModel!!
                    } else {
                        currentModel?.let { runCatching { Llama.releaseModel(it) } }
                        currentModel = null
                        currentModelPath = null
                        val cfg = LlamaConfig(
                            contextSize = nCtx,
                            threads = threads,
                            temperature = temp,
                            topP = topP,
                        )
                        val m = Llama.loadModel(path, cfg)
                        currentModel = m
                        currentModelPath = path
                        m
                    }
                }

                val messages = o.optJSONArray("messages") ?: JSONArray()
                var systemPrompt = ""
                val userParts = mutableListOf<String>()
                for (i in 0 until messages.length()) {
                    val m = messages.getJSONObject(i)
                    val role = m.optString("role", "")
                    val content = m.optString("content", "")
                    when (role) {
                        "system" -> systemPrompt = content
                        "user" -> userParts.add(content)
                        "assistant" -> userParts.add("Assistant: $content")
                    }
                }
                val prompt = userParts.lastOrNull() ?: ""
                val history = if (userParts.size > 1) {
                    userParts.dropLast(1).takeLast(4).joinToString("\n")
                } else ""
                val fullPrompt = if (history.isNotBlank()) "$history\n$prompt" else prompt

                val result = Llama.complete(
                    model,
                    prompt = fullPrompt,
                    systemPrompt = systemPrompt.ifBlank { "You are Box AI, a helpful private on-device assistant. Answer in the same language as the user." },
                    maxTokens = maxTok,
                )

                val text = result.text.trim()
                if (text.isEmpty()) {
                    post("window.BoxEngine&&BoxEngine.error('Model tidak menghasilkan jawaban')")
                    return@launch
                }
                val chunkSize = 6
                var i = 0
                while (i < text.length) {
                    val end = minOf(i + chunkSize, text.length)
                    val chunk = text.substring(i, end)
                    val esc = chunk
                        .replace("\\", "\\\\")
                        .replace("'", "\\'")
                        .replace("\n", "\\n")
                        .replace("\r", "")
                    post("window.BoxEngine&&BoxEngine.token('$esc')")
                    delay(10)
                    i = end
                }
                post("window.BoxEngine&&BoxEngine.done()")
            } catch (e: Exception) {
                val msg = (e.message ?: "unknown").replace("'", "\\'").replace("\n", " ")
                post("window.BoxEngine&&BoxEngine.error('$msg')")
            }
        }
    }

    @JavascriptInterface fun unloadModel() {
        scope.launch(Dispatchers.Default) {
            synchronized(engineLock) {
                currentModel?.let { runCatching { Llama.releaseModel(it) } }
                currentModel = null
                currentModelPath = null
            }
        }
    }

    private fun activeNames(): Set<String> {
        val out = HashSet<String>()
        try {
            dm.query(DownloadManager.Query().setFilterByStatus(
                DownloadManager.STATUS_PENDING or DownloadManager.STATUS_RUNNING or DownloadManager.STATUS_PAUSED)).use { c ->
                val i = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                while (c.moveToNext()) c.getString(i)?.let { out.add(Uri.parse(it).lastPathSegment ?: "") }
            }
        } catch (e: Exception) { }
        return out
    }

    @JavascriptInterface fun listModels(): String {
        val busy = activeNames(); val a = JSONArray()
        dir().listFiles()?.filter { it.isFile && it.name.endsWith(".gguf", true) && it.name !in busy }
            ?.sortedBy { it.name }?.forEach {
                a.put(JSONObject().put("name", it.name).put("size", it.length()).put("mod", it.lastModified()))
            }
        return a.toString()
    }

    @JavascriptInterface fun startDownload(url: String, name: String, token: String): Long {
        if (!safe(name)) return -1L
        File(dir(), name).delete()
        val r = DownloadManager.Request(Uri.parse(url)).setTitle(name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(ctx, "models", name)
        if (token.isNotBlank()) r.addRequestHeader("Authorization", "Bearer $token")
        return dm.enqueue(r)
    }

    @JavascriptInterface fun status(id: Long): String {
        val o = JSONObject().put("s", 0)
        try {
            dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (c.moveToFirst()) {
                    o.put("s", c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)))
                    o.put("b", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                    o.put("t", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                }
            }
        } catch (e: Exception) { }
        return o.toString()
    }

    @JavascriptInterface fun cancel(id: Long) { try { dm.remove(id) } catch (e: Exception) { } }
    @JavascriptInterface fun deleteModel(name: String): Boolean = safe(name) && File(dir(), name).delete()
    @JavascriptInterface fun renameModel(old: String, new: String): Boolean =
        safe(old) && safe(new) && !File(dir(), new).exists() && File(dir(), old).renameTo(File(dir(), new))

    @JavascriptInterface fun head(name: String): String {
        if (!safe(name)) return ""
        return try {
            File(dir(), name).inputStream().use { s ->
                val b = ByteArray(128); val n = s.read(b)
                b.take(maxOf(n, 0)).joinToString("") { "%02x".format(it) }
            }
        } catch (e: Exception) { "" }
    }

    @JavascriptInterface fun clearCache(): Long {
        val before = ctx.cacheDir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        ctx.cacheDir.listFiles()?.forEach { it.deleteRecursively() }
        return before
    }

    @JavascriptInterface fun info(): String {
        val mi = ActivityManager.MemoryInfo()
        (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mi)
        val st = StatFs(dir().absolutePath)
        return JSONObject()
            .put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("sdk", Build.VERSION.SDK_INT)
            .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
            .put("cores", Runtime.getRuntime().availableProcessors())
            .put("ram", mi.totalMem).put("ramFree", mi.availMem)
            .put("free", st.availableBytes).put("total", st.totalBytes)
            .put("cache", ctx.cacheDir.walkTopDown().filter { it.isFile }.sumOf { it.length() })
            .put("engine", "llama.cpp (llama-android 0.1.1)")
            .toString()
    }
}
