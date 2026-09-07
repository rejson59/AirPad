import * as THREE from 'three';
export { THREE };

export function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function basicScene(fog = 0x0b1020) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(fog);
  scene.fog = new THREE.Fog(fog, 60, 260);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x223044, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(40, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 90;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 250;
  scene.add(sun);
  return scene;
}

export function ground(scene, size = 400, color = 0x1b2440) {
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.0 })
  );
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);
  return g;
}

export function gridHelper(scene, size = 400, div = 80, c1 = 0x2b3c6b, c2 = 0x18233f) {
  const grid = new THREE.GridHelper(size, div, c1, c2);
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);
  return grid;
}

/** Simple 3D "kart/tank/player" avatar */
export function avatar(color, kind = 'kart') {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151b2e, roughness: 0.8 });

  if (kind === 'kart') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.6), mat);
    body.position.y = 0.55; body.castShadow = true; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 1.0), dark);
    cab.position.set(0, 1.0, -0.15); cab.castShadow = true; g.add(cab);
    const wg = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
    for (const [x, z] of [[-0.85, 0.9], [0.85, 0.9], [-0.85, -0.9], [0.85, -0.9]]) {
      const w = new THREE.Mesh(wg, dark);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.36, z); w.castShadow = true; g.add(w);
    }
  } else if (kind === 'tank') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 2.6), mat);
    body.position.y = 0.55; body.castShadow = true; g.add(body);
    const turret = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.5, 16), mat);
    t.position.y = 1.1; t.castShadow = true; turret.add(t);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.8, 12), dark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.1, 1.0); turret.add(barrel);
    g.add(turret); g.userData.turret = turret;
    for (const s of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 2.8), dark);
      tr.position.set(s * 1.05, 0.35, 0); tr.castShadow = true; g.add(tr);
    }
  } else { // runner / ball-guy
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 6, 14), mat);
    body.position.y = 0.85; body.castShadow = true; g.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    eye.position.set(0.18, 1.15, 0.42); g.add(eye);
    const eye2 = eye.clone(); eye2.position.x = -0.18; g.add(eye2);
  }
  return g;
}

export function nameSprite(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 38px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(text, 128, 34); ctx.fillStyle = color; ctx.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(3.2, 0.8, 1);
  sp.renderOrder = 999;
  return sp;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
