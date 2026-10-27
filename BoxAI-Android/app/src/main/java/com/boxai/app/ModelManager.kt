package com.boxai.app

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile

/** Katalog model GGUF: folder app + folder SAF yang diizinkan. Menghapus/ganti nama hanya untuk file valid. */
class ModelManager(private val ctx: Context, private val workspace: WorkspaceManager) {
    val modelsDir: File = (ctx.getExternalFilesDir("models") ?: File(ctx.filesDir, "models")).apply { mkdirs() }

    fun list(): String {
        val arr = JSONArray()
        modelsDir.listFiles()?.filter { it.isFile && it.name.endsWith(".gguf", true) }?.sortedBy { it.name }?.forEach {
            arr.put(JSONObject().put("name", it.name).put("size", it.length()).put("path", it.absolutePath).put("source", "local"))
        }
        return arr.toString()
    }

    fun listDeep(): String {
        val arr = JSONArray(list())
        for (t in workspace.trees()) {
            for (d in workspace.walkTree(t, 3, 200) { it.name.endsWith(".gguf", true) }) {
                arr.put(JSONObject().put("name", d.name).put("size", d.size).put("path", d.uri).put("source", "external"))
            }
        }
        return arr.toString()
    }

    fun scanDebug(): String =
        JSONObject().put("treeAccess", workspace.treeCount()).put("appModels", modelsDir.listFiles()?.size ?: 0).toString()

    /** Hasil resolusi: path yang dapat dibuka native + pfd (bila perlu) yang harus ditutup setelah model dilepas. */
    class Resolved(val path: String, val pfd: ParcelFileDescriptor?, val display: String)

    fun resolve(file: String): Resolved? {
        if (file.isBlank() || file.length > 2048) return null
        if (file.startsWith("content://")) {
            val uri = Uri.parse(file)
            if (!workspace.allowedContent(uri)) return null
            val pfd = try { ctx.contentResolver.openFileDescriptor(uri, "r") } catch (_: Exception) { null } ?: return null
            return Resolved("/proc/self/fd/${pfd.fd}", pfd, file.substringAfterLast('/'))
        }
        val f = if (file.startsWith("/")) File(file) else File(modelsDir, file)
        val canon = try { f.canonicalFile } catch (_: Exception) { return null }
        if (!canon.path.startsWith(modelsDir.canonicalPath + File.separator)) return null
        if (!canon.isFile) return null
        return Resolved(canon.path, null, canon.name)
    }

    /** Validasi dasar: ukuran > 0 dan magic "GGUF". */
    fun validate(r: Resolved): String? {
        return try {
            val magic = ByteArray(4)
            if (r.pfd != null) {
                java.io.FileInputStream(r.pfd.fileDescriptor).use { if (it.read(magic) != 4) return "File terlalu kecil" }
            } else {
                RandomAccessFile(r.path, "r").use { if (it.length() < 1024) return "File terlalu kecil"; it.readFully(magic) }
            }
            if (String(magic, Charsets.US_ASCII) != "GGUF") "Bukan file GGUF yang valid" else null
        } catch (e: Exception) { "File tidak dapat dibaca" }
    }

    fun delete(file: String): Boolean {
        if (file.startsWith("content://")) {
            val uri = Uri.parse(file)
            if (!workspace.allowedContent(uri)) return false
            return try { DocumentsContract.deleteDocument(ctx.contentResolver, uri) } catch (_: Exception) { false }
        }
        val f = managedFile(file) ?: return false
        return f.delete()
    }

    fun rename(oldName: String, newName: String): Boolean {
        if (!validName(newName)) return false
        val src = managedFile(oldName) ?: return false
        val dst = File(modelsDir, newName)
        if (dst.exists()) return false
        return src.renameTo(dst)
    }

    /** 128 byte pertama sebagai hex (huruf kecil), "" bila gagal. */
    fun head(file: String): String {
        return try {
            val buf = ByteArray(128)
            val n: Int
            if (file.startsWith("content://")) {
                val uri = Uri.parse(file)
                if (!workspace.allowedContent(uri)) return ""
                n = ctx.contentResolver.openInputStream(uri)?.use { it.read(buf) } ?: return ""
            } else {
                val f = managedFile(file) ?: return ""
                n = f.inputStream().use { it.read(buf) }
            }
            if (n <= 0) "" else buf.take(n).joinToString("") { "%02x".format(it) }
        } catch (_: Exception) { "" }
    }

    private fun managedFile(file: String): File? {
        val f = if (file.startsWith("/")) File(file) else File(modelsDir, file)
        val c = try { f.canonicalFile } catch (_: Exception) { return null }
        return if (c.path.startsWith(modelsDir.canonicalPath + File.separator) && c.isFile) c else null
    }

    companion object {
        private val NAME_RE = Regex("^[A-Za-z0-9][A-Za-z0-9._\\-()\\[\\] ]{0,175}\\.gguf$")
        fun validName(n: String) = NAME_RE.matches(n) && !n.contains("..")
    }
}
