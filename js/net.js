// Thin wrapper around PeerJS (loaded globally from vendor/peerjs.min.js).
// The PC page is the "host" peer; each phone connects to it with a data channel.
// PeerJS's free cloud broker is only used for the initial handshake; game data
// flows directly phone <-> PC over WebRTC.

import { BROKERS, MqttLink, topicUp, topicDown } from './relay.js';

export const ID_PREFIX = 'vxpp-';
// How long the phone waits for the direct link before switching to the relay.
const DIRECT_WAIT = 7000;
const RELAY_FAST_MS = 33;   // input over the relay is capped at ~30 messages a second

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

// Each game page keeps its own room code, so having ping pong and tennis open in two tabs
// doesn't make them fight over the same pairing id.
function storedCode(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storeCode(key, c) {
  try { localStorage.setItem(key, c); } catch { /* private mode */ }
}

// Host: keeps one connection per controller slot (1, 2).
export class Host {
  constructor({ onStatus, onJoin, onLeave, onData, roomKey = 'vxpp-room' }) {
    this.handlers = { onStatus, onJoin, onLeave, onData };
    this.roomKey = roomKey;
    this.lastSeen = {};     // slot -> when that phone last dropped, to spot quick reconnects
    this.conns = new Map(); // slot -> DataConnection
    this.fast = new Map();  // slot -> RTCDataChannel (lossy)
    this.counts = {};       // slot -> messages received per channel, for the diagnostics panel
    this.code = storedCode(roomKey) || makeCode();
    this.retries = 0;
    this.relays = new Map(); // slot -> { link, cid, last } for phones on the fallback relay
    this.links = [];         // one link per public broker; phones may use any of them
    this.relayCode = null;
    this.start();
    setInterval(() => this.checkRelays(), 1000);
  }

  // Listen on every broker so a phone can fall back to whichever one it reaches.
  startRelay() {
    const code = this.code;
    BROKERS.forEach((url, k) => {
      const go = () => {
        if (this.relayCode !== code) return;
        const link = new MqttLink(url, (topic, m) => this.relayData(link, m), () => setTimeout(go, 3000));
        link.connect(8000).then(() => {
          this.links[k] = link;
          link.subscribe(topicUp(code));
          // Pairing server down or blocked? The relay alone is enough to show the QR code.
          if (!this.peer?.open && !this.readyViaRelay) { this.readyViaRelay = true; storeCode(this.roomKey, code); this.handlers.onStatus('ready', code); }
        }).catch(() => setTimeout(go, 15000));
      };
      go();
    });
  }

  relayData(link, msg) {
    const slot = Number(msg?.s) === 2 ? 2 : 1;
    if (!msg || !msg.c) return;
    const direct = this.conns.get(slot);
    if (direct && direct.open) return;                 // the direct link wins when both work
    let r = this.relays.get(slot);
    if (!r || r.cid !== msg.c) {
      const rejoin = !!r || performance.now() - (this.lastSeen[slot] || -1e9) < 20000;
      r = { link, cid: msg.c, last: performance.now() };
      this.relays.set(slot, r);
      this.counts[slot] = { fast: 0, reliable: 0 };
      this.handlers.onJoin(slot, rejoin);
    }
    r.link = link;
    r.last = performance.now();
    if (msg.m) { this.counts[slot].reliable++; this.handlers.onData(slot, msg.m); }
  }

  checkRelays() {
    for (const [slot, r] of this.relays) {
      if (performance.now() - r.last > 6000) {
        this.relays.delete(slot);
        this.lastSeen[slot] = performance.now();
        if (!this.conns.get(slot)?.open) this.handlers.onLeave(slot);
      }
    }
  }

  relaySend(slot, msg) {
    const r = this.relays.get(slot);
    if (r) r.link.publish(topicDown(this.code, slot), { c: r.cid, m: msg });
  }

  // True when a phone is linked in either way (used for the lobby status).
  connected(slot) { return !!(this.conns.get(slot)?.open || this.relays.get(slot)); }

  start() {
    const Peer = window.Peer;
    if (!Peer) { this.handlers.onStatus('error', 'PeerJS failed to load'); return; }
    if (!this.readyViaRelay) this.handlers.onStatus('connecting');
    // The relay listens on the same room code, and works even if the pairing server is unreachable.
    if (this.relayCode !== this.code) {
      this.relayCode = this.code;
      this.readyViaRelay = false;
      this.links.forEach((l) => l?.close());
      this.links = [];
      this.startRelay();
    }
    const peer = new Peer(ID_PREFIX + this.code, peerConfig());
    this.peer = peer;
    peer.on('open', () => {
      storeCode(this.roomKey, this.code);
      this.retries = 0;
      this.handlers.onStatus('ready', this.code);
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (!this.readyViaRelay) this.handlers.onStatus('connecting');
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1000);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // The old id can linger for a few seconds after a refresh; retry, then pick a new code.
        peer.destroy();
        if (++this.retries > 3) { this.code = makeCode(); this.retries = 0; }
        setTimeout(() => this.start(), 1500);
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
        if (!this.readyViaRelay) this.handlers.onStatus('error', 'Cannot reach the pairing server. Retrying…');
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
      const viaRelay = this.relays.get(slot);
      this.relays.delete(slot);                   // upgraded from the relay to a direct link
      const rejoin = !!old || !!viaRelay || performance.now() - (this.lastSeen[slot] || -1e9) < 20000;
      this.conns.set(slot, conn);
      if (old && old !== conn) old.close();
      this.counts[slot] = { fast: 0, reliable: 0 };
      this.fast.set(slot, openFast(conn, (m) => { this.counts[slot].fast++; this.handlers.onData(slot, m); }));
      this.handlers.onJoin(slot, rejoin);
    });
    conn.on('data', (msg) => { if (this.counts[slot]) this.counts[slot].reliable++; this.handlers.onData(slot, msg); });
    const drop = () => {
      if (this.conns.get(slot) === conn) {
        this.lastSeen[slot] = performance.now();
        this.conns.delete(slot);
        this.fast.delete(slot);
        if (!this.relays.get(slot)) this.handlers.onLeave(slot);
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  send(slot, msg) {
    const c = this.conns.get(slot);
    if (c && c.open) c.send(msg);
    else this.relaySend(slot, msg);
  }

  sendFast(slot, msg) {
    const c = this.conns.get(slot);
    if (c && c.open) sendOn(this.fast.get(slot), c, msg);
    else this.relaySend(slot, msg);
  }

  controllerUrl(slot) {
    const u = new URL('controller.html', location.href);
    return `${u.origin}${u.pathname}?room=${this.code}&slot=${slot}${this.roomKey === 'vxpp-room-tennis' ? '&g=tennis' : ''}${signalParam()}`;
  }
}

// Controller: connects to the host and auto-reconnects.
export class Controller {
  constructor({ room, slot, onStatus, onData }) {
    Object.assign(this, { room, slot, onStatus, onData });
    this.conn = null;
    this.relay = null;
    this.cid = Math.random().toString(36).slice(2, 10);
    this.lastFast = 0;
    this.start();
    // No direct link after a few seconds: the network is probably blocking it, use the relay.
    this.relayTimer = setTimeout(() => this.startRelay(), DIRECT_WAIT);
  }

  direct() { return !!(this.conn && this.conn.open); }

  async startRelay() {
    if (this.direct() || this.relay) return;
    this.onStatus('relaying');
    for (const url of BROKERS) {
      if (this.direct()) return;
      const link = new MqttLink(url, (topic, m) => { if (m?.c === this.cid && m.m && !this.direct()) this.onData(m.m); }, () => {
        if (this.relay === link) { this.relay = null; clearInterval(this.hb); if (!this.direct()) { this.onStatus('lost'); setTimeout(() => this.startRelay(), 1500); } }
      });
      try {
        await link.connect(5000);
      } catch { continue; }
      if (this.direct()) { link.close(); return; }
      this.relay = link;
      link.subscribe(topicDown(this.room, this.slot));
      const hello = () => link.publish(topicUp(this.room), { s: this.slot, c: this.cid });
      hello();
      clearInterval(this.hb);
      this.hb = setInterval(hello, 2000);
      this.onStatus('connected-relay');
      return;
    }
    this.onStatus('nolink');
    setTimeout(() => this.startRelay(), 4000);
  }

  relaySend(msg) {
    this.relay?.publish(topicUp(this.room), { s: this.slot, c: this.cid, m: msg });
  }

  start() {
    if (!this.relay) this.onStatus('connecting');
    const peer = new window.Peer(peerConfig());
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('error', (err) => {
      console.warn('peer error', err.type);
      if (err.type === 'peer-unavailable' && !this.relay) this.onStatus('nohost');
      this.retry();
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  connect() {
    // The pairing server link can drop and come back; don't open a second game connection if
    // the first one is still fine (that used to kick the phone off and back on in a loop).
    if (this.conn && this.conn.open) return;
    const conn = this.peer.connect(ID_PREFIX + this.room, {
      metadata: { slot: this.slot },
      serialization: 'json',
    });
    this.conn = conn;
    conn.on('open', () => {
      this.fast = openFast(conn, (m) => this.onData(m));
      clearTimeout(this.relayTimer);
      if (this.relay) { const r = this.relay; this.relay = null; clearInterval(this.hb); r.close(); }
      this.onStatus('connected');
    });
    conn.on('data', (m) => this.onData(m));
    conn.on('close', () => {
      if (this.conn !== conn) return;
      this.onStatus('lost');
      this.retry();
      clearTimeout(this.relayTimer);
      this.relayTimer = setTimeout(() => this.startRelay(), DIRECT_WAIT);
    });
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
    if (this.direct()) this.conn.send(msg);
    else this.relaySend(msg);
  }

  sendFast(msg) {
    if (this.direct()) { sendOn(this.fast, this.conn, msg); return; }
    // Only the continuous racket stream is thinned out; one-off messages (swings, pongs) always go.
    if (msg && (msg.t === 'r' || msg.t === 'in')) {
      const now = performance.now();
      if (now - this.lastFast < RELAY_FAST_MS) return;
      this.lastFast = now;
    }
    this.relaySend(msg);
  }
}
