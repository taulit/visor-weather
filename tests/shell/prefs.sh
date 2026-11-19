#!/usr/bin/env bash
# Choosing the place in the settings window, against the mock of tests/mock/:
# a name typed into the search and Enter ask the place search once, a click on
# one of the places it found stores name and rounded coordinates, the module
# in the shell loads the weather for them without a restart, a search without
# a match and one that is too short say so, and Remove takes the place away
# again. The window is driven with the pointer and the keyboard and read
# through the accessibility bus.
#
# Usage: tests/shell/prefs.sh
# The log ends up in .shell-test/prefs.log, the output of the window in .shell-test/prefs.window.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ "${1:-}" != --inside ]]; then
    mkdir -p "$repo/.shell-test"
    window="$repo/.shell-test/prefs.window"
    status=0
    nested --log "$repo/.shell-test/prefs.log" -- \
        "$repo/tests/shell/prefs.sh" --inside >"$window" 2>&1 || status=$?
    grep -E '^(ok|FAIL|PASS)' "$window" || true
    # What the process of the window wrote. The line about visible-page is one of
    # libadwaita and GJS about each other, there with every settings window.
    noise="$(grep -E '^\(org\.gnome\.Shell\.Extensions:|JS ERROR' "$window" | grep -v 'visible-page' || true)"
    if [[ -n "$noise" ]]; then
        echo "FAIL  the window process logged:"
        head -n 10 <<<"$noise"
        exit 1
    fi
    echo "ok    the window process logged no error"
    exit "$status"
fi

inside
source "$visor_repo/scripts/lib/prefs.sh"
# The window of this module, not the one of Visor.
PREFS_WINDOW='Visor: Weather'
prefs_open() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Extensions.OpenExtensionPrefs "$uuid" '' '{}' >/dev/null
    shell_wait_for "global.get_window_actors().some(a => a.meta_window.title === '$PREFS_WINDOW')" 20
    sleep 1
    # The first click after the window opens is lost; this one hits the margin of the page.
    prefs_click 20 400
}
# expect_shows NAME TEXT / expect_hides NAME TEXT: the window shows exactly that text somewhere, or not.
expect_shows() {
    local i
    for ((i = 0; i < 25; i++)); do prefs_shows "$2" && break; sleep 0.2; done
    if prefs_shows "$2"; then echo "ok    $1"; else echo "FAIL  $1: the window does not show '$2'"; failures=$((failures + 1)); fi
}
expect_hides() {
    if prefs_shows "$2"; then echo "FAIL  $1: the window shows '$2'"; failures=$((failures + 1)); else echo "ok    $1"; fi
}
# search TEXT: types TEXT into the search, replacing what is there, and sends it.
search() {
    prefs_click_on 'Search for a city' text
    prefs_key Control_L a
    prefs_type "$1"
    prefs_enter
}

log_start="$(wc -l <"$HOME/shell.log")"
mock_start
settled

prefs_a11y
prefs_open
# The sandbox runs in en_US.
expect_shows 'the unit follows the region: Fahrenheit here' 'Automatic (°F)'
gs units celsius
expect_shows 'a unit set elsewhere shows in the window' 'Celsius (°C)'
expect_shows 'no place yet: the window says so' 'No place chosen'
expect_shows 'and what that means' 'The module shows nothing and makes no request.'
expect_hides 'there is nothing to remove' 'Remove'
expect_mock 'opening the window asks no server' "s['searches'] == 0 and s['forecasts'] == 0"

# --- searching ---------------------------------------------------------------------
prefs_click_on 'Search for a city' text
prefs_type 'Frei'
sleep 0.5
expect_mock 'typing asks nothing' "s['searches'] == 0"
prefs_enter
expect_shows 'Enter: the places that were found show' 'Freiburg im Breisgau'
expect_shows 'with region and country' 'Baden-Württemberg, Germany'
expect_shows 'all three of them' 'Freiberg'
expect_mock 'the place search was asked once, for what was typed' \
    "s['searches'] == 1 and s['lastSearch']['name'] == 'Frei' and s['lastSearch']['language'] == 'en'"
expect 'nothing is chosen yet' "$(gg place-name)" "''"
expect_mock 'and no weather was asked for' "s['forecasts'] == 0"

# --- choosing ----------------------------------------------------------------------
prefs_click_on 'Freiburg im Breisgau' 'list item'
expect_shows 'a click on a place: it is the place in use' '48.00° N, 7.85° E'
expect 'its name is stored' "$(gg place-name)" "'Freiburg im Breisgau'"
expect 'and its coordinates, rounded to two decimals' \
    "$(printf '%.4f %.4f' "$(gg place-latitude)" "$(gg place-longitude)")" '48.0000 7.8500'
expect_hides 'the other places are gone' 'Freiberg'
expect_shows 'and it can be removed' 'Remove'
wait_check 'the module in the shell loads the weather without a restart' \
    "$weather.forecast !== null && $weather.place.name === 'Freiburg im Breisgau'"
settled
expect_mock 'with one request, for the rounded coordinates' \
    "s['forecasts'] == 1 and s['lastForecast']['latitude'] == '48.00' and s['lastForecast']['longitude'] == '7.85'"
panel_open
wait_check 'and shows it in the panel' \
    "$(content_find visor-weather-hour-value).filter(a => a.mapped).map(a => a.text)[0] === '8°'"
panel_close

# --- searches that find nothing ----------------------------------------------------
search 'Nowhere'
expect_shows 'a name nobody knows: the window says so' 'No place found'
expect_mock 'after asking' "s['searches'] == 2 and s['lastSearch']['name'] == 'Nowhere'"
search 'x'
expect_shows 'one letter is not enough' 'Type at least two letters'
expect_mock 'and is not asked for' "s['searches'] == 2"
expect 'the place in use stays' "$(gg place-name)" "'Freiburg im Breisgau'"

# --- the unit ----------------------------------------------------------------------
gs units fahrenheit
expect_shows 'the unit changes in the window when the setting does' 'Fahrenheit (°F)'
gs units auto
expect_shows 'and back to the one of the region' 'Automatic (°F)'
prefs_click_on 'Temperature' 'combo box'
sleep 0.5
prefs_click_on 'Celsius (°C)'
sleep 0.5
expect 'choosing a unit in the window stores it' "$(gg units)" "'celsius'"

# --- removing ----------------------------------------------------------------------
prefs_click_on 'Remove' button
expect_shows 'Remove: no place again' 'No place chosen'
expect 'the name is gone from the settings' "$(gg place-name)" "''"
expect 'and the coordinates with it' "$(gg place-latitude) $(gg place-longitude)" '0.0 0.0'
wait_check 'the module shows nothing again' \
    "$weather.place === null && $weather.forecast === null && !$(content_find visor-weather).some(a => a.mapped)"
asked="$(curl -s "http://127.0.0.1:$port/__mock/state" | python3 -c 'import json,sys; print(json.load(sys.stdin)["forecasts"])')"
settled
expect_mock 'and asks nothing' "s['forecasts'] == $asked"

check 'Visor and the module are still enabled' \
    "Main.extensionManager.lookup('$uuid').state === 1 && Main.extensionManager.lookup('visor@taulit.github.io').state === 1"
prefs_close
# The shell says this about every window that closes while it is asked whether it is alive.
expect_quiet "$log_start" 'Tried to ping window'

finish
