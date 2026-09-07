import { ClientNet } from './net.js';

const app = document.getElementById('app');
const net = new ClientNet();
const params = new URLSearchParams(location.search);
let state = { ax: 0, ay: 0, btn: {} };
let controls = null;

function esc(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

/* ------------------------- connect screen ------------------------- */
function screenConnect(err = '') {
  const code = params.get('c') || localStorage.getItem('airpad.code') || '';
  const name = localStorage.getItem('airpad.name') || '';
  app.innerHTML = `
  <div class="center">
    <div style="width:100%;max-width:380px">
      <div class="logo" style="justify-content:center;margin-bottom:6px"><div class="dot">🎮</div> AirPad</div>
      <p style="color:var(--dim);margin:0 0 22px">Wpisz kod z ekranu i swój nick</p>
      <input class="inp codein" id="code" inputmode="numeric" maxlength="4" placeholder="0000" value="${esc(code)}">
      <input class="inp" id="name" maxlength="12" placeholder="Twój nick" value="${esc(name)}">
      <div class="err" id="err">${esc(err)}</div>
      <button class="btn primary big" id="go" style="width:100%;justify-content:center;margin-top:8px">🔗 Połącz</button>
    </div>
  </div>`;
  const go = document.getElementById('go');
  go.onclick = async () => {
    const c = document.getElementById('code').value.trim();
    const n = document.getElementById('name').value.trim() || 'Gracz';
    if (!/^\d{4}$/.test(c)) { document.getElementById('err').textContent = 'Kod to 4 cyfry'; return; }
    localStorage.setItem('airpad.code', c); localStorage.setItem('airpad.name', n);
    go.disabled = true; go.textContent = 'Łączenie…';
    try {
      await net.connect(c, n);
      screenWait(n);
    } catch (e) {
      screenConnect(e.message || 'Nie udało się połączyć');
    }
  };
  document.getElementById('code').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (e.target.value.length === 4) document.getElementById('name').focus();
  });
}

function screenWait(name) {
  app.innerHTML = `<div class="center"><div>
    <div style="font-size:64px" class="pulse">✅</div>
    <h2 style="margin:10px 0 4px">Połączono!</h2>
    <p style="color:var(--dim)">Cześć <b>${esc(name)}</b> — wybierzcie grę na dużym ekranie.</p>
    <p style="color:var(--dim);font-size:13px;margin-top:26px">📱 Obróć telefon poziomo dla wygody</p>
  </div></div>`;
}

/* ------------------------- gamepad ------------------------- */
function screenPad(title, ctrl) {
  controls = ctrl || { stick: true, buttons: [{ id: 'a', label: 'A', color: '#4ade80' }] };
  app.innerHTML = `
  <div class="padwrap">
    <div class="padtop">
      <div>🎮 <b>${esc(title || 'Gra')}</b></div>
      <div class="padstats" id="stats"></div>
    </div>
    <div class="padmain">
      ${controls.stick ? `<div class="stick" id="stick"><div class="knob" id="knob"></div></div>` : ''}
      <div class="btns">
        ${(controls.buttons || []).map(b => `<div class="bbtn" data-b="${b.id}" style="background:${b.color}">${esc(b.label)}</div>`).join('')}
      </div>
    </div>
  </div>`;
  bindStick();
  bindButtons();
}

