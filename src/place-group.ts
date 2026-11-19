// The part of the settings window that chooses the place: the place in use,
// a search by name (Open-Meteo geocoding, asked only when the search is sent)
// and the places it found.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';
import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { fetchText } from './fetch.js';
import {
  cleanQuery,
  geocodingUrl,
  languageOf,
  parsePlaces,
  type PlaceResult,
} from './geocoding.js';
import { DEFAULT_GEOCODING_URL, MAX_ANSWER_BYTES, endpoint, placeOf } from './weather.js';

const TIMEOUT_SECONDS = 15;

/** `47.99° N, 7.85° E`: what the forecast API is asked for. */
function coordinates(latitude: number, longitude: number): string {
  const part = (value: number, positive: string, negative: string): string =>
    `${Math.abs(value).toFixed(2)}° ${value < 0 ? negative : positive}`;
  return `${part(latitude, 'N', 'S')}, ${part(longitude, 'E', 'W')}`;
}

/**
 * The group that shows and chooses the place. `writer` gives a settings
 * object of its own for each change, so the three keys of a place are
 * written in one go. A search that still runs ends when `window` closes.
 */
export function placeGroup(
  settings: Gio.Settings,
  writer: () => Gio.Settings,
  window: Adw.PreferencesWindow,
): Adw.PreferencesGroup {
  const group = new Adw.PreferencesGroup({
    title: _('Place'),
    description: _(
      'The weather is shown for the place you choose here. Your location is never looked up.',
    ),
  });
  let http: Soup.Session | null = null;
  let cancellable: Gio.Cancellable | null = null;
  let closed = false;

  // --- the place in use ---
  const current = new Adw.ActionRow();
  const remove = new Gtk.Button({
    label: _('Remove'),
    valign: Gtk.Align.CENTER,
    css_classes: ['flat'],
  });
  current.add_suffix(remove);
  group.add(current);

  const showCurrent = (): void => {
    const place = placeOf(
      settings.get_string('place-name'),
      settings.get_double('place-latitude'),
      settings.get_double('place-longitude'),
    );
    current.title = place ? GLib.markup_escape_text(place.name, -1) : _('No place chosen');
    current.subtitle = place
      ? coordinates(place.latitude, place.longitude)
      : _('The module shows nothing and makes no request.');
    remove.visible = place !== null;
  };
  const store = (name: string, latitude: number, longitude: number): void => {
    const target = writer();
    target.delay();
    target.set_string('place-name', name);
    target.set_double('place-latitude', latitude);
    target.set_double('place-longitude', longitude);
    target.apply();
  };
  remove.connect('clicked', () => store('', 0, 0));
  const changedIds = ['place-name', 'place-latitude', 'place-longitude'].map(key =>
    settings.connect(`changed::${key}`, showCurrent),
  );
  showCurrent();

  // --- the search ---
  const entry = new Adw.EntryRow({ title: _('Search for a city'), show_apply_button: true });
  group.add(entry);

  /** The rows below the search: what was found, or one line that says what happened. */
  let shown: Adw.ActionRow[] = [];
  const clear = (): void => {
    for (const row of shown) group.remove(row);
    shown = [];
  };
  const say = (text: string): void => {
    clear();
    const row = new Adw.ActionRow({ title: text, css_classes: ['dim-label'] });
    group.add(row);
    shown.push(row);
  };
  const offer = (places: PlaceResult[]): void => {
    clear();
    for (const place of places) {
      const row = new Adw.ActionRow({
        title: GLib.markup_escape_text(place.name, -1),
        subtitle: GLib.markup_escape_text(place.detail, -1),
        activatable: true,
      });
      row.connect('activated', () => {
        store(place.name, place.latitude, place.longitude);
        clear();
        entry.text = '';
      });
      group.add(row);
      shown.push(row);
    }
  };

  const search = async (): Promise<void> => {
    cancellable?.cancel();
    cancellable = null;
    const query = cleanQuery(entry.text);
    if (query === '') {
      say(_('Type at least two letters'));
      return;
    }
    say(_('Searching …'));
    const mine = (cancellable = new Gio.Cancellable());
    http ??= new Soup.Session({
      timeout: TIMEOUT_SECONDS,
      user_agent: 'Visor: Weather (GNOME Shell extension)',
    });
    const base = endpoint(settings.get_string('geocoding-url'), DEFAULT_GEOCODING_URL);
    const url = geocodingUrl(base, query, languageOf(GLib.get_language_names()));
    const text = await fetchText(http, url, MAX_ANSWER_BYTES, mine);
    // The window closed, or another search took over: its widgets are not ours.
    if (closed || cancellable !== mine) return;
    cancellable = null;
    const places = text === null ? null : parsePlaces(text);
    if (places === null) say(_('The search did not work. Check the connection and try again.'));
    else if (places.length === 0) say(_('No place found'));
    else offer(places);
  };
  entry.connect('apply', () => void search());

  window.connect('close-request', () => {
    closed = true;
    cancellable?.cancel();
    cancellable = null;
    http?.abort();
    for (const id of changedIds) settings.disconnect(id);
    return false;
  });
  return group;
}
