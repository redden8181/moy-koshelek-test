#!/usr/bin/env bash
set -euo pipefail

temp=$(mktemp -d)
trap 'rmdir "$temp" 2>/dev/null || true' EXIT
version=5.4.624
archive=${1:-"$temp/pdfjs-dist-$version.tgz"}
if [ "$#" -eq 0 ]; then
  npm pack "pdfjs-dist@$version" --ignore-scripts --silent --pack-destination "$temp"
  trap 'rm -f -- "$archive"; rmdir "$temp"' EXIT
fi
expected=b26e93c4a4ed5afd4e87a9f70ba27a6bca1d7a36f9b8ee00e33a3fd9d8241ee0b48aef193005ce7b310e0e455aa15a7c9d7d57cebfb45b114926652be39850ce
printf '%s  %s\n' "$expected" "$archive" | shasum -a 512 -c -
mkdir -p dist/vendor
for name in pdf.min.mjs pdf.worker.min.mjs; do
  tar -xOzf "$archive" "package/legacy/build/$name" > "dist/vendor/$name"
done
tar -xOzf "$archive" package/LICENSE > dist/vendor/LICENSE.pdfjs
tar -xzf "$archive" --strip-components=1 -C dist/vendor package/cmaps package/standard_fonts
