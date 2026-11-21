/* ============================================================
   RECIVERSE  —  Shared JS Utilities  (v2)
   ============================================================ */

const API = '';   // same-origin (express serves both)

// ── Token / session ──────────────────────────────────────────
const Auth = {
  // ── User ──
  setUser(token, data) {
    localStorage.setItem('rv_user_token', token);
    localStorage.setItem('rv_user_data',  JSON.stringify(data));
    // compatibility aliases used by some pages
    localStorage.setItem('reciverse_token', token);
    localStorage.setItem('reciverse_user',  JSON.stringify(data));
  },
  userToken() {
    return localStorage.getItem('rv_user_token') || localStorage.getItem('reciverse_token');
  },
  user() {
    const d = localStorage.getItem('rv_user_data') || localStorage.getItem('reciverse_user');
    try { return d ? JSON.parse(d) : null; } catch { return null; }
  },
  logoutUser() {
    ['rv_user_token','rv_user_data','reciverse_token','reciverse_user'].forEach(k => localStorage.removeItem(k));
    window.location.href = '/';
  },
  // alias used by some pages
  logout() { this.logoutUser(); },

  // ── Technician ──
  setTech(token, data) {
    localStorage.setItem('rv_tech_token', token);
    localStorage.setItem('rv_tech_data',  JSON.stringify(data));
    localStorage.setItem('reciverse_tech_token', token);
    localStorage.setItem('reciverse_tech',       JSON.stringify(data));
  },
  techToken() {
    return localStorage.getItem('rv_tech_token') || localStorage.getItem('reciverse_tech_token');
  },
  tech() {
    const d = localStorage.getItem('rv_tech_data') || localStorage.getItem('reciverse_tech');
    try { return d ? JSON.parse(d) : null; } catch { return null; }
  },
  logoutTech() {
    ['rv_tech_token','rv_tech_data','reciverse_tech_token','reciverse_tech'].forEach(k => localStorage.removeItem(k));
    window.location.href = '/';
  },

  // ── Guards ──
  requireUser() {
    if (!this.userToken()) { window.location.href = '/user-login.html'; return false; }
    return true;
  },
  requireTech() {
    if (!this.techToken()) { window.location.href = '/tech-login.html'; return false; }
    return true;
  }
};

// ── HTTP helpers ──────────────────────────────────────────────
async function POST(url, body, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + url, { method:'POST', headers:h, body:JSON.stringify(body) });
  return r.json();
}
async function GET(url, token) {
  const h = {};
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + url, { headers:h });
  return r.json();
}
async function PUT(url, body, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + url, { method:'PUT', headers:h, body:JSON.stringify(body||{}) });
  return r.json();
}
async function DEL(url, token) {
  const h = {};
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(API + url, { method:'DELETE', headers:h });
  return r.json();
}

// ── UI helpers ────────────────────────────────────────────────
function showAlert(el, msg, type='err') {
  if (!el) return;
  el.textContent = msg;
  el.className = 'alert alert-' + type + ' show';
}
function hideAlert(el) { if (el) el.className = 'alert'; }

function btnLoading(btn, yes) {
  if (yes) {
    btn._orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Please wait…';
    btn.disabled = true;
  } else {
    btn.innerHTML = btn._orig || 'Submit';
    btn.disabled = false;
  }
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', {
    day:'numeric', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

function statusBadge(status) {
  const map = {
    pending:            ['⏳','pending', 'Pending Match'],
    accepted:           ['🔧','accepted', 'In Progress'],
    pending_completion: ['🔔','pending', 'Awaiting Confirmation'],
    completed:          ['🏁','completed', 'Completed & Approved'],
    cancelled:          ['✗','cancelled', 'Cancelled']
  };
  const [icon, cls, txt] = map[status] || ['⏳','pending', status ? (status.charAt(0).toUpperCase() + status.slice(1)) : 'Unknown'];
  return `<span class="badge badge-${cls}">${icon} ${txt}</span>`;
}

function ratingHtml(r) {
  if (!r) return '<span class="text-muted" style="font-size:.8rem">No ratings yet</span>';
  return `<span class="rating">⭐ ${Number(r).toFixed(1)}</span>`;
}

function initials(name) {
  return (name||'?').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
}

function fmtLatency(ms) {
  if (!ms || ms <= 0) return 'Fast ⚡';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '< 1 min ⚡';
  if (mins < 60) return `~${mins} min`;
  return `${Math.round(mins/60)} hr`;
}

// Render interactive star rating HTML (read-only display)
function renderStars(rating, max=5) {
  let html = '';
  for (let i=1; i<=max; i++) {
    if (i <= Math.floor(rating)) html += '<span style="color:#fbbf24">★</span>';
    else if (i - 0.5 <= rating) html += '<span style="color:#fbbf24">½</span>';
    else html += '<span style="color:var(--border)">★</span>';
  }
  return html;
}

function skillTagsHtml(skills) {
  return (skills||[]).map(s =>
    `<span class="skill-tag">${s}</span>`
  ).join('');
}

// ── Product categories ────────────────────────────────────────
const PRODUCTS = [
  'Washing Machine','Refrigerator','Air Conditioner',
  'Television','Laptop/Computer','Mobile Phone',
  'Microwave','Water Purifier','Geyser/Water Heater',
  'Fan/Motor','Vehicle (2-Wheeler)','Vehicle (4-Wheeler)',
  'Printer/Scanner','CCTV/Security System','Inverter/UPS','Other Appliance'
];

// ── Nav helpers ───────────────────────────────────────────────
function renderUserNav(name) {
  const nav = document.getElementById('nav-user-area');
  if (!nav) return;
  if (name) {
    nav.innerHTML = `
      <a href="/user-profile.html" style="font-size:.85rem;color:var(--light);padding:6px 10px">👤 ${name}</a>
      <button class="btn btn-ghost btn-sm" onclick="Auth.logoutUser()">Logout</button>`;
  } else {
    nav.innerHTML = `
      <a class="btn btn-outline btn-sm" href="/user-login.html">Login</a>
      <a class="btn btn-primary btn-sm" href="/user-signup.html">Sign Up</a>`;
  }
}
function renderTechNav(name) {
  const nav = document.getElementById('nav-tech-area');
  if (!nav) return;
  if (name) {
    nav.innerHTML = `
      <a href="/tech-profile.html" style="font-size:.85rem;color:var(--light);padding:6px 10px">🔧 ${name}</a>
      <button class="btn btn-ghost btn-sm" onclick="Auth.logoutTech()">Logout</button>`;
  } else {
    nav.innerHTML = `
      <a class="btn btn-outline btn-sm" href="/tech-login.html">Tech Login</a>
      <a class="btn btn-orange btn-sm" href="/tech-register.html">Join as Tech</a>`;
  }
}
