import * as THREE from 'three';

/**
 * Studio lighting for a character close-up (the showroom, the editor), set up like
 * Nir's reference render: a warm key from the front right that casts soft shadows (the
 * visor on the forehead, the skirt on the thighs), a cool fill from the left, and two
 * strong blue rims from behind that outline the figure against a blue backdrop.
 * The lights aim at a figure standing at the origin.
 */
export function characterLights(): { group: THREE.Group; key: THREE.DirectionalLight } {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(0xeef0ff, 0x3a3050, 0.75));
  const key = new THREE.DirectionalLight(0xfff4ec, 3.3);
  key.position.set(-2.2, 3.2, 4.2);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera;
  cam.left = -1.4;
  cam.right = 1.4;
  cam.top = 1.6;
  cam.bottom = -1.4;
  cam.near = 1;
  cam.far = 12;
  key.shadow.bias = -0.002;
  key.shadow.normalBias = 0.05;
  key.shadow.radius = 3;
  group.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xffe8dc, 0.5);
  fill.position.set(3.4, 1.8, 2.4);
  group.add(fill);
  const rim = new THREE.DirectionalLight(0x5f8cff, 0.9);
  rim.position.set(-3, 3, -3.5);
  group.add(rim);
  const rim2 = new THREE.DirectionalLight(0x8fb4ff, 0.5);
  rim2.position.set(3.5, 2.2, -3);
  group.add(rim2);
  return { group, key };
}
