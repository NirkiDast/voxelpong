// Thin wrapper around PeerJS (loaded globally from vendor/peerjs.min.js).
// The PC page is the "host" peer; each phone connects to it with a data channel.
// PeerJS's free cloud broker is only used for the initial handshake; game data
// flows directly phone <-> PC over WebRTC.

export const ID_PREFIX = 'vxpp-';

// Optional ?signal=host:port[:secure] lets you point at a self-hosted PeerJS server.
export function peerConfig() {
  const params = new URLSearchParams(location.search);
  const sig = params.get('signal');
  const cfg = { debug: 1 };
  if (sig) {
    const [host, port, secure] = sig.split(':');
    Object.assign(cfg, { host, port: Number(port) || 9000, path: '/', secure: secure === 'secure' });
  }
  return cfg;
}

export function signalParam() {
  const sig = new URLSearchParams(location.search).get('signal');
  return sig ? `&signal=${encodeURIComponent(sig)}` : '';
}

// A second, lossy data channel for high-rate input. Lost or late packets are dropped instead of
// retransmitted, so a hiccup on Wi-Fi never queues up stale paddle positions behind it.
// Both sides create it with the same id (negotiated), so no extra signaling round trip is needed.
const FAST_ID = 100;
function openFast(conn, onMessage) {
  const pc = conn.peerConnection;
  if (!pc) return null;
  try {
    const ch = pc.createDataChannel('fast', { negotiated: true, id: FAST_ID, ordered: false, maxRetransmits: 0 });
    ch.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch { /* ignore malformed */ }
    };
    return ch;
  } catch (err) {
    console.warn('fast channel unavailable', err);
    return null;
  }
}

function sendOn(fast, conn, msg) {
  if (fast && fast.readyState === 'open') fast.send(JSON.stringify(msg));
  else if (conn && conn.open) conn.send(msg);
}

function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

function storedCode() {
  try { return localStorage.getItem('vxpp-room'); } catch { return null; }
}
function storeCode(c) {
  try { localStorage.setItem('vxpp-room', c); } catch { /* private mode */ }
}

// Host: keeps one connection per controller slot (1, 2).
export class Host {
  constructor({ onStatus, onJoin, onLeave, onData }) {
    this.handlers = { onStatus, onJoin, onLeave, onData };
    this.conns = new Map(); // slot -> DataConnection
    this.fast = new Map();  // slot -> RTCDataChannel (lossy)
    this.code = storedCode() || makeCode();
    this.retries = 0;
    this.start();
  }

  start() {
    const Peer = window.Peer;
    if (!Peer) { this.handlers.onStatus('error', 'PeerJS failed to load'); return; }
    this.handlers.onStatus('connecting');
    const peer = new Peer(ID_PREFIX + this.code, peerConfig());
    this.peer = peer;
    peer.on('open', () => {
      storeCode(this.code);
      this.retries = 0;
      this.handlers.onStatus('ready', this.code);
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      this.handlers.onStatus('connecting');
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1000);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // The old id can linger for a few seconds after a refresh; retry, then pick a new code.
        peer.destroy();
        if (++this.retries > 3) { this.code = makeCode(); this.retries = 0; }
        setTimeout(() => this.start(), 1500);
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        this.handlers.onStatus('error', 'Cannot reach the pairing server. Retrying…');
        peer.destroy();
        setTimeout(() => this.start(), 3000);
      } else {
        console.warn('peer error', err.type, err);
      }
    });
  }

  accept(conn) {
    const slot = Number(conn.metadata?.slot) || 1;
    conn.on('open', () => {
      const old = this.conns.get(slot);
      if (old && old !== conn) old.close();
      this.conns.set(slot, conn);
      this.fast.set(slot, openFast(conn, (m) => this.handlers.onData(slot, m)));
      this.handlers.onJoin(slot);
    });
    conn.on('data', (msg) => this.handlers.onData(slot, msg));
    const drop = () => {
      if (this.conns.get(slot) === conn) {
        this.conns.delete(slot);
        this.fast.delete(slot);
        this.handlers.onLeave(slot);
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  send(slot, msg) {
    const c = this.conns.get(slot);
    if (c && c.open) c.send(msg);
  }

  sendFast(slot, msg) {
    sendOn(this.fast.get(slot), this.conns.get(slot), msg);
  }

  controllerUrl(slot) {
    const u = new URL('controller.html', location.href);
    return `${u.origin}${u.pathname}?room=${this.code}&slot=${slot}${signalParam()}`;
  }
}

// Controller: connects to the host and auto-reconnects.
export class Controller {
  constructor({ room, slot, onStatus, onData }) {
    Object.assign(this, { room, slot, onStatus, onData });
    this.conn = null;
    this.start();
  }

  start() {
    this.onStatus('connecting');
    const peer = new window.Peer(peerConfig());
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('error', (err) => {
      console.warn('peer error', err.type);
      if (err.type === 'peer-unavailable') this.onStatus('nohost');
      this.retry();
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  connect() {
    const conn = this.peer.connect(ID_PREFIX + this.room, {
      metadata: { slot: this.slot },
      serialization: 'json',
    });
    this.conn = conn;
    conn.on('open', () => {
      this.fast = openFast(conn, (m) => this.onData(m));
      this.onStatus('connected');
    });
    conn.on('data', (m) => this.onData(m));
    conn.on('close', () => { this.onStatus('lost'); this.retry(); });
  }

  retry() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.conn && this.conn.open) return;
      if (this.peer && !this.peer.destroyed && this.peer.open) this.connect();
      else { this.peer?.destroy(); this.start(); }
    }, 2000);
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  sendFast(msg) {
    sendOn(this.fast, this.conn, msg);
  }
}
