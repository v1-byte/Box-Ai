# Kontrak Native Bridge (`window.BoxNative`)

UI Box AI berjalan di dalam `WebView` Android dan berbicara dengan sisi native (Kotlin) lewat objek global
`window.BoxNative` yang didaftarkan dengan `addJavascriptInterface`. Dokumen ini **disusun dari cara `app.js`
memanggilnya** (v2.2.36); bentuk argumen dan nilai balik di bawah adalah apa yang UI harapkan, bukan salinan
kode Kotlin-nya.

> Jika `window.BoxNative` tidak ada (mis. dibuka di browser desktop), UI tetap tampil tetapi fitur yang
> bergantung pada native akan menampilkan toast "hanya tersedia di aplikasi Android" atau dilewati.

Konvensi: semua metode bersifat **sinkron** dan mengembalikan string/angka/boolean. Metode yang mengembalikan
data terstruktur mengembalikan **string JSON** yang di-`JSON.parse` oleh UI.

## 1. Inferensi dan model

| Metode | Dipakai untuk |
| --- | --- |
| `engineAvailable()` → bool | Cek apakah mesin inferensi tersedia |
| `recommendedContext()` → number | Batas konteks yang disarankan perangkat (UI membatasi `S.ctx` ke nilai ini, min. 512) |
| `preloadModel(file, nCtx, temp, topP, modelId)` | Muat model ke memori; hasil lewat callback `BoxModel.result` |
| `unloadModel()` | Bongkar model dari memori |
| `generate(json)` | Mulai generasi; hasil dialirkan lewat callback `BoxEngine` |
| `listModels()` → JSON array | Daftar model terunduh |
| `listModelsDeep()` → JSON array | Pemindaian lebih dalam (termasuk folder yang diberi izin) |
| `deleteModel(file)` → bool | Hapus file model |
| `renameModel(oldName, newName)` → bool | Ganti nama file model |
| `head(file)` → hex string | Byte awal file (UI menampilkan 128 byte pertama sebagai hex dump) |
| `info()` → JSON | Info perangkat/aplikasi |

Payload `generate`:

```json
{
  "model": "nama-file.gguf",
  "model_id": "id-internal",
  "messages": [{ "role": "system|user|assistant", "content": "…" }],
  "temp": 0.7,
  "top_p": 0.9,
  "max_tokens": 1024,
  "n_ctx": 1024
}
```

## 2. Unduhan model

| Metode | Dipakai untuk |
| --- | --- |
| `startDownload(url, fileName, token)` → downloadId | Mulai unduhan (token untuk model gated) |
| `status(downloadId)` → JSON | Progres, ukuran, kecepatan, `err` bila gagal |
| `pauseDownload(downloadId)` | Jeda (lanjut dilakukan dengan `startDownload` ulang) |
| `cancel(downloadId)` | Batalkan |
| `lastDownloadError()` → string | Pesan galat unduhan terakhir |

## 3. Penyimpanan dan file

| Metode | Dipakai untuk |
| --- | --- |
| `hasStoragePermission()` / `requestStoragePermission()` | Izin penyimpanan |
| `requestTreeAccess()` | Minta akses folder (SAF); hasil lewat `window.onBoxTreeGranted(ok)` |
| `treeAccessCount()` → number | Jumlah folder yang sudah diberi izin |
| `scanDebug()` → JSON | Info diagnostik pemindaian model |
| `listWorkspaceFiles()` → JSON array | Daftar file workspace untuk Penjelajah File |
| `readWorkspaceText(uri)` → string | Baca file teks |
| `writeWorkspaceText(uri, text)` → bool | Simpan file teks |
| `clearCache()` | Bersihkan cache KV (Pembersih) |

## 4. Rahasia (secure storage)

| Metode | Dipakai untuk |
| --- | --- |
| `getSecret(key)` → string | Ambil token |
| `setSecret(key, value)` | Simpan token |

Kunci yang dipakai UI: `hf`, `gh`, `cf`, `meta`. Token **tidak** ditulis ke `localStorage`
(UI menghapusnya dari salinan sebelum menyimpan, dan memigrasikan nilai lama sekali saja).

## 5. Web, termal, dan pembaruan

| Metode | Dipakai untuk |
| --- | --- |
| `webSearch(id, query)` | Pencarian web (DuckDuckGo); hasil lewat `window.BoxSearch.cb(id, result)` |
| `thermalInfo()` → JSON | Status termal Android |
| `deviceStats()` → JSON | `cpuBusy`, `cpuTotal`, `ramFree`, `ramTotal`, `batteryTempC`, `thermalStatus` |
| `coolDown()` → JSON | Jalankan satu *cooling pulse* |
| `appVersion()` → string | Versi aplikasi terpasang |
| `downloadUpdate(url, apkName)` → downloadId | Unduh APK pembaruan |
| `updateStatus(downloadId)` → JSON | Progres unduhan pembaruan |
| `installUpdate(apkName)` → JSON | Mulai pemasangan APK |
| `cancelUpdate(downloadId)` | Batalkan unduhan pembaruan |

## 6. Callback yang harus disediakan native (dipanggil via `evaluateJavascript`)

| Callback | Argumen | Keterangan |
| --- | --- | --- |
| `BoxEngine.token(t)` | string | Potongan token hasil generasi (streaming) |
| `BoxEngine.done()` | — | Generasi selesai |
| `BoxEngine.error(msg)` | string | Generasi gagal |
| `BoxModel.result(ok, name, message, modelId)` | bool, string, string, string | Hasil `preloadModel` |
| `BoxSearch.cb(id, result)` | number, `{results:[{title,url,snippet}]}` atau `{error}` | Hasil `webSearch` |
| `BoxThermal.waiting(bool)` | bool | Inferensi ditahan menunggu suhu turun |
| `onBoxTreeGranted(ok)` | bool | Hasil `requestTreeAccess` |
| `window.__kbHeight` | number | Tinggi keyboard (px) untuk mengatur tata letak |

Catatan: `BoxEngine` dibuat UI per permintaan `generate` (timeout 90 detik); native hanya perlu memanggil
`window.BoxEngine.token/done/error` selama permintaan berjalan.

## Contoh pendaftaran di Kotlin (kerangka)

```kotlin
webView.settings.javaScriptEnabled = true
webView.addJavascriptInterface(BoxNativeBridge(context, webView), "BoxNative")
webView.loadUrl("file:///android_asset/www/index.html")
```

Tandai setiap metode publik dengan `@JavascriptInterface` dan kembalikan hanya tipe primitif/String.
r