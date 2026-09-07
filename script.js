const CONFIG = {
    FIRMS_MAP_KEY: "PASTE_YOUR_FIRMS_MAP_KEY_HERE",
    REFRESH_TIME: 5 * 60 * 1000,
    MAP_CENTER: [20, 0],
    MAP_ZOOM: 3
};

const state = {
    map: null,
    markers: [],
    observations: [],
    missionStart: Date.now(),
    totalDataPoints: 0,
    highPriorityEvents: 0,
    selectedSatellite: "NOAA-21",
    mode: "AUTO",
    refreshTimer: null
};

function $(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
}

function now() {
    return new Date().toLocaleTimeString();
}

function logEvent(message, type = "INFO") {
    const log = $("eventLog");
    if (!log) return;

    const entry = document.createElement("div");

    entry.className = "log-entry";

    entry.innerHTML = `
        <span>${now()}</span>
        <strong>${type}</strong>
        <span>${message}</span>
    `;

    log.prepend(entry);

    while (log.children.length > 40) {
        log.removeChild(log.lastChild);
    }
}

function connectionStatus(connected) {

    const dot = $("connectionDot");
    const indicator = $("systemStatusIndicator");

    if (connected) {
        setText("connectionText", "CONNECTED");
        setText("systemStatus", "ONLINE");

        if (dot) dot.classList.add("connected");

        if (indicator) {
            indicator.style.background = "#62ef9c";
            indicator.style.boxShadow = "0 0 10px #62ef9c";
        }

    } else {
        setText("connectionText", "OFFLINE");
        setText("systemStatus", "OFFLINE");

        if (dot) dot.classList.remove("connected");

        if (indicator) {
            indicator.style.background = "#ff4b4b";
            indicator.style.boxShadow = "0 0 10px #ff4b4b";
        }
    }
}

