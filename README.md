# AeroAM

A responsive aviation dashboard served by Express.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open `http://localhost:3000`. The server uses the `PORT` environment variable when provided and binds to `0.0.0.0`, as required by Render Web Services. `/health` returns `200 OK` for health checks. Browser geolocation requires HTTPS or localhost. The map, fonts, and live data need an internet connection. AeroAM starts in its full-screen Standby Mode and uses the folder menu to navigate.

## Deploy to Render

Create a **Web Service** for this repository and configure:

- **Runtime:** Node
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Health check path:** `/health`

Render provides the listening port through `PORT`; no fixed port environment variable is needed.

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
