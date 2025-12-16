// Force mobile GPS accuracy
const geoOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
};// ==========================
// DOM REFERENCES (MOBILE SAFE)
// ==========================
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const status = document.getElementById("status");

const fromInput = document.getElementById("fromInput");
const toInput = document.getElementById("toInput");
const distanceBtn = document.getElementById("distanceBtn");
const distanceResult = document.getElementById("distanceResult");

// ==========================
// MAP INITIALIZATION
// ==========================
const map = L.map('map').setView([0, 0], 2);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// ==========================
// STATE
// ==========================
let searchMarker = null;
let userMarker = null;
let userAccuracyCircle = null;
let routeLine = null;
let arrowMarker = null;

let debounceTimer;
let controller;
const cache = new Map();
let userLocation = null;

// ==========================
// SEARCH
// ==========================
searchBtn.addEventListener("click", triggerSearch);
searchInput.addEventListener("keypress", e => {
    if (e.key === "Enter") triggerSearch();
});

function triggerSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(searchPlace, 300);
}

function searchPlace() {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) return showStatus("Please enter a place.");

    if (cache.has(query)) {
        const c = cache.get(query);
        showLocation(c.lat, c.lon, c.name);
        addRadarPulse(c.lat, c.lon);
        return;
    }

    if (controller) controller.abort();
    controller = new AbortController();

    showStatus("Searching…");

    fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
        { signal: controller.signal }
    )
        .then(r => r.json())
        .then(d => {
            if (!d.length) return showStatus("No match found.");

            const r = { lat: +d[0].lat, lon: +d[0].lon, name: d[0].display_name };
            cache.set(query, r);
            showLocation(r.lat, r.lon, r.name);
            addRadarPulse(r.lat, r.lon);
        })
        .catch(e => e.name !== "AbortError" && showStatus("Network error"));
}

function showLocation(lat, lon, name) {
    showStatus("");

    if (searchMarker) map.removeLayer(searchMarker);

    map.flyTo([lat, lon], 14, { animate: true });

    searchMarker = L.marker([lat, lon], {
        icon: L.divIcon({ className: "glow-marker" })
    }).addTo(map).bindPopup(name).openPopup();
}

function showStatus(msg) {
    status.textContent = msg;
}

// ==========================
// DISTANCE & ROUTING
// ==========================
distanceBtn.addEventListener("click", calculateDistanceAndDirection);

function calculateDistanceAndDirection() {
    const from = fromInput.value.trim();
    const to = toInput.value.trim();

    if (!from || !to) {
        distanceResult.textContent = "Enter both locations.";
        return;
    }

    Promise.all([resolveLocation(from), resolveLocation(to)])
        .then(([a, b]) => {
            if (!a || !b) return distanceResult.textContent = "Location not found.";

            return getRouteOSRM(a, b);
        })
        .then(route => {
            if (!route) return;

            if (routeLine) map.removeLayer(routeLine);
            if (arrowMarker) map.removeLayer(arrowMarker);

            routeLine = L.polyline(route.coords, {
                color: "#00bfff",
                weight: 4,
                className: "animated-line"
            }).addTo(map);

            map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });

            animateArrowAlongRoute(route.coords);

            distanceResult.textContent =
                `Road distance: ${(route.distance / 1000).toFixed(2)} km`;
        });
}

// ==========================
// LOCATION RESOLUTION
// ==========================
function resolveLocation(q) {
    if (q.toLowerCase() === "my location" && userLocation) {
        return Promise.resolve(userLocation);
    }
    return geocode(q);
}

// ==========================
// GPS (MOBILE HARDENED)
// ==========================
function locateUser() {
    if (!navigator.geolocation) {
        alert("Geolocation not supported");
        return;
    }

    navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            map.setView([lat, lng], 16);

            if (!marker) {
                marker = L.marker([lat, lng]).addTo(map);
            } else {
                marker.setLatLng([lat, lng]);
            }

            document.getElementById("status").innerText =
                `📍 Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        },
        (error) => {
            document.getElementById("status").innerText =
                "Waiting for GPS signal...";
        },
        geoOptions
    );
}

function handleLocation(pos) {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    userLocation = { lat, lon };

    if (userMarker) map.removeLayer(userMarker);
    if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

    map.setView([lat, lon], 16);

    userMarker = L.marker([lat, lon], {
        icon: L.divIcon({ className: "glow-marker" })
    }).addTo(map).bindPopup("📍 You are here");

    userAccuracyCircle = L.circle([lat, lon], {
        radius: accuracy,
        color: "#00bfff",
        fillOpacity: 0.15
    }).addTo(map);

    fromInput.value = "My Location";
}

// ==========================
// ROUTING
// ==========================
function getRouteOSRM(a, b) {
    return fetch(
        `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson`
    )
        .then(r => r.json())
        .then(d => d.code === "Ok" && ({
            coords: d.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
            distance: d.routes[0].distance
        }));
}

// ==========================
// HELPERS
// ==========================
function addRadarPulse(lat, lon) {
    const r = L.circle([lat, lon], {
        radius: 60,
        color: "#00bfff",
        fillOpacity: 0.2
    }).addTo(map);
    setTimeout(() => map.removeLayer(r), 2000);
}

function animateArrowAlongRoute(coords) {
    let i = 0;
    arrowMarker = L.marker(coords[0], {
        icon: L.divIcon({ className: "arrow-icon" })
    }).addTo(map);

    (function move() {
        arrowMarker.setLatLng(coords[i]);
        i = (i + 1) % coords.length;
        requestAnimationFrame(move);
    })();
}

function geocode(q) {
    return fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`
    ).then(r => r.json()).then(d =>
        d.length ? { lat: +d[0].lat, lon: +d[0].lon } : null
    );
}

// ==========================
// START
// ==========================
window.addEventListener("load", locateUser);