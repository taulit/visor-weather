#!/usr/bin/env bash
# Disables and enables an extension repeatedly in the sandboxed headless shell
# while the module shows the weather of the mock of tests/mock/, and fails if
# actors or signal handlers are left behind or the shell logs warnings.
# Two rounds: this module goes and comes back while Visor stays, then Visor
# goes and comes back and the module registers again. In every second cycle
# the extension goes while its request is still running.
#
# Usage: tests/shell/leak.sh [cycles]   (default 50, per round)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ "${1:-}" != --inside ]]; then
    nested --log "$repo/.shell-test/leak.log" -- "$repo/tests/shell/leak.sh" --inside "${1:-50}"
    exit
fi

inside
cycles="$2"
# Every actor below the stage, so leaks outside uiGroup's direct children count too.
count="$SHELL_ACTOR_COUNT"
loaded() { shell_wait_for "$entry != null && $weather.forecast !== null && $weather.request === null" 15; }
registered() { shell_wait_for "$entry != null && $entry.active" 15; }

# The network monitor is an object of the system that outlives the module, and
# not one of those visorSignalCounts() looks at: its handlers are counted here.
network="(() => { const GObject = imports.gi.GObject; const monitor = Gio.NetworkMonitor.get_default(); const match = { signalId: 'network-changed' }; const found = GObject.signal_handlers_block_matched(monitor, match); if (found) GObject.signal_handlers_unblock_matched(monitor, match); return found; })()"

settle() { shell_eval 'new Promise(r => GLib.timeout_add(GLib.PRIORITY_LOW, 150, () => (r(true), false)))' >/dev/null; }

mock_start
gs units celsius
place_set 'Freiburg im Breisgau' 47.99 7.85
loaded
settle

# Visor builds its sheet a few seconds after it was enabled, or when the panel
# first opens. Opening it once makes both counts of a round include the sheet,
# and the section of the module with all its hours and days.
warm() {
    loaded
    panel_open
    shell_wait_for "$(content_find visor-weather-hour).filter(a => a.mapped).length === 6"
    panel_close
    settle
}

fail=0
# round NAME UUID: CYCLES times off and on.
round() {
    local state="Main.extensionManager.lookup('$2').state" i
    local actors_before signals_before actors_after signals_after grew log_before noise
    local network_before network_after
    warm
    actors_before="$(shell_eval "$count")"
    signals_before="$(shell_eval 'visorSignalCounts()')"
    network_before="$(shell_eval "$network")"
    log_before="$(wc -l <"$HOME/shell.log")"
    for ((i = 1; i <= cycles; i++)); do
        shell_eval "Main.extensionManager.disableExtension('$2')" >/dev/null
        shell_wait_for "$state !== 1"
        shell_eval "Main.extensionManager.enableExtension('$2')" >/dev/null
        shell_wait_for "$state === 1"
        # Every second time the answer is not waited for: the next cycle
        # disables the extension while the request runs.
        if ((i % 2)); then loaded; else registered; fi
    done
    warm
    actors_after="$(shell_eval "$count")"
    signals_after="$(shell_eval 'visorSignalCounts()')"
    network_after="$(shell_eval "$network")"
    grew="$(signals_grew "$signals_before" "$signals_after" "$cycles")"
    noise="$(tail -n "+$((log_before + 1))" "$HOME/shell.log" | grep -E 'JS ERROR|WARNING|CRITICAL|has been already disposed' || true)"
    echo "$1: $cycles cycles"
    echo "  actors before/after:   $actors_before / $actors_after"
    echo "  handlers before/after: $(signals_total "$signals_before") / $(signals_total "$signals_after")"
    echo "  on the network monitor: $network_before / $network_after"
    echo "  shell warnings:        $(grep -c . <<<"$noise" || true)"
    [[ "$actors_before" == "$actors_after" ]] || { echo "FAIL: $1: actor count changed"; fail=1; }
    [[ "$network_before" == "$network_after" ]] || { echo "FAIL: $1: handlers left on the network monitor"; fail=1; }
    [[ -z "$grew" ]] || { echo "FAIL: $1: signal handlers left behind:"; echo "$grew"; fail=1; }
    [[ -z "$noise" ]] || { echo "FAIL: $1: shell warnings:"; echo "$noise" | head -n 20; fail=1; }
}
round 'the module off and on' "$uuid"
round 'Visor off and on' 'visor@taulit.github.io'
echo "mock: $(curl -s "http://127.0.0.1:$port/__mock/state" | python3 -c 'import json,sys; s=json.load(sys.stdin); print(s["forecasts"], "forecasts,", s["searches"], "searches")')"
((fail == 0)) && echo "PASS"
exit "$fail"
