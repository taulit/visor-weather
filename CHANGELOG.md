# Changelog

## [0.1.0] - 2026-11-19

- First version: the weather of one place as a section in Up Next of [Visor](https://github.com/taulit/visor), built for the module API v1. Now and the next five hours in one row with the chance of precipitation; behind "Days" the coming four days with low and high, when it rains ("Rain 13–17") and a bar per hour for the chance of rain.
- The place is searched by name in the settings window (Open-Meteo geocoding) and stored with its coordinates rounded to two decimals. No automatic location.
- Celsius or Fahrenheit, by default after the region of the system.
- Data from Open-Meteo without an account or a key: asked for when the panel opens with data older than 30 minutes, never while the panel is closed. Offline the last data stays, with a line that says since when.
- English and German.
