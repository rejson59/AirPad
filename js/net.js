// AirPad networking
// Two independent paths, first one that opens a data channel wins:
//   1) Native WebRTC + public ntfy.sh (and mirrors) as signaling — no PeerJS cloud
//   2) PeerJS cloud (0.peerjs.com) with the REAL PeerJS TURN servers
//
// Diagnoza „pad nie łączy się, w konsoli zero błędów” (po PR #4):
//   a) SPLIT-BRAIN MIRRORÓW — każda strona subskrybowała tylko SWÓJ aktywny mirror
//      i niezależnie przełączała go po 429/błędzie. Publikacja lądowała tam, gdzie
//      druga strona nie słuchała → cicha śmierć bez żadnego errora.
//      Fix: SUBSKRYPCJE WS na OBU mirrorach od startu (nasłuch pasywny — nie zjada
//      limitu POST ~1 req/5 s), PUBLIKACJA zawsze na JEDNYM aktywnym mirrorze
//      z jednorazowym failoverem po 429/błędzie sieci.
//   b) CHURN WS — onclose starego socketu planował reconnect, który co ~1,5 s
//      zrywał zdrowe połączenie i gubił offer/answer. Fix: licznik generacji (gen)
//      na slot mirrora; failover NIE rusza socketów (każdy mirror żyje własnym życiem).
//   c) NIEMA SYGNALIZACJA — pełny ślad [airpad:net] na konsoli HOSTA + zdarzenie
//      'trace' na ClientNet/HostNet, wyświetlane na ekranie pada (telefon nie ma DevTools).
//      Błędy PeerJS są logowane zamiast połykanych.
//   d) SAMOLECZENIE HANDSHAKE'U — jednorazowy retry oferty po OFFER_RETRY_MS bez
//      odpowiedzi (przez DRUGI mirror, maks. +1 POST); host ponownie odpowiada na duplikat.

export const PREFIX = 'airpad-x7k-';

export const ICE = {
  iceServers: [
    { urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
    ] },
    {
      urls: [
        'turn:eu-0.turn.peerjs.com:3478',
        'turn:us-0.turn.peerjs.com:3478',
        'turn:eu-0.turn.peerjs.com:3478?transport=tcp',
        'turn:us-0.turn.peerjs.com:3478?transport=tcp',
      ],
      username: 'peerjs',
      credential: 'peerjsp',
    },
  ],
  iceCandidatePoolSize: 8,
};

const NTFY_PRIMARY = 'https://ntfy.sh';
const NTFY_FALLBACK = 'https://ntfy.envs.net';
const MIRRORS = [NTFY_PRIMARY, NTFY_FALLBACK];
// Limit publicznego ntfy: ~1 req / 5 s per IP (burst ~60). Cały ruch sygnalizacji
// musi się w tym zmieścić — stąd JEDEN aktywny mirror publikacji, rzadkie hello,
// batchowanie ICE i retry tylko tam, gdzie naprawdę trzeba.
const HELLO_INTERVAL = 12000;
const ICE_BATCH_MS = 100;
const WS_BACKOFF_BASE = 1500;
const WS_BACKOFF_CAP = 30000;
const OFFER_RETRY_MS = 3000;

const NS = '[airpad:net]';
function netLog(...a) { try { console.log(NS, ...a); } catch (e) {} }
function netWarn(...a) { try { console.warn(NS, ...a); } catch (e) {} }

export function randomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function iceJSON(c) {
  return { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
}

function rid(n = 10) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += a[(Math.random() * a.length) | 0];
  return s;
}

function topicFor(code) {
  return (PREFIX + code).replace(/[^a-zA-Z0-9_-]/g, '');
}

function newPeer(id) {
  return new Peer(id, {
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    debug: 0,
    config: ICE,
  });
}

/* ----------------------------- ntfy bus ------------------------------ */

