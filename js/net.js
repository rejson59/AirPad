// AirPad networking: WebRTC peer-to-peer via PeerJS public cloud (no server needed)

export const PREFIX = 'airpad-x7k-';

export function randomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function newPeer(id) {
  return new Peer(id, {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    },
  });
}

/* ------------------------------- HOST ---------------------------------- */

export class HostNet extends EventTarget {
  constructor() {
    super();
    this.players = new Map(); // id -> {id, name, conn, color, input}
    this.code = null;
    this.peer = null;
  }

  async start() {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = randomCode();
      try {
        await this._tryCode(code);
        this.code = code;
        return code;
      } catch (e) {
        if (e === 'taken') continue;
        throw e;
      }
    }
    throw new Error('Nie udało się utworzyć pokoju');
  }

  _tryCode(code) {
    return new Promise((resolve, reject) => {
      const peer = newPeer(PREFIX + code);
      const fail = (err) => {
        peer.destroy();
        reject(err && err.type === 'unavailable-id' ? 'taken' : err);
      };
      peer.on('error', fail);
      peer.on('open', () => {
        peer.off('error', fail);
        this.peer = peer;
        this._wire();
        resolve();
      });
    });
  }

  _wire() {
    this.peer.on('error', (e) => console.warn('peer error', e));
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        conn.on('data', (msg) => this._onData(conn, msg));
      });
      conn.on('close', () => this._remove(conn.peer));
      conn.on('error', () => this._remove(conn.peer));
    });
  }

  _onData(conn, msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'join') {
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

  _remove(id) {
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

  /** Consume "just pressed" flags — call once per frame after reading. */
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
  }

  connect(code, name) {
    return new Promise((resolve, reject) => {
      const peer = newPeer(undefined);
      this.peer = peer;
      let done = false;
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: false, serialization: 'json' });
        this.conn = conn;
        const timer = setTimeout(() => {
          if (!done) { done = true; reject(new Error('Brak odpowiedzi — sprawdź kod')); }
        }, 12000);
        conn.on('open', () => {
          done = true;
          clearTimeout(timer);
          conn.send({ t: 'join', name });
          conn.on('data', (m) => this.dispatchEvent(new CustomEvent('msg', { detail: m })));
          conn.on('close', () => this.dispatchEvent(new Event('close')));
          resolve();
        });
        conn.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
      });
      peer.on('error', (e) => {
        if (done) return;
        done = true;
        reject(new Error(e.type === 'peer-unavailable' ? 'Nie znaleziono pokoju o tym kodzie' : e.message || 'Błąd połączenia'));
      });
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }
}
