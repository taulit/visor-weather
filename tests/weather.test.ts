import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FORECAST_URL,
  conditionOf,
  degrees,
  endpoint,
  forecastUrl,
  formatHour,
  formatTemperature,
  formatWeekday,
  parseForecast,
  placeOf,
  placeTime,
  roundCoordinate,
  samePlace,
  unitOf,
  unitOfLocale,
  viewOf,
  type Forecast,
  formatBound,
  hoursOn,
  wetSpell,
} from '../src/weather.js';
import { forecast as mockForecast } from './mock/fixtures.js';

/** An answer of the live API for Berlin, saved on 2026-11-19 at 10:15 local time. */
const LIVE = readFileSync(new URL('./fixtures/forecast.json', import.meta.url), 'utf8');
/** 2026-11-19 10:15 in Berlin (UTC+1). */
const THEN = Date.UTC(2026, 10, 19, 9, 15);
const HOUR = 3_600_000;
const limits = { hours: 5, days: 4 };

const live = (): Forecast => {
  const forecast = parseForecast(LIVE);
  if (!forecast) throw new Error('the fixture is no forecast');
  return forecast;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the answer of the API, taken apart on purpose
const changed = (change: (data: Record<string, any>) => void): string => {
  const data = JSON.parse(LIVE);
  change(data);
  return JSON.stringify(data);
};

describe('placeOf', () => {
  it('needs a name and coordinates on the globe', () => {
    expect(placeOf('Berlin', 52.52, 13.41)).toEqual({
      name: 'Berlin',
      latitude: 52.52,
      longitude: 13.41,
    });
    expect(placeOf('', 52.52, 13.41)).toBeNull();
    expect(placeOf('   ', 52.52, 13.41)).toBeNull();
    expect(placeOf('Berlin', 91, 13.41)).toBeNull();
    expect(placeOf('Berlin', 52.52, -181)).toBeNull();
    expect(placeOf('Berlin', Number.NaN, 13.41)).toBeNull();
  });

  it('rounds to two decimals, about one kilometre', () => {
    expect(placeOf(' Freiburg ', 47.9959, 7.85222)).toEqual({
      name: 'Freiburg',
      latitude: 48,
      longitude: 7.85,
    });
    expect(roundCoordinate(-33.86785)).toBe(-33.87);
  });

  it('compares places', () => {
    const berlin = placeOf('Berlin', 52.52, 13.41);
    expect(samePlace(berlin, placeOf('Berlin', 52.52, 13.41))).toBe(true);
    expect(samePlace(berlin, placeOf('Berlin', 52.53, 13.41))).toBe(false);
    expect(samePlace(berlin, null)).toBe(false);
    expect(samePlace(null, null)).toBe(true);
  });
});

describe('endpoint', () => {
  const fallback = DEFAULT_FORECAST_URL;
  it('takes https anywhere and plain http on this machine only', () => {
    expect(endpoint('https://weather.example.org/v1/forecast', fallback)).toBe(
      'https://weather.example.org/v1/forecast',
    );
    expect(endpoint('http://127.0.0.1:8080/v1/forecast', fallback)).toBe(
      'http://127.0.0.1:8080/v1/forecast',
    );
    expect(endpoint('http://localhost/v1/forecast', fallback)).toBe('http://localhost/v1/forecast');
    expect(endpoint('http://weather.example.org/v1/forecast', fallback)).toBe(fallback);
    expect(endpoint('http://127.0.0.1.example.org/v1/forecast', fallback)).toBe(fallback);
  });

  it('falls back for anything that is no plain address', () => {
    for (const bad of ['', 'ftp://example.org/x', 'example.org', 'https://', 'file:///etc/passwd'])
      expect(endpoint(bad, fallback)).toBe(fallback);
    expect(endpoint('https://user:secret@example.org/v1', fallback)).toBe(fallback);
    expect(endpoint('http://127.0.0.1@example.org/v1', fallback)).toBe(fallback);
  });

  it('drops query and fragment, which the request brings itself', () => {
    expect(endpoint('https://example.org/v1/forecast?apikey=1#x', fallback)).toBe(
      'https://example.org/v1/forecast',
    );
    expect(endpoint('https://example.org', fallback)).toBe('https://example.org/');
  });
});

describe('forecastUrl', () => {
  it('asks for now, hours and days in °C and the local time of the place', () => {
    const url = new URL(forecastUrl(DEFAULT_FORECAST_URL, placeOf('Berlin', 52.52, 13.41)!));
    expect(url.origin + url.pathname).toBe(DEFAULT_FORECAST_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '52.52',
      longitude: '13.41',
      current: 'temperature_2m,apparent_temperature,weather_code,is_day',
      hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      temperature_unit: 'celsius',
      timezone: 'auto',
      forecast_days: '6',
    });
  });

  it('sends two decimals and never the name of the place', () => {
    const url = forecastUrl(DEFAULT_FORECAST_URL, {
      name: 'Freiburg im Breisgau',
      latitude: 47.9959,
      longitude: -7.85222,
    });
    expect(url).toContain('latitude=48.00&longitude=-7.85&');
    expect(url).not.toContain('Freiburg');
  });
});

