/* ======================================================
   ISS MISSION CONTROL
   Live position, path trail, distance, speed, crew count
   ====================================================== */

const UPDATE_INTERVAL_MS = 2000;
const ASTRO_REFRESH_MS = 60000;
const EARTH_RADIUS_KM = 6371;

let map, issMarker, pathLine, pathCoords = [];
let totalDistanceKm = 0;
let lastFix = null; // { lat, lon, t } of previous successful update
let staleTicks = 0;
let animFrameId = null;
let followMap = true;

/* ---------- Map setup ---------- */
function initMap() {
  map = L.map('map', {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  }).setView([20, 0], 4);

  // If the person manually drags/zooms, stop auto-following so we don't fight them
  map.on('dragstart zoomstart', (e) => {
    if (e.originalEvent) {
      followMap = false;
      const btn = document.getElementById('follow-btn');
      if (btn) {
        btn.classList.add('off');
        btn.textContent = '⌖ Follow ISS';
      }
    }
  });

  // Dark, label-free tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  const icon = L.divIcon({
    className: '',
    html: '<div class="iss-marker"><div class="ring"></div><div class="dot"></div></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  issMarker = L.marker([0, 0], { icon }).addTo(map);

  pathLine = L.polyline([], {
    color: '#4fd8e8',
    weight: 2,
    opacity: 0.8,
    dashArray: '6, 8',
  }).addTo(map);
}

/* ---------- Helpers ---------- */
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function fmt(num, decimals = 2) {
  if (num === null || num === undefined || Number.isNaN(num)) return '—';
  return Number(num).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function setStatus(msg) {
  document.getElementById('status-line').textContent = msg;
}

// Smoothly glide the marker (and optionally the map view) from one fix to the
// next over `duration` ms, instead of jumping straight to the new point.
function animateMarkerTo(fromLat, fromLon, toLat, toLon, duration) {
  if (animFrameId) cancelAnimationFrame(animFrameId);

  // Handle the antimeridian (±180°) so the marker doesn't fly across the whole map
  let adjToLon = toLon;
  const lonDiff = toLon - fromLon;
  if (lonDiff > 180) adjToLon -= 360;
  if (lonDiff < -180) adjToLon += 360;

  const start = performance.now();

  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const lat = fromLat + (toLat - fromLat) * t;
    const lon = fromLon + (adjToLon - fromLon) * t;

    issMarker.setLatLng([lat, lon]);
    if (followMap) map.panTo([lat, lon], { animate: false });

    if (t < 1) {
      animFrameId = requestAnimationFrame(step);
    }
  }

  animFrameId = requestAnimationFrame(step);
}

function setLiveState(isLive) {
  const pill = document.getElementById('live-pill');
  pill.classList.toggle('stale', !isLive);
  pill.innerHTML = isLive
    ? '<span class="live-dot"></span>LIVE'
    : '<span class="live-dot"></span>RETRYING';
}

/* ---------- Clock ---------- */
function tickClock() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  document.getElementById('clock').innerHTML =
    `${hh}:${mm}:${ss}<span class="clock-zone">UTC</span>`;
}

/* ---------- Position fetchers (with fallback chain) ---------- */
// Primary: wheretheiss.at — https, CORS-enabled, gives lat/lon/altitude/velocity directly
async function fetchFromWhereTheISS() {
  const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
  if (!res.ok) throw new Error('wheretheiss.at bad status');
  const d = await res.json();
  return {
    lat: parseFloat(d.latitude),
    lon: parseFloat(d.longitude),
    altitudeKm: parseFloat(d.altitude),
    velocityKmh: parseFloat(d.velocity),
    t: d.timestamp * 1000,
  };
}

// Fallback: open-notify — lat/lon only, no altitude/velocity
async function fetchFromOpenNotify() {
  const res = await fetch('https://api.open-notify.org/iss-now.json');
  if (!res.ok) throw new Error('open-notify bad status');
  const d = await res.json();
  return {
    lat: parseFloat(d.iss_position.latitude),
    lon: parseFloat(d.iss_position.longitude),
    altitudeKm: null,
    velocityKmh: null,
    t: d.timestamp * 1000,
  };
}

async function fetchIssPosition() {
  const attempts = [fetchFromWhereTheISS, fetchFromOpenNotify];
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All position sources failed');
}

