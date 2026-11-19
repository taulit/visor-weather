#!/usr/bin/env bash
# Regenerate po/<domain>.pot from the built JS and merge it into every po/*.po.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/build.sh

domain=$(node -p "require('./metadata.json')['gettext-domain']")
mapfile -t sources < <(find build -name '*.js' | sort)
# `t` is the gettext of a module context (`ctx.t`, `const { t } = ctx`), `_` the one of the extension.
xgettext --from-code=UTF-8 --language=JavaScript \
  -k_ -kt -kN_ -kngettext:1,2 -kpgettext:1c,2 \
  --package-name="$domain" \
  -o "po/$domain.pot" "${sources[@]}"

shopt -s nullglob
for po in po/*.po; do
  msgmerge --update --backup=none "$po" "po/$domain.pot"
done
exit 0
