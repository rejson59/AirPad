import { ClientNet } from './net.js';

const app = document.getElementById('app');
const net = new ClientNet();
const params = new URLSearchParams(location.search);
let state = { ax: 0, ay: 0, btn: {} };
let controls = null;

const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

/* ---------------------- connect ---------------------- */
function screenConnect(err = '') {
  document.body.classList.add('pad');
  const code = params.get('c') || localStorage.getItem('airpad.code') || '';
  const name = localStorage.getItem('airpad.name') || '';
  app.innerHTML = `
  <div class="center">
    <div style="width:100%;max-width:390px">
      <div class="logo" style="justify-content:center;margin-bottom:4px"><div class="dot">🎮</div> AirPad</div>
      <p style="color:var(--dim);margin:0 0 20px;font-size:14px">Wpisz kod z dużego ekranu i swój nick</p>
      <input class="inp codein" id="code" inputmode="numeric" maxlength="4" placeholder="0000" value="${esc(code)}">
      <input class="inp" id="name" maxlength="12" placeholder="Twój nick" value="${esc(name)}">
      <div class="err" id="err">${esc(err)}</div>
      <button class="btn primary big" id="go" style="width:100%;justify-content:center">🔗 Połącz</button>
      <p style="color:var(--dim);font-size:12px;margin-top:22px">Nie masz kodu? Otwórz <b style="color:var(--amber)">AirPad</b> na komputerze lub TV i kliknij „Uruchom konsolę”.</p>
    </div>
  </div>`;
  const go = document.getElementById('go');
  go.onclick = async () => {
    const c = document.getElementById('code').value.trim();
    const n = document.getElementById('name').value.trim() || 'Gracz';
    if (!/^\d{4}$/.test(c)) { document.getElementById('err').textContent = 'Kod to dokładnie 4 cyfry'; return; }
    localStorage.setItem('airpad.code', c); localStorage.setItem('airpad.name', n);
    go.disabled = true; go.textContent = '⏳ Łączenie…';
    try { await net.connect(c, n); buzz(60); screenWait(n); }
    catch (e) { screenConnect(e.message || 'Nie udało się połączyć'); }
  };
  document.getElementById('code').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (e.target.value.length === 4) document.getElementById('name').focus();
  });
}

function screenWait(name) {
  app.innerHTML = `<div class="center"><div>
    <div style="font-size:66px" class="pulse">🎮</div>
    <h2 style="margin:12px 0 4px;letter-spacing:-.6px">Połączono!</h2>
    <p style="color:var(--dim)">Cześć <b style="color:var(--amber)">${esc(name)}</b> — wybierzcie grę na dużym ekranie.</p>
    <p style="color:var(--dim);font-size:13px;margin-top:28px">📱 Obróć telefon poziomo dla wygody</p>
  </div></div>`;
}

/* ---------------------- gamepad ---------------------- */
function screenPad(title, ctrl) {
  controls = ctrl || { stick: true, buttons: [{ id: 'a', label: 'A', color: 'linear-gradient(180deg,#ffd24a,#e59b06)' }] };
  state = { ax: 0, ay: 0, btn: {} };

  if (controls.quiz) return screenQuiz(title);

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
  bindStick(); bindButtons();
}

function screenQuiz(title) {
  app.innerHTML = `
  <div class="padwrap">
    <div class="padtop"><div>🧠 <b>${esc(title)}</b></div><div class="padstats" id="stats"></div></div>
    <div class="padmain" id="qmain">
      <div class="center" style="min-height:auto;height:100%"><div style="color:var(--dim)">Czekam na pytanie…</div></div>
    </div>
  </div>`;
}

function renderQuiz(msg) {
  const main = document.getElementById('qmain'); if (!main) return;
  const L = ['A', 'B', 'C', 'D'], cls = ['a', 'b', 'c', 'd'];
  main.innerHTML = `<div class="answers">` +
    msg.a.map((a, i) => `<div class="ans ${cls[i]}" data-k="${'abcd'[i]}">${L[i]}. ${esc(a)}</div>`).join('') + `</div>`;
  main.querySelectorAll('.ans').forEach(el => {
    const pick = e => {
      e.preventDefault();
      el.classList.add('down'); buzz(30);
      net.send({ t: 'tap', k: el.dataset.k });
    };
    el.addEventListener('touchstart', pick, { passive: false });
    el.addEventListener('mousedown', pick);
  });
  const s = document.getElementById('stats');
  if (s) s.innerHTML = `<span>Pytanie ${msg.n}/${msg.total}</span>`;
}

