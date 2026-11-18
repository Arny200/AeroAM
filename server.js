"use strict";

const express = require("express");

const app = express();
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = "0.0.0.0";
const publicDirectory = __dirname;
const openSkyApi = "https://opensky-network.org/api";
const openSkyTokenUrl = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const airportDataUrl = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main";
const cacheTtlMs = 15_000;
const staleTtlMs = 120_000;
const cache = new Map();
const inFlight = new Map();
const airportCache = new Map();
const metarCache = new Map();
const geocodeCache = new Map();
const geocodePending = new Map();
let airportDataset;
let airportDatasetRequest;
const radioCache = { expiresAt: 0, stations: [] };
const incidentCache = { expiresAt: 0, incidents: [] };
let issCache;
let issRequest;
let geocodeQueue = Promise.resolve();
let geocodeLastRequestAt = 0;
let openSkyToken;
let tokenRequest;

app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.status(200).type("text/plain").send("ok");
});

app.get("/api/airports", async (request, response) => {
  const keys = ["west", "south", "east", "north"];
  const values = Object.fromEntries(keys.map((key) => [key, Number(request.query[key])]));
  const longitudeWidth = values.west <= values.east ? values.east - values.west : 360 - values.west + values.east;
  if (keys.some((key) => request.query[key] === undefined || !Number.isFinite(values[key])) ||
      values.south < -85 || values.north > 85 || values.south >= values.north ||
      values.west < -180 || values.west > 180 || values.east < -180 || values.east > 180 ||
      values.west === values.east || values.north - values.south > 32 || longitudeWidth > 56) {
    return apiError(response, 400, "invalid_bounds", "Airport lookup bounds are invalid or too wide.");
  }

  const bounds = Object.fromEntries(keys.map((key) => [key, Number(values[key].toFixed(3))]));
  const cacheKey = keys.map((key) => bounds[key]).join(",");
  const cached = airportCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 600_000) {
    response.setHeader("X-AeroAM-Cache", "HIT");
    return response.json({ airports: cached.airports });
  }
  if (airportCache.has(`${cacheKey}:pending`)) {
    try {
      const airports = await airportCache.get(`${cacheKey}:pending`);
      response.setHeader("X-AeroAM-Cache", "COALESCED");
      return response.json({ airports });
    } catch (error) {
      console.error("Airport dataset lookup failed:", error.message);
      return apiError(response, 502, "airport_data_unavailable", "Airport data is temporarily unavailable.");
    }
  }

  const lookup = (async () => {
    const dataset = await getAirportDataset();
    const airports = dataset.airports.filter((airport) => {
      const inLongitudeRange = bounds.west <= bounds.east
        ? airport.lon >= bounds.west && airport.lon <= bounds.east
        : airport.lon >= bounds.west || airport.lon <= bounds.east;
      return airport.lat >= bounds.south && airport.lat <= bounds.north && inLongitudeRange;
    });
    airportCache.set(cacheKey, { airports, fetchedAt: Date.now() });
    return airports;
  })();
  airportCache.set(`${cacheKey}:pending`, lookup);
  try {
    const airports = await lookup;
    response.setHeader("X-AeroAM-Cache", "MISS");
    return response.json({ airports });
  } catch (error) {
    console.error("Airport dataset lookup failed:", error.message);
    if (cached) {
      response.setHeader("X-AeroAM-Cache", "STALE");
      return response.json({ airports: cached.airports, stale: true });
    }
    return apiError(response, 502, "airport_data_unavailable", "Airport data is temporarily unavailable.");
  } finally {
    airportCache.delete(`${cacheKey}:pending`);
  }
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else if (character === "\"") {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === "\"" && value.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (row.length || value) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("Airport CSV was empty");
  const headers = rows.shift();
  return rows.map((columns) => Object.fromEntries(headers.map((header, index) => [header, columns[index] || ""])));
}

async function getAirportDataset() {
  if (airportDataset && airportDataset.expiresAt > Date.now()) return airportDataset;
  if (airportDatasetRequest) return airportDatasetRequest;
  airportDatasetRequest = (async () => {
    const [airportsResponse, frequenciesResponse] = await Promise.all([
      fetch(`${airportDataUrl}/airports.csv`, { headers: { Accept: "text/csv", "User-Agent": "AeroAM/1.0" }, signal: AbortSignal.timeout(30_000) }),
      fetch(`${airportDataUrl}/airport-frequencies.csv`, { headers: { Accept: "text/csv", "User-Agent": "AeroAM/1.0" }, signal: AbortSignal.timeout(30_000) })
    ]);
    if (!airportsResponse.ok || !frequenciesResponse.ok) {
      throw new Error(`Airport dataset returned HTTP ${airportsResponse.status}/${frequenciesResponse.status}`);
    }
    const [airportRows, frequencyRows] = await Promise.all([airportsResponse.text(), frequenciesResponse.text()]);
    const frequenciesByAirport = new Map();
    for (const frequency of parseCsv(frequencyRows)) {
      const key = frequency.airport_ident;
      if (!key || !frequency.frequency_mhz) continue;
      const entries = frequenciesByAirport.get(key) || [];
      entries.push({
        type: frequency.type || "Radio",
        description: frequency.description || "Frequency",
        frequency: `${frequency.frequency_mhz} MHz`
      });
      frequenciesByAirport.set(key, entries);
    }
    const airports = parseCsv(airportRows).filter((record) =>
      ["large_airport", "medium_airport", "small_airport", "heliport", "seaplane_base", "balloonport"].includes(record.type) &&
      record.name && Number.isFinite(Number(record.latitude_deg)) && Number.isFinite(Number(record.longitude_deg))
    ).map((record) => ({
      name: record.name,
      lat: Number(record.latitude_deg),
      lon: Number(record.longitude_deg),
      icao: record.gps_code || (/^[A-Z0-9]{4}$/.test(record.ident) ? record.ident : ""),
      iata: record.iata_code || "",
      elevationFt: record.elevation_ft ? Number(record.elevation_ft) : null,
      municipality: record.municipality || "",
      country: record.iso_country || "",
      type: record.type.replaceAll("_", " "),
      frequencies: frequenciesByAirport.get(record.ident) || []
    }));
    airportDataset = { airports, expiresAt: Date.now() + 43_200_000 };
    return airportDataset;
  })();
  try {
    return await airportDatasetRequest;
  } catch (error) {
    if (airportDataset) return airportDataset;
    throw error;
  } finally {
    airportDatasetRequest = undefined;
  }
}

app.get("/api/iss", async (_request, response) => {
  if (issCache && Date.now() - issCache.fetchedAt < 5_000) {
    response.setHeader("X-AeroAM-Cache", "HIT");
    return response.json(issCache.data);
  }
  if (!issRequest) {
    issRequest = (async () => {
      const upstream = await fetch("https://api.wheretheiss.at/v1/satellites/25544", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000)
      });
      if (!upstream.ok) throw new Error(`ISS position service returned HTTP ${upstream.status}`);
      const data = await upstream.json();
      if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
        throw new Error("ISS position service returned invalid coordinates");
      }
      issCache = { data, fetchedAt: Date.now() };
      return data;
    })();
  }
  try {
    const data = await issRequest;
    response.setHeader("X-AeroAM-Cache", "MISS");
    return response.json(data);
  } catch (error) {
    console.error("ISS position lookup failed:", error.message);
    return apiError(response, 502, "iss_unavailable", "ISS position is temporarily unavailable.");
  } finally {
    issRequest = undefined;
  }
});

