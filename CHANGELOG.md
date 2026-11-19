# Changelog

## [0.1.0] - unreleased

- First version: the weather of one place as a section in Up Next of [Visor](https://github.com/taulit/visor), built for the module API v1. Now with high, low and "feels like", the next six hours with the chance of precipitation, and the coming four days with a bar from low to high.
- The place is searched by name in the settings window (Open-Meteo geocoding) and stored with its coordinates rounded to two decimals. No automatic location.
- Celsius or Fahrenheit, by default after the region of the system.
- Data from Open-Meteo without an account or a key: asked for when the panel opens with data older than 30 minutes, never while the panel is closed. Offline the last data stays, with a line that says since when.
- English and German.
