import { THREE, ground, gridHelper, avatar, nameSprite, clamp } from '../engine.js';

export const meta = {
  id: 'tanks',
  title: 'Tank Arena',
  tagline: 'Deathmatch czołgów 3D — 15 fragów wygrywa',
  color: '#8ce05a',
  tag: 'AKCJA',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'STRZAŁ', color: 'linear-gradient(180deg,#ff6a5a,#c22412)' },
    { id: 'b', label: 'TURBO', color: 'linear-gradient(180deg,#5ac8e0,#1279a0)' },
  ], aim: true },
};

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  ground(world, 240, 0x2a2f1f); gridHelper(world, 240, 48, 0x4a5a3a, 0x333c28);

  const R = 100;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b5b3e, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(i < 2 ? 2 * R : 4, 8, i < 2 ? 4 : 2 * R), wallMat);
    w.position.set(i === 2 ? -R : i === 3 ? R : 0, 4, i === 0 ? -R : i === 1 ? R : 0);
    w.castShadow = w.receiveShadow = true; world.add(w);
  }
  const blocks = [];
  for (let i = 0; i < 26; i++) {
    const s = 5 + Math.random() * 8;
    const b = new THREE.Mesh(new THREE.BoxGeometry(s, 5 + Math.random() * 5, s), wallMat);
    b.position.set((Math.random() - 0.5) * 170, b.geometry.parameters.height / 2, (Math.random() - 0.5) * 170);
    if (b.position.length() < 20) { i--; continue; }
    b.castShadow = b.receiveShadow = true; world.add(b); blocks.push({ m: b, r: s * 0.72 });
  }

  const tanks = new Map();
  const bullets = [];
  const bgeo = new THREE.SphereGeometry(0.45, 10, 10);

  function spawnPos() {
    for (let i = 0; i < 60; i++) {
      const p = new THREE.Vector3((Math.random() - 0.5) * 170, 0, (Math.random() - 0.5) * 170);
      if (blocks.every(b => p.distanceTo(b.m.position) > b.r + 4)) return p;
    }
    return new THREE.Vector3();
  }
  function spawn(p) {
    const g = avatar(p.color, 'tank');
    const sp = nameSprite(p.name, p.color); sp.position.y = 2.6; g.add(sp);
    g.position.copy(spawnPos()); world.add(g);
    tanks.set(p.id, { g, heading: Math.random() * 6.28, aim: 0, cd: 0, hp: 100, kills: 0, turbo: 3, dead: 0 });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of tanks.keys()) if (!net.players.has(id)) { world.remove(tanks.get(id).g); tanks.delete(id); } });

  const GOAL = 15;
  let over = false;

  function collide(pos, rad) {
    for (const b of blocks) {
      const d = pos.clone().setY(0).sub(b.m.position.clone().setY(0));
      const dist = d.length();
      if (dist < b.r + rad) { d.normalize().multiplyScalar(b.r + rad - dist); pos.x += d.x; pos.z += d.z; return true; }
    }
    let hit = false;
    if (Math.abs(pos.x) > R - 3) { pos.x = Math.sign(pos.x) * (R - 3); hit = true; }
    if (Math.abs(pos.z) > R - 3) { pos.z = Math.sign(pos.z) * (R - 3); hit = true; }
    return hit;
  }

  return {
    update(dt) {
      for (const p of net.list()) {
        const t = tanks.get(p.id); if (!t) continue;
        if (t.dead > 0) { t.dead -= dt; t.g.visible = false; if (t.dead <= 0) { t.g.visible = true; t.hp = 100; t.g.position.copy(spawnPos()); } continue; }
        const inp = p.input;
        const turbo = inp.btn.b && t.turbo > 0;
        if (turbo) t.turbo = Math.max(0, t.turbo - dt); else t.turbo = Math.min(3, t.turbo + dt * 0.35);
        const spd = (turbo ? 34 : 20);
        const mv = new THREE.Vector2(inp.ax, inp.ay);
        if (mv.length() > 0.15) {
          const want = Math.atan2(mv.x, -mv.y);
          let diff = ((want - t.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          t.heading += clamp(diff, -3.5 * dt, 3.5 * dt);
          const f = Math.min(1, mv.length());
          t.g.position.x += Math.sin(t.heading) * spd * f * dt;
          t.g.position.z += Math.cos(t.heading) * spd * f * dt;
          collide(t.g.position, 1.6);
        }
        t.g.rotation.y = t.heading;
        if (inp.aimx !== undefined) { /* reserved */ }
        // aim = tank heading + stick-independent aim from second stick if provided
        const aimA = (p.input.btn.__aim !== undefined) ? 0 : 0;
        t.g.userData.turret.rotation.y = 0;

        t.cd -= dt;
        if (inp.btn.a && t.cd <= 0) {
          t.cd = 0.42;
          const dir = new THREE.Vector3(Math.sin(t.heading), 0, Math.cos(t.heading));
          const m = new THREE.Mesh(bgeo, new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.7 }));
          m.position.copy(t.g.position).addScaledVector(dir, 2.4).setY(1.1);
          world.add(m);
          bullets.push({ m, dir, life: 2.6, owner: p.id });
          net.send(p, { t: 'rumble', ms: 40 });
        }
        net.send(p, { t: 'hud', hp: Math.round(t.hp), kills: t.kills, turbo: t.turbo });
      }

      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.m.position.addScaledVector(b.dir, 95 * dt);
        b.life -= dt;
        let dead = b.life <= 0;
        if (!dead && collide(b.m.position, 0.4)) dead = true;
        if (!dead) for (const [id, t] of tanks) {
          if (id === b.owner || t.dead > 0) continue;
          if (t.g.position.distanceTo(b.m.position) < 2.2) {
            t.hp -= 25; dead = true;
            const victim = net.players.get(id);
            if (victim) net.send(victim, { t: 'rumble', ms: 120 });
            if (t.hp <= 0) {
              t.dead = 2.2; t.hp = 0;
              const k = tanks.get(b.owner);
              if (k) { k.kills++; if (k.kills >= GOAL && !over) { over = true; ctx.finish(rank()); } }
              ctx.toast(`💥 ${net.players.get(b.owner)?.name || '?'} → ${victim?.name || '?'}`);
            }
            break;
          }
        }
        if (dead) { world.remove(b.m); bullets.splice(i, 1); }
      }

      const a = performance.now() / 14000;
      camera.position.set(Math.cos(a) * 40, 135, Math.sin(a) * 40 + 30);
      camera.lookAt(0, 0, 0);
      hud(rank().map((r, i) => `${i + 1}. <b style="color:${r.color}">${r.name}</b> — ${r.score} 💀`).join('<br>'));
    },
    dispose() { scene.remove(world); },
  };

  function rank() {
    return [...tanks.entries()].map(([id, t]) => ({ name: net.players.get(id)?.name || '?', color: net.players.get(id)?.color, score: t.kills }))
      .sort((a, b) => b.score - a.score);
  }
}
