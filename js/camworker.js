// Runs the MediaPipe pose model in a background thread so the game's frame rate is never blocked by it.
// Classic worker: the CommonJS build of tasks-vision loads its wasm with importScripts, which only
// works in classic workers.
/* global importScripts */
self.exports = {};
self.module = { exports: self.exports };
importScripts('../vendor/mediapipe/vision_bundle_classic.js');
const { FilesetResolver, PoseLandmarker } = self.exports;

let lm = null;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const base = new URL('../vendor/mediapipe/', self.location.href).href;
      const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: base + 'pose_landmarker_lite.task', delegate },
        runningMode: 'VIDEO', numPoses: 2,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      // The graphics card is several times faster than the CPU for this model. It runs in this
      // background thread with its own context, so it doesn't block the game's frames.
      let delegate = m.delegate || 'GPU';
      try { lm = await PoseLandmarker.createFromOptions(fileset, opts(delegate)); }
      catch { delegate = delegate === 'CPU' ? 'GPU' : 'CPU'; lm = await PoseLandmarker.createFromOptions(fileset, opts(delegate)); }
      self.postMessage({ type: 'ready', delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  } else if (m.type === 'frame') {
    const t0 = performance.now();
    let res = null;
    try { if (lm) res = lm.detectForVideo(m.bitmap, m.ts); } catch (err) { /* skip frame */ }
    m.bitmap.close();
    const strip = (arr) => (arr || []).map((pose) => pose.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })));
    self.postMessage({ type: 'res', ts: m.ts, ms: performance.now() - t0,
      landmarks: res ? strip(res.landmarks) : [], worldLandmarks: res ? strip(res.worldLandmarks) : [] });
  }
};
