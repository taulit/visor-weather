// What the forecast of Open-Meteo says and how it is shown: the request, the
// answer, the weather codes and the texts. Pure TypeScript without imports, so
// the shell, the settings window and the unit tests can all load it.
//
// API: https://open-meteo.com/en/docs (checked against the live API on 2026-11-19).

export const DEFAULT_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const DEFAULT_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** An answer larger than this is not read. A forecast as asked for here has about 3 kB. */
export const MAX_ANSWER_BYTES = 256 * 1024;

/** Data older than this is asked for again when the panel opens. */
export const REFRESH_MS = 30 * 60 * 1000;

const DAYS_ASKED = 6;
/** Every hour of the days asked; anything beyond is dropped. */
const MAX_HOURS = 24 * (DAYS_ASKED + 1);

/** Marks a text for xgettext; it is translated where it is shown. */
const N_ = (text: string): string => text;

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
}

export type Unit = 'celsius' | 'fahrenheit';

/** One hour of the forecast. Temperatures are always °C here. */
export interface Hour {
  /** Local time of the place: `2026-11-19T14:00`. */
  time: string;
  temperature: number;
  code: number;
  isDay: boolean;
  /** Probability of precipitation in percent, null when the model has none. */
  precipitation: number | null;
}

export interface Day {
  /** Local day of the place: `2026-11-19`. */
  date: string;
  code: number;
  high: number;
  low: number;
  precipitation: number | null;
}

export interface Forecast {
  /** Seconds the place is ahead of UTC. */
  utcOffset: number;
  current: {
    time: string;
    temperature: number;
    feelsLike: number | null;
    code: number;
    isDay: boolean;
  };
  hours: Hour[];
  days: Day[];
}

// --- the place ----------------------------------------------------------------

/** Two decimals are about one kilometre: enough for the weather, and all the API gets. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The place of the settings, null when none is chosen or the values make no sense. */
export function placeOf(name: string, latitude: number, longitude: number): Place | null {
  const trimmed = name.trim();
  if (trimmed === '') return null;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return {
    name: trimmed,
    latitude: roundCoordinate(latitude),
    longitude: roundCoordinate(longitude),
  };
}

export function samePlace(a: Place | null, b: Place | null): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name && a.latitude === b.latitude && a.longitude === b.longitude;
}

// --- the request ----------------------------------------------------------------

/**
 * The address of an API from the settings: https, or plain http for this
 * machine only. Query and fragment are dropped. Anything else gives `fallback`.
 */
