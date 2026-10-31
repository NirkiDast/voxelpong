import * as THREE from 'three';
import { characterById } from '../characters/characters';
import { PlayerView } from '../player/PlayerView';
import type { GearLook } from '../characters/looks';
import { characterLights } from './characterLights';

/**
 * The Lineup turntable (GDD §2): your character on a dark plinth with a lime ring, lit
 * from the front with a cool rim light behind (phase 19 look),
 * turning slowly in its idle loop. Drawn instead of the stadium while Lineup is open;
 * a drag spins it by hand.
 */
export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  private readonly view = new PlayerView('rio', 'hi');
  private readonly spin = new THREE.Group();
  private time = 0;
  private yaw = 0.5;
  private dragV = 0;
  private dragging = false;
  active = false;

  constructor() {
    // A royal-blue arena backdrop with floodlights glowing out of focus (Nir's mockups).
    this.scene.background = studioBackdrop();
    // Studio lights like the reference render, aimed at the figure on the plinth.
    const lights = characterLights();
    lights.group.position.y = 0.24;
    this.scene.add(lights.group);
    // A round plinth: dark base, a thin lime ring, a slate top.
    for (const [r, h, y, c] of [
      [1.25, 0.14, 0.07, 0x10172b],
      [1.16, 0.025, 0.152, 0xd6ff3d],
      [1.08, 0.08, 0.2, 0x1f2a48],
    ]) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), new THREE.MeshLambertMaterial({ color: c }));
      disc.receiveShadow = true;
      disc.position.y = y;
      this.scene.add(disc);
    }
    // The lime rim glows out over the floor, and a pool of light sits under the plinth.
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(1.02, 1.62, 64),
      new THREE.MeshBasicMaterial({ map: ringGlow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.16;
    this.scene.add(glow);
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 48),
      new THREE.MeshBasicMaterial({ map: floorPool(), transparent: true, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.002;
    this.scene.add(pool);
    this.view.hideBar();
    this.view.hideBlob();
    this.view.group.position.y = 0.24;
    this.spin.add(this.view.group);
    this.scene.add(this.spin);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', () => (this.dragging = false));
  }

  /** Close in on the face (the editor's Face tab): 0 whole body, 1 head and shoulders. */
  focus = 0;
  private zoom = 0;
  /** Head height on the plinth, for the face close-up (taller players stand higher). */
  headY = 1.84;

  /** Dress the turntable; `handed` overrides the character's (the editor's live preview). */
  setCharacter(id: string, gear?: GearLook, handed?: 1 | -1): void {
    const c = characterById(id);
    this.view.setCharacter(c.id, handed ?? c.handed, gear);
  }

  private lastX = 0;

  /** Pointer drags that start on `target` spin the character. */
  bindDrag(target: HTMLElement): void {
    target.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
    });
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.yaw += dx * 0.012;
    this.dragV = dx * 0.6;
  };

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    this.zoom += (this.focus - this.zoom) * (1 - Math.exp(-6 * dt));
    if (!this.dragging) {
      this.dragV *= Math.exp(-3 * dt);
      // Close in, the turntable eases round to show the face.
      const front = Math.round((this.yaw - 0.35) / (Math.PI * 2)) * Math.PI * 2 + 0.35;
      const spin = (0.45 + this.dragV) * dt;
      this.yaw += spin * (1 - this.focus) + (front - this.yaw) * this.focus * (1 - Math.exp(-4 * dt)) + this.dragV * dt * this.focus;
    }
    this.spin.rotation.y = this.yaw;
    // The reference stance; facing straight ahead when closed in on the face.
    this.view.showClip(this.focus > 0.3 ? 'idle' : 'showroom', this.time);
  }

  /** Where the figure stands on screen: centre as fractions of the frame, and a size multiplier. */
  frame = { x: 0.5, y: 0.23, size: 1 };

  /** Old framing: the character centred in the top `band` of the frame. */
  set band(b: number) {
    this.frame = { x: 0.5, y: b / 2, size: 1 };
  }

  render(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    this.camera.aspect = width / height;
    // Shift the view so the character sits where the screen wants it.
    const f = this.frame;
    this.camera.setViewOffset(width, height, (0.5 - f.x) * width, (0.5 - f.y) * height, width, height);
    const z = this.zoom;
    const far = 8.6 / f.size;
    this.camera.position.set(0, THREE.MathUtils.lerp(1.4, this.headY + 0.05, z), THREE.MathUtils.lerp(far, 4.6, z));
    this.camera.lookAt(0, THREE.MathUtils.lerp(1.06, this.headY - 0.16, z), 0);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The arena behind the plinth: deep royal blue, a haze of light, two floodlight banks out of focus, stands in shadow. */
function studioBackdrop(): THREE.Texture {
  return canvasTexture(512, 1024, (g) => {
    const v = g.createLinearGradient(0, 0, 0, 1024);
    v.addColorStop(0, '#08143f');
    v.addColorStop(0.3, '#16379a');
    v.addColorStop(0.52, '#1a3fae');
    v.addColorStop(0.62, '#0c215f');
    v.addColorStop(1, '#040a22');
    g.fillStyle = v;
    g.fillRect(0, 0, 512, 1024);
    const haze = g.createRadialGradient(256, 380, 10, 256, 380, 360);
    haze.addColorStop(0, 'rgba(70, 120, 255, 0.55)');
    haze.addColorStop(1, 'rgba(70, 120, 255, 0)');
    g.fillStyle = haze;
    g.fillRect(0, 0, 512, 1024);
    // Stands: darker tiers with a speckle of crowd, softened as if out of focus. Drawn sharp
    // on a layer and blurred once (a blur filter per rectangle is very slow to paint).
    const layer = document.createElement('canvas');
    layer.width = 512;
    layer.height = 1024;
    const l = layer.getContext('2d')!;
    for (let row = 0; row < 7; row++) {
      const y = 330 + row * 26;
      l.fillStyle = `rgba(6, 14, 50, ${0.18 + row * 0.03})`;
      l.fillRect(0, y, 512, 14);
      for (let x = 4; x < 512; x += 9) {
        const r = Math.abs(Math.sin(x * 12.9898 + row * 78.233) * 43758.5453) % 1;
        l.fillStyle = `rgba(${150 + r * 100}, ${170 + r * 60}, 255, ${0.08 + r * 0.12})`;
        l.fillRect(x, y + 2 + r * 6, 4, 4);
      }
    }
    g.filter = 'blur(3px)';
    g.drawImage(layer, 0, 0);
    g.filter = 'none';
    l.clearRect(0, 0, 512, 1024);
    // Floodlight banks, top left and right: a glow, then rows of bright lamps.
    for (const cx of [70, 442]) {
      const halo = g.createRadialGradient(cx, 150, 4, cx, 150, 150);
      halo.addColorStop(0, 'rgba(200, 225, 255, 0.55)');
      halo.addColorStop(1, 'rgba(120, 160, 255, 0)');
      g.fillStyle = halo;
      g.fillRect(cx - 160, 0, 320, 320);
      l.fillStyle = 'rgba(235, 245, 255, 0.95)';
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 4; c++) {
          l.beginPath();
          l.arc(cx - 33 + c * 22 + (r % 2) * 6, 118 + r * 22, 8, 0, Math.PI * 2);
          l.fill();
        }
    }
    g.filter = 'blur(2.5px)';
    g.drawImage(layer, 0, 0);
    g.filter = 'none';
    const vig = g.createRadialGradient(256, 460, 200, 256, 460, 640);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(0, 0, 10, 0.55)');
    g.fillStyle = vig;
    g.fillRect(0, 0, 512, 1024);
  });
}

/** The lime rim's glow across the floor: brightest at the rim, fading outward. */
function ringGlow(): THREE.Texture {
  return canvasTexture(256, 256, (g) => {
    // RingGeometry's UVs map the disc onto the square, so a radial gradient follows the ring.
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(214, 255, 61, 0)');
    r.addColorStop(0.66, 'rgba(214, 255, 61, 0)');
    r.addColorStop(0.715, 'rgba(214, 255, 61, 0.8)');
    r.addColorStop(0.8, 'rgba(214, 255, 61, 0.22)');
    r.addColorStop(1, 'rgba(214, 255, 61, 0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
}

/** A soft pool of blue light on the floor round the plinth. */
function floorPool(): THREE.Texture {
  return canvasTexture(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(40, 80, 200, 0.55)');
    r.addColorStop(0.5, 'rgba(20, 45, 140, 0.3)');
    r.addColorStop(1, 'rgba(10, 20, 70, 0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
}
