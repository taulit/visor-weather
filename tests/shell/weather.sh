#!/usr/bin/env bash
# The module next to Visor in the sandboxed headless shell, against the mock
# of tests/mock/: without a place it shows nothing and asks nothing, a place
# brings one request and the section with the weather now, the next hours and
# the coming days, the unit changes without a request, stale data is asked
# for again when the panel opens, a server that is down keeps the last data
# and says how old it is, and disabling the extension while a request runs
# leaves nothing behind.
#
# Usage: tests/shell/weather.sh
# The log of the shell ends up in .shell-test/weather.log.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [[ "${1:-}" != --inside ]]; then
    nested --log "$repo/.shell-test/weather.log" -- "$repo/tests/shell/weather.sh" --inside
    exit
fi

inside
log_start="$(wc -l <"$HOME/shell.log")"
mock_start
settled

section="$(content_find visor-weather)"
shown() { printf '%s' "$(content_find "$1").some(a => a.mapped)"; }
texts() { printf '%s' "$(content_find "$1").filter(a => a.mapped).map(a => a.text).join('|')"; }
# The temperature now: the first column of the row of hours.
now_temp() { printf '%s' "$(texts visor-weather-hour-value).split('|')[0]"; }
title_is() { printf '%s' "$(content_find visor-section-title).some(a => a.mapped && a.text === '$1')"; }
day() { LC_ALL=en_US.UTF-8 date -d "+$1 day" +%a; }

# --- no place ----------------------------------------------------------------------
check 'the module is registered by this extension' \
    "$entry.active && $entry.owner.uuid === '$uuid' && $entry.module.slot === 'ahead'"
panel_open
check 'without a place the section is built and hidden' \
    "$section.length === 1 && !$(shown visor-weather) && !$(shown visor-weather-empty)"
check 'and no timer waits while nothing is shown' "$weather.settleSource === 0 && $weather.request === null"
panel_close
expect_mock 'and the server was not asked' "s['forecasts'] == 0 and s['searches'] == 0"

# --- a place -------------------------------------------------------------------------
place_set 'Freiburg im Breisgau' 47.99 7.85
wait_check 'a place: the forecast arrives' "$weather.forecast !== null && !$weather.failed"
settled
expect_mock 'with one request for the three keys of a place' "s['forecasts'] == 1"
expect_mock 'that sends the coordinates and not the name' \
    "s['lastForecast']['latitude'] == '47.99' and s['lastForecast']['longitude'] == '7.85' and 'Freiburg' not in json.dumps(s['lastForecast'])"
expect_mock 'in °C and the local time of the place' \
    "s['lastForecast']['temperature_unit'] == 'celsius' and s['lastForecast']['timezone'] == 'auto'"
check 'the panel is still closed: no timer runs' "$weather.refreshSource === 0"

panel_open
wait_check 'the section shows' "$(shown visor-weather)"
# The sandbox runs in en_US: Fahrenheit is the unit of the region.
check 'the temperature now, in the unit of the region' "$(now_temp) === '47°' || $(now_temp)"
gs units celsius
wait_check 'and in °C once the setting says so' "$(now_temp) === '8°'"
check 'the heading names the place' "$(title_is 'Weather · Freiburg im Breisgau')"
check 'now says what it is like' \
    "$(content_find visor-weather-hour)[0].accessible_name === 'Now, Partly cloudy, 8°' || $(content_find visor-weather-hour)[0].accessible_name"
check 'now and the next five hours' \
    "$(content_find visor-weather-hour).filter(a => a.mapped).length === 6 && $(texts visor-weather-hour-value) === '8°|9°|8°|7°|7°|6°' || $(texts visor-weather-hour-value)"
check 'they start with now and the next hour' \
    "$(texts visor-weather-hour-time).split('|').slice(0, 2).join('|') === 'Now|' + ((new Date().getHours() + 1) % 24) + ':00' || $(texts visor-weather-hour-time)"
check 'rain is named where it is likely' \
    "$(content_find visor-weather-hour).filter(a => a.mapped).map(a => a.get_last_child().text).join('|') === '||55%|80%|65%|40%' || $(texts visor-weather-rain)"
check 'the days wait behind a button' "!$(shown visor-weather-days)"
click "$(content_find visor-weather-more-button)[0]"
wait_check 'which shows them' "$(shown visor-weather-days)"
check 'the coming four days' \
    "$(texts visor-weather-day-name) === '$(day 1)|$(day 2)|$(day 3)|$(day 4)' || $(texts visor-weather-day-name)"
check 'with what the weather is like' \
    "/^Overcast\\|Clear\\|Snow 13–17\\|Partly cloudy$/.test($(texts visor-weather-day-text)) && $(content_find visor-weather-day-text).every(a => a.opacity === 255) || $(texts visor-weather-day-text)"
check 'and the rain of every hour, the wet ones marked' \
    "$(content_find visor-weather-strip).filter(a => a.mapped).length === 4 && $(content_find visor-weather-strip)[2].get_children().filter(c => c.has_style_class_name('wet')).length === 4"
check 'and their lows and highs' \
    "$(texts visor-weather-day-low).replace(/\u2007/g, '') === '3°|−1°|−3°|−2°' && $(texts visor-weather-day-high) === '9°|7°|2°|5°' || $(texts visor-weather-day-low)"
check 'every icon is one the icon theme has' \
    "[...$(content_find visor-weather-icon)].every(i => new St.IconTheme().has_icon(i.icon_name))"
check 'nothing says the data is old' "!$(shown visor-weather-note) && !$(shown visor-weather-empty)"
check 'while the panel is open a timer asks again every half hour' "$weather.refreshSource !== 0"
expect_mock 'the unit changed without a request' "s['forecasts'] == 1"