class SignalBus {
  // trace: fn(line) — każda linia śladu sygnalizacji (log + zdarzenie 'trace').
  constructor(code, trace) {
    this.topic = topicFor(code);
    this.handlers = new Set();
    // Slot na MIRROR: { ws, gen, retry, timer }. Subskrypcje żyją niezależnie na
    // obu mirrorach — przełączenie publikacji nigdy nie zamyka zdrowego socketu.
    this.socks = new Map();
    // Aktywny mirror TYLKO dla publikacji (POST). Drugi mirror = nasłuch + fallback.
    this.origin = NTFY_PRIMARY;
    this.stopped = false;
    this._warned = false;
    this.trace = trace || netLog;
  }

  start() {
    this.stopped = false;
    this.trace('syg: start — nasłuch na obu mirrorach, publikacja na ' + this.origin);
    for (const m of MIRRORS) this._ensureSub(m);
  }

  _ensureSub(origin) {
    if (this.stopped) return;
    let s = this.socks.get(origin);
    if (!s) {
      s = { ws: null, gen: 0, retry: 0, timer: null };
      this.socks.set(origin, s);
    }
    if (!s.ws) this._openSub(origin, s);
  }

  _openSub(origin, s) {
    if (this.stopped) return;
    const gen = ++s.gen; // nieświeży socket (po stop/ponownym otwarciu) nic już nie planuje
    const wsUrl = origin.replace('https://', 'wss://') + '/' + this.topic + '/ws';
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { this._scheduleReconnect(origin, s); return; }
    s.ws = ws;
    const stale = () => this.stopped || s.gen !== gen || s.ws !== ws;
    ws.onopen = () => {
      if (stale()) return;
      s.retry = 0;
      this.trace('syg: WS ' + origin + ' → połączony (nasłuch)');
    };
    ws.onmessage = (ev) => {
      if (stale()) return;
      try {
        const wrap = JSON.parse(ev.data);
        if (wrap.event && wrap.event !== 'message') return;
        const raw = wrap.message != null ? wrap.message : ev.data;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (msg && msg.t) for (const h of this.handlers) { try { h(msg); } catch (e) {} }
      } catch (e) { /* keepalive / binarne */ }
    };
    ws.onerror = () => { if (!stale()) { try { ws.close(); } catch (e) {} } };
    ws.onclose = () => {
      if (stale()) return;
      if (s.ws === ws) s.ws = null;
      this.trace('syg: WS ' + origin + ' zamknięty — reconnect z backoffem');
      this._scheduleReconnect(origin, s);
    };
  }

