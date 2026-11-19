(() => {
  const defaultLocation = { name: "Cork, Ireland", lat: 51.8985, lon: -8.4756 };
  const storageKey = "aeroam-settings-v1";
  const historyKey = "aeroam-track-history-v1";
  const defaults = { theme: "amoled", accent: "#8da8ff", autoAccent: true, clockFormat: "24", clockStyle: "modern", weather: true, sun: true, labels: true, airports: true, radio: true, nowPlaying: true, detailed: true, standby: true, routeTrail: false, trackAircraft: false, visualizer: false, visualizerStyle: "bars", visualizerColour: "#8da8ff", quizPlayerCount: 1, quizSameQuestion: true, quizTimer: false, quizTimeLimit: 20, quizDifficulty: "medium", quizNames: [], focusWork: 25, focusBreak: 5, focusSessions: 4, focusMode: "work", focusRemaining: 1500, focusCompleted: 0, location: defaultLocation };
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
  let currentMapTheme = "";
  const airportMarkers = [];
  let aircraft = [];
  let selectedIcao = "";
  let requestController;
  let trafficMetadataBusy = false;
  let refreshTimer;
  let refreshDebounceTimer;
  let retryTimer;
  let nextAircraftRefreshAt = 0;
  let airportUpdateTimer;
  let lastAirportRequestAt = 0;
  let airportRequestController;
  let airportsInView = [];
  let radioStations = [];
  const quizPlayers = [];
  let quizRoundAirports = [];
  let quizPlayerIndex = 0;
  let quizTimer;
  let quizSeconds = 20;
  let currentQuizMode = "icao";
  let quizPendingScores = [];
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
  let focusInterval;
  let lastFocusSave = 0;
  let focusDeadline = 0;
  let focusRunning = false;
  let focusRemaining = Number(settings.focusRemaining) || Number(settings.focusWork) * 60;
  let focusMode = settings.focusMode || "work";
  let flightLogEditId = "";
  let logPeriod = "lifetime";
  let arStream;
  let arHeading = 0;
  let arOrientationListening = false;
  let replayMarker;
  let aircraftTrail = loadTrackHistory();
  let lastTrailSave = 0;
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
    { name:"Dublin Airport",country:"Ireland",icao:"EIDW",iata:"DUB",airline:"Aer Lingus",lat:53.4264,lon:-6.2499,difficulty:"major" },
    { name:"London Heathrow Airport",country:"United Kingdom",icao:"EGLL",iata:"LHR",airline:"British Airways",lat:51.47,lon:-.4543,difficulty:"major" },
    { name:"Amsterdam Airport Schiphol",country:"Netherlands",icao:"EHAM",iata:"AMS",airline:"KLM",lat:52.3086,lon:4.7639,difficulty:"major" },
    { name:"Charles de Gaulle Airport",country:"France",icao:"LFPG",iata:"CDG",airline:"Air France",lat:49.0097,lon:2.5479,difficulty:"major" },
    { name:"Frankfurt Airport",country:"Germany",icao:"EDDF",iata:"FRA",airline:"Lufthansa",lat:50.0379,lon:8.5622,difficulty:"major" },
    { name:"John F. Kennedy International",country:"United States",icao:"KJFK",iata:"JFK",airline:"American Airlines",lat:40.6413,lon:-73.7781,difficulty:"major" },
    { name:"Dubai International",country:"United Arab Emirates",icao:"OMDB",iata:"DXB",airline:"Emirates",lat:25.2532,lon:55.3657,difficulty:"major" },
    { name:"Tokyo Haneda",country:"Japan",icao:"RJTT",iata:"HND",airline:"All Nippon Airways",lat:35.5494,lon:139.7798,difficulty:"major" },
    { name:"Los Angeles International",country:"United States",icao:"KLAX",iata:"LAX",airline:"American Airlines",lat:33.9416,lon:-118.4085,difficulty:"major" },
    { name:"Singapore Changi",country:"Singapore",icao:"WSSS",iata:"SIN",airline:"Singapore Airlines",lat:1.3644,lon:103.9915,difficulty:"major" },
    { name:"Istanbul Airport",country:"Türkiye",icao:"LTFM",iata:"IST",airline:"Turkish Airlines",lat:41.2753,lon:28.7519,difficulty:"major" },
    { name:"Sydney Kingsford Smith",country:"Australia",icao:"YSSY",iata:"SYD",airline:"Qantas",lat:-33.9399,lon:151.1753,difficulty:"major" },
    { name:"Cork Airport",country:"Ireland",icao:"EICK",iata:"ORK",airline:"Aer Lingus",lat:51.8413,lon:-8.4911,difficulty:"common" },
    { name:"Manchester Airport",country:"United Kingdom",icao:"EGCC",iata:"MAN",airline:"easyJet",lat:53.3537,lon:-2.275,difficulty:"common" },
    { name:"Barcelona–El Prat Airport",country:"Spain",icao:"LEBL",iata:"BCN",airline:"Vueling",lat:41.2974,lon:2.0833,difficulty:"common" },
    { name:"Toronto Pearson",country:"Canada",icao:"CYYZ",iata:"YYZ",airline:"Air Canada",lat:43.6777,lon:-79.6248,difficulty:"common" },
    { name:"San Francisco International",country:"United States",icao:"KSFO",iata:"SFO",airline:"United Airlines",lat:37.6213,lon:-122.379,difficulty:"common" },
    { name:"Doha Hamad International",country:"Qatar",icao:"OTHH",iata:"DOH",airline:"Qatar Airways",lat:25.2731,lon:51.6081,difficulty:"common" },
    { name:"Auckland Airport",country:"New Zealand",icao:"NZAA",iata:"AKL",airline:"Air New Zealand",lat:-37.0082,lon:174.785,difficulty:"common" },
    { name:"São Paulo–Guarulhos",country:"Brazil",icao:"SBGR",iata:"GRU",airline:"LATAM Brasil",lat:-23.4356,lon:-46.4731,difficulty:"common" },
    { name:"Keflavík International",country:"Iceland",icao:"BIKF",iata:"KEF",airline:"Icelandair",lat:63.985,lon:-22.6056,difficulty:"common" },
    { name:"Belfast City Airport",country:"United Kingdom",icao:"EGAC",iata:"BHD",airline:"Aer Lingus",lat:54.6181,lon:-5.8725,difficulty:"common" },
    { name:"Marrakesh Menara Airport",country:"Morocco",icao:"GMMX",iata:"RAK",airline:"Royal Air Maroc",lat:31.6069,lon:-8.0363,difficulty:"obscure" },
    { name:"Inverness Airport",country:"United Kingdom",icao:"EGPE",iata:"INV",airline:"Loganair",lat:57.5425,lon:-4.0475,difficulty:"obscure" },
    { name:"Narsarsuaq Airport",country:"Greenland",icao:"BGBW",iata:"UAK",airline:"Air Greenland",lat:61.1605,lon:-45.4259,difficulty:"obscure" },
    { name:"Svalbard Airport",country:"Norway",icao:"ENSB",iata:"LYR",airline:"Scandinavian Airlines",lat:78.2461,lon:15.4656,difficulty:"obscure" },
    { name:"Rarotonga International",country:"Cook Islands",icao:"NCRG",iata:"RAR",airline:"Air Rarotonga",lat:-21.2027,lon:-159.806,difficulty:"obscure" },
    { name:"Juancho E. Yrausquin Airport",country:"Caribbean Netherlands",icao:"TNCS",iata:"SAB",airline:"Winair",lat:17.645,lon:-63.2205,difficulty:"obscure" },
    { name:"Donegal Airport",country:"Ireland",icao:"EIDL",iata:"CFN",airline:"Aer Lingus Regional",lat:55.0442,lon:-8.341,difficulty:"obscure" },
    { name:"Paro International Airport",country:"Bhutan",icao:"VQPR",iata:"PBH",airline:"Drukair",lat:27.4032,lon:89.4246,difficulty:"obscure" },
    { name:"Tenzing-Hillary Airport",country:"Nepal",icao:"VNLK",iata:"LUA",airline:"Tara Air",lat:27.6878,lon:86.7314,difficulty:"obscure" },
    { name:"Barra Airport",country:"United Kingdom",icao:"EGPR",iata:"BRR",airline:"Loganair",lat:57.0228,lon:-7.4431,difficulty:"obscure" }
  ];
  let airportQuestionPool = quizAirports;
  const aircraftLibrary = [
    { type:"A320",model:"A320-200",manufacturer:"Airbus",engines:"2 × CFM56-5B / IAE V2500",power:"~24,000–33,000 lbf thrust each",range:"6,150 km",cruise:"Mach 0.78",mtow:"78,000 kg",empty:"42,600 kg",seats:"140–180",dimensions:"37.57 m length · 35.8 m span",first:"1987",operators:"easyJet, Lufthansa, Wizz Air, JetBlue" },
    { type:"A20N",model:"A320neo",manufacturer:"Airbus",engines:"2 × LEAP-1A / PW1100G-JM",power:"~24,000–35,000 lbf thrust each",range:"6,300 km",cruise:"Mach 0.78",mtow:"79,000 kg",empty:"44,300 kg",seats:"150–194",dimensions:"37.57 m length · 35.8 m span",first:"2014",operators:"Lufthansa, IndiGo, easyJet" },
    { type:"A321",model:"A321-200",manufacturer:"Airbus",engines:"2 × CFM56-5B / IAE V2500",power:"~30,000–33,000 lbf thrust each",range:"5,950 km",cruise:"Mach 0.78",mtow:"93,500 kg",empty:"48,500 kg",seats:"185–220",dimensions:"44.51 m length · 35.8 m span",first:"1993",operators:"Wizz Air, American Airlines, Lufthansa" },
    { type:"A21N",model:"A321neo / LR",manufacturer:"Airbus",engines:"2 × LEAP-1A / PW1100G-JM",power:"~32,000–35,000 lbf thrust each",range:"7,400 km (LR)",cruise:"Mach 0.78",mtow:"97,000 kg",empty:"50,100 kg",seats:"180–244",dimensions:"44.51 m length · 35.8 m span",first:"2016",operators:"Wizz Air, Aer Lingus, JetBlue" },
    { type:"A332",model:"A330-200",manufacturer:"Airbus",engines:"2 × Rolls-Royce Trent 700 / GE CF6",power:"~68,000–72,000 lbf thrust each",range:"13,450 km",cruise:"Mach 0.82",mtow:"242,000 kg",empty:"120,600 kg",seats:"220–260",dimensions:"58.82 m length · 60.3 m span",first:"1997",operators:"Delta Air Lines, Turkish Airlines" },
    { type:"A333",model:"A330-300",manufacturer:"Airbus",engines:"2 × Rolls-Royce Trent 700 / GE CF6",power:"~68,000–72,000 lbf thrust each",range:"11,750 km",cruise:"Mach 0.82",mtow:"242,000 kg",empty:"124,500 kg",seats:"250–300",dimensions:"63.66 m length · 60.3 m span",first:"1992",operators:"Cathay Pacific, Delta Air Lines" },
    { type:"A359",model:"A350-900",manufacturer:"Airbus",engines:"2 × Rolls-Royce Trent XWB-84",power:"84,000 lbf thrust each",range:"15,000 km",cruise:"Mach 0.85",mtow:"280,000 kg",empty:"142,400 kg",seats:"300–350",dimensions:"66.8 m length · 64.75 m span",first:"2013",operators:"Singapore Airlines, Qatar Airways, Finnair" },
    { type:"A388",model:"A380-800",manufacturer:"Airbus",engines:"4 × Trent 900 / GP7200",power:"70,000–81,000 lbf thrust each",range:"14,800 km",cruise:"Mach 0.85",mtow:"575,000 kg",empty:"276,800 kg",seats:"485–615",dimensions:"72.7 m length · 79.75 m span",first:"2005",operators:"Emirates, Singapore Airlines, Qantas" },
    { type:"B737",model:"737-800",manufacturer:"Boeing",engines:"2 × CFM56-7B",power:"24,200–27,300 lbf thrust each",range:"5,765 km",cruise:"Mach 0.785",mtow:"79,000 kg",empty:"41,145 kg",seats:"162–189",dimensions:"39.5 m length · 35.8 m span",first:"1997",operators:"Ryanair, United Airlines, Alaska Airlines" },
    { type:"B38M",model:"737 MAX 8",manufacturer:"Boeing",engines:"2 × CFM LEAP-1B",power:"~28,000 lbf thrust each",range:"6,570 km",cruise:"Mach 0.79",mtow:"82,190 kg",empty:"45,070 kg",seats:"162–178",dimensions:"39.52 m length · 35.92 m span",first:"2016",operators:"Ryanair, Southwest, American Airlines" },
    { type:"B738",model:"737-800",manufacturer:"Boeing",engines:"2 × CFM56-7B",power:"24,200–27,300 lbf thrust each",range:"5,765 km",cruise:"Mach 0.785",mtow:"79,000 kg",empty:"41,145 kg",seats:"162–189",dimensions:"39.5 m length · 35.8 m span",first:"1997",operators:"Ryanair, United Airlines, Alaska Airlines" },
    { type:"B739",model:"737-900ER",manufacturer:"Boeing",engines:"2 × CFM56-7B",power:"26,300–27,300 lbf thrust each",range:"5,900 km",cruise:"Mach 0.79",mtow:"85,130 kg",empty:"44,700 kg",seats:"180–220",dimensions:"42.1 m length · 35.8 m span",first:"2006",operators:"United Airlines, Alaska Airlines, KLM" },
    { type:"B752",model:"757-200",manufacturer:"Boeing",engines:"2 × Rolls-Royce RB211 / PW2000",power:"37,000–43,500 lbf thrust each",range:"7,250 km",cruise:"Mach 0.80",mtow:"115,680 kg",empty:"57,840 kg",seats:"200–239",dimensions:"47.32 m length · 38.05 m span",first:"1982",operators:"Delta Air Lines, United Airlines, Icelandair" },
    { type:"B763",model:"767-300ER",manufacturer:"Boeing",engines:"2 × GE CF6 / PW4000 / RB211",power:"~60,000 lbf thrust each",range:"11,070 km",cruise:"Mach 0.80",mtow:"186,880 kg",empty:"90,010 kg",seats:"218–269",dimensions:"54.94 m length · 47.57 m span",first:"1986",operators:"Delta Air Lines, United Airlines, UPS" },
    { type:"B772",model:"777-200ER",manufacturer:"Boeing",engines:"2 × GE90 / PW4000 / Trent 800",power:"~84,000–93,700 lbf thrust each",range:"13,080 km",cruise:"Mach 0.84",mtow:"297,550 kg",empty:"138,100 kg",seats:"313–396",dimensions:"63.73 m length · 60.93 m span",first:"1995",operators:"United Airlines, British Airways, Emirates" },
    { type:"B77W",model:"777-300ER",manufacturer:"Boeing",engines:"2 × GE90-115B",power:"115,300 lbf thrust each",range:"13,650 km",cruise:"Mach 0.84",mtow:"351,530 kg",empty:"167,800 kg",seats:"365–550",dimensions:"73.9 m length · 64.8 m span",first:"2003",operators:"Emirates, Qatar Airways, Cathay Pacific" },
    { type:"B788",model:"787-8 Dreamliner",manufacturer:"Boeing",engines:"2 × GEnx-1B / Trent 1000",power:"~64,000–76,000 lbf thrust each",range:"13,620 km",cruise:"Mach 0.85",mtow:"227,930 kg",empty:"119,950 kg",seats:"242–296",dimensions:"56.72 m length · 60.12 m span",first:"2009",operators:"American Airlines, ANA, Qatar Airways" },
    { type:"B789",model:"787-9 Dreamliner",manufacturer:"Boeing",engines:"2 × GEnx-1B / Trent 1000",power:"~64,000–76,000 lbf thrust each",range:"14,010 km",cruise:"Mach 0.85",mtow:"254,000 kg",empty:"128,850 kg",seats:"290–330",dimensions:"62.81 m length · 60.12 m span",first:"2013",operators:"United Airlines, Air New Zealand, Etihad" },
    { type:"B744",model:"747-400",manufacturer:"Boeing",engines:"4 × GE CF6 / PW4000 / RB211",power:"~56,000–63,000 lbf thrust each",range:"13,450 km",cruise:"Mach 0.85",mtow:"396,890 kg",empty:"178,800 kg",seats:"416–524",dimensions:"70.66 m length · 64.44 m span",first:"1988",operators:"Lufthansa, Atlas Air, Cargolux" },
    { type:"B748",model:"747-8",manufacturer:"Boeing",engines:"4 × GEnx-2B67",power:"66,500 lbf thrust each",range:"14,320 km",cruise:"Mach 0.86",mtow:"447,700 kg",empty:"220,128 kg",seats:"410–467",dimensions:"76.3 m length · 68.4 m span",first:"2010",operators:"Lufthansa, Korean Air, UPS" },
    { type:"E190",model:"E190",manufacturer:"Embraer",engines:"2 × GE CF34-10E",power:"18,500 lbf thrust each",range:"4,537 km",cruise:"Mach 0.82",mtow:"51,800 kg",empty:"27,800 kg",seats:"96–114",dimensions:"36.24 m length · 28.72 m span",first:"2004",operators:"KLM Cityhopper, Helvetic Airways" },
    { type:"E195",model:"E195-E2",manufacturer:"Embraer",engines:"2 × Pratt & Whitney PW1900G",power:"~23,000 lbf thrust each",range:"4,815 km",cruise:"Mach 0.82",mtow:"62,500 kg",empty:"35,000 kg",seats:"120–146",dimensions:"41.5 m length · 35.1 m span",first:"2017",operators:"Azul, Porter Airlines, KLM" },
    { type:"AT76",model:"ATR 72-600",manufacturer:"ATR",engines:"2 × Pratt & Whitney PW127M turboprop",power:"2,750 shp each",range:"1,528 km",cruise:"275 kt",mtow:"23,000 kg",empty:"13,600 kg",seats:"68–78",dimensions:"27.17 m length · 27.05 m span",first:"2007",operators:"Aer Lingus Regional, Loganair, Azul" },
    { type:"DH8D",model:"Dash 8 Q400",manufacturer:"De Havilland Canada",engines:"2 × Pratt & Whitney PW150A turboprop",power:"5,071 shp each",range:"2,040 km",cruise:"360 kt",mtow:"29,574 kg",empty:"17,185 kg",seats:"70–90",dimensions:"32.8 m length · 28.4 m span",first:"1998",operators:"Porter Airlines, QantasLink, Widerøe" },
    { type:"CRJ9",model:"CRJ900",manufacturer:"Bombardier",engines:"2 × GE CF34-8C5",power:"14,510 lbf thrust each",range:"2,876 km",cruise:"Mach 0.83",mtow:"38,330 kg",empty:"21,845 kg",seats:"76–90",dimensions:"36.2 m length · 24.9 m span",first:"2001",operators:"Lufthansa CityLine, Delta Connection" },
    { type:"C172",model:"172 Skyhawk",manufacturer:"Cessna",engines:"1 × Lycoming IO-360-L2A piston",power:"180 hp",range:"1,185 km",cruise:"122 kt",mtow:"1,111 kg",empty:"767 kg",seats:"4",dimensions:"8.28 m length · 11.0 m span",first:"1955",operators:"Flight schools, private owners" }
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
  function loadTrackHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(historyKey) || "{}");
      return saved && typeof saved === "object" ? saved : {};
    } catch (error) {
      console.error("Could not read local aircraft track history.", error);
      return {};
    }
  }
  function saveTrackHistory() {
    const cutoff = Date.now() - 12 * 60 * 60 * 1000;
    for (const [icao, points] of Object.entries(aircraftTrail)) {
      aircraftTrail[icao] = points.filter((point) => point.time >= cutoff).slice(-120);
      if (!aircraftTrail[icao].length) delete aircraftTrail[icao];
    }
    const newestTracks = Object.entries(aircraftTrail).sort((a, b) => b[1].at(-1).time - a[1].at(-1).time).slice(0, 80);
    const retained = new Set(newestTracks.map(([icao]) => icao));
    for (const icao of Object.keys(aircraftTrail)) if (!retained.has(icao)) delete aircraftTrail[icao];
    try {
      localStorage.setItem(historyKey, JSON.stringify(aircraftTrail));
    } catch (error) {
      console.error("Could not save local aircraft track history.", error);
    }
  }
  function rememberAircraftPositions() {
    const now = Date.now();
    for (const flight of aircraft) {
      const points = aircraftTrail[flight.icao] || (aircraftTrail[flight.icao] = []);
      const last = points[points.length - 1];
      if (!last || now - last.time > 20_000 || distanceBetween(last, flight) > 0.08) {
        points.push({ lat: flight.lat, lon: flight.lon, time: now, heading: flight.heading, altitude: flight.baroAltitude });
      }
    }
    if (now - lastTrailSave > 10_000) {
      lastTrailSave = now;
      saveTrackHistory();
      updateReplayChoices();
      if (settings.routeTrail) updateAircraftTrail();
    }
  }
  function distanceBetween(a, b) {
    const radians = (value) => value * Math.PI / 180;
    const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
    const arc = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
  }
  function readLocalList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.error(`Could not read ${key} from local storage.`, error);
      return [];
    }
  }
  function writeLocalList(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Could not save ${key} to local storage.`, error);
      showMessage("The browser could not save this item. Check available storage.");
    }
  }
  const flightLogs = readLocalList("aeroam-flight-log-v1");
  const recentlyTracked = readLocalList("aeroam-recent-aircraft-v1");
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
    currentMapTheme = settings.theme;
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
    map.on("load", () => { refreshAircraft(); updateAirports(); installAircraftTrailLayer(); });
    map.on("style.load", () => { installAircraftTrailLayer(); });
    refreshTimer = setInterval(refreshAircraft, 30000);
    geolocate(true);
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
      rememberAircraftPositions();
      renderAircraft();
      if ($("traffic-page").classList.contains("active")) enrichTrafficAircraft();
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
    if (settings.trackAircraft && settings.standby && selectedIcao) {
      const tracked = aircraft.find((flight) => flight.icao === selectedIcao);
      if (tracked && map.getZoom() < 7) map.setZoom(7);
      const center = map.getCenter();
      if (tracked && distanceBetween({ lat: center.lat, lon: center.lng }, tracked) > 0.15) map.easeTo({ center: [tracked.lon, tracked.lat], duration: 600, essential: false });
    }
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
    return distanceBetween(settings.location, flight);
  }
  function installAircraftTrailLayer() {
    if (!map || !map.isStyleLoaded()) return;
    if (!map.getSource("aircraft-trail")) {
      map.addSource("aircraft-trail", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "aircraft-trail-line", type: "line", source: "aircraft-trail", paint: {
        "line-color": getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ffffff",
        "line-width": 2.5, "line-opacity": 0.78, "line-dasharray": [1.5, 1.5]
      } });
    }
    updateAircraftTrail();
  }
  function updateAircraftTrail() {
    if (!map?.getSource("aircraft-trail")) return;
    const points = settings.routeTrail && selectedIcao ? aircraftTrail[selectedIcao] || [] : [];
    const source = map.getSource("aircraft-trail");
    const coordinates = points.map((point) => [point.lon, point.lat]);
    source.setData({ type: "FeatureCollection", features: coordinates.length > 1 ? [{
      type: "Feature", properties: {}, geometry: { type: "LineString", coordinates }
    }] : [] });
    $("trail-button")?.setAttribute("aria-pressed", String(settings.routeTrail));
  }
  function rememberTrackedFlight(flight) {
    const item = flightMetadata(flight);
    const record = {
      icao: flight.icao, callsign: flight.callsign || "", registration: item.r || "",
      type: item.t || flight.aircraftType || "", model: item.desc || "",
      airline: item.ownOp || airlineNames[flight.airlineCode] || "",
      country: flight.country || "", lastSeen: Date.now()
    };
    const next = [record, ...recentlyTracked.filter((entry) => entry.icao !== record.icao)].slice(0, 30);
    recentlyTracked.splice(0, recentlyTracked.length, ...next);
    writeLocalList("aeroam-recent-aircraft-v1", recentlyTracked);
    renderRecentlyTracked();
  }
  function renderRecentlyTracked() {
    const target = $("recent-aircraft-list");
    if (!target) return;
    if (!recentlyTracked.length) {
      target.replaceChildren(el("div", "empty-row", "Aircraft you select on the live map will appear here."));
      return;
    }
    target.replaceChildren(...recentlyTracked.slice(0, 12).map((item) => {
      const card = el("button", "recent-aircraft-item");
      card.type = "button";
      card.append(el("strong", "", item.callsign || item.icao), el("span", "", [item.registration, item.type, item.airline].filter(Boolean).join(" · ") || item.country));
      card.addEventListener("click", () => {
        const flight = aircraft.find((entry) => entry.icao === item.icao);
        if (flight) openAircraft(flight.icao);
        else showMessage(`${item.callsign || item.icao} is no longer in the current live map feed.`);
      });
      return card;
    }));
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
    const ground = aircraft.filter((flight) => flight.onGround);
    const altitudes = airborne.map((flight) => flight.baroAltitude).filter(Number.isFinite);
    const velocities = airborne.map((flight) => flight.velocity).filter(Number.isFinite);
    const countries = new Set(aircraft.map((flight) => flight.country).filter(Boolean));
    const mean = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : NaN;
    highlights.replaceChildren(
      statCard("Fastest live aircraft", fastest ? fastest.callsign : "—", fastest ? speed(fastest) : "No airborne data"),
      statCard("Highest altitude", highest ? highest.callsign : "—", highest ? altitude(highest) : "No airborne data"),
      statCard("Airborne now", airborne.length.toLocaleString(), `${aircraft.length.toLocaleString()} aircraft in map view`),
      statCard("On the ground", ground.length.toLocaleString(), "Live aircraft reporting ground status"),
      statCard("Average altitude", Number.isFinite(mean(altitudes)) ? `${Math.round(mean(altitudes) * 3.28084).toLocaleString()} ft` : "—", "Airborne aircraft with altitude data"),
      statCard("Average ground speed", Number.isFinite(mean(velocities)) ? `${Math.round(mean(velocities) * 1.94384)} kt` : "—", "Airborne aircraft with speed data"),
      statCard("Countries represented", countries.size.toLocaleString(), "Unique origin-country labels in this view")
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
  async function enrichTrafficAircraft() {
    if (trafficMetadataBusy) return;
    trafficMetadataBusy = true;
    try {
      const candidates = getFilteredAircraft().filter((flight) =>
        !aircraftDetailsAttempted.has(flight.icao) && !aircraftDetailsCache.has(flight.icao)
      ).slice(0, 8);
      for (const flight of candidates) {
        if (!document.querySelector("#traffic-page.active")) break;
        await enrichAircraftDetails(flight);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } finally {
      trafficMetadataBusy = false;
    }
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
    rememberTrackedFlight(flight);
    renderAircraft();
    updateAircraftTrail();
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
      ["Distance from your location", `${distanceKm(flight).toFixed(1)} km`],
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
      if (selectedIcao === flight.icao) rememberTrackedFlight(flight);
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
      ["Local time", "Looking up…"],
      ["Location", [place.municipality, place.country].filter(Boolean).join(", ") || "Not listed"],
      ["Latitude", `${Number(place.lat).toFixed(5)}°`], ["Longitude", `${Number(place.lon).toFixed(5)}°`]
    ];
    for (const [label, value] of airportFields) {
      const field = el("div", "detail-field");
      field.append(el("span", "", label), el("strong", "", value));
      if (label === "ICAO" || label === "IATA" || label === "Elevation") field.dataset.airportField = label.toLowerCase();
      if (label === "Local time") field.dataset.airportField = "local-time";
      grid.append(field);
    }
    section.append(grid);
    content.append(section);
    loadAirportLocalTime(place, grid.querySelector('[data-airport-field="local-time"] strong'));
    const notice = el("div", "detail-section");
    notice.append(el("h3", "", "LATEST METAR"));
    notice.append(el("div", "airport-condition", "Looking up airport weather…"));
    content.append(notice);
    if (icao) loadAirportMetar(icao, notice.querySelector(".airport-condition"));
    else notice.querySelector(".airport-condition").textContent = "This airport record has no ICAO code for METAR lookup.";
    const traffic = el("div", "detail-section");
    traffic.append(el("h3", "", "AIRPORT TRAFFIC"));
    const nearby = aircraft.filter((flight) => distanceBetween(place, flight) <= 35);
    const grounded = nearby.filter((flight) => flight.onGround).length;
    const mostCommon = (values) => [...values.filter(Boolean).reduce((counts, value) => counts.set(value, (counts.get(value) || 0) + 1), new Map())]
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const dominantAirline = mostCommon(nearby.map((flight) => airlineNames[flight.airlineCode] || flightMetadata(flight).ownOp));
    const dominantType = mostCommon(nearby.map((flight) => flightMetadata(flight).t || flight.aircraftType));
    const airportTraffic = el("div", "airport-condition");
    airportTraffic.append(document.createTextNode(`Ground aircraft visible in the live feed: ${grounded}. Arrivals and departures are not supplied by this position source.`));
    if (dominantAirline) airportTraffic.append(el("p", "", `Most observed airline nearby: ${dominantAirline}`));
    if (dominantType) airportTraffic.append(el("p", "", `Most observed aircraft type nearby: ${dominantType}`));
    traffic.append(airportTraffic);
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
      async function loadAirportLocalTime(place, target) {
        if (!target) return;
        try {
          const params = new URLSearchParams({ latitude: String(place.lat), longitude: String(place.lon), current: "temperature_2m", timezone: "auto" });
          const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
          if (!response.ok) throw new Error(`Timezone lookup returned HTTP ${response.status}`);
          const result = await response.json();
          const time = result.current?.time ? new Date(result.current.time) : new Date();
          target.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: result.timezone })} · ${result.timezone}`;
        } catch (error) {
          console.error("Airport local-time lookup failed.", error);
          target.closest(".detail-field")?.remove();
        }
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
    if (code === 0) return { label: "Clear sky", icon: "☼" };
    if ([1, 2].includes(code)) return { label: "Partly cloudy", icon: "◒" };
    if (code === 3) return { label: "Overcast", icon: "☁" };
    if ([45, 48].includes(code)) return { label: "Fog", icon: "≋" };
    if ([51, 53, 55, 56, 57].includes(code)) return { label: "Drizzle", icon: "☂" };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: "Rain", icon: "☂" };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Snow", icon: "❄" };
    if ([95, 96, 99].includes(code)) return { label: "Thunderstorm", icon: "ϟ" };
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
  async function loadAirportQuizPool() {
    try {
      const response = await fetch("/api/quiz-airports?difficulty=hard");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || `Airport quiz data returned HTTP ${response.status}`);
      if (!Array.isArray(result.airports) || result.airports.length < 20) throw new Error("Airport quiz dataset is too small.");
      airportQuestionPool = result.airports;
      if ($("games-page").classList.contains("active")) startQuizRound();
    } catch (error) {
      console.error("Could not load the extended airport quiz dataset.", error);
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
    quizPendingScores = Array(quizPlayers.length).fill(0);
    const level = $("quiz-difficulty").value;
    const source = currentQuizMode === "airline" ? quizAirports : airportQuestionPool;
    const available = source.filter((airport) => airport[currentQuizMode]);
    const pool = available.filter((airport) => level === "easy" ? airport.difficulty === "major"
      : level === "medium" ? airport.difficulty !== "obscure"
        : level === "extreme" ? airport.difficulty === "obscure" : true);
    if (!pool.length) pool.push(...available);
    const shared = pool[Math.floor(Math.random() * pool.length)];
    quizRoundAirports = quizPlayers.map(() => $("quiz-same-question").checked
      ? shared
      : pool[Math.floor(Math.random() * pool.length)]);
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
    const level = $("quiz-difficulty").value;
    const source = currentQuizMode === "airline" ? quizAirports : airportQuestionPool;
    const pool = source.filter((item) => item[currentQuizMode] && (level === "easy" ? item.difficulty === "major"
      : level === "medium" ? item.difficulty !== "obscure"
        : level === "extreme" ? item.difficulty === "obscure" : true));
    const distractors = [...new Set(pool.map((item) => item[currentQuizMode]).filter((answer) => answer && answer !== correct))];
    const choices = shuffle([correct, ...shuffle(distractors).slice(0, 3)]);
    for (const answer of choices) {
      const button = el("button", "quiz-choice", answer);
      button.type = "button";
      button.addEventListener("click", () => answerQuiz(answer, correct));
      $("quiz-options").append(button);
    }
    if ($("quiz-timer-enabled").checked) {
      quizSeconds = Number($("quiz-time-limit").value) || 20;
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
    quizPendingScores[quizPlayerIndex] = right ? 1 : 0;
    $("quiz-feedback").textContent = timedOut ? `Time's up — the answer is ${correct}.`
      : right ? "Correct — +1 point." : `Not quite — the answer is ${correct}.`;
    $("quiz-feedback").classList.toggle("correct", right);
    $("quiz-feedback").classList.toggle("incorrect", !right);
    $("quiz-options").querySelectorAll("button").forEach((choice) => {
      choice.disabled = true;
      if (choice.textContent === correct) choice.classList.add("correct-answer");
    });
    const finalPlayer = quizPlayerIndex === quizPlayers.length - 1;
    if (finalPlayer) {
      quizPlayers.forEach((player, index) => { player.score += quizPendingScores[index] || 0; });
    }
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

  function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }
  function focusDuration(mode = focusMode) {
    return (mode === "work" ? Number(settings.focusWork) : Number(settings.focusBreak)) * 60;
  }
  function renderFocus() {
    const seconds = Math.max(0, Math.ceil(focusRemaining));
    $("focus-clock").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    $("focus-session").textContent = `Session ${Math.min(settings.focusCompleted + 1, settings.focusSessions)} of ${settings.focusSessions} · ${focusMode === "work" ? "Focus" : "Break"}`;
    $("focus-start").textContent = focusRunning ? "Pause" : focusRemaining < focusDuration() ? "Resume" : focusMode === "work" ? "Start focus" : "Start break";
    document.querySelectorAll("[data-focus-mode]").forEach((button) => button.classList.toggle("active", button.dataset.focusMode === focusMode));
    settings.focusRemaining = focusRemaining;
    settings.focusMode = focusMode;
    saveSettings();
  }
  function setFocusMode(mode, reset = true) {
    focusMode = mode;
    if (reset) focusRemaining = focusDuration(mode);
    renderFocus();
  }
  function toggleFocusTimer() {
    if (focusRunning) {
      focusRemaining = Math.max(0, (focusDeadline - Date.now()) / 1000);
      clearInterval(focusInterval);
      focusRunning = false;
      renderFocus();
      return;
    }
    focusRunning = true;
    focusDeadline = Date.now() + focusRemaining * 1000;
    renderFocus();
    clearInterval(focusInterval);
    focusInterval = setInterval(() => {
      focusRemaining = Math.max(0, (focusDeadline - Date.now()) / 1000);
      const left = Math.ceil(focusRemaining);
      $("focus-clock").textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
      if (Date.now() - lastFocusSave > 5000) {
        lastFocusSave = Date.now();
        settings.focusRemaining = focusRemaining;
        saveSettings();
      }
      if (focusRemaining <= 0) completeFocusPhase();
    }, 250);
  }
  function completeFocusPhase() {
    clearInterval(focusInterval);
    focusRunning = false;
    if (focusMode === "work") {
      settings.focusCompleted = (settings.focusCompleted + 1) % Math.max(1, settings.focusSessions);
      setFocusMode("break");
      showMessage(settings.focusCompleted ? "Focus session complete. Take a short break." : "All focus sessions complete. Take a well-earned rest.");
    } else {
      setFocusMode("work");
      showMessage("Break complete. Ready for another focus session?");
    }
  }
  function saveFocusSettings() {
    settings.focusWork = Math.max(1, Math.min(180, Number($("focus-work-duration").value) || 25));
    settings.focusBreak = Math.max(1, Math.min(60, Number($("focus-break-duration").value) || 5));
    settings.focusSessions = Math.max(1, Math.min(12, Number($("focus-session-count").value) || 4));
    if (!focusRunning) focusRemaining = focusDuration();
    $("focus-work-duration").value = settings.focusWork;
    $("focus-break-duration").value = settings.focusBreak;
    $("focus-session-count").value = settings.focusSessions;
    renderFocus();
  }
  function renderAircraftLibrary() {
    const query = $("aircraft-library-search").value.trim().toLowerCase();
    const models = aircraftLibrary.filter((item) => query.split(/\s+/).filter(Boolean).every((term) =>
      Object.values(item).some((value) => String(value).toLowerCase().includes(term))
    ));
    $("aircraft-library-count").textContent = `${models.length} of ${aircraftLibrary.length} aircraft`;
    $("aircraft-library-grid").replaceChildren(...models.map((model) => {
      const card = el("article", "aircraft-library-card info-card");
      const heading = el("div", "library-card-heading");
      heading.append(el("span", "library-type", model.type), el("span", "library-manufacturer", model.manufacturer));
      card.append(heading, el("h3", "", model.model));
      const specs = [
        ["Engines", model.engines], ["Power / thrust", model.power], ["Range", model.range],
        ["Cruise", model.cruise], ["MTOW", model.mtow], ["Operating empty", model.empty],
        ["Typical seats", model.seats], ["Dimensions", model.dimensions], ["First flight", model.first],
        ["Operators", model.operators]
      ];
      const grid = el("div", "library-specs");
      for (const [label, value] of specs) {
        const field = el("div", "library-spec");
        field.append(el("span", "", label), el("strong", "", value));
        grid.append(field);
      }
      card.append(grid);
      return card;
    }));
    if (!models.length) $("aircraft-library-grid").append(el("div", "empty-row", "No aircraft match that search."));
  }
  function openFlightLogForm(entry = null) {
    flightLogEditId = entry?.id || "";
    $("flight-log-form").classList.remove("hidden");
    const fields = { airline: "log-airline", number: "log-number", origin: "log-origin", destination: "log-destination", date: "log-date", aircraft: "log-aircraft", registration: "log-registration", seat: "log-seat", notes: "log-notes" };
    for (const [key, id] of Object.entries(fields)) $(id).value = entry?.[key] || (key === "date" ? new Date().toISOString().slice(0, 10) : "");
    $("flight-log-save").textContent = entry ? "Update flight" : "Save flight";
    $("log-airline").focus();
  }
  function closeFlightLogForm() {
    $("flight-log-form").classList.add("hidden");
    flightLogEditId = "";
  }
  function saveFlightLog() {
    const entry = {
      id: flightLogEditId || (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      airline: $("log-airline").value.trim(), number: $("log-number").value.trim(),
      origin: $("log-origin").value.trim(), destination: $("log-destination").value.trim(),
      date: $("log-date").value, aircraft: $("log-aircraft").value.trim(),
      registration: $("log-registration").value.trim(), seat: $("log-seat").value.trim(),
      notes: $("log-notes").value.trim(), updatedAt: Date.now()
    };
    if (!entry.airline && !entry.number && !entry.origin && !entry.destination) {
      showMessage("Add an airline, flight number or route before saving.");
      return;
    }
    const index = flightLogs.findIndex((item) => item.id === entry.id);
    if (index >= 0) flightLogs.splice(index, 1, entry);
    else flightLogs.push(entry);
    writeLocalList("aeroam-flight-log-v1", flightLogs);
    closeFlightLogForm();
    renderFlightLog();
  }
  function logWithinPeriod(entry) {
    if (logPeriod === "lifetime") return true;
    if (!entry.date) return false;
    const elapsed = Date.now() - new Date(`${entry.date}T00:00:00`).getTime();
    const day = 86_400_000;
    if (logPeriod === "day") return elapsed >= 0 && elapsed < day;
    if (logPeriod === "week") return elapsed >= 0 && elapsed < day * 7;
    if (logPeriod === "month") return elapsed >= 0 && elapsed < day * 30.5;
    if (logPeriod === "year") return elapsed >= 0 && elapsed < day * 365.25;
    return elapsed >= 0 && elapsed < day * 365.25 * 5;
  }
  function renderFlightLog() {
    const list = $("flight-log-list");
    const entries = flightLogs.filter(logWithinPeriod).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    $("log-periods").querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.period === logPeriod));
    if (!entries.length) {
      list.replaceChildren(el("div", "empty-row", "No flights recorded in this period yet."));
      return;
    }
    list.replaceChildren(...entries.map((entry) => {
      const card = el("article", "flight-log-entry info-card");
      const heading = el("div", "flight-log-entry-heading");
      heading.append(el("span", "eyebrow", entry.date ? new Date(`${entry.date}T12:00:00`).toLocaleDateString([], { dateStyle: "long" }) : "Date not recorded"));
      const controls = el("div", "flight-log-entry-controls");
      const edit = el("button", "text-button", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => openFlightLogForm(entry));
      const remove = el("button", "text-button", "Delete");
      remove.type = "button";
      remove.addEventListener("click", () => {
        const index = flightLogs.findIndex((item) => item.id === entry.id);
        if (index >= 0) flightLogs.splice(index, 1);
        writeLocalList("aeroam-flight-log-v1", flightLogs);
        renderFlightLog();
      });
      controls.append(edit, remove);
      heading.append(controls);
      card.append(heading, el("h3", "", [entry.airline, entry.number].filter(Boolean).join(" ") || "Flight"));
      const route = [entry.origin, entry.destination].filter(Boolean).join(" → ");
      if (route) card.append(el("p", "log-route", route));
      const details = [entry.aircraft, entry.registration && `Reg ${entry.registration}`, entry.seat && `Seat ${entry.seat}`].filter(Boolean).join(" · ");
      if (details) card.append(el("p", "log-details", details));
      if (entry.notes) card.append(el("p", "log-notes-copy", entry.notes));
      return card;
    }));
  }
  function updateReplayChoices() {
    const select = $("replay-aircraft");
    if (!select) return;
    const prior = select.value;
    const entries = Object.entries(aircraftTrail).filter(([, points]) => points.length > 1)
      .sort((a, b) => b[1].at(-1).time - a[1].at(-1).time);
    select.replaceChildren(new Option(entries.length ? "Choose tracked aircraft…" : "No local track history yet", ""));
    entries.forEach(([icao, points]) => {
      const live = aircraft.find((flight) => flight.icao === icao);
      const recent = recentlyTracked.find((flight) => flight.icao === icao);
      select.append(new Option(`${live?.callsign || recent?.callsign || icao} · ${points.length} positions`, icao));
    });
    if (entries.some(([icao]) => icao === prior)) select.value = prior;
    renderReplayPoint();
  }
  function replayPoint() {
    const points = aircraftTrail[$("replay-aircraft").value] || [];
    if (!points.length) return null;
    return points[Math.round((Number($("replay-time").value) / 100) * (points.length - 1))];
  }
  function renderReplayPoint() {
    const point = replayPoint();
    if (!point) {
      $("replay-output").textContent = "Track replay is collected locally while AeroAM is open. Recent history is kept for up to 12 hours.";
      return;
    }
    $("replay-output").textContent = `${new Date(point.time).toLocaleString()} · ${point.lat.toFixed(4)}°, ${point.lon.toFixed(4)}°${Number.isFinite(point.altitude) ? ` · ${Math.round(point.altitude * 3.28084).toLocaleString()} ft` : ""}`;
  }
  function showReplayOnMap() {
    const icao = $("replay-aircraft").value;
    const points = aircraftTrail[icao] || [];
    const point = replayPoint();
    if (!point || !map) return;
    setPage("map-page");
    map.flyTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 7), duration: 1000 });
    if (!replayMarker) {
      const element = el("div", "replay-aircraft-marker", "✈");
      replayMarker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat([point.lon, point.lat]).addTo(map);
    }
    replayMarker.setLngLat([point.lon, point.lat]);
    if (map.getSource("aircraft-trail")) {
      map.getSource("aircraft-trail").setData({ type: "FeatureCollection", features: points.length > 1 ? [{
        type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map((entry) => [entry.lon, entry.lat]) }
      }] : [] });
    }
    $("replay-output").textContent = `${icao} · ${points.length} locally recorded positions · ${new Date(point.time).toLocaleString()}`;
  }
  let arPosition = null;
  async function startAR() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser.");
      if (window.DeviceOrientationEvent?.requestPermission) {
        const permission = await window.DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") throw new Error("Motion sensor permission was not granted.");
      }
      arStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      $("ar-camera").srcObject = arStream;
      $("ar-start").classList.add("hidden");
      $("ar-stop").classList.remove("hidden");
      $("ar-status").classList.add("hidden");
      if (!arOrientationListening) {
        window.addEventListener("deviceorientation", updateARHeading, true);
        arOrientationListening = true;
      }
      navigator.geolocation.getCurrentPosition((position) => {
        arPosition = { lat: position.coords.latitude, lon: position.coords.longitude, altitude: position.coords.altitude || 0 };
        renderARAircraft();
      }, (error) => {
        console.error("AR location lookup failed.", error);
        $("ar-status").textContent = "Allow location access to place live aircraft in the sky view.";
        $("ar-status").classList.remove("hidden");
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    } catch (error) {
      console.error("AR mode could not start.", error);
      $("ar-status").textContent = error.message || "Camera or motion-sensor access is unavailable.";
      $("ar-status").classList.remove("hidden");
      showMessage(error.message || "AR mode could not start.");
    }
  }
  function updateARHeading(event) {
    const headingValue = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading
      : Number.isFinite(event.alpha) ? (360 - event.alpha + (screen.orientation?.angle || 0)) % 360 : arHeading;
    arHeading = headingValue;
    renderARAircraft();
  }
  function bearingTo(from, to) {
    const radians = (value) => value * Math.PI / 180;
    const y = Math.sin(radians(to.lon - from.lon)) * Math.cos(radians(to.lat));
    const x = Math.cos(radians(from.lat)) * Math.sin(radians(to.lat)) - Math.sin(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.cos(radians(to.lon - from.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function renderARAircraft() {
    if (!arPosition) return;
    const visible = aircraft.map((flight) => {
      const distance = distanceBetween(arPosition, flight);
      const relative = ((bearingTo(arPosition, flight) - arHeading + 540) % 360) - 180;
      return { flight, distance, relative };
    }).filter((entry) => entry.distance < 180 && Math.abs(entry.relative) < 46)
      .sort((a, b) => a.distance - b.distance).slice(0, 16);
    const target = $("ar-aircraft");
    target.replaceChildren(...visible.map(({ flight, distance, relative }) => {
      const label = el("button", "ar-label");
      label.type = "button";
      label.style.left = `${50 + relative / 46 * 45}%`;
      const altitudeAngle = Math.atan2(Math.max(0, (flight.baroAltitude || 0) - arPosition.altitude), distance * 1000) * 180 / Math.PI;
      label.style.top = `${Math.max(14, Math.min(76, 57 - altitudeAngle * 1.15))}%`;
      label.append(el("strong", "", flight.callsign || flight.icao), el("span", "", `${Math.round(distance)} km · ${altitude(flight)}`));
      label.addEventListener("click", () => openAircraft(flight.icao));
      return label;
    }));
    if (!visible.length && arStream) {
      $("ar-status").textContent = "No aircraft from the current live map feed are in this direction.";
      $("ar-status").classList.remove("hidden");
    } else $("ar-status").classList.add("hidden");
  }
  function stopAR() {
    if (arStream) arStream.getTracks().forEach((track) => track.stop());
    arStream = undefined;
    $("ar-camera").srcObject = null;
    $("ar-start").classList.remove("hidden");
    $("ar-stop").classList.add("hidden");
    $("ar-status").textContent = "Enable your camera to start the sky view.";
    $("ar-status").classList.remove("hidden");
    $("ar-aircraft").replaceChildren();
  }
  function renderVisualizer() {
    const style = settings.visualizerStyle || "bars";
    const colour = settings.visualizerColour || settings.accent;
    for (const id of ["radio-visualizer", "standby-visualizer"]) {
      const target = $(id);
      if (!target) continue;
      target.className = `${id === "radio-visualizer" ? "radio-visualizer" : "standby-visualizer mini-visualizer"} visualizer-${style}`;
      target.style.setProperty("--visualizer-colour", colour);
      target.replaceChildren(...Array.from({ length: 24 }, (_value, index) => {
        const bar = el("i", "visualizer-bar");
        bar.style.setProperty("--bar-index", String(index));
        return bar;
      }));
      target.classList.toggle("hidden", id === "standby-visualizer" ? !settings.visualizer : !$("radio-player").paused);
    }
  }
  async function searchAirportTime(query) {
    const target = $("airport-time-results");
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      target.replaceChildren(el("div", "empty-row", "Enter an airport code, name or city."));
      return;
    }
    target.replaceChildren(el("div", "empty-row", "Searching the airport directory…"));
    try {
      const response = await fetch(`/api/airport-search?${new URLSearchParams({ q: trimmed })}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || `Airport search returned HTTP ${response.status}`);
      target.replaceChildren(...(result.airports || []).map((airport) => {
        const row = el("button", "airport-time-result");
        row.type = "button";
        const caption = el("span", "", [airport.icao, airport.iata, airport.municipality, airport.country].filter(Boolean).join(" · "));
        row.append(el("strong", "", airport.name), caption, el("time", "", "Loading local time…"));
        row.addEventListener("click", async () => {
          try {
            const params = new URLSearchParams({ latitude: String(airport.lat), longitude: String(airport.lon), current: "temperature_2m", timezone: "auto" });
            const timeResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
            if (!timeResponse.ok) throw new Error(`Timezone lookup returned HTTP ${timeResponse.status}`);
            const timeData = await timeResponse.json();
            row.querySelector("time").textContent = `${new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", timeZone: timeData.timezone }).format(new Date())} · ${timeData.timezone}`;
          } catch (error) {
            console.error("Airport time lookup failed.", error);
            row.querySelector("time").textContent = "Local time unavailable";
          }
          if (map) {
            setPage("map-page");
            map.flyTo({ center: [airport.lon, airport.lat], zoom: Math.max(map.getZoom(), 9), duration: 1100 });
          }
        });
        return row;
      }));
      if (!result.airports?.length) target.append(el("div", "empty-row", "No airports found."));
    } catch (error) {
      console.error("Airport time search failed.", error);
      target.replaceChildren(el("div", "empty-row", error.message || "Airport search is temporarily unavailable."));
    }
  }
  const aircraftPerPassengerKm = { A320: 0.090, B738: 0.095, B789: 0.072, AT76: 0.120, B77W: 0.090 };
  const aircraftPassengerCounts = { A320: 150, B738: 160, B789: 260, AT76: 60, B77W: 350 };
  const carPerKm = { corolla: 0.105, model3: 0.060, rav4: 0.180, f150: 0.290 };
  function compareCarbon() {
    const distance = Number($("carbon-distance").value);
    if (!Number.isFinite(distance) || distance <= 0 || distance > 20000) {
      $("carbon-result").textContent = "Enter a route distance between 1 and 20,000 km.";
      return;
    }
    const planeType = $("carbon-aircraft-model").value;
    const carType = $("carbon-car-model").value;
    const planePerPassengerKg = distance * aircraftPerPassengerKm[planeType];
    const planeFlightKg = planePerPassengerKg * aircraftPassengerCounts[planeType];
    const carTripKg = distance * carPerKm[carType];
    const carPerPersonKg = carTripKg / 1.5;
    const carLabel = $("carbon-car-model").selectedOptions[0].textContent;
    $("carbon-result").replaceChildren(
      el("strong", "", `${planePerPassengerKg.toFixed(1)} kg CO₂ per plane passenger · ${carPerPersonKg.toFixed(1)} kg per car occupant`),
      el("span", "", `Approx. flight total: ${Math.round(planeFlightKg).toLocaleString()} kg for ${aircraftPassengerCounts[planeType]} passengers; ${carTripKg.toFixed(1)} kg for one ${carLabel} carrying 1.5 occupants.`),
      el("small", "", "Indicative model-based averages; actual emissions vary by aircraft, occupancy, route, driving and electricity mix.")
    );
  }
  function decodePolyline(encoded) {
    const points = [];
    let index = 0, lat = 0, lon = 0;
    while (index < encoded.length) {
      let result = 0, shift = 0, byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
      lat += result & 1 ? ~(result >> 1) : result >> 1;
      result = 0; shift = 0;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20 && index < encoded.length);
      lon += result & 1 ? ~(result >> 1) : result >> 1;
      points.push({ lat: lat / 1e5, lon: lon / 1e5 });
    }
    return points;
  }
  function matchStravaRoute(distanceMeters, points) {
    const results = $("strava-results");
    if (!Number.isFinite(distanceMeters) || distanceMeters < 500) {
      results.replaceChildren(el("div", "empty-row", "This activity does not include a usable GPS route or distance."));
      return;
    }
    const activityKm = distanceMeters / 1000;
    const airports = quizAirports.filter((airport) => airport.difficulty === "major" || airport.difficulty === "common");
    const matches = [];
    for (let from = 0; from < airports.length; from += 1) {
      for (let to = from + 1; to < airports.length; to += 1) {
        const routeKm = distanceBetween(airports[from], airports[to]);
        const errorPercent = Math.abs(routeKm - activityKm) / activityKm * 100;
        if (errorPercent <= 10) matches.push({ from: airports[from], to: airports[to], routeKm, errorPercent });
      }
    }
    matches.sort((a, b) => a.errorPercent - b.errorPercent);
    results.replaceChildren(el("strong", "", `${activityKm.toFixed(1)} km activity`));
    if (!matches.length) {
      results.append(el("span", "", "No close airport-pair distance found in the route sample. This is a distance comparison, not a flight booking or a claim that the activity followed this route."));
      return;
    }
    for (const match of matches.slice(0, 5)) {
      const result = el("div", "strava-match");
      result.append(el("strong", "", `${match.from.iata} → ${match.to.iata}`), el("span", "", `${match.from.name} to ${match.to.name} · ${Math.round(match.routeKm).toLocaleString()} km · ${match.errorPercent.toFixed(1)}% distance difference`));
      results.append(result);
    }
    if (points.length) results.append(el("small", "", `Matched against the activity's ${points.length} recorded GPS points and airport reference coordinates.`));
  }
  async function importStravaActivity(file) {
    const results = $("strava-results");
    try {
      const text = await file.text();
      const extension = file.name.split(".").pop().toLowerCase();
      let distanceMeters = 0;
      let points = [];
      if (extension === "gpx" || extension === "tcx") {
        const document = new DOMParser().parseFromString(text, "application/xml");
        if (document.querySelector("parsererror")) throw new Error("The activity file is not valid GPX or TCX XML.");
        const pointNodes = [...document.querySelectorAll(extension === "gpx" ? "trkpt" : "Trackpoint")];
        points = pointNodes.map((node) => ({ lat: Number(node.getAttribute("lat") || node.querySelector("Position LatitudeDegrees")?.textContent), lon: Number(node.getAttribute("lon") || node.querySelector("Position LongitudeDegrees")?.textContent) })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
        if (points.length < 2) throw new Error("This activity contains fewer than two GPS points.");
        for (let index = 1; index < points.length; index += 1) distanceMeters += distanceBetween(points[index - 1], points[index]) * 1000;
      } else if (extension === "csv") {
        const rows = text.split(/\r?\n/).filter(Boolean);
        const parseRow = (line) => {
          const cells = [];
          let value = "", quoted = false;
          for (let index = 0; index < line.length; index += 1) {
            const character = line[index];
            if (character === "\"" && quoted && line[index + 1] === "\"") { value += "\""; index += 1; }
            else if (character === "\"") quoted = !quoted;
            else if (character === "," && !quoted) { cells.push(value); value = ""; }
            else value += character;
          }
          cells.push(value);
          return cells;
        };
        if (rows.length < 2) throw new Error("The activity CSV contains no activity rows.");
        const headers = parseRow(rows[0]).map((header) => header.trim().toLowerCase());
        const distanceIndex = headers.findIndex((header) => header === "distance" || header === "distance_meters");
        if (distanceIndex < 0) throw new Error("No distance column was found in the activity CSV.");
        const activity = rows.slice(1).map(parseRow).find((row) => Number(row[distanceIndex]) > 0);
        distanceMeters = Number(activity?.[distanceIndex]) || 0;
      } else {
        const activity = JSON.parse(text);
        const values = Array.isArray(activity) ? activity : [activity];
        const record = values.find((entry) => Number(entry.distance) > 0) || values[0] || {};
        distanceMeters = Number(record.distance || record.distance_meters || 0);
        const polyline = record.map?.summary_polyline || record.summary_polyline || record.map?.polyline;
        if (typeof polyline === "string" && polyline) points = decodePolyline(polyline);
      }
      matchStravaRoute(distanceMeters, points);
    } catch (error) {
      console.error("Strava activity import failed.", error);
      results.replaceChildren(el("div", "empty-row", error.message || "Could not read this Strava activity file."));
    }
  }
  let menuClickCount = 0;
  let menuClickReset;
  async function zoomToNearestAirport() {
    try {
      const { lat, lon } = settings.location;
      const response = await fetch(`/api/nearest-airport?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`);
      const airport = await response.json();
      if (!response.ok) throw new Error(airport.error?.message || `Airport lookup returned HTTP ${response.status}`);
      if (!map) return;
      setPage("map-page");
      map.flyTo({ center: [airport.lon, airport.lat], zoom: 10, duration: 1200 });
      showMessage(`Nearest airport: ${airport.name} · ${airport.distanceKm.toFixed(1)} km`);
    } catch (error) {
      console.error("Nearest airport lookup failed.", error);
      showMessage("The nearest airport could not be found right now.");
    }
  }
  async function enterFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await (document.documentElement.requestFullscreen?.() || $("map-card").requestFullscreen?.());
    } catch (error) {
      console.error("Fullscreen mode could not start.", error);
      showMessage("Fullscreen is unavailable in this browser.");
    }
  }
  async function openCastDisplay() {
    const { lat, lon, name } = settings.location;
    const url = `${location.origin}/cast?${new URLSearchParams({ lat: String(lat), lon: String(lon), name })}`;
    try {
      if ("PresentationRequest" in window) {
        const presentation = new PresentationRequest([url]);
        await presentation.start();
        return;
      }
    } catch (error) {
      console.info("External presentation could not start; opening the standalone display.", error);
    }
    const display = window.open(url, "aeroam-standby-display", "popup,width=1280,height=800");
    if (!display) {
      try { await navigator.clipboard.writeText(url); } catch (error) { console.error("Could not copy cast display URL.", error); }
      showMessage("The standby display URL was copied if clipboard access is available. Open it on your receiving screen.");
      return;
    }
    display.focus();
    showMessage("Standalone standby display opened. It refreshes independently while the AeroAM server is online.");
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
  function geolocate(silent = false) {
    if (!navigator.geolocation) {
      if (!silent) showMessage("This browser does not support geolocation. Showing Cork, Ireland.");
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
      if (!silent) showMessage(reasons[error.code] || "Unable to get your location.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function setStandby(enabled) {
    settings.standby = enabled;
    if (enabled) {
      $("workspace-menu").classList.add("hidden");
      $("workspace-button").setAttribute("aria-expanded", "false");
      closeSettings();
      $("detail-panel").classList.remove("open");
      $("detail-panel").setAttribute("aria-hidden", "true");
      $("panel-scrim").classList.add("hidden");
    }
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
        if (enabled) {
          const tracked = settings.trackAircraft ? aircraft.find((flight) => flight.icao === selectedIcao) : null;
          const center = tracked ? [tracked.lon, tracked.lat] : [settings.location.lon, settings.location.lat];
          map.easeTo({ center, duration: 900, essential: false });
        }
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
    const nowLabel = active ? `Now Playing • ${nowPlayingTitle || nowPlayingKind} • ${nowPlayingKind}` : "";
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
        }, 60_000);
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
    if (map && currentMapTheme !== settings.theme) {
      map.setStyle(settings.theme === "light" ? "https://tiles.openfreemap.org/styles/bright" : "https://tiles.openfreemap.org/styles/dark");
      currentMapTheme = settings.theme;
    }
    if (map?.getLayer("aircraft-trail-line")) map.setPaintProperty("aircraft-trail-line", "line-color", resolvedAccent);
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
    for (const key of ["weather", "labels", "airports", "radio", "nowPlaying", "detailed", "standby", "routeTrail", "trackAircraft", "visualizer"]) {
      const controlKey = ({ nowPlaying: "now-playing", routeTrail: "route-trail", trackAircraft: "track-aircraft" })[key] || key;
      $(`setting-${controlKey}`).checked = settings[key];
    }
    $("setting-clock-format").value = settings.clockFormat;
    $("setting-clock-style").value = settings.clockStyle;
    $("labels-button").setAttribute("aria-pressed", String(settings.labels));
    $("airports-button").setAttribute("aria-pressed", String(settings.airports));
    $("trail-button").setAttribute("aria-pressed", String(settings.routeTrail));
    $("radio-controls").classList.toggle("hidden", !settings.radio);
    $("quiz-player-count").value = String(settings.quizPlayerCount || 1);
    $("quiz-same-question").checked = settings.quizSameQuestion;
    $("quiz-timer-enabled").checked = settings.quizTimer;
    $("quiz-time-limit").value = String(settings.quizTimeLimit);
    $("quiz-difficulty").value = settings.quizDifficulty;
    $("setting-visualizer-style").value = settings.visualizerStyle;
    $("setting-visualizer-colour").value = settings.visualizerColour;
    $("focus-work-duration").value = settings.focusWork;
    $("focus-break-duration").value = settings.focusBreak;
    $("focus-session-count").value = settings.focusSessions;
    applyTheme();
    setLocationLabel();
    setStandby(settings.standby);
    updateClock();
    renderVisualizer();
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
    updateAircraftTrail();
    renderAircraft();
  }
  function setPage(pageId) {
    document.querySelectorAll(".page-view").forEach((page) => page.classList.toggle("active", page.id === pageId));
    document.querySelectorAll(".workspace-menu [data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === pageId));
    const labels = {
      "map-page": ["THE WORLD ABOVE YOU", "Live map"],
      "traffic-page": ["LIVE · YOUR AIRSPACE", "Traffic board"],
      "focus-page": ["A LITTLE TIME FOR YOU", "Focus"],
      "library-page": ["AIRCRAFT REFERENCE", "Aircraft Library"],
      "log-page": ["YOUR TRAVEL HISTORY", "Flight Log"],
      "ar-page": ["LOOK UP AND DISCOVER", "AR Mode"],
      "tools-page": ["USEFUL AVIATION TOOLS", "Tools"],
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
    if (pageId === "traffic-page") enrichTrafficAircraft();
    if (pageId === "incidents-page") loadIncidents();
    if (pageId === "library-page") renderAircraftLibrary();
    if (pageId === "log-page") { renderFlightLog(); renderRecentlyTracked(); }
    if (pageId === "tools-page") updateReplayChoices();
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
  $("locate-button").addEventListener("click", () => geolocate(false));
  $("standby-button").addEventListener("click", () => setStandby(!settings.standby));
  $("standby-exit").addEventListener("click", () => setStandby(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { setStandby(false); closeSettings(); closeDetails(); } });
  $("zoom-in").addEventListener("click", () => map?.zoomIn());
  $("zoom-out").addEventListener("click", () => map?.zoomOut());
  $("fullscreen-button").addEventListener("click", enterFullscreen);
  $("aero-logo").addEventListener("dblclick", (event) => { event.preventDefault(); enterFullscreen(); });
  $("trail-button").addEventListener("click", () => {
    settings.routeTrail = !settings.routeTrail;
    $("setting-route-trail").checked = settings.routeTrail;
    $("trail-button").setAttribute("aria-pressed", String(settings.routeTrail));
    saveSettings();
    updateAircraftTrail();
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
  document.querySelectorAll(".workspace-menu [data-page]").forEach((button) => button.addEventListener("click", () => {
    menuClickCount = 0;
    clearTimeout(menuClickReset);
    setPage(button.dataset.page);
  }));
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
    renderVisualizer();
  });
  $("radio-player").addEventListener("pause", () => { setNowPlaying("Radio", "", false); renderVisualizer(); });
  $("radio-player").addEventListener("ended", () => { setNowPlaying("Radio", "", false); renderVisualizer(); });
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
    menuClickCount += 1;
    clearTimeout(menuClickReset);
    menuClickReset = setTimeout(() => { menuClickCount = 0; }, 1800);
    if (menuClickCount >= 4) {
      menuClickCount = 0;
      $("workspace-menu").classList.add("hidden");
      $("workspace-button").setAttribute("aria-expanded", "false");
      zoomToNearestAirport();
      return;
    }
    const menu = $("workspace-menu");
    const open = menu.classList.toggle("hidden") === false;
    $("workspace-button").setAttribute("aria-expanded", String(open));
  });
  $("menu-settings").addEventListener("click", () => {
    menuClickCount = 0;
    clearTimeout(menuClickReset);
    $("workspace-menu").classList.add("hidden");
    $("workspace-button").setAttribute("aria-expanded", "false");
    setStandby(false);
    openSettings();
  });
  $("menu-cast").addEventListener("click", () => {
    menuClickCount = 0;
    clearTimeout(menuClickReset);
    $("workspace-menu").classList.add("hidden");
    $("workspace-button").setAttribute("aria-expanded", "false");
    openCastDisplay();
  });
  $("settings-close").addEventListener("click", closeSettings);
  $("settings-scrim").addEventListener("click", closeSettings);
  const settingsMap = { "setting-weather": "weather", "setting-labels": "labels", "setting-airports": "airports", "setting-detailed": "detailed", "setting-route-trail": "routeTrail", "setting-track-aircraft": "trackAircraft", "setting-visualizer": "visualizer" };
  for (const [id, key] of Object.entries(settingsMap)) {
    $(id).addEventListener("change", (event) => {
      settings[key] = event.target.checked;
      saveSettings(); syncSettingsControls();
      if (key === "labels") renderAircraft();
      if (key === "airports") updateAirports();
      if (key === "routeTrail") updateAircraftTrail();
      if (key === "visualizer") renderVisualizer();
      if (key === "trackAircraft" && event.target.checked && settings.standby && selectedIcao) {
        const tracked = aircraft.find((flight) => flight.icao === selectedIcao);
        if (tracked) map?.easeTo({ center: [tracked.lon, tracked.lat], duration: 800 });
      }
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
  $("setting-visualizer-style").addEventListener("change", (event) => {
    settings.visualizerStyle = event.target.value;
    saveSettings();
    renderVisualizer();
  });
  $("setting-visualizer-colour").addEventListener("input", (event) => {
    settings.visualizerColour = event.target.value;
    saveSettings();
    renderVisualizer();
  });
  $("save-location").addEventListener("click", () => searchLocation($("setting-location").value));
  $("focus-start").addEventListener("click", toggleFocusTimer);
  $("focus-reset").addEventListener("click", () => {
    clearInterval(focusInterval);
    focusRunning = false;
    focusRemaining = focusDuration();
    renderFocus();
  });
  $("focus-save").addEventListener("click", saveFocusSettings);
  document.querySelectorAll("[data-focus-mode]").forEach((button) => button.addEventListener("click", () => {
    clearInterval(focusInterval);
    focusRunning = false;
    setFocusMode(button.dataset.focusMode);
  }));
  $("aircraft-library-search").addEventListener("input", renderAircraftLibrary);
  $("flight-log-add").addEventListener("click", () => openFlightLogForm());
  $("flight-log-save").addEventListener("click", saveFlightLog);
  $("flight-log-cancel").addEventListener("click", closeFlightLogForm);
  $("log-periods").addEventListener("click", (event) => {
    const button = event.target.closest("[data-period]");
    if (!button) return;
    logPeriod = button.dataset.period;
    renderFlightLog();
  });
  $("ar-start").addEventListener("click", startAR);
  $("ar-stop").addEventListener("click", stopAR);
  $("airport-time-search-button").addEventListener("click", () => searchAirportTime($("airport-time-search").value));
  $("airport-time-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchAirportTime(event.currentTarget.value);
  });
  $("carbon-calculate").addEventListener("click", compareCarbon);
  $("carbon-distance").addEventListener("input", compareCarbon);
  $("carbon-aircraft-model").addEventListener("change", compareCarbon);
  $("carbon-car-model").addEventListener("change", compareCarbon);
  $("replay-aircraft").addEventListener("change", renderReplayPoint);
  $("replay-time").addEventListener("input", renderReplayPoint);
  $("replay-show-map").addEventListener("click", showReplayOnMap);
  $("strava-file").addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) importStravaActivity(file);
  });
  $("quiz-difficulty").addEventListener("change", (event) => {
    settings.quizDifficulty = event.target.value;
    saveSettings();
    startQuizRound();
  });
  $("quiz-time-limit").addEventListener("change", (event) => {
    settings.quizTimeLimit = Number(event.target.value) || 20;
    saveSettings();
    startQuizRound();
  });
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
  const arSupported = window.matchMedia("(max-width: 760px), (pointer: coarse)").matches && Boolean(navigator.mediaDevices?.getUserMedia);
  document.querySelector(".ar-menu-item").classList.toggle("hidden", !arSupported);
  window.addEventListener("pagehide", stopAR);
  syncSettingsControls();
  renderColumnMenu();
  renderStatistics();
  renderTable();
  renderAircraftLibrary();
  renderFlightLog();
  renderRecentlyTracked();
  renderFocus();
  updateReplayChoices();
  compareCarbon();
  configureQuizPlayers();
  initializeMap();
  loadAirportQuizPool();
  loadRadioStations();
  updateWeather();
  updateClock();
  setInterval(updateClock, 1000);
})();