# Next to rows in "Now" the column is narrow: the days go without words.
# The compact panel with rows in "Now": the narrowest column the weather gets.
dconf write /org/gnome/shell/extensions/visor/width "'compact'"
shell_eval "(() => { visor.api.register({ id: 'test-now', name: 'Test', icon: 'alarm-symbolic', slot: 'now',
    enable(ctx) { ctx.now.set([{ id: 'a', icon: 'alarm-symbolic', title: 'Tea', value: '2:41' }]); }, disable() {} }); return true; })()" >/dev/null
wait_check 'in the narrow column the days go without words' \
    "$(content_find visor-weather-day-text).every(a => a.opacity === 0)"
check 'and nothing of the section is cut off' \
    "$(content_find visor-weather-hour-value).every(a => !a.get_clutter_text().get_layout().is_ellipsized()) && $(content_find visor-weather-day-high).every(a => !a.get_clutter_text().get_layout().is_ellipsized())"
shell_eval "visor.api.unregister('test-now')" >/dev/null
dconf reset /org/gnome/shell/extensions/visor/width
wait_check 'alone again: the words are back' "$(content_find visor-weather-day-text).every(a => a.opacity === 255)"

# --- fresh and stale ---------------------------------------------------------------
panel_close
check 'the panel closed: the timer is gone' "$weather.refreshSource === 0"
panel_open
settled
expect_mock 'opening the panel with fresh data asks nothing' "s['forecasts'] == 1"
panel_close
shell_eval "(() => { $weather.receivedAt -= 31 * 60 * 1000; return true; })()" >/dev/null
panel_open
wait_check 'opening it with data older than half an hour asks again' "Date.now() - $weather.receivedAt < 60000"
expect_mock 'once' "s['forecasts'] == 2"

# --- the server is down -----------------------------------------------------------
mock_set down
refresh="$(content_find visor-button).find(b => b.label_actor?.text === 'Refresh')"
click "$refresh"
wait_check 'Refresh while the server is down: the request fails' "$weather.failed"
expect_mock 'it was asked' "s['forecasts'] == 3"
check 'the last data stays' "$(now_temp) === '8°' && $(texts visor-weather-day-name).split('|').length === 4"
check 'and a quiet line says since when' \
    "/^Not updated since [0-9]{1,2}:[0-9]{2}$/.test($(texts visor-weather-note)) || $(texts visor-weather-note)"
mock_set garbage
click "$refresh"
settled
expect_mock 'an answer that is no forecast' "s['forecasts'] == 4"
check 'changes nothing either' "$weather.failed && $(now_temp) === '8°' && $(shown visor-weather-note)"
mock_set ok
click "$refresh"
wait_check 'the server is back: the line is gone' "!$weather.failed && !$(shown visor-weather-note)"

# Another place while the server is down: the weather of the old one is not shown for it.
mock_set down
place_set 'Tromsø' 69.65 18.96
wait_check 'a new place that cannot be loaded shows one quiet line' \
    "$weather.failed && $weather.forecast === null && $(shown visor-weather-empty) && !$(shown visor-weather)"
check 'that says so' "$(content_find visor-weather-empty).filter(a => a.mapped).map(a => a.text).join() === 'The weather is not available right now'"
mock_set ok
click "$refresh"
wait_check 'and the weather once it can' "$(title_is 'Weather · Tromsø') && !$(shown visor-weather-empty)"
expect_mock 'for the new coordinates' "s['lastForecast']['latitude'] == '69.65'"

# --- the place goes ------------------------------------------------------------------
asked="$(curl -s "http://127.0.0.1:$port/__mock/state" | python3 -c 'import json,sys; print(json.load(sys.stdin)["forecasts"])')"
gs place-name ''
wait_check 'no place again: the section is hidden' "!$(shown visor-weather) && !$(shown visor-weather-empty) && $weather.forecast === null"
panel_close
panel_open
settled
expect_mock 'and nothing is asked, also when the panel opens' "s['forecasts'] == $asked"
panel_close

# --- going away while a request runs ---------------------------------------------
mock_set slow
place_set 'Freiburg im Breisgau' 47.99 7.85
wait_check 'a request that gets no answer is running' "$weather.request !== null"
shell_eval "globalThis.weatherBefore = $weather" >/dev/null
shell_eval "Main.extensionManager.disableExtension('$uuid')" >/dev/null
shell_wait_for "Main.extensionManager.lookup('$uuid').state !== 1"
check 'the extension off: the module is gone' "$entry === null"
check 'its request is cancelled and no source is left' \
    "(m => m.request === null && m.settleSource === 0 && m.refreshSource === 0 && m.ctx === null && m.network === null && m.clock === null)(globalThis.weatherBefore)"
shell_eval "delete globalThis.weatherBefore" >/dev/null
mock_set ok
shell_eval "Main.extensionManager.enableExtension('$uuid')" >/dev/null
wait_check 'and on again: the module is back with the weather' "$entry != null && $entry.active && $weather.forecast !== null" 15

# Visor goes and comes back: the module registers again by itself.
shell_eval "Main.extensionManager.disableExtension('visor@taulit.github.io')" >/dev/null
shell_wait_for "Main.extensionManager.lookup('visor@taulit.github.io').state !== 1"
check 'Visor off: the extension of the module stays active' "Main.extensionManager.lookup('$uuid').state === 1"
shell_eval "Main.extensionManager.enableExtension('visor@taulit.github.io')" >/dev/null
shell_wait_for "Main.extensionManager.lookup('visor@taulit.github.io').state === 1"
wait_check 'Visor on again: the module is registered again and loads the weather' \
    "$entry != null && $entry.active && $weather.forecast !== null" 15
panel_open
wait_check 'and shows it' "$(now_temp) === '8°'"
panel_close

expect_quiet "$log_start"
finish