  _scheduleReconnect(origin, s) {
    if (this.stopped) return;
    const delay = Math.min(WS_BACKOFF_CAP, WS_BACKOFF_BASE * 2 ** s.retry) + Math.random() * 1000;
    s.retry++;
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = null;
      if (!this.stopped) this._openSub(origin, s);
    }, delay);
  }

  _warnOnce(msg) {
    if (this._warned) return;
    this._warned = true;
    netWarn(msg);
  }

  // Przełącza TYLKO mirror publikacji. Socketów nie tyka — oba i tak słuchają.
  _adoptMirror(next, reason) {
    if (this.origin === next) return;
    this.origin = next;
    this.trace('syg: publikacja → ' + next + ' (' + reason + ')');
    this._ensureSub(next);
  }

  // Jednorazowy retry uszkodzonej wiadomości na drugim mirrorze (sekwencyjnie,
  // nigdy równolegle do obu). Przy sukcesie mirror staje się nowym aktywnym.
  _failover(failedOrigin, body, reason) {
    if (this.stopped) return;
    const next = failedOrigin === NTFY_PRIMARY ? NTFY_FALLBACK : NTFY_PRIMARY;
    this.trace('syg: publikacja nie przeszła (' + reason + ') — retry na ' + next);
    fetch(next + '/' + this.topic, { method: 'POST', body }).then(
      (res2) => {
        if (res2 && res2.ok) this._adoptMirror(next, reason + ' na ' + failedOrigin);
        else this._warnOnce('syg: ' + reason + ' na ' + failedOrigin + ' (fallback też nie odpowiada)');
      },
      () => this._warnOnce('syg: ' + reason + ' na ' + failedOrigin + ' (fallback też nie odpowiada)'),
    );
  }

  // Retry przez DRUGI mirror bez czekania na błąd POST — np. oferta bez odpowiedzi,
  // gdy publikacja trafiła na mirror, którego WS nie dowozi drugiej stronie.
  resendOtherMirror(obj) {
    if (this.stopped) return;
    const next = this.origin === NTFY_PRIMARY ? NTFY_FALLBACK : NTFY_PRIMARY;
    this._adoptMirror(next, 'retry przez drugi mirror');
    this.send(obj);
  }

  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }

  send(obj, quiet = false) {
    const body = JSON.stringify(obj);
    const origin = this.origin;
    if (!quiet) this.trace('syg: → POST {t:' + obj.t + '} na ' + origin);
    fetch(origin + '/' + this.topic, { method: 'POST', body }).then(
      (res) => {
        if (!res || res.ok) return;
        // 429 / 5xx → fallback. Inne 4xx to błąd treści — retry nic nie da.
        if (res.status === 429 || res.status >= 500) this._failover(origin, body, 'HTTP ' + res.status);
        else this._warnOnce('syg: publikacja na ' + origin + ' → HTTP ' + res.status + ' (ignoruję)');
      },
      () => this._failover(origin, body, 'błąd sieci'),
    );
  }

  stop() {
    this.stopped = true;
    for (const s of this.socks.values()) {
      s.gen++; // unieważnij onclose/onopen starych socketów
      if (s.timer) { clearTimeout(s.timer); s.timer = null; }
      try { if (s.ws) s.ws.close(); } catch (e) {}
      s.ws = null;
    }
    this.socks.clear();
    this.handlers.clear();
  }
}

/* ------------------------ WebRTC helper ------------------------ */

function wirePC(pc, onChan, onIce) {
  pc.onicecandidate = (e) => { if (e.candidate) onIce(e.candidate); };
  pc.ondatachannel = (e) => onChan(e.channel);
  pc._iceRestarts = 0;
  pc.oniceconnectionstatechange = () => {
    // Martwy peer nie może generować burzy kandydatów: maks. 2 restarty
    // na połączenie, każdy z ~1 s opóźnieniem.
    if (pc.iceConnectionState === 'failed' && pc._iceRestarts < 2) {
      pc._iceRestarts++;
      setTimeout(() => {
        if (pc.signalingState === 'closed') return;
        try { pc.restartIce(); } catch (e) {}
      }, 1000);
    }
  };
}

// Zbiera kandydatów ICE przez ~100 ms i wysyła JEDEN komunikat
// {t:'ice', from, to, candidates:[...]} zamiast osobnego POST-a na kandydata.
class IceBatcher {
  constructor(send) {
    this._send = send;
    this._q = [];
    this._t = null;
  }
  push(cand) {
    this._q.push(iceJSON(cand));
    if (!this._t) this._t = setTimeout(() => this.flush(), ICE_BATCH_MS);
  }
  flush() {
    this._t = null;
    if (!this._q.length) return;
    const batch = this._q;
    this._q = [];
    try { this._send(batch); } catch (e) {}
  }
  clear() {
    if (this._t) { clearTimeout(this._t); this._t = null; }
    this._q = [];
  }
}

// Odbiór: nowy format tablicowy + wsteczna kompatybilność z pojedynczym
// {candidate:...} (np. pad z cache'u sprzed aktualizacji).
function iceList(msg) {
  if (Array.isArray(msg.candidates)) return msg.candidates;
  if (msg.candidate) return [msg.candidate];
  return [];
}

function attachChan(ch, onMsg, onClose) {
  ch.binaryType = 'arraybuffer';
  ch.onmessage = (e) => {
    let data = e.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch (err) { return; }
    onMsg(data);
  };
  ch.onclose = onClose;
  ch.onerror = onClose;
}