function quizLock(pick) {
  document.querySelectorAll('.ans').forEach((el, i) => {
    el.style.opacity = i === pick ? '1' : '.25';
    el.style.pointerEvents = 'none';
  });
}
function quizResult(m) {
  const main = document.getElementById('qmain'); if (!main) return;
  main.innerHTML = `<div class="center" style="min-height:auto;height:100%"><div>
    <div style="font-size:64px">${m.ok ? '✅' : '❌'}</div>
    <h2 style="margin:10px 0 2px">${m.ok ? `+${m.pts} pkt` : 'Pudło!'}</h2>
    <p style="color:var(--dim)">Poprawna: <b style="color:var(--amber)">${esc(m.correct)}</b></p>
    <p style="color:var(--dim);font-size:13px">Twój wynik: ${m.score} pkt</p>
  </div></div>`;
}

function bindStick() {
  const stick = document.getElementById('stick'); if (!stick) return;
  const knob = document.getElementById('knob');
  let id = null, rect = null;
  const set = (dx, dy) => {
    const r = rect.width / 2, len = Math.hypot(dx, dy), k = len > r ? r / len : 1;
    dx *= k; dy *= k;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / r, ny = dy / r;
    state.ax = Math.abs(nx) < .12 ? 0 : nx;
    state.ay = Math.abs(ny) < .12 ? 0 : ny;
  };
  const reset = () => { knob.style.transform = 'translate(-50%,-50%)'; state.ax = state.ay = 0; id = null; };
  stick.addEventListener('touchstart', e => {
    const t = e.changedTouches[0]; id = t.identifier; rect = stick.getBoundingClientRect();
    set(t.clientX - rect.left - rect.width / 2, t.clientY - rect.top - rect.height / 2); e.preventDefault();
  }, { passive: false });
  stick.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === id)
      set(t.clientX - rect.left - rect.width / 2, t.clientY - rect.top - rect.height / 2);
    e.preventDefault();
  }, { passive: false });
  const end = e => { for (const t of e.changedTouches) if (t.identifier === id) reset(); };
  stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
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
    const down = e => { state.btn[k] = true; el.classList.add('down'); buzz(18); e.preventDefault(); };
    const up = e => { state.btn[k] = false; el.classList.remove('down'); if (e) e.preventDefault(); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
    el.addEventListener('mousedown', down); el.addEventListener('mouseup', up); el.addEventListener('mouseleave', up);
  });
}

/* keyboard fallback (desktop as a second pad) */
addEventListener('keydown', e => keyed(e, true));
addEventListener('keyup', e => keyed(e, false));
function keyed(e, v) {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
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
  if (v && '1234'.includes(e.key)) net.send({ t: 'tap', k: 'abcd'['1234'.indexOf(e.key)] });
}

/* ---------------------- messages ---------------------- */
net.addEventListener('msg', e => {
  const m = e.detail;
  if (m.t === 'game') {
    if (m.game) screenPad(m.title, m.controls);
    else screenWait(localStorage.getItem('airpad.name') || 'Gracz');
  } else if (m.t === 'quiz') { renderQuiz(m); buzz(40); }
  else if (m.t === 'quizlock') quizLock(m.pick);
  else if (m.t === 'quizres') quizResult(m);
  else if (m.t === 'hud') {
    const s = document.getElementById('stats'); if (!s) return;
    const b = [];
    if (m.hp !== undefined) b.push(`❤️ ${m.hp}`);
    if (m.kills !== undefined) b.push(`💀 ${m.kills}`);
    if (m.score !== undefined) b.push(`⭐ ${m.score}`);
    if (m.lap !== undefined) b.push(`🏁 ${m.lap}`);
    if (m.height !== undefined) b.push(`⛰ ${m.height}`);
    if (m.jumps !== undefined) b.push(`🦘 ${m.jumps}`);
    if (m.bombs !== undefined) b.push(`💣 ${m.bombs}`);
    if (m.fire !== undefined) b.push(`🔥 ${m.fire}`);
    if (m.size !== undefined) b.push(`🕳 ${m.size}`);
    if (m.team !== undefined) b.push(`${m.team}`);
    if (m.speed !== undefined) b.push(`⚡ ${m.speed}`);
    if (m.time !== undefined) b.push(`⏱ ${m.time}`);
    const bar = v => `${'▮'.repeat(Math.round(v))}${'▯'.repeat(Math.max(0, 3 - Math.round(v)))}`;
    if (m.boost !== undefined) b.push(`🚀 ${bar(m.boost)}`);
    if (m.turbo !== undefined) b.push(`🚀 ${bar(m.turbo)}`);
    s.innerHTML = b.map(x => `<span>${x}</span>`).join('');
  }
  else if (m.t === 'rumble') buzz(m.ms || 60);
  else if (m.t === 'over') buzz([80, 60, 80]);
});
net.addEventListener('close', () => screenConnect('Rozłączono z ekranem'));

setInterval(() => net.send({ t: 'in', ax: +state.ax.toFixed(2), ay: +state.ay.toFixed(2), b: state.btn }), 33);
addEventListener('contextmenu', e => e.preventDefault());
screenConnect();
