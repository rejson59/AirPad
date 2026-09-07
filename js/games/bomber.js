import { THREE, nameSprite, avatar, clamp } from '../engine.js';

export const meta = {
  id: 'bomber',
  title: 'Bomb Blitz',
  tagline: 'Labirynt, bomby i skrzynki — ostatni ocalały bierze wszystko',
  color: '#ff4d3d',
  tag: 'KLASYK',
  min: 2, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'BOMBA', color: 'linear-gradient(180deg,#ff8a3d,#e2490a)' },
  ] },
};

const N = 15, CELL = 6;
const toW = (i) => (i - (N - 1) / 2) * CELL;
const toI = (x) => Math.round(x / CELL + (N - 1) / 2);

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x0a0705);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(N * CELL, N * CELL),
    new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if ((i + j) % 2) continue;
    const t = new THREE.Mesh(new THREE.PlaneGeometry(CELL, CELL),
      new THREE.MeshStandardMaterial({ color: 0x252017, roughness: .95 }));
    t.rotation.x = -Math.PI / 2; t.position.set(toW(i), .01, toW(j)); world.add(t);
  }

  // grid: 0 empty, 1 solid, 2 crate
  const grid = [];
  const meshes = {};
  const solidMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: .8, metalness: .3 });
  const crateMat = new THREE.MeshStandardMaterial({ color: 0xa8702a, roughness: .85 });
  for (let i = 0; i < N; i++) {
    grid[i] = [];
    for (let j = 0; j < N; j++) {
      let v = 0;
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) v = 1;
      else if (i % 2 === 0 && j % 2 === 0) v = 1;
      else if (Math.random() < .62) v = 2;
      grid[i][j] = v;
      if (v) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(CELL * .96, CELL * .9, CELL * .96), v === 1 ? solidMat : crateMat);
        m.position.set(toW(i), CELL * .45, toW(j)); m.castShadow = m.receiveShadow = true;
        world.add(m); meshes[`${i},${j}`] = m;
      }
    }
  }
  const corners = [[1,1],[N-2,N-2],[1,N-2],[N-2,1],[1,7],[N-2,7],[7,1],[7,N-2]];
  for (const [i, j] of corners) for (const [di, dj] of [[0,0],[1,0],[0,1],[-1,0],[0,-1]]) {
    const a = i + di, b = j + dj;
    if (grid[a] && grid[a][b] === 2) { world.remove(meshes[`${a},${b}`]); delete meshes[`${a},${b}`]; grid[a][b] = 0; }
  }

  // powerups
  const powers = []; // {i,j,type,mesh}
  const PW = { bomb: 0xffd24a, fire: 0xff4d3d, speed: 0x3aa0ff };
  function dropPower(i, j) {
    if (Math.random() > .38) return;
    const type = ['bomb', 'fire', 'speed'][Math.floor(Math.random() * 3)];
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.4),
      new THREE.MeshStandardMaterial({ color: PW[type], emissive: PW[type], emissiveIntensity: .7 }));
    m.position.set(toW(i), 1.8, toW(j)); world.add(m);
    powers.push({ i, j, type, m });
  }

  const ps = new Map();
  function spawn(p) {
    const g = avatar(p.color, 'runner');
    const s = nameSprite(p.name, p.color); s.position.y = 2.4; g.add(s);
    world.add(g);
    const idx = ps.size % corners.length;
    const [i, j] = corners[idx];
    g.position.set(toW(i), 0, toW(j));
    ps.set(p.id, { g, alive: true, maxBombs: 1, bombs: 0, fire: 2, speed: 14, wins: 0, cd: 0 });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  const bombs = [], flames = [];
  const bombGeo = new THREE.SphereGeometry(2, 16, 16);
  const bombMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: .3, metalness: .5 });
  let round = 1, msg = '', restart = 0;

  function explode(b) {
    const cells = [[b.i, b.j]];
    for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      for (let k = 1; k <= b.fire; k++) {
        const i = b.i + di * k, j = b.j + dj * k;
        if (!grid[i] || grid[i][j] === undefined || grid[i][j] === 1) break;
        cells.push([i, j]);
        if (grid[i][j] === 2) {
          grid[i][j] = 0; world.remove(meshes[`${i},${j}`]); delete meshes[`${i},${j}`];
          dropPower(i, j); break;
        }
      }
    }
    for (const [i, j] of cells) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(CELL * .9, CELL * 1.2, CELL * .9),
        new THREE.MeshBasicMaterial({ color: 0xffa02a, transparent: true, opacity: .85 }));
      m.position.set(toW(i), CELL * .5, toW(j)); world.add(m);
      flames.push({ m, i, j, life: .55 });
    }
    // chain
    for (const o of bombs) if (o !== b && !o.done && cells.some(([i, j]) => i === o.i && j === o.j)) o.fuse = Math.min(o.fuse, .05);
    b.done = true; world.remove(b.m);
    const owner = ps.get(b.owner); if (owner) owner.bombs--;
  }

  function reset() {
    for (const b of bombs) world.remove(b.m); bombs.length = 0;
    for (const f of flames) world.remove(f.m); flames.length = 0;
    for (const p of powers) world.remove(p.m); powers.length = 0;
    for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {
      if (i % 2 === 0 && j % 2 === 0) continue;
      if (grid[i][j] === 0 && Math.random() < .55) {
        grid[i][j] = 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(CELL*.96, CELL*.9, CELL*.96), crateMat);
        m.position.set(toW(i), CELL*.45, toW(j)); m.castShadow = true; world.add(m); meshes[`${i},${j}`] = m;
      }
    }
    let k = 0;
    for (const s of ps.values()) {
      const [i, j] = corners[k++ % corners.length];
      for (const [di, dj] of [[0,0],[1,0],[0,1],[-1,0],[0,-1]]) {
        const a = i+di, b2 = j+dj;
        if (grid[a] && grid[a][b2] === 2) { world.remove(meshes[`${a},${b2}`]); delete meshes[`${a},${b2}`]; grid[a][b2] = 0; }
      }
      s.g.position.set(toW(i), 0, toW(j));
      s.alive = true; s.g.visible = true; s.maxBombs = 1; s.bombs = 0; s.fire = 2; s.speed = 14;
    }
  }

  function blocked(x, z) {
    const i = toI(x), j = toI(z);
    return !grid[i] || grid[i][j] === undefined || grid[i][j] !== 0;
  }
  function tryMove(s, dx, dz, r = 1.9) {
    const p = s.g.position;
    if (dx) { const nx = p.x + dx; if (!blocked(nx + Math.sign(dx) * r, p.z + r * .8) && !blocked(nx + Math.sign(dx) * r, p.z - r * .8)) p.x = nx; }
    if (dz) { const nz = p.z + dz; if (!blocked(p.x + r * .8, nz + Math.sign(dz) * r) && !blocked(p.x - r * .8, nz + Math.sign(dz) * r)) p.z = nz; }
  }

  return {
    update(dt) {
      if (restart > 0) { restart -= dt; if (restart <= 0) { if (round > 5) { ctx.finish(rank()); return; } reset(); } }

      for (const p of powers) { p.m.rotation.y += dt * 2; p.m.position.y = 1.8 + Math.sin(performance.now() / 400) * .3; }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s || !s.alive || restart > 0) continue;
        const inp = p.input;
        tryMove(s, inp.ax * s.speed * dt, inp.ay * s.speed * dt);
        if (inp.ax || inp.ay) s.g.rotation.y = Math.atan2(inp.ax, inp.ay);
        const i = toI(s.g.position.x), j = toI(s.g.position.z);

        if (inp.pressed.a && s.bombs < s.maxBombs && !bombs.some(b => !b.done && b.i === i && b.j === j)) {
          const m = new THREE.Mesh(bombGeo, bombMat);
          m.position.set(toW(i), 2, toW(j)); m.castShadow = true; world.add(m);
          bombs.push({ m, i, j, fuse: 2.6, fire: s.fire, owner: p.id, done: false });
          s.bombs++; net.send(p, { t: 'rumble', ms: 30 });
        }
        for (let k = powers.length - 1; k >= 0; k--) {
          const pw = powers[k];
          if (pw.i === i && pw.j === j) {
            if (pw.type === 'bomb') s.maxBombs++;
            if (pw.type === 'fire') s.fire++;
            if (pw.type === 'speed') s.speed = Math.min(24, s.speed + 3);
            world.remove(pw.m); powers.splice(k, 1);
            net.send(p, { t: 'rumble', ms: 50 });
            ctx.toast(`⭐ ${p.name}: +${pw.type}`);
          }
        }
        net.send(p, { t: 'hud', bombs: `${s.maxBombs - s.bombs}/${s.maxBombs}`, fire: s.fire, alive: true });
      }

      for (const b of bombs) {
        if (b.done) continue;
        b.fuse -= dt;
        b.m.scale.setScalar(1 + Math.sin(b.fuse * 18) * .1);
        if (b.fuse <= 0) explode(b);
      }
      for (let k = flames.length - 1; k >= 0; k--) {
        const f = flames[k]; f.life -= dt;
        f.m.material.opacity = Math.max(0, f.life / .55) * .85;
        for (const [id, s] of ps) {
          if (!s.alive) continue;
          if (toI(s.g.position.x) === f.i && toI(s.g.position.z) === f.j) {
            s.alive = false; s.g.visible = false;
            const p = net.players.get(id);
            if (p) net.send(p, { t: 'rumble', ms: 250 });
            ctx.toast(`💀 ${p?.name} wyleciał w powietrze!`);
          }
        }
        if (f.life <= 0) { world.remove(f.m); flames.splice(k, 1); }
      }

      const alive = [...ps.entries()].filter(([, s]) => s.alive);
      if (ps.size >= 2 && alive.length <= 1 && restart <= 0) {
        if (alive.length === 1) alive[0][1].wins++;
        msg = alive.length ? `🏆 ${net.players.get(alive[0][0])?.name} wygrywa rundę ${round}` : 'Remis!';
        round++; restart = 3;
      }

      camera.position.set(0, N * CELL * .82, N * CELL * .62);
      camera.lookAt(0, 0, 0);
      hud(`Runda ${Math.min(round,5)}/5 ${msg}<br>` + rank().map((r,i)=>`${i+1}. <b style="color:${r.color}">${r.name}</b> — ${r.score} 🏆`).join('<br>'));
    },
    dispose() { scene.remove(world); },
  };

  function rank() {
    return [...ps.entries()].map(([id,s])=>({name:net.players.get(id)?.name||'?',color:net.players.get(id)?.color,score:s.wins})).sort((a,b)=>b.score-a.score);
  }
}