function bindStick() {
  const stick = document.getElementById('stick');
  if (!stick) return;
  const knob = document.getElementById('knob');
  let id = null, rect = null;
  const set = (dx, dy) => {
    const r = rect.width / 2;
    const len = Math.hypot(dx, dy);
    const k = len > r ? r / len : 1;
    dx *= k; dy *= k;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / r, ny = dy / r;
    state.ax = Math.abs(nx) < 0.12 ? 0 : nx;
    state.ay = Math.abs(ny) < 0.12 ? 0 : ny;
  };
  const reset = () => { knob.style.transform = 'translate(-50%,-50%)'; state.ax = 0; state.ay = 0; id = null; };
  stick.addEventListener('touchstart', e => {
    const t = e.changedTouches[0]; id = t.identifier; rect = stick.getBoundingClientRect();
    set(t.clientX - rect.left - rect.width / 2, t.clientY - rect.top - rect.height / 2);
    e.preventDefault();
  }, { passive: false });
  stick.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === id)
      set(t.clientX - rect.left - rect.width / 2, t.clientY - rect.top - rect.height / 2);
    e.preventDefault();
  }, { passive: false });
  const end = e => { for (const t of e.changedTouches) if (t.identifier === id) reset(); };
  stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);

  // mouse fallback (desktop testing)
  stick.addEventListener('mousedown', e => {
    rect = stick.getBoundingClientRect(); id = 'm';
    const mv = ev => set(ev.clientX - rect.left - rect.width / 2, ev.clientY - rect.top - rect.height / 2);
    const up = () => { reset(); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up); mv(e);
  });
}

function bindButtons() {
  document.querySelectorAll('.bbtn').forEach(el => {
    const k = el.dataset.b;
    const down = e => { state.btn[k] = true; el.classList.add('down'); buzz(20); e.preventDefault(); };
    const up = e => { state.btn[k] = false; el.classList.remove('down'); e && e.preventDefault(); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    el.addEventListener('mousedown', down); el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
  });
}

function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

/* keyboard fallback for desktop controllers */
addEventListener('keydown', e => keyed(e, true));
addEventListener('keyup', e => keyed(e, false));
function keyed(e, v) {
  const map = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', a: 'l', d: 'r', w: 'u', s: 'd' };
  const m = map[e.key];
  if (m) {
    if (m === 'l') state.ax = v ? -1 : 0;
    if (m === 'r') state.ax = v ? 1 : 0;
    if (m === 'u') state.ay = v ? -1 : 0;
    if (m === 'd') state.ay = v ? 1 : 0;
    e.preventDefault();
  }
  if (e.key === ' ') { state.btn.a = v; e.preventDefault(); }
  if (e.key === 'Shift') state.btn.b = v;
  if (e.key === 'Control') state.btn.x = v;
}

/* ------------------------- messages ------------------------- */
net.addEventListener('msg', e => {
  const m = e.detail;
  if (m.t === 'game') {
    if (m.game) screenPad(m.title, m.controls);
    else screenWait(localStorage.getItem('airpad.name') || 'Gracz');
  } else if (m.t === 'hud') {
    const s = document.getElementById('stats');
    if (s) {
      const bits = [];
      if (m.hp !== undefined) bits.push(`❤️ ${m.hp}`);
      if (m.kills !== undefined) bits.push(`💀 ${m.kills}`);
      if (m.score !== undefined) bits.push(`🪙 ${m.score}`);
      if (m.lap !== undefined) bits.push(`🏁 ${m.lap}`);
      if (m.speed !== undefined) bits.push(`⚡ ${m.speed}`);
      if (m.time !== undefined) bits.push(`⏱ ${m.time}`);
      if (m.boost !== undefined) bits.push(`🚀 ${'▮'.repeat(Math.round(m.boost))}${'▯'.repeat(3 - Math.round(m.boost))}`);
      if (m.turbo !== undefined) bits.push(`🚀 ${'▮'.repeat(Math.round(m.turbo))}`);
      s.innerHTML = bits.map(b => `<span>${b}</span>`).join('');
    }
  } else if (m.t === 'rumble') {
    buzz(m.ms || 60);
  } else if (m.t === 'over') {
    buzz([80, 60, 80]);
  }
});
net.addEventListener('close', () => screenConnect('Rozłączono z ekranem'));

/* send loop 30 Hz */
setInterval(() => {
  net.send({ t: 'in', ax: +state.ax.toFixed(2), ay: +state.ay.toFixed(2), b: state.btn });
}, 33);

screenConnect();
if (params.get('c')) {
  // auto-fill only; user taps Połącz after entering nick
}
