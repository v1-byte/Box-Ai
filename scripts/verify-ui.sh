#!/usr/bin/env bash
# Memeriksa bahwa file UI asli tidak berubah (SHA-256) dan sintaks app.js valid.
# Pakai:  scripts/verify-ui.sh            -> verifikasi terhadap scripts/ui.sha256
#         scripts/verify-ui.sh --update   -> tulis ulang baseline (hanya setelah perubahan UI yang DISETUJUI)
set -euo pipefail
cd "$(dirname "$0")/.."
WWW="BoxAI-Android/app/src/main/assets/www"
BASE="scripts/ui.sha256"
FILES=("$WWW/index.html" "$WWW/styles.css" "$WWW/app.js" "$WWW/assets/logo.webp" "$WWW/assets/logo-128.webp" "$WWW/assets/logo-64.webp")

if [[ "${1:-}" == "--update" ]]; then
  sha256sum "${FILES[@]}" > "$BASE"
  echo "Baseline diperbarui: $BASE"
  exit 0
fi

[[ -f "$BASE" ]] || { echo "ERROR: $BASE tidak ada"; exit 1; }
sha256sum -c "$BASE"

if command -v node >/dev/null 2>&1; then
  node --check "$WWW/app.js"
  echo "Sintaks app.js OK"
else
  echo "PERINGATAN: node tidak ada, sintaks JS dilewati"
fi

# Pemeriksaan rahasia sederhana pada source yang dilacak
if grep -rEn --exclude-dir=.git --exclude-dir=build --exclude="*.webp" \
   '(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|hf_[A-Za-z0-9]{30,})' . ; then
  echo "ERROR: ada token yang tampak seperti rahasia di repo"; exit 1
fi
echo "Verifikasi UI lulus"
