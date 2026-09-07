import { THREE, makeRenderer, basicScene } from './engine.js';
import { HostNet } from './net.js';
import { GAMES, EMOJI, byId } from './games/index.js';

const $ = (s) => document.querySelector(s);
const ui = $('#ui');
const landing = $('#landing');
const stage = $('#stage');

/* ---------- landing game grid ---------- */
const grid = $('#gameGrid');
for (const g of GAMES) {
  const m = g.meta;
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `
    <div class="thumb" style="background:linear-gradient(135deg,${m.color}33,#0d1428)">
      ${EMOJI[m.id]}<div class="pl">${m.min}-${m.max} graczy</div>
    </div>
    <div class="body"><h3>${m.title}</h3><p>${m.tagline}</p></div>`;
  el.onclick = () => boot(m.id);
  grid.appendChild(el);
}
$('#startBtn').onclick = () => boot(null);

/* ---------- host session ---------- */
let net = null, renderer = null, scene = null, camera = null, running = null, rafId = 0;
let wanted = null;

async function boot(gameId) {
  wanted = gameId;
  landing.style.display = 'none';
  stage.style.display = 'block';
  ui.innerHTML = `<div class="overlay"><div class="lobby"><div class="joinbox"><h2>Tworzę pokój…</h2><p style="color:var(--dim)">Łączenie z siecią P2P</p></div></div></div>`;
  initGL();
  net = new HostNet();
  try {
    await net.start();
  } catch (e) {
    ui.innerHTML = `<div class="overlay"><div class="lobby"><div class="joinbox"><h2>😕 Błąd</h2><p>${e.message || e}</p><button class="btn" onclick="location.reload()">Spróbuj ponownie</button></div></div></div>`;
    return;
  }
  net.addEventListener('players', renderLobby);
  net.addEventListener('join', () => renderLobby());
  lobby();
}

function initGL() {
  const cv = $('#cv');
  renderer = makeRenderer(cv);
  scene = basicScene();
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(0, 60, 120); camera.lookAt(0, 0, 0);
  resize(); addEventListener('resize', resize);
  loop(performance.now());
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
let last = performance.now();
function loop(t) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (running) { running.update(dt); net.clearPressed(); }
  else idleSpin(dt);
  renderer.render(scene, camera);
}
let idle = null;
function idleSpin(dt) {
  if (!idle) {
    idle = new THREE.Group();
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random() * 2, 0),
        new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), .7, .6), flatShading: true }));
      m.position.set((Math.random() - .5) * 200, (Math.random() - .5) * 90, (Math.random() - .5) * 200);
      idle.add(m);
    }
    scene.add(idle);
  }
  idle.rotation.y += dt * 0.06;
  camera.position.set(Math.cos(performance.now() / 9000) * 90, 40, Math.sin(performance.now() / 9000) * 90);
  camera.lookAt(0, 0, 0);
}

/* ---------- lobby UI ---------- */
function padURL() {
  const base = location.href.replace(/[^/]*$/, '');
  return `${base}pad.html?c=${net.code}`;
}

function lobby() {
  running && running.dispose();
  running = null;
  if (idle) idle.visible = true;
  ui.innerHTML = `
    <div class="overlay">
      <div class="lobby">
        <div class="joinbox">
          <div style="color:var(--dim);font-size:14px">Wejdź na telefonie na</div>
          <div style="font-size:19px;font-weight:800;margin:6px 0 14px">${location.host}${location.pathname.replace(/[^/]*$/, '')}pad.html</div>
          <div id="qr"></div>
          <div style="color:var(--dim);font-size:14px;margin-top:16px">albo wpisz kod</div>
          <div class="code">${net.code}</div>
        </div>
        <div style="max-width:520px">
          <h1 style="margin:0 0 6px;font-size:40px;letter-spacing:-1.5px">Podłącz graczy 🎮</h1>
          <p style="color:var(--dim);margin:0 0 6px">Zeskanuj kod QR telefonem, wpisz nick i gotowe. Do 8 graczy.</p>
          <div class="players" id="plist"></div>
          <div style="margin-top:18px" id="gsel"></div>
        </div>
      </div>
    </div>`;
  new QRCode($('#qr'), { text: padURL(), width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
  renderLobby();
}

function renderLobby() {
  const pl = $('#plist'); if (!pl) return;
  const list = net.list();
  pl.innerHTML = list.length
    ? list.map(p => `<div class="pchip" style="border-color:${p.color};color:${p.color}">👤 ${p.name}</div>`).join('')
    : `<div style="color:var(--dim);align-self:center">Czekam na graczy…</div>`;

  const gs = $('#gsel'); if (!gs) return;
  gs.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">` +
    GAMES.map(g => {
      const ok = list.length >= g.meta.min && list.length <= g.meta.max;
      return `<div class="card" data-g="${g.meta.id}" style="${ok ? '' : 'opacity:.4;pointer-events:none'}">
        <div class="thumb" style="height:78px;font-size:34px;background:linear-gradient(135deg,${g.meta.color}33,#0d1428)">${EMOJI[g.meta.id]}</div>
        <div class="body" style="padding:10px"><h3 style="font-size:14px;margin:0">${g.meta.title}</h3>
        <p style="font-size:11px">${g.meta.min}-${g.meta.max} graczy</p></div></div>`;
    }).join('') + `</div>`;
  gs.querySelectorAll('[data-g]').forEach(el => el.onclick = () => play(el.dataset.g));

  if (wanted && list.length >= (byId(wanted)?.meta.min || 1)) { const g = wanted; wanted = null; play(g); }
}

/* ---------- run a game ---------- */
function play(id) {
  const mod = byId(id); if (!mod) return;
  if (idle) idle.visible = false;
  ui.innerHTML = `<div class="hud" id="hud"></div>
    <button class="btn esc" id="escb">⏹ Zakończ</button>`;
  $('#escb').onclick = () => { running && running.dispose(); running = null; lobby(); net.broadcast({ t: 'game', game: null, controls: null }); };

  net.broadcast({ t: 'game', game: mod.meta.id, title: mod.meta.title, controls: mod.meta.controls });

  const ctx = {
    scene, renderer, camera, net,
    hud: (html) => { const h = $('#hud'); if (h) h.innerHTML = html; },
    toast,
    finish: (rank) => showResults(mod, rank),
  };
  running = mod.start(ctx);
}

function toast(txt) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = txt;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

function showResults(mod, rank) {
  running && running.dispose(); running = null;
  net.broadcast({ t: 'over' });
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="inner">
    <div style="font-size:56px">🏆</div>
    <h2 style="margin:6px 0 0">Koniec gry!</h2>
    <div style="color:var(--dim)">${mod.meta.title}</div>
    <div class="rank">${rank.map((r, i) => `${['🥇','🥈','🥉'][i] || `${i + 1}.`} <b style="color:${r.color || '#fff'}">${r.name}</b> — ${r.score}`).join('<br>')}</div>
    <div style="display:flex;gap:10px;justify-content:center">
      <button class="btn primary" id="again">🔁 Jeszcze raz</button>
      <button class="btn" id="menu">🏠 Menu</button>
    </div></div>`;
  document.body.appendChild(m);
  m.querySelector('#again').onclick = () => { m.remove(); play(mod.meta.id); };
  m.querySelector('#menu').onclick = () => { m.remove(); lobby(); };
}

/* deep link: index.html#kart */
if (location.hash) {
  const id = location.hash.slice(1);
  if (byId(id)) boot(id);
}