app.get("/api/metar", async (request, response) => {
  const icao = String(request.query.ids || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(icao)) return apiError(response, 400, "invalid_airport", "Provide a valid airport identifier.");
  const cached = metarCache.get(icao);
  if (cached && Date.now() - cached.fetchedAt < 600_000) {
    response.setHeader("X-AeroAM-Cache", "HIT");
    return response.json(cached.data);
  }
  try {
    const upstream = await fetch(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!upstream.ok) throw new Error(`Aviation Weather returned HTTP ${upstream.status}`);
    const data = await upstream.json();
    if (!Array.isArray(data)) throw new Error("Aviation Weather returned an invalid METAR response");
    metarCache.set(icao, { data, fetchedAt: Date.now() });
    return response.json(data);
  } catch (error) {
    console.error(`METAR lookup failed for ${icao}:`, error.message);
    if (cached) return response.json(cached.data);
    return apiError(response, 502, "metar_unavailable", "Airport weather is temporarily unavailable.");
  }
});

app.get("/api/geocode", async (request, response) => {
  const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (query.length < 2 || query.length > 120) return apiError(response, 400, "invalid_query", "Enter a place name between 2 and 120 characters.");
  const cacheKey = query.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 3_600_000) {
    response.setHeader("X-AeroAM-Cache", "HIT");
    return response.json(cached.data);
  }
  if (geocodePending.has(cacheKey)) {
    try {
      return response.json(await geocodePending.get(cacheKey));
    } catch (error) {
      console.error("Place search failed:", error.message);
      return apiError(response, 502, "geocode_unavailable", "Place search is temporarily unavailable.");
    }
  }
  const lookup = (async () => {
    const queued = geocodeQueue.then(async () => {
      const waitMs = Math.max(0, 1000 - (Date.now() - geocodeLastRequestAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      geocodeLastRequestAt = Date.now();
      const params = new URLSearchParams({ q: query, format: "jsonv2", addressdetails: "1", limit: "5", extratags: "1" });
      return fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { Accept: "application/json", "User-Agent": "AeroAM/1.0 (+https://github.com/Arny200/AeroAM)" },
        signal: AbortSignal.timeout(12_000)
      });
    });
    geocodeQueue = queued.catch(() => undefined);
    const upstream = await queued;
    if (!upstream.ok) throw new Error(`Nominatim returned HTTP ${upstream.status}`);
    const data = await upstream.json();
    if (!Array.isArray(data)) throw new Error("Nominatim returned an invalid search response");
    geocodeCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  })();
  geocodePending.set(cacheKey, lookup);
  try {
    return response.json(await lookup);
  } catch (error) {
    console.error("Place search failed:", error.message);
    return apiError(response, 502, "geocode_unavailable", "Place search is temporarily unavailable.");
  } finally {
    geocodePending.delete(cacheKey);
  }
});

