import { THREE, nameSprite, avatar } from '../engine.js';

export const meta = {
  id: 'paint',
  title: 'Splat Wars',
  tagline: 'Zamaluj jak najwięcej terenu swoim kolorem w 90 sekund',
  color: '#e5417f',
  tag: 'AREA',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'SPRINT', color: 'linear-gradient(180deg,#ffd24a,#e59b06)' },
    { id: 'b', label: 'BOMBA', color: 'linear-gradient(180deg,#ff8a3d,#e2490a)' },
  ] },
};

const GRID = 96, SIZE = 120;

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x0a0705);

  // canvas texture as the paintable floor
  const cv = document.createElement('canvas');
  cv.width = cv.height = GRID * 8;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#1d1a17'; g2.fillRect(0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ map: tex, roughness: .9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);

  // ownership grid
  const own = new Int8Array(GRID * GRID).fill(-1);
  const ids = [];   // index -> player id

  // obstacles
  const obs = [];
  const oMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: .8 });
  for (let i = 0; i < 14; i++) {
    const w = 6 + Math.random() * 12, d = 6 + Math.random() * 12;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), oMat);
    m.position.set((Math.random() - .5) * (SIZE - 24), 3.5, (Math.random() - .5) * (SIZE - 24));
    if (m.position.length() < 16) { i--; continue; }
    m.castShadow = m.receiveShadow = true; world.add(m); obs.push({ m, w, d });
  }
  for (const s of [-1, 1]) {
    for (const ax of ['x', 'z']) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ax === 'x' ? 2 : SIZE, 8, ax === 'x' ? SIZE : 2),
        new THREE.MeshStandardMaterial({ color: 0xff9a1f, emissive: 0xff9a1f, emissiveIntensity: .3 }));
      m.position.set(ax === 'x' ? s * SIZE / 2 : 0, 4, ax === 'z' ? s * SIZE / 2 : 0); world.add(m);
    }
  }

  const ps = new Map();
  function spawn(p) {
    const g = avatar(p.color, 'runner');
    const s = nameSprite(p.name, p.color); s.position.y = 2.4; g.add(s);
    g.position.set((Math.random() - .5) * 80, 0, (Math.random() - .5) * 80); world.add(g);
    if (!ids.includes(p.id)) ids.push(p.id);
    ps.set(p.id, { g, idx: ids.indexOf(p.id), color: p.color, sprint: 3, bombCd: 0, cells: 0 });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  function paint(wx, wz, radius, idx, color) {
    const cx = Math.round((wx / SIZE + .5) * GRID);
    const cz = Math.round((wz / SIZE + .5) * GRID);
    const r = Math.ceil(radius);
    g2.fillStyle = color;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (i * i + j * j > radius * radius) continue;
      const x = cx + i, z = cz + j;
      if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
      own[z * GRID + x] = idx;
      g2.fillRect(x * 8, z * 8, 8, 8);
    }
    tex.needsUpdate = true;
  }

  function blocked(x, z) {
    for (const o of obs) if (Math.abs(x - o.m.position.x) < o.w / 2 + 1.4 && Math.abs(z - o.m.position.z) < o.d / 2 + 1.4) return true;
    return Math.abs(x) > SIZE / 2 - 3 || Math.abs(z) > SIZE / 2 - 3;
  }

  let t = 0; const DUR = 90; let over = false;

  return {
    update(dt) {
      t += dt;
      if (t > DUR && !over) { over = true; ctx.finish(rank()); return; }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s) continue;
        const inp = p.input;
        const sprint = inp.btn.a && s.sprint > 0;
        if (sprint) s.sprint = Math.max(0, s.sprint - dt); else s.sprint = Math.min(3, s.sprint + dt * .35);
        const spd = sprint ? 34 : 21;
        const nx = s.g.position.x + inp.ax * spd * dt;
        const nz = s.g.position.z + inp.ay * spd * dt;
        if (!blocked(nx, s.g.position.z)) s.g.position.x = nx;
        if (!blocked(s.g.position.x, nz)) s.g.position.z = nz;
        if (inp.ax || inp.ay) s.g.rotation.y = Math.atan2(inp.ax, inp.ay);
        s.g.position.y = Math.abs(Math.sin(t * 9)) * (inp.ax || inp.ay ? .35 : 0);

        paint(s.g.position.x, s.g.position.z, sprint ? 2.6 : 2.1, s.idx, s.color);

        s.bombCd -= dt;
        if (inp.pressed.b && s.bombCd <= 0) {
          s.bombCd = 6;
          paint(s.g.position.x, s.g.position.z, 9, s.idx, s.color);
          net.send(p, { t: 'rumble', ms: 120 });
          ctx.toast(`💥 ${p.name} odpala bombę farby!`);
        }
        net.send(p, { t: 'hud', score: `${Math.round(s.cells / (GRID * GRID) * 100)}%`, time: Math.ceil(Math.max(0, DUR - t)), boost: s.sprint });
      }

      // recount every ~0.4 s
      if (Math.floor(t * 2.5) !== Math.floor((t - dt) * 2.5)) {
        const counts = new Array(ids.length).fill(0);
        for (let i = 0; i < own.length; i++) if (own[i] >= 0) counts[own[i]]++;
        for (const s of ps.values()) s.cells = counts[s.idx] || 0;
      }

      const a = t * .07;
      camera.position.set(Math.cos(a) * 42, 118, Math.sin(a) * 42);
      camera.lookAt(0, 0, 0);
      hud(`🎨 <b>${Math.ceil(Math.max(0, DUR - t))}s</b><br>` +
        rank().map((r, i) => `${i + 1}. <b style="color:${r.color}">${r.name}</b> — ${r.score}`).join('<br>'));
    },
    dispose() { scene.remove(world); tex.dispose(); },
  };

  function rank() {
    return [...ps.entries()].map(([id, s]) => ({
      name: net.players.get(id)?.name || '?', color: s.color,
      score: `${(s.cells / (GRID * GRID) * 100).toFixed(1)}%`, raw: s.cells,
    })).sort((a, b) => b.raw - a.raw);
  }
}
