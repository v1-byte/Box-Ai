package com.boxai.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
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
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import androidx.core.content.FileProvider
import android.content.pm.PackageManager
import android.Manifest
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.provider.Settings
import java.io.File
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import dev.ffmpegkit.llama.Llama
import dev.ffmpegkit.llama.LlamaConfig
import dev.ffmpegkit.llama.LlamaModel

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
        // JANGAN edge-to-edge: biarkan sistem Android yang sisakan ruang
        // status bar + navigasi. Ini paling andal di semua HP (notch, 3-button, gesture).
        WindowCompat.setDecorFitsSystemWindows(window, true)
        window.statusBarColor = Color.parseColor("#08090C")
        window.navigationBarColor = Color.parseColor("#08090C")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = true
            window.isStatusBarContrastEnforced = true
        }
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#08090C"))
        }
        setContentView(webView)

        // Keyboard saja yang kita pantau (sembunyikan tabbar)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val dens = resources.displayMetrics.density
            val kbPx = if (ime.bottom > 40) (ime.bottom / dens).toInt() else 0
            // Jangan pad manual system bars — sudah diurus setDecorFitsSystemWindows(true)
            v.setPadding(0, 0, 0, 0)
            webView.evaluateJavascript(
                "window.__kbHeight=" + kbPx + ";document.documentElement.style.setProperty('--kb','" + kbPx + "px');window.dispatchEvent(new Event('boxkb'));",
                null
            )
            insets
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

            override fun onPageFinished(view: WebView?, url: String?) { }
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
        } catch (e: Exception) {
            // Fallback minimal UI jika ada error fatal
            val tv = android.widget.TextView(this)
            tv.text = "Box AI error: " + (e.message ?: e.javaClass.simpleName)
            tv.setTextColor(Color.WHITE)
            tv.setBackgroundColor(Color.parseColor("#08090C"))
            tv.setPadding(40, 80, 40, 40)
            setContentView(tv)
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
    private val engineLock = Mutex()

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

                val path = modelFile.absolutePath
                val model = engineLock.withLock {
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
            engineLock.withLock {
                currentModel?.let { runCatching { Llama.releaseModel(it) } }
                currentModel = null
                currentModelPath = null
            }
        }
    }

    /** Nama file yang sedang diunduh (pending/running/paused) — jangan tampilkan dulu. */
    private fun busyNames(): Set<String> {
        val out = HashSet<String>()
        try {
            dm.query(DownloadManager.Query().setFilterByStatus(
                DownloadManager.STATUS_PENDING or DownloadManager.STATUS_RUNNING or DownloadManager.STATUS_PAUSED
            )).use { c ->
                val i = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                val t = c.getColumnIndex(DownloadManager.COLUMN_TITLE)
                while (c.moveToNext()) {
                    c.getString(i)?.let { out.add(Uri.parse(it).lastPathSegment ?: "") }
                    c.getString(t)?.let { if (it.endsWith(".gguf", true)) out.add(it) }
                }
            }
        } catch (_: Exception) { }
        return out
    }

    /**
     * Scan folder models + pastikan unduhan sukses ikut terdeteksi.
     * Juga pindahkan file dari lokasi DownloadManager jika masih di path lain.
     */

    /** Semua folder yang mungkin berisi GGUF (app sendiri + lokasi umum). */
    private fun modelScanRoots(): List<File> {
        val roots = LinkedHashSet<File>()
        roots.add(dir())
        ctx.getExternalFilesDir(null)?.let { roots.add(it); roots.add(File(it, "models")) }
        val base = Environment.getExternalStorageDirectory()
        val names = listOf(
            "Download", "Downloads", "Documents", "Models", "models", "GGUF", "gguf",
            "BoxAI", "Box-AI", "llama", "Llama", "LMStudio", "Ollama", "PocketPal",
            "Android/media"
        )
        names.forEach { n -> roots.add(File(base, n)) }
        val pkgs = listOf(
            "com.pocketpal", "com.pocketpalai", "ai.pocketpal",
            "com.llamalab", "com.nexa", "com.mlc", "com.lmstudio"
        )
        val androidData = File(base, "Android/data")
        pkgs.forEach { pkg ->
            roots.add(File(androidData, "$pkg/files"))
            roots.add(File(androidData, "$pkg/files/models"))
        }
        return roots.filter { it.exists() && it.isDirectory }
    }

    private fun scanGguf(root: File, depth: Int, out: MutableList<File>, seen: MutableSet<String>) {
        if (depth < 0) return
        val list = try { root.listFiles() } catch (_: Exception) { null } ?: return
        for (f in list) {
            try {
                if (f.isFile && f.name.endsWith(".gguf", true) && f.length() > 1024) {
                    val key = try { f.canonicalPath } catch (_: Exception) { f.absolutePath }
                    if (seen.add(key)) out.add(f)
                } else if (f.isDirectory && !f.name.startsWith(".")) {
                    if (f.name.equals("cache", true) && depth < 2) continue
                    scanGguf(f, depth - 1, out, seen)
                }
            } catch (_: Exception) { }
        }
    }

    @JavascriptInterface fun listModels(): String {
        // Fast path for boot — only app models folder + completed downloads.
        // Heavy multi-folder scan is listModelsDeep() (Models tab / after permission).
        val d = dir()
        val busy = busyNames()
        val seen = HashSet<String>()
        val a = JSONArray()

        d.listFiles()?.filter { it.isFile && it.name.endsWith(".gguf", true) && it.length() > 1024 }?.forEach { f ->
            if (f.name !in busy && seen.add(f.name)) {
                a.put(JSONObject().put("name", f.name).put("size", f.length()).put("mod", f.lastModified()).put("path", f.absolutePath))
            }
        }

        try {
            dm.query(DownloadManager.Query().setFilterByStatus(DownloadManager.STATUS_SUCCESSFUL)).use { c ->
                val uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                val titleIdx = c.getColumnIndex(DownloadManager.COLUMN_TITLE)
                while (c.moveToNext()) {
                    val title = c.getString(titleIdx) ?: ""
                    val local = c.getString(uriIdx) ?: ""
                    val name = when {
                        title.endsWith(".gguf", true) -> title
                        else -> Uri.parse(local).lastPathSegment ?: ""
                    }
                    if (!name.endsWith(".gguf", true) || !safe(name) || name in seen) continue
                    val dest = File(d, name)
                    if (!dest.exists() || dest.length() < 1024) {
                        try {
                            val srcUri = Uri.parse(local)
                            ctx.contentResolver.openInputStream(srcUri)?.use { input ->
                                dest.outputStream().use { output -> input.copyTo(output) }
                            }
                        } catch (_: Exception) { }
                    }
                    if (dest.exists() && dest.length() > 1024 && seen.add(name)) {
                        a.put(JSONObject().put("name", name).put("size", dest.length()).put("mod", dest.lastModified()).put("path", dest.absolutePath))
                    }
                }
            }
        } catch (_: Exception) { }

        return a.toString()
    }

    /** Slow wide scan (Download / shared folders). Call after splash, not on cold start. */
    @JavascriptInterface fun listModelsDeep(): String {
        val busy = busyNames()
        val seen = HashSet<String>()
        val files = mutableListOf<File>()
        for (root in modelScanRoots()) {
            val depth = when {
                root.absolutePath.contains("Android/data") -> 2
                root.name.equals("Download", true) || root.name.equals("Downloads", true) -> 1
                else -> 2
            }
            scanGguf(root, depth, files, seen)
        }
        val a = JSONArray()
        files.sortedByDescending { it.lastModified() }.forEach { f ->
            if (f.name in busy) return@forEach
            a.put(JSONObject().put("name", f.name).put("size", f.length()).put("mod", f.lastModified()).put("path", f.absolutePath))
        }
        return a.toString()
    }

    /** Minta izin baca storage agar scan Download/folder lain bisa jalan. */
    @JavascriptInterface fun requestStoragePermission(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= 30) {
                if (Environment.isExternalStorageManager()) return true
                val i = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                i.data = Uri.parse("package:" + ctx.packageName)
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(i)
                false
            } else if (Build.VERSION.SDK_INT >= 23) {
                val ok = ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
                if (!ok && ctx is android.app.Activity) {
                    ActivityCompat.requestPermissions(
                        ctx as android.app.Activity,
                        arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE),
                        9911
                    )
                }
                ok
            } else true
        } catch (_: Exception) { false }
    }

    @JavascriptInterface fun hasStoragePermission(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
            else if (Build.VERSION.SDK_INT >= 23)
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
            else true
        } catch (_: Exception) { false }
    }

    @JavascriptInterface fun startDownload(url: String, name: String, token: String): Long {
        if (!safe(name)) return -1L
        val d = dir()
        File(d, name).delete()
        val r = DownloadManager.Request(Uri.parse(url))
            .setTitle(name)
            .setDescription("Box AI model")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
            .setDestinationInExternalFilesDir(ctx, "models", name)
        if (token.isNotBlank()) r.addRequestHeader("Authorization", "Bearer $token")
        r.addRequestHeader("User-Agent", "BoxAI/2.2 Android")
        return try { dm.enqueue(r) } catch (e: Exception) { -1L }
    }

    @JavascriptInterface fun status(id: Long): String {
        val o = JSONObject().put("s", 0).put("b", 0L).put("t", 0L)
        try {
            dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (c.moveToFirst()) {
                    o.put("s", c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)))
                    o.put("b", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                    o.put("t", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                    val reason = c.getColumnIndex(DownloadManager.COLUMN_REASON)
                    if (reason >= 0) o.put("r", c.getInt(reason))
                }
            }
        } catch (_: Exception) { }
        return o.toString()
    }

    @JavascriptInterface fun cancel(id: Long) { try { dm.remove(id) } catch (_: Exception) { } }
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

    /** Path absolut folder models (debug / pencari). */
    @JavascriptInterface fun modelsPath(): String = dir().absolutePath

    /** Buka URL di browser eksternal. */
    @JavascriptInterface fun openUrl(url: String) {
        try {
            val i = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(i)
        } catch (_: Exception) { }
    }

    private fun updatesDir(): File = File(ctx.getExternalFilesDir(null), "updates").also { it.mkdirs() }

    /** Versi app yang terpasang (versionName). */
    @JavascriptInterface fun appVersion(): String {
        return try {
            @Suppress("DEPRECATION")
            val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            info.versionName ?: "2.2.7"
        } catch (_: Exception) { "2.2.7" }
    }

    /** Unduh APK update ke folder app. Return download id atau -1. */
    @JavascriptInterface fun downloadUpdate(url: String, fileName: String): Long {
        val name = if (fileName.endsWith(".apk", true)) fileName else "BoxAI-update.apk"
        val dest = File(updatesDir(), name)
        try { dest.delete() } catch (_: Exception) { }
        return try {
            val r = DownloadManager.Request(Uri.parse(url))
                .setTitle("Box AI Update")
                .setDescription(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
                .setDestinationInExternalFilesDir(ctx, "updates", name)
            r.addRequestHeader("User-Agent", "BoxAI-Updater")
            dm.enqueue(r)
        } catch (e: Exception) { -1L }
    }

    /** Status unduhan update: {s,b,t,path} */
    @JavascriptInterface fun updateStatus(id: Long): String {
        val o = JSONObject().put("s", 0).put("b", 0L).put("t", 0L).put("path", "")
        try {
            dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (c.moveToFirst()) {
                    o.put("s", c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)))
                    o.put("b", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                    o.put("t", c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                    val local = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
                    if (local != null) o.put("path", local)
                }
            }
        } catch (_: Exception) { }
        return o.toString()
    }

    /** Install APK yang sudah diunduh (FileProvider + REQUEST_INSTALL_PACKAGES). */
    @JavascriptInterface fun installUpdate(fileName: String): String {
        return try {
            val name = if (fileName.endsWith(".apk", true)) fileName else "BoxAI-update.apk"
            val file = File(updatesDir(), name)
            if (!file.exists() || file.length() < 1000) {
                return JSONObject().put("ok", false).put("error", "File APK tidak ditemukan").toString()
            }
            // Android 8+: pastikan boleh install dari sumber ini
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!ctx.packageManager.canRequestPackageInstalls()) {
                    val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                        .setData(Uri.parse("package:" + ctx.packageName))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ctx.startActivity(settings)
                    return JSONObject().put("ok", false).put("error", "need_permission").put("msg", "Izinkan instalasi dari sumber ini, lalu coba lagi").toString()
                }
            }
            val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(intent)
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "install failed").toString()
        }
    }

    @JavascriptInterface fun cancelUpdate(id: Long) {
        try { dm.remove(id) } catch (_: Exception) { }
    }

    @JavascriptInterface fun info(): String {
        val mi = ActivityManager.MemoryInfo()
        (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mi)
        val st = StatFs(dir().absolutePath)
        val files = dir().listFiles()?.filter { it.isFile && it.name.endsWith(".gguf", true) }?.size ?: 0
        return JSONObject()
            .put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("sdk", Build.VERSION.SDK_INT)
            .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
            .put("cores", Runtime.getRuntime().availableProcessors())
            .put("ram", mi.totalMem).put("ramFree", mi.availMem)
            .put("free", st.availableBytes).put("total", st.totalBytes)
            .put("cache", ctx.cacheDir.walkTopDown().filter { it.isFile }.sumOf { it.length() })
            .put("engine", "llama.cpp (llama-android 0.1.1)")
            .put("modelsDir", dir().absolutePath)
            .put("modelsCount", files)
            .toString()
    }
}
