"use strict";

const express = require("express");

const app = express();
const port = Number.parseInt(process.env.PORT || "3000", 10);
const host = "0.0.0.0";
const publicDirectory = __dirname;
const openSkyApi = "https://opensky-network.org/api";
const openSkyTokenUrl = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const cacheTtlMs = 15_000;
const staleTtlMs = 120_000;
const cache = new Map();
const inFlight = new Map();
let openSkyToken;
let tokenRequest;

app.disable("x-powered-by");
app.get("/health", (_request, response) => {
  response.status(200).type("text/plain").send("ok");
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
