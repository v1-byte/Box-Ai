package com.boxai.app

import android.annotation.SuppressLint
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import android.app.ActivityManager
import android.app.DownloadManager
import android.content.Context
import android.content.IntentFilter
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.BatteryManager
import android.os.PowerManager
import android.os.Environment
import android.os.StatFs
import android.webkit.JavascriptInterface
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import androidx.core.content.FileProvider
import android.content.pm.PackageManager
import android.Manifest
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.provider.Settings
import android.provider.MediaStore
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.SecretKey
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import dev.ffmpegkit.llama.Llama
import dev.ffmpegkit.llama.LlamaConfig
import dev.ffmpegkit.llama.LlamaModel

private class SecureSecrets(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("boxai_secure", Context.MODE_PRIVATE)
    private val alias = "boxai_connector_key"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(false)
                .build())
            generateKey()
        }
    }

    @Synchronized fun get(name: String): String {
        val raw = prefs.getString(name, null) ?: return ""
        return runCatching {
            val bytes = Base64.decode(raw, Base64.NO_WRAP)
            val ivLength = ByteBuffer.wrap(bytes).int
            val iv = ByteArray(ivLength); ByteBuffer.wrap(bytes, 4, ivLength).get(iv)
            val ciphertext = bytes.copyOfRange(4 + ivLength, bytes.size)
            Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            }.doFinal(ciphertext).toString(Charsets.UTF_8)
        }.getOrDefault("")
    }

    @Synchronized fun put(name: String, value: String) {
        if (value.isBlank()) { prefs.edit().remove(name).apply(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        // Re-encrypt once so the ciphertext is exactly the bytes stored.
        val ciphertext = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, key(), GCMParameterSpec(128, iv))
        }.doFinal(value.toByteArray())
        val out = ByteBuffer.allocate(4 + iv.size + ciphertext.size).putInt(iv.size).put(iv).put(ciphertext).array()
        prefs.edit().putString(name, Base64.encodeToString(out, Base64.NO_WRAP)).apply()
    }

    fun remove(name: String) { prefs.edit().remove(name).apply() }
}

