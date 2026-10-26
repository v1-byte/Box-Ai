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
import java.net.URI
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Unduhan GGUF turbo: multi-koneksi, retry per-chunk, resume, progress real (byte/speed/ETA).
 */
class ModelDownloadService : Service() {

    data class JobState(
        val id: Long,
        val url: String,
        val name: String,
        val token: String,
        val bytes: AtomicLong = AtomicLong(0),
        val total: AtomicLong = AtomicLong(0),
        val speedBps: AtomicLong = AtomicLong(0),
        val activeParts: AtomicInteger = AtomicInteger(0),
        val retries: AtomicInteger = AtomicInteger(0),
        @Volatile var status: Int = STATUS_RUNNING,
        @Volatile var error: String = "",
        @Volatile var detail: String = "Menyiapkan…",
        @Volatile var finalUrl: String = "",
        val paused: AtomicBoolean = AtomicBoolean(false),
        val cancelled: AtomicBoolean = AtomicBoolean(false),
        val startedAt: Long = SystemClock.elapsedRealtime(),
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

        private const val BUF = 1024 * 1024 // 1MB
        private const val MAX_PARTS = 8
        private const val MAX_RETRY = 6

        val jobs = ConcurrentHashMap<Long, JobState>()
        private val idSeq = AtomicLong(900_000L)
        @Volatile var lastError: String = ""

        fun nextId(): Long = idSeq.incrementAndGet()

        fun modelsDir(ctx: Context): File =
            (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).also { it.mkdirs() }

        fun openConn(url: String, token: String, range: String? = null): HttpURLConnection {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.useCaches = false
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) BoxAI/2.2 Turbo")
            conn.setRequestProperty("Accept", "*/*")
            conn.setRequestProperty("Accept-Encoding", "identity")
            conn.setRequestProperty("Connection", "keep-alive")
            val host = runCatching { URI(url).host?.lowercase() }.getOrNull()
            if (token.isNotBlank() && host != null &&
                (host.contains("huggingface") || host == "hf.co" || host.contains("github") ||
                    host.contains("cdn-lfs") || host.contains("hf-mirror"))
            ) {
                conn.setRequestProperty("Authorization", "Bearer $token")
            }
            if (range != null) conn.setRequestProperty("Range", range)
            return conn
        }

