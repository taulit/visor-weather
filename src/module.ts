// The weather at one place as a section in "Up Next": one row with now and the
// next hours, and the coming days behind "Days". The data comes from Open-Meteo (see
// weather.ts); the place is chosen in the settings window. Without a place
// the module shows nothing and asks nothing.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import type { ModuleContext, VisorModule } from './visor/index.js';
import { fetchText } from './fetch.js';
import {
  DEFAULT_FORECAST_URL,
  MAX_ANSWER_BYTES,
  PRECIPITATION_SHOWN,
  REFRESH_MS,
  conditionOf,
  endpoint,
  forecastUrl,
  formatHour,
  formatTemperature,
  formatBound,
  formatWeekday,
  hoursOn,
  parseForecast,
  placeOf,
  samePlace,
  unitOf,
  viewOf,
  wetSpell,
  WET_FROM,
  type Day,
  type Forecast,
  type Hour,
  type Place,
  type Unit,
} from './weather.js';

const ICON = 'weather-few-clouds-symbolic';
/** The hours after "Now" in the row. */
const HOURS_SHOWN = 5;
const DAYS_SHOWN = 4;
/** A space as wide as a digit. */
const FIGURE_SPACE = '\u2007';
/** The tallest bar of the rain of a day, in pixels; a dry hour is a dot of 2 px. */
const STRIP_HEIGHT = 14;
/** A day shows the words of its weather when the section is at least this wide, in CSS pixels. */
const WORDS_FROM_WIDTH = 340;

/** One section as it was built for one heading, and its widgets that change with the data. */
interface Widgets {
  /** The heading it was built with; the kit cannot change it, so another one means a new section. */
  title: string;
  section: St.Widget;
  content: St.Widget;
  hours: St.BoxLayout;
  days: St.BoxLayout;
  note: St.Label;
  empty: St.Widget;
  /** Holds the button that shows and hides the days. */
  more: St.Bin;
}

class WeatherModule implements VisorModule {
  readonly id = 'weather';
  readonly name: string;
  readonly icon = ICON;
  readonly slot = 'ahead';

  private ctx: ModuleContext | null = null;
  private clock: Gio.Settings | null = null;
  private network: Gio.NetworkMonitor | null = null;
  private removeOpenHandler: (() => void) | null = null;

  private place: Place | null = null;
  private forecast: Forecast | null = null;
  /** When the forecast was received, on the wall clock: sleep counts as time. */
  private receivedAt = 0;
  /** The last request brought no forecast. */
  private failed = false;
  /** The request that is running; an answer for another one is dropped. */
  private request: Gio.Cancellable | null = null;

  /** Waits for the settings to settle: a new place is three keys. */
  private settleSource = 0;
  /** The address of the server changed while the settings settle. */
  private askAgain = false;
  /** Asks again while the panel stays open. */
  private refreshSource = 0;
  /** What buildSection() gave to Visor; the section itself is rebuilt inside it. */
  private wrapper: St.BoxLayout | null = null;
  private widgets: Widgets | null = null;
  /** The coming days show. Collapsed after every enable(). */
  private expanded = false;
  /** A day has room for the words of its weather next to the numbers. */
  private wordsFit = true;

  /** `gettext` is the one of the extension; a module context has its own (`ctx.t`) only once it runs. */
  constructor(gettext: (text: string) => string) {
    this.name = gettext('Weather');
  }

  enable(ctx: ModuleContext): void {
    this.ctx = ctx;
    this.clock = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    this.clock.connectObject('changed::clock-format', () => this.render(), this);

    ctx.settings?.connectObject(
      'changed::place-name',
      () => this.settle(),
      'changed::place-latitude',
      () => this.settle(),
      'changed::place-longitude',
      () => this.settle(),
      'changed::forecast-url',
      () => this.settle(true),
      'changed::units',
      () => this.render(),
      this,
    );

    this.network = Gio.NetworkMonitor.get_default();
    this.network.connectObject(
      'network-changed',
      (_monitor: Gio.NetworkMonitor, available: boolean) => {
        // Back online after a request that failed: once more, without a timer.
        if (available && this.failed && this.request === null) this.refresh();
      },
      this,
    );

    this.removeOpenHandler = ctx.onOpenChanged(open => this.watch(open));

    this.place = this.readPlace();
    // One request up front, so the first look at the panel has something to show.
    this.refresh();
    // Turned on in the Modules view: the panel is open already.
    if (ctx.isOpen) this.watch(true);
  }