export function endpoint(setting: string, fallback: string): string {
  const match = /^(https?):\/\/([^/?#\s]+)(\/[^?#\s]*)?(?:[?#]\S*)?$/i.exec(setting.trim());
  if (!match) return fallback;
  const scheme = match[1]!.toLowerCase();
  const authority = match[2]!;
  // No user name in the address: it would hide the host that is really asked.
  if (authority.includes('@')) return fallback;
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  const local = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  if (scheme !== 'https' && !local) return fallback;
  return `${scheme}://${authority}${match[3] ?? '/'}`;
}

/** The request for now, the next hours and the coming days at `place`, in °C and its local time. */
export function forecastUrl(base: string, place: Place): string {
  const query = [
    `latitude=${roundCoordinate(place.latitude).toFixed(2)}`,
    `longitude=${roundCoordinate(place.longitude).toFixed(2)}`,
    'current=temperature_2m,apparent_temperature,weather_code,is_day',
    'hourly=temperature_2m,weather_code,precipitation_probability,is_day',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    'temperature_unit=celsius',
    'timezone=auto',
    `forecast_days=${DAYS_ASKED}`,
  ];
  return `${base}?${query.join('&')}`;
}

// --- the answer -----------------------------------------------------------------

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const column = (table: Record<string, unknown>, name: string): unknown[] => {
  const values = table[name];
  return Array.isArray(values) ? values : [];
};
const percent = (value: unknown): number | null =>
  isNumber(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;

/**
 * Reads the answer of the forecast API. Null when it is not a forecast: no
 * JSON, an error of the API, or no current weather. Hours and days with a
 * missing value are left out, the others stay.
 */
export function parseForecast(text: string): Forecast | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || data.error === true) return null;

  const now = data.current;
  if (!isObject(now)) return null;
  if (typeof now.time !== 'string' || !TIME.test(now.time)) return null;
  if (!isNumber(now.temperature_2m) || !isNumber(now.weather_code)) return null;

  const hours: Hour[] = [];
  if (isObject(data.hourly)) {
    const table = data.hourly;
    const times = column(table, 'time');
    const temperatures = column(table, 'temperature_2m');
    const codes = column(table, 'weather_code');
    const rain = column(table, 'precipitation_probability');
    const light = column(table, 'is_day');
    for (let i = 0; i < Math.min(times.length, MAX_HOURS); i++) {
      const time = times[i];
      const temperature = temperatures[i];
      const code = codes[i];
      if (typeof time !== 'string' || !TIME.test(time)) continue;
      if (!isNumber(temperature) || !isNumber(code)) continue;
      hours.push({
        time,
        temperature,
        code,
        isDay: light[i] !== 0,
        precipitation: percent(rain[i]),
      });
    }
  }

  const days: Day[] = [];
  if (isObject(data.daily)) {
    const table = data.daily;
    const dates = column(table, 'time');
    const highs = column(table, 'temperature_2m_max');
    const lows = column(table, 'temperature_2m_min');
    const codes = column(table, 'weather_code');
    const rain = column(table, 'precipitation_probability_max');
    for (let i = 0; i < Math.min(dates.length, 16); i++) {
      const date = dates[i];
      const high = highs[i];
      const low = lows[i];
      const code = codes[i];
      if (typeof date !== 'string' || !DATE.test(date)) continue;
      if (!isNumber(high) || !isNumber(low) || !isNumber(code)) continue;
      days.push({
        date,
        code,
        high: Math.max(high, low),
        low: Math.min(high, low),
        precipitation: percent(rain[i]),
      });
    }
  }

  return {
    utcOffset: isNumber(data.utc_offset_seconds) ? data.utc_offset_seconds : 0,
    current: {
      time: now.time,
      temperature: now.temperature_2m,
      feelsLike: isNumber(now.apparent_temperature) ? now.apparent_temperature : null,
      code: now.weather_code,
      isDay: now.is_day !== 0,
    },
    hours,
    days,
  };
}

// --- what is shown ----------------------------------------------------------------

export interface View {
  current: Forecast['current'];
  /** High and low of today, null when the forecast has no entry for today. */
  today: Day | null;
  /** The hours after the current one. */
  hours: Hour[];
  /** The days after today. */
  days: Day[];
}

/** The local time of a place `utcOffset` seconds ahead of UTC, as `2026-11-19T14:05`. */
export function placeTime(nowMs: number, utcOffset: number): string {
  return new Date(nowMs + utcOffset * 1000).toISOString().slice(0, 16);
}

/**
 * What of a forecast is still true at `nowMs`: hours and days that have
 * passed are dropped, and when the hour has changed since the answer, the
 * forecast for this hour stands in for the measured weather. Null when the
 * forecast is too old to say anything about now.
 */
export function viewOf(
  forecast: Forecast,
  nowMs: number,
  limits: { hours: number; days: number },
): View | null {
  // A clock that is a little behind the server must not make its answer look
  // like one from the future: the moment of the answer is the earliest "now".
  const clock = placeTime(nowMs, forecast.utcOffset);
  const now = clock < forecast.current.time ? forecast.current.time : clock;
  const hour = now.slice(0, 13);
  const date = now.slice(0, 10);

  let current = forecast.current;
  if (current.time.slice(0, 13) !== hour) {
    const stand = forecast.hours.find(entry => entry.time.slice(0, 13) === hour);
    if (!stand) return null;
    current = {
      time: stand.time,
      temperature: stand.temperature,
      feelsLike: null,
      code: stand.code,
      isDay: stand.isDay,
    };
  }
  return {
    current,
    today: forecast.days.find(day => day.date === date) ?? null,
    hours: forecast.hours.filter(entry => entry.time.slice(0, 13) > hour).slice(0, limits.hours),
    days: forecast.days.filter(day => day.date > date).slice(0, limits.days),
  };
}

// --- weather codes ------------------------------------------------------------

export interface Condition {
  /** English text, to be translated where it is shown. */
  text: string;
  /** Symbolic icon of the Adwaita icon theme. */
  icon: string;
  /** The icon at night, where the theme has another one. */
  night?: string;
}

const CLEAR = 'weather-clear-symbolic';
const CLEAR_NIGHT = 'weather-clear-night-symbolic';
const FEW_CLOUDS = 'weather-few-clouds-symbolic';
const FEW_CLOUDS_NIGHT = 'weather-few-clouds-night-symbolic';
const OVERCAST = 'weather-overcast-symbolic';
const FOG = 'weather-fog-symbolic';
const DRIZZLE = 'weather-showers-scattered-symbolic';
const RAIN = 'weather-showers-symbolic';
const SNOW = 'weather-snow-symbolic';
const STORM = 'weather-storm-symbolic';

/** WMO weather interpretation codes (WW) as Open-Meteo uses them. */
const CONDITIONS: Record<number, Condition> = {
  0: { text: N_('Clear'), icon: CLEAR, night: CLEAR_NIGHT },
  1: { text: N_('Mainly clear'), icon: FEW_CLOUDS, night: FEW_CLOUDS_NIGHT },
  2: { text: N_('Partly cloudy'), icon: FEW_CLOUDS, night: FEW_CLOUDS_NIGHT },
  3: { text: N_('Overcast'), icon: OVERCAST },
  45: { text: N_('Fog'), icon: FOG },
  48: { text: N_('Freezing fog'), icon: FOG },
  51: { text: N_('Light drizzle'), icon: DRIZZLE },
  53: { text: N_('Drizzle'), icon: DRIZZLE },
  55: { text: N_('Heavy drizzle'), icon: DRIZZLE },
  56: { text: N_('Light freezing drizzle'), icon: DRIZZLE },
  57: { text: N_('Freezing drizzle'), icon: DRIZZLE },
  61: { text: N_('Light rain'), icon: RAIN },
  63: { text: N_('Rain'), icon: RAIN },
  65: { text: N_('Heavy rain'), icon: RAIN },
  66: { text: N_('Light freezing rain'), icon: RAIN },
  67: { text: N_('Freezing rain'), icon: RAIN },
  71: { text: N_('Light snow'), icon: SNOW },
  73: { text: N_('Snow'), icon: SNOW },
  75: { text: N_('Heavy snow'), icon: SNOW },
  77: { text: N_('Snow grains'), icon: SNOW },
  80: { text: N_('Light showers'), icon: DRIZZLE },
  81: { text: N_('Showers'), icon: RAIN },
  82: { text: N_('Heavy showers'), icon: RAIN },
  85: { text: N_('Light snow showers'), icon: SNOW },
  86: { text: N_('Snow showers'), icon: SNOW },
  95: { text: N_('Thunderstorm'), icon: STORM },
  96: { text: N_('Thunderstorm with hail'), icon: STORM },
  99: { text: N_('Thunderstorm with hail'), icon: STORM },
};

/** Text and icon of a weather code. A code this table does not know has no text. */
export function conditionOf(code: number, isDay = true): { text: string; icon: string } {
  const known = CONDITIONS[code];
  if (!known) return { text: '', icon: OVERCAST };
  return { text: known.text, icon: isDay ? known.icon : (known.night ?? known.icon) };
}

// --- texts ----------------------------------------------------------------------

/** Countries where Fahrenheit is the unit of everyday life. */
const FAHRENHEIT = new Set(['US', 'BS', 'BZ', 'KY', 'PW', 'LR', 'FM', 'MH', 'PR', 'GU', 'VI']);

/**
 * The unit a region uses, from locale names in order of preference
 * (`en_US.UTF-8`, `de_DE`, `C`): the first one that names a country decides.
 */
export function unitOfLocale(locales: readonly string[]): Unit {
  for (const locale of locales) {
    const country = /^[A-Za-z]{2,3}[_-]([A-Za-z]{2})(?![A-Za-z])/.exec(locale)?.[1];
    if (country) return FAHRENHEIT.has(country.toUpperCase()) ? 'fahrenheit' : 'celsius';
  }
  return 'celsius';
}

/** The unit to show: the setting, or the one of the region for `auto` and anything unknown. */
export function unitOf(setting: string, locales: readonly string[]): Unit {
  if (setting === 'celsius' || setting === 'fahrenheit') return setting;
  return unitOfLocale(locales);
}

/** A temperature in °C as a whole number in `unit`. */
export function degrees(celsius: number, unit: Unit): number {
  const value = Math.round(unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius);
  // Not "-0".
  return value === 0 ? 0 : value;
}

/** `8°`, `−3°`: whole degrees with a real minus sign and without the letter of the unit. */
export function formatTemperature(celsius: number, unit: Unit): string {
  const value = degrees(celsius, unit);
  return `${value < 0 ? '−' : ''}${Math.abs(value)}°`;
}

/** The hour of a local time: `14:00`, or `2 PM` on a twelve-hour clock. */
export function formatHour(time: string, hour12: boolean): string {
  const hour = Number(time.slice(11, 13));
  if (!hour12) return `${hour}:00`;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** The short name of the weekday of a local day (`2026-11-19` gives `Thu`), in `locale`. */
export function formatWeekday(date: string, locale?: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return at.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
}

/** A probability of precipitation is worth showing from here on. */
export const PRECIPITATION_SHOWN = 20;

// --- rain in the course of a day --------------------------------------------------

/** From this chance of precipitation on an hour counts as wet. */
export const WET_FROM = 40;

/** Codes that fall as snow. */
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

/** The hours of one local day of the place (`2026-11-20`), in order. */
export function hoursOn(hours: readonly Hour[], date: string): Hour[] {
  return hours.filter(hour => hour.time.startsWith(date));
}

/** When a day is wet: from the first wet hour to the end of the last one, as hours of the day. */
export interface WetSpell {
  kind: 'rain' | 'snow';
  /** 0 to 23. */
  from: number;
  /** 1 to 24, the end of the last wet hour. */
  to: number;
}

/** The wet part of a day, or null when no hour is likely wet. Snow when most wet hours are snow. */
export function wetSpell(hours: readonly Hour[]): WetSpell | null {
  const wet = hours.filter(hour => (hour.precipitation ?? 0) >= WET_FROM);
  const first = wet[0];
  const last = wet.at(-1);
  if (!first || !last) return null;
  const snow = wet.filter(hour => SNOW_CODES.has(hour.code)).length;
  return {
    kind: snow * 2 > wet.length ? 'snow' : 'rain',
    from: Number(first.time.slice(11, 13)),
    to: Number(last.time.slice(11, 13)) + 1,
  };
}

/** An hour of the day as a bound of a span: `13`, or `1 PM` on a twelve-hour clock. */
export function formatBound(hour: number, hour12: boolean): string {
  const h = hour % 24;
  if (!hour12) return String(hour === 24 ? 24 : h);
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}
