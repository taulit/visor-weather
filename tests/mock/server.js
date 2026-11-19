#!/usr/bin/env node
// A stand-in for the two APIs of Open-Meteo the module uses, for the shell
// tests and the screenshots: /v1/forecast and /v1/search. The forecast is
// made for the moment it is asked, so its hours are the next hours.
//
// Usage: node tests/mock/server.js --port PORT
//   GET /__mock/state           what was asked so far
//   GET /__mock/set?forecast=M  how /v1/forecast answers from now on:
//                               ok (default), down (503), garbage (no JSON), slow (after 30 s)
import http from 'node:http';

import { forecast, search } from './fixtures.js';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('usage: server.js --port PORT');
  process.exit(2);
}

const state = { forecasts: 0, searches: 0, lastForecast: null, lastSearch: null, mode: 'ok' };

const json = (response, status, body) => {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(text);
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const query = Object.fromEntries(url.searchParams);
  if (url.pathname === '/__mock/state') return json(response, 200, state);
  if (url.pathname === '/__mock/set') {
    if (query.forecast) state.mode = query.forecast;
    return json(response, 200, state);
  }
  if (url.pathname === '/v1/forecast') {
    state.forecasts += 1;
    state.lastForecast = query;
    if (state.mode === 'down') return json(response, 503, { error: true, reason: 'mock is down' });
    if (state.mode === 'garbage') {
      response.writeHead(200, { 'content-type': 'text/html' });
      return response.end('<html>not the API</html>');
    }
    if (state.mode === 'slow') return setTimeout(() => response.destroy(), 30_000);
    return json(response, 200, forecast(new Date(), query));
  }
  if (url.pathname === '/v1/search') {
    state.searches += 1;
    state.lastSearch = query;
    return json(response, 200, search(query.name ?? ''));
  }
  json(response, 404, { error: true, reason: 'unknown path' });
});
server.listen(port, '127.0.0.1');
