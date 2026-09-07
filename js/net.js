// AirPad networking
// Two independent paths, first one that opens a data channel wins:
//   1) Native WebRTC + public ntfy.sh (and mirrors) as signaling — no PeerJS cloud
//   2) PeerJS cloud (0.peerjs.com) with the REAL PeerJS TURN servers
// The previous build replaced PeerJS TURN with dead Metered OpenRelay, so phones
// on LTE / client-isolated Wi-Fi hung until "Brak odpowiedzi — sprawdź kod".

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

const NTFY = ['https://ntfy.sh', 'https://ntfy.envs.net'];

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
  constructor(code) {
    this.topic = topicFor(code);
    this.handlers = new Set();
    this.sockets = [];
    this.alive = false;
  }

  start() {
    for (const origin of NTFY) {
      const wsUrl = origin.replace('https://', 'wss://') + '/' + this.topic + '/ws';
      this._open(wsUrl, origin);
    }
  }

  _open(wsUrl, origin) {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return; }
    this.sockets.push({ ws, origin });
    ws.onopen = () => { this.alive = true; };
    ws.onmessage = (ev) => {
      try {
        const wrap = JSON.parse(ev.data);
        if (wrap.event && wrap.event !== 'message') return;
        const raw = wrap.message != null ? wrap.message : ev.data;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (msg && msg.t) for (const h of this.handlers) h(msg);
      } catch (e) { /* ignore keepalives */ }
    };
    ws.onclose = () => {
      setTimeout(() => { if (this.sockets.some(s => s.ws === ws)) this._open(wsUrl, origin); }, 1500);
    };
  }

  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }

  send(obj) {
    const body = JSON.stringify(obj);
    for (const origin of NTFY) {
      fetch(origin + '/' + this.topic, { method: 'POST', body }).catch(() => {});
    }
  }

  stop() {
    for (const s of this.sockets) try { s.ws.close(); } catch (e) {}
    this.sockets = [];
    this.handlers.clear();
  }
}

/* ------------------------ WebRTC helper ------------------------ */

