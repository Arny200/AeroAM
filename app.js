(() => {
  const defaultLocation = { name: "Dublin, Ireland", lat: 53.3498, lon: -6.2603 };
  const storageKey = "aeroam-settings-v1";
  const defaults = { theme: "dark", accent: "#8da8ff", clockFormat: "24", clockStyle: "modern", weather: true, sun: true, airways: false, labels: true, airports: true, detailed: true, standby: true, location: defaultLocation };
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
  let weatherData = null;
  let sortKey = "callsign";
  let sortAscending = true;
  let searchTimer;
  const markers = new Map();
  const markerAnimations = new Map();
  const aircraftDetailsCache = new Map();
  const columnDefinitions = [
    { key: "callsign", label: "Callsign", sortable: true },
    { key: "registration", label: "Registration" },
    { key: "type", label: "Aircraft type" },
    { key: "airlineLogo", label: "Airline logo" },
    { key: "airline", label: "Airline / operator" },
    { key: "altitude", label: "Altitude", sortable: true },
    { key: "speed", label: "Ground speed", sortable: true },
    { key: "heading", label: "Heading", sortable: true },
    { key: "origin", label: "Origin" },
    { key: "destination", label: "Destination" }
  ];
  const columnOrder = Array.isArray(settings.columnOrder)
    ? [...settings.columnOrder.filter((key) => columnDefinitions.some((column) => column.key === key)), ...columnDefinitions.map((column) => column.key).filter((key) => !settings.columnOrder.includes(key))]
    : columnDefinitions.map((column) => column.key);
  const visibleColumns = new Set(Array.isArray(settings.columns)
    ? settings.columns.filter((key) => columnDefinitions.some((column) => column.key === key))
    : ["callsign", "registration", "type", "airline", "altitude", "speed", "heading", "origin", "destination"]);
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
      style: settings.theme === "dark" ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/bright",
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
    map.on("load", () => { refreshAircraft(); updateAirports(); });
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
        icao: String(row[0]).trim().toUpperCase(), callsign: String(row[1] || "").trim() || "Unknown",
        country: row[2] || "", timePosition: row[3], lastContact: row[4],
        lon: row[5], lat: row[6], baroAltitude: row[7], onGround: Boolean(row[8]),
        velocity: row[9], heading: row[10], verticalRate: row[11], squawk: row[14],
        spi: row[15], positionSource: row[16], category: row[17]
      }));
      renderAircraft();
      const showingCached = responses.some((data) => data.stale);
      $("aircraft-count").textContent = `${aircraft.length.toLocaleString()} aircraft in view${showingCached ? " · cached" : ""}`;
      $("board-count").textContent = aircraft.length.toLocaleString();
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
    if (settings.labels && !settings.standby) marker.appendChild(el("span", "plane-label", flight.callsign || flight.icao));
    return marker;
  }

  function renderAircraft() {
    if (!map) return;
    const liveIcaos = new Set(aircraft.map((flight) => flight.icao));
    for (const [icao, marker] of markers) {
      if (!liveIcaos.has(icao)) {
        const frame = markerAnimations.get(icao);
        if (frame) cancelAnimationFrame(frame);
        markerAnimations.delete(icao);
        marker.remove();
        markers.delete(icao);
      }
    }
    for (const flight of aircraft) {
      let marker = markers.get(flight.icao);
      if (!marker) {
        const element = el("button", "plane-marker");
        element.type = "button";
        element.setAttribute("aria-label", `Aircraft ${flight.callsign}`);
        element.title = flight.callsign;
        marker = new maplibregl.Marker({ element, anchor: "center", rotationAlignment: "map" })
          .setLngLat([flight.lon, flight.lat]).addTo(map);
        element.addEventListener("click", () => openAircraft(flight.icao));
        markers.set(flight.icao, marker);
      }
      animateMarker(marker, flight.lat, flight.lon, flight.icao);
      marker.getElement().innerHTML = markerMarkup(flight, flight.icao === selectedIcao).outerHTML;
      const glyph = marker.getElement().querySelector(".plane-glyph");
      if (glyph) glyph.style.transform = `rotate(${Number.isFinite(flight.heading) ? flight.heading : 0}deg)`;
      marker.getElement().title = flight.callsign;
      marker.getElement().setAttribute("aria-label", `Aircraft ${flight.callsign}`);
    }
    renderNearby();
    renderTable();
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
  function renderNearby() {
    const nearest = [...aircraft].sort((a, b) => distanceKm(a) - distanceKm(b)).slice(0, 3);
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
      meta.append(el("span", "nearby-callsign", flight.callsign), el("span", "nearby-route", `${flight.country} · ${Math.round(distanceKm(flight))} km away`));
      row.append(meta);
      const value = el("span", "nearby-alt");
      value.append(el("span", "", altitude(flight)), el("span", "", speed(flight)));
      row.append(value);
      return row;
    }));
  }
  function renderTable() {
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
    const sorted = [...aircraft].filter((flight) => `${flight.callsign} ${flight.icao} ${flight.country}`.toLowerCase().includes(query));
    sorted.sort((a, b) => {
      const values = {
        callsign: [a.callsign, b.callsign], registration: ["—", "—"], type: ["—", "—"], airline: ["—", "—"],
        altitude: [a.baroAltitude ?? -1, b.baroAltitude ?? -1], speed: [a.velocity ?? -1, b.velocity ?? -1], heading: [a.heading ?? -1, b.heading ?? -1]
      }[sortKey] || [a.callsign, b.callsign];
      const comparison = typeof values[0] === "number" ? values[0] - values[1] : String(values[0]).localeCompare(String(values[1]));
      return comparison * (sortAscending ? 1 : -1);
    });
    if (!sorted.length) {
      $("aircraft-table-body").replaceChildren(emptyTable(query ? "No aircraft match your search." : "No aircraft in the current map view."));
      return;
    }
    $("aircraft-table-body").replaceChildren(...sorted.map((flight) => {
      const row = el("tr");
      row.addEventListener("click", () => openAircraft(flight.icao));
      const call = el("td"); call.append(el("span", "table-callsign", flight.callsign), el("span", "table-sub", flight.icao));
      const reg = el("td", "", "—");
      const type = el("td", "", "—");
      const airline = el("td", "", "—");
      airline.title = "Operator is not provided by the OpenSky position feed.";
      const alt = el("td", "", altitude(flight));
      const gs = el("td", "table-speed", speed(flight));
      const hdg = el("td", "table-speed", heading(flight));
      const route = el("td", "", "—");
      route.title = "Origin and destination are not provided by the OpenSky position feed.";
      const values = {
        callsign: call, registration: reg, type,
        airlineLogo: el("td", "airline-logo-cell", "—"), airline,
        altitude: alt, speed: gs, heading: hdg, origin: route, destination: el("td", "", "—")
      };
      values.airlineLogo.title = "An airline logo is unavailable without an operator identifier.";
      row.append(...orderedVisibleColumns.map((key) => values[key]));
      return row;
    }));
  }

  function openAircraft(icao) {
    const flight = aircraft.find((item) => item.icao === icao);
    if (!flight) return;
    selectedIcao = icao;
    renderAircraft();
    $("detail-kicker").textContent = settings.detailed ? "AIRCRAFT · DETAILED" : "AIRCRAFT · MINIMAL";
    $("detail-title").textContent = flight.callsign;
    const content = $("detail-content");
    content.replaceChildren();
    const summary = el("div", "detail-summary");
    summary.append(el("strong", "", flight.icao), el("p", "", `${flight.country || "Unknown origin"} · ${flight.onGround ? "On ground" : "Airborne"}`));
    content.append(summary);
    const minimalFields = [
      ["Callsign", flight.callsign], ["Aircraft type", "Not provided by position feed"],
      ["Altitude", altitude(flight)], ["Speed", speed(flight)]
    ];
    const extraFields = [
      ["Callsign", flight.callsign], ["Registration", "Loading aircraft registry…"], ["ICAO24", flight.icao],
      ["Aircraft type", "Loading aircraft registry…"], ["Aircraft model", "Loading aircraft registry…"],
      ["Airline", "Not provided by position feed"], ["Operator", "Loading aircraft registry…"], ["Origin", "Not provided by position feed"],
      ["Destination", "Not provided by position feed"], ["Barometric altitude", altitude(flight)],
      ["Geometric altitude", flight.onGround ? "On ground" : "Not provided"],
      ["Airspeed", "Not provided by position feed"], ["Ground speed", speed(flight)],
      ["Vertical speed", Number.isFinite(flight.verticalRate) ? `${Math.round(flight.verticalRate * 196.85)} ft/min` : "—"],
      ["Heading", heading(flight)], ["Squawk", flight.squawk || "—"],
      ["Aircraft category", flight.category ?? "Not provided by position feed"],
      ["Flight status", flight.onGround ? "On ground" : "Airborne"], ["Origin country", flight.country],
      ["Latitude", `${flight.lat.toFixed(5)}°`], ["Longitude", `${flight.lon.toFixed(5)}°`],
      ["Position updated", flight.timePosition ? new Date(flight.timePosition * 1000).toLocaleTimeString() : "—"]
    ];
    const section = el("div", "detail-section");
    section.append(el("h3", "", settings.detailed ? "FLIGHT INFORMATION" : "FLIGHT SNAPSHOT"));
    const grid = el("div", "detail-grid");
    for (const [label, value] of settings.detailed ? extraFields : minimalFields) {
      const field = el("div", "detail-field");
      field.append(el("span", "", label), el("strong", value === "—" ? "empty" : "", value));
      grid.append(field);
    }
    section.append(grid);
    content.append(section);
    if (settings.detailed) enrichAircraftDetails(flight, grid);
    $("detail-panel").classList.add("open");
    $("detail-panel").setAttribute("aria-hidden", "false");
    $("panel-scrim").classList.remove("hidden");
  }

  function setDetailField(grid, label, value) {
    const field = [...grid.querySelectorAll(".detail-field")].find((item) => item.querySelector("span")?.textContent === label);
    if (field && value !== undefined && value !== null && value !== "") field.querySelector("strong").textContent = String(value);
  }
  async function enrichAircraftDetails(flight, grid) {
    try {
      let data = aircraftDetailsCache.get(flight.icao);
      if (!data) {
        const response = await fetch(`https://api.adsb.lol/v2/hex/${encodeURIComponent(flight.icao)}`);
        if (!response.ok) throw new Error(`ADS-B registry returned HTTP ${response.status}`);
        const result = await response.json();
        data = result.ac?.[0] || null;
        if (!data) {
          const fallback = await fetch(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(flight.icao)}`);
          if (!fallback.ok) throw new Error(`Aircraft registry returned HTTP ${fallback.status}`);
          const registry = await fallback.json();
          data = {
            r: registry.Registration, t: registry.Type, desc: registry.Model,
            ownOp: registry.RegisteredOwners
          };
        }
        aircraftDetailsCache.set(flight.icao, data);
      }
      const fields = {
        Registration: data.r, "Aircraft type": data.t, "Aircraft model": data.desc,
        Airline: data.ownOp, Operator: data.ownOp, Origin: data.from, Destination: data.to,
        "Barometric altitude": data.alt_baro === "ground" ? "On ground" : Number.isFinite(data.alt_baro) ? `${Math.round(data.alt_baro)} ft` : undefined,
        "Geometric altitude": Number.isFinite(data.alt_geom) ? `${Math.round(data.alt_geom)} ft` : undefined,
        "Airspeed": Number.isFinite(data.ias) ? `${Math.round(data.ias)} kt indicated` : Number.isFinite(data.tas) ? `${Math.round(data.tas)} kt true` : undefined,
        "Ground speed": Number.isFinite(data.gs) ? `${Math.round(data.gs)} kt` : undefined,
        "Vertical speed": Number.isFinite(data.baro_rate) ? `${Math.round(data.baro_rate)} ft/min` : undefined,
        Heading: Number.isFinite(data.track) ? `${Math.round(data.track)}°` : undefined,
        Squawk: data.squawk, "Aircraft category": data.category,
        "Flight status": data.alt_baro === "ground" ? "On ground" : data.emergency && data.emergency !== "none" ? `Emergency · ${data.emergency}` : "Airborne",
        Latitude: Number.isFinite(data.lat) ? `${data.lat.toFixed(5)}°` : undefined,
        Longitude: Number.isFinite(data.lon) ? `${data.lon.toFixed(5)}°` : undefined
      };
      for (const [label, value] of Object.entries(fields)) setDetailField(grid, label, value);
      for (const label of ["Registration", "Aircraft type", "Aircraft model", "Operator"]) {
        const field = [...grid.querySelectorAll(".detail-field")].find((item) => item.querySelector("span")?.textContent === label);
        const value = field?.querySelector("strong");
        if (value?.textContent === "Loading aircraft registry…") value.textContent = "Not provided by ADS-B feed";
      }

      const additional = Object.entries(data).filter(([key, value]) =>
        !["hex", "type", "flight", "r", "t", "desc", "ownOp", "alt_baro", "alt_geom", "ias", "tas", "gs", "baro_rate", "track", "squawk", "category", "emergency", "lat", "lon"].includes(key) &&
        (typeof value === "number" || typeof value === "boolean" || typeof value === "string")
      );
      if (additional.length) {
        const section = el("div", "detail-section");
        section.append(el("h3", "", "ADDITIONAL ADS-B DATA"));
        const additionalGrid = el("div", "detail-grid");
        for (const [key, value] of additional) {
          const field = el("div", "detail-field");
          field.append(el("span", "", key.replaceAll("_", " ")), el("strong", "", String(value)));
          additionalGrid.append(field);
        }
        section.append(additionalGrid);
        grid.closest(".detail-section").after(section);
      }
    } catch (error) {
      console.error(`Aircraft metadata lookup failed for ${flight.icao}.`, error);
      for (const label of ["Registration", "Aircraft type", "Aircraft model", "Operator"]) {
        setDetailField(grid, label, "Unavailable from public registries");
      }
    }
  }

  function updateAirports() {
    clearTimeout(airportUpdateTimer);
    if (!map || !settings.airports) {
      airportMarkers.splice(0).forEach((marker) => marker.remove());
      return;
    }
    const delay = Math.max(0, 1100 - (Date.now() - lastAirportRequestAt));
    airportUpdateTimer = setTimeout(loadAirports, delay);
  }
  async function loadAirports() {
    if (!map || !settings.airports) return;
    const bounds = map.getBounds();
    if (bounds.getNorth() - bounds.getSouth() > 5 || bounds.getEast() - bounds.getWest() > 8) return;
    try {
      if (airportRequestController) airportRequestController.abort();
      airportRequestController = new AbortController();
      lastAirportRequestAt = Date.now();
      const viewBox = `${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}`;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=35&amenity=aerodrome&viewbox=${encodeURIComponent(viewBox)}`;
      const response = await fetch(url, { signal: airportRequestController.signal });
      if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}`);
      const places = await response.json();
      airportMarkers.splice(0).forEach((marker) => marker.remove());
      for (const place of places) {
        if (!bounds.contains([Number(place.lon), Number(place.lat)])) continue;
        const name = place.name || place.display_name.split(",")[0];
        const element = el("button", "airport-marker");
        element.type = "button";
        element.title = name;
        element.setAttribute("aria-label", `Airport ${name}`);
        element.innerHTML = '<span class="airport-dot"></span>';
        const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat([Number(place.lon), Number(place.lat)]).addTo(map);
        airportMarkers.push(marker);
        element.addEventListener("click", () => openAirport(place, name));
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Unable to refresh airport labels from OpenStreetMap.", error);
    }
  }
  function openAirport(place, name) {
    const address = place.address || {};
    const icao = address.icao || place.extratags?.icao || "";
    const iata = address.iata || place.extratags?.iata || "";
    const elevation = place.extratags?.ele ? `${place.extratags.ele} m` : "Not listed";
    $("detail-kicker").textContent = "AIRPORT INFORMATION";
    $("detail-title").textContent = name;
    const content = $("detail-content");
    content.replaceChildren();
    const section = el("div", "detail-section");
    section.append(el("h3", "", "AIRPORT DATA"));
    const grid = el("div", "detail-grid");
    for (const [label, value] of [["Airport", name], ["ICAO", icao || "Looking up…"], ["IATA", iata || "Looking up…"], ["Elevation", elevation], ["Latitude", `${Number(place.lat).toFixed(5)}°`], ["Longitude", `${Number(place.lon).toFixed(5)}°`]]) {
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
    else notice.querySelector(".airport-condition").textContent = "This OpenStreetMap record has no ICAO code for METAR lookup.";
    const traffic = el("div", "detail-section");
    traffic.append(el("h3", "", "AIRPORT TRAFFIC"));
    const grounded = aircraft.filter((flight) => flight.onGround && Math.hypot(flight.lat - Number(place.lat), (flight.lon - Number(place.lon)) * Math.cos(Number(place.lat) * Math.PI / 180)) < .07).length;
    traffic.append(el("div", "airport-condition", `Ground aircraft visible in this feed: ${grounded}. Arrivals and departures are not supplied by the live position source.`));
    content.append(traffic);
    const charts = el("div", "detail-section");
    charts.append(el("h3", "", "CHARTS & ATC"));
    charts.append(el("div", "airport-condition", "Procedure charts and ATC audio require licensed provider coverage and are not available in this build."));
    content.append(charts);
    $("detail-panel").classList.add("open");
    $("detail-panel").setAttribute("aria-hidden", "false");
    $("panel-scrim").classList.remove("hidden");
  }
  async function loadAirportMetar(icao, target) {
    try {
      const response = await fetch(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`);
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
      const params = new URLSearchParams({ q: trimmed, format: "jsonv2", addressdetails: "1", limit: "5", extratags: "1" });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
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
  function updateClock() {
    const now = new Date();
    const time = formatClock(now);
    $("header-clock").textContent = `${time}:${String(now.getSeconds()).padStart(2, "0")}`;
    $("mini-clock").textContent = time;
    $("clock-date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    $("standby-clock").textContent = time;
    $("standby-date").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    $("standby-clock").className = `standby-time ${settings.clockStyle}`;
    $("weather-toggle").classList.toggle("active", settings.weather);
    $("sunrise").parentElement.parentElement.classList.toggle("hidden", !settings.sun);
    document.querySelector(".weather-main").classList.toggle("hidden", !settings.weather);
    document.querySelector(".weather-stats").classList.toggle("hidden", !settings.weather);
    $("standby-weather").classList.toggle("hidden", !settings.weather || !weatherData);
  }
  function applyTheme() {
    document.body.classList.toggle("light-theme", settings.theme === "light");
    $("setting-theme").value = settings.theme;
    document.documentElement.style.setProperty("--accent", settings.accent);
    if (map) map.setStyle(settings.theme === "dark" ? "https://tiles.openfreemap.org/styles/dark" : "https://tiles.openfreemap.org/styles/bright");
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
    for (const key of ["weather", "sun", "airways", "labels", "airports", "detailed", "standby"]) {
      $(`setting-${key}`).checked = settings[key];
    }
    $("setting-clock-format").value = settings.clockFormat;
    $("setting-clock-style").value = settings.clockStyle;
    $("setting-airways").checked = settings.airways;
    $("airway-button").setAttribute("aria-pressed", String(settings.airways));
    $("labels-button").setAttribute("aria-pressed", String(settings.labels));
    $("airports-button").setAttribute("aria-pressed", String(settings.airports));
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
    const labels = { "map-page": ["THE WORLD ABOVE YOU", "Live map"], "traffic-page": ["LIVE · YOUR AIRSPACE", "Traffic board"], "flight-page": ["A SEPARATE FLIGHT EXPERIENCE", "AeroAM Flight"] };
    $("page-eyebrow").textContent = labels[pageId][0];
    $("page-title").textContent = labels[pageId][1];
    $("workspace-menu").classList.add("hidden");
    $("workspace-button").setAttribute("aria-expanded", "false");
    setStandby(false);
    if (pageId === "map-page" && map) setTimeout(() => map.resize(), 50);
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
  $("airway-button").addEventListener("click", () => {
    settings.airways = !settings.airways;
    $("setting-airways").checked = settings.airways;
    $("airway-button").setAttribute("aria-pressed", String(settings.airways));
    saveSettings();
    showMessage(settings.airways ? "Airway overlay data is not connected yet." : "Airway overlay hidden.");
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
  $("clock-settings").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-scrim").addEventListener("click", closeSettings);
  const settingsMap = { "setting-weather": "weather", "setting-sun": "sun", "setting-airways": "airways", "setting-labels": "labels", "setting-airports": "airports", "setting-detailed": "detailed" };
  for (const [id, key] of Object.entries(settingsMap)) {
    $(id).addEventListener("change", (event) => {
      settings[key] = event.target.checked;
      saveSettings(); syncSettingsControls();
      if (key === "labels") renderAircraft();
      if (key === "airports") updateAirports();
      if (key === "detailed" && selectedIcao) openAircraft(selectedIcao);
    });
  }
  $("setting-standby").addEventListener("change", (event) => setStandby(event.target.checked));
  $("setting-theme").addEventListener("change", (event) => { settings.theme = event.target.value; applyTheme(); saveSettings(); });
  installAccentControls();
  installColumnControls();
  $("setting-accent").value = settings.accent;
  document.querySelectorAll("[data-accent]").forEach((button) => button.addEventListener("click", () => {
    settings.accent = button.dataset.accent;
    $("setting-accent").value = settings.accent;
    applyTheme(); saveSettings();
  }));
  $("setting-accent").addEventListener("input", (event) => {
    settings.accent = event.target.value;
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
  document.querySelectorAll(".aircraft-option").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".aircraft-option").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
  }));

  syncSettingsControls();
  renderColumnMenu();
  renderTable();
  initializeMap();
  updateWeather();
  updateClock();
  setInterval(updateClock, 1000);
})();
