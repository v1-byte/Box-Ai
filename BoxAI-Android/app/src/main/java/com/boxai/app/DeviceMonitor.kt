package com.boxai.app

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import org.json.JSONObject
import java.io.File

/**
 * Info perangkat nyata dari API Android. Nilai yang tak tersedia dikirim null / dihilangkan.
 *
 * Catatan CPU: sejak Android 8, aplikasi tidak boleh membaca /proc/stat. cpuBusy/cpuTotal di sini
 * adalah beban proses Box AI sendiri (waktu CPU proses / waktu nyata x jumlah core).
 */
class DeviceMonitor(private val ctx: Context) {
    private val cores = Runtime.getRuntime().availableProcessors()

    fun thermalStatus(): Int =
        if (Build.VERSION.SDK_INT >= 29) {
            try { (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).currentThermalStatus } catch (_: Exception) { 0 }
        } else 0

    fun batteryTempC(): Double? {
        val i: Intent? = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val t = i?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
        return if (t == Int.MIN_VALUE) null else t / 10.0
    }

    private fun memInfo(): ActivityManager.MemoryInfo =
        ActivityManager.MemoryInfo().also { (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(it) }

    fun availMem(): Long = memInfo().availMem

    /** Jumlah thread inferensi yang disarankan, dikurangi saat perangkat hangat/panas. */
    fun recommendedThreads(): Int {
        val base = (cores / 2).coerceIn(2, 6)
        return when (thermalStatus()) {
            0, 1 -> base
            2 -> (base * 3 / 4).coerceAtLeast(2)
            3 -> (base / 2).coerceAtLeast(1)
            else -> 1
        }
    }

    /** Batas konteks aman berdasarkan RAM total (UI membatasi S.ctx ke nilai ini). */
    fun recommendedContext(): Int {
        val gb = memInfo().totalMem / 1073741824.0
        val base = when {
            gb >= 11 -> 8192
            gb >= 7 -> 4096
            gb >= 5 -> 2048
            else -> 1024
        }
        return when (thermalStatus()) { 3 -> minOf(base, 2048); in 4..6 -> minOf(base, 1024); else -> base }
    }

    fun info(): String {
        val mi = memInfo()
        val stat = try { StatFs(Environment.getDataDirectory().path) } catch (_: Exception) { null }
        return JSONObject().apply {
            put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("cores", cores)
            put("ram", mi.totalMem)
            put("free", stat?.availableBytes ?: 0L)
            put("cache", dirSize(ctx.cacheDir) + (ctx.externalCacheDir?.let { dirSize(it) } ?: 0L))
            put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
            put("sdk", Build.VERSION.SDK_INT)
        }.toString()
    }

    fun thermalInfo(): String {
        val s = thermalStatus()
        return JSONObject().apply {
            put("status", s)
            put("label", arrayOf("normal", "light", "moderate", "severe", "critical", "emergency", "shutdown").getOrElse(s) { "normal" })
            put("source", if (Build.VERSION.SDK_INT >= 29) "PowerManager" else "unavailable")
            put("batteryTempC", batteryTempC() ?: JSONObject.NULL)
            put("active", s >= 2)
        }.toString()
    }

    fun deviceStats(): String {
        val mi = memInfo()
        return JSONObject().apply {
            put("cpuBusy", Process.getElapsedCpuTime())
            put("cpuTotal", SystemClock.elapsedRealtime() * cores)
            put("ramFree", mi.availMem)
            put("ramTotal", mi.totalMem)
            put("batteryTempC", batteryTempC() ?: JSONObject.NULL)
            put("thermalStatus", thermalStatus())
        }.toString()
    }

    /** "Cooling pulse": hanya tindakan software aman (GC ringan). Tidak menurunkan suhu secara ajaib. */
    fun coolDown(): String {
        System.gc()
        return thermalInfo()
    }

    companion object {
        fun dirSize(f: File?): Long {
            if (f == null || !f.exists()) return 0
            if (f.isFile) return f.length()
            return f.listFiles()?.sumOf { dirSize(it) } ?: 0L
        }
    }
}
