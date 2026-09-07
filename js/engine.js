import * as THREE from 'three';
export { THREE };

export function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  if ('SRGBColorSpace' in THREE) renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function basicScene(fog = 0x0b1020) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(fog);
  scene.fog = new THREE.Fog(fog, 80, 320);
  const hemi = new THREE.HemisphereLight(0xffe2c4, 0x1a120c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.85);
  sun.position.set(48, 78, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00025;
  const d = 110;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 280;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff9a1f, 0.35);
  rim.position.set(-40, 20, -30);
  scene.add(rim);
  return scene;
}

export function skyDome(scene, top = 0x1a1028, mid = 0xff7a18, bot = 0x2a1008) {
  const g = new THREE.SphereGeometry(700, 24, 16);
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#' + new THREE.Color(top).getHexString());
  gr.addColorStop(0.45, '#' + new THREE.Color(mid).getHexString());
  gr.addColorStop(1, '#' + new THREE.Color(bot).getHexString());
  x.fillStyle = gr; x.fillRect(0, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }));
  scene.add(m);
  return m;
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

/** Console-grade 3D avatar: kart / tank / runner */
export function avatar(color, kind = 'kart') {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.38, metalness: 0.45, emissive: col, emissiveIntensity: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141018, roughness: 0.7, metalness: 0.4 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.25, metalness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.4 });

  if (kind === 'kart') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.48, 2.8), mat);
    body.position.y = 0.58; body.castShadow = true; g.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.32, 0.7), mat);
    nose.position.set(0, 0.52, 1.5); nose.castShadow = true; g.add(nose);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.5, 1.05), dark);
    cab.position.set(0, 0.98, -0.15); cab.castShadow = true; g.add(cab);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.55), glow);
    wing.position.set(0, 0.95, -1.35); g.add(wing);
    const wg = new THREE.CylinderGeometry(0.38, 0.42, 0.32, 14);
    for (const [x, z] of [[-0.9, 1.0], [0.9, 1.0], [-0.9, -1.0], [0.9, -1.0]]) {
      const w = new THREE.Mesh(wg, dark);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.38, z); w.castShadow = true; g.add(w);
    }
    for (const s of [-1, 1]) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfff4c8 }));
      light.position.set(s * 0.45, 0.55, 1.85); g.add(light);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.85 }));
    flame.rotation.x = Math.PI; flame.position.set(0, 0.5, -1.7); flame.visible = false; g.add(flame);
    g.userData.flame = flame;
  } else if (kind === 'tank') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.72, 2.8), mat);
    body.position.y = 0.58; body.castShadow = true; g.add(body);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.22, 3.0), dark);
    skirt.position.y = 0.28; g.add(skirt);
    const turret = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.52, 16), mat);
    t.position.y = 1.12; t.castShadow = true; turret.add(t);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 2.1, 12), chrome);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.14, 1.15); turret.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10), dark);
    muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 1.14, 2.2); turret.add(muzzle);
    g.add(turret); g.userData.turret = turret;
    for (const s of [-1, 1]) {
      const tr = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 2.95), dark);
      tr.position.set(s * 1.12, 0.36, 0); tr.castShadow = true; g.add(tr);
    }
  } else {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 0.72, 6, 14), mat);
    body.position.y = 0.88; body.castShadow = true; g.add(body);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), glow);
    visor.scale.set(1.3, 0.7, 0.7); visor.position.set(0, 1.22, 0.28); g.add(visor);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.25), dark);
    pack.position.set(0, 0.9, -0.4); g.add(pack);
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
