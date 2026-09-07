import { THREE, avatar, nameSprite, clamp } from '../engine.js';

export const meta = {
  id: 'platformer',
  title: 'Tower Climb',
  tagline: 'Platformówka 3D — wespnij się na szczyt wieży, kto pierwszy?',
  color: '#ffd24a',
  tag: 'WYŚCIG',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'SKOK', color: 'linear-gradient(180deg,#ffd24a,#e59b06)' },
    { id: 'b', label: 'DASH', color: 'linear-gradient(180deg,#ff8a3d,#e2490a)' },
  ] },
};

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x0a0710);
  scene.fog = new THREE.Fog(0x0a0710, 70, 320);

  const plats = [];
  function addPlat(x, y, z, w, d, opts = {}) {
    const h = 1.6;
    const col = opts.color ?? (opts.moving ? 0xff9a1f : 0x3c2a18);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: col, roughness: .75, metalness: .15,
        emissive: opts.moving ? 0x341800 : 0x000000 }));
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; world.add(m);
    const p = { m, w, d, h, top: y + h / 2, base: new THREE.Vector3(x, y, z), ...opts };
    plats.push(p); return p;
  }

  // base
  addPlat(0, -1, 0, 40, 40, { color: 0x2a1c10 });
  const RINGS = 22;
  let y = 4;
  for (let i = 0; i < RINGS; i++) {
    const count = 3 + (i % 3);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + i * 0.7;
      const r = 16 + (i % 2) * 7;
      const moving = i > 4 && (i + k) % 5 === 0;
      const p = addPlat(Math.cos(a) * r, y, Math.sin(a) * r, 9 - (i * .1), 9 - (i * .1),
        moving ? { moving: true, phase: Math.random() * 6.28, axis: k % 2 ? 'x' : 'z', amp: 8 } : {});
      if (i > 6 && (i + k) % 7 === 0) { p.fall = true; p.m.material.color.setHex(0xa03030); }
    }
    y += 6.5;
  }
  const TOP = y;
  // goal
  const goal = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1.6, 24),
    new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xff9a1f, emissiveIntensity: .8 }));
  goal.position.set(0, TOP, 0); goal.castShadow = true; world.add(goal);
  plats.push({ m: goal, w: 12, d: 12, h: 1.6, top: TOP + .8, goal: true, base: goal.position.clone() });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 300, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff9a1f, transparent: true, opacity: .1, side: THREE.DoubleSide }));
  beam.position.set(0, TOP - 150, 0); world.add(beam);

  // stars backdrop
  const sg = new THREE.BufferGeometry(); const arr = new Float32Array(2500 * 3);
  for (let i = 0; i < 2500; i++) { arr[i*3]=(Math.random()-.5)*500; arr[i*3+1]=Math.random()*TOP*1.4-40; arr[i*3+2]=(Math.random()-.5)*500; }
  sg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  world.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffcf8a, size: 1.2 })));

  const ps = new Map();
  function spawn(p) {
    const g = avatar(p.color, 'runner');
    const s = nameSprite(p.name, p.color); s.position.y = 2.4; g.add(s);
    g.position.set((Math.random() - .5) * 14, 1, (Math.random() - .5) * 14); world.add(g);
    ps.set(p.id, { g, vy: 0, jumps: 2, dash: 0, best: 0, finished: 0, checkpoint: new THREE.Vector3(0, 1, 0) });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  let t = 0, done = [], over = false;

  return {
    update(dt) {
      t += dt;
      for (const p of plats) {
        if (p.moving) { p.m.position[p.axis] = p.base[p.axis] + Math.sin(t * 1.1 + p.phase) * p.amp; }
        if (p.falling !== undefined) {
          p.falling += dt;
          if (p.falling > .7) { p.m.position.y -= 40 * dt; p.m.material.opacity = 1; if (p.m.position.y < -40) { p.m.visible = false; p.dead = true; } }
          else p.m.rotation.z = Math.sin(p.falling * 40) * .06;
        }
      }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s) continue;
        if (s.finished) continue;
        const inp = p.input;
        const spd = 22;
        // camera-relative movement (camera always looks toward +? use world axes)
        s.g.position.x += inp.ax * spd * dt;
        s.g.position.z += inp.ay * spd * dt;
        if (inp.ax || inp.ay) s.g.rotation.y = Math.atan2(inp.ax, inp.ay);

        s.dash -= dt;
        if (inp.pressed.b && s.dash <= -0.6 && (inp.ax || inp.ay)) {
          s.dash = .18;
          net.send(p, { t: 'rumble', ms: 40 });
        }
        if (s.dash > 0) {
          s.g.position.x += inp.ax * 55 * dt; s.g.position.z += inp.ay * 55 * dt;
        }

        // ground check
        let grounded = false, ground = -Infinity, landed = null;
        for (const pl of plats) {
          if (pl.dead) continue;
          const m = pl.m;
          if (Math.abs(s.g.position.x - m.position.x) < pl.w / 2 + .5 &&
              Math.abs(s.g.position.z - m.position.z) < pl.d / 2 + .5) {
            const top = m.position.y + pl.h / 2;
            if (s.g.position.y >= top - .6 && top > ground) { ground = top; landed = pl; }
          }
        }
        s.vy -= 34 * dt;
        if (inp.pressed.a && s.jumps > 0) { s.vy = 16; s.jumps--; net.send(p, { t: 'rumble', ms: 25 }); }
        s.g.position.y += s.vy * dt;
        if (landed && s.g.position.y <= ground + .05 && s.vy <= 0) {
          s.g.position.y = ground; s.vy = 0; s.jumps = 2; grounded = true;
          if (landed.moving) s.g.position.x += 0; // ride handled by position sync below
          if (landed.fall && landed.falling === undefined) { landed.falling = 0; landed.m.material.transparent = true; }
          if (landed.goal && !s.finished) {
            s.finished = t; done.push({ name: p.name, color: p.color, time: t });
            ctx.toast(`🏁 ${p.name} na szczycie! (${t.toFixed(1)}s)`);
            net.send(p, { t: 'rumble', ms: 300 });
            if (done.length >= net.list().length && !over) {
              over = true;
              ctx.finish(done.map(d => ({ name: d.name, color: d.color, score: `${d.time.toFixed(1)}s` })));
              return;
            }
          }
          s.checkpoint.copy(s.g.position);
        }
        if (s.g.position.y < -50) { s.g.position.copy(s.checkpoint).y += 2; s.vy = 0; net.send(p, { t: 'rumble', ms: 150 }); }
        s.best = Math.max(s.best, s.g.position.y);
        net.send(p, { t: 'hud', height: `${Math.max(0, Math.round(s.g.position.y))}m`, jumps: s.jumps, time: Math.round(t) });
      }

      // camera follows highest player
      const arr = [...ps.values()].filter(s => !s.finished).sort((a, b) => b.g.position.y - a.g.position.y);
      const lead = arr[0] || [...ps.values()][0];
      const cy = lead ? lead.g.position.y : 10;
      const a2 = t * .12;
      camera.position.lerp(new THREE.Vector3(Math.cos(a2) * 48, cy + 22, Math.sin(a2) * 48), .05);
      camera.lookAt(0, cy + 4, 0);

      hud(`🗼 Wieża — szczyt na <b>${Math.round(TOP)}m</b> &nbsp; ⏱ ${t.toFixed(0)}s<br>` +
        [...ps.entries()].sort((a, b) => b[1].g.position.y - a[1].g.position.y)
          .map(([id, s], i) => {
            const p = net.players.get(id); if (!p) return '';
            return `${i + 1}. <b style="color:${p.color}">${p.name}</b> — ${Math.max(0, Math.round(s.g.position.y))}m${s.finished ? ' 🏁' : ''}`;
          }).join('<br>'));
    },
    dispose() {
      scene.remove(world);
      scene.background = new THREE.Color(0x0a0705);
      scene.fog = new THREE.Fog(0x0a0705, 60, 260);
    },
  };
}
