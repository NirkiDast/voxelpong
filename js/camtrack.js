// Optional webcam tracking: the PC's camera watches the players and reports where each playing hand is,
// so the paddle follows your real arm. The phone still supplies racket angle and swing timing.
// Runs MediaPipe Pose Landmarker locally in the browser (no video ever leaves the PC).
//
// Output per player, in player space (metres-ish, relative to where the hand was at Recenter):
//   x = right, y = up, z = toward the player (the TV/camera is at -z).

const L_SH = 11, R_SH = 12, L_WR = 15, R_WR = 16, L_EL = 13, R_EL = 14;
const SHOULDER_M = 0.38;   // typical adult shoulder width, used to turn image units into metres
const LOOKAHEAD = 0.07;    // seconds of extrapolation to hide camera + inference delay
const STALE_MS = 600;      // after this long without seeing the hand, hand control back to auto

export class CamTracker {
  constructor({ video, canvas, onStatus, onCalib }) {
    Object.assign(this, { video, canvas, onStatus, onCalib });
    this.ctx = canvas.getContext('2d');
    this.players = 1;
    this.hand = ['right', 'right']; // from the phone's swing calibration, used if the raise step times out
    this.tracks = [this.blank(), this.blank()];
    this.running = false;
    this.fps = 0;
    this.latency = 0;
  }

  blank() {
    return { home: null, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, t: 0, seenT: 0, wantHome: true, lm: null, wr: 0, wImg: null, prevLm: null, vote: 0, cal: null };
  }