app.get("/api/radio", async (_request, response) => {
  if (Date.now() < radioCache.expiresAt) {
    response.setHeader("X-AeroAM-Cache", "HIT");
    return response.json({ stations: withCork96fm(radioCache.stations) });
  }
  try {
    const upstream = await fetch("https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/IE?limit=60&order=votes&reverse=true&hidebroken=true", {
      headers: { Accept: "application/json", "User-Agent": "AeroAM/1.0" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!upstream.ok) throw new Error(`Radio Browser returned HTTP ${upstream.status}`);
    const data = await upstream.json();
    radioCache.stations = data.filter((station) => typeof station.name === "string" && /^https:\/\//i.test(station.url_resolved || ""))
      .map((station) => ({ name: station.name, url: station.url_resolved, homepage: station.homepage || "" }));
    radioCache.expiresAt = Date.now() + 3_600_000;
    return response.json({ stations: withCork96fm(radioCache.stations) });
  } catch (error) {
    console.error("Radio station lookup failed:", error.message);
    radioCache.stations = withCork96fm([]);
    radioCache.expiresAt = Date.now() + 300_000;
    return response.json({ stations: radioCache.stations, warning: "The station directory is unavailable; Cork's 96FM official player is still available." });
  }
});

function withCork96fm(stations) {
  if (stations.some((station) => /cork'?s?\s*96fm/i.test(station.name))) return stations;
  return [...stations, {
    name: "Cork's 96FM · official player",
    url: "",
    externalUrl: "https://onicplayer.ie/play/96fm",
    homepage: "https://www.96fm.ie/"
  }];
}

function decodeFeedText(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ").trim();
}

app.get("/api/incidents", async (_request, response) => {
  if (Date.now() < incidentCache.expiresAt) {
    response.setHeader("X-AeroAM-Cache", "HIT");
    return response.json({ incidents: incidentCache.incidents });
  }
  try {
    const upstream = await fetch("https://avherald.com/", {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 AeroAM/1.0" },
      signal: AbortSignal.timeout(15_000)
    });
    if (!upstream.ok) throw new Error(`Aviation Herald returned HTTP ${upstream.status}`);
    const html = await upstream.text();
    const incidents = [...html.matchAll(/<a\b[^>]*href=["'](\/h\?article=[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(([, path, markup]) => {
      const title = decodeFeedText(markup);
      if (!title || /lawsuit|privacy|contact|about/i.test(title)) return null;
      const details = title.match(/^(.+?)\s+((?:A|B|C|E|CRJ|ATR|DH|DHC|BAE|F)\w+)\s+(?:at|near|enroute|on)\s+([^,]+),\s*(.*)$/i);
      const date = title.match(/\b(?:on\s+)?([A-Z][a-z]{2,8}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\b/)?.[1] || "";
      const parsedDate = date ? new Date(date.replace(/(\d)(st|nd|rd|th)\b/i, "$1")) : null;
      if (parsedDate && !/\b\d{4}\b/.test(date)) parsedDate.setFullYear(new Date().getFullYear());
      if (parsedDate && parsedDate > new Date()) parsedDate.setFullYear(parsedDate.getFullYear() - 1);
      const normalizedTitle = title.toLowerCase();
      const severity = /fatal|killed|fatality|death/i.test(normalizedTitle) ? "Critical"
        : /injur|evacuat|fire|collision|runway excursion|overrun|emergency landing/i.test(normalizedTitle) ? "High"
          : /incident|emergency|divert|return|damage|bird strike/i.test(normalizedTitle) ? "Moderate" : "Report";
      return {
        title,
        link: `https://avherald.com${path}`,
        date,
        occurrenceTime: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.getTime() : 0,
        severity,
        operator: details?.[1] || "",
        aircraftType: details?.[2] || "",
        location: details?.[3] || "",
        summary: details?.[4] || title
      };
    }).filter((incident) => incident?.title && incident.link).slice(0, 20);
    if (!incidents.length) throw new Error("Aviation Herald page contained no incident entries");
    incidentCache.incidents = incidents;
    incidentCache.expiresAt = Date.now() + 900_000;
    return response.json({ incidents });
  } catch (error) {
    console.error("Aviation incident feed lookup failed:", error.message);
    return apiError(response, 502, "incidents_unavailable", "The external aviation incident feed is temporarily unavailable.");
  }
});

function apiError(response, status, code, message, retryAfterSeconds) {
  if (retryAfterSeconds) response.setHeader("Retry-After", String(retryAfterSeconds));
  response.status(status).json({ error: { code, message, retryAfterSeconds } });
}

function getQueryBounds(query) {
  const keys = ["lamin", "lomin", "lamax", "lomax"];
  if (keys.some((key) => query[key] === undefined)) {
    return { error: "Provide lamin, lomin, lamax, and lomax." };
  }
  const bounds = Object.fromEntries(keys.map((key) => [key, Number(query[key])]));
  if (Object.values(bounds).some((value) => !Number.isFinite(value))) {
    return { error: "Bounds must be finite decimal numbers." };
  }
  if (bounds.lamin < -85 || bounds.lamax > 85 || bounds.lamin >= bounds.lamax) {
    return { error: "Latitude bounds must be ordered within −85° and 85°." };
  }
  if (bounds.lomin < -180 || bounds.lomax > 180 || bounds.lomin >= bounds.lomax) {
    return { error: "Longitude bounds must be ordered within −180° and 180°." };
  }

  const grid = 0.25;
  return {
    bounds: {
      lamin: Math.max(-85, Math.floor(bounds.lamin / grid) * grid),
      lomin: Math.max(-180, Math.floor(bounds.lomin / grid) * grid),
      lamax: Math.min(85, Math.ceil(bounds.lamax / grid) * grid),
      lomax: Math.min(180, Math.ceil(bounds.lomax / grid) * grid)
    }
  };
}

async function getOpenSkyAccessToken(forceRefresh = false) {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    throw new Error("OpenSky OAuth requires both OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET");
  }

  if (!forceRefresh && openSkyToken && openSkyToken.expiresAt > Date.now() + 60_000) {
    return openSkyToken.value;
  }
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    });
    const response = await fetch(openSkyTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`OpenSky OAuth token request returned HTTP ${response.status}`);
    }
    const result = await response.json();
    if (typeof result.access_token !== "string" || !result.access_token) {
      throw new Error("OpenSky OAuth response did not contain an access token");
    }
    openSkyToken = {
      value: result.access_token,
      expiresAt: Date.now() + Math.max(60, Number(result.expires_in) || 1800) * 1000
    };
    return openSkyToken.value;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = undefined;
  }
}

function getRetryAfter(response) {
  const secondsHeader = response.headers.get("x-rate-limit-retry-after-seconds");
  const retryHeader = response.headers.get("retry-after");
  const seconds = Number(secondsHeader || retryHeader);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  if (retryHeader) {
    const dateDelay = Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000);
    if (Number.isFinite(dateDelay) && dateDelay > 0) return dateDelay;
  }
  return 60;
}

async function requestOpenSky(url, retryUnauthorized = true) {
  const token = await getOpenSkyAccessToken();
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (response.status === 401 && token && retryUnauthorized) {
    openSkyToken = undefined;
    await getOpenSkyAccessToken(true);
    return requestOpenSky(url, false);
  }
  return response;
}

app.get("/api/aircraft", async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const parsed = getQueryBounds(request.query);
  if (parsed.error) return apiError(response, 400, "invalid_bounds", parsed.error);

  const bounds = parsed.bounds;
  const params = new URLSearchParams({
    lamin: bounds.lamin.toFixed(2),
    lomin: bounds.lomin.toFixed(2),
    lamax: bounds.lamax.toFixed(2),
    lomax: bounds.lomax.toFixed(2),
    extended: "1"
  });
  const cacheKey = params.toString();
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.fetchedAt < cacheTtlMs) {
    response.setHeader("X-AeroAM-Cache", "HIT");
    return response.json({ ...cached.data, cached: true });
  }
  const isCoalesced = inFlight.has(cacheKey);
  let upstreamRequest = inFlight.get(cacheKey);
  if (!upstreamRequest) {
    const url = `${openSkyApi}/states/all?${params}`;
    upstreamRequest = (async () => {
      const upstream = await requestOpenSky(url);
      if (!upstream.ok) {
        const error = new Error(`OpenSky returned HTTP ${upstream.status}`);
        error.status = upstream.status;
        if (upstream.status === 429) error.retryAfterSeconds = getRetryAfter(upstream);
        throw error;
      }

      const data = await upstream.json();
      if (!data || !Array.isArray(data.states) && data.states !== null) {
        const error = new Error("OpenSky returned an invalid state vector payload");
        error.status = 502;
        throw error;
      }
      const result = { time: data.time, states: data.states || [], source: "opensky", stale: false };
      cache.set(cacheKey, { data: result, fetchedAt: Date.now() });
      while (cache.size > 500) cache.delete(cache.keys().next().value);
      return result;
    })();
    inFlight.set(cacheKey, upstreamRequest);
  }

  try {
    const data = await upstreamRequest;
    response.setHeader("X-AeroAM-Cache", isCoalesced ? "COALESCED" : "MISS");
    return response.json({ ...data, cached: isCoalesced });
  } catch (error) {
    console.error("OpenSky state-vector request failed:", error.message);
    const latest = cache.get(cacheKey);
    if (latest && Date.now() - latest.fetchedAt < staleTtlMs) {
      response.setHeader("X-AeroAM-Cache", "STALE");
      return response.json({
        ...latest.data,
        cached: true,
        stale: true,
        retryAfterSeconds: error.retryAfterSeconds
      });
    }
    if (error.status === 429) {
      return apiError(response, 429, "rate_limited", "OpenSky's API credit limit has been reached.", error.retryAfterSeconds);
    }
    if (error.status === 401 || error.status === 403 || error.message.includes("OpenSky OAuth")) {
      return apiError(response, 502, "authentication_failed", "OpenSky authentication failed. Verify OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET.");
    }
    return apiError(response, 502, "upstream_unavailable", "OpenSky live traffic is temporarily unavailable.");
  } finally {
    if (inFlight.get(cacheKey) === upstreamRequest) inFlight.delete(cacheKey);
  }
});

app.get(["/", "/index.html"], (_request, response, next) => {
  response.setHeader("Cache-Control", "no-cache");
  response.sendFile("index.html", { root: publicDirectory }, (error) => {
    if (error) next(error);
  });
});
app.get("/app.js", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.sendFile("app.js", { root: publicDirectory }, (error) => {
    if (error) next(error);
  });
});
app.get("/styles.css", (_request, response, next) => {
  response.sendFile("styles.css", { root: publicDirectory }, (error) => {
    if (error) next(error);
  });
});

app.use((_request, response) => {
  response.status(404).type("text/plain").send("Not found");
});

app.listen(port, host, () => {
  console.log(`AeroAM listening on http://${host}:${port}`);
});
