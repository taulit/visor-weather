#!/usr/bin/env bash
# Runs the shell tests one after the other, each in its own sandboxed headless
# shell of the Visor repository (see tests/shell/lib.sh for VISOR_REPO).
# Prints one line per test and fails when one of them fails. What a test
# printed is in .shell-test/<name>.out.
#
# Usage: scripts/shell-tests.sh [name...]   (default: all)
set -uo pipefail
cd "$(dirname "$0")/.."

tests=(weather prefs leak)
for wanted in "$@"; do
    [[ " ${tests[*]} " == *" $wanted "* ]] || { echo "unknown test: $wanted" >&2; exit 2; }
done

PATH="$PWD/node_modules/.bin:$PATH" bash scripts/build.sh >/dev/null || { echo "FAIL  build"; exit 1; }
mkdir -p .shell-test

failed=0
for name in "${tests[@]}"; do
    if (($# > 0)) && [[ " $* " != *" $name "* ]]; then continue; fi
    out=".shell-test/$name.out"
    start=$SECONDS
    if bash "tests/shell/$name.sh" >"$out" 2>&1; then
        printf 'PASS  %-10s %3d s\n' "$name" "$((SECONDS - start))"
    else
        printf 'FAIL  %-10s %3d s  (%s)\n' "$name" "$((SECONDS - start))" "$out"
        grep -E '^FAIL' "$out" | head -n 10 | sed 's/^/      /'
        failed=$((failed + 1))
    fi
done

((failed == 0)) || echo "$failed failed"
exit "$((failed > 0))"
