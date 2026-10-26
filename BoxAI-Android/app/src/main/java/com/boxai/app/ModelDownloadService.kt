package com.boxai.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Unduhan model GGUF cepat (multi-koneksi) + notifikasi foreground
 * agar tetap jalan saat app di-minimize.
 */
class ModelDownloadService : Service() {

    data class JobState(
        val id: Long,
        val url: String,
        val name: String,
        val token: String,
        val bytes: AtomicLong = AtomicLong(0),
        val total: AtomicLong = AtomicLong(0),
        @Volatile var status: Int = STATUS_RUNNING,
        @Volatile var error: String = "",
        val paused: AtomicBoolean = AtomicBoolean(false),
        val cancelled: AtomicBoolean = AtomicBoolean(false),
    )

    companion object {
        const val CHANNEL_ID = "boxai_downloads"
        const val STATUS_PENDING = 1
        const val STATUS_RUNNING = 2
        const val STATUS_PAUSED = 4
        const val STATUS_SUCCESSFUL = 8
        const val STATUS_FAILED = 16

        const val ACTION_START = "com.boxai.app.DL_START"
        const val ACTION_PAUSE = "com.boxai.app.DL_PAUSE"
        const val ACTION_RESUME = "com.boxai.app.DL_RESUME"
        const val ACTION_CANCEL = "com.boxai.app.DL_CANCEL"

        val jobs = ConcurrentHashMap<Long, JobState>()
        private val idSeq = AtomicLong(900_000L)
        @Volatile var lastError: String = ""

        fun nextId(): Long = idSeq.incrementAndGet()

        fun modelsDir(ctx: Context): File =
            (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).also { it.mkdirs() }

        fun openConn(url: String, token: String, range: String? = null): HttpURLConnection {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 30_000
            conn.readTimeout = 120_000
            conn.useCaches = false
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) BoxAI/2.2")
            conn.setRequestProperty("Accept", "*/*")
            conn.setRequestProperty("Accept-Encoding", "identity")
            val host = runCatching { URI(url).host?.lowercase() }.getOrNull()
            if (token.isNotBlank() && host in setOf("huggingface.co", "hf.co", "github.com")) {
                conn.setRequestProperty("Authorization", "Bearer $token")
            }
            if (range != null) conn.setRequestProperty("Range", range)
            return conn
        }

