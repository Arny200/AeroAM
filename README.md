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
- **Aircraft:** OpenSky Network state vectors for the current map bounds, fetched through the same-origin Express endpoint at `/api/aircraft` and refreshed every 60 seconds. The server coalesces identical requests, caches recent results, returns short-lived stale results when OpenSky is temporarily unavailable, refreshes OAuth2 tokens, and reports upstream rate limits for client-side backoff. The browser does not call OpenSky directly, avoiding the provider's browser CORS restrictions.
- **Aircraft detail enrichment:** Per-selected-aircraft ADS-B detail via ADS-B.lol, with HexDB fallback when available. Coverage and rate limits vary; not every aircraft has a registry record. The detail panel includes transponder-provided fields and marks absent route/airline values as unavailable.
- **Weather and daylight:** Open-Meteo current conditions, sunrise, and sunset; airport METAR from AviationWeather.gov for airports with a known ICAO code.
- **Locations:** Browser geolocation, coordinate entry, and Nominatim place search.

Settings, accent colour, and Traffic Board column visibility/order are stored in browser local storage. At startup, AeroAM always opens in Standby Mode.

## Integrations not included

LiveATC feeds, complete airport arrival/departure schedules, airway overlays, and procedure/airport charts need supported provider data and, in some cases, licenses. Airport identifiers are looked up in OpenStreetMap data; the METAR is requested from AviationWeather.gov when a valid ICAO code is available. The airport panel reports only METAR and ground aircraft visible in the position feed; it does not invent scheduled movements or chart availability.

AeroAM Flight remains an independent, clearly marked placeholder. A full worldwide terrain simulator needs a dedicated flight-simulation engine, terrain/airport datasets, and aircraft assets; those are not bundled or simulated by the dashboard.

Public data services are subject to their own terms, quotas, and availability; the OpenSky proxy/cache in this repository is a basic single-instance cache, not a distributed cache or production SLA.

### OpenSky credentials on Render

Create an API client in your OpenSky account, then add these secrets in the Render Web Service **Environment** settings:

- `OPENSKY_CLIENT_ID`
- `OPENSKY_CLIENT_SECRET`

The Render Blueprint declares both as unsynced secrets. The server exchanges them using OpenSky's OAuth2 client-credentials flow, refreshes expired/near-expiry tokens, and retries a single unauthorized request. If credentials are omitted, the server uses OpenSky's anonymous allowance, which is much more limited and can return `429` after credits are exhausted. The browser now shows rate-limit status and waits for the provider's retry interval instead of repeatedly polling.