function sendJSON(ch, msg) {
  if (ch && ch.readyState === 'open') {
    try { ch.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
  }
}

function waitOpen(ch, ms = 18000) {
  return new Promise((resolve, reject) => {
    if (ch.readyState === 'open') return resolve();
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    ch.onopen = () => { clearTimeout(t); resolve(); };
    ch.onerror = () => { clearTimeout(t); reject(new Error('channel')); };
  });
}

async function addIce(pc, cand, queue) {
  if (!pc.remoteDescription) { queue.push(cand); return; }
  try { await pc.addIceCandidate(cand); } catch (e) { /* stale */ }
}

async function flushIce(pc, queue) {
  while (queue.length) {
    try { await pc.addIceCandidate(queue.shift()); } catch (e) {}
  }
}

/* ------------------------------- HOST ---------------------------------- */

export class HostNet extends EventTarget {
  constructor() {
    super();
    this.players = new Map();
    this.code = null;
    this.peer = null;
    this.bus = null;
    this.pcs = new Map();
    this.localPlayer = null;
    this.status = 'init';
  }

  _trace(line) {
    netLog(line);
    this.emit('trace', line);
  }

  async start() {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = randomCode();
      const peer = await this._tryPeer(code);
      if (peer === 'taken') continue;
      this.code = code;
      if (peer && peer !== 'fail') this.peer = peer;
      this._startRtc(code);
      this.status = this.peer ? 'peerjs+rtc' : 'rtc';
      this._trace('host: start pokoju ' + code + ' (ścieżka: ' + this.status + ')');
      return code;
    }
    // last resort: RTC only, no uniqueness check
    this.code = randomCode();
    this._startRtc(this.code);
    this.status = 'rtc';
    this._trace('host: start pokoju ' + this.code + ' (ścieżka: rtc, bez sprawdzania PeerJS)');
    return this.code;
  }

  _tryPeer(code) {
    if (typeof Peer === 'undefined') return Promise.resolve('fail');
    return new Promise((resolve) => {
      const peer = newPeer(PREFIX + code);
      const timer = setTimeout(() => { try { peer.destroy(); } catch (e) {} resolve('fail'); }, 6000);
      const fail = (err) => {
        clearTimeout(timer);
        try { peer.destroy(); } catch (e) {}
        const type = err && (err.type || err.message);
        if (err && err.type === 'unavailable-id') {
          this._trace('host: PeerJS — kod zajęty (' + code + '), próbuję inny');
          resolve('taken');
        } else {
          this._trace('host: PeerJS błąd: ' + (type || 'nieznany') + ' — sygnalizacja pójdzie WebRTC/ntfy');
          resolve('fail');
        }
      };
      peer.on('error', fail);
      peer.on('open', () => {
        clearTimeout(timer);
        peer.off('error', fail);
        this._trace('host: PeerJS otwarty (' + peer.id + ')');
        peer.on('error', (e) => { this._trace('host: PeerJS błąd: ' + (e && (e.type || e.message))); });
        peer.on('connection', (conn) => this._onPeerConn(conn));
        resolve(peer);
      });
    });
  }

  _onPeerConn(conn) {
    // Host nie inicjuje połączenia PeerJS — przychodzące conn dziedziczy po padzie
    // ustawienia z peer.connect(...): serialization:'json' + reliable:true, więc
    // obie strony mówią JSON-em po niezawodnym kanale.
    const attach = () => {
      this._trace('host: kanał PeerJS od ' + conn.peer);
      conn.on('data', (msg) => this._onData({ send: (m) => { try { conn.send(m); } catch (e) {} }, peer: conn.peer }, msg));
    };
    if (conn.open) attach();
    else conn.on('open', attach);
    conn.on('close', () => this._remove(conn.peer));
    conn.on('error', () => this._remove(conn.peer));
  }

  _startRtc(code) {
    this.bus = new SignalBus(code, (l) => this._trace('host: ' + l));
    this.hostId = 'h' + rid(8);
    this._iceBuf = new Map();
    this.bus.on((msg) => this._onSignal(msg));
    this.bus.start();
    this._helloTimer = null;
    this._helloTimeout = null;
    this._startHello();
  }

  // Hello: raz ~150 ms po starcie, potem co HELLO_INTERVAL (12 s — limit ntfy
  // to 1 req / 5 s) i TYLKO dopóki żaden zdalny pad nie jest podłączony.
  _startHello() {
    if (!this.bus || this._helloTimer || this._helloTimeout) return;
    const hello = () => { try { this.bus.send({ t: 'host', from: this.hostId }, true); } catch (e) {} };
    this._helloTimeout = setTimeout(() => {
      this._helloTimeout = null;
      hello();
      this._trace('host: hello — sygnalizacja aktywna (host ' + this.hostId + ')');
      if (this.bus && !this._helloTimer) this._helloTimer = setInterval(hello, HELLO_INTERVAL);
    }, 150);
  }

  _stopHello() {
    if (this._helloTimeout) { clearTimeout(this._helloTimeout); this._helloTimeout = null; }
    if (this._helloTimer) { clearInterval(this._helloTimer); this._helloTimer = null; }
  }

  _hasRemotePlayers() {
    for (const p of this.players.values()) if (!p.local) return true;
    return false;
  }

  async _onSignal(msg) {
    if (!msg || msg.from === this.hostId) return;
    if (msg.t === 'offer' && msg.sdp) {
      const existing = this.pcs.get(msg.from);
      if (existing && existing.pc) {
        // Duplikat oferty — pad ponowił ją, bo nie doczekał się odpowiedzi
        // (np. zgubiony POST). Odpowiadamy ponownie zapamiętanym SDP.
        if (existing.answer) {
          this._trace('host: duplikat oferty od ' + msg.from + ' — ponawiam odpowiedź');
          this.bus.send({ t: 'answer', from: this.hostId, to: msg.from, sdp: existing.answer });
        }
        return;
      }
      await this._answer(msg);
    } else if (msg.t === 'ice') {
      const cands = iceList(msg);
      if (!cands.length) return;
      const slot = this.pcs.get(msg.from);
      if (slot) {
        for (const c of cands) await addIce(slot.pc, c, slot.q);
      } else {
        const buf = this._iceBuf.get(msg.from) || [];
        buf.push(...cands);
        this._iceBuf.set(msg.from, buf);
      }
    }
  }

  async _answer(msg) {
    const pc = new RTCPeerConnection(ICE);
    const q = [];
    const slot = { pc, q, ch: null, batcher: null, answer: null };
    this.pcs.set(msg.from, slot);
    slot.batcher = new IceBatcher((candidates) => {
      this.bus.send({ t: 'ice', from: this.hostId, to: msg.from, candidates });
    });
    this._trace('host: ← oferta od ' + msg.from);
    wirePC(pc, (ch) => this._bindRtcChan(msg.from, ch), (cand) => slot.batcher.push(cand));
    try {
      if (msg.sdp) {
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        // Kandydaci ICE, którzy doszli zanim dotarł offer (np. wyprzedził go po drodze),
        // czekali w _iceBuf — nie mogą zginąć po ustawieniu remoteDescription.
        const pre = this._iceBuf.get(msg.from);
        if (pre && pre.length) {
          q.push(...pre);
          this._iceBuf.delete(msg.from);
        }
        await flushIce(pc, q);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        slot.answer = pc.localDescription.sdp;
        this.bus.send({ t: 'answer', from: this.hostId, to: msg.from, sdp: slot.answer });
        this._trace('host: → odpowiedź do ' + msg.from);
      }
    } catch (e) {
      this._trace('host: błąd odpowiedzi dla ' + msg.from + ': ' + (e && e.message));
      netWarn('answer failed', e);
      try { slot.batcher.clear(); } catch (err) {}
      this.pcs.delete(msg.from);
      try { pc.close(); } catch (err) {}
    }
  }

  _bindRtcChan(id, ch) {
    const slot = this.pcs.get(id);
    if (slot) slot.ch = ch;
    this._trace('host: kanał WebRTC z ' + id + ' otwarty');
    const conn = {
      peer: id,
      send: (m) => sendJSON(ch, m),
    };
    attachChan(ch, (msg) => this._onData(conn, msg), () => this._remove(id));
  }

  _onData(conn, msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'join') {
      if (this.players.has(conn.peer)) return;
      const colors = ['#ff8c12', '#ffd93d', '#ff5a1f', '#ffb347', '#ff3d00', '#ffe89a', '#d9560a', '#ffa64d'];
      const p = {
        id: conn.peer,
        name: (msg.name || 'Gracz').slice(0, 12),
        conn,
        color: colors[this.players.size % colors.length],
        input: emptyInput(),
        ping: 0,
      };
      this.players.set(conn.peer, p);
      this._trace('host: join od ' + conn.peer + ' (' + p.name + ') — graczy: ' + this.players.size);
      // Pierwszy gracz dołączył — sygnalizacja nie jest już potrzebna w tle.
      this._stopHello();
      conn.send({ t: 'welcome', color: p.color, index: this.players.size - 1 });
      this.emit('players');
      this.emit('join', p);
    } else if (msg.t === 'in') {
      const p = this.players.get(conn.peer);
      if (!p) return;
      p.input.ax = msg.ax || 0;
      p.input.ay = msg.ay || 0;
      const prev = p.input.btn;
      p.input.btn = msg.b || {};
      for (const k of Object.keys(p.input.btn)) {
        if (p.input.btn[k] && !prev[k]) p.input.pressed[k] = true;
      }
    } else if (msg.t === 'tap') {
      this.emit('tap', { player: this.players.get(conn.peer), key: msg.k });
    }
  }

  addLocal(name = 'Klawiatura') {
    if (this.localPlayer) return this.localPlayer;
    const colors = ['#ff8c12', '#ffd93d', '#ff5a1f', '#ffb347', '#ff3d00', '#ffe89a', '#d9560a', '#ffa64d'];
    const id = 'local-' + rid(4);
    const p = {
      id,
      name,
      conn: { send() {}, open: true },
      color: colors[this.players.size % colors.length],
      input: emptyInput(),
      ping: 0,
      local: true,
    };
    this.players.set(id, p);
    this.localPlayer = p;
    this.emit('players');
    this.emit('join', p);
    return p;
  }

  _remove(id) {
    const slot = this.pcs.get(id);
    if (slot) {
      try { slot.batcher && slot.batcher.clear(); } catch (e) {}
      try { slot.pc.close(); } catch (e) {}
      this.pcs.delete(id);
    }
    if (this.players.delete(id)) {
      this._trace('host: rozłączono ' + id);
      this.emit('players');
      // Lobby opustoszało (został co najwyżej lokalny gracz) — wznów hello.
      if (!this._hasRemotePlayers()) this._startHello();
    }
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  list() {
    return [...this.players.values()];
  }

  broadcast(msg) {
    for (const p of this.players.values()) {
      try { p.conn.send(msg); } catch (e) { /* ignore */ }
    }
  }

  send(player, msg) {
    try { player.conn.send(msg); } catch (e) { /* ignore */ }
  }

  clearPressed() {
    for (const p of this.players.values()) p.input.pressed = {};
  }
}

