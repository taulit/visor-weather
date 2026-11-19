#!/usr/bin/env bash
# Copy connect.js, connect.d.ts and index.d.ts of @taulit/visor-module into src/visor/.
# Run it again to update them to a newer version of the package.
#
# Usage: scripts/sync-sdk.sh [SDK_DIR]
#   SDK_DIR  a checkout of the package, such as sdk/ in the Visor repository.
#            Default: ../../sdk when this template lives in the Visor repository,
#            otherwise the package is fetched with `npm pack @taulit/visor-module`.
set -euo pipefail
cd "$(dirname "$0")/.."

src="${1:-}"
if [[ -z "$src" ]]; then
  if [[ -f ../../sdk/connect.js ]]; then
    src=../../sdk
  else
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    (cd "$tmp" && npm pack @taulit/visor-module --silent >/dev/null && tar -xzf ./*.tgz)
    src="$tmp/package"
  fi
fi

mkdir -p src/visor
for file in connect.js connect.d.ts index.d.ts; do
  cp "$src/$file" "src/visor/$file"
done
echo "Copied connect.js, connect.d.ts and index.d.ts from $src"
