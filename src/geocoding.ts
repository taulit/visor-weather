// The place search of Open-Meteo, used by the settings window only. Pure
// TypeScript without imports.
//
// API: https://open-meteo.com/en/docs/geocoding-api (checked against the live API on 2026-11-19).
import { roundCoordinate } from './weather.js';

/** The API answers nothing for fewer characters. */
export const MIN_QUERY = 2;
const MAX_QUERY = 80;
const MAX_RESULTS = 8;

export interface PlaceResult {
  name: string;
  /** Region and country, to tell places of the same name apart: `Baden-Württemberg, Germany`. */
  detail: string;
  latitude: number;
  longitude: number;
}

/** What is asked for: trimmed, single spaces, at most 80 characters. Empty when it is too short. */
export function cleanQuery(text: string): string {
  const query = Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, MAX_QUERY).join('');
  return Array.from(query).length < MIN_QUERY ? '' : query;
}

/** The language of the names in the answer, from locale names in order of preference. */
export function languageOf(locales: readonly string[]): string {
  for (const locale of locales) {
    const language = /^([A-Za-z]{2})(?![A-Za-z])/.exec(locale)?.[1];
    if (language) return language.toLowerCase();
  }
  return 'en';
}

export function geocodingUrl(base: string, query: string, language: string): string {
  return `${base}?name=${encodeURIComponent(query)}&count=${MAX_RESULTS}&language=${encodeURIComponent(language)}&format=json`;
}

/** Reads the answer of the search. Null when it is not one; an empty list when nothing was found. */
export function parsePlaces(text: string): PlaceResult[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const answer = data as Record<string, unknown>;
  if (answer.error === true) return null;
  // Without a match the API leaves `results` out.
  if (answer.results === undefined) return [];
  if (!Array.isArray(answer.results)) return null;

  const places: PlaceResult[] = [];
  for (const entry of answer.results.slice(0, MAX_RESULTS) as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, latitude, longitude, admin1, country } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90)
      continue;
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180)
      continue;
    const parts = [admin1, country].filter(
      (part): part is string => typeof part === 'string' && part.trim() !== '' && part !== name,
    );
    places.push({
      name: name.trim(),
      detail: parts.join(', '),
      latitude: roundCoordinate(latitude),
      longitude: roundCoordinate(longitude),
    });
  }
  return places;
}
