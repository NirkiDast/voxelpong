import RigWorker from './rig.worker?worker&inline';
import { adoptRig, fineDetail, rigReady, type Detail, type RigArrays } from './rig';
import type { CharacterLook, GearLook } from './looks';

let worker: Worker | null | undefined;
let next = 0;
const waiting = new Map<number, { look: CharacterLook; gear: GearLook; detail: Detail; fine: boolean; done: () => void }>();
const pending = new Map<string, Promise<void>>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new RigWorker();
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; a: RigArrays }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      // (Built for the detail setting it was asked with: dropped if that has changed since.)
      if (w.fine === fineDetail()) adoptRig(w.look, w.gear, w.detail, e.data.a);
      w.done();
    };
    // A worker that can't run (blocked by the page's rules): build on the main thread.
    worker.onerror = () => {
      worker = null;
      for (const w of waiting.values()) w.done();
      waiting.clear();
    };
  }
  return worker;
}

/**
 * Get a body built without stalling the page: in a worker where one can run, so that
 * buildRig is then instant. Resolves straight away when it is already built; if no
 * worker can run, resolves on the next frame and buildRig builds it then.
 */
export function prepareRig(look: CharacterLook, gear: GearLook, detail: Detail): Promise<void> {
  if (rigReady(look, gear, detail)) return Promise.resolve();
  const fine = fineDetail();
  const key = JSON.stringify([look, gear, detail, fine]);
  const p0 = pending.get(key);
  if (p0) return p0;
  const w = getWorker();
  const p = new Promise<void>((done) => {
    if (!w) {
      requestAnimationFrame(() => done());
      return;
    }
    const id = next++;
    waiting.set(id, { look, gear, detail, fine, done });
    w.postMessage({ id, look, gear, detail, fine });
  }).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
