package com.boxai.app

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * Konfigurasi WebView yang ketat.
 *
 * UI dimuat dari https://appassets.androidplatform.net/assets/www/index.html (WebViewAssetLoader,
 * isi tetap dari folder assets/www). Ini dipilih daripada file:///android_asset karena:
 *  - CSP bawaan UI memakai script-src 'self', yang andal hanya pada origin http(s);
 *  - localStorage (kunci boxai.v3) punya origin stabil;
 *  - akses file:// dimatikan sepenuhnya.
 */
object WebViewConfig {
    const val HOST = "appassets.androidplatform.net"
    const val START_URL = "https://$HOST/assets/www/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    fun apply(webView: WebView) {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportZoom(false)
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        webView.setBackgroundColor(0xFF08090C.toInt())
        webView.overScrollMode = WebView.OVER_SCROLL_NEVER
    }

    fun client(onLoadError: (String) -> Unit): WebViewClient {
        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(appContextHolder!!))
            .build()
        return object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isLocal(uri)) return false
                // Navigasi keluar dibuka di browser, bukan di WebView yang punya bridge.
                if (uri.scheme == "https") {
                    try {
                        view.context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (_: Exception) { }
                }
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                // Hindari crash seluruh aplikasi bila proses render WebView mati (mis. kehabisan memori).
                onLoadError("Proses tampilan berhenti (memori rendah?). Ketuk Coba lagi.")
                return true
            }

            @Deprecated("Deprecated in Java")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (failingUrl != null && isLocal(Uri.parse(failingUrl))) onLoadError(description ?: "error $errorCode")
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (request.isForMainFrame) onLoadError(error.description?.toString() ?: "error ${error.errorCode}")
            }
        }
    }

    fun isLocal(uri: Uri) = uri.scheme == "https" && uri.host == HOST

    // Diisi MainActivity sebelum client() dipanggil.
    var appContextHolder: android.content.Context? = null
}
