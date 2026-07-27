// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DOCK: OPEN WINDOW WITH ANIMATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function openWindow(type) {
  const win = document.getElementById(`win-${type}`);
  if (!win) return;
  
  // If already open, bring to front
  if (win.classList.contains('active')) {
    win.style.zIndex = 9999;
    return;
  }
  
  // Remove closing class if any
  win.classList.remove('closing');
  
  // Set position (cascade)
  const baseLeft = 60 + Math.random() * 80;
  const baseTop = 60 + Math.random() * 80;
  win.style.left = baseLeft + 'px';
  win.style.top = baseTop + 'px';
  
  // Show with animation
  win.style.display = 'flex';
  win.style.zIndex = 9999;
  win.classList.add('active');
  
  // Re-trigger animation
  win.style.animation = 'none';
  requestAnimationFrame(() => {
    win.style.animation = 'windowOpen 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DRAGGABLE WINDOWS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

document.querySelectorAll('.window').forEach(win => {
  const titleBar = win.querySelector('.window-titlebar');
  if (!titleBar) return;
  let isDragging = false, offsetX, offsetY;

  titleBar.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - win.offsetLeft;
    offsetY = e.clientY - win.offsetTop;
    win.style.zIndex = 9999;
    win.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    x = Math.max(0, Math.min(x, window.innerWidth - win.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - win.offsetHeight));
    win.style.left = x + 'px';
    win.style.top = y + 'px';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    win.style.cursor = 'default';
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WINDOW CONTROLS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function minimizeWindow(id) {
  const win = document.getElementById(id);
  if (win) {
    win.classList.add('minimized');
    win.classList.remove('active');
  }
}

function maximizeWindow(id) {
  const win = document.getElementById(id);
  if (!win) return;
  const isMax = win.dataset.maximized === 'true';
  if (isMax) {
    win.style.width = win.dataset.oldWidth || '720px';
    win.style.height = win.dataset.oldHeight || '520px';
    win.style.top = win.dataset.oldTop || '60px';
    win.style.left = win.dataset.oldLeft || '60px';
    win.dataset.maximized = 'false';
  } else {
    win.dataset.oldWidth = win.style.width;
    win.dataset.oldHeight = win.style.height;
    win.dataset.oldTop = win.style.top;
    win.dataset.oldLeft = win.style.left;
    win.style.width = '100vw';
    win.style.height = '100vh';
    win.style.top = '0';
    win.style.left = '0';
    win.dataset.maximized = 'true';
  }
  setTimeout(() => { if (window.map) map.invalidateSize(); }, 200);
}

function closeWindow(id) {
  const win = document.getElementById(id);
  if (!win) return;
  win.classList.add('closing');
  setTimeout(() => {
    win.classList.remove('active', 'closing');
    win.style.display = 'none';
  }, 300);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ISS TRACKER (SAME AS BEFORE)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const UPDATE_INTERVAL_MS = 2000;
const ASTRO_REFRESH_MS = 60000;
const EARTH_RADIUS_KM = 6371;

let map, issMarker, pathLine, pathCoords = [];
let totalDistanceKm = 0;
let lastFix = null;
let animFrameId = null;
let followMap = true;

function initMap() {
  map = L.map('map', { worldCopyJump: true, zoomControl: true, attributionControl: true }).setView([20,0],3);
  map.on('dragstart zoomstart', () => { followMap = false; });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);
  const icon = L.divIcon({
    className: '',
    html: '<div class="iss-marker"><div class="ring"></div><div class="dot"></div></div>',
    iconSize: [22,22], iconAnchor: [11,11],
  });
  issMarker = L.marker([0,0], { icon }).addTo(map);
  pathLine = L.polyline([], { color: '#4fd8e8', weight: 2, opacity: 0.6, dashArray: '6,8' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 400);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function fmt(num, d=2) {
  if (num===null || num===undefined || isNaN(num)) return '—';
  return Number(num).toLocaleString(undefined, { minimumFractionDigits:d, maximumFractionDigits:d });
}

function animateMarkerTo(fromLat, fromLon, toLat, toLon, duration) {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  let adjToLon = toLon;
  const lonDiff = toLon - fromLon;
  if (lonDiff > 180) adjToLon -= 360;
  if (lonDiff < -180) adjToLon += 360;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now-start)/duration, 1);
    const lat = fromLat + (toLat-fromLat)*t;
    const lon = fromLon + (adjToLon-fromLon)*t;
    issMarker.setLatLng([lat, lon]);
    if (followMap) map.panTo([lat, lon], { animate: false });
    if (t < 1) animFrameId = requestAnimationFrame(step);
  }
  animFrameId = requestAnimationFrame(step);
}

async function fetchFromWhereTheISS() {
  const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
  if (!res.ok) throw new Error();
  const d = await res.json();
  return { lat: parseFloat(d.latitude), lon: parseFloat(d.longitude), altitudeKm: parseFloat(d.altitude), velocityKmh: parseFloat(d.velocity), t: d.timestamp*1000 };
}
async function fetchFromOpenNotify() {
  const res = await fetch('https://api.open-notify.org/iss-now.json');
  if (!res.ok) throw new Error();
  const d = await res.json();
  return { lat: parseFloat(d.iss_position.latitude), lon: parseFloat(d.iss_position.longitude), altitudeKm: null, velocityKmh: null, t: d.timestamp*1000 };
}
async function fetchIssPosition() {
  try { return await fetchFromWhereTheISS(); } catch { return await fetchFromOpenNotify(); }
}

async function fetchAstronauts() {
  try {
    const res = await fetch('https://api.open-notify.org/astros.json');
    if (!res.ok) throw new Error();
    const d = await res.json();
    const count = d.number || 0;
    const people = d.people || [];
    document.getElementById('astronaut-count').textContent = count;
    document.getElementById('crew-count').textContent = count;
    const list = document.getElementById('astronaut-list');
    if (list) {
      list.innerHTML = people.length ? people.map(p => `<span class="astronaut-badge">👨‍🚀 ${p.name}</span>`).join('') : '<span style="color:#4b5866;font-size:10px;">No data</span>';
    }
    const roster = document.getElementById('crew-roster');
    if (roster) {
      roster.innerHTML = people.length ? people.map(p =>
        `<div class="crew-entry"><span class="crew-name">👨‍🚀 ${p.name}</span><span style="font-size:9px;color:#4b5866;">${p.craft}</span></div>`
      ).join('') : '<div style="color:#4b5866;text-align:center;padding:12px;">No data</div>';
    }
    return d;
  } catch {
    document.getElementById('astronaut-count').textContent = '⚠️';
    document.getElementById('crew-count').textContent = '⚠️';
  }
}

async function updatePosition() {
  try {
    const fix = await fetchIssPosition();
    if (lastFix) animateMarkerTo(lastFix.lat, lastFix.lon, fix.lat, fix.lon, UPDATE_INTERVAL_MS);
    else { issMarker.setLatLng([fix.lat, fix.lon]); map.setView([fix.lat, fix.lon], 3); }
    pathCoords.push([fix.lat, fix.lon]);
    if (pathCoords.length > 150) pathCoords.shift();
    pathLine.setLatLngs(pathCoords);
    let speedKmh = fix.velocityKmh;
    if (lastFix) {
      const seg = haversineKm(lastFix.lat, lastFix.lon, fix.lat, fix.lon);
      totalDistanceKm += seg;
      if (!speedKmh) { const hours = (fix.t - lastFix.t)/3600000; if (hours>0) speedKmh = seg/hours; }
    }
    lastFix = fix;
    document.getElementById('val-lat').textContent = fmt(fix.lat,4)+'°';
    document.getElementById('val-lon').textContent = fmt(fix.lon,4)+'°';
    document.getElementById('val-alt').textContent = fix.altitudeKm!==null ? fmt(fix.altitudeKm,1) : '~408.0';
    document.getElementById('val-speed').textContent = speedKmh ? fmt(speedKmh,0) : '—';
    document.getElementById('val-distance').textContent = fmt(totalDistanceKm,1);
  } catch {}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

setTimeout(initMap, 300);
updatePosition();
fetchAstronauts();
setInterval(updatePosition, UPDATE_INTERVAL_MS);
setInterval(fetchAstronauts, ASTRO_REFRESH_MS);

// Expose functions globally
window.openWindow = openWindow;
window.minimizeWindow = minimizeWindow;
window.maximizeWindow = maximizeWindow;
window.closeWindow = closeWindow;
