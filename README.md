# AeroAM

A responsive aviation dashboard that runs as a static web app; no build step is required.

## Run

Open `index.html` in a modern browser, or serve this directory from a local HTTP server. Browser geolocation requires HTTPS or localhost. The map, fonts, and live data need an internet connection. AeroAM starts in its full-screen Standby Mode and uses the folder menu to navigate.

## Available integrations

- **Map:** MapLibre GL JS vector map styles from OpenFreeMap, with OpenStreetMap attribution and airport labels from OpenStreetMap data. OpenStreetMap's public raster tile server is not used.
- **Aircraft:** OpenSky Network state vectors for the current map bounds, refreshed every 30 seconds. Anonymous access is subject to OpenSky's current availability and rate limits. A production deployment should proxy and cache this feed through its own service.
- **Aircraft detail enrichment:** Per-selected-aircraft ADS-B detail via ADS-B.lol, with HexDB fallback when available. Coverage and rate limits vary; not every aircraft has a registry record. The detail panel includes transponder-provided fields and marks absent route/airline values as unavailable.
- **Weather and daylight:** Open-Meteo current conditions, sunrise, and sunset; airport METAR from AviationWeather.gov for airports with a known ICAO code.
- **Locations:** Browser geolocation, coordinate entry, and Nominatim place search.

Settings, accent colour, and Traffic Board column visibility/order are stored in browser local storage. At startup, AeroAM always opens in Standby Mode.

## Integrations not included

LiveATC feeds, complete airport arrival/departure schedules, airway overlays, and procedure/airport charts need supported provider data and, in some cases, licenses. Airport identifiers are looked up in OpenStreetMap data; the METAR is requested from AviationWeather.gov when a valid ICAO code is available. The airport panel reports only METAR and ground aircraft visible in the position feed; it does not invent scheduled movements or chart availability.

AeroAM Flight remains an independent, clearly marked placeholder. A full worldwide terrain simulator needs a dedicated flight-simulation engine, terrain/airport datasets, and aircraft assets; those are not bundled or simulated by the dashboard.

The public services used here are suitable for development and demonstration, not guaranteed production SLAs. Follow each provider's terms and add a backend proxy/cache and an appropriately licensed data plan before production use.