  async start() {
    this.onStatus('Starting camera…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      this.onStatus(err && err.name === 'NotAllowedError' ? 'Camera blocked: allow it in the address bar' : 'No webcam found');
      throw err;
    }
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.onStatus('Loading body tracker…');
    // The model runs in a worker thread (js/camworker.js) so it never stalls the game's rendering.
    this.worker = new Worker(new URL('./camworker.js', import.meta.url));
    await new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        if (e.data.type === 'ready') { this.delegate = e.data.delegate; resolve(); }
        else if (e.data.type === 'error') reject(new Error(e.data.message));
      };
      this.worker.onerror = (e) => reject(new Error(e.message || 'worker failed'));
      this.worker.postMessage({ type: 'init' });
    });
    this.worker.onmessage = (e) => this.onResult(e.data);
    this.busy = false;
    this.running = true;
    this.onStatus('Tracking: step into view');
    this.loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.worker?.terminate();
    this.worker = null;
    this.tracks = [this.blank(), this.blank()];
  }

  // Every new camera frame: redraw the preview, and hand the frame to the worker if it's free
  // (one frame in flight at a time, so a slow PC just tracks at a lower rate instead of queueing up).
  loop() {
    if (!this.running) return;
    const v = this.video;
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => this.loop()) : setTimeout(() => this.loop(), 16));
    if (v.readyState >= 2) {
      this.draw();
      if (!this.busy && this.worker) {
        this.busy = true;
        const ts = performance.now();
        createImageBitmap(v, { resizeWidth: 320, resizeHeight: 240, resizeQuality: 'low' })
          .then((bitmap) => { if (this.worker) this.worker.postMessage({ type: 'frame', bitmap, ts }, [bitmap]); else bitmap.close(); })
          .catch(() => { this.busy = false; });
      }
    }
    next();
  }

  onResult(r) {
    this.busy = false;
    if (r.type !== 'res' || !this.running) return;
    const now = performance.now();
    this.latency = this.latency ? this.latency * 0.9 + (now - r.ts) * 0.1 : now - r.ts;
    if (this.lastT) { const f = 1000 / Math.max(1, now - this.lastT); this.fps = this.fps ? this.fps * 0.9 + f * 0.1 : f; }
    this.lastT = now;
    // Positions are stamped with when the frame was captured, so look-ahead covers the full delay.
    this.ingest(r, r.ts);
  }

  ingest(res, now) {
    const poses = (res.landmarks || []).map((lm, k) => ({ lm, wl: res.worldLandmarks?.[k] }))
      .filter((p) => p.lm[L_SH] && p.lm[R_SH]);
    // Each player locks onto one person and follows them by where their shoulders are, so somebody
    // else walking past or sitting on the couch behind you never steals the paddle.
    const n = this.players === 2 ? 2 : 1;
    const assign = [null, null];
    const free = new Set(poses);
    for (let i = 0; i < n; i++) {
      const tr = this.tracks[i];
      if (!tr.body || now - tr.bodyT > 1500 || (tr.cal && tr.cal.stage === 'raise')) continue;
      let best = null, bd = 0.3;
      for (const p of free) {
        const d = Math.hypot(midX(p.lm) - tr.body.x, midY(p.lm) - tr.body.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { assign[i] = best; free.delete(best); }
    }
    for (let i = 0; i < n; i++) {
      const tr = this.tracks[i];
      if (assign[i] || (tr.body && now - tr.bodyT <= 1500 && !(tr.cal && tr.cal.stage === 'raise'))) continue;
      let pool = [...free];
      if (tr.cal && tr.cal.stage === 'raise' && performance.now() - tr.cal.t0 < 6000) {
        // While calibrating, the player is whoever raises exactly one hand.
        pool = pool.filter((p) => raisedWrists(p.lm).length === 1);
      }
      if (n === 2) {
        // Facing the TV, the player on the left of the room shows up on the right of the camera image.
        pool = pool.filter((p) => (i === 0 ? midX(p.lm) >= 0.5 : midX(p.lm) < 0.5));
      }
      pool.sort((x, y) => shoulderW(y.lm) - shoulderW(x.lm));
      if (pool[0]) { assign[i] = pool[0]; free.delete(pool[0]); }
    }
    assign.forEach((p, i) => { if (p) { this.tracks[i].body = { x: midX(p.lm), y: midY(p.lm) }; this.tracks[i].bodyT = now; } });
    assign.forEach((p, i) => { if (p) this.update(i, p, now); });
    const seen = poses.length ? `Tracking: ${poses.length === 1 ? '1 person' : '2 people'} in view` : 'Tracking: step into view';
    if (seen !== this.lastStatus) { this.lastStatus = seen; this.onStatus(seen); }
  }

  // Which wrist is the racket hand. MediaPipe sometimes swaps its left/right labels (especially when
  // you turn sideways to swing), so after calibration we follow the hand by continuity instead of by
  // label, and double-check it against the phone's own motion.
  pickWrist(tr, lm, now) {
    const a = lm[L_WR], b = lm[R_WR];
    if (tr.wImg && now - tr.t < 300) {
      const da = Math.hypot(a.x - tr.wImg.x, a.y - tr.wImg.y), db = Math.hypot(b.x - tr.wImg.x, b.y - tr.wImg.y);
      // Wrists right on top of each other: keep the previous label rather than flip-flopping.
      if (Math.abs(da - db) < 0.02) return tr.wr;
      return da < db ? L_WR : R_WR;
    }
    return tr.wr;
  }

  update(i, { lm, wl }, now) {
    const tr = this.tracks[i];
    const aspect = (this.video.videoHeight || 3) / (this.video.videoWidth || 4);
    const sw = Math.max(0.02, shoulderW(lm));
    const k = SHOULDER_M / sw;
    const mx = midX(lm), my = (lm[L_SH].y + lm[R_SH].y) / 2;
    tr.lm = lm;
    tr.seenT = now;

    if (tr.cal) { this.stepCalibration(i, tr, lm, k, aspect, now); return; }
    if (!tr.wr) return; // never calibrated: wait for calibration

    let wr = this.pickWrist(tr, lm, now);
    // Phone check: the racket hand moves the way the phone moves. Compare both wrists' motion with the
    // phone's (from about a camera-delay ago) and switch if the other hand clearly matches better.
    const other = wr === L_WR ? R_WR : L_WR;
    if (tr.prevLm && now - tr.t < 150) {
      const ph = this.phoneVel(i, now - 40);
      if (ph) {
        const dt = Math.max(0.01, (now - tr.t) / 1000);
        const vel = (idx) => ({ x: -(lm[idx].x - tr.prevLm[idx].x) * k / dt, y: -(lm[idx].y - tr.prevLm[idx].y) * k * aspect / dt });
        const m1 = vel(wr), m2 = vel(other);
        const sp = Math.hypot(ph.x, ph.y);
        if (sp > 0.6) {
          const s1 = (m1.x * ph.x + m1.y * ph.y) / sp, s2 = (m2.x * ph.x + m2.y * ph.y) / sp;
          tr.vote = Math.max(-12, Math.min(14, tr.vote * 0.92 + (s2 - s1)));
          if (tr.vote > 12) { wr = other; tr.vote = 0; }
        } else tr.vote *= 0.97;
      }
    }
    tr.prevLm = lm;
    if ((lm[wr].visibility ?? 1) < 0.2) { tr.wr = wr; return; }

    // Body position across the room (from where the shoulders are in the frame) plus hand offset from
    // the shoulders. The camera is not mirrored, so image-left is the player's right.
    let hz = 0;
    if (wl && wl[wr] && wl[L_SH] && wl[R_SH]) hz = wl[wr].z - (wl[L_SH].z + wl[R_SH].z) / 2; // metres, -z = toward camera
    const cur = { x: -(mx - 0.5) * k - (lm[wr].x - mx) * k, y: -(lm[wr].y - my) * k * aspect, z: hz };
    if (tr.wantHome || !tr.home) { tr.home = { ...cur }; tr.wantHome = false; tr.pos = { x: 0, y: 0, z: 0 }; tr.vel = { x: 0, y: 0, z: 0 }; tr.t = now; }
    const rel = { x: cur.x - tr.home.x, y: cur.y - tr.home.y, z: (cur.z - tr.home.z) * 0.8 };
    const dt = Math.max(0.005, (now - tr.t) / 1000);
    if (dt > 0.3) { tr.pos = rel; tr.vel = { x: 0, y: 0, z: 0 }; }
    else {
      // Light smoothing (depth is the noisiest axis), then velocity for look-ahead.
      const a = { x: 0.7, y: 0.7, z: 0.4 };
      for (const ax of ['x', 'y', 'z']) {
        const p = tr.pos[ax] + (rel[ax] - tr.pos[ax]) * a[ax];
        const v = (p - tr.pos[ax]) / dt;
        tr.vel[ax] = tr.vel[ax] * 0.5 + v * 0.5;
        tr.pos[ax] = p;
      }
    }
    tr.t = now;
    tr.wr = wr;
    tr.wImg = { x: lm[wr].x, y: lm[wr].y };
  }

  // ---- Calibration: 1) raise the phone hand above your head, 2) hold it out in front, still. ----
  calibrate(i) {
    const idx = i == null ? [...Array(this.players).keys()] : [i];
    idx.forEach((j) => {
      const tr = this.tracks[j];
      tr.cal = { stage: 'raise', since: 0, cand: 0, t0: performance.now() };
      tr.wImg = null; tr.home = null; tr.vote = 0; tr.body = null;
      this.onCalib?.(j, 'raise');
    });
  }

  calibrating(i) { return !!this.tracks[i]?.cal; }
  calibrated(i) { return !!this.tracks[i]?.wr && !this.tracks[i]?.cal; }

  stepCalibration(i, tr, lm, k, aspect, now) {
    const c = tr.cal;
    if (c.stage === 'raise') {
      // A wrist clearly above the nose (in image y, smaller is higher) counts as raised.
      const up = raisedWrists(lm);
      let cand = up.length === 1 ? up[0] : 0; // both hands up is ambiguous
      // Never get stuck here: after 6 s, go with the hand the phone's swing calibration says you use.
      const timedOut = now - c.t0 > 6000;
      if (timedOut) cand = this.hand[i] === 'left' ? L_WR : R_WR;
      if (cand && (cand === c.cand || timedOut)) {
        if (timedOut || now - c.since > 400) {
          tr.wr = cand;
          tr.wImg = { x: lm[cand].x, y: lm[cand].y };
          tr.t = now;
          c.stage = 'still'; c.since = now; c.last = { ...tr.wImg };
          this.onCalib?.(i, 'still');
        }
      } else { c.cand = cand; c.since = now; }
      return;
    }
    // Stage 'still': follow the hand by continuity until it has stayed put for 0.7 s.
    const wr = this.pickWrist(tr, lm, now);
    const p = { x: lm[wr].x, y: lm[wr].y };
    const moved = Math.hypot(p.x - c.last.x, p.y - c.last.y);
    const belowHead = p.y > lm[0].y + 0.05;
    if (moved > 0.06 || !belowHead) { c.since = now; c.last = p; }
    tr.wr = wr; tr.wImg = p; tr.t = now; tr.prevLm = lm;
    c.t1 ||= now;
    if ((belowHead && now - c.since > 500) || now - c.t1 > 3000) {
      tr.cal = null;
      tr.wantHome = true;
      this.onCalib?.(i, 'done');
    }
  }

  // Phone racket velocity history (player space), fed by main.js from the phone's 'r' messages.
  feedPhone(i, v) {
    const h = (this.phone ||= [[], []])[i];
    const now = performance.now();
    h.push({ t: now, x: v.x, y: v.y });
    while (h.length && now - h[0].t > 400) h.shift();
  }

  phoneVel(i, at) {
    const h = this.phone?.[i];
    if (!h || !h.length) return null;
    let best = null;
    for (const s of h) if (!best || Math.abs(s.t - at) < Math.abs(best.t - at)) best = s;
    return Math.abs(best.t - at) < 80 ? best : null;
  }

  // Predicted hand position for player i, or null when nobody is tracked for that slot.
  get(i) {
    const tr = this.tracks[i];
    if (!this.running || !tr.home || tr.cal) return null;
    const age = performance.now() - tr.t;
    if (age > STALE_MS) return null;
    const la = Math.min(LOOKAHEAD + age / 1000, 0.15);
    const c = (v, m) => Math.max(-m, Math.min(m, v));
    return {
      x: tr.pos.x + c(tr.vel.x, 6) * la,
      y: tr.pos.y + c(tr.vel.y, 6) * la,
      z: tr.pos.z + c(tr.vel.z, 3) * la,
    };
  }

  recenter(i) {
    if (i == null) this.tracks.forEach((t) => { t.wantHome = true; });
    else if (this.tracks[i]) this.tracks[i].wantHome = true;
  }

  tracked(i) { return !!this.get(i); }

  draw() {
    const { ctx, canvas, video } = this;
    const w = canvas.width, h = canvas.height;
    ctx.save();
    // Mirror the preview so it behaves like a mirror for the players.
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.globalAlpha = 0.85;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.globalAlpha = 1;
    const colors = ['#3ef0ff', '#ff4fd8'];
    this.tracks.forEach((tr, i) => {
      if (!tr.lm || performance.now() - tr.seenT > STALE_MS) return;
      const lm = tr.lm;
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;
      const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke(); };
      seg(L_SH, R_SH); seg(L_SH, L_EL); seg(L_EL, L_WR); seg(R_SH, R_EL); seg(R_EL, R_WR);
      if (!tr.wr) return;
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.arc(lm[tr.wr].x * w, lm[tr.wr].y * h, tr.cal ? 5 : 8, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - 18, w, 18);
    ctx.fillStyle = '#cfe';
    ctx.font = '11px ui-monospace, monospace';
    const names = this.players === 2 ? ['P1', 'P2'] : ['YOU'];
    const st = names.map((n, i) => `${n} ${this.tracks[i].cal ? 'calibrating' : this.tracked(i) ? '✓' : '–'}`).join('  ');
    ctx.fillText(`${st}   ${Math.round(this.fps)} fps · ${Math.round(this.latency)} ms ${this.delegate === 'GPU' ? 'G' : 'C'}`, 6, h - 5);
  }
}

function midY(lm) { return (lm[L_SH].y + lm[R_SH].y) / 2; }
// Wrists clearly above the nose (image y grows downward).
function raisedWrists(lm) { return [L_WR, R_WR].filter((w) => lm[w].y < lm[0].y - 0.03 && (lm[w].visibility ?? 1) > 0.3); }
function midX(lm) { return (lm[L_SH].x + lm[R_SH].x) / 2; }
function shoulderW(lm) { return Math.hypot(lm[L_SH].x - lm[R_SH].x, lm[L_SH].y - lm[R_SH].y); }