describe('parseForecast', () => {
  it('reads an answer of the live API', () => {
    const forecast = live();
    expect(forecast.utcOffset).toBe(3600);
    expect(forecast.current).toEqual({
      time: '2026-11-19T10:15',
      temperature: 7.5,
      feelsLike: 5.4,
      code: 3,
      isDay: true,
    });
    expect(forecast.hours).toHaveLength(24);
    expect(forecast.hours[0]).toEqual({
      time: '2026-11-19T10:00',
      temperature: 7.3,
      code: 3,
      isDay: true,
      precipitation: 0,
    });
    expect(forecast.days).toHaveLength(6);
    expect(forecast.days[0]).toEqual({
      date: '2026-11-19',
      code: 63,
      high: 10.1,
      low: 6,
      precipitation: 98,
    });
  });

  it('reads what the mock of the shell tests answers', () => {
    const forecast = parseForecast(JSON.stringify(mockForecast(new Date(THEN), {})));
    expect(forecast?.utcOffset).toBe(3600);
    expect(forecast?.current.time).toBe('2026-11-19T10:15');
    expect(forecast?.hours[0]?.time).toBe('2026-11-19T10:00');
    expect(forecast?.days.map(day => day.date).slice(0, 2)).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('refuses what is no forecast', () => {
    expect(parseForecast('')).toBeNull();
    expect(parseForecast('<html>')).toBeNull();
    expect(parseForecast('[]')).toBeNull();
    expect(parseForecast('null')).toBeNull();
    expect(parseForecast('{"generationtime_ms":0.06}')).toBeNull();
    expect(
      parseForecast('{"error":true,"reason":"Latitude must be in range of -90 to 90°."}'),
    ).toBeNull();
    expect(parseForecast(changed(data => delete data.current))).toBeNull();
    expect(parseForecast(changed(data => (data.current.temperature_2m = null)))).toBeNull();
    expect(parseForecast(changed(data => (data.current.temperature_2m = '7.5')))).toBeNull();
    expect(parseForecast(changed(data => (data.current.time = 1795079700)))).toBeNull();
    expect(parseForecast(changed(data => (data.current.time = '19.11.2026 10:15')))).toBeNull();
  });

  it('keeps the current weather when hours or days are missing', () => {
    const forecast = parseForecast(
      changed(data => {
        delete data.hourly;
        data.daily = 'none';
      }),
    );
    expect(forecast?.current.temperature).toBe(7.5);
    expect(forecast?.hours).toEqual([]);
    expect(forecast?.days).toEqual([]);
  });

  it('leaves out single hours and days with a missing value', () => {
    const forecast = parseForecast(
      changed(data => {
        data.hourly.temperature_2m[1] = null;
        data.hourly.time[2] = 'soon';
        data.hourly.precipitation_probability[3] = null;
        data.daily.temperature_2m_max[1] = null;
        data.daily.weather_code[2] = '61';
      }),
    );
    expect(forecast?.hours).toHaveLength(22);
    expect(forecast?.hours[1]?.time).toBe('2026-11-19T13:00');
    expect(forecast?.hours[1]?.precipitation).toBeNull();
    expect(forecast?.days.map(day => day.date)).toEqual([
      '2026-11-19',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
    ]);
  });

  it('copes with columns of different lengths and odd values', () => {
    const forecast = parseForecast(
      changed(data => {
        data.hourly.weather_code = data.hourly.weather_code.slice(0, 5);
        data.hourly.precipitation_probability[0] = 250;
        data.hourly.is_day = 'yes';
        data.daily.temperature_2m_max[0] = 1;
        data.daily.temperature_2m_min[0] = 9;
        delete data.utc_offset_seconds;
        delete data.current.apparent_temperature;
      }),
    );
    expect(forecast?.hours).toHaveLength(5);
    expect(forecast?.hours[0]?.precipitation).toBe(100);
    expect(forecast?.hours[0]?.isDay).toBe(true);
    expect(forecast?.days[0]).toMatchObject({ high: 9, low: 1 });
    expect(forecast?.utcOffset).toBe(0);
    expect(forecast?.current.feelsLike).toBeNull();
  });

  it('reads at most 168 hours and 16 days', () => {
    const forecast = parseForecast(
      changed(data => {
        for (const key of Object.keys(data.hourly))
          data.hourly[key] = Array.from({ length: 500 }, () => data.hourly[key][0]);
        for (const key of Object.keys(data.daily))
          data.daily[key] = Array.from({ length: 500 }, () => data.daily[key][0]);
      }),
    );
    expect(forecast?.hours).toHaveLength(168);
    expect(forecast?.days).toHaveLength(16);
  });
});

describe('viewOf', () => {
  it('tells the local time of the place', () => {
    expect(placeTime(THEN, 3600)).toBe('2026-11-19T10:15');
    expect(placeTime(THEN, -5 * 3600)).toBe('2026-11-19T04:15');
    expect(placeTime(Date.UTC(2026, 11, 31, 20), 9.5 * 3600)).toBe('2027-01-01T05:30');
  });

  it('shows the hours after this one and the days after today', () => {
    const view = viewOf(live(), THEN, limits)!;
    expect(view.current.temperature).toBe(7.5);
    expect(view.current.feelsLike).toBe(5.4);
    expect(view.today).toMatchObject({ date: '2026-11-19', high: 10.1, low: 6 });
    expect(view.hours.map(hour => hour.time.slice(11))).toEqual([
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
    ]);
    expect(view.days.map(day => day.date)).toEqual([
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
    ]);
  });

  it('lets the forecast stand in once the hour has changed', () => {
    const view = viewOf(live(), THEN + 3 * HOUR, limits)!;
    // 13:15: what was forecast for 13:00, and no "feels like" for it.
    expect(view.current).toEqual({
      time: '2026-11-19T13:00',
      temperature: 9.2,
      feelsLike: null,
      code: 61,
      isDay: true,
    });
    expect(view.hours[0]?.time).toBe('2026-11-19T14:00');
    expect(view.today?.date).toBe('2026-11-19');
  });

  it('moves on to the next day after midnight', () => {
    const view = viewOf(live(), THEN + 15 * HOUR, limits)!;
    expect(view.current.time).toBe('2026-11-20T01:00');
    expect(view.today?.date).toBe('2026-11-20');
    expect(view.days[0]?.date).toBe('2026-11-21');
    // 24 hours were asked for at 10:00, so eight are left.
    expect(view.hours).toHaveLength(5);
    expect(viewOf(live(), THEN + 22 * HOUR, limits)!.hours).toHaveLength(1);
  });

  it('says nothing when the forecast no longer reaches now', () => {
    expect(viewOf(live(), THEN + 24 * HOUR, limits)).toBeNull();
    expect(viewOf(live(), THEN + 30 * 24 * HOUR, limits)).toBeNull();
  });

  it('takes the answer as now when the clock of this machine is behind it', () => {
    // 09:59:30 here, the server already said 10:15.
    const view = viewOf(live(), THEN - 16 * 60_000, limits)!;
    expect(view.current.temperature).toBe(7.5);
    expect(view.hours[0]?.time).toBe('2026-11-19T11:00');
    expect(view.today?.date).toBe('2026-11-19');
    expect(viewOf(live(), THEN - 30 * 24 * HOUR, limits)?.current.feelsLike).toBe(5.4);
  });

  it('copes with a forecast without hours and days', () => {
    const bare: Forecast = { ...live(), hours: [], days: [] };
    expect(viewOf(bare, THEN, limits)).toMatchObject({ today: null, hours: [], days: [] });
    expect(viewOf(bare, THEN + HOUR, limits)).toBeNull();
  });
});

describe('conditionOf', () => {
  it('names every code of the WMO table Open-Meteo documents', () => {
    const codes = [
      0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85,
      86, 95, 96, 99,
    ];
    for (const code of codes) {
      const condition = conditionOf(code);
      expect(condition.text, `code ${code}`).not.toBe('');
      expect(condition.icon, `code ${code}`).toMatch(/^weather-[a-z-]+-symbolic$/);
    }
  });

  it('uses only icons the Adwaita icon theme has', () => {
    const adwaita = new Set([
      'weather-clear-night-symbolic',
      'weather-clear-symbolic',
      'weather-few-clouds-night-symbolic',
      'weather-few-clouds-symbolic',
      'weather-fog-symbolic',
      'weather-overcast-symbolic',
      'weather-severe-alert-symbolic',
      'weather-showers-scattered-symbolic',
      'weather-showers-symbolic',
      'weather-snow-symbolic',
      'weather-storm-symbolic',
      'weather-tornado-symbolic',
      'weather-windy-symbolic',
    ]);
    for (let code = -1; code <= 100; code++) {
      expect(adwaita.has(conditionOf(code, true).icon), `code ${code}`).toBe(true);
      expect(adwaita.has(conditionOf(code, false).icon), `code ${code} at night`).toBe(true);
    }
  });

  it('maps the families of codes', () => {
    expect(conditionOf(0)).toEqual({ text: 'Clear', icon: 'weather-clear-symbolic' });
    expect(conditionOf(2).icon).toBe('weather-few-clouds-symbolic');
    expect(conditionOf(3)).toEqual({ text: 'Overcast', icon: 'weather-overcast-symbolic' });
    expect(conditionOf(45).icon).toBe('weather-fog-symbolic');
    expect(conditionOf(53).icon).toBe('weather-showers-scattered-symbolic');
    expect(conditionOf(63)).toEqual({ text: 'Rain', icon: 'weather-showers-symbolic' });
    expect(conditionOf(75).icon).toBe('weather-snow-symbolic');
    expect(conditionOf(86).icon).toBe('weather-snow-symbolic');
    expect(conditionOf(99).icon).toBe('weather-storm-symbolic');
  });

  it('has a moon for clear and nearly clear nights only', () => {
    expect(conditionOf(0, false).icon).toBe('weather-clear-night-symbolic');
    expect(conditionOf(1, false).icon).toBe('weather-few-clouds-night-symbolic');
    expect(conditionOf(2, false).icon).toBe('weather-few-clouds-night-symbolic');
    expect(conditionOf(3, false).icon).toBe('weather-overcast-symbolic');
    expect(conditionOf(61, false).icon).toBe('weather-showers-symbolic');
  });

  it('shows clouds without words for a code it does not know', () => {
    for (const code of [4, 50, 100, -1, 1.5, Number.NaN])
      expect(conditionOf(code)).toEqual({ text: '', icon: 'weather-overcast-symbolic' });
  });
});

describe('units', () => {
  it('uses Fahrenheit where the region does', () => {
    expect(unitOfLocale(['en_US.UTF-8', 'en_US', 'en', 'C'])).toBe('fahrenheit');
    expect(unitOfLocale(['de_DE.UTF-8', 'de_DE', 'de', 'C'])).toBe('celsius');
    expect(unitOfLocale(['en_GB.UTF-8'])).toBe('celsius');
    expect(unitOfLocale(['es_PR'])).toBe('fahrenheit');
    expect(unitOfLocale(['en-US'])).toBe('fahrenheit');
    expect(unitOfLocale(['sr_RS@latin'])).toBe('celsius');
  });

  it('lets the first locale with a country decide', () => {
    expect(unitOfLocale(['de', 'C', 'en_US'])).toBe('fahrenheit');
    expect(unitOfLocale(['de_AT', 'en_US'])).toBe('celsius');
    expect(unitOfLocale(['C', 'POSIX'])).toBe('celsius');
    expect(unitOfLocale([])).toBe('celsius');
  });

  it('follows the setting, and the region for auto and anything unknown', () => {
    expect(unitOf('celsius', ['en_US'])).toBe('celsius');
    expect(unitOf('fahrenheit', ['de_DE'])).toBe('fahrenheit');
    expect(unitOf('auto', ['en_US'])).toBe('fahrenheit');
    expect(unitOf('kelvin', ['de_DE'])).toBe('celsius');
  });
});

describe('texts', () => {
  it('writes whole degrees with a real minus sign', () => {
    expect(formatTemperature(7.5, 'celsius')).toBe('8°');
    expect(formatTemperature(7.4, 'celsius')).toBe('7°');
    expect(formatTemperature(-3.4, 'celsius')).toBe('−3°');
    expect(formatTemperature(0, 'celsius')).toBe('0°');
    expect(formatTemperature(-0.4, 'celsius')).toBe('0°');
    expect(formatTemperature(-0.5, 'celsius')).toBe('0°');
    expect(formatTemperature(-0.6, 'celsius')).toBe('−1°');
  });

  it('converts to Fahrenheit', () => {
    expect(degrees(0, 'fahrenheit')).toBe(32);
    expect(degrees(100, 'fahrenheit')).toBe(212);
    expect(degrees(-40, 'fahrenheit')).toBe(-40);
    expect(formatTemperature(8.4, 'fahrenheit')).toBe('47°');
    expect(formatTemperature(-20, 'fahrenheit')).toBe('−4°');
    expect(formatTemperature(-17.8, 'fahrenheit')).toBe('0°');
  });

  it('writes the hour for both clocks', () => {
    expect(formatHour('2026-11-19T14:00', false)).toBe('14:00');
    expect(formatHour('2026-11-19T09:00', false)).toBe('9:00');
    expect(formatHour('2026-11-19T00:00', false)).toBe('0:00');
    expect(formatHour('2026-11-19T14:00', true)).toBe('2 PM');
    expect(formatHour('2026-11-19T00:00', true)).toBe('12 AM');
    expect(formatHour('2026-11-19T12:00', true)).toBe('12 PM');
    expect(formatHour('2026-11-19T11:00', true)).toBe('11 AM');
  });

  it('names the weekday of a day, whatever the time zone of this machine', () => {
    expect(formatWeekday('2026-11-19', 'en-US')).toBe('Thu');
    expect(formatWeekday('2026-11-22', 'en-US')).toBe('Sun');
    expect(formatWeekday('2027-01-01', 'en-US')).toBe('Fri');
    expect(formatWeekday('2026-11-20', 'de-DE')).toMatch(/^Fr\.?$/);
  });
});

describe('wetSpell', () => {
  const hour = (h: number, precipitation: number | null, code = 61) => ({
    time: `2026-11-20T${String(h).padStart(2, '0')}:00`,
    temperature: 5,
    code,
    isDay: true,
    precipitation,
  });

  it('spans the first to the end of the last wet hour', () => {
    const hours = [hour(12, 10), hour(13, 55), hour(14, 30), hour(15, 80), hour(16, 20)];
    expect(wetSpell(hours)).toEqual({ kind: 'rain', from: 13, to: 16 });
  });

  it('is null on a dry day and without numbers', () => {
    expect(wetSpell([hour(9, 20), hour(10, null)])).toBeNull();
  });

  it('says snow when most wet hours are snow', () => {
    expect(wetSpell([hour(6, 60, 73), hour(7, 70, 71), hour(8, 50, 61)])?.kind).toBe('snow');
  });

  it('keeps the hours of one day', () => {
    const other = { ...hour(13, 90), time: '2026-11-21T13:00' };
    expect(hoursOn([hour(13, 90), other], '2026-11-20')).toHaveLength(1);
  });

  it('writes the bounds for both clocks', () => {
    expect(formatBound(13, false)).toBe('13');
    expect(formatBound(24, false)).toBe('24');
    expect(formatBound(13, true)).toBe('1 PM');
    expect(formatBound(24, true)).toBe('12 AM');
  });
});
