/* ======================================================
   ISS MISSION CONTROL - Single Window WebOS App
   ====================================================== */

const UPDATE_INTERVAL_MS = 2000;
const ASTRO_REFRESH_MS = 60000;
const EARTH_RADIUS_KM = 6371;

let map, issMarker, pathLine, pathCoords = [];
let totalDistanceKm = 0;
let lastFix = null;
let animFrameId = null;
let followMap = true;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(`view-${viewId}`);
  if (view) view.classList.add('active');
  
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === viewId);
  });
  
  if (viewId === 'tracker' && map) {
    setTimeout(() => map.invalidateSize(), 100);
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.tab);
  });
});

document.addEventListener('keydown', (e) => {
  const views = ['tracker', 'live', 'telecast', 'about', 'crew'];
  views.forEach((view, i) => {
    if (e.ctrlKey && e.key === String(i + 1)) {
      e.preventDefault();
      switchView(view);
    }
  });
});

// ── Window controls ──
function minimizeWindow() {
  const win = document.getElementById('main-window');
  win.style.transform = 'translate(-50%, -50%) scale(0.95)';
  win.style.opacity = '0';
  setTimeout(() => {
    win.style.display = 'none';
    win.style.transform = 'translate(-50%, -50%) scale(1)';
    win.style.opacity = '1';
  }, 200);
}

function maximizeWindow() {
  const win = document.getElementById('main-window');
  const isMaximized = win.dataset.maximized === 'true';
  if (isMaximized) {
    win.style.width = '92vw';
    win.style.height = '88vh';
    win.style.maxWidth = '1200px';
    win.style.maxHeight = '800px';
    win.style.borderRadius = '14px';
    win.dataset.maximized = 'false';
  } else {
    win.style.width = '100vw';
    win.style.height = '100vh';
    win.style.maxWidth = 'none';
    win.style.maxHeight = 'none';
    win.style.borderRadius = '0';
    win.dataset.maximized = 'true';
  }
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);
}

function closeWindow() {
  const win = document.getElementById('main-window');
  win.style.transform = 'translate(-50%, -50%) scale(0.8)';
  win.style.opacity = '0';
  setTimeout(() => {
    win.style.display = 'none';
  }, 300);
}

