import { THREE } from '../engine.js';
import { QUESTIONS } from './quizdata.js';

export const meta = {
  id: 'quiz',
  title: 'Quiz Party',
  tagline: 'Teleturniej wiedzy — 12 pytań, im szybciej tym więcej punktów',
  color: '#8ce05a',
  tag: 'PARTY',
  min: 1, max: 8,
  controls: { quiz: true },
};

export function start(ctx) {
  const { scene, camera, net, hud } = ctx;
  const world = new THREE.Group(); scene.add(world);
  scene.background = new THREE.Color(0x0a0705);

  // studio look: floating rings
  const rings = [];
  for (let i = 0; i < 14; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(20 + i * 4, .35, 8, 60),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff9a1f : 0xffd24a, transparent: true, opacity: .18 }));
    r.rotation.x = Math.PI / 2; r.position.y = -10 - i * 3; world.add(r); rings.push(r);
  }
  camera.position.set(0, 6, 46); camera.lookAt(0, 4, 0);

  const pool = [...QUESTIONS].sort(() => Math.random() - .5).slice(0, 12);
  const scores = new Map();
  const answered = new Map();
  let qi = -1, phase = 'intro', timer = 2.5, current = null;

  net.addEventListener('tap', e => {
    if (phase !== 'ask' || !e.detail.player) return;
    const id = e.detail.player.id;
    if (answered.has(id)) return;
    const k = 'abcd'.indexOf(e.detail.key);
    if (k < 0) return;
    answered.set(id, { k, t: timer });
    net.send(e.detail.player, { t: 'quizlock', pick: k });
  });

  function nextQ() {
    qi++;
    if (qi >= pool.length) { finish(); return; }
    current = pool[qi];
    answered.clear();
    phase = 'ask'; timer = 20;
    net.broadcast({ t: 'quiz', q: current.q, a: current.a, n: qi + 1, total: pool.length });
  }

  function reveal() {
    phase = 'reveal'; timer = 4.5;
    for (const p of net.list()) {
      const a = answered.get(p.id);
      const ok = a && a.k === current.c;
      const pts = ok ? 500 + Math.round(a.t / 20 * 500) : 0;
      scores.set(p.id, (scores.get(p.id) || 0) + pts);
      net.send(p, { t: 'quizres', ok: !!ok, pts, correct: current.a[current.c], score: scores.get(p.id) });
      if (ok) net.send(p, { t: 'rumble', ms: 80 });
    }
  }

  function finish() {
    phase = 'done';
    ctx.finish([...scores.entries()]
      .map(([id, s]) => ({ name: net.players.get(id)?.name || '?', color: net.players.get(id)?.color, score: `${s} pkt` }))
      .sort((a, b) => parseInt(b.score) - parseInt(a.score)));
  }

  const LET = ['A', 'B', 'C', 'D'];
  const COL = ['#e2490a', '#e59b06', '#3f9418', '#1279a0'];

  return {
    update(dt) {
      timer -= dt;
      rings.forEach((r, i) => { r.rotation.z += dt * (i % 2 ? .2 : -.2); r.position.y = -10 - i * 3 + Math.sin(performance.now() / 900 + i) * 1.6; });
      camera.position.x = Math.sin(performance.now() / 7000) * 6;
      camera.lookAt(0, 4, 0);

      if (phase === 'intro' && timer <= 0) nextQ();
      else if (phase === 'ask') {
        const all = net.list().length > 0 && answered.size >= net.list().length;
        if (timer <= 0 || all) reveal();
      } else if (phase === 'reveal' && timer <= 0) nextQ();

      let html = '';
      if (phase === 'intro') html = `<div style="font-size:30px;font-weight:900">🧠 Quiz Party</div><div style="color:#b3927a">Start za ${Math.ceil(Math.max(0,timer))}…</div>`;
      else if (current) {
        const bar = phase === 'ask'
          ? `<div style="height:8px;background:#2a1a0e;border-radius:99px;overflow:hidden;margin:8px 0 12px">
               <div style="height:100%;width:${Math.max(0, timer / 20 * 100)}%;background:linear-gradient(90deg,#ffd24a,#f2670a)"></div></div>`
          : '';
        html = `<div style="color:#b3927a;font-size:13px">Pytanie ${qi + 1}/${pool.length}${phase === 'ask' ? ` • ${Math.ceil(Math.max(0,timer))}s` : ''}</div>
          <div style="font-size:26px;font-weight:900;max-width:760px;line-height:1.3;margin:6px 0">${current.q}</div>${bar}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:760px">` +
          current.a.map((a, i) => {
            const hit = phase === 'reveal' && i === current.c;
            const bad = phase === 'reveal' && i !== current.c;
            return `<div style="padding:12px 16px;border-radius:14px;font-weight:800;
              background:${hit ? 'linear-gradient(180deg,#8ce05a,#3f9418)' : COL[i]};
              opacity:${bad ? .28 : 1};color:#150c04;box-shadow:0 4px 0 rgba(0,0,0,.45)">
              ${LET[i]}. ${a} ${hit ? '✅' : ''}</div>`;
          }).join('') + `</div>`;
        if (phase === 'ask') html += `<div style="margin-top:12px;color:#b3927a">Odpowiedziało: ${answered.size}/${net.list().length}</div>`;
        html += `<div style="margin-top:14px;font-size:15px;line-height:1.9">` +
          [...net.list()].map(p => ({ p, s: scores.get(p.id) || 0 })).sort((a, b) => b.s - a.s)
            .map((x, i) => `${i + 1}. <b style="color:${x.p.color}">${x.p.name}</b> — ${x.s} pkt`).join('<br>') + `</div>`;
      }
      hud(html);
    },
    dispose() { scene.remove(world); },
  };
}