        /** Follow redirects manually; keep token only on trusted hosts. */
        fun resolveUrl(url: String, token: String): String {
            var current = url
            repeat(12) {
                val c = openConn(current, token)
                c.requestMethod = "GET"
                c.setRequestProperty("Range", "bytes=0-0")
                try {
                    c.connect()
                    val code = c.responseCode
                    if (code in 300..399) {
                        val loc = c.getHeaderField("Location") ?: return current
                        current = if (loc.startsWith("http")) loc else URL(URL(current), loc).toString()
                        c.disconnect()
                        return@repeat
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

    private val pool = Executors.newFixedThreadPool(MAX_PARTS + 2)
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
            ch.description = "Progress unduhan GGUF Box AI (turbo)"
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
                job.detail = "Melanjutkan…"
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
        val notif = buildNotif(job, p)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(notifId, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(notifId, notif)
        }
    }

    private fun fmtSpeed(bps: Long): String {
        if (bps <= 0) return "—"
        return when {
            bps >= 1_000_000 -> String.format("%.1f MB/s", bps / 1_000_000.0)
            bps >= 1_000 -> String.format("%.0f KB/s", bps / 1_000.0)
            else -> "$bps B/s"
        }
    }

    private fun fmtBytes(n: Long): String {
        if (n <= 0) return "—"
        return when {
            n >= 1_073_741_824 -> String.format("%.2f GB", n / 1_073_741_824.0)
            n >= 1_048_576 -> String.format("%.1f MB", n / 1_048_576.0)
            else -> String.format("%.0f KB", n / 1024.0)
        }
    }

    private fun buildNotif(job: JobState, p: Int): Notification {
        val spd = fmtSpeed(job.speedBps.get())
        val title = when (job.status) {
            STATUS_PAUSED -> "Dijeda · $p%"
            STATUS_SUCCESSFUL -> "Selesai · ${job.name}"
            STATUS_FAILED -> "Gagal · ${job.error}"
            else -> "Turbo $p% · $spd"
        }
        val body = "${job.name} · ${fmtBytes(job.bytes.get())}/${fmtBytes(job.total.get())} · ${job.detail}"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOnlyAlertOnce(true)
            .setOngoing(job.status == STATUS_RUNNING)
            .setProgress(100, p, job.status == STATUS_RUNNING && p <= 0)
            .build()
    }

    private fun notify(job: JobState) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(notifId, buildNotif(job, pct(job)))
    }

    private fun stopIfIdle() {
        if (jobs.values.none { it.status == STATUS_RUNNING }) {
            stopForeground(STOP_FOREGROUND_DETACH)
            stopSelf()
        }
    }

    private fun runJob(job: JobState) {
        val dest = File(modelsDir(this), job.name)
        val part = File(modelsDir(this), job.name + ".part")
        try {
            job.detail = "Resolve CDN…"
            notify(job)
            val finalUrl = resolveUrl(job.url, job.token)
            job.finalUrl = finalUrl

            var total = 0L
            var acceptRanges = false
            job.detail = "Cek ukuran file…"
            notify(job)
            try {
                val head = openConn(finalUrl, job.token, "bytes=0-0")
                head.connect()
                val code = head.responseCode
                if (code in 300..399) {
                    // re-resolve once
                    head.disconnect()
                    val again = resolveUrl(finalUrl, job.token)
                    job.finalUrl = again
                } else if (code == 206) {
                    acceptRanges = true
                    val cr = head.getHeaderField("Content-Range")
                    if (cr != null && "/" in cr) {
                        total = cr.substringAfterLast("/").toLongOrNull() ?: 0L
                    }
                } else if (code in 200..299) {
                    total = head.contentLengthLong
                    val ar = head.getHeaderField("Accept-Ranges")
                    acceptRanges = ar != null && ar.contains("bytes", ignoreCase = true)
                } else if (code == 401 || code == 403) {
                    job.error = "HTTP $code (token/izin)"
                    lastError = job.error
                    job.status = STATUS_FAILED
                    job.detail = job.error
                    notify(job)
                    head.disconnect()
                    return
                } else {
                    job.error = "HTTP $code"
                    lastError = job.error
                    job.status = STATUS_FAILED
                    job.detail = job.error
                    notify(job)
                    head.disconnect()
                    return
                }
                head.disconnect()
            } catch (e: Exception) {
                job.detail = "Probe gagal, unduh stream tunggal…"
            }

            if (total <= 0L || !acceptRanges || total < 4L * 1024 * 1024) {
                singleStreamWithRetry(job, job.finalUrl.ifBlank { finalUrl }, dest, part)
                return
            }
            job.total.set(total)

            // Parallel turbo
            val n = when {
                total > 500L * 1024 * 1024 -> MAX_PARTS
                total > 100L * 1024 * 1024 -> 6
                else -> 4
            }
            job.detail = "Turbo $n koneksi…"
            if (part.exists() && part.length() != total) {
                // restart parallel file map
                part.delete()
            }
            if (dest.exists()) dest.delete()
            RandomAccessFile(part, "rw").use { raf ->
                try { raf.setLength(total) } catch (_: Exception) { }
            }
            job.bytes.set(0)

            val chunk = total / n
            val doneFlags = Array(n) { AtomicBoolean(false) }
            val futures = ArrayList<Future<*>>()
            val speedWindow = AtomicLong(0)
            val speedTick = AtomicLong(SystemClock.elapsedRealtime())

            // speed sampler
            val sample = pool.submit {
                var lastBytes = 0L
                var lastT = SystemClock.elapsedRealtime()
                while (job.status == STATUS_RUNNING && !job.cancelled.get() && !job.paused.get()) {
                    SystemClock.sleep(500)
                    val now = SystemClock.elapsedRealtime()
                    val b = job.bytes.get()
                    val dt = (now - lastT).coerceAtLeast(1)
                    val inst = ((b - lastBytes) * 1000L) / dt
                    job.speedBps.set(inst.coerceAtLeast(0))
                    lastBytes = b
                    lastT = now
                    val left = (job.total.get() - b).coerceAtLeast(0)
                    val eta = if (inst > 0) left / inst else -1
                    job.detail = "${job.activeParts.get()} jalur · ${fmtSpeed(inst)}" +
                        if (eta >= 0) " · sisa ~${eta}d" else ""
                    // fix typo seconds: use s
                    job.detail = "${job.activeParts.get()} jalur · ${fmtSpeed(inst)}" +
                        if (eta >= 0) " · ETA ${eta}s" else ""
                    notify(job)
                }
            }

            for (i in 0 until n) {
                val start = i * chunk
                val end = if (i == n - 1) total - 1 else (start + chunk - 1)
                futures += pool.submit {
                    downloadRangeRetry(job, job.finalUrl.ifBlank { finalUrl }, part, start, end, doneFlags[i])
                }
            }

            while (futures.any { !it.isDone }) {
                if (job.cancelled.get()) break
                if (job.paused.get()) {
                    job.status = STATUS_PAUSED
                    job.detail = "Dijeda"
                    notify(job)
                    futures.forEach { try { it.get() } catch (_: Exception) { } }
                    sample.cancel(true)
                    return
                }
                SystemClock.sleep(300)
            }
            futures.forEach { try { it.get() } catch (_: Exception) { } }
            sample.cancel(true)

            if (job.cancelled.get()) {
                job.status = STATUS_FAILED
                job.error = "dibatalkan"
                job.detail = "Dibatalkan"
                part.delete()
                notify(job)
                return
            }
            if (job.paused.get()) {
                job.status = STATUS_PAUSED
                notify(job)
                return
            }

            val ok = doneFlags.all { it.get() } && part.length() >= total
            if (!ok) {
                job.detail = "Fallback stream tunggal…"
                notify(job)
                singleStreamWithRetry(job, job.finalUrl.ifBlank { finalUrl }, dest, part)
                return
            }

            if (dest.exists()) dest.delete()
            if (!part.renameTo(dest)) {
                part.copyTo(dest, overwrite = true)
                part.delete()
            }
            job.bytes.set(dest.length())
            job.speedBps.set(0)
            job.status = STATUS_SUCCESSFUL
            job.detail = "Selesai ${fmtBytes(dest.length())}"
            notify(job)
            stopIfIdle()
        } catch (e: Exception) {
            if (job.paused.get()) {
                job.status = STATUS_PAUSED
                job.detail = "Dijeda"
            } else {
                job.error = e.message ?: "error"
                lastError = job.error
                job.status = STATUS_FAILED
                job.detail = "Gagal: ${job.error}"
            }
            notify(job)
            stopIfIdle()
        }
    }

    private fun downloadRangeRetry(
        job: JobState,
        url: String,
        part: File,
        start: Long,
        end: Long,
        done: AtomicBoolean,
    ) {
        var attempt = 0
        var cursor = start
        while (attempt < MAX_RETRY && !job.cancelled.get() && !job.paused.get()) {
            attempt++
            job.retries.incrementAndGet()
            try {
                job.activeParts.incrementAndGet()
                val conn = openConn(url, job.token, "bytes=$cursor-$end")
                conn.connect()
                val code = conn.responseCode
                if (code != 206 && code != 200) {
                    conn.disconnect()
                    SystemClock.sleep((300L * attempt))
                    continue
                }
                BufferedInputStream(conn.inputStream, BUF).use { input ->
                    RandomAccessFile(part, "rw").use { raf ->
                        raf.seek(cursor)
                        val buf = ByteArray(BUF)
                        val need = end - cursor + 1
                        var written = 0L
                        while (written < need) {
                            if (job.cancelled.get() || job.paused.get()) return
                            val n = input.read(buf, 0, minOf(buf.size.toLong(), need - written).toInt())
                            if (n < 0) break
                            raf.write(buf, 0, n)
                            written += n
                            cursor += n
                            job.bytes.addAndGet(n.toLong())
                        }
                    }
                }
                conn.disconnect()
                if (cursor > end) {
                    done.set(true)
                    return
                }
            } catch (_: Exception) {
                SystemClock.sleep((400L * attempt))
            } finally {
                job.activeParts.decrementAndGet()
            }
        }
        // last attempt failed — leave done=false for fallback
    }

    private fun singleStreamWithRetry(job: JobState, url: String, dest: File, part: File) {
        var attempt = 0
        while (attempt < MAX_RETRY && !job.cancelled.get() && !job.paused.get()) {
            attempt++
            job.retries.incrementAndGet()
            try {
                var existing = if (part.exists()) part.length() else 0L
                if (existing > 0) job.bytes.set(existing)
                job.detail = "Stream #${attempt} · ${fmtBytes(existing)}…"
                notify(job)
                val conn = openConn(url, job.token, if (existing > 0) "bytes=$existing-" else null)
                conn.connect()
                val code = conn.responseCode
                if (code !in 200..299 && code != 206) {
                    conn.disconnect()
                    SystemClock.sleep(500L * attempt)
                    continue
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
                job.activeParts.set(1)
                var lastBytes = job.bytes.get()
                var lastT = SystemClock.elapsedRealtime()
                BufferedInputStream(conn.inputStream, BUF).use { input ->
                    FileOutputStream(part, existing > 0 && code == 206).use { out ->
                        val buf = ByteArray(BUF)
                        while (true) {
                            if (job.cancelled.get()) {
                                job.status = STATUS_FAILED
                                job.detail = "Dibatalkan"
                                return
                            }
                            if (job.paused.get()) {
                                job.status = STATUS_PAUSED
                                job.detail = "Dijeda"
                                notify(job)
                                return
                            }
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            job.bytes.addAndGet(n.toLong())
                            job.status = STATUS_RUNNING
                            val now = SystemClock.elapsedRealtime()
                            if (now - lastT >= 400) {
                                val dt = (now - lastT).coerceAtLeast(1)
                                val inst = ((job.bytes.get() - lastBytes) * 1000L) / dt
                                job.speedBps.set(inst.coerceAtLeast(0))
                                lastBytes = job.bytes.get()
                                lastT = now
                                val left = (job.total.get() - job.bytes.get()).coerceAtLeast(0)
                                val eta = if (inst > 0) left / inst else -1
                                job.detail = "1 jalur · ${fmtSpeed(inst)}" +
                                    if (eta >= 0) " · ETA ${eta}s" else ""
                                notify(job)
                            }
                        }
                        out.flush()
                    }
                }
                conn.disconnect()
                job.activeParts.set(0)

                if (job.cancelled.get()) {
                    job.status = STATUS_FAILED
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
                job.speedBps.set(0)
                job.status = STATUS_SUCCESSFUL
                job.detail = "Selesai ${fmtBytes(dest.length())}"
                notify(job)
                stopIfIdle()
                return
            } catch (e: Exception) {
                job.detail = "Retry ${attempt}/${MAX_RETRY}: ${e.message ?: "error"}"
                notify(job)
                SystemClock.sleep(600L * attempt)
            }
        }
        if (!job.paused.get() && !job.cancelled.get()) {
            job.error = "Gagal setelah $MAX_RETRY percobaan"
            lastError = job.error
            job.status = STATUS_FAILED
            job.detail = job.error
            notify(job)
            stopIfIdle()
        }
    }

    override fun onDestroy() {
        pool.shutdownNow()
        super.onDestroy()
    }
}
