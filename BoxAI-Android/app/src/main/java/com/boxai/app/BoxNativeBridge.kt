package com.boxai.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * Implementasi kontrak window.BoxNative (lihat docs/NATIVE_BRIDGE.md).
 * Aturan: semua argumen divalidasi, tidak ada exec/shell, token tidak pernah dicatat ke log,
 * hanya tipe primitif/String yang dikembalikan, pekerjaan berat di luar main thread.
 */
class BoxNativeBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val requestTree: ((Boolean) -> Unit) -> Unit
) {
    val workspace = WorkspaceManager(activity)
    private val models = ModelManager(activity, workspace)
    private val secrets = SecureStorage(activity)
    private val monitor = DeviceMonitor(activity)
    private val downloads = BoxDownloads()
    private val engine = LlamaEngine()
    private val io = Executors.newCachedThreadPool { r -> Thread(r, "boxai-io").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val updatesDir = File(activity.filesDir, "updates").apply { mkdirs() }

    @Volatile private var thermalWaitingNotified = false

    // ------------------------------------------------------------------ JS helpers
    private fun js(code: String) { main.post { webView.evaluateJavascript(code, null) } }
    private fun q(s: String) = JSONObject.quote(s)

    // ------------------------------------------------------------------ 1. Inferensi dan model
    @JavascriptInterface fun engineAvailable(): Boolean = engine.available

    @JavascriptInterface fun recommendedContext(): Int = monitor.recommendedContext()

    @JavascriptInterface
    fun preloadModel(file: String, nCtx: Int, temp: Double, topP: Double, modelId: String) {
        val id = modelId.take(200)
        fun result(ok: Boolean, name: String, msg: String) =
            js("window.BoxModel&&window.BoxModel.result(${ok},${q(name)},${q(msg)},${q(id)})")
        io.execute {
            val r = models.resolve(file)
            if (r == null) { result(false, file.substringAfterLast('/'), "File model tidak ditemukan atau tidak diizinkan"); return@execute }
            models.validate(r)?.let { result(false, r.display, it); try { r.pfd?.close() } catch (_: Exception) { }; return@execute }
            val size = r.pfd?.statSize ?: File(r.path).length()
            if (size > totalRam() * 85 / 100) {
                try { r.pfd?.close() } catch (_: Exception) { }
                result(false, r.display, "Model terlalu besar untuk RAM perangkat ini"); return@execute
            }
            engine.load(r, id) { ok, msg -> result(ok, r.display, msg) }
        }
    }

    private fun totalRam(): Long {
        val mi = android.app.ActivityManager.MemoryInfo()
        (activity.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager).getMemoryInfo(mi)
        return mi.totalMem
    }

    @JavascriptInterface fun unloadModel() { engine.unload() }

    @JavascriptInterface
    fun generate(json: String) {
        if (json.length > MAX_PAYLOAD) { jsError("Permintaan terlalu besar"); return }
        val req = try { JSONObject(json) } catch (_: Exception) { jsError("Permintaan tidak valid"); return }
        val modelId = req.optString("model_id", "")
        if (!engine.isLoaded) { jsError("Model belum dimuat. Pilih model lalu ketuk Gunakan."); return }
        if (modelId.isNotEmpty() && modelId != engine.loadedModelId) { jsError("Model yang dipilih belum dimuat ke engine"); return }
        val arr = req.optJSONArray("messages")
        if (arr == null || arr.length() == 0 || arr.length() > 200) { jsError("Pesan tidak valid"); return }
        val roles = ArrayList<String>(); val contents = ArrayList<String>()
        for (i in 0 until arr.length()) {
            val m = arr.optJSONObject(i) ?: continue
            val role = m.optString("role")
            if (role != "system" && role != "user" && role != "assistant") continue
            roles.add(role); contents.add(m.optString("content", ""))
        }
        if (roles.isEmpty()) { jsError("Pesan tidak valid"); return }
        val temp = req.optDouble("temp", 0.7).coerceIn(0.0, 2.0).toFloat()
        val topP = req.optDouble("top_p", 0.9).coerceIn(0.0, 1.0).toFloat()
        val maxTok = req.optInt("max_tokens", 1024).coerceIn(1, 8192)
        val nCtx = req.optInt("n_ctx", 1024).coerceIn(256, monitor.recommendedContext().coerceAtLeast(256))

        io.execute {
            if (!waitForCooldown()) { jsError("Suhu perangkat terlalu tinggi. Coba lagi setelah perangkat dingin."); return@execute }
            val buf = StringBuilder(); var last = System.currentTimeMillis()
            fun flush() {
                if (buf.isEmpty()) return
                val t = buf.toString(); buf.setLength(0); last = System.currentTimeMillis()
                main.post {
                    webView.evaluateJavascript("(function(t){var e=window.BoxEngine;if(e&&e.token){e.token(t);return 1}return 0})(${q(t)})") { r ->
                        if (r == "0") engine.stop()   // UI sudah tidak menunggu (timeout/dibatalkan)
                    }
                }
            }
            engine.generate(roles.toTypedArray(), contents.toTypedArray(), temp, topP, maxTok, nCtx, monitor.recommendedThreads(),
                object : LlamaEngine.Listener {
                    override fun onToken(text: String): Boolean {
                        buf.append(text)
                        if (System.currentTimeMillis() - last >= 40 || buf.length > 96) flush()
                        return true
                    }
                    override fun onProgress(percent: Int) {
                        js("window.BoxEngine&&window.BoxEngine.progress&&window.BoxEngine.progress($percent)")
                    }
                    override fun onDone() { flush(); js("window.BoxEngine&&window.BoxEngine.done&&window.BoxEngine.done()") }
                    override fun onError(message: String) { flush(); jsError(message) }
                })
        }
    }

    /** Ekstensi di luar kontrak asli: hentikan generasi yang sedang berjalan. */
    @JavascriptInterface fun stopGeneration() { engine.stop() }

    private fun jsError(msg: String) =
        js("window.BoxEngine&&window.BoxEngine.error&&window.BoxEngine.error(${q(msg)})")

    /** Tahan generasi saat status termal >= CRITICAL (4), maksimal 2 menit. */
    private fun waitForCooldown(): Boolean {
        var waited = 0
        while (monitor.thermalStatus() >= 4) {
            if (!thermalWaitingNotified) { thermalWaitingNotified = true; js("window.BoxThermal&&window.BoxThermal.waiting(true)") }
            if (waited >= 120_000) { thermalWaitingNotified = false; js("window.BoxThermal&&window.BoxThermal.waiting(false)"); return false }
            Thread.sleep(2000); waited += 2000
        }
        if (thermalWaitingNotified) { thermalWaitingNotified = false; js("window.BoxThermal&&window.BoxThermal.waiting(false)") }
        return true
    }

    @JavascriptInterface fun listModels(): String = models.list()
    @JavascriptInterface fun listModelsDeep(): String = models.listDeep()
    @JavascriptInterface fun deleteModel(file: String): Boolean = models.delete(file)
    @JavascriptInterface fun renameModel(oldName: String, newName: String): Boolean = models.rename(oldName, newName)
    @JavascriptInterface fun head(file: String): String = models.head(file)
    @JavascriptInterface fun info(): String = monitor.info()

    // ------------------------------------------------------------------ 2. Unduhan model
    @JavascriptInterface
    fun startDownload(url: String, fileName: String, token: String): Int {
        lastError = ""
        if (!ModelManager.validName(fileName)) { lastError = "Nama file tidak valid (harus .gguf)"; return -1 }
        if (token.length > 512 || !token.matches(Regex("[A-Za-z0-9_.\\-]*"))) { lastError = "Token tidak valid"; return -1 }
        val dest = File(models.modelsDir, fileName)
        if (dest.exists()) { lastError = "File sudah ada di perangkat"; return -1 }
        val id = downloads.start(url, dest, token)
        if (id < 0) lastError = downloads.lastError
        return id
    }

    @JavascriptInterface fun status(downloadId: Int): String = downloads.status(downloadId)
    @JavascriptInterface fun pauseDownload(downloadId: Int) { downloads.pause(downloadId) }
    @JavascriptInterface fun cancel(downloadId: Int) { downloads.cancel(downloadId) }
    @JavascriptInterface fun lastDownloadError(): String = lastError.ifEmpty { downloads.lastError }
    @Volatile private var lastError = ""

    // ------------------------------------------------------------------ 3. Penyimpanan dan file
    // Folder model milik aplikasi (getExternalFilesDir) tidak butuh izin penyimpanan; folder lain lewat SAF.
    @JavascriptInterface fun hasStoragePermission(): Boolean = true
    @JavascriptInterface fun requestStoragePermission() { /* tidak diperlukan; gunakan requestTreeAccess */ }

    @JavascriptInterface
    fun requestTreeAccess() {
        main.post {
            requestTree { ok -> js("window.onBoxTreeGranted&&window.onBoxTreeGranted(${ok})") }
        }
    }

    @JavascriptInterface fun treeAccessCount(): Int = workspace.treeCount()
    @JavascriptInterface fun scanDebug(): String = models.scanDebug()
    @JavascriptInterface fun listWorkspaceFiles(): String = workspace.listFiles()
    @JavascriptInterface fun readWorkspaceText(uri: String): String = workspace.readText(uri) ?: ""
    @JavascriptInterface fun writeWorkspaceText(uri: String, text: String): Boolean = workspace.writeText(uri, text)

    /** Hanya cache (cacheDir/externalCacheDir). Tidak menyentuh model, chat, token, atau file pengguna. */
    @JavascriptInterface
    fun clearCache() {
        io.execute {
            listOfNotNull(activity.cacheDir, activity.externalCacheDir).forEach { d -> d.listFiles()?.forEach { it.deleteRecursively() } }
        }
    }

    // ------------------------------------------------------------------ 4. Rahasia
    @JavascriptInterface fun getSecret(key: String): String = secrets.get(key)
    @JavascriptInterface fun setSecret(key: String, value: String) { secrets.set(key, value) }

    // ------------------------------------------------------------------ 5. Web, termal, pembaruan
    @JavascriptInterface
    fun webSearch(id: Int, query: String) {
        val qy = query.trim().take(300)
        io.execute {
            val payload = try {
                if (qy.isEmpty()) JSONObject().put("error", "Kueri kosong") else searchDuckDuckGo(qy)
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: "Pencarian gagal")
            }
            js("window.BoxSearch&&window.BoxSearch.cb($id,$payload)")
        }
    }

    private fun searchDuckDuckGo(query: String): JSONObject {
        val c = (URL("https://html.duckduckgo.com/html/").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true
            connectTimeout = 10_000; readTimeout = 10_000
            setRequestProperty("User-Agent", "Mozilla/5.0 (Android) BoxAI/2.2.34")
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        }
        c.outputStream.use { it.write(("q=" + URLEncoder.encode(query, "UTF-8")).toByteArray()) }
        if (c.responseCode != 200) throw java.io.IOException("Pencarian gagal (HTTP ${c.responseCode})")
        val html = c.inputStream.use { it.readBytesLimited(1_500_000) }.toString(Charsets.UTF_8)
        c.disconnect()
        val results = JSONArray()
        val link = Regex("""<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL)
        val snip = Regex("""class="result__snippet"[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL)
        val snippets = snip.findAll(html).map { clean(it.groupValues[1]) }.toList()
        for ((i, m) in link.findAll(html).withIndex()) {
            if (results.length() >= 5) break
            val url = unwrap(m.groupValues[1]) ?: continue
            results.put(JSONObject().put("title", clean(m.groupValues[2])).put("url", url).put("snippet", snippets.getOrElse(i) { "" }))
        }
        return JSONObject().put("results", results)
    }

    private fun unwrap(href: String): String? {
        val h = if (href.startsWith("//")) "https:$href" else href
        val u = Regex("""[?&]uddg=([^&]+)""").find(h)?.groupValues?.get(1)?.let { URLDecoder.decode(it, "UTF-8") } ?: h
        return if (u.startsWith("https://") || u.startsWith("http://")) u else null
    }

    private fun clean(s: String) = s.replace(Regex("<[^>]+>"), "")
        .replace("&amp;", "&").replace("&quot;", "\"").replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">")
        .replace(Regex("\\s+"), " ").trim()

    @JavascriptInterface fun thermalInfo(): String = monitor.thermalInfo()
    @JavascriptInterface fun deviceStats(): String = monitor.deviceStats()
    @JavascriptInterface fun coolDown(): String = monitor.coolDown()

    @JavascriptInterface
    fun appVersion(): String = try {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName?.removeSuffix("-debug") ?: ""
    } catch (_: Exception) { "" }

    @JavascriptInterface
    fun downloadUpdate(url: String, apkName: String): Int {
        if (!APK_RE.matches(apkName)) return -1
        val u = try { URL(url) } catch (_: Exception) { return -1 }
        if (u.protocol != "https" || u.host != "github.com" || !u.path.startsWith("/v1-byte/Box-Ai/releases/download/")) return -1
        val dest = File(updatesDir, apkName).also { it.delete() }
        return downloads.start(url, dest, "", minBytes = 1_000_000)
    }

    @JavascriptInterface fun updateStatus(downloadId: Int): String = downloads.status(downloadId)
    @JavascriptInterface fun cancelUpdate(downloadId: Int) { downloads.cancel(downloadId) }

    @JavascriptInterface
    fun installUpdate(apkName: String): String {
        if (!APK_RE.matches(apkName)) return err("bad_name")
        val f = File(updatesDir, apkName)
        if (!f.isFile) return err("not_found")
        val pm = activity.packageManager
        val info = pm.getPackageArchiveInfo(f.path, 0) ?: return err("invalid_apk")
        if (info.packageName != activity.packageName) return err("package_mismatch")
        val cur = pm.getPackageInfo(activity.packageName, 0)
        val newCode = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        val curCode = if (Build.VERSION.SDK_INT >= 28) cur.longVersionCode else @Suppress("DEPRECATION") cur.versionCode.toLong()
        if (newCode <= curCode) return err("not_newer")
        if (!pm.canRequestPackageInstalls()) {
            main.post {
                try {
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                } catch (_: Exception) { }
            }
            return JSONObject().put("ok", false).put("error", "need_permission")
                .put("msg", "Izinkan Box AI memasang aplikasi, lalu ketuk Install lagi").toString()
        }
        main.post {
            try {
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", f)
                activity.startActivity(
                    Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (_: Exception) { }
        }
        return JSONObject().put("ok", true).toString()   // pemasangan tetap atas persetujuan pengguna di installer sistem
    }

    private fun err(code: String) = JSONObject().put("ok", false).put("error", code).toString()

    // ------------------------------------------------------------------ siklus hidup
    fun shutdown() {
        engine.shutdown()
        downloads.shutdown()
        io.shutdownNow()
    }

    companion object {
        private const val MAX_PAYLOAD = 4_000_000
        private val APK_RE = Regex("^[A-Za-z0-9._\\-]{1,100}\\.apk$")
    }
}

private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (out.size() < limit) {
        val n = read(buf, 0, minOf(buf.size, limit - out.size()))
        if (n < 0) break
        out.write(buf, 0, n)
    }
    return out.toByteArray()
}
