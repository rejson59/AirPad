import { THREE, gridHelper, nameSprite, clamp } from '../engine.js';

export const meta = {
  id: 'tron',
  title: 'Neon Trails',
  tagline: 'Świetlne motory 3D — nie wjedź w ścianę światła!',
  color: '#31d0ff',
  tag: 'RETRO',
  min: 2, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'TURBO', color: 'linear-gradient(180deg,#5ac8e0,#1279a0)' },
  ] },
};

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  const S = 80;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(S*2, S*2), new THREE.MeshStandardMaterial({ color: 0x060a18, roughness: 1 }));
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; world.add(floor);
  gridHelper(world, S*2, 40, 0x1b5f8a, 0x102b40);
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(i<2?S*2:1, 4, i<2?1:S*2), new THREE.MeshStandardMaterial({ color: 0x31d0ff, emissive: 0x31d0ff, emissiveIntensity: .5 }));
    w.position.set(i===2?-S:i===3?S:0, 2, i===0?-S:i===1?S:0); world.add(w);
  }

  const ps = new Map();
  function bike(color) {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .5, metalness: .5, roughness: .3 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 2.4), m); b.position.y = .7; b.castShadow = true; g.add(b);
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 8), m); n.rotation.x = Math.PI/2; n.position.set(0,.7,1.6); g.add(n);
    return g;
  }
  function spawn(p, i) {
    const g = bike(p.color);
    const s = nameSprite(p.name, p.color); s.position.y = 2.4; g.add(s);
    const a = (i / 8) * Math.PI * 2;
    g.position.set(Math.cos(a)*S*.6, 0, Math.sin(a)*S*.6);
    world.add(g);
    ps.set(p.id, { g, heading: Math.atan2(-Math.cos(a), -Math.sin(a)), alive: true, trail: [], wins: 0, boost: 2, mesh: null, color: p.color });
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail, ps.size));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); clearTrail(ps.get(id)); ps.delete(id); } });

  function clearTrail(s) { for (const t of s.trail) world.remove(t.m); s.trail = []; }

  let round = 1, msg = '', restart = 0;
  function reset() {
    let i = 0;
    for (const [, s] of ps) {
      const a = (i++ / Math.max(1, ps.size)) * Math.PI * 2;
      s.g.position.set(Math.cos(a)*S*.6, 0, Math.sin(a)*S*.6);
      s.heading = Math.atan2(-Math.cos(a), -Math.sin(a));
      s.alive = true; s.g.visible = true; s.boost = 2; clearTrail(s);
    }
  }

  const segGeo = new THREE.BoxGeometry(0.5, 2.2, 1);

  return {
    update(dt) {
      if (restart > 0) { restart -= dt; if (restart <= 0) { if (round > 5) { ctx.finish(rank()); return; } reset(); } }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s || !s.alive || restart > 0) continue;
        const inp = p.input;
        s.heading -= clamp(inp.ax, -1, 1) * 2.6 * dt;
        const turbo = inp.btn.a && s.boost > 0;
        if (turbo) s.boost = Math.max(0, s.boost - dt);
        const spd = turbo ? 46 : 28;
        const prev = s.g.position.clone();
        s.g.position.x += Math.sin(s.heading) * spd * dt;
        s.g.position.z += Math.cos(s.heading) * spd * dt;
        s.g.rotation.y = s.heading;

        const m = new THREE.Mesh(segGeo, new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: .8, transparent: true, opacity: .8 }));
        m.position.copy(prev).lerp(s.g.position, .5).setY(1.1);
        m.rotation.y = s.heading;
        m.scale.z = prev.distanceTo(s.g.position) + 0.6;
        world.add(m);
        s.trail.push({ m, pos: m.position.clone(), age: 0 });
        if (s.trail.length > 900) { world.remove(s.trail[0].m); s.trail.shift(); }

        if (Math.abs(s.g.position.x) > S - 1 || Math.abs(s.g.position.z) > S - 1) kill(p.id, 'ściana');
        else for (const [oid, o] of ps) {
          const skip = oid === p.id ? 14 : 0;
          for (let i = 0; i < o.trail.length - skip; i++) {
            if (o.trail[i].pos.distanceToSquared(s.g.position) < 1.4) { kill(p.id, oid === p.id ? 'własny ślad' : net.players.get(oid)?.name); break; }
          }
        }
        net.send(p, { t: 'hud', boost: s.boost, alive: s.alive });
      }

      const alive = [...ps.entries()].filter(([, s]) => s.alive);
      if (ps.size >= 2 && alive.length <= 1 && restart <= 0) {
        if (alive.length === 1) alive[0][1].wins++;
        msg = alive.length ? `🏆 ${net.players.get(alive[0][0])?.name} wygrywa rundę ${round}` : 'Remis!';
        round++; restart = 2.5;
      }

      const a = performance.now() / 15000;
      camera.position.set(Math.cos(a)*30, 120, Math.sin(a)*30 + 40);
      camera.lookAt(0, 0, 0);
      hud(`Runda ${Math.min(round,5)}/5 ${msg}<br>` + rank().map((r,i)=>`${i+1}. <b style="color:${r.color}">${r.name}</b> — ${r.score} 🏆`).join('<br>'));

      function kill(id, by) {
        const s = ps.get(id); if (!s || !s.alive) return;
        s.alive = false; s.g.visible = false;
        const p = net.players.get(id); if (p) net.send(p, { t: 'rumble', ms: 250 });
        ctx.toast(`💥 ${p?.name} — ${by}`);
      }
    },
    dispose() { scene.remove(world); },
  };

  function rank() {
    return [...ps.entries()].map(([id,s])=>({name:net.players.get(id)?.name||'?',color:net.players.get(id)?.color,score:s.wins})).sort((a,b)=>b.score-a.score);
  }
}
