import { rigArrays, setFineDetail } from './rig';
import type { CharacterLook, GearLook } from './looks';
import type { Detail } from './rig';

/** Builds character bodies off the main thread (a detailed body takes seconds). */
self.onmessage = (e: MessageEvent<{ id: number; look: CharacterLook; gear: GearLook; detail: Detail; fine: boolean }>) => {
  const { id, look, gear, detail, fine } = e.data;
  setFineDetail(fine);
  const a = rigArrays(look, gear, detail);
  (self as unknown as Worker).postMessage({ id, a }, [...a.attrs.map(([, arr]) => arr.buffer), a.index.buffer]);
};
