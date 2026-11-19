#!/usr/bin/env bash
# Shared by the shell tests of this directory. They run the module next to
# Visor in the sandboxed headless shell of the Visor repository
# (scripts/nested.sh there: own HOME, session bus and settings, so nothing
# reaches the session you are logged in to), and against the mock of
# tests/mock/, never against Open-Meteo.
#
# VISOR_REPO is a checkout of https://github.com/taulit/visor with `pnpm build`
# done; default: ../visor next to this repository.

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
visor_repo="${VISOR_REPO:-$repo/../visor}"
uuid='visor-weather@taulit.github.io'
schema='org.gnome.shell.extensions.visor-weather'

# nested [options of nested.sh] -- command: the sandbox with Visor and this module.
nested() {
    [[ -x "$visor_repo/scripts/nested.sh" && -f "$visor_repo/build/metadata.json" ]] || {
        echo "No built Visor in $visor_repo: set VISOR_REPO to a checkout and run 'pnpm build' there." >&2
        exit 2
    }
    [[ -f "$repo/build/metadata.json" ]] || { echo "Run 'pnpm build' first." >&2; exit 2; }
    mkdir -p "$repo/.shell-test"
    "$visor_repo/scripts/nested.sh" --extension "$repo/build" "$@"
}

# inside: call first in the part of a test that runs in the sandbox.
inside() {
    source "$visor_repo/scripts/lib/shell.sh"
    export GSETTINGS_SCHEMA_DIR="$HOME/.local/share/gnome-shell/extensions/$uuid/schemas"
    shell_wait_for 'visor !== null && visor.api !== null'
    shell_wait_for "Main.extensionManager.lookup('$uuid')?.state === 1 && visor.content.registry.get('weather') != null" 15
    shell_eval "$POINTER.moveTo(300, 800)" >/dev/null
}

# The settings of the module, as the shell and the settings window see them.
gs() { gsettings set "$schema" "$@"; }
gg() { gsettings get "$schema" "$1"; }

# mock_start: starts the mock on a free port and points the module at it. Sets $port.
mock_start() {
    port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
    node "$repo/tests/mock/server.js" --port "$port" >>"$HOME/weather-mock.log" 2>&1 &
    mock_pid=$!
    trap 'kill "$mock_pid" 2>/dev/null || true' EXIT
    for _ in $(seq 50); do
        curl -s "http://127.0.0.1:$port/__mock/state" >/dev/null && break
        sleep 0.1
    done
    gs forecast-url "http://127.0.0.1:$port/v1/forecast"
    gs geocoding-url "http://127.0.0.1:$port/v1/search"
}
# mock_state PYTHON: an expression over the state `s` of the mock, printed as true or false.
mock_state() { curl -s "http://127.0.0.1:$port/__mock/state" | python3 -c "import json,sys; s=json.load(sys.stdin); print(str($1).lower())"; }
# mock_set MODE: how the forecast answers from now on (ok, down, garbage, slow).
mock_set() { curl -s "http://127.0.0.1:$port/__mock/set?forecast=$1" >/dev/null; }

# place_set NAME LATITUDE LONGITUDE: what choosing a place in the settings window leaves behind.
place_set() {
    gs place-latitude "$2"
    gs place-longitude "$3"
    gs place-name "$1"
}

# The entry of the module in the registry of Visor and the module itself, as JS.
entry="visor.content.registry.get('weather')"
weather="$entry.module"
# All actors below the notch that carry a style class, as a JS expression.
content_find() {
    printf '%s' "(function find(a, out) { if (a.has_style_class_name && a.has_style_class_name('$1')) out.push(a); for (const c of a.get_children()) find(c, out); return out; })(visor.notch.root, [])"
}
# text_of CLASS: the texts of all mapped labels with that class, as a JS expression.
texts_of() { printf '%s' "$(content_find "$1").filter(a => a.mapped).map(a => a.text)"; }

# The pointer all clicks go through, and a way to move it. The first motions of
# a new virtual pointer end at the top edge of the monitor, which Visor takes
# for the pointer leaving the panel; so `inside` moves it once before anything
# is open, and every move is repeated until the pointer is where it should be.
POINTER="(globalThis.weatherTest ??= (() => {
    const pointer = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(true), false)));
    const moveTo = async (x, y) => {
        for (let i = 0; i < 20; i++) {
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
            await wait(60);
            const [px, py] = global.get_pointer();
            if (Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1) return true;
        }
        throw new Error('the pointer does not move to ' + x + ',' + y);
    };
    const click = async actor => {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        await moveTo(Math.round(x + w / 2), Math.round(y + h / 2));
        await wait(200);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        return wait(150);
    };
    return { moveTo, click };
})())"
# click JS: moves the pointer to the centre of the actor JS evaluates to and clicks.
click() { shell_eval "$POINTER.click($1)" >/dev/null; }

failures=0
# check NAME JS: passes when JS evaluates to true.
check() {
    local got
    got="$(shell_eval "$2" 2>&1)" || true
    if [[ "$got" == true ]]; then echo "ok    $1"; else echo "FAIL  $1: $got"; failures=$((failures + 1)); fi
}
# wait_check NAME JS [seconds]: like check, but gives JS time to become true.
wait_check() {
    if shell_wait_for "$2" "${3:-8}" 2>/dev/null; then
        echo "ok    $1"
    else
        echo "FAIL  $1: $(shell_eval "$2" 2>&1 || true)"
        failures=$((failures + 1))
    fi
}
# expect NAME GOT WANTED: two texts that have to be the same.
expect() {
    if [[ "$2" == "$3" ]]; then echo "ok    $1"; else echo "FAIL  $1: expected $3, got $2"; failures=$((failures + 1)); fi
}
# expect_mock NAME PYTHON: an expression over the state `s` of the mock that has to be true.
expect_mock() {
    if [[ "$(mock_state "$2")" == true ]]; then echo "ok    $1"; else echo "FAIL  $1: $(curl -s "http://127.0.0.1:$port/__mock/state")"; failures=$((failures + 1)); fi
}
# settled: gives the shell a moment for what was queued (settings, idle sources).
settled() { shell_eval 'new Promise(r => GLib.timeout_add(GLib.PRIORITY_LOW, 300, () => (r(true), false)))' >/dev/null; }
# panel_open / panel_close: the panel of Visor, waited for.
panel_open() { shell_eval 'visor.notch.open()' >/dev/null; shell_wait_for 'visor.notch.state === "open"'; }
panel_close() { shell_eval 'visor.notch.close()' >/dev/null; shell_wait_for 'visor.notch.state !== "open"'; }
# expect_quiet SINCE [EXCEPT]: the shell logged no warning or error after line
# SINCE of its log, lines that match EXCEPT aside.
expect_quiet() {
    local noise
    noise="$(tail -n "+$(($1 + 1))" "$HOME/shell.log" | grep -E 'JS ERROR|WARNING|CRITICAL|has been already disposed|visor' | grep -vE "${2:-^$}" || true)"
    if [[ -z "$noise" ]]; then echo 'ok    the shell logged no warning'; else echo 'FAIL  the shell logged:'; head -n 20 <<<"$noise"; failures=$((failures + 1)); fi
}
# finish: prints PASS when nothing failed and ends the test.
finish() {
    ((failures == 0)) && echo PASS
    exit "$((failures > 0))"
}
