#!/usr/bin/env bash
# 打包 chrome-ext-siyuan → dist/chrome-ext-siyuan-v<version>.zip
# 版本号唯一来源是 manifest.json；zip 内 manifest.json 必须在根目录（Web Store 要求）
set -euo pipefail
cd "$(dirname "$0")"

NAME="chrome-ext-siyuan"
VERSION=$(jq -r '.version' manifest.json 2>/dev/null ||
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -1)
VERSION=${VERSION:-dev}
OUT_DIR="dist"
OUT="$OUT_DIR/${NAME}-v${VERSION}.zip"

FILES=(manifest.json background.js content.js options.html options.js README.md)

mkdir -p "$OUT_DIR"
rm -f "$OUT"

if command -v zip >/dev/null 2>&1; then
    zip -q "$OUT" "${FILES[@]}"
else
    # Arch 的 tar 是 bsdtar，可直出 zip；CI/无 zip 环境兜底
    bsdtar -cf "$OUT" --format zip "${FILES[@]}"
fi

echo "✅ $OUT"
if command -v unzip >/dev/null 2>&1; then
    unzip -l "$OUT"
else
    bsdtar -tf "$OUT"
fi
