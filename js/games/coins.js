import { THREE, ground, gridHelper, avatar, nameSprite, clamp } from '../engine.js';

export const meta = {
  id: 'coins',
  title: 'Coin Rush',
  tagline: 'Zbierz najwięcej monet w 90 sekund — omijaj bomby!',
  color: '#3aa0ff',
  tag: 'ARCADE',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'SKOK', color: 'linear-gradient(180deg,#5ac8e0,#1279a0)' },
    { id: 'b', label: 'SPRINT', color: 'linear-gradient(180deg,#ffd24a,#e59b06)' },
  ] },
};

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  ground(world, 200, 0x101a33); gridHelper(world, 200, 40, 0x2b3c6b, 0x18233f);
  const S = 88;

  // platforms
  const pmat = new THREE.MeshStandardMaterial({ color: 0x27407a, roughness: 0.7 });
  const plats = [];
  for (let i = 0; i < 18; i++) {
    const w = 8 + Math.random() * 14, h = 2 + Math.random() * 7, d = 8 + Math.random() * 14;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pmat);
    m.position.set((Math.random() - .5) * 150, h / 2, (Math.random() - .5) * 150);
    m.castShadow = m.receiveShadow = true; world.add(m);
    plats.push({ m, w, h, d });
  }

  const coinGeo = new THREE.TorusGeometry(0.8, 0.28, 10, 20);
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa000, emissiveIntensity: .5, metalness: .8, roughness: .25 });
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x222833, roughness: .4 });
  const coins = [], bombs = [];

  function topAt(x, z) {
    let y = 0;
    for (const p of plats) {
      if (Math.abs(x - p.m.position.x) < p.w / 2 && Math.abs(z - p.m.position.z) < p.d / 2) y = Math.max(y, p.h);
    }
    return y;
  }
  function addCoin() {
    const x = (Math.random() - .5) * 160, z = (Math.random() - .5) * 160;
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.position.set(x, topAt(x, z) + 1.3, z); m.castShadow = true; world.add(m); coins.push(m);
  }
  function addBomb() {
    const x = (Math.random() - .5) * 160, z = (Math.random() - .5) * 160;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 14), bombMat);
    m.position.set(x, topAt(x, z) + 1.1, z); m.castShadow = true; world.add(m);
    bombs.push({ m, dir: new THREE.Vector3(Math.random() - .5, 0, Math.random() - .5).normalize() });
  }
  for (let i = 0; i < 45; i++) addCoin();
  for (let i = 0; i < 10; i++) addBomb();

  const ps = new Map();
  function spawn(p) {
    const g = avatar(p.color, 'runner');
    const s = nameSprite(p.name, p.color); s.position.y = 2.3; g.add(s);
    g.position.set((Math.random() - .5) * 40, 0, (Math.random() - .5) * 40); world.add(g);
    ps.set(p.id, { g, vy: 0, y: 0, score: 0, stun: 0, sprint: 3 });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  let time = 90, over = false;

  return {
    update(dt) {
      time -= dt;
      if (time <= 0 && !over) { over = true; ctx.finish(rank()); }

      for (const c of coins) c.rotation.y += dt * 3;
      for (const b of bombs) {
        b.m.position.addScaledVector(b.dir, 16 * dt);
        if (Math.abs(b.m.position.x) > S || Math.abs(b.m.position.z) > S) b.dir.multiplyScalar(-1);
        b.m.position.y = topAt(b.m.position.x, b.m.position.z) + 1.1;
      }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s) continue;
        const inp = p.input;
        if (s.stun > 0) { s.stun -= dt; s.g.rotation.z += dt * 12; }
        else {
          s.g.rotation.z = 0;
          const sprint = inp.btn.b && s.sprint > 0;
          if (sprint) s.sprint = Math.max(0, s.sprint - dt); else s.sprint = Math.min(3, s.sprint + dt * .4);
          const spd = sprint ? 34 : 20;
          const dx = inp.ax * spd * dt, dz = inp.ay * spd * dt;
          s.g.position.x = clamp(s.g.position.x + dx, -S, S);
          s.g.position.z = clamp(s.g.position.z + dz, -S, S);
          if (dx || dz) s.g.rotation.y = Math.atan2(dx, dz);
          if (inp.pressed.a && Math.abs(s.y - topAt(s.g.position.x, s.g.position.z)) < 0.3) s.vy = 13;
        }
        s.vy -= 30 * dt; s.y += s.vy * dt;
        const floor = topAt(s.g.position.x, s.g.position.z);
        if (s.y < floor) { s.y = floor; s.vy = 0; }
        s.g.position.y = s.y;

        for (let i = coins.length - 1; i >= 0; i--) {
          if (coins[i].position.distanceTo(s.g.position.clone().setY(s.y + 1)) < 2.0) {
            world.remove(coins[i]); coins.splice(i, 1); s.score++;
            net.send(p, { t: 'rumble', ms: 35 }); addCoin();
          }
        }
        if (s.stun <= 0) for (const b of bombs) {
          if (b.m.position.distanceTo(s.g.position.clone().setY(s.y + 1)) < 2.2) {
            s.stun = 1.6; s.score = Math.max(0, s.score - 3);
            net.send(p, { t: 'rumble', ms: 200 });
            ctx.toast(`💣 ${p.name} wpadł na bombę!`);
          }
        }
        net.send(p, { t: 'hud', score: s.score, time: Math.ceil(Math.max(0, time)), sprint: s.sprint });
      }

      const a = performance.now() / 12000;
      camera.position.set(Math.cos(a) * 60, 105, Math.sin(a) * 60);
      camera.lookAt(0, 0, 0);
      hud(`⏱ ${Math.ceil(Math.max(0, time))}s<br>` + rank().map((r, i) => `${i + 1}. <b style="color:${r.color}">${r.name}</b> — ${r.score} 🪙`).join('<br>'));
    },
    dispose() { scene.remove(world); },
  };

  function rank() {
    return [...ps.entries()].map(([id, s]) => ({ name: net.players.get(id)?.name || '?', color: net.players.get(id)?.color, score: s.score })).sort((a, b) => b.score - a.score);
  }
}