export function emptyInput() {
  return { ax: 0, ay: 0, btn: {}, pressed: {} };
}

/* ---------------------------- CONTROLLER -------------------------------- */

export class ClientNet extends EventTarget {
  constructor() {
    super();
    this.conn = null;
    this.peer = null;
    this.pc = null;
    this.ch = null;
    this.bus = null;
    this._send = null;
  }

  _trace(line) {
    netLog(line);
    try { this.dispatchEvent(new CustomEvent('trace', { detail: line })); } catch (e) {}
  }

  connect(code, name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleaners = { peer: null, rtc: null };
      let timer = null;
      // Zwycięska ścieżka zwraca true — tylko ona może wysłać join.
      // Przegrana zamyka się sama (cleaner), żeby nigdy nie było dual-joina.
      const win = (path, send) => {
        if (settled) {
          try { cleaners[path] && cleaners[path](); } catch (e) {}
          return false;
        }
        settled = true;
        clearTimeout(timer);
        this._send = send;
        for (const k of Object.keys(cleaners)) {
          if (k !== path) try { cleaners[k] && cleaners[k](); } catch (e) {}
        }
        resolve();
        return true;
      };
      const failAll = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const k of Object.keys(cleaners)) try { cleaners[k] && cleaners[k](); } catch (e) {}
        reject(err);
      };

      this._connectRtc(code, name, win, cleaners);
      this._connectPeer(code, name, win, cleaners);

      timer = setTimeout(() => {
        failAll(new Error('Nie udało się połączyć — sprawdź, czy kod (4 cyfry) jest poprawny i czy konsola jest otwarta na dużym ekranie.'));
      }, 18000);
    });
  }

  _connectPeer(code, name, win, cleaners) {
    if (typeof Peer === 'undefined') {
      this._trace('pad: biblioteka PeerJS niedostępna — tylko WebRTC/ntfy');
      return;
    }
    let peer, conn;
    try { peer = newPeer(undefined); } catch (e) {
      this._trace('pad: nie udało się utworzyć PeerJS: ' + (e && e.message));
      return;
    }
    this.peer = peer;
    const cleanupPeer = () => {
      try { conn && conn.close(); } catch (e) {}
      try { peer.destroy(); } catch (e) {}
    };
    cleaners.peer = cleanupPeer;
    this._trace('pad: PeerJS — łączę z chmurą 0.peerjs.com');
    peer.on('error', (e) => {
      this._trace('pad: PeerJS błąd: ' + (e && (e.type || e.message)) || 'nieznany');
      netWarn('peerjs pad error', e);
    });
    peer.on('open', () => {
      this._trace('pad: PeerJS otwarty — dzwonię do hosta (' + PREFIX + code + ')');
      setTimeout(() => {
        if (this._send) return;
        conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          // Najpierw walcz o zwycięstwo, dopiero zwycięzca wysyła join.
          const snd = (msg) => { try { if (conn.open) conn.send(msg); } catch (e) {} };
          if (!win('peer', snd)) { try { conn.close(); } catch (e) {} return; }
          this.conn = conn;
          this._trace('pad: kanał PeerJS otwarty — wysyłam join');
          conn.on('data', (m) => this.dispatchEvent(new CustomEvent('msg', { detail: m })));
          conn.on('close', () => { cleanupPeer(); this.dispatchEvent(new Event('close')); });
          conn.on('error', () => { cleanupPeer(); this.dispatchEvent(new Event('close')); });
          conn.send({ t: 'join', name });
        });
        conn.on('error', (e) => {
          this._trace('pad: PeerJS połączenie — błąd: ' + (e && (e.type || e.message)) || 'nieznany');
        });
      }, 350);
    });
  }

  _connectRtc(code, name, win, cleaners) {
    const bus = new SignalBus(code, (l) => this._trace('pad: ' + l));
    this.bus = bus;
    const me = 'c' + rid(8);
    const pc = new RTCPeerConnection(ICE);
    this.pc = pc;
    const q = [];
    const ch = pc.createDataChannel('pad', { ordered: true });
    this.ch = ch;
    const batcher = new IceBatcher((candidates) => {
      bus.send({ t: 'ice', from: me, to: this._hostId, candidates });
    });
    let answered = false;
    let offerTimer = null;
    let wonLocal = false;
    const disarmOfferRetry = () => {
      if (offerTimer) { clearTimeout(offerTimer); offerTimer = null; }
    };
    const cleanupRtc = () => {
      batcher.clear();
      disarmOfferRetry();
      try { pc.close(); } catch (e) {}
      bus.stop();
    };
    cleaners.rtc = cleanupRtc;

    bus.on(async (msg) => {
      if (!msg || msg.from === me) return;
      if (msg.t === 'host') {
        const first = !this._hostId;
        this._hostId = msg.from;
        if (first) this._trace('pad: host obecny (' + msg.from + ')');
      }
      if (msg.t === 'answer' && msg.to === me && msg.sdp) {
        try {
          if (!pc.currentRemoteDescription) {
            answered = true;
            disarmOfferRetry();
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
            await flushIce(pc, q);
            this._trace('pad: ← odpowiedź hosta — zestawiam ICE');
          }
        } catch (e) {
          this._trace('pad: błąd przy odpowiedzi hosta: ' + (e && e.message));
          netWarn(e);
        }
      }
      if (msg.t === 'ice' && (msg.to === me || !msg.to)) {
        for (const c of iceList(msg)) await addIce(pc, c, q);
      }
    });
    bus.start();
    this._trace('pad: sygnalizacja ntfy — kod ' + code + ', ja=' + me);

    pc.onicecandidate = (e) => {
      if (e.candidate) batcher.push(e.candidate);
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') { disarmOfferRetry(); this._trace('pad: ICE ' + st); }
      else if (st === 'failed' || st === 'disconnected') this._trace('pad: ICE ' + st);
    };

    const finishRtc = () => {
      disarmOfferRetry();
      // Zwycięzca tylko jeden — join leci wyłącznie z tej ścieżki.
      const snd = (msg) => sendJSON(ch, msg);
      if (!win('rtc', snd)) { try { ch.close(); } catch (e) {} return; }
      wonLocal = true;
      attachChan(ch, (m) => this.dispatchEvent(new CustomEvent('msg', { detail: m })),
        () => { cleanupRtc(); this.dispatchEvent(new Event('close')); });
      this._trace('pad: kanał WebRTC otwarty — wysyłam join');
      sendJSON(ch, { t: 'join', name });
    };
    const go = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this._trace('pad: → oferta WebRTC');
        bus.send({ t: 'offer', from: me, sdp: pc.localDescription.sdp });
        // Samoleczenie handshake'u: jeśli host nie odpowiedział w OFFER_RETRY_MS,
        // wyślij ofertę jeszcze raz przez DRUGI mirror (maks. +1 POST). Host
        // odpowiada ponownie na duplikat, więc zgubiona odpowiedź się odtwarza.
        offerTimer = setTimeout(() => {
          offerTimer = null;
          if (answered || wonLocal || bus.stopped) return;
          if (pc.signalingState === 'closed') return;
          this._trace('pad: brak odpowiedzi hosta przez ' + OFFER_RETRY_MS + ' ms — ponawiam ofertę');
          bus.resendOtherMirror({ t: 'offer', from: me, sdp: pc.localDescription.sdp });
        }, OFFER_RETRY_MS);
        try {
          await waitOpen(ch, 16000);
          finishRtc();
        } catch (e) {
          // Kanał nie otworzył się w 16 s (np. bardzo wolny TURN) — ale connect()
          // ma limit 18 s: nie rezygnuj z RTC, jeśli kanał otworzy się w ostatniej chwili.
          disarmOfferRetry();
          if (e && e.message === 'timeout') {
            this._trace('pad: kanał nie otworzył się w 16 s — nasłuchuję do końca limitu');
            ch.onopen = () => { if (!this._send && ch.readyState === 'open') finishRtc(); };
          } else {
            this._trace('pad: błąd kanału WebRTC: ' + (e && e.message ? e.message : e));
          }
        }
      } catch (e) {
        disarmOfferRetry();
        this._trace('pad: błąd WebRTC: ' + (e && e.message ? e.message : e));
      }
    };
    setTimeout(go, 400);
  }

  send(msg) {
    if (this._send) this._send(msg);
    else if (this.conn && this.conn.open) this.conn.send(msg);
    else sendJSON(this.ch, msg);
  }
}
