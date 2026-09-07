import { THREE, makeRenderer, basicScene } from './engine.js';
import { HostNet } from './net.js?v=20260907b';
import { GAMES, EMOJI, CATS, byId } from './games/index.js';
import { unlockAudio, countdownTone, stopEngine } from './audio.js';

function fatal(msg) {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:999;padding:14px 18px;font:600 14px Inter,sans-serif;' +
    'background:linear-gradient(180deg,#ff8c12,#d9560a);color:#2a1204;box-shadow:0 6px 20px rgba(0,0,0,.6)';
  b.textContent = '⚠ ' + msg;
  document.body.appendChild(b);
}
addEventListener('error', e => { if (e.message) console.error(e.message); });

const $ = (s) => document.querySelector(s);
const ui = $('#ui');
const landing = $('#landing');
const stage = $('#stage');

let filter = 'Wszystkie';
const gcount = $('#gcount');
if (gcount) gcount.textContent = `${GAMES.length} tytułów • wszystkie darmowe`;

function cardHTML(m, small) {
  return `
    <div class="thumb" style="${small ? 'height:80px;font-size:36px;' : ''}background:linear-gradient(160deg,${m.color}2e,#120b06 70%)">
      ${EMOJI[m.id]}
      ${small ? '' : `<div class="tagpill">${m.tag || 'GRA'}</div><div class="pl">${m.min}–${m.max} 👤</div>`}
    </div>
    <div class="body" style="${small ? 'padding:10px' : ''}">
      <h3 style="${small ? 'font-size:14px' : ''}">${m.title}</h3>
      <p style="${small ? 'font-size:11px' : ''}">${small ? `${m.min}–${m.max} graczy` : m.tagline}</p>
    </div>`;
}

function renderCatalogue() {
  const tabs = $('#tabs'); const grid = $('#gameGrid');
  if (!tabs || !grid) return;
  const used = CATS.filter(c => c === 'Wszystkie' || GAMES.some(g => g.meta.tag === c));
  tabs.innerHTML = used.map(c => `<div class="tab ${c === filter ? 'on' : ''}" data-c="${c}">${c}</div>`).join('');
  tabs.querySelectorAll('.tab').forEach(t => t.onclick = () => { filter = t.dataset.c; renderCatalogue(); });
  grid.innerHTML = '';
  for (const g of GAMES) {
    if (filter !== 'Wszystkie' && g.meta.tag !== filter) continue;
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = cardHTML(g.meta);
    el.onclick = () => boot(g.meta.id);
    grid.appendChild(el);
  }
}
renderCatalogue();
$('#startBtn').onclick = () => { unlockAudio(); boot(null); };

let net = null, renderer = null, scene = null, camera = null, running = null;
let wanted = null;

function pageBase() {
  const u = new URL(location.href);
  let path = u.pathname.replace(/[#?].*$/, '');
  if (!path.endsWith('/') && !path.split('/').pop().includes('.')) path += '/';
  if (!path.endsWith('/')) path = path.replace(/[^/]+$/, '');
  return u.origin + path;
}

function padURL() {
  return `${pageBase()}pad.html?c=${net.code}`;
}

async function boot(gameId) {
  wanted = gameId;
  unlockAudio();
  landing.style.display = 'none';
  stage.style.display = 'block';
  ui.innerHTML = `<div class="overlay"><div class="lobby"><div class="joinbox">
      <div style="font-size:44px" class="pulse">📡</div>
      <h2 style="margin:10px 0 4px">Tworzę pokój…</h2>
      <p style="color:var(--dim);margin:0">Łączenie z siecią P2P</p></div></div></div>`;
  try { initGL(); }
  catch (e) {
    console.error(e);
    fatal('Nie udało się uruchomić grafiki 3D (WebGL). Włącz akcelerację sprzętową w przeglądarce.');
    return;
  }
  net = new HostNet();
  try { await net.start(); }
  catch (e) {
    ui.innerHTML = `<div class="overlay"><div class="lobby"><div class="joinbox">
      <div style="font-size:44px">😕</div><h2>Nie udało się</h2>
      <p style="color:var(--dim)">${e.message || e}</p>
      <button class="btn primary" onclick="location.reload()">Spróbuj ponownie</button></div></div></div>`;
    return;
  }
  net.addEventListener('players', renderLobby);
  net.addEventListener('join', renderLobby);
  wireHostKeys();
  lobby();
}

function initGL() {
  renderer = makeRenderer($('#cv'));
  scene = basicScene(0x0a0705);
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(0, 60, 120); camera.lookAt(0, 0, 0);
  resize(); addEventListener('resize', resize);
  requestAnimationFrame(loop);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (running) { try { running.update(dt); } catch (e) { console.error(e); } net.clearPressed(); }
  else idleSpin(dt);
  renderer.render(scene, camera);
}
let idle = null;
function idleSpin(dt) {
  if (!idle) {
    idle = new THREE.Group();
    const cols = [0xff9a1f, 0xffd24a, 0xf2670a, 0xffb35c];
    for (let i = 0; i < 110; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random() * 2.4, 0),
        new THREE.MeshStandardMaterial({ color: cols[i % 4], flatShading: true, roughness: .5, metalness: .35,
          emissive: cols[i % 4], emissiveIntensity: .1 }));
      m.position.set((Math.random() - .5) * 220, (Math.random() - .5) * 110, (Math.random() - .5) * 220);
      m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      m.userData.sp = (Math.random() - .5) * .6;
      idle.add(m);
    }
    scene.add(idle);
  }
  idle.rotation.y += dt * 0.05;
  for (const m of idle.children) { m.rotation.x += dt * m.userData.sp; m.rotation.y += dt * m.userData.sp * .7; }
  const a = performance.now() / 11000;
  camera.position.set(Math.cos(a) * 95, 42, Math.sin(a) * 95);
  camera.lookAt(0, 0, 0);
}

