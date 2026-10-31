// Fallback link for when the direct phone <-> PC WebRTC connection can't be made (strict
// routers, phones on mobile data, carrier NAT). Messages go through a free public MQTT broker
// over a secure WebSocket instead. It's slower than the direct link but works on almost any
// network, and needs no account. A tiny MQTT 3.1.1 client (QoS 0 only) lives here so there's
// no extra library to load.

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
// Let ?relay=wss://host:port/path point at another broker (also used for local testing).
const custom = new URLSearchParams(location.search).get('relay');
if (custom) BROKERS.unshift(custom);

export const topicUp = (code) => `vxpp7/${code}/up`;
export const topicDown = (code, slot) => `vxpp7/${code}/dn${slot}`;

const enc = new TextEncoder(), dec = new TextDecoder();
const str = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function packet(type, body) {
  const len = [];
  let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0);
  return new Uint8Array([type, ...len, ...body]);
}

export class MqttLink {
  constructor(url, onMessage, onClose) {
    Object.assign(this, { url, onMessage, onClose });
    this.buf = new Uint8Array(0);
    this.open = false;
    this.pid = 1;
  }

  // Resolves once the broker accepted us, rejects on failure or after `timeout` ms.
  connect(timeout = 5000) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { reject(e); return; }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { reject(new Error('timeout')); try { ws.close(); } catch { /* ignore */ } }, timeout);
      ws.onopen = () => {
        const id = 'vxpp' + Math.random().toString(36).slice(2, 12);
        ws.send(packet(0x10, [...str('MQTT'), 4, 0x02, 0, 30, ...str(id)]));
      };
      ws.onmessage = (e) => this.feed(new Uint8Array(e.data), () => { clearTimeout(timer); this.open = true; resolve(this); });
      ws.onerror = () => { clearTimeout(timer); if (!this.open) reject(new Error('socket error')); };
      ws.onclose = () => {
        clearTimeout(timer);
        clearInterval(this.ping);
        const was = this.open;
        this.open = false;
        if (was) this.onClose?.();
        else reject(new Error('closed'));
      };
      this.ping = setInterval(() => { if (this.open) ws.send(new Uint8Array([0xc0, 0])); }, 20000);
    });
  }

  feed(chunk, onConnack) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    let i = 0;
    while (i + 2 <= b.length) {
      let len = 0, mul = 1, j = i + 1, d;
      do { if (j >= b.length) { this.buf = b.slice(i); return; } d = b[j++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
      if (j + len > b.length) break;
      const type = b[i] >> 4, body = b.subarray(j, j + len);
      if (type === 2) { if (body[1] === 0) onConnack(); else this.ws.close(); }
      else if (type === 3) {
        const tl = (body[0] << 8) | body[1];
        const qos = (b[i] >> 1) & 3;
        const topic = dec.decode(body.subarray(2, 2 + tl));
        const payload = body.subarray(2 + tl + (qos ? 2 : 0));
        try { this.onMessage(topic, JSON.parse(dec.decode(payload))); } catch { /* ignore malformed */ }
      }
      i = j + len;
    }
    this.buf = b.slice(i);
  }

  subscribe(topic) {
    const id = this.pid++ & 0xffff || 1;
    this.ws.send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  publish(topic, obj) {
    if (!this.open || this.ws.bufferedAmount > 64000) return;   // never pile up stale input
    this.ws.send(packet(0x30, [...str(topic), ...enc.encode(JSON.stringify(obj))]));
  }

  close() { this.open = false; try { this.ws.close(); } catch { /* ignore */ } }
}
