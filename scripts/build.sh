#!/usr/bin/env bash
# Build a complete, installable extension directory in build/.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf build
tsc

cp metadata.json build/
# connect.js is plain JavaScript; tsc does not touch it.
mkdir -p build/visor
cp src/visor/connect.js build/visor/

cp stylesheet.css build/

mkdir -p build/schemas
cp schemas/*.gschema.xml build/schemas/
glib-compile-schemas --strict build/schemas

domain=$(node -p "require('./metadata.json')['gettext-domain']")
shopt -s nullglob
for po in po/*.po; do
  lang=$(basename "$po" .po)
  mkdir -p "build/locale/$lang/LC_MESSAGES"
  msgfmt --check -o "build/locale/$lang/LC_MESSAGES/$domain.mo" "$po"
done
exit 0
