import { THREE, avatar, nameSprite, clamp } from '../engine.js';
import { makeSparks, shake } from '../fx.js';
import * as SFX from '../audio.js';

export const meta = {
  id: 'soccer',
  title: 'Rocket Soccer',
  tagline: 'Stadion 3D — auta, boost, strzał i 5 goli do zwycięstwa',
  color: '#ff9a1f',
  tag: 'DRUŻYNY',
  min: 2, max: 8,
  controls: { stick: true, buttons: [
    { id: 'a', label: 'STRZAŁ', color: 'linear-gradient(180deg,#ff8a3d,#e2490a)' },
    { id: 'b', label: 'BOOST', color: 'linear-gradient(180deg,#ffd24a,#e59b06)' },
    { id: 'x', label: 'SKOK', color: 'linear-gradient(180deg,#8ce05a,#3f9418)' },
  ] },
};

const W = 46, L = 72, GOAL_W = 16;

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x06120a);
  scene.fog = new THREE.Fog(0x06120a, 90, 260);
  const sparks = makeSparks(world, 160);
  // floodlights
  for (const [x, z] of [[-W, -L], [W, -L], [-W, L], [W, L]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 22, 6), new THREE.MeshStandardMaterial({ color: 0x222 }));
    pole.position.set(x * 1.08, 11, z * 1.08); world.add(pole);
    const pl = new THREE.PointLight(0xfff0d0, 1.2, 90); pl.position.set(x, 20, z); world.add(pl);
  }

  // pitch
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L * 2),
    new THREE.MeshStandardMaterial({ color: 0x1c6b32, roughness: .95 }));
  pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; world.add(pitch);
  for (let i = -8; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L * 2 / 16),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x1f7838 : 0x1a5f2c, roughness: .95 }));
    s.rotation.x = -Math.PI / 2; s.position.set(0, .01, i * (L * 2 / 16) + L / 16); world.add(s);
  }
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55 });
  const line = (w, h, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lineMat); m.rotation.x = -Math.PI/2; m.position.set(x, .03, z); world.add(m); };
  line(W*2, .5, 0, 0); line(.5, L*2, -W, 0); line(.5, L*2, W, 0); line(W*2, .5, 0, -L); line(W*2, .5, 0, L);
  const circle = new THREE.Mesh(new THREE.RingGeometry(11.4, 12, 48), lineMat);
  circle.rotation.x = -Math.PI/2; circle.position.y = .03; world.add(circle);

  // walls + goals
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: .6, transparent: true, opacity: .55 });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1, 9, L * 2), wallMat);
    w.position.set(s * W, 4.5, 0); world.add(w);
  }
  const goals = [];
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const col = i === 0 ? 0x3aa0ff : 0xff6a2a;
    const net3 = new THREE.Mesh(new THREE.BoxGeometry(GOAL_W, 9, 2),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: .5, transparent: true, opacity: .45 }));
    net3.position.set(0, 4.5, s * L); world.add(net3);
    // side walls next to goal
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(W - GOAL_W / 2, 9, 1), wallMat);
      w.position.set(sx * (GOAL_W / 2 + (W - GOAL_W / 2) / 2), 4.5, s * L); world.add(w);
    }
    goals.push({ z: s * L, team: i, mesh: net3 });
  }

  // ball
  const ball = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .35, metalness: .1 }));
  ball.castShadow = true; world.add(ball);
  const bv = new THREE.Vector3();
  let by = 2.2, bvy = 0;
  function resetBall() { ball.position.set(0, 2.2, 0); by = 2.2; bvy = 0; bv.set(0, 0, 0); }
  resetBall();

  const TEAM_COL = ['#3aa0ff', '#ff6a2a'];
  const ps = new Map();
  function spawn(p) {
    const team = [...ps.values()].filter(x => x.team === 0).length <= [...ps.values()].filter(x => x.team === 1).length ? 0 : 1;
    const g = avatar(new THREE.Color(TEAM_COL[team]).getHex(), 'kart');
    const s = nameSprite(p.name, TEAM_COL[team]); s.position.y = 2.4; g.add(s);
    world.add(g);
    const st = { g, team, heading: 0, vel: 0, y: 0, vy: 0, boost: 3, goals: 0 };
    ps.set(p.id, st);
    place(st, ps.size);
  }
  function place(st, i) {
    const side = st.team === 0 ? -1 : 1;
    st.g.position.set(((i % 4) - 1.5) * 12, 0, side * (L * .55));
    st.heading = st.team === 0 ? 0 : Math.PI;
    st.vel = 0; st.y = 0; st.vy = 0;
  }
  net.list().forEach(spawn);
  net.addEventListener('join', e => spawn(e.detail));
  net.addEventListener('players', () => { for (const id of ps.keys()) if (!net.players.has(id)) { world.remove(ps.get(id).g); ps.delete(id); } });

  let score = [0, 0], celebrate = 0, msg = '', over = false;
  const GOALS_TO_WIN = 5;

  function kickoff() {
    resetBall();
    let i = 0; for (const st of ps.values()) place(st, i++);
  }

  return {
    update(dt) {
      if (celebrate > 0) { celebrate -= dt; if (celebrate <= 0) { msg = ''; kickoff(); } }

      for (const p of net.list()) {
        const s = ps.get(p.id); if (!s) continue;
        const inp = p.input;
        if (celebrate <= 0) {
          const boost = inp.btn.b && s.boost > 0;
          if (boost) s.boost = Math.max(0, s.boost - dt); else s.boost = Math.min(3, s.boost + dt * .5);
          const thr = clamp(-inp.ay, -1, 1);
          s.vel += thr * (boost ? 95 : 60) * dt;
          s.vel *= 1 - 1.5 * dt;
          s.vel = clamp(s.vel, -22, boost ? 58 : 40);
          s.heading -= clamp(inp.ax, -1, 1) * dt * 2.4 * clamp(Math.abs(s.vel) / 14, 0, 1) * Math.sign(s.vel || 1);
          s.g.position.x = clamp(s.g.position.x + Math.sin(s.heading) * s.vel * dt, -W + 2, W - 2);
          s.g.position.z = clamp(s.g.position.z + Math.cos(s.heading) * s.vel * dt, -L + 1, L - 1);
          if (inp.pressed.x && s.y <= .01) s.vy = 13;
        }
        s.vy -= 30 * dt; s.y = Math.max(0, s.y + s.vy * dt); if (s.y === 0) s.vy = 0;
        s.g.position.y = s.y;
        s.g.rotation.y = s.heading;
        s.g.rotation.x = -s.vy * .02;

        // ball collision
        const d = ball.position.clone().sub(s.g.position);
        const flat = new THREE.Vector3(d.x, 0, d.z);
        if (flat.length() < 3.6 && Math.abs((by) - (s.y + 1)) < 3.4) {
          const n = flat.normalize();
          const power = 14 + Math.abs(s.vel) * .9 + (inp.btn.a ? 26 : 0);
          bv.addScaledVector(n, power * dt * 22);
          if (inp.btn.a) { bvy += 9; net.send(p, { t: 'rumble', ms: 45 }); sparks.burst(ball.position.x, by, ball.position.z, 0xffffff, 10, 10); SFX.hit(); }
          ball.position.copy(s.g.position).addScaledVector(n, 3.7).setY(by);
        }
        net.send(p, { t: 'hud', boost: s.boost, score: `${score[0]}:${score[1]}`, team: s.team === 0 ? '🔵' : '🟠', speed: Math.round(Math.abs(s.vel) * 3.6) });
      }

      // ball physics
      ball.position.addScaledVector(bv, dt);
      bvy -= 26 * dt; by = Math.max(2.2, by + bvy * dt);
      if (by <= 2.2) { by = 2.2; bvy = Math.abs(bvy) > 2 ? -bvy * .55 : 0; }
      ball.position.y = by;
      bv.multiplyScalar(1 - .55 * dt);
      ball.rotation.x -= bv.z * dt * .5; ball.rotation.z += bv.x * dt * .5;
      if (Math.abs(ball.position.x) > W - 2.2) { ball.position.x = Math.sign(ball.position.x) * (W - 2.2); bv.x *= -.7; }
      if (Math.abs(ball.position.z) > L - 2.2) {
        if (Math.abs(ball.position.x) < GOAL_W / 2 && by < 9 && celebrate <= 0) {
          const scorer = ball.position.z > 0 ? 0 : 1;
          score[scorer]++;
          msg = `⚽ GOOOL dla ${scorer === 0 ? '🔵 Niebieskich' : '🟠 Pomarańczowych'}!`;
          ctx.toast(msg);
          net.broadcast({ t: 'rumble', ms: 200 });
          sparks.burst(ball.position.x, 4, ball.position.z, scorer === 0 ? 0x3aa0ff : 0xff6a2a, 40, 22);
          SFX.goal(); shake(camera, 1.2);
          celebrate = 3;
          if (score[scorer] >= GOALS_TO_WIN && !over) {
            over = true;
            ctx.finish([
              { name: scorer === 0 ? '🔵 Niebiescy' : '🟠 Pomarańczowi', color: TEAM_COL[scorer], score: `${score[scorer]} goli — ZWYCIĘSTWO` },
              { name: scorer === 0 ? '🟠 Pomarańczowi' : '🔵 Niebiescy', color: TEAM_COL[1 - scorer], score: `${score[1 - scorer]} goli` },
            ]);
            return;
          }
        } else { ball.position.z = Math.sign(ball.position.z) * (L - 2.2); bv.z *= -.7; }
      }

      sparks.update(dt);
      const camZ = clamp(ball.position.z * .55, -L * .5, L * .5);
      camera.position.lerp(new THREE.Vector3(ball.position.x * .22, 42, camZ - 58), .07);
      camera.lookAt(ball.position.x * .35, 2, ball.position.z * .45);

      hud(`<div style="font-size:26px;font-weight:900;letter-spacing:1px">
            <span style="color:${TEAM_COL[0]}">${score[0]}</span> : <span style="color:${TEAM_COL[1]}">${score[1]}</span></div>
           <div style="color:#b3927a;font-size:13px">do ${GOALS_TO_WIN} goli</div>${msg ? `<div style="margin-top:6px">${msg}</div>` : ''}`);
    },
    dispose() {
      scene.remove(world);
      scene.background = new THREE.Color(0x0a0705);
      scene.fog = new THREE.Fog(0x0a0705, 60, 260);
    },
  };
}
