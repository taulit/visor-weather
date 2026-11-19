// What the mock answers. The shapes are the ones of the live API (checked on
// 2026-11-19): https://open-meteo.com/en/docs and /en/docs/geocoding-api.

const ZONE = 'Europe/Berlin';

/** `2026-11-19T14:05` in ZONE for a moment. */
function local(at) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  })
    .format(at)
    .replace(' ', 'T');
}

// Hour by hour from the current one: clouds, then rain that eases off.
const HOURLY = [
  [8.4, 2, 5],
  [8.9, 3, 10],
  [8.1, 61, 55],
  [7.4, 63, 80],
  [6.8, 61, 65],
  [6.1, 80, 40],
  [5.6, 3, 15],
  [5.0, 2, 5],
];
// Today and the days after it: weather code, high, low, probability of precipitation.
const DAILY = [
  [61, 10.2, 4.1, 80],
  [3, 8.6, 2.8, 25],
  [0, 6.9, -1.2, 0],
  [71, 1.8, -3.4, 60],
  [2, 4.7, -2.1, 10],
  [1, 7.3, 0.4, 5],
];

/** The answer of /v1/forecast at the moment `at`. */
export function forecast(at, query = {}) {
  const now = local(at);
  const offset = (Date.parse(`${now}:00Z`) - Math.floor(at.getTime() / 60_000) * 60_000) / 1000;
  const hourStart = Math.floor(at.getTime() / 3_600_000) * 3_600_000;
  const light = time => {
    const hour = Number(time.slice(11, 13));
    return hour >= 7 && hour < 17 ? 1 : 0;
  };

  // Without forecast_hours the API answers every hour of the days asked; here from now on.
  const daysAsked = Math.min(Number(query.forecast_days) || 7, DAILY.length);
  const untilEnd = daysAsked * 24 - Number(now.slice(11, 13));
  const hours = Number(query.forecast_hours) || untilEnd;
  const today = Date.parse(`${now.slice(0, 10)}T00:00:00Z`);
  const hourly = {
    time: [],
    temperature_2m: [],
    weather_code: [],
    precipitation_probability: [],
    is_day: [],
  };
  for (let i = 0; i < hours; i++) {
    const time = local(new Date(hourStart + i * 3_600_000));
    // After the first hours every day is wet in the afternoon as much as its daily chance says.
    const [dayCode, , , dayRain] =
      DAILY[Math.round((Date.parse(`${time.slice(0, 10)}T00:00:00Z`) - today) / 86_400_000)] ??
      DAILY[0];
    const afternoon = Number(time.slice(11, 13)) >= 13 && Number(time.slice(11, 13)) < 17;
    const [temperature, code, rain] = HOURLY[i] ?? [
      5,
      dayCode,
      afternoon ? dayRain : Math.round(dayRain / 4),
    ];
    hourly.time.push(time);
    hourly.temperature_2m.push(temperature);
    hourly.weather_code.push(code);
    hourly.precipitation_probability.push(rain);
    hourly.is_day.push(light(time));
  }

  const days = daysAsked;
  const daily = {
    time: [],
    weather_code: [],
    temperature_2m_max: [],
    temperature_2m_min: [],
    precipitation_probability_max: [],
  };
  const noon = Date.parse(`${now.slice(0, 10)}T12:00:00Z`);
  for (let i = 0; i < days; i++) {
    const [code, high, low, rain] = DAILY[i];
    daily.time.push(new Date(noon + i * 86_400_000).toISOString().slice(0, 10));
    daily.weather_code.push(code);
    daily.temperature_2m_max.push(high);
    daily.temperature_2m_min.push(low);
    daily.precipitation_probability_max.push(rain);
  }

  return {
    latitude: Number(query.latitude) || 0,
    longitude: Number(query.longitude) || 0,
    generationtime_ms: 0.5,
    utc_offset_seconds: offset,
    timezone: ZONE,
    timezone_abbreviation: 'GMT+1',
    elevation: 278,
    current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C' },
    current: {
      time: now,
      interval: 900,
      temperature_2m: 8.4,
      apparent_temperature: 5.9,
      weather_code: 2,
      is_day: light(now),
    },
    hourly_units: { time: 'iso8601', temperature_2m: '°C' },
    hourly,
    daily_units: { time: 'iso8601', temperature_2m_max: '°C' },
    daily,
  };
}

const PLACES = [
  {
    id: 2925177,
    name: 'Freiburg im Breisgau',
    latitude: 47.9959,
    longitude: 7.85222,
    elevation: 278,
    country_code: 'DE',
    timezone: 'Europe/Berlin',
    country: 'Germany',
    admin1: 'Baden-Württemberg',
  },
  {
    id: 2660718,
    name: 'Fribourg',
    latitude: 46.80237,
    longitude: 7.15128,
    elevation: 610,
    country_code: 'CH',
    timezone: 'Europe/Zurich',
    country: 'Switzerland',
    admin1: 'Fribourg',
  },
  {
    id: 2925192,
    name: 'Freiberg',
    latitude: 50.91089,
    longitude: 13.33881,
    elevation: 412,
    country_code: 'DE',
    timezone: 'Europe/Berlin',
    country: 'Germany',
    admin1: 'Saxony',
  },
];

/** The answer of /v1/search: three places for a name that starts with "fr", nothing otherwise. */
export function search(name) {
  if (!name.toLowerCase().startsWith('fr')) return { generationtime_ms: 0.1 };
  return { results: PLACES, generationtime_ms: 0.4 };
}