  /**
   * The panel opened or closed. While it is closed nothing is asked and no
   * timer runs; when it opens, data older than half an hour is asked for
   * again, and again every half hour for as long as it stays open.
   */
  private watch(open: boolean): void {
    if (this.refreshSource) GLib.source_remove(this.refreshSource);
    this.refreshSource = 0;
    if (!open) return;
    // Hours pass while the panel is closed; what is on screen has to be right.
    this.render();
    if (this.stale() && this.request === null) this.refresh();
    this.refreshSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_MS, () => {
      this.refresh();
      return GLib.SOURCE_CONTINUE;
    });
  }

  disable(): void {
    this.removeOpenHandler?.();
    this.removeOpenHandler = null;
    if (this.settleSource) GLib.source_remove(this.settleSource);
    if (this.refreshSource) GLib.source_remove(this.refreshSource);
    this.settleSource = this.refreshSource = 0;
    this.askAgain = false;

    this.request?.cancel();
    this.request = null;

    this.network?.disconnectObject(this);
    this.network = null;
    this.clock?.disconnectObject(this);
    this.clock = null;
    this.ctx?.settings?.disconnectObject(this);

    // Visor destroys the section; a new enable() starts from nothing.
    this.wrapper = null;
    this.widgets = null;
    this.expanded = false;
    this.wordsFit = true;
    this.place = null;
    this.forecast = null;
    this.receivedAt = 0;
    this.failed = false;
    this.ctx = null;
  }

  buildSection(): St.Widget {
    this.wrapper = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
    this.render();
    return this.wrapper;
  }

  /**
   * Builds the section for one heading inside the wrapper, in place of the one
   * that is there. The heading names the place, and a KitSection cannot change
   * its title.
   */
  private buildInner(title: string): Widgets | null {
    const ctx = this.ctx;
    const wrapper = this.wrapper;
    if (!ctx || !wrapper) return null;
    const { kit, t } = ctx;
    this.widgets?.section.destroy();
    this.wordsFit = true;

    const section = kit.section({
      title,
      links: [{ label: t('Refresh'), run: () => this.refresh() }],
    });

    const content = new St.BoxLayout({
      style_class: 'visor-weather',
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
    });
    const hours = new St.BoxLayout({ style_class: 'visor-weather-hours', x_expand: true });
    // Every hour gets the same width, whatever its texts are.
    (hours.layout_manager as Clutter.BoxLayout).homogeneous = true;
    const days = new St.BoxLayout({
      style_class: 'visor-weather-days',
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
      visible: false,
    });
    // Next to rows in "Now" the column is narrow: then the days go without words.
    days.connect('notify::allocation', () => this.fitWords());
    const note = new St.Label({ style_class: 'visor-weather-note', visible: false });
    content.add_child(hours);
    content.add_child(days);
    content.add_child(note);
    section.body.add_child(content);

    const empty = kit.empty(t('The weather is not available right now'));
    // No style of its own: the class tells this line from the ones of other sections.
    empty.add_style_class_name('visor-weather-empty');
    section.body.add_child(empty);

    // "Days" belongs on the line of the heading, always visible. The kit has
    // links there, but they show only while the pointer or the focus is in the
    // section. So the button joins the header the kit built, which is the first
    // child of the section; should a later Visor build it another way, the
    // button goes above the hours instead.
    const more = new St.Bin({
      style_class: 'visor-weather-more',
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const header = section.actor.get_first_child();
    if (header instanceof St.BoxLayout && header !== section.body) header.add_child(more);
    else content.insert_child_at_index(more, 0);

    wrapper.add_child(section.actor);
    this.widgets = { title, section: section.actor, content, hours, days, note, empty, more };
    return this.widgets;
  }

  /** Shows or hides the coming days, and gives the button the text for the other way. */
  private setExpanded(expanded: boolean, focus = false): void {
    const widgets = this.widgets;
    const ctx = this.ctx;
    if (!widgets || !ctx) return;
    this.expanded = expanded;
    widgets.days.visible = expanded && widgets.days.get_n_children() > 0;
    // A kit button cannot change its text: a new one takes its place.
    widgets.more.get_child()?.destroy();
    const button = ctx.kit.button({
      label: expanded ? ctx.t('Less') : ctx.t('Days'),
      icon: expanded ? 'pan-up-symbolic' : 'pan-down-symbolic',
      style: 'ghost',
      run: () => this.setExpanded(!this.expanded, true),
    });
    button.add_style_class_name('visor-weather-more-button');
    widgets.more.set_child(button);
    // Pressed with the keyboard: the focus stays where the button is.
    if (focus && button.mapped) button.grab_key_focus();
  }

  // --- data ---------------------------------------------------------------------

  private readPlace(): Place | null {
    const settings = this.ctx?.settings;
    if (!settings) return null;
    return placeOf(
      settings.get_string('place-name'),
      settings.get_double('place-latitude'),
      settings.get_double('place-longitude'),
    );
  }

  /** The settings changed. `again` asks the server even when the place is the same. */
  private settle(again = false): void {
    this.askAgain ||= again;
    if (this.settleSource) GLib.source_remove(this.settleSource);
    this.settleSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.settleSource = 0;
      const asked = this.askAgain;
      this.askAgain = false;
      const place = this.readPlace();
      const moved =
        place?.latitude !== this.place?.latitude || place?.longitude !== this.place?.longitude;
      const changed = !samePlace(place, this.place);
      this.place = place;
      if (moved) {
        // The forecast of another place says nothing about this one.
        this.forecast = null;
        this.receivedAt = 0;
        this.failed = false;
      }
      if (moved || asked) this.refresh();
      else if (changed) this.render();
      return GLib.SOURCE_REMOVE;
    });
  }

  private stale(): boolean {
    return this.place !== null && Date.now() - this.receivedAt >= REFRESH_MS;
  }

  /** Asks the server for the forecast of the place. Without a place nothing is asked. */
  private refresh(): void {
    this.request?.cancel();
    this.request = null;
    const ctx = this.ctx;
    const place = this.place;
    if (!ctx || !place) {
      this.render();
      return;
    }
    const base = endpoint(
      ctx.settings?.get_string('forecast-url') ?? DEFAULT_FORECAST_URL,
      DEFAULT_FORECAST_URL,
    );
    const request = new Gio.Cancellable();
    this.request = request;
    void fetchText(ctx.http, forecastUrl(base, place), MAX_ANSWER_BYTES, request).then(text => {
      // Cancelled, or disabled meanwhile: this answer is nobody's.
      if (this.request !== request) return;
      this.request = null;
      const forecast = text === null ? null : parseForecast(text);
      if (forecast) {
        this.forecast = forecast;
        this.receivedAt = Date.now();
      }
      this.failed = forecast === null;
      try {
        this.render();
      } catch (e) {
        logError(e as Error, 'Visor: Weather');
      }
    });
  }

  // --- what is shown --------------------------------------------------------------

  private unit(): Unit {
    return unitOf(
      this.ctx?.settings?.get_string('units') ?? 'auto',
      GLib.get_language_names_with_category('LC_MEASUREMENT'),
    );
  }

  private render(): void {
    const wrapper = this.wrapper;
    const ctx = this.ctx;
    if (!wrapper || !ctx) return;
    const { t } = ctx;

    const title = this.place
      ? t('Weather · {place}').replace('{place}', this.place.name)
      : t('Weather');
    const widgets = this.widgets?.title === title ? this.widgets : this.buildInner(title);
    if (!widgets) return;

    const view =
      this.place && this.forecast
        ? viewOf(this.forecast, Date.now(), { hours: HOURS_SHOWN, days: DAYS_SHOWN })
        : null;
    // Nothing without a place, and nothing while the first answer is on its way.
    wrapper.visible = this.place !== null && (view !== null || this.failed);
    widgets.content.visible = view !== null;
    widgets.empty.visible = view === null;
    widgets.more.visible = view !== null && view.days.length > 0;
    if (!view) return;

    const unit = this.unit();
    const hour12 = this.clock?.get_string('clock-format') === '12h';

    widgets.hours.destroy_all_children();
    // Now first: what the hours after it are read against.
    widgets.hours.add_child(
      this.buildHour(
        t('Now'),
        view.current.temperature,
        view.current.code,
        view.current.isDay,
        null,
        unit,
        t,
      ),
    );
    for (const hour of view.hours) {
      widgets.hours.add_child(
        this.buildHour(
          formatHour(hour.time, hour12),
          hour.temperature,
          hour.code,
          hour.isDay,
          hour.precipitation,
          unit,
          t,
        ),
      );
    }

    widgets.days.destroy_all_children();
    // Shorter numbers get figure spaces in front, so lows and highs line up at their right edges.
    const width = (pick: (day: Day) => number): number =>
      Math.max(0, ...view.days.map(day => formatTemperature(pick(day), unit).length));
    const widths = { low: width(day => day.low), high: width(day => day.high) };
    for (const day of view.days) {
      const hours = hoursOn(this.forecast?.hours ?? [], day.date);
      widgets.days.add_child(this.buildDay(day, hours, widths, unit, hour12, t));
    }
    this.setExpanded(this.expanded);

    // Only when asking again did not work: then the reader should know how old this is.
    widgets.note.visible = this.failed;
    if (this.failed) {
      widgets.note.text = t('Not updated since {time}').replace(
        '{time}',
        this.formatMoment(this.receivedAt, hour12),
      );
    }
  }

  /** The width of the days changed: show or hide the words of their weather. Opacity, so nothing is laid out again. */
  private fitWords(): void {
    const days = this.widgets?.days;
    if (!days) return;
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const width = days.allocation.get_width();
    const fit = width <= 0 || width >= WORDS_FROM_WIDTH * scale;
    if (fit === this.wordsFit) return;
    this.wordsFit = fit;
    for (const row of days.get_children()) {
      for (const child of row.get_children()) {
        if (child instanceof St.Label && child.has_style_class_name('visor-weather-day-text'))
          child.opacity = fit ? 255 : 0;
      }
    }
  }

  /** A moment of today as a time, of another day with its weekday before it. */
  private formatMoment(ms: number, hour12: boolean): string {
    const at = new Date(ms);
    const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 });
    if (at.toDateString() === new Date().toDateString()) return time;
    const weekday = at.toLocaleDateString(undefined, { weekday: 'short' }).replace(/\.$/, '');
    return `${weekday} ${time}`;
  }

  private percent(value: number | null, t: (s: string) => string): string {
    if (value === null || value < PRECIPITATION_SHOWN) return '';
    return t('{percent}%').replace('{percent}', String(value));
  }

  /** One column of the row: a time or "Now", the weather, the temperature and the chance of rain. */
  private buildHour(
    time: string,
    celsius: number,
    code: number,
    isDay: boolean,
    precipitation: number | null,
    unit: Unit,
    t: (s: string) => string,
  ): St.Widget {
    const condition = conditionOf(code, isDay);
    const temperature = formatTemperature(celsius, unit);
    const rain = this.percent(precipitation, t);
    const cell = new St.BoxLayout({
      style_class: 'visor-weather-hour',
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
      accessible_name: [time, condition.text ? t(condition.text) : '', temperature, rain]
        .filter(part => part !== '')
        .join(', '),
    });
    const center = { x_align: Clutter.ActorAlign.CENTER };
    cell.add_child(new St.Label({ style_class: 'visor-weather-hour-time', text: time, ...center }));
    cell.add_child(
      new St.Icon({ style_class: 'visor-weather-icon', icon_name: condition.icon, ...center }),
    );
    cell.add_child(
      new St.Label({ style_class: 'visor-weather-hour-value', text: temperature, ...center }),
    );
    // Always there, also when empty: the columns keep one height.
    cell.add_child(new St.Label({ style_class: 'visor-weather-rain', text: rain, ...center }));
    return cell;
  }

  /** One day: weekday, weather, the chance of rain, and low / high in columns that line up. */
  private buildDay(
    day: Day,
    hours: Hour[],
    widths: { low: number; high: number },
    unit: Unit,
    hour12: boolean,
    t: (s: string) => string,
  ): St.Widget {
    const condition = conditionOf(day.code);
    // "Rain 13–17" says more than "Light rain": then it stands in place of the words.
    const words = this.wetWords(hours, hour12, t) ?? (condition.text ? t(condition.text) : '');
    const weekday = formatWeekday(day.date).replace(/\.$/, '');
    const high = formatTemperature(day.high, unit);
    const low = formatTemperature(day.low, unit);
    const rain = this.percent(day.precipitation, t);
    const row = new St.BoxLayout({
      style_class: 'visor-weather-day',
      x_expand: true,
      accessible_name: [
        weekday,
        words,
        t('Low {low}, high {high}').replace('{high}', high).replace('{low}', low),
        rain,
      ]
        .filter(part => part !== '')
        .join(', '),
    });
    const middle = { y_align: Clutter.ActorAlign.CENTER };
    row.add_child(
      new St.Label({ style_class: 'visor-weather-day-name', text: weekday, ...middle }),
    );
    row.add_child(
      new St.Icon({ style_class: 'visor-weather-icon', icon_name: condition.icon, ...middle }),
    );
    // The words stand between the icon and the numbers where there is room for them;
    // the label is always there, because it is also what pushes the numbers to the end.
    row.add_child(
      new St.Label({
        style_class: 'visor-weather-day-text',
        text: words,
        opacity: this.wordsFit ? 255 : 0,
        x_expand: true,
        ...middle,
      }),
    );
    if (hours.some(hour => hour.precipitation !== null)) row.add_child(this.buildStrip(hours));
    row.add_child(new St.Label({ style_class: 'visor-weather-rain day', text: rain, ...middle }));
    // "3° / 9°": the low quiet, the high strong, each in a column of its own.
    const range = new St.BoxLayout({ style_class: 'visor-weather-day-range', ...middle });
    range.add_child(
      new St.Label({
        style_class: 'visor-weather-day-low',
        text: low.padStart(widths.low, FIGURE_SPACE),
        ...middle,
      }),
    );
    range.add_child(new St.Label({ style_class: 'visor-weather-day-slash', text: '/', ...middle }));
    range.add_child(
      new St.Label({
        style_class: 'visor-weather-day-high',
        text: high.padStart(widths.high, FIGURE_SPACE),
        ...middle,
      }),
    );
    row.add_child(range);
    // Only the words give way in a narrow column; numbers are never cut.
    for (const label of [...row.get_children(), ...range.get_children()]) {
      if (label instanceof St.Label && !label.has_style_class_name('visor-weather-day-text'))
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    }
    return row;
  }

  /** When a day is wet, as "Rain 13–17" or "Snow all day"; null on a dry day. */
  private wetWords(hours: Hour[], hour12: boolean, t: (s: string) => string): string | null {
    const spell = wetSpell(hours);
    if (!spell) return null;
    const snow = spell.kind === 'snow';
    if (spell.from <= 1 && spell.to >= 23) return snow ? t('Snow all day') : t('Rain all day');
    return (snow ? t('Snow {from}–{to}') : t('Rain {from}–{to}'))
      .replace('{from}', formatBound(spell.from, hour12))
      .replace('{to}', formatBound(spell.to, hour12));
  }

  /** The chance of rain of every hour of a day as a bar, midnight to midnight; wet hours in blue. */
  private buildStrip(hours: Hour[]): St.Widget {
    const strip = new St.BoxLayout({
      style_class: 'visor-weather-strip',
      y_align: Clutter.ActorAlign.CENTER,
    });
    for (let h = 0; h < 24; h++) {
      const chance = hours.find(hour => Number(hour.time.slice(11, 13)) === h)?.precipitation ?? 0;
      const height = 2 + Math.round((chance / 100) * (STRIP_HEIGHT - 2));
      strip.add_child(
        new St.Widget({
          style_class: `visor-weather-strip-hour${
            chance >= WET_FROM ? ' wet' : chance >= PRECIPITATION_SHOWN ? ' damp' : ''
          }`,
          style: `height: ${height}px;`,
          y_align: Clutter.ActorAlign.END,
          y_expand: true,
        }),
      );
    }
    return strip;
  }
}

export function weatherModule(gettext: (text: string) => string): VisorModule {
  return new WeatherModule(gettext);
}
