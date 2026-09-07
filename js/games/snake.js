import { THREE, nameSprite } from '../engine.js';

export const meta = {
  id: 'snake',
  title: 'Snake Royale',
  tagline: 'Węże 3D w arenie — rośnij, tnij przeciwników, przetrwaj',
  color: '#8ce05a',
  tag: 'KLASYK',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'SPRINT', color: 'linear-gradient(180deg,#8ce05a,#3f9418)' },
  ] },
};

const R = 70;

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x060a06);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64),
    new THREE.MeshStandardMaterial({ color: 0x101a10, roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
  const grid = new THREE.GridHelper(R * 2, 56, 0x2c5c2c, 0x1a2f1a);
  grid.position.y = .02; grid.material.transparent = true; grid.material.opacity = .35; world.add(grid);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, .9, 12, 90),
    new THREE.MeshStandardMaterial({ color: 0xff9a1f, emissive: 0xff9a1f, emissiveIntensity: .6 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = .5; world.add(ring);

  const foods = [];
  const foodGeo = new THREE.IcosahedronGeometry(1.5, 0);
  function addFood(big = false) {
    const a = Math.random() * 6.283, d = Math.random() * (R - 6);
    const m = new THREE.Mesh(foodGeo, new THREE.MeshStandardMaterial({
      color: big ? 0xff4d3d : 0xffd24a, emissive: big ? 0xff4d3d : 0xffd24a, emissiveIntensity: .6 }));
    m.scale.setScalar(big ? 1.8 : 1);
    m.position.set(Math.cos(a) * d, 1.5, Math.sin(a) * d);
    world.add(m); foods.push({ m, val: big ? 5 : 1 });
  }
  for (let i = 0; i < 70; i++) addFood(Math.random() < .12);

  const ps = new Map();
  const segGeo = new THREE.SphereGeometry(1.25, 12, 12);
  function spawn(p) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 16),
      new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: .3, roughness: .4 }));
    head.castShadow = true;
    const s = nameSprite(p.name, p.color); s.position.y = 3.4; head.add(s);
    world.add(head);
    const a = Math.random() * 6.283;
    head.position.set(Math.cos(a) * R * .5, 1.7, Math.sin(a) * R * .5);
    ps.set(p.id, { head, heading: -a, segs: [], path: [], len: 8, score: 0, alive: true, boost: 3, mat: head.material.color.clone(), color: p.color });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { kill(id, true); ps.delete(id); } });

  function kill(id, silent) {
    const s = ps.get(id); if (!s) return;
    world.remove(s.head);
    for (const m of s.segs) world.remove(m);
    s.segs = []; s.path = []; s.alive = false;
    if (!silent) {
      // drop food along body
      for (let i = 0; i < s.len; i += 3) addFood(true);
      ctx.toast(`💀 ${net.players.get(id)?.name} zginął`);
      const p = net.players.get(id); if (p) net.send(p, { t: 'rumble', ms: 260 });
      setTimeout(() => { if (net.players.has(id)) respawn(id); }, 2500);
    }
  }
  function respawn(id) {
    const p = net.players.get(id); if (!p) return;
    ps.delete(id); spawn(p);
  }

  let t = 0;
  const DUR = 120;

  return {
    update(dt) {
      t += dt;
      if (t > DUR) { ctx.finish(rank()); return; }
      for (const f of foods) { f.m.rotation.y += dt * 2; f.m.position.y = 1.5 + Math.sin(performance.now()/500 + f.m.position.x) * .3; }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s || !s.alive) continue;
        const inp = p.input;
        if (Math.abs(inp.ax) + Math.abs(inp.ay) > .2) {
          const want = Math.atan2(inp.ax, inp.ay);
          let diff = ((want - s.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          s.heading += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
        }
        const boosting = inp.btn.a && s.boost > 0 && s.len > 10;
        if (boosting) { s.boost = Math.max(0, s.boost - dt); s.len = Math.max(8, s.len - dt * 4); }
        else s.boost = Math.min(3, s.boost + dt * .4);
        const spd = boosting ? 42 : 24;
        s.head.position.x += Math.sin(s.heading) * spd * dt;
        s.head.position.z += Math.cos(s.heading) * spd * dt;

        if (Math.hypot(s.head.position.x, s.head.position.z) > R - 1.7) { kill(p.id); continue; }

        s.path.unshift(s.head.position.clone());
        if (s.path.length > 900) s.path.pop();
        const want = Math.floor(s.len);
        while (s.segs.length < want) {
          const m = new THREE.Mesh(segGeo, new THREE.MeshStandardMaterial({ color: s.color, roughness: .5 }));
          m.castShadow = true; world.add(m); s.segs.push(m);
        }
        while (s.segs.length > want) world.remove(s.segs.pop());
        s.segs.forEach((m, i) => {
          const pt = s.path[Math.min(s.path.length - 1, (i + 1) * 5)];
          if (pt) { m.position.copy(pt); m.scale.setScalar(1 - i / (s.segs.length * 2.6)); }
        });

        for (let i = foods.length - 1; i >= 0; i--) {
          if (foods[i].m.position.distanceTo(s.head.position) < 3.2) {
            s.len += foods[i].val; s.score += foods[i].val;
            world.remove(foods[i].m); foods.splice(i, 1);
            addFood(Math.random() < .12);
            net.send(p, { t: 'rumble', ms: 25 });
          }
        }
        // hit other snakes
        for (const [oid, o] of ps) {
          if (oid === p.id || !o.alive) continue;
          for (const m of o.segs) {
            if (m.position.distanceTo(s.head.position) < 2.5) {
              o.score += 10;
              ctx.toast(`⚔️ ${net.players.get(oid)?.name} tnie ${p.name}!`);
              kill(p.id);
              break;
            }
          }
          if (!s.alive) break;
        }
        if (s.alive) net.send(p, { t: 'hud', score: s.score, boost: s.boost, time: Math.ceil(DUR - t) });
      }

      const a = t * .09;
      camera.position.set(Math.cos(a) * 40, 118, Math.sin(a) * 40);
      camera.lookAt(0, 0, 0);
      hud(`⏱ ${Math.ceil(DUR - t)}s<br>` + rank().map((r,i)=>`${i+1}. <b style="color:${r.color}">${r.name}</b> — ${r.score} 🍎`).join('<br>'));
    },
    dispose() { scene.remove(world); },
  };

  function rank() {
    return [...ps.entries()].map(([id,s])=>({name:net.players.get(id)?.name||'?',color:net.players.get(id)?.color,score:s.score})).sort((a,b)=>b.score-a.score);
  }
}
