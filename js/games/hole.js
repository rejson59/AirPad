import { THREE, nameSprite } from '../engine.js';

export const meta = {
  id: 'hole',
  title: 'Hole Hunger',
  tagline: 'Jesteś dziurą — połykaj miasto i rośnij szybciej niż inni',
  color: '#7a5cff',
  tag: 'HIT',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'SPRINT', color: 'linear-gradient(180deg,#ffd24a,#e59b06)' },
  ] },
};

const SIZE = 130;

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x0c0a08);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
  // roads
  for (let i = -2; i <= 2; i++) for (const ax of ['x', 'z']) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ax === 'x' ? 9 : SIZE, ax === 'x' ? SIZE : 9),
      new THREE.MeshStandardMaterial({ color: 0x1a1815, roughness: 1 }));
    m.rotation.x = -Math.PI / 2; m.position.set(ax === 'x' ? i * 26 : 0, .02, ax === 'z' ? i * 26 : 0); world.add(m);
  }

  // props: value ~ size
  const props = [];
  function addProp(geo, mat, x, z, size, val, y) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; world.add(m);
    props.push({ m, size, val, vy: 0, eaten: null });
  }
  const matCar = [0xd94a3d, 0x3d78d9, 0xd9c23d, 0x4ad97a, 0xffffff].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: .4, metalness: .3 }));
  const matB = [0x6b6257, 0x7d7264, 0x585048].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: .9 }));
  const matTree = new THREE.MeshStandardMaterial({ color: 0x2f7a34, roughness: .9 });
  const matHum = new THREE.MeshStandardMaterial({ color: 0xffd9a0, roughness: .7 });

  for (let i = 0; i < 120; i++) { // people
    const x = (Math.random() - .5) * (SIZE - 8), z = (Math.random() - .5) * (SIZE - 8);
    addProp(new THREE.CapsuleGeometry(.4, .8, 4, 8), matHum, x, z, 1.2, 1, .8);
  }
  for (let i = 0; i < 70; i++) { // trees / lamps
    const x = (Math.random() - .5) * (SIZE - 8), z = (Math.random() - .5) * (SIZE - 8);
    addProp(new THREE.ConeGeometry(1.5, 5, 8), matTree, x, z, 2.6, 3, 2.5);
  }
  for (let i = 0; i < 55; i++) { // cars
    const x = (Math.random() - .5) * (SIZE - 8), z = (Math.random() - .5) * (SIZE - 8);
    addProp(new THREE.BoxGeometry(2.2, 1.5, 4.4), matCar[i % matCar.length], x, z, 3.6, 6, .9);
  }
  for (let i = 0; i < 46; i++) { // buildings
    const h = 8 + Math.random() * 22, w = 6 + Math.random() * 8, d = 6 + Math.random() * 8;
    const x = (Math.random() - .5) * (SIZE - 16), z = (Math.random() - .5) * (SIZE - 16);
    addProp(new THREE.BoxGeometry(w, h, d), matB[i % 3], x, z, Math.max(w, d), Math.round(h * 2.2), h / 2);
  }

  const ps = new Map();
  function spawn(p) {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = .06; g.add(disc);
    const rim = new THREE.Mesh(new THREE.RingGeometry(1, 1.16, 40),
      new THREE.MeshBasicMaterial({ color: p.color, side: THREE.DoubleSide }));
    rim.rotation.x = -Math.PI / 2; rim.position.y = .07; g.add(rim);
    const s = nameSprite(p.name, p.color); s.position.y = 3; g.add(s);
    g.position.set((Math.random() - .5) * 70, 0, (Math.random() - .5) * 70);
    world.add(g);
    ps.set(p.id, { g, disc, rim, r: 2.2, score: 0, sprint: 3, label: s });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  let t = 0; const DUR = 110; let over = false;

  return {
    update(dt) {
      t += dt;
      if (t > DUR && !over) { over = true; ctx.finish(rank()); return; }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s) continue;
        const inp = p.input;
        const sprint = inp.btn.a && s.sprint > 0;
        if (sprint) s.sprint = Math.max(0, s.sprint - dt); else s.sprint = Math.min(3, s.sprint + dt * .35);
        const spd = (sprint ? 30 : 19) * (1 - Math.min(.35, s.r / 40));
        s.g.position.x = Math.max(-SIZE/2+s.r, Math.min(SIZE/2-s.r, s.g.position.x + inp.ax * spd * dt));
        s.g.position.z = Math.max(-SIZE/2+s.r, Math.min(SIZE/2-s.r, s.g.position.z + inp.ay * spd * dt));
        s.disc.scale.setScalar(s.r); s.rim.scale.setScalar(s.r);
        s.label.position.y = 3 + s.r * .3;
        s.label.scale.set(3.2 + s.r * .2, .8 + s.r * .05, 1);

        for (const pr of props) {
          if (pr.eaten) continue;
          const d = Math.hypot(pr.m.position.x - s.g.position.x, pr.m.position.z - s.g.position.z);
          if (d < s.r && pr.size < s.r * 1.5) {
            pr.eaten = s;
            s.score += pr.val;
            s.r = Math.min(26, s.r + pr.val * 0.035);
            net.send(p, { t: 'rumble', ms: Math.min(120, 12 + pr.val) });
            if (pr.val > 25) ctx.toast(`🏙️ ${p.name} połknął budynek! +${pr.val}`);
          }
        }
        // eat smaller holes
        for (const [oid, o] of ps) {
          if (oid === p.id) continue;
          const d = s.g.position.distanceTo(o.g.position);
          if (d < s.r * .8 && o.r < s.r * .78) {
            s.score += Math.round(o.score * .35);
            s.r = Math.min(26, s.r + o.r * .25);
            o.r = 2.2; o.score = Math.round(o.score * .6);
            o.g.position.set((Math.random()-.5)*70, 0, (Math.random()-.5)*70);
            ctx.toast(`🕳️ ${p.name} pożarł ${net.players.get(oid)?.name}!`);
            const v = net.players.get(oid); if (v) net.send(v, { t: 'rumble', ms: 250 });
          }
        }
        net.send(p, { t: 'hud', score: s.score, size: s.r.toFixed(1), time: Math.ceil(Math.max(0, DUR - t)), boost: s.sprint });
      }

      // falling animation
      for (const pr of props) {
        if (!pr.eaten) continue;
        pr.vy -= 42 * dt;
        pr.m.position.y += pr.vy * dt;
        const h = pr.eaten.g.position;
        pr.m.position.x += (h.x - pr.m.position.x) * Math.min(1, 6 * dt);
        pr.m.position.z += (h.z - pr.m.position.z) * Math.min(1, 6 * dt);
        pr.m.rotation.x += dt * 3; pr.m.rotation.z += dt * 2;
        if (pr.m.position.y < -25) { world.remove(pr.m); pr.gone = true; }
      }
      for (let i = props.length - 1; i >= 0; i--) if (props[i].gone) props.splice(i, 1);

      const a = t * .06;
      camera.position.set(Math.cos(a) * 46, 112, Math.sin(a) * 46);
      camera.lookAt(0, 0, 0);
      hud(`🕳️ <b>${Math.ceil(Math.max(0, DUR - t))}s</b><br>` +
        rank().map((r, i) => `${i + 1}. <b style="color:${r.color}">${r.name}</b> — ${r.score}`).join('<br>'));
    },
    dispose() { scene.remove(world); },
  };

  function rank() {
    return [...ps.entries()].map(([id, s]) => ({ name: net.players.get(id)?.name || '?', color: net.players.get(id)?.color, score: s.score })).sort((a, b) => b.score - a.score);
  }
}
