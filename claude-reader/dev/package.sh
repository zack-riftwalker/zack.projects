#!/bin/sh
# Builds dist/khana-extension.zip (the folder inside is named "khana-extension").
# After a release: bump "version" in extension/manifest.json and update.json, then run this.
set -e
cd "$(dirname "$0")/.."
rm -rf dist/khana-extension dist/khana-extension.zip
mkdir -p dist
cp -r extension dist/khana-extension
(cd dist && zip -qr khana-extension.zip khana-extension && rm -rf khana-extension)
echo "dist/khana-extension.zip"