function lobby() {
  stopEngine();
  if (running) { running.dispose(); running = null; }
  if (idle) idle.visible = true;
  const link = padURL();
  ui.innerHTML = `
    <div class="overlay">
      <div class="lobby">
        <div class="joinbox">
          <div style="color:var(--dim);font-size:13px;letter-spacing:.4px">NA TELEFONIE ZESKANUJ LUB OTWÓRZ</div>
          <div id="padlink" style="font-size:13px;font-weight:800;margin:6px 0 10px;word-break:break-all;color:var(--amber-hi)">${link}</div>
          <div id="qr"></div>
          <div style="color:var(--dim);font-size:13px;margin-top:16px;letter-spacing:.4px">LUB WPISZ KOD</div>
          <div class="code">${net.code}</div>
          <div style="color:var(--dim);font-size:12px;margin-top:10px">Telefon i TV nie muszą być w tej samej sieci Wi‑Fi.</div>
          <button class="btn" id="copylink" style="margin-top:12px;width:100%;justify-content:center">📋 Kopiuj link do pada</button>
        </div>
        <div style="max-width:560px;flex:1;min-width:320px">
          <h1 style="margin:0 0 6px;font-size:clamp(28px,4vw,44px);letter-spacing:-1.6px">Podłącz graczy 🎮</h1>
          <p style="color:var(--dim);margin:0">Zeskanuj kod QR telefonem, wpisz nick i gotowe. Do 8 graczy jednocześnie.</p>
          <div class="players" id="plist"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
            <button class="btn primary" id="addkb">⌨️ Gracz z klawiatury (WASD)</button>
          </div>
          <div id="gsel"></div>
          <button class="btn" id="backHome" style="margin-top:18px">← Wróć na stronę</button>
        </div>
      </div>
    </div>`;
  try {
    new QRCode($('#qr'), { text: link, width: 188, height: 188, correctLevel: QRCode.CorrectLevel.M });
  } catch (e) { console.warn(e); }
  $('#backHome').onclick = () => { stage.style.display = 'none'; ui.innerHTML = ''; landing.style.display = 'block'; };
  $('#copylink').onclick = async () => {
    try { await navigator.clipboard.writeText(link); $('#copylink').textContent = '✅ Skopiowano'; }
    catch (e) { prompt('Skopiuj link:', link); }
  };
  $('#addkb').onclick = () => {
    const p = net.addLocal(localStorage.getItem('airpad.name') || 'Klawiatura');
    toast(`⌨️ ${p.name} — WASD / strzałki, spacja = A, Shift = B, Ctrl = X`);
  };
  renderLobby();
}

function renderLobby() {
  const pl = $('#plist'); if (!pl) return;
  const list = net.list();
  pl.innerHTML = list.length
    ? list.map(p => `<div class="pchip" style="border-color:${p.color};color:${p.color}">👤 ${p.name}${p.local ? ' ⌨️' : ''}</div>`).join('')
    : `<div style="color:var(--dim);align-self:center">Czekam na graczy…</div>`;

  const gs = $('#gsel'); if (!gs) return;
  gs.innerHTML = `<div style="color:var(--dim);font-size:13px;margin:14px 0 8px;letter-spacing:.4px">WYBIERZ GRĘ</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px">` +
    GAMES.map(g => {
      const ok = list.length >= g.meta.min && list.length <= g.meta.max;
      return `<div class="card" data-g="${g.meta.id}" style="${ok ? '' : 'opacity:.33;pointer-events:none;filter:grayscale(.7)'}">
        ${cardHTML(g.meta, true)}</div>`;
    }).join('') + `</div>`;
  gs.querySelectorAll('[data-g]').forEach(el => el.onclick = () => play(el.dataset.g));

  if (wanted && list.length >= (byId(wanted)?.meta.min || 1)) { const g = wanted; wanted = null; play(g); }
}

