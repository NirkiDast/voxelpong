// Optional webcam tracking: the PC's camera watches the players and reports where each playing hand is,
// so the paddle follows your real arm. The phone still supplies racket angle and swing timing.
// Runs MediaPipe Pose Landmarker locally in the browser (no video ever leaves the PC).
//
// Output per player, in player space (metres-ish, relative to where the hand was at Recenter):
//   x = right, y = up, z = toward the player (the TV/camera is at -z).
import { FilesetResolver, PoseLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const L_SH = 11, R_SH = 12, L_WR = 15, R_WR = 16, L_EL = 13, R_EL = 14;
const SHOULDER_M = 0.38;   // typical adult shoulder width, used to turn image units into metres
const LOOKAHEAD = 0.07;    // seconds of extrapolation to hide camera + inference delay
const STALE_MS = 250;

export class CamTracker {
  constructor({ video, canvas, onStatus }) {
    Object.assign(this, { video, canvas, onStatus });
    this.ctx = canvas.getContext('2d');
    this.players = 1;
    this.hand = ['right', 'right'];
    this.tracks = [this.blank(), this.blank()];
    this.running = false;
    this.fps = 0;
    this.latency = 0;
  }

  blank() {
    return { raw: null, home: null, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, t: 0, wantHome: true, lm: null };
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
    const base = new URL('../vendor/mediapipe/', import.meta.url).href;
    const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: base + 'pose_landmarker_lite.task', delegate },
      runningMode: 'VIDEO', numPoses: 2,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { this.lm = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { this.lm = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    this.running = true;
    this.onStatus('Tracking: step into view');
    this.loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.lm?.close();
    this.lm = null;
    this.tracks = [this.blank(), this.blank()];
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => this.loop()) : requestAnimationFrame(() => this.loop()));
    if (v.readyState >= 2 && this.lm) {
      const t0 = performance.now();
      let res = null;
      try { res = this.lm.detectForVideo(v, t0); } catch (err) { console.warn('pose', err); }
      const t1 = performance.now();
      this.latency = this.latency ? this.latency * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
      if (this.lastT) this.fps = this.fps * 0.9 + (1000 / Math.max(1, t1 - this.lastT)) * 0.1;
      this.lastT = t1;
      if (res) this.ingest(res, t1);
      this.draw(res);
    }
    next();
  }

  ingest(res, now) {
    const poses = (res.landmarks || []).map((lm, k) => ({ lm, wl: res.worldLandmarks?.[k] }))
      .filter((p) => p.lm[L_SH] && p.lm[R_SH]);
    let assign;
    if (this.players === 2) {
      // Facing the TV, the player on the left of the room shows up on the right of the camera image.
      poses.sort((a, b) => midX(b.lm) - midX(a.lm));
      assign = poses.length >= 2 ? [poses[0], poses[1]] : poses.length === 1 ? (midX(poses[0].lm) > 0.5 ? [poses[0], null] : [null, poses[0]]) : [null, null];
    } else {
      poses.sort((a, b) => shoulderW(b.lm) - shoulderW(a.lm)); // closest / biggest person
      assign = [poses[0] || null, null];
    }
    assign.forEach((p, i) => { if (p) this.update(i, p, now); });
    const seen = poses.length ? `Tracking: ${poses.length === 1 ? '1 person' : '2 people'} in view` : 'Tracking: step into view';
    if (seen !== this.lastStatus) { this.lastStatus = seen; this.onStatus(seen); }
  }

  update(i, { lm, wl }, now) {
    const tr = this.tracks[i];
    const right = this.hand[i] !== 'left';
    const wr = right ? R_WR : L_WR;
    if ((lm[wr].visibility ?? 1) < 0.3) return;
    const sw = Math.max(0.02, shoulderW(lm));
    const k = SHOULDER_M / sw;
    const mx = midX(lm), my = (lm[L_SH].y + lm[R_SH].y) / 2;
    // Body position across the room (from where the shoulders are in the frame) plus hand offset from
    // the shoulders. The camera is not mirrored, so image-left is the player's right.
    const raw = {
      bx: -(mx - 0.5) * k,
      hx: -(lm[wr].x - mx) * k,
      hy: -(lm[wr].y - my) * k * ((this.video.videoHeight || 3) / (this.video.videoWidth || 4)),
      hz: 0,
    };
    if (wl && wl[wr] && wl[L_SH] && wl[R_SH]) {
      // World landmarks are metres around the hips; negative z points at the camera.
      raw.hz = wl[wr].z - (wl[L_SH].z + wl[R_SH].z) / 2;
    }
    const cur = { x: raw.bx + raw.hx, y: raw.hy, z: raw.hz };
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
    tr.lm = lm;
    tr.wr = wr;
  }

  // Predicted hand position for player i, or null when nobody is tracked for that slot.
  get(i) {
    const tr = this.tracks[i];
    if (!this.running || !tr.home) return null;
    const age = performance.now() - tr.t;
    if (age > STALE_MS) return null;
    const la = Math.min(LOOKAHEAD + age / 1000, 0.12);
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

  draw(res) {
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
      if (!tr.lm || performance.now() - tr.t > STALE_MS) return;
      const lm = tr.lm;
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;
      const seg = (a, b) => { ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke(); };
      seg(L_SH, R_SH); seg(L_SH, L_EL); seg(L_EL, L_WR); seg(R_SH, R_EL); seg(R_EL, R_WR);
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.arc(lm[tr.wr].x * w, lm[tr.wr].y * h, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, h - 18, w, 18);
    ctx.fillStyle = '#cfe';
    ctx.font = '11px ui-monospace, monospace';
    const names = this.players === 2 ? ['P1', 'P2'] : ['YOU'];
    const st = names.map((n, i) => `${n} ${this.tracked(i) ? '✓' : '–'}`).join('  ');
    ctx.fillText(`${st}   ${Math.round(this.fps)} fps · ${Math.round(this.latency)} ms`, 6, h - 5);
    void res;
  }
}

function midX(lm) { return (lm[L_SH].x + lm[R_SH].x) / 2; }
function shoulderW(lm) { return Math.hypot(lm[L_SH].x - lm[R_SH].x, lm[L_SH].y - lm[R_SH].y); }
