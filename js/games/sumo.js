import { THREE, avatar, nameSprite, clamp } from '../engine.js';

export const meta = {
  id: 'sumo',
  title: 'Sumo Balls',
  tagline: 'Wypchnij wszystkich z areny! Ostatni żywy wygrywa',
  color: '#ffd24a',
  tag: 'PARTY',
  min: 2, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'DASH', color: 'linear-gradient(180deg,#ffd24a,#e59b06)' },
    { id: 'b', label: 'SKOK', color: 'linear-gradient(180deg,#5ac8e0,#1279a0)' },
  ] },
};

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);

  let R = 46;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 3, 64),
    new THREE.MeshStandardMaterial({ color: 0x3b2f6b, roughness: 0.6 }));
  disc.position.y = -1.5; disc.receiveShadow = true; world.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.7, 12, 80),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 0.4 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; world.add(ring);
  // stars
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) { sp[i*3] = (Math.random()-.5)*600; sp[i*3+1] = Math.random()*300-50; sp[i*3+2] = (Math.random()-.5)*600; }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  world.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.1 })));

  const ps = new Map();
  function spawn(p, i) {
    const g = avatar(p.color, 'runner');
    const s = nameSprite(p.name, p.color); s.position.y = 2.4; g.add(s);
    const a = (i / 8) * Math.PI * 2;
    g.position.set(Math.cos(a) * R * 0.6, 0, Math.sin(a) * R * 0.6);
    world.add(g);
    ps.set(p.id, { g, v: new THREE.Vector3(), y: 0, vy: 0, dash: 0, cd: 0, alive: true, wins: 0 });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail, ps.size));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  let round = 1, shrink = 0, msg = '';

  function reset() {
    let i = 0;
    R = 46; shrink = 0;
    for (const [id, s] of ps) {
      const a = (i++ / Math.max(1, ps.size)) * Math.PI * 2;
      s.g.position.set(Math.cos(a) * R * 0.6, 0, Math.sin(a) * R * 0.6);
      s.v.set(0, 0, 0); s.alive = true; s.y = 0; s.vy = 0; s.g.visible = true;
    }
  }

  return {
    update(dt) {
      shrink += dt * 0.55;
      R = Math.max(14, 46 - shrink);
      disc.scale.setScalar(R / 46); ring.scale.setScalar(R / 46);

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s || !s.alive) continue;
        const inp = p.input;
        const acc = new THREE.Vector3(inp.ax, 0, inp.ay).multiplyScalar(58 * dt);
        s.v.add(acc);
        s.cd -= dt;
        if (inp.pressed.a && s.cd <= 0 && (inp.ax || inp.ay)) {
          s.cd = 1.1;
          s.v.add(new THREE.Vector3(inp.ax, 0, inp.ay).normalize().multiplyScalar(30));
          net.send(p, { t: 'rumble', ms: 60 });
        }
        if (inp.pressed.b && s.y <= 0.01) s.vy = 11;
        s.vy -= 26 * dt; s.y = Math.max(0, s.y + s.vy * dt); if (s.y === 0) s.vy = 0;
        s.v.multiplyScalar(1 - 2.2 * dt);
        s.g.position.addScaledVector(s.v, dt);
        s.g.position.y = s.y;
        if (s.v.lengthSq() > 0.2) s.g.rotation.y = Math.atan2(s.v.x, s.v.z);
        net.send(p, { t: 'hud', dash: Math.max(0, s.cd), alive: s.alive });
      }

      // collisions
      const arr = [...ps.values()].filter(s => s.alive);
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const d = a.g.position.clone().setY(0).sub(b.g.position.clone().setY(0));
        const dist = d.length();
        if (dist < 2.0 && dist > 0.001) {
          d.normalize();
          const push = d.multiplyScalar((2.0 - dist) * 26);
          a.v.add(push); b.v.sub(push);
        }
      }
      for (const [id, s] of ps) {
        if (!s.alive) continue;
        if (s.g.position.length() > R) {
          s.vy = Math.min(s.vy, 0);
          s.y -= 40 * dt; s.g.position.y = s.y;
          if (s.y < -25) { s.alive = false; s.g.visible = false; ctx.toast(`☠️ ${net.players.get(id)?.name} spada!`); }
        }
      }
      const alive = [...ps.entries()].filter(([, s]) => s.alive);
      if (ps.size >= 2 && alive.length <= 1) {
        if (alive.length === 1) alive[0][1].wins++;
        msg = alive.length ? `🏆 Runda ${round}: ${net.players.get(alive[0][0])?.name}` : 'Remis!';
        round++;
        if (round > 5) { ctx.finish(rank()); return; }
        reset();
      }

      const a = performance.now() / 9000;
      camera.position.set(Math.cos(a) * 55, 58, Math.sin(a) * 55);
      camera.lookAt(0, 0, 0);
      hud(`Runda ${Math.min(round,5)}/5 &nbsp; ${msg}<br>` + rank().map((r, i) => `${i + 1}. <b style="color:${r.color}">${r.name}</b> — ${r.score} 🏆`).join('<br>'));
    },
    dispose() { scene.remove(world); },
  };

  function rank() {
    return [...ps.entries()].map(([id, s]) => ({ name: net.players.get(id)?.name || '?', color: net.players.get(id)?.color, score: s.wins })).sort((a, b) => b.score - a.score);
  }
}
