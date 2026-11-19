#!/usr/bin/env bash
# Create the extensions.gnome.org upload ZIP from build/.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/build.sh

uuid=$(node -p "require('./metadata.json').uuid")
zip_path="$PWD/dist/$uuid.shell-extension.zip"
mkdir -p dist
rm -f "$zip_path"
# Keep the ZIP clean: ship the schema XML only, not the compiled cache.
(cd build && zip -r -q "$zip_path" . -x 'schemas/gschemas.compiled')
echo "Wrote $zip_path"