        /** Resolve redirect chain once (CDN final URL often faster). */
        fun resolveUrl(url: String, token: String): String {
            var current = url
            repeat(8) {
                val c = openConn(current, token)
                c.requestMethod = "HEAD"
                try {
                    c.connect()
                    val code = c.responseCode
                    if (code in 300..399) {
                        val loc = c.getHeaderField("Location") ?: return current
                        val next = if (loc.startsWith("http")) loc else URL(URL(current), loc).toString()
                        val nextUri = runCatching { URI(next) }.getOrNull()
                        if (nextUri?.scheme?.lowercase() != "https" || nextUri.host.isNullOrBlank()) return current
                        current = next
                        c.disconnect()
                        return@repeat
                    }
                    // Some servers reject HEAD — fall back
                    if (code == 405 || code == 501) {
                        c.disconnect()
                        return current
                    }
                    c.disconnect()
                    return current
                } catch (_: Exception) {
                    return current
                }
            }
            return current
        }
    }

    private val pool = Executors.newFixedThreadPool(6)
    private var notifId = 42

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            val ch = NotificationChannel(CHANNEL_ID, "Unduhan model", NotificationManager.IMPORTANCE_LOW)
            ch.description = "Progress unduhan GGUF Box AI"
            nm.createNotificationChannel(ch)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val id = intent.getLongExtra("id", -1L)
                val url = intent.getStringExtra("url") ?: return START_NOT_STICKY
                val name = intent.getStringExtra("name") ?: return START_NOT_STICKY
                val token = intent.getStringExtra("token") ?: ""
                val job = JobState(id, url, name, token)
                jobs[id] = job
                startFg(job, 0)
                pool.execute { runJob(job) }
            }
            ACTION_PAUSE -> {
                val id = intent.getLongExtra("id", -1L)
                jobs[id]?.paused?.set(true)
            }
            ACTION_RESUME -> {
                val id = intent.getLongExtra("id", -1L)
                val job = jobs[id] ?: return START_STICKY
                job.paused.set(false)
                job.cancelled.set(false)
                job.status = STATUS_RUNNING
                job.error = ""
                startFg(job, pct(job))
                pool.execute { runJob(job) }
            }
            ACTION_CANCEL -> {
                val id = intent.getLongExtra("id", -1L)
                val job = jobs[id]
                job?.cancelled?.set(true)
                job?.paused?.set(false)
                jobs.remove(id)
                stopIfIdle()
            }
        }
        return START_STICKY
    }

    private fun pct(job: JobState): Int {
        val t = job.total.get()
        val b = job.bytes.get()
        return if (t > 0) ((b * 100) / t).toInt().coerceIn(0, 100) else 0
    }

    private fun startFg(job: JobState, p: Int) {
        val notif = buildNotif(job.name, p, job.status)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(notifId, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(notifId, notif)
        }
    }

    private fun buildNotif(name: String, p: Int, status: Int): Notification {
        val title = when (status) {
            STATUS_PAUSED -> "Dijeda · $p%"
            STATUS_SUCCESSFUL -> "Selesai"
            STATUS_FAILED -> "Gagal"
            else -> "Mengunduh $p%"
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(name)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOnlyAlertOnce(true)
            .setOngoing(status == STATUS_RUNNING)
            .setProgress(100, p, status == STATUS_RUNNING && p <= 0)
            .build()
    }

    private fun notify(job: JobState) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(notifId, buildNotif(job.name, pct(job), job.status))
    }

    private fun stopIfIdle() {
        if (jobs.values.none { it.status == STATUS_RUNNING }) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun runJob(job: JobState) {
        val dest = File(modelsDir(this), job.name)
        val part = File(modelsDir(this), job.name + ".part")
        try {
            val finalUrl = resolveUrl(job.url, job.token)
            // Probe size + ranges
            var total = 0L
            var acceptRanges = false
            try {
                val head = openConn(finalUrl, job.token)
                head.requestMethod = "GET"
                head.setRequestProperty("Range", "bytes=0-0")
                head.connect()
                val code = head.responseCode
                if (code == 206) {
                    acceptRanges = true
                    val cr = head.getHeaderField("Content-Range") // bytes 0-0/12345
                    if (cr != null && "/" in cr) {
                        total = cr.substringAfterLast("/").toLongOrNull() ?: 0L
                    }
                } else if (code in 200..299) {
                    total = head.contentLengthLong
                } else {
                    job.error = "HTTP $code"
                    lastError = job.error
                    job.status = STATUS_FAILED
                    notify(job)
                    jobs.remove(job.id)
                    stopIfIdle()
                    head.disconnect()
                    return
                }
                head.disconnect()
            } catch (_: Exception) { }

            if (total <= 0) {
                // single stream fallback
                singleStream(job, finalUrl, dest, part)
                return
            }
            job.total.set(total)

            val existing = if (part.exists()) part.length() else 0L
            // Resume single-stream if partial without multi-part index
            if (existing > 0 && existing < total && !acceptRanges) {
                singleStream(job, finalUrl, dest, part)
                return
            }

            if (!acceptRanges || total < 8L * 1024 * 1024) {
                singleStream(job, finalUrl, dest, part)
                return
            }

            // Parallel ranges (4–6 connections)
            val n = if (total > 200L * 1024 * 1024) 6 else 4
            // Fresh parallel: rewrite part file
            if (part.exists()) part.delete()
            if (dest.exists()) dest.delete()
            RandomAccessFile(part, "rw").use { raf ->
                try { raf.setLength(total) } catch (_: Exception) { }
            }
            job.bytes.set(0)
            val chunk = total / n
            val futures = ArrayList<Future<*>>()
            val failed = AtomicBoolean(false)
            for (i in 0 until n) {
                val start = i * chunk
                val end = if (i == n - 1) total - 1 else (start + chunk - 1)
                futures += pool.submit {
                    downloadRange(job, finalUrl, part, start, end, failed)
                }
            }
            // Progress notifier
            while (futures.any { !it.isDone }) {
                if (job.cancelled.get()) break
                if (job.paused.get()) {
                    job.status = STATUS_PAUSED
                    notify(job)
                    // wait until threads notice pause
                    futures.forEach { try { it.get() } catch (_: Exception) { } }
                    return
                }
                notify(job)
                SystemClock.sleep(400)
            }
            futures.forEach { try { it.get() } catch (_: Exception) { } }

            if (job.cancelled.get()) {
                job.status = STATUS_FAILED
                job.error = "dibatalkan"
                part.delete()
                jobs.remove(job.id)
                notify(job)
                stopIfIdle()
                return
            }
            if (job.paused.get()) {
                job.status = STATUS_PAUSED
                notify(job)
                return
            }
            if (failed.get() || part.length() < total) {
                // fallback complete with single stream if parallel incomplete
                singleStream(job, finalUrl, dest, part)
                return
            }
            if (dest.exists()) dest.delete()
            if (!part.renameTo(dest)) {
                part.copyTo(dest, overwrite = true)
                part.delete()
            }
            job.bytes.set(dest.length())
            job.status = STATUS_SUCCESSFUL
            notify(job)
            stopIfIdle()
        } catch (e: Exception) {
            if (job.paused.get()) {
                job.status = STATUS_PAUSED
            } else {
                job.error = e.message ?: "error"
                lastError = job.error
                job.status = STATUS_FAILED
            }
            notify(job)
            stopIfIdle()
        }
    }

    private fun downloadRange(
        job: JobState,
        url: String,
        part: File,
        start: Long,
        end: Long,
        failed: AtomicBoolean,
    ) {
        try {
            val conn = openConn(url, job.token, "bytes=$start-$end")
            conn.connect()
            val code = conn.responseCode
            if (code != 206 && code != 200) {
                failed.set(true)
                conn.disconnect()
                return
            }
            BufferedInputStream(conn.inputStream, 256 * 1024).use { input ->
                RandomAccessFile(part, "rw").use { raf ->
                    raf.seek(start)
                    val buf = ByteArray(512 * 1024)
                    var written = 0L
                    val need = end - start + 1
                    while (written < need) {
                        if (job.cancelled.get() || job.paused.get()) return
                        val n = input.read(buf, 0, minOf(buf.size.toLong(), need - written).toInt())
                        if (n < 0) break
                        raf.write(buf, 0, n)
                        written += n
                        job.bytes.addAndGet(n.toLong())
                    }
                }
            }
            conn.disconnect()
        } catch (_: Exception) {
            failed.set(true)
        }
    }

    private fun singleStream(job: JobState, url: String, dest: File, part: File) {
        try {
            var existing = if (part.exists()) part.length() else 0L
            if (existing > 0) job.bytes.set(existing)
            val conn = openConn(url, job.token, if (existing > 0) "bytes=$existing-" else null)
            conn.connect()
            val code = conn.responseCode
            if (code !in 200..299 && code != 206) {
                job.error = "HTTP $code"
                lastError = job.error
                job.status = STATUS_FAILED
                notify(job)
                jobs.remove(job.id)
                stopIfIdle()
                return
            }
            val reported = conn.contentLengthLong
            if (code == 206) {
                if (reported > 0) job.total.set(existing + reported)
            } else {
                existing = 0
                if (part.exists()) part.delete()
                job.bytes.set(0)
                if (reported > 0) job.total.set(reported)
            }
            BufferedInputStream(conn.inputStream, 256 * 1024).use { input ->
                FileOutputStream(part, existing > 0 && code == 206).use { out ->
                    val buf = ByteArray(512 * 1024)
                    var lastNotif = 0L
                    while (true) {
                        if (job.cancelled.get()) {
                            job.status = STATUS_FAILED
                            return
                        }
                        if (job.paused.get()) {
                            job.status = STATUS_PAUSED
                            notify(job)
                            return
                        }
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        job.bytes.addAndGet(n.toLong())
                        job.status = STATUS_RUNNING
                        val now = SystemClock.elapsedRealtime()
                        if (now - lastNotif > 500) {
                            notify(job)
                            lastNotif = now
                        }
                    }
                    out.flush()
                }
            }
            if (job.cancelled.get()) {
                job.status = STATUS_FAILED
                jobs.remove(job.id)
                stopIfIdle()
                return
            }
            if (job.paused.get()) {
                job.status = STATUS_PAUSED
                notify(job)
                return
            }
            if (dest.exists()) dest.delete()
            if (!part.renameTo(dest)) {
                part.copyTo(dest, overwrite = true)
                part.delete()
            }
            job.bytes.set(dest.length())
            if (job.total.get() <= 0) job.total.set(job.bytes.get())
            job.status = STATUS_SUCCESSFUL
            notify(job)
            stopIfIdle()
        } catch (e: Exception) {
            if (job.paused.get()) job.status = STATUS_PAUSED
            else {
                job.error = e.message ?: "error"
                lastError = job.error
                job.status = STATUS_FAILED
            }
            notify(job)
            stopIfIdle()
        }
    }

    override fun onDestroy() {
        pool.shutdownNow()
        super.onDestroy()
    }
}
