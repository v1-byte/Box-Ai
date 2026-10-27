package com.boxai.app

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Workspace file: folder privat aplikasi + folder yang diberi izin pengguna lewat SAF.
 * Tidak ada akses ke path lain. Path traversal ditolak lewat canonicalPath.
 */
class WorkspaceManager(private val ctx: Context) {
    private val cr: ContentResolver get() = ctx.contentResolver
    val workspaceDir: File = File(ctx.filesDir, "workspace").apply { mkdirs() }

    // ---------- Izin folder (SAF) ----------
    fun persistTree(uri: Uri): Boolean {
        return try {
            cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            true
        } catch (_: Exception) {
            try { cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); true } catch (_: Exception) { false }
        }
    }

    fun trees(): List<Uri> = cr.persistedUriPermissions.filter { it.isReadPermission && DocumentsContract.isTreeUri(it.uri) }.map { it.uri }
    fun treeCount(): Int = trees().size

    // ---------- Daftar file ----------
    data class Doc(val name: String, val size: Long, val mod: Long, val uri: String, val isDir: Boolean, val mime: String)

    private fun children(tree: Uri, parentDocId: String): List<Doc> {
        val childUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId)
        val out = ArrayList<Doc>()
        val proj = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )
        try {
            cr.query(childUri, proj, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val id = c.getString(0)
                    val mime = c.getString(4) ?: ""
                    out.add(
                        Doc(
                            c.getString(1) ?: "", if (c.isNull(2)) 0 else c.getLong(2), if (c.isNull(3)) 0 else c.getLong(3),
                            DocumentsContract.buildDocumentUriUsingTree(tree, id).toString(),
                            mime == DocumentsContract.Document.MIME_TYPE_DIR, mime
                        )
                    )
                }
            }
        } catch (_: Exception) { }
        return out
    }

    /** Telusuri pohon dengan batas kedalaman dan jumlah. */
    fun walkTree(tree: Uri, maxDepth: Int, maxItems: Int, filter: (Doc) -> Boolean): List<Doc> {
        val result = ArrayList<Doc>()
        fun rec(docId: String, depth: Int) {
            if (depth > maxDepth || result.size >= maxItems) return
            for (d in children(tree, docId)) {
                if (result.size >= maxItems) return
                if (d.isDir) {
                    val id = DocumentsContract.getDocumentId(Uri.parse(d.uri))
                    rec(id, depth + 1)
                } else if (filter(d)) result.add(d)
            }
        }
        rec(DocumentsContract.getTreeDocumentId(tree), 0)
        return result
    }

    fun listFiles(): String {
        val arr = JSONArray()
        workspaceDir.listFiles()?.filter { it.isFile }?.sortedBy { it.name }?.forEach {
            arr.put(entry(it.name, it.length(), it.lastModified(), Uri.fromFile(it).toString(), isText(it.name, it.length())))
        }
        for (t in trees()) {
            for (d in walkTree(t, 2, 300) { true }) {
                if (arr.length() >= MAX_LIST) break
                arr.put(entry(d.name, d.size, d.mod, d.uri, isText(d.name, d.size)))
            }
        }
        return arr.toString()
    }

    private fun entry(name: String, size: Long, mod: Long, uri: String, text: Boolean) =
        JSONObject().put("name", name).put("size", size).put("mod", mod).put("uri", uri).put("text", text)

    // ---------- Baca/tulis teks ----------
    fun readText(uriStr: String): String? {
        if (uriStr.length > 2048) return null
        val uri = Uri.parse(uriStr)
        return try {
            if (uri.scheme == "file") {
                val f = inWorkspace(uri) ?: return null
                if (!f.isFile || f.length() > MAX_TEXT) return null
                f.readText(Charsets.UTF_8)
            } else if (uri.scheme == "content" && allowedContent(uri)) {
                cr.openInputStream(uri)?.use { readLimited(it, MAX_TEXT + 1) }?.let {
                    if (it.size > MAX_TEXT) null else String(it, Charsets.UTF_8)
                }
            } else null
        } catch (_: Exception) { null }
    }

    fun writeText(uriStr: String, text: String): Boolean {
        if (uriStr.length > 2048 || text.length > MAX_TEXT) return false
        val uri = Uri.parse(uriStr)
        return try {
            if (uri.scheme == "file") {
                val f = inWorkspace(uri) ?: return false
                f.writeText(text, Charsets.UTF_8); true
            } else if (uri.scheme == "content" && allowedContent(uri)) {
                cr.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) } != null
            } else false
        } catch (_: Exception) { false }
    }

    private fun inWorkspace(uri: Uri): File? {
        val f = File(uri.path ?: return null).canonicalFile
        val root = workspaceDir.canonicalFile
        return if (f.path.startsWith(root.path + File.separator)) f else null
    }

    /** Hanya URI di bawah folder SAF yang sudah diberi izin. */
    fun allowedContent(uri: Uri): Boolean {
        val auth = uri.authority ?: return false
        val docId = try { DocumentsContract.getDocumentId(uri) } catch (_: Exception) { return false }
        return trees().any { t ->
            t.authority == auth && docId.startsWith(DocumentsContract.getTreeDocumentId(t))
        }
    }

    private fun readLimited(input: java.io.InputStream, limit: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < limit) {
            val n = input.read(buf, 0, minOf(buf.size, limit - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    companion object {
        const val MAX_TEXT = 1_000_000
        const val MAX_LIST = 600
        private val TEXT_EXT = setOf("txt", "md", "json", "csv", "log", "yaml", "yml", "xml", "html", "css", "js", "kt", "py", "ini", "cfg", "toml")
        fun isText(name: String, size: Long) = size <= MAX_TEXT && name.substringAfterLast('.', "").lowercase() in TEXT_EXT
    }
}
