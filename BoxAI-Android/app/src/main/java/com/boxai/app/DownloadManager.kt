package com.boxai.app

import android.os.SystemClock
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Unduhan HTTPS dengan jeda/lanjut (Range), tulis ke <nama>.part lalu rename setelah diverifikasi.
 * Kode status mengikuti konvensi UI: 2 = berjalan, 4 = dijeda, 8 = selesai, 16 = gagal, 0 = dibatalkan.
 * Token hanya dikirim ke host asal (tidak diteruskan saat redirect ke host lain) dan tidak pernah dicatat.
 */
class BoxDownloads {
    class Task(val id: Int, val url: String, val dest: File, val token: String, val minBytes: Long) {
        @Volatile var state = 2
        @Volatile var bytes = 0L
        @Volatile var total = 0L
        @Volatile var speed = 0L
        @Volatile var err = ""
        @Volatile var stop = false      // jeda
        @Volatile var cancel = false
    }

    private val locks = ConcurrentHashMap<String, Any>()
    private val ids = AtomicInteger(1)
    private val tasks = ConcurrentHashMap<Int, Task>()
    private val pool = Executors.newFixedThreadPool(2)
    @Volatile var lastError = ""
        private set

    /** Mengembalikan id, atau -1 (lihat [lastError]). */
    fun start(url: String, dest: File, token: String, minBytes: Long = 1024): Int {
        lastError = ""
        val u = try { URL(url) } catch (_: Exception) { lastError = "URL tidak valid"; return -1 }
        if (u.protocol != "https") { lastError = "Hanya HTTPS yang diizinkan"; return -1 }
        tasks.values.firstOrNull { it.dest == dest && it.state == 2 }?.let { return it.id }
        val t = Task(ids.getAndIncrement(), url, dest, token, minBytes)
        tasks[t.id] = t
        // Satu tujuan hanya boleh diproses satu thread (mencegah jeda->lanjut cepat merusak file .part).
        pool.execute { synchronized(locks.getOrPut(dest.path) { Any() }) { run(t) } }
        return t.id
    }

    fun pause(id: Int) { tasks[id]?.let { if (it.state == 2) it.stop = true } }
    fun cancel(id: Int) { tasks[id]?.let { it.cancel = true; it.stop = true; if (it.state != 8) File(it.dest.path + ".part").delete() } }

    fun status(id: Int): String {
        val t = tasks[id] ?: return JSONObject().put("s", 0).toString()
        val eta = if (t.speed > 0 && t.total > t.bytes) (t.total - t.bytes) / t.speed else -1L
        return JSONObject().put("s", t.state).put("b", t.bytes).put("t", t.total).put("spd", t.speed)
            .put("eta", eta).put("name", t.dest.name).put("err", t.err).toString()
    }

    fun shutdown() { tasks.values.forEach { it.stop = true }; pool.shutdownNow() }

    // ---------------- inti unduhan ----------------
    private fun run(t: Task) {
        val part = File(t.dest.path + ".part")
        try {
            t.dest.parentFile?.mkdirs()
            var attempt = 0
            while (true) {
                try {
                    transfer(t, part)
                    // Aliran berakhir lebih awal tanpa galat: lanjutkan dari byte terakhir.
                    if (!t.stop && t.total > 0 && part.length() < t.total && ++attempt <= 3) continue
                    break
                } catch (e: java.io.IOException) {
                    if (t.stop) break
                    if (++attempt > 3) throw e
                    SystemClock.sleep(1500L * attempt)   // jaringan putus: coba lanjut dari byte terakhir
                }
            }
            if (t.cancel) { t.state = 0; return }
            if (t.stop) { t.state = 4; return }
            // verifikasi
            val size = part.length()
            if (size < t.minBytes) fail(t, "File hasil unduhan kosong atau terlalu kecil")
            else if (t.total > 0 && size != t.total) fail(t, "Ukuran tidak cocok ($size dari ${t.total})")
            else if (t.dest.name.endsWith(".gguf", true) && !hasGgufMagic(part)) fail(t, "Bukan file GGUF yang valid")
            else if (!part.renameTo(t.dest)) fail(t, "Gagal menyimpan file")
            else { t.bytes = size; t.state = 8 }
        } catch (e: Exception) {
            if (t.cancel) t.state = 0 else if (t.stop) t.state = 4 else fail(t, e.message ?: e.javaClass.simpleName)
        }
    }

