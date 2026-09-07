import { THREE, ground, avatar, nameSprite, clamp, lerp, skyDome } from '../engine.js';
import { makeSparks } from '../fx.js';
import * as SFX from '../audio.js';

export const meta = {
  id: 'kart',
  title: 'Turbo Kart',
  tagline: 'Nocny wyścig 3 okrążeń — drift, boost pady i skrzynki!',
  color: '#ff9a1f',
  tag: 'WYŚCIG',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'GAZ', color: 'linear-gradient(180deg,#8ce05a,#3f9418)' },
    { id: 'b', label: 'ITEM', color: 'linear-gradient(180deg,#ff6a5a,#c22412)' },
    { id: 'x', label: 'DRIFT', color: 'linear-gradient(180deg,#5ac8e0,#1279a0)' },
  ] },
};

function trackPoints() {
  const pts = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const R = 72 + 16 * Math.sin(a * 2) + 6 * Math.sin(a * 5);
    const r = 42 + 10 * Math.cos(a * 3);
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * r;
    const y = 1.8 * Math.sin(a * 3) + 1.2 * Math.sin(a * 2);
    pts.push(new THREE.Vector3(x, y, z));
  }
  return pts;
}

function roadMesh(curve, width = 11) {
  const segs = 360, hw = width / 2;
  const pos = [], nrm = [], uv = [], idx = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p); curve.getTangentAt(t, tan);
    side.crossVectors(up, tan).normalize();
    const y = p.y;
    for (const s of [-1, 1]) {
      pos.push(p.x + side.x * hw * s, y + 0.05, p.z + side.z * hw * s);
      nrm.push(0, 1, 0);
      uv.push(t * 40, s < 0 ? 0 : 1);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  const prevFog = scene.fog, prevBg = scene.background;
  scene.background = new THREE.Color(0x0a0614);
  scene.fog = new THREE.Fog(0x140818, 70, 280);
  const sky = skyDome(scene, 0x080614, 0xc44a12, 0x1a0806);
  ground(world, 700, 0x0e1a10);

  const curve = new THREE.CatmullRomCurve3(trackPoints(), true, 'catmullrom', 0.35);
  const road = new THREE.Mesh(
    roadMesh(curve, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.72, metalness: 0.15 })
  );
  road.receiveShadow = true; world.add(road);

  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
  for (let i = 0; i < 80; i++) {
    const t = i / 80, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 1.6), stripeMat);
    m.position.copy(p); m.position.y += 0.12;
    m.lookAt(p.clone().add(tan));
    world.add(m);
  }

  const bMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 0.45 });
  const bMat2 = new THREE.MeshStandardMaterial({ color: 0xff3b1f, roughness: 0.45, emissive: 0x4a0800, emissiveIntensity: 0.3 });
  for (let i = 0; i < 160; i++) {
    const t = i / 160;
    const p = curve.getPointAt(t); const tan = curve.getTangentAt(t);
    const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.15, 2.2), i % 2 ? bMat : bMat2);
      c.position.copy(p).addScaledVector(n, s * 6.4); c.position.y += 0.7;
      c.lookAt(c.position.clone().add(tan)); c.castShadow = true; world.add(c);
    }
  }

  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffc078 });
  for (let i = 0; i < 10; i++) {
    const t = i / 10, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 9, 6), new THREE.MeshStandardMaterial({ color: 0x222 }));
    pole.position.copy(p).addScaledVector(n, 8.5); pole.position.y += 4.5; world.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), lightMat);
    lamp.position.copy(pole.position); lamp.position.y += 4.6; world.add(lamp);
    const spot = new THREE.PointLight(0xffb060, 1.4, 28);
    spot.position.copy(lamp.position); world.add(spot);
  }

  const tg = new THREE.ConeGeometry(2.4, 7, 7), tm = new THREE.MeshStandardMaterial({ color: 0x145a28, flatShading: true });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x3a2410 });
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, d = 95 + Math.random() * 160;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 3, 6), trunk);
    st.position.set(Math.cos(a) * d, 1.5, Math.sin(a) * d); world.add(st);
    const t = new THREE.Mesh(tg, tm);
    t.position.set(st.position.x, 6, st.position.z); t.castShadow = true; world.add(t);
  }

  // boost pads
  const pads = [];
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3ad0ff, emissive: 0x1aa0ff, emissiveIntensity: 0.9 });
  for (const t0 of [0.18, 0.52, 0.84]) {
    const p = curve.getPointAt(t0), tan = curve.getTangentAt(t0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 4), padMat);
    m.position.copy(p); m.position.y += 0.16; m.lookAt(p.clone().add(tan)); world.add(m);
    pads.push({ t: t0, m });
  }

  // item boxes
  const boxes = [];
  const boxGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  for (const t0 of [0.08, 0.33, 0.61, 0.91]) {
    const p = curve.getPointAt(t0);
    const m = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({
      color: 0xffe07a, emissive: 0xff9a1f, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.4, transparent: true, opacity: 0.95,
    }));
    m.position.copy(p); m.position.y += 1.6; world.add(m);
    boxes.push({ t: t0, m, alive: 0 });
  }

  const sparks = makeSparks(world, 220);

  const karts = new Map();
  function spawn(p, i) {
    const g = avatar(p.color, 'kart');
    const sp = nameSprite(p.name, p.color); sp.position.y = 2.3; g.add(sp);
    world.add(g);
    const t0 = 0.0;
    const pos = curve.getPointAt(t0);
    const tan = curve.getTangentAt(t0);
    const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    g.position.copy(pos).addScaledVector(n, (i % 4 - 1.5) * 2.6).addScaledVector(tan, -Math.floor(i / 4) * 4.2);
    g.position.y += 0.05;
    const st = {
      g, vel: 0, heading: Math.atan2(tan.x, tan.z), lap: 0, prog: 0, boost: 1.2, finished: false,
      drift: 0, item: null, itemT: 0, slip: 0, boostUse: 0,
    };
    karts.set(p.id, st);
    return st;
  }
  net.list().forEach(spawn);
  net.addEventListener('join', (e) => spawn(e.detail, karts.size));
  net.addEventListener('players', () => { for (const id of karts.keys()) if (!net.players.has(id)) { world.remove(karts.get(id).g); karts.delete(id); } });

  const LAPS = 3;
  let finishedOrder = [];
  const tmp = new THREE.Vector3();
  const oils = [];

  function nearestT(pos, guess) {
    let best = guess, bd = Infinity;
    for (let i = -16; i <= 16; i++) {
      let t = (guess + i / 320 + 1) % 1;
      const d = curve.getPointAt(t).distanceToSquared(pos);
      if (d < bd) { bd = d; best = t; }
    }
    return { t: best, d: Math.sqrt(bd) };
  }

  function giveItem(k) {
    k.item = ['turbo', 'turbo', 'oil', 'rocket'][(Math.random() * 4) | 0];
    k.itemT = 0;
    SFX.collect();
  }

  return {
    update(dt) {
      for (const b of boxes) {
        if (b.alive > 0) { b.alive -= dt; b.m.visible = b.alive <= 0; }
        b.m.rotation.y += dt * 2.2; b.m.rotation.x = Math.sin(performance.now() / 400) * 0.2;
        b.m.position.y = curve.getPointAt(b.t).y + 1.6 + Math.sin(performance.now() / 280) * 0.25;
      }
      for (const p of pads) p.m.material.emissiveIntensity = 0.6 + Math.sin(performance.now() / 140) * 0.4;

      let maxSpd = 0;
      for (const p of net.list()) {
        const k = karts.get(p.id); if (!k || k.finished) continue;
        const inp = p.input;
        const throttle = (inp.btn.a ? 1 : 0) - ((inp.btn.b && !k.item) ? 0.9 : 0) + clamp(-inp.ay, -1, 1) * 0.85;
        const steer = clamp(inp.ax, -1, 1);
        const drifting = !!(inp.btn.x && Math.abs(steer) > 0.25 && k.vel > 12);
        if (drifting) { k.drift = Math.min(1.4, k.drift + dt); k.boost = Math.min(3, k.boost + dt * 0.35); }
        else k.drift = Math.max(0, k.drift - dt * 2);

        if (k.slip > 0) { k.slip -= dt; k.heading += (Math.random() - 0.5) * 4 * dt; }

        const boosting = k.boostUse > 0;
        if (boosting) k.boostUse -= dt;
        const maxV = boosting ? 68 : (drifting ? 36 : 44);
        k.vel += (throttle > 0 ? throttle * 58 : throttle * 80) * dt;
        k.vel *= 1 - (drifting ? 0.7 : 1.05) * dt;
        k.vel = clamp(k.vel, -16, maxV);
        const steerAmt = 2.35 + k.drift * 0.9;
        k.heading -= steer * dt * steerAmt * clamp(Math.abs(k.vel) / 16, 0, 1) * Math.sign(k.vel || 1);
        k.g.position.x += Math.sin(k.heading) * k.vel * dt;
        k.g.position.z += Math.cos(k.heading) * k.vel * dt;
        k.g.rotation.y = k.heading;
        k.g.rotation.z = lerp(k.g.rotation.z, -steer * (0.18 + k.drift * 0.2), 0.18);

        const { t, d } = nearestT(k.g.position, k.prog);
        const on = curve.getPointAt(t);
        k.g.position.y = lerp(k.g.position.y, on.y + 0.05, 0.35);
        if (d > 6.4) {
          tmp.copy(k.g.position).sub(on).setY(0).normalize().multiplyScalar(6.4);
          k.g.position.x = on.x + tmp.x; k.g.position.z = on.z + tmp.z;
          k.vel *= 0.82;
          sparks.burst(k.g.position.x, k.g.position.y + 0.4, k.g.position.z, 0xff9a1f, 6, 8);
        }
        if (drifting && k.vel > 10) sparks.burst(k.g.position.x, k.g.position.y + 0.2, k.g.position.z, 0xffc44a, 3, 5);

        if (t < 0.22 && k.prog > 0.78) {
          k.lap++; k.boost = Math.min(3, k.boost + 0.8); SFX.lapBell();
          net.send(p, { t: 'rumble', ms: 80 });
        }
        if (t > 0.78 && k.prog < 0.22) k.lap--;
        k.prog = t;

        for (const pad of pads) {
          if (Math.abs(((t - pad.t + 0.5) % 1) - 0.5) < 0.012 && d < 6) {
            k.boostUse = Math.max(k.boostUse || 0, 0.9);
            if (k.g.userData.flame) k.g.userData.flame.visible = true;
          }
        }
        if (k.g.userData.flame) k.g.userData.flame.visible = !!(k.boostUse > 0);

        for (const b of boxes) {
          if (b.alive > 0 || !b.m.visible) continue;
          if (k.g.position.distanceTo(b.m.position) < 2.4) {
            b.alive = 6; b.m.visible = false; giveItem(k);
            net.send(p, { t: 'rumble', ms: 40 });
          }
        }

        if (k.item && inp.pressed.b) {
          const it = k.item; k.item = null;
          if (it === 'turbo') { k.boostUse = 1.3; SFX.boost(); net.send(p, { t: 'rumble', ms: 70 }); }
          if (it === 'oil') {
            const m = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16), new THREE.MeshBasicMaterial({ color: 0x111, transparent: true, opacity: 0.7 }));
            m.rotation.x = -Math.PI / 2;
            m.position.copy(k.g.position).add(new THREE.Vector3(-Math.sin(k.heading), 0, -Math.cos(k.heading)).multiplyScalar(4));
            m.position.y = curve.getPointAt(k.prog).y + 0.12;
            world.add(m); oils.push({ m, life: 18 });
          }
          if (it === 'rocket') {
            const dir = new THREE.Vector3(Math.sin(k.heading), 0, Math.cos(k.heading));
            const m = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 8), new THREE.MeshBasicMaterial({ color: p.color }));
            m.position.copy(k.g.position).addScaledVector(dir, 2).setY(k.g.position.y + 0.8);
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            world.add(m);
            oils.push({ m, life: 2.2, rocket: true, dir, owner: p.id });
            SFX.boost();
          }
        }

        if (k.lap >= LAPS) {
          k.finished = true; finishedOrder.push(p);
          net.send(p, { t: 'rumble', ms: 200 });
          SFX.goal();
          if (finishedOrder.length === net.list().length) ctx.finish(finishedOrder.map((x, i) => ({ name: x.name, score: `#${i + 1}` })));
          else if (finishedOrder.length === 1) ctx.toast(`🏁 ${p.name} wygrywa!`);
        }
        maxSpd = Math.max(maxSpd, Math.abs(k.vel));
        net.send(p, { t: 'hud', speed: Math.round(Math.abs(k.vel) * 3.6), lap: `${Math.min(k.lap + 1, LAPS)}/${LAPS}`, boost: k.boost, score: k.item ? (k.item === 'turbo' ? '🚀' : k.item === 'oil' ? '🛢️' : '🚀') : '—' });
      }

      for (let i = oils.length - 1; i >= 0; i--) {
        const o = oils[i]; o.life -= dt;
        if (o.rocket) {
          o.m.position.addScaledVector(o.dir, 90 * dt);
          for (const [id, k] of karts) {
            if (id === o.owner || k.finished) continue;
            if (k.g.position.distanceTo(o.m.position) < 2.2) {
              k.slip = 1.1; k.vel *= 0.4;
              sparks.burst(k.g.position.x, 1, k.g.position.z, 0xff4d33, 20, 14);
              SFX.explosion(); o.life = 0;
              const v = net.players.get(id); if (v) net.send(v, { t: 'rumble', ms: 180 });
            }
          }
        } else {
          for (const k of karts.values()) {
            if (k.g.position.distanceTo(o.m.position) < 2.4) k.slip = Math.max(k.slip, 0.8);
          }
        }
        if (o.life <= 0) { world.remove(o.m); oils.splice(i, 1); }
      }

      sparks.update(dt);
      SFX.setEngine(clamp(maxSpd / 50, 0, 1));

      const arr = [...karts.entries()].sort((a, b) => (b[1].lap + b[1].prog) - (a[1].lap + a[1].prog));
      const lead = arr[0] && arr[0][1];
      if (lead) {
        const back = new THREE.Vector3(-Math.sin(lead.heading), 0, -Math.cos(lead.heading)).multiplyScalar(14 + Math.abs(lead.vel) * 0.08);
        const want = lead.g.position.clone().add(back); want.y += 6.5;
        camera.position.lerp(want, 0.11);
        camera.lookAt(lead.g.position.x, lead.g.position.y + 1.4, lead.g.position.z);
        camera.fov = lerp(camera.fov || 60, lead.boostUse > 0 ? 72 : 58, 0.08);
        camera.updateProjectionMatrix();
      }

      hud(arr.map(([id, k], i) => {
        const p = net.players.get(id);
        const item = k.item ? (k.item === 'oil' ? '🛢️' : '🚀') : '';
        return p ? `${i + 1}. <b style="color:${p.color}">${p.name}</b> — okr. ${Math.min(k.lap + 1, LAPS)}/${LAPS} ${item}` : '';
      }).join('<br>'));
    },
    dispose() {
      SFX.stopEngine();
      scene.remove(world); scene.remove(sky);
      scene.fog = prevFog; scene.background = prevBg;
    },
  };
}