function play(id) {
  const mod = byId(id); if (!mod) return;
  unlockAudio();
  if (idle) idle.visible = false;
  ui.innerHTML = `<div class="hud" id="hud"></div><button class="btn esc" id="escb">⏹ Zakończ</button>
    <div class="modal" id="cdown" style="pointer-events:none"><div class="inner"><div id="cdnum" style="font-size:96px;font-weight:900">3</div>
    <div style="color:var(--dim)">${mod.meta.title}</div></div></div>`;
  $('#escb').onclick = () => { if (running) running.dispose(); running = null; stopEngine(); net.broadcast({ t: 'game', game: null }); lobby(); };
  net.broadcast({ t: 'game', game: mod.meta.id, title: mod.meta.title, controls: mod.meta.controls });

  const game = mod.start({
    scene, renderer, camera, net,
    hud: (html) => { const h = $('#hud'); if (h) h.innerHTML = html; },
    toast,
    finish: (rank) => showResults(mod, rank),
  });

  let cd = 3.2;
  let lastN = 4;
  running = {
    update(dt) {
      if (cd > 0) {
        cd -= dt;
        const n = cd > 0.35 ? Math.ceil(cd - 0.2) : 0;
        const el = $('#cdnum');
        if (el) el.textContent = n > 0 ? n : 'GO!';
        if (n !== lastN) { lastN = n; countdownTone(n); }
        if (cd <= 0) { const m = $('#cdown'); if (m) m.remove(); }
        try { game.update(0); } catch (e) { console.error(e); }
        return;
      }
      game.update(dt);
    },
    dispose() { game.dispose(); },
  };
}

function toast(txt) {
  const d = document.createElement('div');
  d.className = 'toast'; d.textContent = txt;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

function showResults(mod, rank) {
  if (running) running.dispose();
  running = null;
  const cd = document.getElementById('cdown'); if (cd) cd.remove();
  stopEngine();
  net.broadcast({ t: 'over' });
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="inner">
    <div style="font-size:58px;filter:drop-shadow(0 6px 14px rgba(255,140,30,.5))">🏆</div>
    <h2 style="margin:8px 0 0;letter-spacing:-.8px">Koniec gry!</h2>
    <div style="color:var(--dim)">${mod.meta.title}</div>
    <div class="rank">${rank.map((r, i) => `${['🥇','🥈','🥉'][i] || `${i + 1}.`} <b style="color:${r.color || '#fff'}">${r.name}</b> — ${r.score}`).join('<br>')}</div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn primary" id="again">🔁 Jeszcze raz</button>
      <button class="btn" id="menu">🏠 Menu</button>
    </div></div>`;
  document.body.appendChild(m);
  m.querySelector('#again').onclick = () => { m.remove(); play(mod.meta.id); };
  m.querySelector('#menu').onclick = () => { m.remove(); lobby(); };
}

function wireHostKeys() {
  const down = {};
  addEventListener('keydown', e => {
    if (!net || !net.localPlayer) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const p = net.localPlayer;
    const map = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', a: 'l', d: 'r', w: 'u', s: 'd', A: 'l', D: 'r', W: 'u', S: 'd' };
    const m = map[e.key];
    if (m) {
      if (m === 'l') p.input.ax = -1;
      if (m === 'r') p.input.ax = 1;
      if (m === 'u') p.input.ay = -1;
      if (m === 'd') p.input.ay = 1;
      e.preventDefault();
    }
    if (e.key === ' ' || e.code === 'Space') { if (!p.input.btn.a) p.input.pressed.a = true; p.input.btn.a = true; e.preventDefault(); }
    if (e.key === 'Shift') { if (!p.input.btn.b) p.input.pressed.b = true; p.input.btn.b = true; }
    if (e.key === 'Control') { if (!p.input.btn.x) p.input.pressed.x = true; p.input.btn.x = true; }
    if (!down[e.key] && '1234'.includes(e.key)) net.emit('tap', { player: p, key: 'abcd'['1234'.indexOf(e.key)] });
    down[e.key] = true;
  });
  addEventListener('keyup', e => {
    if (!net || !net.localPlayer) return;
    const p = net.localPlayer;
    if (['ArrowLeft', 'a', 'A'].includes(e.key) && p.input.ax < 0) p.input.ax = 0;
    if (['ArrowRight', 'd', 'D'].includes(e.key) && p.input.ax > 0) p.input.ax = 0;
    if (['ArrowUp', 'w', 'W'].includes(e.key) && p.input.ay < 0) p.input.ay = 0;
    if (['ArrowDown', 's', 'S'].includes(e.key) && p.input.ay > 0) p.input.ay = 0;
    if (e.key === ' ' || e.code === 'Space') p.input.btn.a = false;
    if (e.key === 'Shift') p.input.btn.b = false;
    if (e.key === 'Control') p.input.btn.x = false;
    down[e.key] = false;
  });
}

if (location.hash && byId(location.hash.slice(1))) boot(location.hash.slice(1));