class MainActivity : AppCompatActivity() {
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cb = filePathCallback
            filePathCallback = null
            if (cb == null) return@registerForActivityResult
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            cb.onReceiveValue(uris)
        }


    private lateinit var webView: WebView
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var bridge: Bridge

    /** SAF tree picker — same idea as Acode: user grants a folder, we keep persistable URI. */
    private val treeLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri == null) {
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.onBoxTreeGranted&&onBoxTreeGranted(false)", null
                )
            }
            return@registerForActivityResult
        }
        try {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            contentResolver.takePersistableUriPermission(uri, flags)
        } catch (_: Exception) {
            try {
                contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Exception) { }
        }
        val prefs = getSharedPreferences("boxai_trees", MODE_PRIVATE)
        val set = prefs.getStringSet("uris", emptySet())!!.toMutableSet()
        set.add(uri.toString())
        prefs.edit().putStringSet("uris", set).apply()
        runOnUiThread {
            webView.evaluateJavascript(
                "window.onBoxTreeGranted&&onBoxTreeGranted(true)", null
            )
        }
    }

    fun openTreePicker() {
        try {
            // Prefer starting at internal storage root (primary)
            val initial = try {
                DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents",
                    "primary:"
                )
            } catch (_: Exception) { null }
            treeLauncher.launch(initial)
        } catch (_: Exception) {
            treeLauncher.launch(null)
        }
    }

    fun treeUris(): List<Uri> {
        val prefs = getSharedPreferences("boxai_trees", MODE_PRIVATE)
        val fromPrefs = prefs.getStringSet("uris", emptySet())!!.mapNotNull {
            try { Uri.parse(it) } catch (_: Exception) { null }
        }
        // Also include any persistable permissions still held
        val held = contentResolver.persistedUriPermissions.map { it.uri }
        return (fromPrefs + held).distinct()
    }

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
                safeBrowsingEnabled = true
            }
        }

        bridge = Bridge(this, scope) { js -> runOnUiThread { webView.evaluateJavascript(js, null) } }
        webView.addJavascriptInterface(bridge, "BoxNative")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val intent = try {
                    params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(
                            "image/*", "text/*", "application/pdf",
                            "application/json", "application/javascript", "*/*"
                        ))
                    }
                } catch (_: Exception) {
                    Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                }
                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.scheme == "https" && request.url.host == "appassets.androidplatform.net") return false
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
    private val activity: MainActivity,
    private val scope: CoroutineScope,
    private val post: (String) -> Unit
) {
    private val ctx: Context get() = activity
    private val secrets = SecureSecrets(ctx)
    private val dm get() = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private fun dir(): File = (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).also { it.mkdirs() }
    private fun safe(n: String) = n.isNotBlank() && !n.contains('/') && !n.contains('\\') && n != "." && n != ".."
    private fun allowedHttps(raw: String, hosts: Set<String> = setOf("huggingface.co", "hf.co", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")): Boolean {
        return runCatching {
            val u = Uri.parse(raw)
            u.scheme == "https" && u.host?.lowercase() in hosts && u.userInfo == null
        }.getOrDefault(false)
    }
    private fun httpsUrl(raw: String): Boolean = runCatching {
        val u = Uri.parse(raw)
        u.scheme == "https" && !u.host.isNullOrBlank() && u.userInfo == null
    }.getOrDefault(false)

    private fun clean(s: String) = s.replace(Regex("<[^>]+>"), "").replace("&amp;", "&").replace("&quot;", "\"")
        .replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">").trim()

    private fun secretName(name: String): String? = when (name) {
        "hf", "gh", "cf", "meta" -> name
        else -> null
    }

    @JavascriptInterface fun getSecret(name: String): String =
        secretName(name)?.let { secrets.get(it) } ?: ""

    @JavascriptInterface fun setSecret(name: String, value: String) {
        secretName(name)?.let { secrets.put(it, value.take(4096)) }
    }

    @JavascriptInterface fun clearSecret(name: String) {
        secretName(name)?.let { secrets.remove(it) }
    }

    @Volatile private var currentModel: LlamaModel? = null
    @Volatile private var currentModelPath: String? = null
    @Volatile private var currentModelConfigKey: String? = null
    private val engineLock = Mutex()

    private data class RuntimeLimits(val contextSize: Int, val threads: Int)

    private data class ThermalReading(val status: Int, val source: String, val batteryTempC: Float?)

    private fun thermalReading(): ThermalReading {
        val batteryTemp = try {
            val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val raw = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1
            if (raw > 0) raw / 10f else null
        } catch (_: Exception) { null }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val status = try {
                (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).currentThermalStatus
            } catch (_: Exception) { 0 }
            return ThermalReading(status.coerceIn(0, 6), "android", batteryTemp)
        }

        val fallbackStatus = when {
            batteryTemp == null -> 0
            batteryTemp >= 55f -> 4
            batteryTemp >= 50f -> 3
            batteryTemp >= 45f -> 2
            batteryTemp >= 40f -> 1
            else -> 0
        }
        return ThermalReading(fallbackStatus, "battery", batteryTemp)
    }

    @JavascriptInterface fun thermalInfo(): String {
        val reading = thermalReading()
        val names = listOf("normal", "light", "moderate", "severe", "critical", "emergency", "shutdown")
        return JSONObject()
            .put("status", reading.status)
            .put("label", names[reading.status])
            .put("source", reading.source)
            .put("batteryTempC", reading.batteryTempC ?: JSONObject.NULL)
            .put("active", reading.status >= 2)
            .toString()
    }

    private fun runtimeLimits(requestedContext: Int): RuntimeLimits {
        val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        val memory = ActivityManager.MemoryInfo()
        if (manager != null) manager.getMemoryInfo(memory)
        val gib = 1024.0 * 1024.0 * 1024.0
        val totalGiB = memory.totalMem / gib
        val availableGiB = memory.availMem / gib
        var maxContext = when {
            totalGiB < 4.5 -> 768
            totalGiB <= 6.5 -> 1024
            totalGiB < 9.0 -> 1536
            totalGiB < 12.0 -> 2048
            else -> 4096
        }
        // GGUF model weights are memory-mapped; file size is not an all-or-nothing
        // RAM requirement. Constrain runtime working memory when available RAM is low.
        if (availableGiB < 3.0) maxContext = minOf(maxContext, 512)
        else if (availableGiB < 4.0) maxContext = minOf(maxContext, 1024)
        val thermal = thermalReading()
        val cpuCount = Runtime.getRuntime().availableProcessors().coerceIn(1, 8)
        var threads = when {
            totalGiB <= 6.5 -> minOf(2, cpuCount)
            totalGiB < 9.0 -> minOf(3, cpuCount)
            else -> minOf(4, cpuCount)
        }.coerceAtLeast(1)
        if (availableGiB < 3.0) threads = 1
        if (thermal.status >= 3) {
            maxContext = minOf(maxContext, 768)
            threads = 1
        } else if (thermal.status >= 2) {
            maxContext = minOf(maxContext, 1024)
            threads = minOf(threads, 2)
        } else if (thermal.batteryTempC != null && thermal.batteryTempC > 45f) {
            threads = minOf(threads, 2)
        }
        return RuntimeLimits(requestedContext.coerceIn(512, maxContext), threads)
    }

    @JavascriptInterface fun recommendedContext(): Int = runtimeLimits(4096).contextSize

    private fun resolveModelFile(modelName: String): File? {
        val file = if (modelName.startsWith("/")) {
            File(modelName).takeIf { safe(it.name) }
        } else {
            if (!safe(modelName)) null else File(dir(), modelName)
        } ?: return null
        if (!file.isFile || !file.name.endsWith(".gguf", true) || file.length() < 5L * 1024L * 1024L) return null
        val validHeader = try {
            file.inputStream().use { input ->
                val header = ByteArray(4)
                var offset = 0
                while (offset < header.size) {
                    val count = input.read(header, offset, header.size - offset)
                    if (count <= 0) break
                    offset += count
                }
                offset == 4 && String(header, Charsets.US_ASCII) == "GGUF"
            }
        } catch (_: Exception) { false }
        return file.takeIf { validHeader }
    }

    private fun modelLoadMemoryWarning(): String? {
        val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null
        val memory = ActivityManager.MemoryInfo()
        manager.getMemoryInfo(memory)
        val gib = 1024L * 1024L * 1024L
        val minimumReserve = gib
        if (memory.availMem < minimumReserve) {
            val freeGb = String.format(java.util.Locale.US, "%.1f", memory.availMem / gib.toDouble())
            return "RAM bebas sangat rendah (${freeGb} GB). Sisakan setidaknya 1.0 GB, tutup aplikasi lain, lalu coba lagi. Box AI otomatis memakai konteks 512 dan satu thread saat RAM rendah."
        }
        return null
    }

    private suspend fun loadOrReuseModel(
        file: File,
        requestedContext: Int,
        temperature: Float,
        topP: Float
    ): LlamaModel {
        val limits = runtimeLimits(requestedContext)
        val configKey = "${file.absolutePath}|${limits.contextSize}|${limits.threads}|$temperature|$topP"
        return engineLock.withLock {
            if (currentModel != null && currentModelConfigKey == configKey) return@withLock currentModel!!
            currentModel?.let { runCatching { Llama.releaseModel(it) } }
            currentModel = null
            currentModelPath = null
            currentModelConfigKey = null
            modelLoadMemoryWarning()?.let { throw IllegalStateException(it) }
            val config = LlamaConfig(
                contextSize = limits.contextSize,
                threads = limits.threads,
                temperature = temperature,
                topP = topP,
            )
            val loaded = Llama.loadModel(file.absolutePath, config)
            currentModel = loaded
            currentModelPath = file.absolutePath
            currentModelConfigKey = configKey
            loaded
        }
    }

    private fun modelResult(ok: Boolean, name: String, message: String = "", modelId: String = "") {
        post("window.BoxModel&&window.BoxModel.result(${if (ok) "true" else "false"},${JSONObject.quote(name)},${JSONObject.quote(message)},${JSONObject.quote(modelId)})")
    }

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

    /** Explicit load action for the Models screen; Chat also calls the same guarded loader lazily. */
    @JavascriptInterface fun preloadModel(modelName: String, requestedContext: Int, temperature: Float, topP: Float, modelId: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val file = resolveModelFile(modelName)
                    ?: throw IllegalArgumentException("File GGUF tidak ditemukan atau header GGUF tidak valid: ${File(modelName).name}")
                loadOrReuseModel(
                    file,
                    requestedContext,
                    temperature.coerceIn(0f, 2f),
                    topP.coerceIn(0.01f, 1f)
                )
                modelResult(true, file.name, modelId = modelId)
            } catch (error: Throwable) {
                val message = (error.message ?: error.javaClass.simpleName).take(500)
                modelResult(false, modelName.substringAfterLast('/'), message, modelId)
            }
        }
    }

    private suspend fun awaitThermalSafe() {
        if (thermalReading().status < 4) return
        post("window.BoxThermal&&BoxThermal.waiting(true)")
        try {
            val deadline = System.currentTimeMillis() + 120_000L
            while (thermalReading().status >= 4 && System.currentTimeMillis() < deadline) {
                delay(3_000L)
            }
            if (thermalReading().status >= 4) {
                throw IllegalStateException("Perangkat masih terlalu panas. Box AI menunda inferensi untuk melindungi HP; diamkan sebentar lalu coba lagi.")
            }
        } finally {
            post("window.BoxThermal&&BoxThermal.waiting(false)")
        }
    }

    @JavascriptInterface fun generate(json: String) {
        scope.launch(Dispatchers.Default) {
            try {
                awaitThermalSafe()
                val o = JSONObject(json)
                val modelName = o.optString("model", "")
                val requestedModelId = o.optString("model_id", "")
                if (modelName.isBlank()) {
                    post("window.BoxEngine&&BoxEngine.error('Model tidak valid')")
                    return@launch
                }
                val modelFile = resolveModelFile(modelName)
                if (modelFile == null) {
                    post("window.BoxEngine&&BoxEngine.error('File GGUF tidak ditemukan atau header tidak valid')")
                    return@launch
                }

                val nCtx = o.optInt("n_ctx", 2048).coerceIn(512, 8192)
                val maxOutput = if (runtimeLimits(nCtx).contextSize <= 1024) 1024 else 4096
                val maxTok = o.optInt("max_tokens", 512).coerceIn(16, maxOutput)
                val temp = o.optDouble("temp", 0.7).toFloat().coerceIn(0f, 2f)
                val topP = o.optDouble("top_p", 0.9).toFloat().coerceIn(0f, 1f)
                val model = loadOrReuseModel(modelFile, nCtx, temp, topP)
                modelResult(true, modelFile.name, modelId = requestedModelId)

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
            } catch (e: OutOfMemoryError) {
                System.gc()
                post("window.BoxEngine&&BoxEngine.error('RAM Android habis saat memuat model. Box AI sudah mengurangi konteks otomatis; tutup aplikasi lain atau gunakan GGUF lebih kecil/kuantisasi lebih rendah.')")
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
                currentModelConfigKey = null
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
        // Folder umum + folder pusat "model ai"
        val names = listOf(
            "Download", "Downloads", "Documents", "Models", "models", "GGUF", "gguf",
            "BoxAI", "Box-AI", "llama", "Llama", "LMStudio", "Ollama", "PocketPal", "PocketAI",
            "model ai", "Models-AI", "BoxAI-Models", "Android/media"
        )
        names.forEach { n -> roots.add(File(base, n)) }
        // Subfolder pusat
        listOf("model ai", "Models", "Download/BoxAI-Models", "Download/Models-AI").forEach { n ->
            roots.add(File(base, n))
            listOf("qwen", "gemma", "llama", "phi", "mistral").forEach { sub ->
                roots.add(File(File(base, n), sub))
            }
        }
        // App AI lain (Android/data) — butuh MANAGE_EXTERNAL_STORAGE
        val pkgs = listOf(
            "com.pocketai", "com.pocketai.app", "com.pocketpal", "com.pocketpalai", "ai.pocketpal",
            "com.lokalai", "ai.mlc.mlc-llm", "com.llamalab", "com.nexa", "com.mlc", "com.lmstudio",
            "com.boxai.app"
        )
        val androidData = File(base, "Android/data")
        pkgs.forEach { pkg ->
            roots.add(File(androidData, "$pkg/files"))
            roots.add(File(androidData, "$pkg/files/models"))
            roots.add(File(androidData, "$pkg/files/Documents"))
        }
        return roots.filter { it.exists() && it.isDirectory }
    }

    /** Quant tail without .gguf — e.g. q4_k_m. or q4_k_m */
    private fun looksLikeTruncatedGguf(name: String): Boolean {
        if (name.endsWith(".gguf", true)) return false
        val n = name.lowercase()
        if (n.endsWith(".")) return true
        val quant = Regex("q[2-8](_[kms]+)?(_[ms])?$|iq[1-4]_[a-z0-9]+$|f16$|f32$|bf16$")
        return quant.containsMatchIn(n)
    }

    /** Auto-fix `...q4_k_m.` → `...q4_k_m.gguf` when writable. */
    private fun fixTruncatedGguf(f: File): File {
        if (f.name.endsWith(".gguf", true)) return f
        if (!looksLikeTruncatedGguf(f.name)) return f
        var base = f.name.trimEnd('.')
        if (!base.endsWith(".gguf", true)) base = "$base.gguf"
        if (!safe(base)) return f
        val dest = File(f.parentFile, base)
        return try {
            if (!dest.exists() && f.renameTo(dest)) dest else if (dest.exists()) dest else f
        } catch (_: Exception) { f }
    }

    private fun scanGguf(root: File, depth: Int, out: MutableList<File>, seen: MutableSet<String>) {
        if (depth < 0) return
        val list = try { root.listFiles() } catch (_: Exception) { null } ?: return
        for (f in list) {
            try {
                if (f.isFile && f.length() > 1024) {
                    val fixed = when {
                        f.name.endsWith(".gguf", true) -> f
                        looksLikeTruncatedGguf(f.name) -> fixTruncatedGguf(f)
                        else -> null
                    } ?: continue
                    if (!fixed.name.endsWith(".gguf", true)) continue
                    val key = try { fixed.canonicalPath } catch (_: Exception) { fixed.absolutePath }
                    if (seen.add(key)) out.add(fixed)
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

    /** MediaStore index — finds .gguf on shared storage even when folder walk fails. */
    private fun scanMediaStoreGguf(out: MutableList<File>, seen: MutableSet<String>) {
        try {
            val uri = MediaStore.Files.getContentUri("external")
            val proj = arrayOf(
                MediaStore.Files.FileColumns.DISPLAY_NAME,
                MediaStore.Files.FileColumns.SIZE,
                MediaStore.Files.FileColumns.DATE_MODIFIED,
                MediaStore.Files.FileColumns.DATA
            )
            // Match *.gguf (case-insensitive via LIKE lower on some devices — try both)
            val sel = "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ? OR ${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?"
            val args = arrayOf("%.gguf", "%.GGUF")
            ctx.contentResolver.query(uri, proj, sel, args, null)?.use { c ->
                val iName = c.getColumnIndex(MediaStore.Files.FileColumns.DISPLAY_NAME)
                val iSize = c.getColumnIndex(MediaStore.Files.FileColumns.SIZE)
                @Suppress("DEPRECATION")
                val iData = c.getColumnIndex(MediaStore.Files.FileColumns.DATA)
                while (c.moveToNext()) {
                    val name = if (iName >= 0) c.getString(iName) ?: continue else continue
                    if (!name.endsWith(".gguf", true)) continue
                    val size = if (iSize >= 0) c.getLong(iSize) else 0L
                    if (size > 0 && size < 5L * 1024L * 1024L) continue
                    val path = if (iData >= 0) c.getString(iData) else null
                    if (path.isNullOrBlank()) continue
                    val f = File(path)
                    if (!f.isFile || f.length() < 1024) continue
                    val key = try { f.canonicalPath } catch (_: Exception) { f.absolutePath }
                    if (seen.add(key)) out.add(f)
                }
            }
        } catch (_: Exception) { }
    }

    /** Wide multi-folder + MediaStore scan for tombol Terunduh / Pindai. */
    @JavascriptInterface fun listModelsDeep(): String {
        val busy = busyNames()
        val seenPath = HashSet<String>()
        val files = mutableListOf<File>()

        // 1) MediaStore (shared storage index — works with All files / media perms)
        scanMediaStoreGguf(files, seenPath)

        // 1b) SAF trees granted by user (Acode-style folder access)
        scanSafTrees(files, seenPath)

        // 2) Public standard dirs
        try {
            listOf(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
            ).forEach { pub ->
                if (pub != null && pub.isDirectory) scanGguf(pub, 3, files, seenPath)
            }
        } catch (_: Exception) { }

        // 3) Known roots (Pocket AI, model ai, …)
        for (root in modelScanRoots()) {
            val depth = when {
                root.absolutePath.contains("Android/data") -> 4
                root.name.equals("Download", true) || root.name.equals("Downloads", true) -> 3
                root.name.contains("model", true) || root.name.equals("Models", true) -> 4
                else -> 3
            }
            scanGguf(root, depth, files, seenPath)
        }

        // Dedup by lowercase filename — keep largest
        val best = LinkedHashMap<String, File>()
        for (f in files) {
            if (f.name in busy) continue
            if (f.length() < 5L * 1024L * 1024L) continue
            val key = f.name.lowercase()
            val prev = best[key]
            if (prev == null || f.length() > prev.length()) best[key] = f
        }
        val a = JSONArray()
        best.values.sortedBy { it.name.lowercase() }.forEach { f ->
            val path = f.absolutePath
            val source = when {
                path.contains("pocketai", true) || path.contains("pocketpal", true) -> "pocketai"
                path.contains("Android/data", true) -> "other_app"
                path.contains("Download", true) -> "download"
                path.contains("model ai", true) || path.contains("/Models", true) -> "external"
                path.contains(dir().absolutePath) -> "boxai"
                else -> "local"
            }
            a.put(
                JSONObject()
                    .put("name", f.name)
                    .put("size", f.length())
                    .put("mod", f.lastModified())
                    .put("path", path)
                    .put("source", source)
            )
        }
        return a.toString()
    }

    /** Debug: permission + how many roots readable + MediaStore hits (for toast). */
    @JavascriptInterface fun scanDebug(): String {
        val o = JSONObject()
        try {
            o.put("sdk", Build.VERSION.SDK_INT)
            val roots = modelScanRoots()
            o.put("roots", roots.size)
            var readable = 0
            val samples = JSONArray()
            for (r in roots) {
                val can = r.canRead() && (r.listFiles()?.isNotEmpty() == true)
                if (can) {
                    readable++
                    if (samples.length() < 8) samples.put(r.absolutePath)
                }
            }
            o.put("rootsReadable", readable)
            o.put("sampleRoots", samples)
            val seen = HashSet<String>()
            val media = mutableListOf<File>()
            scanMediaStoreGguf(media, seen)
            o.put("mediaStoreGguf", media.size)
            o.put("treeAccess", activity.treeUris().size)
            val deep = try { JSONArray(listModelsDeep()).length() } catch (_: Exception) { -1 }
            o.put("deepTotal", deep)
            o.put("modelsDir", dir().absolutePath)
            val local = dir().listFiles()?.count { it.name.endsWith(".gguf", true) } ?: 0
            o.put("appModels", local)
        } catch (e: Exception) {
            o.put("error", e.message ?: "err")
        }
        return o.toString()
    }

    /** Akses file hanya melalui system folder picker (SAF). */
    @JavascriptInterface fun requestStoragePermission(): Boolean {
        return try {
            activity.runOnUiThread { activity.openTreePicker() }
            true
        } catch (_: Exception) { false }
    }

    @JavascriptInterface fun hasStoragePermission(): Boolean {
        return activity.treeUris().isNotEmpty()
    }

    /**
     * Acode-style: open system folder picker (SAF).
     * User should pick internal storage root or /Download or /model ai —
     * grant is persisted and used by listModelsDeep.
     */
    @JavascriptInterface fun requestTreeAccess(): Boolean {
        return try {
            activity.runOnUiThread { activity.openTreePicker() }
            true
        } catch (_: Exception) { false }
    }

    @JavascriptInterface fun treeAccessCount(): Int = activity.treeUris().size

    /** Daftar file umum dari folder SAF, bergaya file explorer, dengan batas aman. */
    @JavascriptInterface fun listWorkspaceFiles(): String {
        val out = JSONArray()
        val limit = 1500
        val textExt = setOf("txt", "md", "json", "js", "ts", "tsx", "jsx", "kt", "java", "xml", "yaml", "yml", "css", "html", "csv", "log", "py", "sh", "gradle")
        fun walk(dir: DocumentFile, depth: Int, relative: String) {
            if (depth < 0 || out.length() >= limit) return
            val kids = runCatching { dir.listFiles() }.getOrDefault(emptyArray())
            for (f in kids) {
                if (out.length() >= limit) break
                val name = f.name ?: continue
                if (name.startsWith(".") || name.equals("Android", true) || name.equals("cache", true)) continue
                val rel = if (relative.isBlank()) name else "$relative/$name"
                if (f.isDirectory) walk(f, depth - 1, rel) else if (f.isFile) {
                    val ext = name.substringAfterLast('.', "").lowercase()
                    // Include normal files; cap very large binaries to keep scan metadata-only.
                    if (f.length() <= 512L * 1024L * 1024L) {
                        out.put(JSONObject().put("uri", f.uri.toString()).put("name", rel)
                            .put("size", f.length()).put("mod", f.lastModified()).put("text", ext in textExt))
                    }
                }
            }
        }
        activity.treeUris().forEach { tree ->
            if (out.length() < limit) DocumentFile.fromTreeUri(ctx, tree)?.let { walk(it, 6, "") }
        }
        return out.toString()
    }

    private fun isGrantedDocument(raw: String): Boolean = runCatching {
        val uri = Uri.parse(raw)
        activity.treeUris().any { raw.startsWith(it.toString()) } &&
            uri.scheme == "content" && DocumentsContract.isDocumentUri(ctx, uri)
    }.getOrDefault(false)

    @JavascriptInterface fun readWorkspaceText(raw: String): String {
        if (!isGrantedDocument(raw)) return ""
        return runCatching {
            val doc = DocumentFile.fromSingleUri(ctx, Uri.parse(raw)) ?: return ""
            if (!doc.isFile || doc.length() > 2L * 1024L * 1024L) return ""
            ctx.contentResolver.openInputStream(doc.uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
        }.getOrDefault("")
    }

    @JavascriptInterface fun writeWorkspaceText(raw: String, content: String): Boolean {
        if (!isGrantedDocument(raw) || content.length > 2_000_000) return false
        return runCatching {
            val doc = DocumentFile.fromSingleUri(ctx, Uri.parse(raw)) ?: return false
            if (!doc.isFile) return false
            ctx.contentResolver.openOutputStream(doc.uri, "wt")?.bufferedWriter(Charsets.UTF_8)?.use { it.write(content) }
            true
        }.getOrDefault(false)
    }

    @JavascriptInterface fun clearTreeAccess(): Boolean {
        return try {
            for (uri in activity.treeUris()) {
                try {
                    activity.contentResolver.releasePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    )
                } catch (_: Exception) { }
            }
            activity.getSharedPreferences("boxai_trees", Context.MODE_PRIVATE)
                .edit().remove("uris").apply()
            true
        } catch (_: Exception) { false }
    }

    /** Walk SAF trees for .gguf; copy into app models dir if we only have a content stream. */
    private fun scanSafTrees(out: MutableList<File>, seen: MutableSet<String>) {
        for (tree in activity.treeUris()) {
            try {
                val root = DocumentFile.fromTreeUri(ctx, tree) ?: continue
                walkDocument(root, 5, out, seen)
            } catch (_: Exception) { }
        }
    }

    private fun walkDocument(dir: DocumentFile, depth: Int, out: MutableList<File>, seen: MutableSet<String>) {
        if (depth < 0) return
        val kids = try { dir.listFiles() } catch (_: Exception) { return }
        for (f in kids) {
            try {
                val name = f.name ?: continue
                if (f.isFile && name.endsWith(".gguf", true) && f.length() >= 5L * 1024L * 1024L) {
                    val local = materializeDocument(f, name) ?: continue
                    val key = try { local.canonicalPath } catch (_: Exception) { local.absolutePath }
                    if (seen.add(key)) out.add(local)
                } else if (f.isDirectory && !name.startsWith(".")) {
                    // Skip huge system trees
                    val skip = name.equals("Android", true) && depth < 4
                    if (!skip) walkDocument(f, depth - 1, out, seen)
                }
            } catch (_: Exception) { }
        }
    }

    /**
     * Prefer real filesystem path when possible; otherwise copy into app models (once).
     * Llama needs a real path for mmap.
     */
    private fun materializeDocument(doc: DocumentFile, name: String): File? {
        if (!safe(name)) return null
        // Already in app models?
        val dest = File(dir(), name)
        if (dest.exists() && dest.length() > 1024) return dest
        // Try to resolve path from URI (works for many primary:… documents)
        val path = tryResolvePath(doc.uri)
        if (path != null) {
            val f = File(path)
            if (f.isFile && f.canRead() && f.length() > 1024) return f
        }
        // Stream-copy into app models (only if not already partial)
        return try {
            if (dest.exists()) dest.delete()
            ctx.contentResolver.openInputStream(doc.uri)?.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            }
            if (dest.exists() && dest.length() > 1024) dest else null
        } catch (_: Exception) {
            try { dest.delete() } catch (_: Exception) { }
            null
        }
    }

    private fun tryResolvePath(uri: Uri): String? {
        // content://com.android.externalstorage.documents/document/primary%3ADownload%2Ffoo.gguf
        try {
            if (DocumentsContract.isDocumentUri(ctx, uri)) {
                val docId = DocumentsContract.getDocumentId(uri)
                if (docId.startsWith("primary:")) {
                    val rel = Uri.decode(docId.removePrefix("primary:"))
                    val base = Environment.getExternalStorageDirectory()
                    val f = File(base, rel)
                    if (f.exists()) return f.absolutePath
                }
                // raw paths on some OEMs
                if (docId.startsWith("/")) {
                    val f = File(docId)
                    if (f.exists()) return f.absolutePath
                }
            }
        } catch (_: Exception) { }
        // MediaStore DATA
        try {
            ctx.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val i = c.getColumnIndex(MediaStore.MediaColumns.DATA)
                    if (i >= 0) {
                        val p = c.getString(i)
                        if (!p.isNullOrBlank() && File(p).exists()) return p
                    }
                }
            }
        } catch (_: Exception) { }
        return null
    }

    // ---- Fast multi-connection download via ModelDownloadService ----
    @Volatile private var lastDlError: String = ""

    @JavascriptInterface fun lastDownloadError(): String =
        lastDlError.ifEmpty { ModelDownloadService.lastError }

    private fun dlIntent(action: String, id: Long = -1L, url: String = "", name: String = "", token: String = ""): Intent {
        return Intent(ctx, ModelDownloadService::class.java).apply {
            this.action = action
            putExtra("id", id)
            if (url.isNotEmpty()) putExtra("url", url)
            if (name.isNotEmpty()) putExtra("name", name)
            if (token.isNotEmpty()) putExtra("token", token)
        }
    }

    @JavascriptInterface fun startDownload(url: String, name: String, token: String): Long {
        lastDlError = ""
        val pure = name.substringAfterLast('/').substringAfterLast('\\')
        if (!safe(pure)) {
            lastDlError = "nama file tidak valid"
            return -1L
        }
        if (!httpsUrl(url)) {
            lastDlError = "URL tidak valid"
            return -1L
        }
        dir()
        // Resume paused job same file
        ModelDownloadService.jobs.values.firstOrNull {
            it.name == pure && it.status == ModelDownloadService.STATUS_PAUSED
        }?.let { job ->
            val i = dlIntent(ModelDownloadService.ACTION_RESUME, job.id)
            if (android.os.Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            return job.id
        }
        val id = ModelDownloadService.nextId()
        val i = dlIntent(ModelDownloadService.ACTION_START, id, url, pure, token)
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        } catch (e: Exception) {
            lastDlError = e.message ?: "gagal start service"
            return -1L
        }
        return id
    }

    @JavascriptInterface fun pauseDownload(id: Long): Boolean {
        ctx.startService(dlIntent(ModelDownloadService.ACTION_PAUSE, id))
        ModelDownloadService.jobs[id]?.status = ModelDownloadService.STATUS_PAUSED
        return true
    }

    @JavascriptInterface fun resumeDownload(id: Long): Boolean {
        val job = ModelDownloadService.jobs[id] ?: return false
        val i = dlIntent(ModelDownloadService.ACTION_RESUME, id)
        if (android.os.Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        return true
    }

    @JavascriptInterface fun status(id: Long): String {
        val o = JSONObject().put("s", 0).put("b", 0L).put("t", 0L)
        val job = ModelDownloadService.jobs[id]
        if (job != null) {
            val b = job.bytes.get()
            val tot = job.total.get()
            val spd = job.speedBps.get()
            o.put("s", job.status)
            o.put("b", b)
            o.put("t", tot)
            o.put("spd", spd)
            o.put("parts", job.activeParts.get())
            o.put("retries", job.retries.get())
            o.put("name", job.name)
            o.put("detail", job.detail)
            if (spd > 0 && tot > b) o.put("eta", (tot - b) / spd)
            if (job.error.isNotEmpty()) o.put("err", job.error)
            return o.toString()
        }
        return o.toString()
    }

    @JavascriptInterface fun cancel(id: Long) {
        ctx.startService(dlIntent(ModelDownloadService.ACTION_CANCEL, id))
    }

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
        if (!allowedHttps(url, setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"))) return -1L
        val rawName = fileName.substringAfterLast('/').substringAfterLast('\\')
        if (!safe(rawName) || !rawName.endsWith(".apk", true)) return -1L
        val name = rawName.take(120)
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
            if (file.length() > 150L * 1024L * 1024L) {
                file.delete()
                return JSONObject().put("ok", false).put("error", "APK terlalu besar").toString()
            }
            val archive = ctx.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_META_DATA)
            if (archive == null || archive.packageName != ctx.packageName) {
                file.delete()
                return JSONObject().put("ok", false).put("error", "Package APK tidak cocok").toString()
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
