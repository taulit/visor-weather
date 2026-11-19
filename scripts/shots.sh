#!/usr/bin/env bash
# Takes the screenshots of docs/screenshots/ in the sandboxed headless shell of
# the Visor repository, with the mock of tests/mock/ as the weather service:
# the open panel in the dark and the light scheme at 1600×1000 (the size the
# catalog of modules wants), and the same next to rows in "Now", in high
# contrast and in German, to see that nothing is cut off.
#
# Every scene is taken collapsed (the default) and with the days shown (-days).
#
# Usage: scripts/shots.sh [name...]   (default: all; names: weather columns compact hc de catalog)
set -uo pipefail
cd "$(dirname "$0")/.."
source tests/shell/lib.sh

if [[ "${1:-}" == --inside ]]; then
    name="$2" out="$3" days=false focus=false
    [[ "$name" == *-days ]] && days=true name="${name%-days}"
    # The pictures of the catalog: the section close up, on the wallpaper of Visor.
    [[ "$name" == catalog ]] && focus=true name=weather
    inside
    mock_start
    case "$name" in
        columns|compact)
            # Rows in "Now" make the panel two columns wide; the weather gets the narrow one.
            [[ "$name" == compact ]] && dconf write /org/gnome/shell/extensions/visor/width "'compact'"
            shell_eval "(() => { visor.api.register({ id: 'shot-now', name: 'Demo', icon: 'alarm-symbolic', slot: 'now',
                enable(ctx) { ctx.now.set([
                    { id: 'a', icon: 'alarm-symbolic', title: 'Tea', subtitle: 'Timer', value: '2:41' },
                    { id: 'b', icon: 'folder-download-symbolic', title: 'fedora-44.iso', subtitle: '1.2 GB of 2.3 GB', progress: 0.52 },
                ]); }, disable() {} }); return true; })()" >/dev/null
            ;;
        hc) gsettings set org.gnome.desktop.a11y.interface high-contrast true ;;
        # With that setting the top bar is dark and the panel with it, in both schemes.
        # A light panel in high contrast exists with a light top bar of another theme;
        # here the class Visor sets for it is set by hand.
        hc-class) shell_eval "visor.notch.root.add_style_class_name('visor-hc')" >/dev/null ;;
    esac
    # Alone in the panel, so the picture shows the module and nothing cut in half.
    $focus && dconf write /org/gnome/shell/extensions/visor/disabled-modules "['upcoming', 'notifications']"
    gs units celsius
    place_set 'Freiburg im Breisgau' 47.99 7.85
    shell_wait_for "$weather.forecast !== null"
    shell_eval 'visor.notch.open()' >/dev/null
    shell_wait_for 'visor.notch.state === "open"'
    shell_wait_for "$(content_find visor-weather-hour).filter(a => a.mapped).length > 0"
    if $days; then
        # What a click on "Days" does.
        shell_eval "(() => { $weather.setExpanded(true); return true; })()" >/dev/null
        shell_wait_for "$(content_find visor-weather-day).filter(a => a.mapped).length > 0"
    fi
    sleep 0.8
    if $focus; then shell_shot_focus "$out" visor-weather 44; else shell_shot "$out"; fi
    exit 0
fi

PATH="$repo/node_modules/.bin:$PATH" bash scripts/build.sh >/dev/null || { echo "FAIL  build"; exit 1; }
names=("$@")
[[ ${#names[@]} -gt 0 ]] || names=(weather columns compact hc de catalog)

fail=0
# shot NAME FILE [options of nested.sh]
shot() {
    local name="$1" file="$2" noise
    shift 2
    local size=(--size 1600x1000)
    # The catalog wants 1600x1000 too, but close up: a monitor twice as sharp.
    [[ "$name" == catalog* ]] && size=(--size 3200x2000 --scale 2 --wallpaper "$visor_repo/scripts/assets/wallpaper.jpg")
    if ! nested "${size[@]}" --log "$repo/.shell-test/shot-$name.log" "$@" -- \
        "$repo/scripts/shots.sh" --inside "$name" "$file" >/dev/null 2>&1; then
        echo "FAIL  ${file#"$repo"/}: the scenario did not run"
        fail=1
        return
    fi
    # What the shell says while it shuts down is not about the picture.
    noise="$(sed '/Shutting down GNOME Shell/,$d' "$repo/.shell-test/shot-$name.log" |
        grep -E 'JS ERROR|CRITICAL|Gjs-WARNING|St-WARNING|Clutter-WARNING|visor' || true)"
    if [[ -n "$noise" ]]; then
        echo "FAIL  ${file#"$repo"/}: the shell logged"
        head -n 10 <<<"$noise"
        fail=1
        return
    fi
    echo "ok    ${file#"$repo"/}"
}

for name in "${names[@]}"; do
    case "$name" in
        weather | columns | compact)
            for scheme in dark light; do
                shot "$name" "$repo/docs/screenshots/$name-$scheme.png" --scheme "$scheme"
                shot "$name-days" "$repo/docs/screenshots/$name-days-$scheme.png" --scheme "$scheme"
            done
            ;;
        hc)
            shot hc-days "$repo/docs/screenshots/high-contrast-dark.png" --scheme dark
            shot hc-class-days "$repo/docs/screenshots/high-contrast-light.png" --scheme light
            ;;
        de)
            if locale -a | grep -qix 'de_DE\.utf-\?8'; then
                VISOR_TEST_LOCALE=de_DE.UTF-8 shot weather "$repo/docs/screenshots/weather-de-dark.png" --scheme dark
                VISOR_TEST_LOCALE=de_DE.UTF-8 shot weather-days "$repo/docs/screenshots/weather-days-de-dark.png" --scheme dark
            else
                echo "skip  weather-de-dark.png: this machine has no locale de_DE.UTF-8"
            fi
            ;;
        catalog)
            shot catalog-days "$repo/catalog/$uuid/screenshot-1.png" --scheme dark
            shot catalog-days "$repo/catalog/$uuid/screenshot-2.png" --scheme light
            ;;
        *) echo "FAIL  unknown name: $name"; fail=1 ;;
    esac
done
exit "$fail"