function initializeMap() {

    if (!$("earthMap")) {
        console.error("earthMap element not found.");
        return;
    }

    if (typeof L === "undefined") {
        console.error("Leaflet is not loaded.");
        return;
    }

    state.map = L.map("earthMap").setView(
        CONFIG.MAP_CENTER,
        CONFIG.MAP_ZOOM
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 18,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(state.map);

    logEvent("Earth map initialized.", "SYSTEM");
}


function clearMarkers() {

    if (!state.map) return;

    state.markers.forEach(marker => {
        state.map.removeLayer(marker);
    });

    state.markers = [];
}


function getPriority(confidence, frp) {

    const c = Number(confidence);
    const f = Number(frp);

    if (c >= 80 || f >= 100) {
        return "HIGH";
    }

    if (c >= 50 || f >= 30) {
        return "MEDIUM";
    }

    return "LOW";
}

function addFireMarker(item) {

    if (!state.map) return;

    let color = "#ffe600";

    if (item.priority === "MEDIUM") {
        color = "#ff9d00";
    }

    if (item.priority === "HIGH") {
        color = "#ff2020";
    }

    const marker = L.circleMarker(
        [item.latitude, item.longitude],
        {
            radius: item.priority === "HIGH" ? 8 : 6,
            color: color,
            fillColor: color,
            fillOpacity: 0.8,
            weight: 2
        }
    );

    marker.bindPopup(`
        <b>🔥 NASA FIRE DETECTION</b>
        <hr>

        <b>Satellite:</b> ${item.satellite}<br>
        <b>Latitude:</b> ${item.latitude.toFixed(4)}<br>
        <b>Longitude:</b> ${item.longitude.toFixed(4)}<br>
        <b>Confidence:</b> ${item.confidence}<br>
        <b>FRP:</b> ${item.frp} MW<br>
        <b>Date:</b> ${item.date}<br>
        <b>Time:</b> ${item.time}<br>
        <b>Priority:</b> ${item.priority}
    `);

    marker.addTo(state.map);

    state.markers.push(marker);
}

function parseCSV(csv) {

    const lines = csv
        .trim()
        .split(/\r?\n/);

    if (lines.length < 2) {
        return [];
    }

    const headers = lines[0]
        .split(",")
        .map(header => header.trim().toLowerCase());

    const result = [];

    for (let i = 1; i < lines.length; i++) {

        const values = lines[i].split(",");

        if (values.length !== headers.length) {
            continue;
        }

        const row = {};

        headers.forEach((header, index) => {
            row[header] = values[index].trim();
        });

        const latitude = Number(row.latitude);
        const longitude = Number(row.longitude);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
            continue;
        }

        const confidence =
            row.confidence || "N/A";

        const frp =
            Number(row.frp || 0);

        result.push({

            latitude: latitude,

            longitude: longitude,

            confidence: confidence,

            frp: Number.isFinite(frp) ? frp : 0,

            satellite:
                row.satellite ||
                state.selectedSatellite,

            date:
                row.acq_date ||
                "N/A",

            time:
                row.acq_time ||
                "N/A",

            region:
                `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,

            priority:
                getPriority(
                    Number(confidence) || 0,
                    frp
                )
        });
    }

    return result;
}

async function getNASAData() {

    if (
        !CONFIG.FIRMS_MAP_KEY ||
        CONFIG.FIRMS_MAP_KEY ===
        "PASTE_YOUR_FIRMS_MAP_KEY_HERE"
    ) {

        throw new Error(
            "NASA FIRMS MAP KEY is missing."
        );
    }


    const satelliteSources = {

        "NOAA-21":
            "VIIRS_NOAA21_NRT",

        "NOAA-20":
            "VIIRS_NOAA20_NRT",

        "SNPP":
            "VIIRS_SNPP_NRT"
    };


    const source =
        satelliteSources[state.selectedSatellite];


    const url =
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/" +
        encodeURIComponent(CONFIG.FIRMS_MAP_KEY) +
        "/" +
        source +
        "/world/" +
        CONFIG.DAYS;


    const response = await fetch(url);


    if (!response.ok) {

        throw new Error(
            `NASA FIRMS HTTP error: ${response.status}`
        );
    }


    const csv = await response.text();


    if (
        csv.toLowerCase().includes("<html") ||
        csv.toLowerCase().includes("<!doctype")
    ) {

        throw new Error(
            "NASA FIRMS returned an unexpected response."
        );
    }


    return parseCSV(csv);
}

async function loadSatelliteData() {

    if (state.loading) return;

    state.loading = true;

    setText(
        "analysisStatus",
        "CONNECTING"
    );

    setText(
        "analysisMessage",
        "Requesting real NASA FIRMS observations..."
    );

    logEvent(
        "Requesting NASA FIRMS data...",
        "DATA"
    );


    try {

        const observations =
            await getNASAData();


        state.observations =
            observations;


        state.totalDataPoints +=
            observations.length;


        state.highPriorityEvents =
            observations.filter(
                item => item.priority === "HIGH"
            ).length;


        clearMarkers();


        observations.forEach(
            addFireMarker
        );


        updateDashboard();

        updateObservationTable();

        analyzeEvents();


        state.lastUpdate =
            new Date();


        setText(
            "lastUpdate",
            state.lastUpdate.toLocaleTimeString()
        );


        connectionStatus(true);


        logEvent(
            `${observations.length} real NASA observations received.`,
            "SUCCESS"
        );


    } catch (error) {

        console.error(error);


        connectionStatus(false);


        setText(
            "analysisStatus",
            "DATA ERROR"
        );


        setText(
            "analysisMessage",
            error.message
        );


        logEvent(
            error.message,
            "ERROR"
        );


        updateObservationTable();


    } finally {

        state.loading = false;

    }
}

function updateDashboard() {

    setText(
        "eventsDetected",
        state.observations.length.toLocaleString()
    );


    setText(
        "highPriorityEvents",
        state.highPriorityEvents.toLocaleString()
    );


    setText(
        "dataPoints",
        state.totalDataPoints.toLocaleString()
    );
}

function updateObservationTable() {

    const table =
        $("observationTableBody");

    if (!table) return;


    table.innerHTML = "";


    if (state.observations.length === 0) {

        table.innerHTML = `
            <tr>
                <td colspan="6">
                    No NASA observations available.
                </td>
            </tr>
        `;

        return;
    }


    state.observations
        .slice(0, 200)
        .forEach(item => {

            const row =
                document.createElement("tr");


            row.innerHTML = `

                <td>${item.region}</td>

                <td>
                    ${item.latitude.toFixed(4)}
                </td>

                <td>
                    ${item.longitude.toFixed(4)}
                </td>

                <td>
                    ${item.confidence}
                </td>

                <td>
                    ${item.satellite}
                </td>

                <td>
                    ${item.priority}
                </td>
            `;


            table.appendChild(row);
        });
}

function analyzeEvents() {

    const count =
        state.observations.length;

    if (count === 0) {

        setText(
            "analysisStatus",
            "NORMAL"
        );

        setText(
            "currentPriority",
            "NORMAL"
        );

        setText(
            "analysisMessage",
            "No fire detections were returned by NASA FIRMS for this dataset."
        );

        return;
    }


    if (state.highPriorityEvents > 0) {

        setText(
            "analysisStatus",
            "ALERT"
        );

        setText(
            "currentPriority",
            "HIGH"
        );

        setText(
            "analysisMessage",
            `${state.highPriorityEvents} high-priority fire detection(s) require monitoring.`
        );

    } else {

        setText(
            "analysisStatus",
            "MONITORING"
        );

        setText(
            "currentPriority",
            "MEDIUM"
        );

        setText(
            "analysisMessage",
            `${count} NASA fire detection(s) are being monitored.`
        );
    }
}

function setupSatelliteButtons() {

    const buttons =
        document.querySelectorAll(
            "[data-satellite]"
        );


    buttons.forEach(button => {

        button.addEventListener(
            "click",
            () => {

                buttons.forEach(
                    item =>
                        item.classList.remove("active")
                );


                button.classList.add("active");


                state.selectedSatellite =
                    button.dataset.satellite;


                logEvent(
                    `Selected ${state.selectedSatellite}.`,
                    "SYSTEM"
                );


                loadSatelliteData();
            }
        );
    });
}

function setupRefresh() {

    const button =
        $("refreshMapButton");


    if (!button) return;


    button.addEventListener(
        "click",
        () => {

            loadSatelliteData();
        }
    );
}

function setupModes() {

    const auto =
        $("autoModeButton");

    const manual =
        $("manualModeButton");


    if (auto) {

        auto.addEventListener(
            "click",
            () => {

                state.mode = "AUTO";

                auto.classList.add("active");

                if (manual) {
                    manual.classList.remove("active");
                }

                logEvent(
                    "AUTO mode enabled.",
                    "SYSTEM"
                );
            }
        );
    }


    if (manual) {

        manual.addEventListener(
            "click",
            () => {

                state.mode = "MANUAL";

                manual.classList.add("active");

                if (auto) {
                    auto.classList.remove("active");
                }

                logEvent(
                    "MANUAL mode enabled.",
                    "SYSTEM"
                );
            }
        );
    }
}

function setupLocation() {

    const button =
        $("locateButton");


    if (!button) return;


    button.addEventListener(
        "click",
        () => {

            if (!navigator.geolocation) {

                logEvent(
                    "Geolocation is not supported.",
                    "ERROR"
                );

                return;
            }


            navigator.geolocation.getCurrentPosition(
                position => {

                    const lat =
                        position.coords.latitude;

                    const lon =
                        position.coords.longitude;


                    if (state.map) {

                        state.map.setView(
                            [lat, lon],
                            8
                        );


                        L.marker(
                            [lat, lon]
                        )
                            .addTo(state.map)
                            .bindPopup(
                                "📍 Your location"
                            )
                            .openPopup();
                    }


                    logEvent(
                        "Map centered on your location.",
                        "SYSTEM"
                    );
                },

                () => {

                    logEvent(
                        "Location permission was not granted.",
                        "ERROR"
                    );
                }
            );
        }
    );
}

function setupClearLog() {

    const button =
        $("clearLogButton");


    if (!button) return;


    button.addEventListener(
        "click",
        () => {

            const log =
                $("eventLog");


            if (log) {
                log.innerHTML = "";
            }


            logEvent(
                "Event log cleared.",
                "SYSTEM"
            );
        }
    );
}

function setupSettings() {

    const open =
        $("settingsButton");

    const modal =
        $("settingsModal");

    const close =
        $("closeSettingsButton");

    const cancel =
        $("cancelSettingsButton");

    const save =
        $("saveSettingsButton");


    if (open && modal) {

        open.addEventListener(
            "click",
            () => {
                modal.classList.add("open");
            }
        );
    }


    if (close && modal) {

        close.addEventListener(
            "click",
            () => {
                modal.classList.remove("open");
            }
        );
    }


    if (cancel && modal) {

        cancel.addEventListener(
            "click",
            () => {
                modal.classList.remove("open");
            }
        );
    }


    if (save && modal) {

        save.addEventListener(
            "click",
            () => {

                const input =
                    $("refreshInterval");


                if (input) {

                    const seconds =
                        Number(input.value);


                    if (
                        Number.isFinite(seconds) &&
                        seconds >= 30
                    ) {

                        clearInterval(
                            state.refreshTimer
                        );


                        state.refreshTimer =
                            setInterval(
                                () => {

                                    if (
                                        state.mode === "AUTO"
                                    ) {
                                        loadSatelliteData();
                                    }

                                },
                                seconds * 1000
                            );
                    }
                }


                modal.classList.remove("open");


                logEvent(
                    "Settings saved.",
                    "SYSTEM"
                );
            }
        );
    }
}

function updateMissionClock() {

    const seconds =
        Math.floor(
            (Date.now() - state.missionStart) / 1000
        );


    const hours =
        Math.floor(seconds / 3600);


    const minutes =
        Math.floor(
            (seconds % 3600) / 60
        );


    const secs =
        seconds % 60;


    setText(
        "missionClock",

        `${String(hours).padStart(2, "0")}:` +
        `${String(minutes).padStart(2, "0")}:` +
        `${String(secs).padStart(2, "0")}`
    );


    setText(
        "systemUptime",
        `${seconds}s`
    );
}

function startRefresh() {

    clearInterval(
        state.refreshTimer
    );


    state.refreshTimer =
        setInterval(
            () => {

                if (
                    state.mode === "AUTO"
                ) {

                    loadSatelliteData();
                }

            },
            CONFIG.REFRESH_TIME
        );
}

function initializeMission() {

    initializeMap();

    setupSatelliteButtons();

    setupRefresh();

    setupModes();

    setupLocation();

    setupClearLog();

    setupSettings();

    connectionStatus(false);

    updateMissionClock();

    setInterval(
        updateMissionClock,
        1000
    );


    loadSatelliteData();

    startRefresh();


    logEvent(
        "Earth Rescue Mission initialized.",
        "SYSTEM"
    );
}

if (
    document.readyState === "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initializeMission
    );

} else {

    initializeMission();
}
