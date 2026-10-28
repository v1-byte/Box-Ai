const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const js = read('BoxAI-Android/app/src/main/assets/www/app.js');
const kotlin = read(
  'BoxAI-Android/app/src/main/java/com/boxai/app/MainActivity.kt',
);
const html = read('BoxAI-Android/app/src/main/assets/www/index.html');
const gradle = read('BoxAI-Android/app/build.gradle.kts');
const workflow = read('.github/workflows/boxai-android-apk.yml');

test('model action performs an explicit native preload and reports ready/error state', () => {
  assert.match(js, /NATIVE\.preloadModel\(cfg\.file,[\s\S]*?,\s*id\)/);
  assert.match(js, /engineLoadingId/);
  assert.match(js, /engineLoadedId/);
  assert.match(kotlin, /@JavascriptInterface fun preloadModel\(/);
  assert.match(kotlin, /window\.BoxModel&&window\.BoxModel\.result/);
});

test('model loading validates GGUF and applies a conservative device-memory profile', () => {
  assert.match(kotlin, /String\(header, Charsets\.US_ASCII\) == "GGUF"/);
  assert.match(kotlin, /memory\.availMem < minimumReserve/);
  assert.match(kotlin, /totalGiB <= 6\.5 -> 1024/);
  assert.match(kotlin, /totalGiB <= 6\.5 -> minOf\(2, cpuCount\)/);
  assert.match(js, /maxTok: 512, ctx: 1024/);
  assert.match(kotlin, /@JavascriptInterface fun recommendedContext\(\)/);
});

test('HF search explains repository-name search and release versions agree', () => {
  assert.match(html, /Cari nama repo HF, bukan nama file/);
  assert.match(js, /APP_VERSION = '2\.2\.36'/);
  assert.match(gradle, /versionCode = 40[\s\S]*versionName = "2\.2\.36"/);
  assert.match(workflow, /BoxAI-v2\.2\.36-apk/);
});
