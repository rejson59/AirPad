import { THREE } from './engine.js';

/** Cheap pooled spark bursts (no textures). */
export function makeSparks(parent, max = 180) {
  const geo = new THREE.SphereGeometry(0.18, 6, 6);
  const pool = [];
  for (let i = 0; i < max; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffc44a, transparent: true, opacity: 0 }));
    m.visible = false;
    parent.add(m);
    pool.push({ m, vx: 0, vy: 0, vz: 0, life: 0 });
  }
  let i = 0;
  return {
    burst(x, y, z, color = 0xff9a1f, n = 18, power = 12) {
      for (let k = 0; k < n; k++) {
        const p = pool[i++ % pool.length];
        p.m.visible = true;
        p.m.position.set(x, y, z);
        p.m.material.color.setHex(typeof color === 'number' ? color : 0xff9a1f);
        p.m.material.opacity = 1;
        p.vx = (Math.random() - 0.5) * power;
        p.vy = Math.random() * power * 0.8;
        p.vz = (Math.random() - 0.5) * power;
        p.life = 0.35 + Math.random() * 0.4;
      }
    },
    update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.vy -= 18 * dt;
        p.m.position.x += p.vx * dt;
        p.m.position.y += p.vy * dt;
        p.m.position.z += p.vz * dt;
        p.m.material.opacity = Math.max(0, p.life * 2);
        if (p.life <= 0) p.m.visible = false;
      }
    },
  };
}

export function shake(camera, mag = 0.4) {
  camera.position.x += (Math.random() - 0.5) * mag;
  camera.position.y += (Math.random() - 0.5) * mag * 0.5;
}