    private fun fail(t: Task, msg: String) { t.err = msg; lastError = msg; t.state = 16 }

    private fun transfer(t: Task, part: File) {
        var existing = if (part.exists()) part.length() else 0L
        var url = URL(t.url)
        val originHost = url.host
        var conn: HttpURLConnection? = null
        var redirects = 0
        while (true) {
            conn = (url.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000; readTimeout = 30_000
                setRequestProperty("User-Agent", "BoxAI/2.2.34")
                if (t.token.isNotEmpty() && url.host == originHost) setRequestProperty("Authorization", "Bearer ${t.token}")
                if (existing > 0) setRequestProperty("Range", "bytes=$existing-")
            }
            val code = conn.responseCode
            if (code in 301..308 && code != 304) {
                val loc = conn.getHeaderField("Location") ?: throw java.io.IOException("Redirect tanpa Location")
                conn.disconnect()
                if (++redirects > 5) throw java.io.IOException("Terlalu banyak redirect")
                val next = URL(url, loc)
                if (next.protocol != "https") throw java.io.IOException("Redirect non-HTTPS ditolak")
                url = next; continue
            }
            if (code == 416) {            // Range tidak valid -> mulai ulang dari awal
                conn.disconnect(); part.delete(); existing = 0; continue
            }
            if (code == 401 || code == 403) { conn.disconnect(); throw IllegalStateException("Akses ditolak ($code). Periksa token Hugging Face.") }
            if (code != 200 && code != 206) { conn.disconnect(); throw IllegalStateException("Server membalas HTTP $code") }
            break
        }
        val c = conn!!
        val resumed = c.responseCode == 206
        if (!resumed) existing = 0
        val len = c.contentLengthLong
        t.total = if (len > 0) existing + len else 0
        if (t.total > MAX_BYTES) { c.disconnect(); throw IllegalStateException("Ukuran file terlalu besar") }
        val free = (part.parentFile ?: part).usableSpace
        if (t.total > 0 && t.total - existing + SAFETY > free) { c.disconnect(); throw IllegalStateException("Ruang penyimpanan tidak cukup") }

        RandomAccessFile(part, "rw").use { raf ->
            if (!resumed) raf.setLength(0)
            raf.seek(existing)
            t.bytes = existing
            val buf = ByteArray(64 * 1024)
            var winStart = SystemClock.elapsedRealtime(); var winBytes = 0L
            c.inputStream.use { input ->
                while (true) {
                    if (t.stop) break
                    val n = input.read(buf)
                    if (n < 0) break
                    raf.write(buf, 0, n)
                    t.bytes += n; winBytes += n
                    val now = SystemClock.elapsedRealtime()
                    if (now - winStart >= 1000) { t.speed = winBytes * 1000 / (now - winStart); winStart = now; winBytes = 0 }
                }
            }
        }
        c.disconnect()
        // Koneksi berakhir belum berarti selesai: ukuran diverifikasi di run().
    }

    private fun hasGgufMagic(f: File): Boolean = try {
        f.inputStream().use { val b = ByteArray(4); it.read(b) == 4 && String(b, Charsets.US_ASCII) == "GGUF" }
    } catch (_: Exception) { false }

    companion object {
        const val MAX_BYTES = 24L * 1024 * 1024 * 1024
        const val SAFETY = 64L * 1024 * 1024
    }
}
