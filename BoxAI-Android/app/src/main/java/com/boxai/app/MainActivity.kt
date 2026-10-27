package com.boxai.app

import android.app.AlertDialog
import android.net.Uri
import android.os.Bundle
import android.content.Intent
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import android.widget.FrameLayout

class MainActivity : android.app.Activity() {
    private lateinit var webView: WebView
    private var bridge: BoxNativeBridge? = null
    private var pendingTree: ((Boolean) -> Unit)? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var lastBack = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebViewConfig.appContextHolder = applicationContext

        webView = WebView(this)
        setContentView(FrameLayout(this).apply { addView(webView, FrameLayout.LayoutParams(-1, -1)) })
        WebViewConfig.apply(webView)
        webView.webViewClient = WebViewConfig.client { msg -> showLoadError(msg) }

        webView.webChromeClient = object : WebChromeClient() {
            // Tanpa ini, <input type="file"> (Foto/Kamera/File di Chat) tidak melakukan apa-apa.
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    @Suppress("DEPRECATION") startActivityForResult(params.createIntent(), REQ_FILE)
                    true
                } catch (_: Exception) {
                    fileCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }

        bridge = BoxNativeBridge(this, webView) { cb -> launchTreePicker(cb) }
        webView.addJavascriptInterface(bridge!!, "BoxNative")

        if (savedInstanceState != null) webView.restoreState(savedInstanceState)
        else webView.loadUrl(WebViewConfig.START_URL)
    }

    // --- Akses folder (Storage Access Framework) ---
    private fun launchTreePicker(cb: (Boolean) -> Unit) {
        pendingTree = cb
        try {
            val i = android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    android.content.Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
            @Suppress("DEPRECATION") startActivityForResult(i, REQ_TREE)
        } catch (_: Exception) {
            pendingTree = null
            cb(false)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        if (requestCode != REQ_TREE) return
        val cb = pendingTree; pendingTree = null
        val uri: Uri? = if (resultCode == RESULT_OK) data?.data else null
        if (uri == null) { cb?.invoke(false); return }
        val ok = bridge?.workspace?.persistTree(uri) ?: false
        cb?.invoke(ok)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 1) Bila ada sheet/dialog terbuka, tutup lewat Escape (ditangani UI). 2) Selain itu, tekan dua kali untuk keluar.
        webView.evaluateJavascript(
            "(function(){var s=document.getElementById('sheet');if(s&&!s.hidden){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return true}return false})()"
        ) { r ->
            if (r == "true") return@evaluateJavascript
            val now = System.currentTimeMillis()
            if (now - lastBack < 1800) finish()
            else { lastBack = now; Toast.makeText(this, "Tekan lagi untuk keluar", Toast.LENGTH_SHORT).show() }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onPause() { super.onPause(); webView.onPause() }
    override fun onResume() { super.onResume(); webView.onResume() }

    override fun onDestroy() {
        bridge?.shutdown()
        webView.removeJavascriptInterface("BoxNative")
        webView.destroy()
        super.onDestroy()
    }

    private fun showLoadError(msg: String) {
        runOnUiThread {
            if (isFinishing) return@runOnUiThread
            AlertDialog.Builder(this)
                .setTitle("Box AI gagal memuat UI")
                .setMessage(msg)
                .setPositiveButton("Coba lagi") { _, _ -> webView.loadUrl(WebViewConfig.START_URL) }
                .setNegativeButton("Tutup") { _, _ -> finish() }
                .show()
        }
    }

    private companion object { const val REQ_TREE = 4401; const val REQ_FILE = 4402 }
}
