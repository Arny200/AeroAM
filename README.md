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

- **Map:** MapLibre GL JS vector map styles from OpenFreeMap, with OpenStreetMap attribution. Worldwide airport/aerodrome records and published frequencies come from the public-domain OurAirports dataset, cached by the Express service; overlapping markers are grouped so each airport remains selectable.
- **Aircraft:** OpenSky Network state vectors for the current map bounds, fetched through the same-origin Express endpoint at `/api/aircraft` and refreshed every 60 seconds. The server coalesces identical requests, caches recent results, returns short-lived stale results when OpenSky is temporarily unavailable, refreshes OAuth2 tokens, and reports upstream rate limits for client-side backoff. The browser does not call OpenSky directly, avoiding the provider's browser CORS restrictions.
- **Aircraft detail enrichment:** Per-selected-aircraft ADS-B detail via ADS-B.lol, with HexDB fallback when available. Coverage and rate limits vary; unavailable fields are omitted. Available position, registry, route, and type data is shared with the detail panel and configurable Traffic Board.
- **Weather and daylight:** Open-Meteo current conditions, sunrise, and sunset; airport METAR from AviationWeather.gov through the same-origin service.
- **Locations:** Browser geolocation, coordinate entry, and Nominatim place search through a rate-limited same-origin proxy.
- **Radio and music:** Secure Irish radio streams from Radio Browser, Cork's 96FM official player, and the Spotify embed for user-provided track, album, playlist, show, or episode links. The optional Now Playing pill reflects radio playback and Spotify embed playback events.
- **Space and flight metrics:** Optional ISS position overlay from Where the ISS at; live speed, altitude, airline-prefix, and ADS-B category summaries; approximate aircraft-type-based cruise CO₂ rate on selected flights.
- **Incidents and quizzes:** Recent aviation headlines from The Aviation Herald, sorted by reported occurrence time by default with severity/type/location sorting; single- or multi-player airport quizzes with custom names, optional timers, and score tracking.

Settings, accent colour, quiz preferences, and Traffic Board column visibility/order are stored in browser local storage. The default theme is AMOLED; startup always opens in full-screen Standby Mode. The About page credits Arnold Mathew and notes VS Code, GitHub, and Render.

## Integrations not included

LiveATC audio and procedure/airport charts need supported, licensed provider data; airport cards link to LiveATC's airport search, and chart UI is omitted. Active arrival/departure runway use and scheduled airport movements are not included in the live position source. Airport cards show published frequencies and only report ground aircraft visible in the current position feed.

ACARS message decoding is not available from the connected sources, so no ACARS UI is shown. Aircraft photos are displayed only when provided by the selected aircraft's metadata source.

Public data services are subject to their own terms, quotas, and availability; the OpenSky proxy/cache in this repository is a basic single-instance cache, not a distributed cache or production SLA.

### OpenSky credentials on Render

Create an API client in your OpenSky account, then add these secrets in the Render Web Service **Environment** settings:

- `OPENSKY_CLIENT_ID`
- `OPENSKY_CLIENT_SECRET`

The Render Blueprint declares both as unsynced secrets. The server exchanges them using OpenSky's OAuth2 client-credentials flow, refreshes expired/near-expiry tokens, and retries a single unauthorized request. If credentials are omitted, the server uses OpenSky's anonymous allowance, which is much more limited and can return `429` after credits are exhausted. The browser now shows rate-limit status and waits for the provider's retry interval instead of repeatedly polling.