// ── Clock ──
function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  document.getElementById('sidebar-clock').textContent = time;
}
setInterval(updateClock, 1000);
updateClock();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ISS TRACKER LOGIC
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function initMap() {
  map = L.map('map', {
    worldCopyJump: true,
    zoomControl: true,
    attributionControl: true,
  }).setView([20, 0], 3);

  map.on('dragstart zoomstart', () => {
    followMap = false;
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  const icon = L.divIcon({
    className: '',
    html: '<div class="iss-marker"><div class="ring"></div><div class="dot"></div></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

  issMarker = L.marker([0, 0], { icon }).addTo(map);
  pathLine = L.polyline([], {
    color: '#4fd8e8',
    weight: 2,
    opacity: 0.6,
    dashArray: '6, 8',
  }).addTo(map);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmt(num, decimals = 2) {
  if (num === null || num === undefined || Number.isNaN(num)) return '—';
  return Number(num).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function animateMarkerTo(fromLat, fromLon, toLat, toLon, duration) {
  if (animFrameId) cancelAnimationFrame(animFrameId);
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
    if (t < 1) animFrameId = requestAnimationFrame(step);
  }
  animFrameId = requestAnimationFrame(step);
}

function setLiveState(isLive) {
  const badge = document.getElementById('status-badge');
  if (badge) {
    badge.textContent = isLive ? '● LIVE' : '● OFFLINE';
    badge.className = 'status-badge' + (isLive ? '' : ' offline');
  }
}

async function fetchFromWhereTheISS() {
  const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
  if (!res.ok) throw new Error('wheretheiss.at error');
  const d = await res.json();
  return {
    lat: parseFloat(d.latitude),
    lon: parseFloat(d.longitude),
    altitudeKm: parseFloat(d.altitude),
    velocityKmh: parseFloat(d.velocity),
    t: d.timestamp * 1000,
  };
}

async function fetchFromOpenNotify() {
  const res = await fetch('https://api.open-notify.org/iss-now.json');
  if (!res.ok) throw new Error('open-notify error');
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
  try {
    return await fetchFromWhereTheISS();
  } catch {
    return await fetchFromOpenNotify();
  }
}

async function fetchAstronauts() {
  try {
    const res = await fetch('https://api.open-notify.org/astros.json');
    if (!res.ok) throw new Error('astros error');
    const d = await res.json();
    const count = d.number || 0;
    const people = d.people || [];

    // Update tracker window - astronaut count
    const countEl = document.getElementById('astronaut-count');
    if (countEl) countEl.textContent = count;
    
    // Update tracker window - astronaut list (names only)
    const list = document.getElementById('astronaut-list');
    if (list) {
      if (people.length > 0) {
        list.innerHTML = people.map(p =>
          `<span class="astronaut-badge">👨‍🚀 ${p.name}</span>`
        ).join('');
      } else {
        list.innerHTML = '<span class="astronaut-badge" style="color:var(--text-faint);">No data available</span>';
      }
    }

    // Update crew window - detailed roster with craft
    const crewCount = document.getElementById('crew-count');
    if (crewCount) crewCount.textContent = count;
    
    const crewList = document.getElementById('crew-roster');
    if (crewList) {
      if (people.length > 0) {
        // Get craft color class
        const getCraftClass = (craft) => {
          const craftLower = craft.toLowerCase();
          if (craftLower.includes('iss')) return 'iss';
          if (craftLower.includes('spacex') || craftLower.includes('dragon')) return 'spacex';
          if (craftLower.includes('soyuz')) return 'soyuz';
          if (craftLower.includes('boeing') || craftLower.includes('starliner')) return 'boeing';
          return 'default';
        };

        crewList.innerHTML = people.map(p => {
          const craftClass = getCraftClass(p.craft);
          return `
            <div class="crew-entry">
              <span class="crew-name">
                <span class="crew-emoji-small">👨‍🚀</span>
                ${p.name}
              </span>
              <span class="crew-craft-badge ${craftClass}">${p.craft}</span>
            </div>
          `;
        }).join('');
      } else {
        crewList.innerHTML = `
          <div class="crew-empty">
            <span style="font-size:32px;display:block;margin-bottom:8px;">🚀</span>
            No astronauts currently in orbit
          </div>
        `;
      }
    }

    return d;
  } catch (err) {
    console.error('Failed to fetch astronauts:', err);
    
    const crewList = document.getElementById('crew-roster');
    if (crewList) {
      crewList.innerHTML = `
        <div class="crew-empty">
          <span style="font-size:32px;display:block;margin-bottom:8px;">⚠️</span>
          Failed to load crew data<br>
          <span style="font-size:11px;color:var(--text-faint);">Retrying in 60 seconds...</span>
        </div>
      `;
    }
    return null;
  }
}

async function updatePosition() {
  try {
    const fix = await fetchIssPosition();
    setLiveState(true);

    if (lastFix) {
      animateMarkerTo(lastFix.lat, lastFix.lon, fix.lat, fix.lon, UPDATE_INTERVAL_MS);
    } else {
      issMarker.setLatLng([fix.lat, fix.lon]);
      map.setView([fix.lat, fix.lon], 3);
    }

    pathCoords.push([fix.lat, fix.lon]);
    if (pathCoords.length > 150) pathCoords.shift();
    pathLine.setLatLngs(pathCoords);

    let speedKmh = fix.velocityKmh;
    if (lastFix) {
      const segmentKm = haversineKm(lastFix.lat, lastFix.lon, fix.lat, fix.lon);
      totalDistanceKm += segmentKm;
      if (!speedKmh) {
        const hours = (fix.t - lastFix.t) / 3600000;
        if (hours > 0) speedKmh = segmentKm / hours;
      }
    }
    lastFix = fix;

    document.getElementById('val-lat').textContent = `${fmt(fix.lat, 4)}°`;
    document.getElementById('val-lon').textContent = `${fmt(fix.lon, 4)}°`;
    document.getElementById('val-alt').textContent = fix.altitudeKm !== null ? fmt(fix.altitudeKm, 1) : '~408.0';
    document.getElementById('val-speed').textContent = speedKmh ? fmt(speedKmh, 0) : '—';
    document.getElementById('val-distance').textContent = fmt(totalDistanceKm, 1);

    document.getElementById('live-lat').textContent = `${fmt(fix.lat, 4)}°`;
    document.getElementById('live-lng').textContent = `${fmt(fix.lon, 4)}°`;
    document.getElementById('live-alt').textContent = fix.altitudeKm !== null ? fmt(fix.altitudeKm, 1) + ' km' : '~408 km';
    document.getElementById('live-speed').textContent = speedKmh ? fmt(speedKmh, 0) + ' km/h' : '—';

    document.getElementById('tele-lat').textContent = `${fmt(fix.lat, 4)}°`;
    document.getElementById('tele-lon').textContent = `${fmt(fix.lon, 4)}°`;
    document.getElementById('tele-alt').textContent = fix.altitudeKm !== null ? fmt(fix.altitudeKm, 1) + ' km' : '~408 km';

  } catch (err) {
    setLiveState(false);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TELECAST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function switchTelecast(source) {
  const iframe = document.getElementById('telecast-iframe');
  if (!iframe) return;
  
  const streams = {
    nasa: 'https://www.youtube.com/embed/21X5lGlDOfg?autoplay=1&rel=0',
    spacex: 'https://www.youtube.com/embed/21X5lGlDOfg?autoplay=1&rel=0',
    iss: 'https://www.youtube.com/embed/21X5lGlDOfg?autoplay=1&rel=0'
  };
  
  iframe.src = streams[source] || streams.nasa;
  
  document.querySelectorAll('.telecast-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.stream === source);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

document.getElementById('about-date').textContent =
  'Launched: ' + new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

setTimeout(() => {
  initMap();
  setTimeout(() => map.invalidateSize(), 300);
}, 300);

updatePosition();
fetchAstronauts();
setInterval(updatePosition, UPDATE_INTERVAL_MS);
setInterval(fetchAstronauts, ASTRO_REFRESH_MS);

window.switchTelecast = switchTelecast;
window.switchView = switchView;
window.minimizeWindow = minimizeWindow;
window.maximizeWindow = maximizeWindow;
window.closeWindow = closeWindow;

console.log('🛰️ ISS Mission Control loaded!');
console.log('📋 Shortcuts: Ctrl+1 (Tracker), Ctrl+2 (Live), Ctrl+3 (Telecast), Ctrl+4 (About), Ctrl+5 (Crew)');
