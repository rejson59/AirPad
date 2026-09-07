import { THREE, basicScene, ground, avatar, nameSprite, clamp, lerp } from '../engine.js';

export const meta = {
  id: 'kart',
  title: 'Turbo Kart',
  tagline: 'Wyścig 3D na 3 okrążenia — driftuj i wygrywaj!',
  color: '#ff9a1f',
  tag: 'WYŚCIG',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'GAZ', color: 'linear-gradient(180deg,#8ce05a,#3f9418)' },
    { id: 'b', label: 'HAMULEC', color: 'linear-gradient(180deg,#ff6a5a,#c22412)' },
    { id: 'x', label: 'BOOST', color: 'linear-gradient(180deg,#5ac8e0,#1279a0)' },
  ] },
};

// Track: oval defined by centerline points
function trackPoints() {
  const pts = [];
  const R = 60, r = 34;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * r * (1 + 0.25 * Math.sin(a * 2))));
  }
  return pts;
}

export function start(ctx) {
  const { scene, renderer, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  ground(world, 600, 0x14351f);

  const curve = new THREE.CatmullRomCurve3(trackPoints(), true, 'centripetal');
  const road = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 400, 9, 4, true),
    new THREE.MeshStandardMaterial({ color: 0x2c2f38, roughness: 0.9 })
  );
  road.scale.y = 0.02; road.position.y = 0.4; road.receiveShadow = true; world.add(road);

  // barriers
  const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const bMat2 = new THREE.MeshStandardMaterial({ color: 0xff3b6b, roughness: 0.6 });
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    const p = curve.getPointAt(t); const tan = curve.getTangentAt(t);
    const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 3), i % 2 ? bMat : bMat2);
      c.position.copy(p).addScaledVector(n, s * 10.5); c.position.y = 0.6;
      c.lookAt(c.position.clone().add(tan)); c.castShadow = true; world.add(c);
    }
  }
  // trees
  const tg = new THREE.ConeGeometry(2.2, 6, 8), tm = new THREE.MeshStandardMaterial({ color: 0x1f7a3d });
  for (let i = 0; i < 140; i++) {
    const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 180;
    const t = new THREE.Mesh(tg, tm);
    t.position.set(Math.cos(a) * d, 3, Math.sin(a) * d); t.castShadow = true; world.add(t);
  }

  const karts = new Map();
  function spawn(p, i) {
    const g = avatar(p.color, 'kart');
    const sp = nameSprite(p.name, p.color); sp.position.y = 2.2; g.add(sp);
    world.add(g);
    const t0 = 0.0;
    const pos = curve.getPointAt(t0);
    const tan = curve.getTangentAt(t0);
    const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    g.position.copy(pos).addScaledVector(n, (i % 4 - 1.5) * 3.5).addScaledVector(tan, -Math.floor(i / 4) * 4);
    g.position.y = 0.05;
    const st = { g, vel: 0, heading: Math.atan2(tan.x, tan.z), lap: 0, prog: 0, last: 0, boost: 2, finished: false, place: 0 };
    karts.set(p.id, st);
    return st;
  }
  net.list().forEach(spawn);
  net.addEventListener('join', (e) => spawn(e.detail, karts.size));
  net.addEventListener('players', () => { for (const id of karts.keys()) if (!net.players.has(id)) { world.remove(karts.get(id).g); karts.delete(id); } });

  const LAPS = 3;
  let finishedOrder = [];
  const tmp = new THREE.Vector3();

  function nearestT(pos, guess) {
    let best = guess, bd = Infinity;
    for (let i = -14; i <= 14; i++) {
      let t = (guess + i / 300 + 1) % 1;
      const d = curve.getPointAt(t).distanceToSquared(pos);
      if (d < bd) { bd = d; best = t; }
    }
    return { t: best, d: Math.sqrt(bd) };
  }

  return {
    update(dt) {
      for (const p of net.list()) {
        const k = karts.get(p.id); if (!k || k.finished) continue;
        const inp = p.input;
        const throttle = (inp.btn.a ? 1 : 0) - (inp.btn.b ? 1 : 0) + clamp(-inp.ay, -1, 1) * 0.9;
        const steer = clamp(inp.ax, -1, 1);
        const boosting = inp.btn.x && k.boost > 0;
        if (boosting) k.boost = Math.max(0, k.boost - dt);
        const maxV = boosting ? 62 : 40;
        k.vel += (throttle > 0 ? throttle * 55 : throttle * 70) * dt;
        k.vel *= 1 - 1.1 * dt;
        k.vel = clamp(k.vel, -14, maxV);
        k.heading -= steer * dt * 2.1 * clamp(Math.abs(k.vel) / 18, 0, 1) * Math.sign(k.vel || 1);
        k.g.position.x += Math.sin(k.heading) * k.vel * dt;
        k.g.position.z += Math.cos(k.heading) * k.vel * dt;
        k.g.rotation.y = k.heading;
        k.g.rotation.z = lerp(k.g.rotation.z, -steer * 0.12, 0.15);

        // keep on track
        const { t, d } = nearestT(k.g.position, k.prog);
        if (d > 9.6) {
          const c = curve.getPointAt(t);
          tmp.copy(k.g.position).sub(c).setY(0).normalize().multiplyScalar(9.6);
          k.g.position.x = c.x + tmp.x; k.g.position.z = c.z + tmp.z;
          k.vel *= 0.86;
        }
        // lap counting
        if (t < 0.25 && k.prog > 0.75) { k.lap++; k.boost = Math.min(3, k.boost + 1.2); }
        if (t > 0.75 && k.prog < 0.25) k.lap--;
        k.prog = t;
        if (k.lap >= LAPS) {
          k.finished = true; finishedOrder.push(p);
          net.send(p, { t: 'rumble' });
          if (finishedOrder.length >= Math.min(net.list().length, 1) && finishedOrder.length === net.list().length) ctx.finish(finishedOrder.map((x, i) => ({ name: x.name, score: `#${i + 1}` })));
          else if (finishedOrder.length === 1) ctx.toast(`🏁 ${p.name} wygrywa!`);
        }
        net.send(p, { t: 'hud', speed: Math.round(Math.abs(k.vel) * 3.6), lap: `${Math.min(k.lap + 1, LAPS)}/${LAPS}`, boost: k.boost });
      }

      // camera follows leader
      const arr = [...karts.entries()].sort((a, b) => (b[1].lap + b[1].prog) - (a[1].lap + a[1].prog));
      const lead = arr[0] && arr[0][1];
      if (lead) {
        const back = new THREE.Vector3(-Math.sin(lead.heading), 0, -Math.cos(lead.heading)).multiplyScalar(16);
        const want = lead.g.position.clone().add(back).setY(9);
        camera.position.lerp(want, 0.08);
        camera.lookAt(lead.g.position.x, 1.5, lead.g.position.z);
      } else {
        const a = performance.now() / 6000;
        camera.position.set(Math.cos(a) * 120, 60, Math.sin(a) * 120);
        camera.lookAt(0, 0, 0);
      }

      hud(arr.map(([id, k], i) => {
        const p = net.players.get(id);
        return p ? `${i + 1}. <b style="color:${p.color}">${p.name}</b> — okr. ${Math.min(k.lap + 1, LAPS)}/${LAPS}` : '';
      }).join('<br>'));
    },
    dispose() { scene.remove(world); },
  };
}