/* ---------- Astronaut count ---------- */
async function fetchAstronauts() {
  try {
    const res = await fetch('https://api.open-notify.org/astros.json');
    if (!res.ok) throw new Error('astros bad status');
    const d = await res.json();
    document.getElementById('val-crew').textContent = d.number ?? '—';
    const craftCounts = {};
    (d.people || []).forEach(p => {
      craftCounts[p.craft] = (craftCounts[p.craft] || 0) + 1;
    });
    const summary = Object.entries(craftCounts)
      .map(([craft, n]) => `${n} on ${craft}`)
      .join(' · ');
    document.getElementById('crew-craft').textContent = summary || 'astronauts';

    // About tab: crew count + plain-text roster
    document.getElementById('about-crew').textContent = d.number ?? '—';
    const listEl = document.getElementById('about-crew-list');
    if (d.people && d.people.length) {
      const names = d.people
        .map(p => `<span class="crew-name">${p.name}</span> (${p.craft})`)
        .join(', ');
      listEl.innerHTML = `${d.number} people are currently in orbit: ${names}.`;
    } else {
      listEl.textContent = 'Crew roster unavailable right now.';
    }
  } catch (err) {
    // keep last known value silently
  }
}

/* ---------- Main update loop ---------- */
async function updatePosition() {
  try {
    const fix = await fetchIssPosition();
    staleTicks = 0;
    setLiveState(true);
    setStatus('Tracking feed nominal.');

    // Glide smoothly from the last known point to the new one, rather than
    // snapping — this is what makes the motion visible and continuous.
    if (lastFix) {
      animateMarkerTo(lastFix.lat, lastFix.lon, fix.lat, fix.lon, UPDATE_INTERVAL_MS);
    } else {
      issMarker.setLatLng([fix.lat, fix.lon]);
      map.setView([fix.lat, fix.lon], 4);
    }

    // Path trail
    pathCoords.push([fix.lat, fix.lon]);
    pathLine.setLatLngs(pathCoords);

    // Distance + speed from consecutive fixes
    let speedKmh = fix.velocityKmh;
    if (lastFix) {
      const segmentKm = haversineKm(lastFix.lat, lastFix.lon, fix.lat, fix.lon);
      totalDistanceKm += segmentKm;

      if (speedKmh === null || speedKmh === undefined || Number.isNaN(speedKmh)) {
        const hours = (fix.t - lastFix.t) / 3600000;
        if (hours > 0) speedKmh = segmentKm / hours;
      }
    }
    lastFix = fix;

    // Render telemetry
    document.getElementById('val-lat').textContent = `${fmt(fix.lat, 4)}°`;
    document.getElementById('val-lon').textContent = `${fmt(fix.lon, 4)}°`;
    document.getElementById('val-alt').textContent =
      fix.altitudeKm !== null ? fmt(fix.altitudeKm, 1) : '~408.0';
    document.getElementById('val-speed').textContent =
      speedKmh !== undefined && speedKmh !== null ? fmt(speedKmh, 0) : '—';
    document.getElementById('val-distance').textContent = fmt(totalDistanceKm, 1);

    // Mirror the live numbers into the About tab's stat cards
    if (fix.altitudeKm !== null) {
      document.getElementById('about-alt').textContent = `~${fmt(fix.altitudeKm, 0)}`;
    }
    if (speedKmh) {
      document.getElementById('about-speed').textContent = fmt(speedKmh, 0);
    }
  } catch (err) {
    staleTicks += 1;
    setLiveState(false);
    setStatus('Signal lost — retrying tracking feed…');
  }
}

/* ---------- Refresh button ---------- */
function wireRefreshButton() {
  const btn = document.getElementById('refresh-btn');
  btn.addEventListener('click', async () => {
    btn.classList.add('spinning');
    await Promise.all([updatePosition(), fetchAstronauts()]);
    setTimeout(() => btn.classList.remove('spinning'), 400);
  });
}

/* ---------- Follow toggle ---------- */
function wireFollowButton() {
  const btn = document.getElementById('follow-btn');
  const render = () => {
    btn.classList.toggle('off', !followMap);
    btn.textContent = followMap ? '⌖ Following' : '⌖ Follow ISS';
  };
  render();
  btn.addEventListener('click', () => {
    followMap = !followMap;
    if (followMap && lastFix) map.panTo([lastFix.lat, lastFix.lon]);
    render();
  });
}

/* ---------- Tabs ---------- */
function wireTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const trackerView = document.getElementById('view-tracker');
  const aboutView = document.getElementById('view-about');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const showAbout = btn.dataset.tab === 'about';
      trackerView.hidden = showAbout;
      aboutView.hidden = !showAbout;
      // Leaflet needs a nudge when its container was hidden and becomes visible again
      if (!showAbout) setTimeout(() => map.invalidateSize(), 50);
    });
  });
}

/* ---------- Boot ---------- */
function boot() {
  initMap();
  wireRefreshButton();
  wireFollowButton();
  wireTabs();
  tickClock();
  setInterval(tickClock, 1000);

  setStatus('Connecting to tracking network…');
  updatePosition();
  fetchAstronauts();

  setInterval(updatePosition, UPDATE_INTERVAL_MS);
  setInterval(fetchAstronauts, ASTRO_REFRESH_MS);
}

document.addEventListener('DOMContentLoaded', boot);
