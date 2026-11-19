import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { cleanQuery, geocodingUrl, languageOf, parsePlaces } from '../src/geocoding.js';
import { DEFAULT_GEOCODING_URL } from '../src/weather.js';
import { search as mockSearch } from './mock/fixtures.js';

/** An answer of the live API for "Freiburg", saved on 2026-11-19. */
const LIVE = readFileSync(new URL('./fixtures/search.json', import.meta.url), 'utf8');

describe('cleanQuery', () => {
  it('trims and needs two characters', () => {
    expect(cleanQuery('  Freiburg   im  Breisgau ')).toBe('Freiburg im Breisgau');
    expect(cleanQuery('F')).toBe('');
    expect(cleanQuery('  ')).toBe('');
    expect(cleanQuery('Ulm')).toBe('Ulm');
    expect(cleanQuery('東京')).toBe('東京');
  });

  it('cuts what is too long', () => {
    expect(Array.from(cleanQuery('a'.repeat(500)))).toHaveLength(80);
  });
});

describe('languageOf', () => {
  it('takes the language of the first usable locale', () => {
    expect(languageOf(['de_DE.UTF-8', 'de_DE', 'de', 'C'])).toBe('de');
    expect(languageOf(['C', 'pt_BR'])).toBe('pt');
    expect(languageOf(['EN_us'])).toBe('en');
    expect(languageOf(['C', 'POSIX'])).toBe('en');
    expect(languageOf([])).toBe('en');
  });
});

describe('geocodingUrl', () => {
  it('escapes what was typed', () => {
    const url = new URL(geocodingUrl(DEFAULT_GEOCODING_URL, 'São Paulo & co?', 'de'));
    expect(url.origin + url.pathname).toBe(DEFAULT_GEOCODING_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: 'São Paulo & co?',
      count: '8',
      language: 'de',
      format: 'json',
    });
  });
});

describe('parsePlaces', () => {
  it('reads an answer of the live API', () => {
    const places = parsePlaces(LIVE)!;
    expect(places).toHaveLength(8);
    expect(places[0]).toEqual({
      name: 'Freiburg im Breisgau',
      detail: 'Baden-Wurttemberg, Germany',
      latitude: 48,
      longitude: 7.85,
    });
    expect(places[2]).toMatchObject({ detail: 'Michigan, United States', longitude: -82.92 });
  });

  it('reads what the mock of the shell tests answers', () => {
    expect(parsePlaces(JSON.stringify(mockSearch('Frei')))).toHaveLength(3);
    expect(parsePlaces(JSON.stringify(mockSearch('Nowhere')))).toEqual([]);
  });

  it('knows nothing found from no answer', () => {
    expect(parsePlaces('{"generationtime_ms":0.12}')).toEqual([]);
    expect(parsePlaces('{"results":[]}')).toEqual([]);
    expect(parsePlaces('')).toBeNull();
    expect(parsePlaces('<html>')).toBeNull();
    expect(parsePlaces('[]')).toBeNull();
    expect(
      parsePlaces('{"error":true,"reason":"Parameter count must be between 1 and 100."}'),
    ).toBeNull();
    expect(parsePlaces('{"results":"many"}')).toBeNull();
  });

  it('leaves out what is no place and does not repeat the name', () => {
    const places = parsePlaces(
      JSON.stringify({
        results: [
          {
            name: 'Hamburg',
            latitude: 53.55,
            longitude: 10,
            admin1: 'Hamburg',
            country: 'Germany',
          },
          { name: 'Nowhere', latitude: 95, longitude: 10 },
          { name: '', latitude: 1, longitude: 1 },
          { name: 'Text', latitude: '53.55', longitude: 10 },
          null,
          { name: 'Null Island', latitude: 0, longitude: 0 },
        ],
      }),
    );
    expect(places).toEqual([
      { name: 'Hamburg', detail: 'Germany', latitude: 53.55, longitude: 10 },
      { name: 'Null Island', detail: '', latitude: 0, longitude: 0 },
    ]);
  });

  it('offers at most eight places', () => {
    const results = Array.from({ length: 50 }, (_, i) => ({
      name: `P${i}`,
      latitude: 1,
      longitude: 1,
    }));
    expect(parsePlaces(JSON.stringify({ results }))).toHaveLength(8);
  });
});