function wirePC(pc, onChan, onIce) {
  pc.onicecandidate = (e) => { if (e.candidate) onIce(e.candidate); };
  pc.ondatachannel = (e) => onChan(e.channel);
  pc.oniceconnectionstatechange = () => {
    const st = pc.iceConnectionState;
    if (st === 'failed') try { pc.restartIce(); } catch (e) {}
  };
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

  async start() {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = randomCode();
      const peer = await this._tryPeer(code);
      if (peer === 'taken') continue;
      this.code = code;
      if (peer && peer !== 'fail') this.peer = peer;
      this._startRtc(code);
      this.status = this.peer ? 'peerjs+rtc' : 'rtc';
      return code;
    }
    // last resort: RTC only, no uniqueness check
    this.code = randomCode();
    this._startRtc(this.code);
    this.status = 'rtc';
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
        resolve(err && err.type === 'unavailable-id' ? 'taken' : 'fail');
      };
      peer.on('error', fail);
      peer.on('open', () => {
        clearTimeout(timer);
        peer.off('error', fail);
        peer.on('error', (e) => console.warn('peer error', e));
        peer.on('connection', (conn) => this._onPeerConn(conn));
        resolve(peer);
      });
    });
  }

  _onPeerConn(conn) {
    const attach = () => {
      conn.on('data', (msg) => this._onData({ send: (m) => { try { conn.send(m); } catch (e) {} }, peer: conn.peer }, msg));
    };
    if (conn.open) attach();
    else conn.on('open', attach);
    conn.on('close', () => this._remove(conn.peer));
    conn.on('error', () => this._remove(conn.peer));
  }

  _startRtc(code) {
    this.bus = new SignalBus(code);
    this.hostId = 'h' + rid(8);
    this._iceBuf = new Map();
    this.bus.on((msg) => this._onSignal(msg));
    this.bus.start();
    const hello = () => this.bus.send({ t: 'host', from: this.hostId });
    setTimeout(hello, 150);
    this._helloTimer = setInterval(hello, 2500);
  }

  async _onSignal(msg) {
    if (!msg || msg.from === this.hostId) return;
    if (msg.t === 'offer' && msg.sdp) {
      if (this.pcs.has(msg.from)) return;
      await this._answer(msg);
    } else if (msg.t === 'ice' && msg.candidate) {
      const slot = this.pcs.get(msg.from);
      if (slot) addIce(slot.pc, msg.candidate, slot.q);
      else {
        const buf = this._iceBuf.get(msg.from) || [];
        buf.push(msg.candidate);
        this._iceBuf.set(msg.from, buf);
      }
    }
  }

  async _answer(msg) {
    const pc = new RTCPeerConnection(ICE);
    const q = [];
    const slot = { pc, q, ch: null };
    this.pcs.set(msg.from, slot);
    wirePC(pc, (ch) => this._bindRtcChan(msg.from, ch), (cand) => {
      this.bus.send({ t: 'ice', from: this.hostId, to: msg.from, candidate: iceJSON(cand) });
    });
    try {
      if (msg.sdp) {
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        await flushIce(pc, q);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.bus.send({ t: 'answer', from: this.hostId, to: msg.from, sdp: pc.localDescription.sdp });
      }
    } catch (e) {
      console.warn('answer failed', e);
      this.pcs.delete(msg.from);
      try { pc.close(); } catch (err) {}
    }
  }

  _bindRtcChan(id, ch) {
    const slot = this.pcs.get(id);
    if (slot) slot.ch = ch;
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
      try { slot.pc.close(); } catch (e) {}
      this.pcs.delete(id);
    }
    if (this.players.delete(id)) this.emit('players');
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

  connect(code, name) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleaners = { peer: null, rtc: null };
      const win = (path, send) => {
        if (settled) {
          try { cleaners[path] && cleaners[path](); } catch (e) {}
          return;
        }
        settled = true;
        this._send = send;
        for (const k of Object.keys(cleaners)) {
          if (k !== path) try { cleaners[k] && cleaners[k](); } catch (e) {}
        }
        resolve();
      };
      const failAll = (err) => {
        if (settled) return;
        settled = true;
        for (const k of Object.keys(cleaners)) try { cleaners[k] && cleaners[k](); } catch (e) {}
        reject(err);
      };

      this._connectRtc(code, name, win, cleaners);
      this._connectPeer(code, name, win, cleaners);

      setTimeout(() => {
        failAll(new Error('Brak odpowiedzi — sprawdź kod i czy konsola nadal jest otwarta'));
      }, 20000);
    });
  }

  _connectPeer(code, name, win, cleaners) {
    if (typeof Peer === 'undefined') return;
    let peer, conn;
    try { peer = newPeer(undefined); } catch (e) { return; }
    this.peer = peer;
    cleaners.peer = () => {
      try { conn && conn.close(); } catch (e) {}
      try { peer.destroy(); } catch (e) {}
    };
    peer.on('error', () => {});
    peer.on('open', () => {
      setTimeout(() => {
        if (this._send) return;
        conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          if (this._send) { try { conn.close(); } catch (e) {} return; }
          this.conn = conn;
          conn.on('data', (m) => this.dispatchEvent(new CustomEvent('msg', { detail: m })));
          conn.on('close', () => this.dispatchEvent(new Event('close')));
          win('peer', (msg) => { try { if (conn.open) conn.send(msg); } catch (e) {} });
          conn.send({ t: 'join', name });
        });
      }, 350);
    });
  }

  _connectRtc(code, name, win, cleaners) {
    const bus = new SignalBus(code);
    this.bus = bus;
    const me = 'c' + rid(8);
    const pc = new RTCPeerConnection(ICE);
    this.pc = pc;
    const q = [];
    const ch = pc.createDataChannel('pad', { ordered: true });
    this.ch = ch;
    cleaners.rtc = () => { try { pc.close(); bus.stop(); } catch (e) {} };

    bus.on(async (msg) => {
      if (!msg || msg.from === me) return;
      if (msg.t === 'host') this._hostId = msg.from;
      if (msg.t === 'answer' && msg.to === me && msg.sdp) {
        try {
          if (!pc.currentRemoteDescription) {
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
            await flushIce(pc, q);
          }
        } catch (e) { console.warn(e); }
      }
      if (msg.t === 'ice' && msg.candidate && (msg.to === me || !msg.to)) addIce(pc, msg.candidate, q);
    });
    bus.start();

    pc.onicecandidate = (e) => {
      if (e.candidate) bus.send({ t: 'ice', from: me, to: this._hostId, candidate: iceJSON(e.candidate) });
    };

    const go = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        bus.send({ t: 'offer', from: me, sdp: pc.localDescription.sdp });
        await waitOpen(ch, 16000);
        if (this._send) return;
        attachChan(ch, (m) => this.dispatchEvent(new CustomEvent('msg', { detail: m })),
          () => this.dispatchEvent(new Event('close')));
        win('rtc', (msg) => sendJSON(ch, msg));
        sendJSON(ch, { t: 'join', name });
      } catch (e) { /* peer path may still win */ }
    };
    setTimeout(go, 400);
  }

  send(msg) {
    if (this._send) this._send(msg);
    else if (this.conn && this.conn.open) this.conn.send(msg);
    else sendJSON(this.ch, msg);
  }
}
sg);
    else if (this.conn && this.conn.open) this.conn.send(msg);
    else sendJSON(this.ch, msg);
  }
}
