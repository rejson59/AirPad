import { THREE, clamp, nameSprite } from '../engine.js';

export const meta = {
  id: 'space',
  title: 'Space Dogfight',
  tagline: 'Kosmiczne myśliwce — strzelaj, unikaj, przetrwaj',
  color: '#c084fc',
  min: 1, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'LASER', color: '#ff3b6b' },
    { id: 'b', label: 'BOOST', color: '#c084fc' },
  ] },
};

function ship(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, metalness: .6, roughness: .3, emissive: color, emissiveIntensity: .15 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 5), m);
  body.rotation.x = Math.PI / 2; g.add(body);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.9), m);
    w.position.set(s * 1.3, 0, -0.5); w.rotation.z = s * 0.2; g.add(w);
  }
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 10), new THREE.MeshBasicMaterial({ color: 0x66ffff }));
  e.position.z = -1.7; g.add(e); g.userData.flame = e;
  return g;
}

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x03040c); scene.fog = null;

  const sg = new THREE.BufferGeometry();
  const arr = new Float32Array(4000 * 3);
  for (let i = 0; i < 4000; i++) { arr[i*3]=(Math.random()-.5)*900; arr[i*3+1]=(Math.random()-.5)*500; arr[i*3+2]=(Math.random()-.5)*900; }
  sg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  world.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4 })));

  // asteroids
  const asts = [];
  const ageo = new THREE.IcosahedronGeometry(1, 0);
  const amat = new THREE.MeshStandardMaterial({ color: 0x8a7f74, flatShading: true, roughness: 1 });
  for (let i = 0; i < 40; i++) {
    const s = 3 + Math.random() * 9;
    const m = new THREE.Mesh(ageo, amat); m.scale.setScalar(s);
    m.position.set((Math.random()-.5)*300, (Math.random()-.5)*100, (Math.random()-.5)*300);
    world.add(m); asts.push({ m, r: s, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(0.4) });
  }
  const planet = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 32), new THREE.MeshStandardMaterial({ color: 0x5b3ea8, roughness: .9 }));
  planet.position.set(-140, -60, -160); world.add(planet);

  const LIM = 170;
  const ps = new Map(); const shots = [];
  function spawnP(p) {
    const g = ship(p.color);
    const s = nameSprite(p.name, p.color); s.position.y = 3; g.add(s);
    g.position.set((Math.random()-.5)*120, (Math.random()-.5)*40, (Math.random()-.5)*120);
    world.add(g);
    ps.set(p.id, { g, yaw: Math.random()*6.28, pitch: 0, spd: 30, cd: 0, hp: 100, kills: 0, boost: 3, dead: 0 });
  }
  net.list().forEach(spawnP);
  net.addEventListener('join', e => spawnP(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  const GOAL = 12; let over = false;
  const shotGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6);

  return {
    update(dt) {
      for (const a of asts) { a.m.rotation.x += a.spin.x*dt; a.m.rotation.y += a.spin.y*dt; }
      planet.rotation.y += dt * 0.03;

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s) continue;
        if (s.dead > 0) { s.dead -= dt; s.g.visible = false; if (s.dead <= 0) { s.g.visible = true; s.hp = 100; s.g.position.set((Math.random()-.5)*120,(Math.random()-.5)*40,(Math.random()-.5)*120); } continue; }
        const inp = p.input;
        s.yaw -= inp.ax * 1.5 * dt;
        s.pitch = clamp(s.pitch - inp.ay * 1.2 * dt, -1.1, 1.1);
        const boost = inp.btn.b && s.boost > 0;
        if (boost) s.boost = Math.max(0, s.boost - dt); else s.boost = Math.min(3, s.boost + dt*0.4);
        s.spd += ((boost ? 85 : 42) - s.spd) * dt * 1.6;
        const dir = new THREE.Vector3(Math.sin(s.yaw)*Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.yaw)*Math.cos(s.pitch));
        s.g.position.addScaledVector(dir, s.spd * dt);
        for (const ax of ['x','y','z']) {
          const l = ax === 'y' ? 70 : LIM;
          if (Math.abs(s.g.position[ax]) > l) s.g.position[ax] = -Math.sign(s.g.position[ax]) * l * 0.98;
        }
        s.g.lookAt(s.g.position.clone().add(dir));
        s.g.rotateZ(inp.ax * 0.5);
        s.g.userData.flame.scale.setScalar(boost ? 1.8 : 1);

        s.cd -= dt;
        if (inp.btn.a && s.cd <= 0) {
          s.cd = 0.16;
          const m = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({ color: p.color }));
          m.position.copy(s.g.position).addScaledVector(dir, 3);
          m.quaternion.copy(s.g.quaternion); m.rotateX(Math.PI/2);
          world.add(m); shots.push({ m, dir: dir.clone(), life: 2.2, owner: p.id });
        }
        // asteroid crash
        for (const a of asts) if (a.m.position.distanceTo(s.g.position) < a.r + 1.6) {
          s.hp -= 60 * dt * 6; net.send(p, { t: 'rumble', ms: 80 });
          s.g.position.addScaledVector(s.g.position.clone().sub(a.m.position).normalize(), 2);
          if (s.hp <= 0) { s.dead = 2; ctx.toast(`☄️ ${p.name} rozbił się`); }
        }
        net.send(p, { t: 'hud', hp: Math.max(0, Math.round(s.hp)), kills: s.kills, boost: s.boost, speed: Math.round(s.spd) });
      }

      for (let i = shots.length - 1; i >= 0; i--) {
        const b = shots[i];
        b.m.position.addScaledVector(b.dir, 190 * dt);
        b.life -= dt;
        let dead = b.life <= 0;
        if (!dead) for (const a of asts) if (a.m.position.distanceTo(b.m.position) < a.r) { dead = true; break; }
        if (!dead) for (const [id, s] of ps) {
          if (id === b.owner || s.dead > 0) continue;
          if (s.g.position.distanceTo(b.m.position) < 2.6) {
            s.hp -= 20; dead = true;
            const v = net.players.get(id); if (v) net.send(v, { t: 'rumble', ms: 90 });
            if (s.hp <= 0) {
              s.dead = 2;
              const k = ps.get(b.owner);
              if (k) { k.kills++; if (k.kills >= GOAL && !over) { over = true; ctx.finish(rank()); } }
              ctx.toast(`🔥 ${net.players.get(b.owner)?.name} zestrzelił ${v?.name}`);
            }
            break;
          }
        }
        if (dead) { world.remove(b.m); shots.splice(i, 1); }
      }

      const lead = [...ps.values()].sort((a,b)=>b.kills-a.kills)[0];
      if (lead) {
        const back = new THREE.Vector3(0, 6, -22).applyQuaternion(lead.g.quaternion);
        camera.position.lerp(lead.g.position.clone().add(back), 0.06);
        camera.lookAt(lead.g.position);
      } else { camera.position.set(0, 60, 160); camera.lookAt(0,0,0); }
      hud(rank().map((r,i)=>`${i+1}. <b style="color:${r.color}">${r.name}</b> — ${r.score} 🎯`).join('<br>'));
    },
    dispose() { scene.remove(world); scene.background = new THREE.Color(0x0b1020); },
  };

  function rank() {
    return [...ps.entries()].map(([id,s])=>({name:net.players.get(id)?.name||'?',color:net.players.get(id)?.color,score:s.kills})).sort((a,b)=>b.score-a.score);
  }
}
