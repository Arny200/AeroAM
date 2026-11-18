(() => {
  const defaultLocation = { name: "Dublin, Ireland", lat: 53.3498, lon: -6.2603 };
  const storageKey = "aeroam-settings-v1";
  const defaults = { theme: "amoled", accent: "#8da8ff", autoAccent: true, clockFormat: "24", clockStyle: "modern", weather: true, sun: true, labels: true, airports: true, radio: true, nowPlaying: true, iss: false, detailed: true, standby: true, quizPlayerCount: 1, quizSameQuestion: true, quizTimer: false, quizNames: [], location: defaultLocation };
  const loadSettings = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return { ...defaults, ...saved, location: saved.location || defaultLocation };
    } catch (error) {
      console.error("Could not read AeroAM settings.", error);
      return { ...defaults };
    }
  };
  let settings = loadSettings();
  settings.standby = true;
  if (!Array.isArray(settings.quizNames)) settings.quizNames = [];
  if (settings.clockStyle === "cockpit") settings.clockStyle = "accent";
  if (!["modern", "mono", "serif", "digital", "accent", "soft"].includes(settings.clockStyle)) settings.clockStyle = "modern";
  let map;
  const airportMarkers = [];
  let aircraft = [];
  let selectedIcao = "";
  let requestController;
  let refreshTimer;
  let refreshDebounceTimer;
  let retryTimer;
  let nextAircraftRefreshAt = 0;
  let airportUpdateTimer;
  let lastAirportRequestAt = 0;
  let airportRequestController;
  let airportsInView = [];
  let issMarker;
  let issTimer;
  let radioStations = [];
  const quizPlayers = [];
  let quizRoundAirports = [];
  let quizPlayerIndex = 0;
  let quizTimer;
  let quizSeconds = 20;
  let currentQuizMode = "icao";
  let weatherData = null;
  let incidentReports = [];
  let incidentSort = "time";
  let nowPlayingTitle = "";
  let nowPlayingKind = "";
  let nowPlayingAlternate = false;
  let nowPlayingRotationTimer;
  const playingMedia = new Map();
  let spotifyIframeApi;
  let spotifyUri = "";
  let spotifyController;
  let issClickTimer;
  let centerIssWhenLoaded = false;
  let sortKey = "callsign";
  let sortAscending = true;
  let searchTimer;
  const markers = new Map();
  const markerAnimations = new Map();
  const aircraftDetailsCache = new Map();
  const aircraftDetailsAttempted = new Set();
  const airlineNames = {
    ACA: "Air Canada", AFR: "Air France", AAL: "American Airlines", BAW: "British Airways",
    DAL: "Delta Air Lines", DLH: "Lufthansa", EIN: "Aer Lingus", ETD: "Etihad Airways",
    EZY: "easyJet", KLM: "KLM", QTR: "Qatar Airways", RYR: "Ryanair", TOM: "TUI Airways",
    UAE: "Emirates", UAL: "United Airlines", UPS: "UPS"
  };
  const aircraftCategories = { 2: "Light", 3: "Small", 4: "Large", 5: "High performance", 6: "Heavy", 7: "High performance", 8: "Rotorcraft", 9: "Glider", 10: "Lighter-than-air", 11: "Skydiver", 12: "Ultralight", 13: "UAV", 14: "Space vehicle", 15: "Emergency vehicle" };
  const quizAirports = [
    { name: "Dublin Airport", country: "Ireland", icao: "EIDW", iata: "DUB", airline: "Aer Lingus", lat: 53.4264, lon: -6.2499 },
    { name: "London Heathrow Airport", country: "United Kingdom", icao: "EGLL", iata: "LHR", airline: "British Airways", lat: 51.47, lon: -0.4543 },
    { name: "Amsterdam Airport Schiphol", country: "Netherlands", icao: "EHAM", iata: "AMS", airline: "KLM", lat: 52.3086, lon: 4.7639 },
    { name: "Charles de Gaulle Airport", country: "France", icao: "LFPG", iata: "CDG", airline: "Air France", lat: 49.0097, lon: 2.5479 },
    { name: "Frankfurt Airport", country: "Germany", icao: "EDDF", iata: "FRA", airline: "Lufthansa", lat: 50.0379, lon: 8.5622 },
    { name: "John F. Kennedy International Airport", country: "United States", icao: "KJFK", iata: "JFK", airline: "American Airlines", lat: 40.6413, lon: -73.7781 },
    { name: "Dubai International Airport", country: "United Arab Emirates", icao: "OMDB", iata: "DXB", airline: "Emirates", lat: 25.2532, lon: 55.3657 },
    { name: "Tokyo Haneda Airport", country: "Japan", icao: "RJTT", iata: "HND", airline: "All Nippon Airways", lat: 35.5494, lon: 139.7798 }
  ];
  const columnDefinitions = [
    { key: "callsign", label: "Callsign", sortable: true },
    { key: "icao", label: "ICAO24", sortable: true },
    { key: "registration", label: "Registration" },
    { key: "type", label: "Aircraft type" },
    { key: "model", label: "Aircraft model" },
    { key: "airlineLogo", label: "Airline logo" },
    { key: "airline", label: "Airline / operator" },
    { key: "originCountry", label: "Origin country" },
    { key: "origin", label: "Origin" },
    { key: "destination", label: "Destination" },
    { key: "altitude", label: "Altitude", sortable: true },
    { key: "geometricAltitude", label: "Geometric altitude", sortable: true },
    { key: "airspeed", label: "Airspeed", sortable: true },
    { key: "speed", label: "Ground speed", sortable: true },
    { key: "verticalSpeed", label: "Vertical speed", sortable: true },
    { key: "heading", label: "Heading", sortable: true },
    { key: "squawk", label: "Squawk", sortable: true },
    { key: "category", label: "Category" },
    { key: "categoryId", label: "ADS-B category ID" },
    { key: "status", label: "Flight status" },
    { key: "position", label: "Position" },
    { key: "positionUpdated", label: "Position updated" },
    { key: "lastContact", label: "Last contact" },
    { key: "sensors", label: "Sensors" },
    { key: "spi", label: "Special purpose" },
    { key: "positionSource", label: "Position source" },
    { key: "carbon", label: "CO₂ / hour" }
  ];
  const columnOrder = Array.isArray(settings.columnOrder)
    ? [...settings.columnOrder.filter((key) => columnDefinitions.some((column) => column.key === key)), ...columnDefinitions.map((column) => column.key).filter((key) => !settings.columnOrder.includes(key))]
    : columnDefinitions.map((column) => column.key);
  const visibleColumns = new Set(Array.isArray(settings.columns)
    ? settings.columns.filter((key) => columnDefinitions.some((column) => column.key === key))
    : columnDefinitions.filter((column) => column.key !== "airlineLogo").map((column) => column.key));
  let orderedVisibleColumns = columnOrder.filter((key) => visibleColumns.has(key));
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const coordinates = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
  const formatClock = (date = new Date(), format = settings.clockFormat) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(format === "24" ? { hourCycle: "h23" } : { hour12: true }) });
  const saveSettings = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch (error) {
      console.error("Could not save AeroAM settings.", error);
      showMessage("Settings could not be saved in this browser.");
    }
  };
  const showMessage = (message) => {
    const node = $("map-message");
    node.textContent = message;
    node.classList.remove("hidden");
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => node.classList.add("hidden"), 7000);
  };
  let aircraftMessage = "";
  const showAircraftMessage = (message) => {
    aircraftMessage = message;
    showMessage(message);
  };
  const clearAircraftMessage = () => {
    const node = $("map-message");
    if (aircraftMessage && node.textContent === aircraftMessage) {
      node.classList.add("hidden");
      clearTimeout(showMessage.timer);
    }
    aircraftMessage = "";
  };
  const setLocationLabel = () => {
    const { name, lat, lon } = settings.location;
    $("map-location-label").textContent = name;
    $("map-coordinates").textContent = coordinates(lat, lon);
    $("board-location").textContent = name;
    $("board-location-short").textContent = name.split(",")[0];
    $("setting-location").value = name;
  };

  function initializeMap() {
    if (!window.maplibregl) {
      showMessage("The map library did not load. Check your connection and reload AeroAM.");
      return;
    }
    map = new maplibregl.Map({
      container: "map",
      style: settings.theme === "light" ? "https://tiles.openfreemap.org/styles/bright" : "https://tiles.openfreemap.org/styles/dark",
      center: [settings.location.lon, settings.location.lat], zoom: 7, pitch: 0,
      attributionControl: true, canvasContextAttributes: { antialias: true }
    });
    setStandby(settings.standby);
    map.on("styleimagemissing", (event) => {
      if (!/^circle-\d+$/.test(event.id) || map.hasImage(event.id)) return;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.beginPath();
      context.arc(12, 12, 8, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();
      map.addImage(event.id, context.getImageData(0, 0, 24, 24), { pixelRatio: 2 });
    });
    map.on("moveend", scheduleAircraftRefresh);
    map.on("moveend", updateAirports);
    map.on("zoomend", () => { renderAirportMarkers(); renderAircraft(); });
    map.on("load", () => { refreshAircraft(); updateAirports(); if (settings.iss) setISSTracking(true); });
    refreshTimer = setInterval(refreshAircraft, 60000);
  }

  function scheduleAircraftRefresh() {
    clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = setTimeout(refreshAircraft, 400);
  }

  async function refreshAircraft() {
    if (!map) return;
    if (Date.now() < nextAircraftRefreshAt) return;
    if (requestController) requestController.abort();
    requestController = new AbortController();
    const bounds = map.getBounds();
    const south = Math.max(-85, bounds.getSouth());
    const north = Math.min(85, bounds.getNorth());
    const west = bounds.getWest();
    const east = bounds.getEast();
    const longitudeSpan = east - west;
    const normalizedWest = ((west + 180) % 360 + 360) % 360 - 180;
    const normalizedEast = normalizedWest + longitudeSpan;
    const boxes = longitudeSpan >= 360 ? [[-180, 180]] :
      normalizedEast > 180 ? [[normalizedWest, 180], [-180, normalizedEast - 360]] :
      [[normalizedWest, normalizedEast]];
    try {
      const responses = await Promise.all(boxes.map(async ([minLon, maxLon]) => {
        const params = new URLSearchParams({
          lamin: south.toFixed(4), lomin: minLon.toFixed(4),
          lamax: north.toFixed(4), lomax: maxLon.toFixed(4)
        });
        const response = await fetch(`/api/aircraft?${params}`, { signal: requestController.signal });
        const data = await response.json();
        if (!response.ok) {
          const error = new Error(data.error?.message || `Aircraft service returned HTTP ${response.status}`);
          error.status = response.status;
          error.code = data.error?.code;
          error.retryAfterSeconds = data.error?.retryAfterSeconds || Number(response.headers.get("Retry-After"));
          throw error;
        }
        if (!Array.isArray(data.states)) throw new Error("Aircraft service returned an invalid state vector payload.");
        return data;
      }));
      clearAircraftMessage();
      const states = responses.flatMap((data) => data.states);
      aircraft = [...new Map(states.filter((row) => row[0] && Number.isFinite(row[5]) && Number.isFinite(row[6])).map((row) => [row[0], row])).values()].map((row) => ({
        icao: String(row[0]).trim().toUpperCase(), callsign: String(row[1] || "").trim(),
        country: row[2] || "", timePosition: row[3], lastContact: row[4],
        lon: row[5], lat: row[6], baroAltitude: row[7], onGround: Boolean(row[8]),
        velocity: row[9], heading: row[10], verticalRate: row[11], sensors: row[12], geoAltitude: row[13], squawk: row[14],
        airlineCode: String(row[1] || "").trim().slice(0, 3).toUpperCase(),
        aircraftType: aircraftDetailsCache.get(String(row[0]).trim().toUpperCase())?.t || "",
        categoryLabel: aircraftCategories[row[17]] || "",
        spi: Boolean(row[15]), positionSource: row[16], category: row[17]
      }));
      updateFlightFilters();
      renderAircraft();
      const showingCached = responses.some((data) => data.stale);
      $("aircraft-count").textContent = `${aircraft.length.toLocaleString()} aircraft in view${showingCached ? " · cached" : ""}`;
      $("board-count").textContent = aircraft.length.toLocaleString();
      renderStatistics();
      if (showingCached) {
        const delay = Math.max(...responses.map((data) => data.retryAfterSeconds || 0));
        if (delay > 0) deferAircraftRefresh(delay);
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Unable to refresh aircraft from OpenSky.", error);
      if (error.code === "rate_limited") {
        const delay = Math.max(30, Number(error.retryAfterSeconds) || 60);
        deferAircraftRefresh(delay);
        $("aircraft-count").textContent = aircraft.length
          ? `${aircraft.length.toLocaleString()} aircraft · rate limited`
          : "Aircraft feed rate limited";
        showAircraftMessage(`OpenSky rate limit reached. Retrying in about ${Math.ceil(delay / 60)} minute(s).`);
        return;
      }
      if (error.code === "authentication_failed") {
        $("aircraft-count").textContent = "Aircraft authentication failed";
        showAircraftMessage("OpenSky authentication failed. Check OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in Render.");
        return;
      }
      deferAircraftRefresh(error.retryAfterSeconds || 15);
      $("aircraft-count").textContent = aircraft.length
        ? `${aircraft.length.toLocaleString()} aircraft · update unavailable`
        : "Live feed unavailable";
      if (!aircraft.length) {
        $("nearby-list").replaceChildren(el("div", "empty-row", "Live aircraft data is temporarily unavailable."));
        $("aircraft-table-body").replaceChildren(emptyTable("Live aircraft data is temporarily unavailable."));
        showAircraftMessage("OpenSky live traffic could not be reached. The map is still available; traffic will retry shortly.");
      }
    }
  }

  function deferAircraftRefresh(seconds) {
    const delay = Math.max(5, Math.min(Number(seconds) || 60, 86_400));
    nextAircraftRefreshAt = Date.now() + delay * 1000;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      nextAircraftRefreshAt = 0;
      refreshAircraft();
    }, delay * 1000);
  }

  function markerMarkup(flight, selected = false) {
    const nearUser = distanceKm(flight) <= 50;
    const marker = el("div", `plane-glyph${selected ? " selected" : ""}${nearUser ? " near-user" : ""}`);
    marker.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13.5 19v-5.5z"/></svg>';
    if (settings.labels && map?.getZoom() >= 7) marker.appendChild(el("span", "plane-label", flight.callsign || flight.icao));
    return marker;
  }

  function renderAircraft() {
    if (!map) return;
    const visibleAircraft = getFilteredAircraft();
    const liveIcaos = new Set(visibleAircraft.map((flight) => flight.icao));
    for (const [icao, marker] of markers) {
      if (!liveIcaos.has(icao)) {
        const frame = markerAnimations.get(icao);
        if (frame) cancelAnimationFrame(frame);
        markerAnimations.delete(icao);
        marker.remove();
        markers.delete(icao);
      }
    }
    for (const flight of visibleAircraft) {
      let marker = markers.get(flight.icao);
      if (!marker) {
        const element = el("button", "plane-marker marker-entering");
        element.type = "button";
        element.setAttribute("aria-label", `Aircraft ${flight.callsign}`);
        element.title = flight.callsign;
        marker = new maplibregl.Marker({ element, anchor: "center", rotationAlignment: "map" })
          .setLngLat([flight.lon, flight.lat]).addTo(map);
        element.addEventListener("click", () => openAircraft(flight.icao));
        element.addEventListener("animationend", () => element.classList.remove("marker-entering"), { once: true });
        markers.set(flight.icao, marker);
      }
      animateMarker(marker, flight.lat, flight.lon, flight.icao);
      marker.getElement().innerHTML = markerMarkup(flight, flight.icao === selectedIcao).outerHTML;
      const glyph = marker.getElement().querySelector(".plane-glyph");
      if (glyph) glyph.style.transform = `rotate(${Number.isFinite(flight.heading) ? flight.heading : 0}deg)`;
      marker.getElement().title = flight.callsign;
      marker.getElement().setAttribute("aria-label", `Aircraft ${flight.callsign || flight.icao}`);
    }
    renderNearby(visibleAircraft);
    renderTable(visibleAircraft);
  }

  function animateMarker(marker, targetLat, targetLon, icao) {
    const previousFrame = markerAnimations.get(icao);
    if (previousFrame) cancelAnimationFrame(previousFrame);
    const start = marker.getLngLat();
    const startedAt = performance.now();
    const duration = 1100;
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      marker.setLngLat([
        start.lng + (targetLon - start.lng) * eased,
        start.lat + (targetLat - start.lat) * eased
      ]);
      if (progress < 1) markerAnimations.set(icao, requestAnimationFrame(animate));
      else markerAnimations.delete(icao);
    };
    markerAnimations.set(icao, requestAnimationFrame(animate));
  }

  function distanceKm(flight) {
    const { lat, lon } = settings.location;
    const radians = (value) => value * Math.PI / 180;
    const dLat = radians(flight.lat - lat), dLon = radians(flight.lon - lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat)) * Math.cos(radians(flight.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function altitude(flight) {
    if (flight.onGround) return "On ground";
    return Number.isFinite(flight.baroAltitude) ? `${Math.round(flight.baroAltitude * 3.28084).toLocaleString()} ft` : "—";
  }
  function speed(flight) {
    return Number.isFinite(flight.velocity) ? `${Math.round(flight.velocity * 1.94384)} kt` : "—";
  }
  function heading(flight) {
    return Number.isFinite(flight.heading) ? `${Math.round(flight.heading)}°` : "—";
  }
  function emptyTable(message) {
    const row = el("tr");
    const cell = el("td", "empty-row", message);
    cell.colSpan = Math.max(1, orderedVisibleColumns.length);
    row.appendChild(cell);
    return row;
  }
  function getFilteredAircraft() {
    const airline = $("airline-filter")?.value || "";
    const type = $("aircraft-type-filter")?.value || "";
    return aircraft.filter((flight) => (!airline || flight.airlineCode === airline) &&
      (!type || flight.aircraftType.toUpperCase() === type));
  }
  function updateFlightFilters() {
    const airlineSelect = $("airline-filter");
    const typeSelect = $("aircraft-type-filter");
    if (!airlineSelect || !typeSelect) return;
    const previousAirline = airlineSelect.value;
    const previousType = typeSelect.value;
    const airlines = [...new Set(aircraft.map((flight) => flight.airlineCode).filter((code) => airlineNames[code]))].sort();
    const types = [...new Set(aircraft.map((flight) => flight.aircraftType).filter(Boolean))].sort();
    airlineSelect.replaceChildren(new Option("All airlines", ""), ...airlines.map((code) => new Option(airlineNames[code], code)));
    typeSelect.replaceChildren(new Option("All types", ""), ...types.map((model) => new Option(model, model.toUpperCase())));
    if (airlines.includes(previousAirline)) airlineSelect.value = previousAirline;
    if (types.some((model) => model.toUpperCase() === previousType)) typeSelect.value = previousType;
  }
  function renderNearby(flights = getFilteredAircraft()) {
    const nearest = [...flights].sort((a, b) => distanceKm(a) - distanceKm(b)).slice(0, 3);
    if (!nearest.length) {
      $("nearby-list").replaceChildren(el("div", "empty-row", "No aircraft in the current map view."));
      return;
    }
    const list = $("nearby-list");
    list.replaceChildren(...nearest.map((flight) => {
      const row = el("div", "nearby-row");
      row.addEventListener("click", () => openAircraft(flight.icao));
      row.append(el("span", "mini-plane", "✈"));
      const meta = el("span", "nearby-meta");
      meta.append(el("span", "nearby-callsign", flight.callsign || flight.icao));
      meta.append(el("span", "nearby-route", [flight.country, `${Math.round(distanceKm(flight))} km away`].filter(Boolean).join(" · ")));
      row.append(meta);
      const value = el("span", "nearby-alt");
      if (flight.onGround) value.append(el("span", "", "On ground"));
      else if (Number.isFinite(flight.baroAltitude)) value.append(el("span", "", altitude(flight)));
      if (Number.isFinite(flight.velocity)) value.append(el("span", "", speed(flight)));
      if (value.childElementCount) row.append(value);
      return row;
    }));
  }
  function flightMetadata(flight) {
    return aircraftDetailsCache.get(flight.icao) || {};
  }
  function flightColumnValue(flight, key) {
    const data = flightMetadata(flight);
    const aircraftType = data.t || flight.aircraftType;
    const values = {
      callsign: flight.callsign,
      icao: flight.icao,
      registration: data.r,
      type: aircraftType,
      model: data.desc,
      airline: data.ownOp || airlineNames[flight.airlineCode],
      originCountry: flight.country,
      origin: data.from,
      destination: data.to,
      altitude: flight.onGround ? "On ground" : Number.isFinite(flight.baroAltitude) ? altitude(flight) : "",
      geometricAltitude: Number.isFinite(flight.geoAltitude) ? `${Math.round(flight.geoAltitude * 3.28084).toLocaleString()} ft` : Number.isFinite(data.alt_geom) ? `${Math.round(data.alt_geom)} ft` : "",
      airspeed: Number.isFinite(data.ias) ? `${Math.round(data.ias)} kt IAS` : Number.isFinite(data.tas) ? `${Math.round(data.tas)} kt TAS` : "",
      speed: Number.isFinite(flight.velocity) ? speed(flight) : "",
      verticalSpeed: Number.isFinite(flight.verticalRate) ? `${Math.round(flight.verticalRate * 196.85)} ft/min` : "",
      heading: Number.isFinite(flight.heading) ? heading(flight) : "",
      squawk: flight.squawk,
      category: data.category || flight.categoryLabel,
      categoryId: Number.isFinite(flight.category) ? String(flight.category) : "",
      status: data.emergency && data.emergency !== "none" ? `Emergency · ${data.emergency}` : flight.onGround ? "On ground" : "Airborne",
      position: `${flight.lat.toFixed(3)}, ${flight.lon.toFixed(3)}`,
      positionUpdated: Number.isFinite(flight.timePosition) ? new Date(flight.timePosition * 1000).toLocaleTimeString() : "",
      lastContact: Number.isFinite(flight.lastContact) ? new Date(flight.lastContact * 1000).toLocaleTimeString() : "",
      sensors: Array.isArray(flight.sensors) ? flight.sensors.join(", ") : "",
      spi: flight.spi ? "Yes" : "",
      positionSource: Number.isFinite(flight.positionSource) ? ["ADS-B", "ASTERIX", "MLAT", "FLARM"][flight.positionSource] || String(flight.positionSource) : "",
      carbon: carbonRate(aircraftType)
    };
    return values[key] || "";
  }
  function renderTable(flights = getFilteredAircraft()) {
    const header = $("aircraft-table-head");
    const headerRow = el("tr");
    for (const key of orderedVisibleColumns) {
      const definition = columnDefinitions.find((column) => column.key === key);
      const th = el("th");
      if (definition.sortable) {
        const button = el("button", "", `${definition.label.toUpperCase()} ↕`);
        button.dataset.sort = key;
        button.addEventListener("click", () => {
          sortAscending = sortKey === key ? !sortAscending : true;
          sortKey = key;
          renderTable();
        });
        th.append(button);
      } else {
        th.textContent = definition.label.toUpperCase();
      }
      headerRow.append(th);
    }
    header.replaceChildren(headerRow);
    const query = $("aircraft-search").value.trim().toLowerCase();
    const sorted = [...flights].filter((flight) => [
      flight.callsign, flight.icao, flight.country, flight.airlineCode, flight.aircraftType,
      ...["registration", "type", "model", "airline", "origin", "destination"].map((key) => flightColumnValue(flight, key))
    ].join(" ").toLowerCase().includes(query));
    sorted.sort((a, b) => {
      const values = [flightColumnValue(a, sortKey), flightColumnValue(b, sortKey)];
      const numericKeys = ["altitude", "geometricAltitude", "airspeed", "speed", "verticalSpeed", "heading", "squawk"];
      const numericValue = (flight, value) => keyToNumber(sortKey, flight, value);
      const left = numericKeys.includes(sortKey) ? numericValue(a, values[0]) : values[0];
      const right = numericKeys.includes(sortKey) ? numericValue(b, values[1]) : values[1];
      const comparison = typeof left === "number" && typeof right === "number"
        ? left - right : String(left).localeCompare(String(right));
      return comparison * (sortAscending ? 1 : -1);
    });
    if (!sorted.length) {
      $("aircraft-table-body").replaceChildren(emptyTable(query ? "No aircraft match your search." : "No aircraft in the current map view."));
      return;
    }
    $("aircraft-table-body").replaceChildren(...sorted.map((flight) => {
      const row = el("tr");
      row.addEventListener("click", () => openAircraft(flight.icao));
      row.append(...orderedVisibleColumns.map((key) => {
        const cell = el("td");
        if (key === "callsign") {
          cell.append(el("span", "table-callsign", flight.callsign), el("span", "table-sub", flight.icao));
        } else {
          cell.textContent = flightColumnValue(flight, key);
        }
        return cell;
      }));
      return row;
    }));
  }
  function keyToNumber(key, flight, value) {
    if (key === "altitude") return flight.baroAltitude ?? -1;
    if (key === "geometricAltitude") return flight.geoAltitude ?? -1;
    if (key === "speed") return flight.velocity ?? -1;
    if (key === "heading") return flight.heading ?? -1;
    if (key === "verticalSpeed") return flight.verticalRate ?? -1;
    if (key === "airspeed") return flightMetadata(flight).ias ?? flightMetadata(flight).tas ?? -1;
    return Number(value) || -1;
  }

  function renderStatistics() {
    const highlights = $("stats-highlights");
    if (!highlights) return;
    const airborne = aircraft.filter((flight) => !flight.onGround);
    const fastest = [...airborne].filter((flight) => Number.isFinite(flight.velocity)).sort((a, b) => b.velocity - a.velocity)[0];
    const highest = [...airborne].filter((flight) => Number.isFinite(flight.baroAltitude)).sort((a, b) => b.baroAltitude - a.baroAltitude)[0];
    highlights.replaceChildren(
      statCard("Fastest live aircraft", fastest ? fastest.callsign : "—", fastest ? speed(fastest) : "No airborne data"),
      statCard("Highest altitude", highest ? highest.callsign : "—", highest ? altitude(highest) : "No airborne data"),
      statCard("Airborne now", airborne.length.toLocaleString(), `${aircraft.length.toLocaleString()} aircraft in map view`)
    );

    const airlineCounts = new Map();
    const categoryCounts = new Map();
    for (const flight of airborne) {
      if (airlineNames[flight.airlineCode]) airlineCounts.set(airlineNames[flight.airlineCode], (airlineCounts.get(airlineNames[flight.airlineCode]) || 0) + 1);
      const category = flight.aircraftType || aircraftCategories[flight.category] || "Unclassified";
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
    renderStatBars("stats-airlines", airlineCounts, "Airline prefix unavailable for some aircraft.");
    renderStatBars("stats-types", categoryCounts, "Aircraft category was not supplied.");
  }
  function statCard(label, value, detail) {
    const card = el("section", "info-card stat-card");
    card.append(el("span", "eyebrow", label.toUpperCase()), el("strong", "", value), el("small", "", detail));
    return card;
  }
  function renderStatBars(id, counts, emptyMessage) {
    const container = $(id);
    if (!container) return;
    const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    container.replaceChildren();
    if (!items.length) {
      container.append(el("div", "empty-row", emptyMessage));
      return;
    }
    const maximum = items[0][1];
    for (const [label, count] of items) {
      const row = el("div", "stats-bar-row");
      const caption = el("div", "stats-bar-caption");
      caption.append(el("span", "", label), el("strong", "", String(count)));
      const track = el("div", "stats-bar-track");
      const bar = el("span", "stats-bar-fill");
      bar.style.width = `${Math.max(4, count / maximum * 100)}%`;
      track.append(bar);
      row.append(caption, track);
      container.append(row);
    }
  }

  function openAircraft(icao, loadDetails = true) {
    const flight = aircraft.find((item) => item.icao === icao);
    if (!flight) return;
    selectedIcao = icao;
    renderAircraft();
    $("detail-kicker").textContent = settings.detailed ? "AIRCRAFT · DETAILED" : "AIRCRAFT · MINIMAL";
    $("detail-title").textContent = flight.callsign || flight.icao;
    const content = $("detail-content");
    content.replaceChildren();
    const data = flightMetadata(flight);
    const summary = el("div", "detail-summary");
    summary.append(el("strong", "", flight.callsign || flight.icao));
    const summaryText = [flight.country, flight.onGround ? "On ground" : "Airborne"].filter(Boolean).join(" · ");
    if (summaryText) summary.append(el("p", "", summaryText));
    content.append(summary);
    const fields = [
      ["Callsign", flight.callsign], ["Registration", data.r], ["ICAO24", flight.icao],
      ["Aircraft type", data.t || flight.aircraftType], ["Aircraft model", data.desc],
      ["Airline", data.ownOp || airlineNames[flight.airlineCode]], ["Operator", data.ownOp],
      ["Origin", data.from], ["Destination", data.to],
      ["Altitude", flight.onGround ? "On ground" : Number.isFinite(flight.baroAltitude) ? altitude(flight) : ""],
      ["Airspeed", Number.isFinite(data.ias) ? `${Math.round(data.ias)} kt IAS` : Number.isFinite(data.tas) ? `${Math.round(data.tas)} kt TAS` : ""],
      ["Ground speed", Number.isFinite(flight.velocity) ? speed(flight) : ""],
      ["Vertical speed", Number.isFinite(flight.verticalRate) ? `${Math.round(flight.verticalRate * 196.85)} ft/min` : ""],
      ["Heading", Number.isFinite(flight.heading) ? heading(flight) : ""], ["Squawk", flight.squawk],
      ["Aircraft category", data.category || flight.categoryLabel],
      ["Flight status", data.emergency && data.emergency !== "none" ? `Emergency · ${data.emergency}` : flight.onGround ? "On ground" : "Airborne"], ["Origin country", flight.country],
      ["Latitude", `${flight.lat.toFixed(5)}°`], ["Longitude", `${flight.lon.toFixed(5)}°`],
      ["Position updated", flight.timePosition ? new Date(flight.timePosition * 1000).toLocaleTimeString() : ""],
      ["Last contact", Number.isFinite(flight.lastContact) ? new Date(flight.lastContact * 1000).toLocaleTimeString() : ""],
      ["Geometric altitude", Number.isFinite(flight.geoAltitude) ? `${Math.round(flight.geoAltitude * 3.28084).toLocaleString()} ft` : Number.isFinite(data.alt_geom) ? `${Math.round(data.alt_geom)} ft` : ""],
      ["Position source", Number.isFinite(flight.positionSource) ? ["ADS-B", "ASTERIX", "MLAT", "FLARM"][flight.positionSource] || String(flight.positionSource) : ""],
      ["Sensors", Array.isArray(flight.sensors) ? flight.sensors.join(", ") : ""],
      ["Special purpose indicator", typeof flight.spi === "boolean" ? flight.spi ? "Yes" : "No" : ""],
      ["ADS-B category ID", Number.isFinite(flight.category) ? String(flight.category) : ""]
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
    const detailLabels = settings.detailed ? fields : fields.filter(([label]) => ["Callsign", "Aircraft type", "Altitude", "Ground speed"].includes(label));
    const section = el("div", "detail-section");
    section.append(el("h3", "", settings.detailed ? "FLIGHT INFORMATION" : "FLIGHT SNAPSHOT"));
    const grid = el("div", "detail-grid");
    for (const [label, value] of detailLabels) {
      const field = el("div", "detail-field");
      field.append(el("span", "", label), el("strong", "", String(value)));
      grid.append(field);
    }
    section.append(grid);
    content.append(section);
    appendCarbonEstimate(content, data.t || flight.aircraftType);
    if (settings.detailed) {
      const additional = Object.entries(data).filter(([key, value]) =>
        !["hex", "type", "flight", "r", "t", "desc", "ownOp", "alt_baro", "alt_geom", "ias", "tas", "gs", "baro_rate", "track", "squawk", "category", "emergency", "lat", "lon", "from", "to", "seen", "seen_pos", "messages", "mlat", "tisb", "nav_modes"].includes(key) &&
        (typeof value === "number" || typeof value === "boolean" || typeof value === "string") && String(value).trim()
      );
      if (additional.length) {
        const extraSection = el("div", "detail-section");
        extraSection.append(el("h3", "", "ADDITIONAL AIRCRAFT DATA"));
        const extraGrid = el("div", "detail-grid");
        for (const [key, value] of additional) {
          const field = el("div", "detail-field");
          field.append(el("span", "", key.replaceAll("_", " ")), el("strong", "", String(value)));
          extraGrid.append(field);
        }
        extraSection.append(extraGrid);
        content.append(extraSection);
      }
    }
    if (settings.detailed && loadDetails) enrichAircraftDetails(flight);
    $("detail-panel").classList.add("open");
    $("detail-panel").setAttribute("aria-hidden", "false");
    $("panel-scrim").classList.remove("hidden");
  }

  function carbonRate(aircraftType) {
    if (!aircraftType) return "";
    const type = String(aircraftType).toUpperCase();
    const hourlyKg = /^(B74|B77|B78|A33|A34|A35|A38|A30)/.test(type) ? 20_000
      : /^(ATR|AT[467]|DH8|DHC|E[12])/.test(type) ? 1_200 : 7_500;
    return `≈ ${(hourlyKg / 1000).toFixed(1)} t/h`;
  }
  function appendCarbonEstimate(content, aircraftType) {
    const rate = carbonRate(aircraftType);
    if (!rate) return;
    const intensity = Math.min(100, Number.parseFloat(rate.match(/[\d.]+/)?.[0] || "0") / 20 * 100);
    const section = el("div", "detail-section carbon-section");
    section.append(el("h3", "", "ESTIMATED CO₂ RATE"));
    const indicator = el("div", "carbon-indicator");
    indicator.style.setProperty("--carbon-progress", `${intensity}%`);
    indicator.append(el("strong", "", rate), el("span", "", "per airborne hour"));
    section.append(indicator, el("small", "carbon-note", "Indicative aircraft-type estimate, not a whole-flight total."));
    content.append(section);
  }
  async function enrichAircraftDetails(flight) {
    if (aircraftDetailsAttempted.has(flight.icao)) return;
    aircraftDetailsAttempted.add(flight.icao);
    try {
      let data = aircraftDetailsCache.get(flight.icao);
      if (!data) {
        const response = await fetch(`https://api.adsb.lol/v2/hex/${encodeURIComponent(flight.icao)}`);
        if (response.ok) {
          const result = await response.json();
          data = result.ac?.[0] || null;
        }
        if (!data) {
          const fallback = await fetch(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(flight.icao)}`);
          if (!fallback.ok) throw new Error(`Aircraft registry returned HTTP ${fallback.status}`);
          const registry = await fallback.json();
          data = {
            r: registry.Registration, t: registry.Type, desc: registry.Model,
            ownOp: registry.RegisteredOwners
          };
        }
      }
      data ||= {};
      aircraftDetailsCache.set(flight.icao, data);
      flight.aircraftType = data.t || flight.aircraftType;
      updateFlightFilters();
      const photoUrl = [data.image, data.photo, data.photo_url].find((url) => typeof url === "string" && /^https:\/\/[^ ]+$/i.test(url));
      if (photoUrl && !document.querySelector(".aircraft-photo")) {
        const image = el("img", "aircraft-photo");
        image.src = photoUrl;
        image.alt = `Aircraft photo of ${flight.callsign}`;
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => image.remove(), { once: true });
        $("detail-content").prepend(image);
      }
      renderAircraft();
      if (selectedIcao === flight.icao) openAircraft(flight.icao, false);
    } catch (error) {
      console.error(`Aircraft metadata lookup failed for ${flight.icao}.`, error);
      aircraftDetailsCache.set(flight.icao, {});
      if (selectedIcao === flight.icao) openAircraft(flight.icao, false);
    }
  }

  function updateAirports() {
    clearTimeout(airportUpdateTimer);
    if (!map || !settings.airports) {
      airportsInView = [];
      airportMarkers.splice(0).forEach((marker) => marker.remove());
      return;
    }
    const delay = Math.max(0, 1100 - (Date.now() - lastAirportRequestAt));
    airportUpdateTimer = setTimeout(loadAirports, delay);
  }
  async function loadAirports() {
    if (!map || !settings.airports) return;
    const bounds = map.getBounds();
    const rawLongitudeSpan = bounds.getEast() - bounds.getWest();
    const longitudeSpan = rawLongitudeSpan >= 0 ? rawLongitudeSpan : rawLongitudeSpan + 360;
    if (bounds.getNorth() - bounds.getSouth() > 32 || longitudeSpan > 56) return;
    const normalizeLongitude = (longitude) => ((longitude + 180) % 360 + 360) % 360 - 180;
    const west = normalizeLongitude(bounds.getWest());
    const east = normalizeLongitude(bounds.getEast());
    const longitudeWidth = west <= east ? east - west : 360 - west + east;
    if (longitudeWidth > 56) return;
    try {
      if (airportRequestController) airportRequestController.abort();
      airportRequestController = new AbortController();
      lastAirportRequestAt = Date.now();
      const params = new URLSearchParams({
        west: west.toFixed(4), south: bounds.getSouth().toFixed(4),
        east: east.toFixed(4), north: bounds.getNorth().toFixed(4)
      });
      const response = await fetch(`/api/airports?${params}`, { signal: airportRequestController.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || `Airport data returned HTTP ${response.status}`);
      const places = result.airports || [];
      const seen = new Set();
      const visiblePlaces = places.filter((place) => {
        const inLongitudeRange = west <= east ? place.lon >= west && place.lon <= east : place.lon >= west || place.lon <= east;
        if (place.lat < bounds.getSouth() || place.lat > bounds.getNorth() || !inLongitudeRange) return false;
        const key = place.icao ? `icao:${place.icao}` : place.iata ? `iata:${place.iata}` : `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      airportsInView = visiblePlaces;
      renderAirportMarkers();
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Unable to refresh airport labels from OpenStreetMap.", error);
    }
  }
  function renderAirportMarkers() {
    if (!map || !settings.airports) return;
    airportMarkers.splice(0).forEach((marker) => marker.remove());
    const groups = new Map();
    for (const place of airportsInView) {
      const point = map.project([place.lon, place.lat]);
      const key = `${Math.floor(point.x / 42)},${Math.floor(point.y / 42)}`;
      const group = groups.get(key) || { places: [] };
      group.places.push(place);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const longitude = group.places.reduce((sum, place) => sum + place.lon, 0) / group.places.length;
      const latitude = group.places.reduce((sum, place) => sum + place.lat, 0) / group.places.length;
      const element = el("button", group.places.length > 1 ? "airport-marker airport-cluster" : "airport-marker");
      element.type = "button";
      element.textContent = group.places.length > 1 ? String(group.places.length) : "";
      const name = group.places.length > 1 ? `${group.places.length} airports or aerodromes` : group.places[0].name || "Unnamed aerodrome";
      element.title = name;
      element.setAttribute("aria-label", name);
      if (group.places.length === 1) element.innerHTML = '<span class="airport-dot"></span>';
      const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat([longitude, latitude]).addTo(map);
      airportMarkers.push(marker);
      element.addEventListener("click", () => {
        if (group.places.length === 1) openAirport(group.places[0], group.places[0].name || "Unnamed aerodrome");
        else openAirportCluster(group.places);
      });
    }
  }
  function openAirportCluster(places) {
    $("detail-kicker").textContent = "AIRPORTS & AERODROMES";
    $("detail-title").textContent = `${places.length} nearby`;
    const content = $("detail-content");
    content.replaceChildren();
    const list = el("div", "airport-cluster-list");
    for (const place of places) {
      const button = el("button", "airport-cluster-item");
      button.type = "button";
      button.append(el("strong", "", place.name || "Unnamed aerodrome"), el("span", "", [place.icao, place.iata, place.type].filter(Boolean).join(" · ")));
      button.addEventListener("click", () => openAirport(place, place.name || "Unnamed aerodrome"));
      list.append(button);
    }
    content.append(list);
    $("detail-panel").classList.add("open");
    $("detail-panel").setAttribute("aria-hidden", "false");
    $("panel-scrim").classList.remove("hidden");
  }
  async function updateISS() {
    if (!map || !issMarker) return;
    try {
      const response = await fetch("/api/iss");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `ISS tracker returned HTTP ${response.status}`);
      issMarker.setLngLat([data.longitude, data.latitude]);
      $("iss-button").title = `ISS · ${Math.round(data.altitude)} km altitude`;
      if (centerIssWhenLoaded) {
        centerIssWhenLoaded = false;
        map.flyTo({ center: [data.longitude, data.latitude], zoom: Math.max(map.getZoom(), 4), duration: 1400, essential: true });
      }
    } catch (error) {
      console.error("Unable to update ISS position.", error);
    }
  }
  function centerOnISS() {
    if (!settings.iss) {
      centerIssWhenLoaded = true;
      settings.iss = true;
      saveSettings();
      setISSTracking(true);
      return;
    }
    const position = issMarker?.getLngLat();
    if (position) map?.flyTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), 4), duration: 1400, essential: true });
    else centerIssWhenLoaded = true;
  }
  function toggleISSTracking() {
    settings.iss = !settings.iss;
    saveSettings();
    setISSTracking(settings.iss);
  }
  function setISSTracking(enabled) {
    $("iss-button").setAttribute("aria-pressed", String(enabled));
    if (!map) return;
    clearInterval(issTimer);
    if (!enabled) {
      issMarker?.remove();
      issMarker = undefined;
      return;
    }
    if (!issMarker) {
      const markerElement = el("button", "iss-marker", "ISS");
      markerElement.type = "button";
      markerElement.setAttribute("aria-label", "International Space Station position");
      markerElement.title = "International Space Station";
      issMarker = new maplibregl.Marker({ element: markerElement, anchor: "center" }).setLngLat([0, 0]).addTo(map);
    }
    updateISS();
    issTimer = setInterval(updateISS, 10_000);
  }
  function openAirport(place, name) {
    const icao = place.icao || "";
    const iata = place.iata || "";
    const elevation = Number.isFinite(place.elevationFt) ? `${Math.round(place.elevationFt).toLocaleString()} ft` : "Not listed";
    $("detail-kicker").textContent = "AIRPORT INFORMATION";
    $("detail-title").textContent = name;
    const content = $("detail-content");
    content.replaceChildren();
    const section = el("div", "detail-section");
    section.append(el("h3", "", "AIRPORT DATA"));
    const grid = el("div", "detail-grid");
    const airportFields = [
      ["Airport", name], ["ICAO", icao || "Not listed"], ["IATA", iata || "Not listed"],
      ["Facility type", place.type || "Not listed"], ["Elevation", elevation],
      ["Location", [place.municipality, place.country].filter(Boolean).join(", ") || "Not listed"],
      ["Latitude", `${Number(place.lat).toFixed(5)}°`], ["Longitude", `${Number(place.lon).toFixed(5)}°`]
    ];
    for (const [label, value] of airportFields) {
      const field = el("div", "detail-field");
      field.append(el("span", "", label), el("strong", "", value));
      if (label === "ICAO" || label === "IATA" || label === "Elevation") field.dataset.airportField = label.toLowerCase();
      grid.append(field);
    }
    section.append(grid);
    content.append(section);
    const notice = el("div", "detail-section");
    notice.append(el("h3", "", "LATEST METAR"));
    notice.append(el("div", "airport-condition", "Looking up airport weather…"));
    content.append(notice);
    if (icao) loadAirportMetar(icao, notice.querySelector(".airport-condition"));
    else notice.querySelector(".airport-condition").textContent = "This airport record has no ICAO code for METAR lookup.";
    const traffic = el("div", "detail-section");
    traffic.append(el("h3", "", "AIRPORT TRAFFIC"));
    const grounded = aircraft.filter((flight) => flight.onGround && Math.hypot(flight.lat - Number(place.lat), (flight.lon - Number(place.lon)) * Math.cos(Number(place.lat) * Math.PI / 180)) < .07).length;
    traffic.append(el("div", "airport-condition", `Ground aircraft visible in this feed: ${grounded}. Arrivals and departures are not supplied by the live position source.`));
    content.append(traffic);
    const tags = place.tags || place.extratags || {};
    const frequencies = place.frequencies?.length
      ? place.frequencies.map((frequency) => [`${frequency.type} frequency`, `${frequency.description} · ${frequency.frequency}`])
      : Object.entries(tags).filter(([key, value]) => /freq/i.test(key) && String(value).trim());
    if (frequencies.length) {
      const frequencySection = el("div", "detail-section");
      frequencySection.append(el("h3", "", "AIRPORT FREQUENCIES"));
      const frequencyGrid = el("div", "detail-grid");
      for (const [key, value] of frequencies) {
        const label = key.replace(/^(communication:|aeroway:)/i, "").replace(/frequency|freq/gi, "").replace(/[:_]+/g, " ").trim() || "Radio";
        const field = el("div", "detail-field");
        field.append(el("span", "", label.replace(/\b\w/g, (letter) => letter.toUpperCase())), el("strong", "", String(value)));
        frequencyGrid.append(field);
      }
      frequencySection.append(frequencyGrid);
      content.append(frequencySection);
    }
    const runways = [
      ["Active runway", tags.active_runway || tags["runway:active"]],
      ["Arrival runway", tags.arrival_runway || tags["runway:arrival"]],
      ["Departure runway", tags.departure_runway || tags["runway:departure"]]
    ].filter(([, value]) => value);
    if (runways.length) {
      const runwaySection = el("div", "detail-section");
      runwaySection.append(el("h3", "", "ACTIVE RUNWAYS"));
      const runwayGrid = el("div", "detail-grid");
      for (const [label, value] of runways) {
        const field = el("div", "detail-field");
        field.append(el("span", "", label), el("strong", "", String(value)));
        runwayGrid.append(field);
      }
      runwaySection.append(runwayGrid);
      content.append(runwaySection);
    }
    const atc = el("div", "detail-section");
    atc.append(el("h3", "", "LIVE ATC"));
    atc.append(el("div", "airport-condition", icao ? "Open LiveATC in a new tab to check feed availability for this airport." : "A published ICAO code is required to search LiveATC."));
    if (icao) {
      const link = el("a", "external-feed-link", "Search LiveATC feeds ↗");
      link.href = `https://www.liveatc.net/search/?icao=${encodeURIComponent(icao)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      atc.append(link);
    }
    content.append(atc);
    $("detail-panel").classList.add("open");
    $("detail-panel").setAttribute("aria-hidden", "false");
    $("panel-scrim").classList.remove("hidden");
  }
  async function loadAirportMetar(icao, target) {
    try {
      const response = await fetch(`/api/metar?ids=${encodeURIComponent(icao)}`);
      if (!response.ok) throw new Error(`METAR service returned HTTP ${response.status}`);
      const [metar] = await response.json();
      if (!metar) {
        target.textContent = "No recent METAR was reported for this airport.";
        return;
      }
      const wind = metar.wspd == null ? "—" : `${metar.wdir === "VRB" ? "Variable" : `${metar.wdir}°`} at ${metar.wspd} kt${metar.wgst ? `, gusting ${metar.wgst} kt` : ""}`;
      target.replaceChildren();
      target.append(el("strong", "", metar.fltcat || "METAR"), el("br"), document.createTextNode(`${metar.rawOb || ""}\nWind ${wind} · Visibility ${metar.visib ?? "—"} · Temp ${metar.temp ?? "—"}°C · QNH ${metar.altim ?? "—"} hPa`));
    } catch (error) {
      console.error(`Unable to load METAR for ${icao}.`, error);
      target.textContent = "Current METAR is unavailable.";
    }
  }

  async function updateWeather() {
    const { lat, lon } = settings.location;
    try {
      const params = new URLSearchParams({ latitude: lat, longitude: lon, current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,visibility", daily: "sunrise,sunset", timezone: "auto", forecast_days: "1" });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
      const data = await response.json();
      weatherData = data;
      const current = data.current;
      const description = weatherDescription(current.weather_code);
      $("weather-temp").textContent = `${Math.round(current.temperature_2m)}°`;
      $("weather-summary").textContent = description.label;
      $("weather-icon").textContent = description.icon;
      $("weather-wind").textContent = `${Math.round(current.wind_speed_10m)} km/h`;
      $("weather-visibility").textContent = Number.isFinite(current.visibility) ? `${(current.visibility / 1000).toFixed(1)} km` : "—";
      $("weather-feels").textContent = `${Math.round(current.apparent_temperature)}°`;
      $("sunrise").textContent = `Sunrise ${new Date(data.daily.sunrise[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      $("sunset").textContent = `Sunset ${new Date(data.daily.sunset[0]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      $("board-temperature").textContent = `${Math.round(current.temperature_2m)}°`;
      $("standby-weather-icon").textContent = description.icon;
      $("standby-weather-temp").textContent = `${Math.round(current.temperature_2m)}°`;
    } catch (error) {
      console.error("Unable to refresh local weather.", error);
      $("weather-summary").textContent = "Weather unavailable";
    }
  }
  function weatherDescription(code) {
    if (code === 0) return { label: "Clear sky", icon: "☀" };
    if ([1, 2].includes(code)) return { label: "Partly cloudy", icon: "⛅" };
    if (code === 3) return { label: "Overcast", icon: "☁" };
    if ([45, 48].includes(code)) return { label: "Fog", icon: "〰" };
    if ([51, 53, 55, 56, 57].includes(code)) return { label: "Drizzle", icon: "🌦" };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "Rain", icon: "🌧" };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Snow", icon: "❄" };
    if ([95, 96, 99].includes(code)) return { label: "Thunderstorm", icon: "⛈" };
    return { label: "Conditions unavailable", icon: "☁" };
  }

  async function loadRadioStations() {
    const select = $("radio-station");
    try {
      const response = await fetch("/api/radio");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Radio directory returned HTTP ${response.status}`);
      radioStations = data.stations || [];
      if (data.warning) showMessage(data.warning);
      select.replaceChildren(new Option(radioStations.length ? "Choose an Irish station…" : "No secure streams available", ""));
      for (const [index, station] of radioStations.entries()) select.append(new Option(station.name, String(index)));
    } catch (error) {
      console.error("Unable to load radio stations.", error);
      select.replaceChildren(new Option("Radio directory unavailable", ""));
    }
  }
  function loadSpotifyEmbed() {
    const input = $("spotify-link");
    const match = input.value.trim().match(/^https:\/\/open\.spotify\.com\/(track|album|playlist|show|episode)\/([A-Za-z0-9]+)(?:[?#].*)?$/i);
    if (!match) {
      showMessage("Paste a Spotify track, album, playlist, show or episode link.");
      return;
    }
    spotifyUri = `spotify:${match[1].toLowerCase()}:${match[2]}`;
    setNowPlaying("Spotify", "", false);
    $("spotify-entry").classList.add("hidden");
    $("spotify-edit").classList.remove("hidden");
    $("spotify-embed").classList.remove("hidden");
    if (spotifyIframeApi) {
      createSpotifyPlayer(spotifyIframeApi);
      return;
    }
    window.onSpotifyIframeApiReady = (api) => {
      spotifyIframeApi = api;
      createSpotifyPlayer(api);
    };
    if (!document.querySelector('script[data-spotify-iframe-api]')) {
      const script = document.createElement("script");
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
      script.dataset.spotifyIframeApi = "true";
      script.addEventListener("error", () => {
        const embed = $("spotify-embed");
        let mount = $("spotify-player");
        if (!mount) {
          mount = el("div");
          mount.id = "spotify-player";
          embed.replaceChildren(mount);
        }
        const frame = document.createElement("iframe");
        frame.title = "Spotify player";
        frame.loading = "lazy";
        frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
        const [, type, id] = spotifyUri.split(":");
        frame.src = `https://open.spotify.com/embed/${type}/${id}`;
        mount.replaceChildren(frame);
      }, { once: true });
      document.head.append(script);
    }
  }
  function createSpotifyPlayer(api) {
    const embed = $("spotify-embed");
    let mount = $("spotify-player");
    if (!mount) {
      mount = el("div");
      mount.id = "spotify-player";
      embed.replaceChildren(mount);
    } else {
      mount.replaceChildren();
    }
    spotifyController?.destroy?.();
    api.createController(mount, { uri: spotifyUri, width: "100%", height: 152 }, (controller) => {
      spotifyController = controller;
      controller.addListener("playback_update", (event) => {
        const paused = event.data?.isPaused !== false;
        const title = event.data?.track?.name || "Spotify";
        setNowPlaying("Spotify", title, !paused);
      });
    });
  }
  async function loadIncidents() {
    const list = $("incident-list");
    list.replaceChildren(el("div", "empty-row", "Loading recent aviation reports…"));
    try {
      const response = await fetch("/api/incidents");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || `Incident feed returned HTTP ${response.status}`);
      if (!data.incidents?.length) throw new Error("No recent incident reports were returned.");
      incidentReports = data.incidents;
      renderIncidentReports();
    } catch (error) {
      console.error("Unable to load aviation incidents.", error);
      const retry = el("div", "empty-row", "The external incident feed is temporarily unavailable.");
      list.replaceChildren(retry);
    }
  }
  function renderIncidentReports() {
    const list = $("incident-list");
    const severityRank = { Critical: 4, High: 3, Moderate: 2, Report: 1 };
    const reports = [...incidentReports].sort((a, b) => {
      if (incidentSort === "severity") return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || (b.occurrenceTime || 0) - (a.occurrenceTime || 0);
      if (incidentSort === "type") return String(a.aircraftType || "").localeCompare(String(b.aircraftType || ""));
      if (incidentSort === "location") return String(a.location || "").localeCompare(String(b.location || ""));
      return (b.occurrenceTime || 0) - (a.occurrenceTime || 0);
    });
    list.replaceChildren(...reports.map((incident) => {
        const card = el("article", "incident-card info-card");
        const headline = el("div", "incident-headline");
        const time = incident.occurrenceTime ? new Date(incident.occurrenceTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : incident.date || "Time not reported";
        headline.append(el("span", "eyebrow", time));
        if (incident.severity) headline.append(el("span", `incident-severity severity-${String(incident.severity).toLowerCase()}`, incident.severity));
        card.append(headline, el("h3", "", incident.title));
        if (incident.aircraftType || incident.location) {
          const details = el("div", "incident-details");
          if (incident.aircraftType) details.append(el("span", "", incident.aircraftType));
          if (incident.location) details.append(el("span", "", incident.location));
          card.append(details);
        }
        card.append(el("p", "", incident.summary || "Open the source for report details."));
        const link = el("a", "external-feed-link", "Read report ↗");
        link.href = incident.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        card.append(link);
        return card;
      }));
  }
  function configureQuizPlayers() {
    const count = Number($("quiz-player-count").value) || 1;
    const names = [...$("quiz-player-names").querySelectorAll("input")].map((input) => input.value.trim());
    const previous = [...quizPlayers];
    quizPlayers.splice(0, quizPlayers.length, ...Array.from({ length: count }, (_value, index) => ({
      name: names[index] || settings.quizNames?.[index] || previous[index]?.name || `Player ${index + 1}`,
      score: previous[index]?.score || 0
    })));
    $("quiz-player-names").replaceChildren(...quizPlayers.map((player, index) => {
      const label = el("label", "quiz-name-field", `Player ${index + 1}`);
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 24;
      input.value = player.name;
      input.setAttribute("aria-label", `Player ${index + 1} name`);
      input.addEventListener("input", () => {
        player.name = input.value.trim() || `Player ${index + 1}`;
        settings.quizNames = quizPlayers.map((item) => item.name);
        saveSettings();
        renderQuizScoreboard();
        updateQuizTurnLabel();
      });
      label.append(input);
      return label;
    }));
    settings.quizNames = quizPlayers.map((player) => player.name);
    renderQuizScoreboard();
    startQuizRound();
  }
  function renderQuizScoreboard(showWinner = false) {
    const scoreboard = $("quiz-scoreboard");
    scoreboard.replaceChildren(...quizPlayers.map((player, index) => {
      const item = el("div", `quiz-player-score${index === quizPlayerIndex ? " active" : ""}`);
      item.append(el("span", "", player.name), el("strong", "", String(player.score)));
      return item;
    }));
    if (showWinner && quizPlayers.length) {
      const highestScore = Math.max(...quizPlayers.map((player) => player.score));
      const winners = quizPlayers.filter((player) => player.score === highestScore);
      scoreboard.append(el("div", "quiz-winner", winners.length === 1
        ? `${winners[0].name} leads with ${highestScore} point${highestScore === 1 ? "" : "s"}`
        : `Tie at ${highestScore} point${highestScore === 1 ? "" : "s"}`));
    }
  }
  function updateQuizTurnLabel() {
    const player = quizPlayers[quizPlayerIndex];
    $("quiz-turn-label").textContent = player ? `${player.name.toUpperCase()} · ${quizPlayerIndex + 1}/${quizPlayers.length}` : "";
  }
  function startAirportQuiz() {
    currentQuizMode = $("quiz-mode").value;
    startQuizRound();
  }
  function startQuizRound() {
    if (!quizPlayers.length) {
      configureQuizPlayers();
      return;
    }
    quizPlayerIndex = 0;
    const shared = quizAirports[Math.floor(Math.random() * quizAirports.length)];
    quizRoundAirports = quizPlayers.map(() => $("quiz-same-question").checked
      ? shared
      : quizAirports[Math.floor(Math.random() * quizAirports.length)]);
    showQuizQuestion();
  }
  function showQuizQuestion() {
    clearInterval(quizTimer);
    $("quiz-next").classList.remove("active");
    const airport = quizRoundAirports[quizPlayerIndex];
    if (!airport) return;
    currentQuizMode = $("quiz-mode").value;
    $("quiz-region").textContent = airport.country.toUpperCase();
    $("quiz-airport-name").textContent = airport.name;
    $("quiz-airport-clue").textContent = currentQuizMode === "airline"
      ? `Which airline is most closely associated with ${airport.iata}?`
      : `Identify the ${currentQuizMode.toUpperCase()} code for this airport.`;
    $("quiz-feedback").textContent = "";
    $("quiz-options").replaceChildren();
    $("quiz-next").classList.add("hidden");
    $("quiz-timer").classList.toggle("hidden", !$("quiz-timer-enabled").checked);
    updateQuizTurnLabel();
    const correct = airport[currentQuizMode];
    const distractors = [...new Set(quizAirports.map((item) => item[currentQuizMode]).filter((answer) => answer !== correct))];
    const choices = [correct, ...distractors.sort(() => Math.random() - 0.5).slice(0, 3)].sort(() => Math.random() - 0.5);
    for (const answer of choices) {
      const button = el("button", "quiz-choice", answer);
      button.type = "button";
      button.addEventListener("click", () => answerQuiz(answer, correct));
      $("quiz-options").append(button);
    }
    if ($("quiz-timer-enabled").checked) {
      quizSeconds = 20;
      $("quiz-timer").textContent = String(quizSeconds);
      quizTimer = setInterval(() => {
        quizSeconds -= 1;
        $("quiz-timer").textContent = String(quizSeconds);
        if (quizSeconds <= 0) answerQuiz("", correct, true);
      }, 1000);
    }
    renderQuizScoreboard();
  }
  function answerQuiz(answer, correct, timedOut = false) {
    if ($("quiz-next").classList.contains("active")) return;
    clearInterval(quizTimer);
    $("quiz-next").classList.add("active");
    const right = answer === correct;
    if (right) quizPlayers[quizPlayerIndex].score += 1;
    $("quiz-feedback").textContent = timedOut ? `Time's up — the answer is ${correct}.`
      : right ? "Correct — +1 point." : `Not quite — the answer is ${correct}.`;
    $("quiz-feedback").classList.toggle("correct", right);
    $("quiz-feedback").classList.toggle("incorrect", !right);
    $("quiz-options").querySelectorAll("button").forEach((choice) => {
      choice.disabled = true;
      if (choice.textContent === correct) choice.classList.add("correct-answer");
    });
    const finalPlayer = quizPlayerIndex === quizPlayers.length - 1;
    $("quiz-next").textContent = finalPlayer ? "Next round" : "Next player";
    $("quiz-next").classList.remove("hidden");
    renderQuizScoreboard(finalPlayer);
  }
  function advanceQuiz() {
    if (!$("quiz-next").classList.contains("active")) return;
    if (quizPlayerIndex < quizPlayers.length - 1) {
      quizPlayerIndex += 1;
      showQuizQuestion();
    } else {
      startQuizRound();
    }
    $("quiz-next").classList.remove("active");
  }

  async function searchLocation(query) {
    const trimmed = query.trim();
    if (!trimmed) return;
    const coordinateMatch = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordinateMatch) {
      const lat = Number(coordinateMatch[1]), lon = Number(coordinateMatch[2]);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        showMessage("Coordinates must be within latitude −90…90 and longitude −180…180.");
        return;
      }
      await selectLocation({ lat, lon, name: `${lat.toFixed(2)}, ${lon.toFixed(2)}` });
      return;
    }
    const resultBox = $("search-results");
    resultBox.replaceChildren(el("button", "", "Searching locations…"));
    resultBox.classList.remove("hidden");
    try {
      const params = new URLSearchParams({ q: trimmed });
      const response = await fetch(`/api/geocode?${params}`);
      if (!response.ok) throw new Error(`Location search returned HTTP ${response.status}`);
      const results = await response.json();
      resultBox.replaceChildren();
      if (!results.length) resultBox.append(el("button", "", "No matching places found."));
      for (const place of results) {
        const button = el("button");
        button.append(el("span", "", place.name || place.display_name.split(",")[0]), el("small", "", place.display_name));
        button.addEventListener("click", () => {
          resultBox.classList.add("hidden");
          selectLocation({ lat: Number(place.lat), lon: Number(place.lon), name: place.display_name.split(",").slice(0, 2).join(",") });
        });
        resultBox.append(button);
      }
    } catch (error) {
      console.error("Location search failed.", error);
      resultBox.replaceChildren(el("button", "", "Location search is temporarily unavailable."));
    }
  }
  async function selectLocation(location) {
    settings.location = location;
    saveSettings();
    setLocationLabel();
    if (map) map.flyTo({ center: [location.lon, location.lat], zoom: Math.max(map.getZoom(), 7), duration: 1300 });
    await updateWeather();
  }
  function geolocate() {
    if (!navigator.geolocation) {
      showMessage("This browser does not support geolocation.");
      return;
    }
    $("locate-button").classList.add("active");
    navigator.geolocation.getCurrentPosition(async (position) => {
      const location = { lat: position.coords.latitude, lon: position.coords.longitude, name: "My location" };
      await selectLocation(location);
      $("locate-button").classList.remove("active");
    }, (error) => {
      $("locate-button").classList.remove("active");
      const reasons = { 1: "Location permission was denied.", 2: "Your location could not be determined.", 3: "Location request timed out." };
      showMessage(reasons[error.code] || "Unable to get your location.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function setStandby(enabled) {
    settings.standby = enabled;
    document.body.classList.toggle("standby-mode", enabled);
    $("standby-overlay").classList.toggle("hidden", !enabled);
    $("standby-button").classList.toggle("active", enabled);
    $("setting-standby").checked = enabled;
    $("media-box").classList.toggle("hidden", enabled);
    if (map) {
      for (const interaction of ["scrollZoom", "dragPan", "doubleClickZoom", "touchZoomRotate", "boxZoom", "keyboard"]) {
        map[interaction][enabled ? "disable" : "enable"]();
      }
      requestAnimationFrame(() => {
        map.resize();
        refreshAircraft();
        updateAirports();
      });
    }
    $("standby-clock").className = `standby-time ${settings.clockStyle}`;
    saveSettings();
    renderAircraft();
  }
  function setClockDisplay(element, date, seconds = false) {
    const formatted = formatClock(date);
    const match = settings.clockFormat === "12" ? formatted.match(/^(.*?)\s+(AM|PM)$/i) : null;
    const time = match ? match[1] : formatted;
    element.replaceChildren(document.createTextNode(seconds
      ? `${time}:${String(date.getSeconds()).padStart(2, "0")}`
      : time));
    if (match) element.append(el("span", "clock-period", match[2].toUpperCase()));
  }
  function updateClock() {
    const now = new Date();
    setClockDisplay($("header-clock"), now, true);
    setClockDisplay($("mini-clock"), now);
    $("clock-date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    setClockDisplay($("standby-clock"), now);
    $("standby-date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    $("standby-clock").className = `standby-time ${settings.clockStyle}`;
    $("mini-clock").className = `mini-clock ${settings.clockStyle}`;
    $("weather-toggle").classList.toggle("active", settings.weather);
    $("sunrise").parentElement.parentElement.classList.toggle("hidden", !settings.sun);
    document.querySelector(".weather-main").classList.toggle("hidden", !settings.weather);
    document.querySelector(".weather-stats").classList.toggle("hidden", !settings.weather);
    $("standby-weather").classList.toggle("hidden", !settings.weather || !weatherData);
    syncNowPlaying();
  }
  function syncNowPlaying() {
    const active = settings.nowPlaying && Boolean(nowPlayingTitle);
    const nowLabel = active ? `Now Playing · ${nowPlayingKind} · ${nowPlayingTitle}` : "";
    $("dashboard-now-playing").textContent = nowLabel;
    $("dashboard-now-playing").classList.toggle("hidden", !active);
    $("standby-now-playing").textContent = nowLabel;
    $("standby-now-playing").classList.toggle("hidden", !active);
    $("standby-weather").classList.toggle("rotation-visible", settings.weather && !nowPlayingAlternate);
    $("standby-now-playing").classList.toggle("rotation-visible", active && nowPlayingAlternate);
    $("standby-weather").setAttribute("aria-hidden", String(!settings.weather || nowPlayingAlternate));
    $("standby-now-playing").setAttribute("aria-hidden", String(!active || !nowPlayingAlternate));
    if (active && settings.weather) {
      if (!nowPlayingRotationTimer) {
        nowPlayingRotationTimer = setInterval(() => {
          nowPlayingAlternate = !nowPlayingAlternate;
          $("standby-weather").classList.toggle("rotation-visible", !nowPlayingAlternate);
          $("standby-now-playing").classList.toggle("rotation-visible", nowPlayingAlternate);
          $("standby-weather").setAttribute("aria-hidden", String(nowPlayingAlternate));
          $("standby-now-playing").setAttribute("aria-hidden", String(!nowPlayingAlternate));
        }, 4500);
      }
    } else {
      clearInterval(nowPlayingRotationTimer);
      nowPlayingRotationTimer = undefined;
      nowPlayingAlternate = false;
      $("standby-weather").classList.toggle("rotation-visible", settings.weather);
      $("standby-now-playing").classList.remove("rotation-visible");
      $("standby-weather").setAttribute("aria-hidden", String(!settings.weather));
      $("standby-now-playing").setAttribute("aria-hidden", "true");
    }
  }
  function setNowPlaying(kind, title = "", active = true) {
    if (active) playingMedia.set(kind, title);
    else playingMedia.delete(kind);
    const current = [...playingMedia.entries()].at(-1) || ["", ""];
    [nowPlayingKind, nowPlayingTitle] = current;
    syncNowPlaying();
  }
  function applyTheme() {
    const themes = ["dark", "light", "amoled", "liquid", "christmas", "retro"];
    if (!themes.includes(settings.theme)) settings.theme = "amoled";
    document.body.classList.toggle("light-theme", settings.theme === "light");
    document.body.classList.remove(...themes.map((theme) => `theme-${theme}`));
    document.body.classList.add(`theme-${settings.theme}`);
    $("setting-theme").value = settings.theme;
    const resolvedAccent = settings.autoAccent ? (settings.theme === "light" ? "#14181d" : "#ffffff") : settings.accent;
    document.documentElement.style.setProperty("--accent", resolvedAccent);
    document.querySelectorAll("[data-accent]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.accent === settings.accent)));
    $("setting-auto-accent").checked = settings.autoAccent;
    $("setting-accent").disabled = settings.autoAccent;
    document.querySelectorAll("[data-accent]").forEach((button) => { button.disabled = settings.autoAccent; });
    if (map) map.setStyle(settings.theme === "light" ? "https://tiles.openfreemap.org/styles/bright" : "https://tiles.openfreemap.org/styles/dark");
  }
  function installAccentControls() {
    const themeRow = $("setting-theme").closest(".select-row");
    const row = el("label", "accent-setting");
    row.append(el("span", "", "Accent colour"));
    const options = el("div", "accent-swatches");
    for (const [label, colour] of [["Blue", "#8da8ff"], ["Orange", "#ff9e57"], ["Red", "#f07878"], ["Purple", "#c39bff"], ["Yellow", "#f0cf69"]]) {
      const swatch = el("button");
      swatch.type = "button";
      swatch.dataset.accent = colour;
      swatch.setAttribute("aria-label", `${label} accent`);
      swatch.style.setProperty("--swatch", colour);
      options.append(swatch);
    }
    const picker = document.createElement("input");
    picker.id = "setting-accent";
    picker.type = "color";
    picker.setAttribute("aria-label", "Custom accent colour");
    options.append(picker);
    row.append(options);
    themeRow.after(row);
  }
  function installColumnControls() {
    const tableWrap = document.querySelector(".table-wrap");
    document.querySelector(".aircraft-table thead").id = "aircraft-table-head";
    const tools = el("div", "board-tools");
    const button = el("button", "toolbar-button", "☷ Columns");
    button.id = "columns-button";
    button.type = "button";
    const menu = el("div", "column-menu hidden");
    menu.id = "column-menu";
    menu.setAttribute("aria-label", "Traffic board columns");
    tools.append(button, menu);
    tableWrap.before(tools);
  }
  function syncSettingsControls() {
    for (const key of ["weather", "sun", "labels", "airports", "radio", "nowPlaying", "detailed", "standby"]) {
      const controlKey = key === "nowPlaying" ? "now-playing" : key;
      $(`setting-${controlKey}`).checked = settings[key];
    }
    $("setting-clock-format").value = settings.clockFormat;
    $("setting-clock-style").value = settings.clockStyle;
    $("labels-button").setAttribute("aria-pressed", String(settings.labels));
    $("airports-button").setAttribute("aria-pressed", String(settings.airports));
    $("iss-button").setAttribute("aria-pressed", String(settings.iss));
    $("radio-controls").classList.toggle("hidden", !settings.radio);
    $("quiz-player-count").value = String(settings.quizPlayerCount || 1);
    $("quiz-same-question").checked = settings.quizSameQuestion;
    $("quiz-timer-enabled").checked = settings.quizTimer;
    applyTheme();
    setLocationLabel();
    setStandby(settings.standby);
    updateClock();
  }

  function openSettings() {
    $("settings-drawer").classList.add("open");
    $("settings-drawer").setAttribute("aria-hidden", "false");
    $("settings-scrim").classList.remove("hidden");
  }
  function renderColumnMenu() {
    const menu = $("column-menu");
    menu.replaceChildren();
    for (const key of columnOrder) {
      const definition = columnDefinitions.find((column) => column.key === key);
      const row = el("label", "column-option");
      row.draggable = true;
      row.dataset.column = key;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = visibleColumns.has(key);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) visibleColumns.add(key);
        else if (visibleColumns.size > 1) visibleColumns.delete(key);
        else {
          checkbox.checked = true;
          return;
        }
        orderedVisibleColumns = columnOrder.filter((column) => visibleColumns.has(column));
        settings.columns = orderedVisibleColumns;
        saveSettings();
        renderTable();
      });
      row.append(checkbox, el("span", "", definition.label), el("span", "drag-handle", "⋮⋮"));
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", key);
        event.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragover", (event) => event.preventDefault());
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const from = event.dataTransfer.getData("text/plain");
        const to = key;
        if (!from || from === to) return;
        const fromIndex = columnOrder.indexOf(from);
        const toIndex = columnOrder.indexOf(to);
        columnOrder.splice(fromIndex, 1);
        columnOrder.splice(toIndex, 0, from);
        orderedVisibleColumns = columnOrder.filter((column) => visibleColumns.has(column));
        settings.columns = orderedVisibleColumns;
        settings.columnOrder = [...columnOrder];
        saveSettings();
        renderColumnMenu();
        renderTable();
      });
      menu.append(row);
    }
  }
  function closeSettings() {
    $("settings-drawer").classList.remove("open");
    $("settings-drawer").setAttribute("aria-hidden", "true");
    $("settings-scrim").classList.add("hidden");
  }
  function closeDetails() {
    $("detail-panel").classList.remove("open");
    $("detail-panel").setAttribute("aria-hidden", "true");
    $("panel-scrim").classList.add("hidden");
    selectedIcao = "";
    renderAircraft();
  }
  function setPage(pageId) {
    document.querySelectorAll(".page-view").forEach((page) => page.classList.toggle("active", page.id === pageId));
    document.querySelectorAll(".workspace-menu [data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === pageId));
    const labels = {
      "map-page": ["THE WORLD ABOVE YOU", "Live map"],
      "traffic-page": ["LIVE · YOUR AIRSPACE", "Traffic board"],
      "games-page": ["AIRPORT KNOWLEDGE", "Airport quiz"],
      "incidents-page": ["EXTERNAL AVIATION NEWS", "Incident feed"],
      "statistics-page": ["CURRENT MAP VIEW", "Live statistics"],
      "about-page": ["AEROAM", "About"]
    };
    $("page-eyebrow").textContent = labels[pageId][0];
    $("page-title").textContent = labels[pageId][1];
    $("workspace-menu").classList.add("hidden");
    $("workspace-button").setAttribute("aria-expanded", "false");
    setStandby(false);
    if (pageId === "map-page" && map) setTimeout(() => map.resize(), 50);
    if (pageId === "statistics-page") renderStatistics();
    if (pageId === "incidents-page") loadIncidents();
  }

  $("search-submit").addEventListener("click", () => { clearTimeout(searchTimer); searchLocation($("location-search").value); });
  $("location-search").addEventListener("keydown", (event) => { if (event.key === "Enter") { clearTimeout(searchTimer); searchLocation(event.currentTarget.value); } });
  $("location-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = $("location-search").value.trim();
    if (query.length >= 3 && !/^-?\d/.test(query)) searchTimer = setTimeout(() => searchLocation(query), 1100);
    else $("search-results").classList.add("hidden");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) $("search-results").classList.add("hidden");
  });
  $("locate-button").addEventListener("click", geolocate);
  $("standby-button").addEventListener("click", () => setStandby(!settings.standby));
  $("standby-exit").addEventListener("click", () => setStandby(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { setStandby(false); closeSettings(); closeDetails(); } });
  $("zoom-in").addEventListener("click", () => map?.zoomIn());
  $("zoom-out").addEventListener("click", () => map?.zoomOut());
  $("iss-button").addEventListener("click", (event) => {
    event.stopPropagation();
    if (issClickTimer) {
      clearTimeout(issClickTimer);
      issClickTimer = undefined;
      centerOnISS();
      return;
    }
    issClickTimer = setTimeout(() => {
      issClickTimer = undefined;
      toggleISSTracking();
    }, 280);
  });
  $("iss-button").addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  $("labels-button").addEventListener("click", () => {
    settings.labels = !settings.labels;
    $("setting-labels").checked = settings.labels;
    $("labels-button").setAttribute("aria-pressed", String(settings.labels));
    saveSettings(); renderAircraft();
  });
  $("airports-button").addEventListener("click", () => {
    settings.airports = !settings.airports;
    $("setting-airports").checked = settings.airports;
    $("airports-button").setAttribute("aria-pressed", String(settings.airports));
    saveSettings(); updateAirports();
  });
  $("weather-toggle").addEventListener("click", () => {
    settings.weather = !settings.weather;
    $("setting-weather").checked = settings.weather;
    saveSettings(); updateClock();
  });
  document.querySelectorAll(".workspace-menu [data-page]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.go)));
  $("aircraft-search").addEventListener("input", renderTable);
  $("board-refresh").addEventListener("click", refreshAircraft);
  $("airline-filter").addEventListener("change", renderAircraft);
  $("aircraft-type-filter").addEventListener("change", renderAircraft);
  $("radio-station").addEventListener("change", async (event) => {
    const station = radioStations[Number(event.target.value)];
    const player = $("radio-player");
    if (!station) {
      player.pause();
      player.removeAttribute("src");
      player.load();
      setNowPlaying("Radio", "", false);
      return;
    }
    if (station.externalUrl) {
      player.pause();
      player.removeAttribute("src");
      player.load();
      window.open(station.externalUrl, "_blank", "noopener,noreferrer");
      setNowPlaying("Radio", station.name.replace(/\s*·\s*official player/i, ""));
      return;
    }
    player.src = station.url;
    try {
      await player.play();
    } catch (error) {
      console.error("Radio playback could not start.", error);
      showMessage("This station could not start playback. Try another stream.");
    }
  });
  $("radio-stop").addEventListener("click", () => {
    $("radio-player").pause();
    $("radio-player").removeAttribute("src");
    $("radio-player").load();
    $("radio-station").value = "";
    setNowPlaying("Radio", "", false);
  });
  $("spotify-load").addEventListener("click", loadSpotifyEmbed);
  $("spotify-link").addEventListener("keydown", (event) => { if (event.key === "Enter") loadSpotifyEmbed(); });
  $("spotify-edit").addEventListener("click", () => {
    $("spotify-entry").classList.remove("hidden");
    $("spotify-edit").classList.add("hidden");
    $("spotify-link").focus();
  });
  $("radio-player").addEventListener("play", () => {
    const station = radioStations[Number($("radio-station").value)];
    if (station) setNowPlaying("Radio", station.name);
  });
  $("radio-player").addEventListener("pause", () => setNowPlaying("Radio", "", false));
  $("radio-player").addEventListener("ended", () => setNowPlaying("Radio", "", false));
  $("quiz-mode").addEventListener("change", startAirportQuiz);
  $("quiz-next").addEventListener("click", advanceQuiz);
  $("quiz-player-count").addEventListener("change", (event) => {
    settings.quizPlayerCount = Number(event.target.value);
    saveSettings();
    configureQuizPlayers();
  });
  $("quiz-same-question").addEventListener("change", (event) => {
    settings.quizSameQuestion = event.target.checked;
    saveSettings();
    startQuizRound();
  });
  $("quiz-timer-enabled").addEventListener("change", (event) => {
    settings.quizTimer = event.target.checked;
    saveSettings();
    startQuizRound();
  });
  $("quiz-reset").addEventListener("click", () => {
    quizPlayers.forEach((player) => { player.score = 0; });
    saveSettings();
    renderQuizScoreboard();
    startQuizRound();
  });
  $("quiz-show-map").addEventListener("click", () => {
    const airport = quizRoundAirports[quizPlayerIndex];
    if (!airport) return;
    setPage("map-page");
    map?.flyTo({ center: [airport.lon, airport.lat], zoom: 10, duration: 1200 });
  });
  $("incidents-refresh").addEventListener("click", loadIncidents);
  $("incident-sort").addEventListener("change", (event) => {
    incidentSort = event.target.value;
    renderIncidentReports();
  });
  $("statistics-refresh").addEventListener("click", renderStatistics);
  document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.sort;
    sortAscending = sortKey === key ? !sortAscending : true;
    sortKey = key; renderTable();
  }));
  $("detail-close").addEventListener("click", closeDetails);
  $("panel-scrim").addEventListener("click", closeDetails);
  $("workspace-button").addEventListener("click", () => {
    const menu = $("workspace-menu");
    const open = menu.classList.toggle("hidden") === false;
    $("workspace-button").setAttribute("aria-expanded", String(open));
  });
  $("menu-settings").addEventListener("click", () => {
    $("workspace-menu").classList.add("hidden");
    $("workspace-button").setAttribute("aria-expanded", "false");
    openSettings();
  });
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-scrim").addEventListener("click", closeSettings);
  const settingsMap = { "setting-weather": "weather", "setting-sun": "sun", "setting-labels": "labels", "setting-airports": "airports", "setting-detailed": "detailed" };
  for (const [id, key] of Object.entries(settingsMap)) {
    $(id).addEventListener("change", (event) => {
      settings[key] = event.target.checked;
      saveSettings(); syncSettingsControls();
      if (key === "labels") renderAircraft();
      if (key === "airports") updateAirports();
      if (key === "detailed" && selectedIcao) openAircraft(selectedIcao);
    });
  }
  $("setting-radio").addEventListener("change", (event) => {
    settings.radio = event.target.checked;
    $("radio-controls").classList.toggle("hidden", !settings.radio);
    if (!settings.radio) $("radio-stop").click();
    saveSettings();
  });
  $("setting-now-playing").addEventListener("change", (event) => {
    settings.nowPlaying = event.target.checked;
    saveSettings();
    syncNowPlaying();
  });
  $("setting-standby").addEventListener("change", (event) => setStandby(event.target.checked));
  $("setting-theme").addEventListener("change", (event) => { settings.theme = event.target.value; applyTheme(); saveSettings(); });
  $("setting-auto-accent").addEventListener("change", (event) => {
    settings.autoAccent = event.target.checked;
    applyTheme();
    saveSettings();
  });
  installAccentControls();
  installColumnControls();
  $("setting-accent").value = settings.accent;
  document.querySelectorAll("[data-accent]").forEach((button) => button.addEventListener("click", () => {
    settings.accent = button.dataset.accent;
    settings.autoAccent = false;
    $("setting-auto-accent").checked = false;
    $("setting-accent").value = settings.accent;
    applyTheme(); saveSettings();
  }));
  $("setting-accent").addEventListener("input", (event) => {
    settings.accent = event.target.value;
    settings.autoAccent = false;
    $("setting-auto-accent").checked = false;
    applyTheme(); saveSettings();
  });
  $("setting-clock-format").addEventListener("change", (event) => { settings.clockFormat = event.target.value; saveSettings(); updateClock(); });
  $("setting-clock-style").addEventListener("change", (event) => { settings.clockStyle = event.target.value; saveSettings(); updateClock(); });
  $("save-location").addEventListener("click", () => searchLocation($("setting-location").value));
  $("columns-button").addEventListener("click", () => {
    renderColumnMenu();
    $("column-menu").classList.toggle("hidden");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".board-tools")) $("column-menu").classList.add("hidden");
    if (!event.target.closest(".workspace-menu-wrap")) {
      $("workspace-menu").classList.add("hidden");
      $("workspace-button").setAttribute("aria-expanded", "false");
    }
  });
  syncSettingsControls();
  renderColumnMenu();
  renderStatistics();
  renderTable();
  configureQuizPlayers();
  initializeMap();
  loadRadioStations();
  updateWeather();
  updateClock();
  setInterval(updateClock, 1000);
})();
