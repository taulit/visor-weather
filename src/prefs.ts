import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {
  ExtensionPreferences,
  gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { placeGroup } from './place-group.js';
import { unitOfLocale } from './weather.js';

const VISOR_UUID = 'visor@taulit.github.io';
// Search for Visor in the extension store. Replace it with the page of Visor once you know it.
const VISOR_STORE_URL = 'https://extensions.gnome.org/?search=visor';
const UNITS = ['auto', 'celsius', 'fahrenheit'];

/** True when the shell knows the extension (installed, enabled or not). */
async function isInstalled(uuid: string): Promise<boolean> {
  const reply = await new Promise<GLib.Variant>((resolve, reject) => {
    Gio.DBus.session.call(
      'org.gnome.Shell',
      '/org/gnome/Shell',
      'org.gnome.Shell.Extensions',
      'GetExtensionInfo',
      new GLib.Variant('(s)', [uuid]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (connection, result) => {
        try {
          resolve(connection!.call_finish(result));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
  // The shell answers with an empty dictionary for an unknown extension.
  const [info] = reply.deepUnpack<[Record<string, unknown>]>();
  return Object.keys(info).length > 0;
}

export default class WeatherPreferences extends ExtensionPreferences {
  override async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const page = new Adw.PreferencesPage({
      title: _('General'),
      icon_name: 'emblem-system-symbolic',
    });
    window.add(page);

    // Visor is a separate extension. Without it this module does nothing, so say so.
    const hint = new Adw.PreferencesGroup({ visible: false });
    const row = new Adw.ActionRow({
      title: _('Visor is not installed'),
      subtitle: _('This module needs Visor and does nothing without it.'),
    });
    row.add_suffix(
      new Gtk.LinkButton({ label: _('Get Visor'), uri: VISOR_STORE_URL, valign: Gtk.Align.CENTER }),
    );
    hint.add(row);
    page.add(hint);

    const settings = this.getSettings();
    page.add(placeGroup(settings, () => this.getSettings(), window));

    const display = new Adw.PreferencesGroup({ title: _('Display') });
    const regional =
      unitOfLocale(GLib.get_language_names_with_category('LC_MEASUREMENT')) === 'fahrenheit'
        ? _('Automatic (°F)')
        : _('Automatic (°C)');
    const units = new Adw.ComboRow({
      title: _('Temperature'),
      subtitle: _('Automatic follows the region of the system.'),
      model: Gtk.StringList.new([regional, _('Celsius (°C)'), _('Fahrenheit (°F)')]),
    });
    const showUnits = (): void => {
      units.selected = Math.max(0, UNITS.indexOf(settings.get_string('units')));
    };
    showUnits();
    const unitsId = settings.connect('changed::units', showUnits);
    units.connect('notify::selected', () => {
      const unit = UNITS[units.selected] ?? 'auto';
      if (settings.get_string('units') !== unit) settings.set_string('units', unit);
    });
    window.connect('close-request', () => {
      settings.disconnect(unitsId);
      return false;
    });
    display.add(units);
    page.add(display);

    // The data is free to use with this credit (CC BY 4.0).
    const source = new Adw.PreferencesGroup({ title: _('Data') });
    const credit = new Adw.ActionRow({
      title: _('Weather data by Open-Meteo'),
      subtitle: _('No account and no key. Only the coordinates of the place are sent.'),
    });
    credit.add_suffix(
      new Gtk.LinkButton({
        label: 'open-meteo.com',
        uri: 'https://open-meteo.com/',
        valign: Gtk.Align.CENTER,
      }),
    );
    source.add(credit);
    page.add(source);

    try {
      hint.visible = !(await isInstalled(VISOR_UUID));
    } catch (e) {
      // The shell did not answer; show no hint rather than a wrong one.
      console.warn(`${this.uuid}: could not ask the shell about Visor: ${e}`);
    }
  }
}
