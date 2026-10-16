// Animated stage layers: sky > drifting clouds > twinkling stars > foreground > water/brazier fx.
// All coordinates in stage_fx_data.js are "grid" cells (500x200); 1 cell = 2 logical px (bg is 4x = 2000x800).
(function () {
  const D = window.STAGE_FX_DATA;
  if (!D) return;
  const C = D.cell;                       // 2 logical px per cell
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // ---- clouds: per-cloud speed (5..15 px/s), higher clouds slower (parallax)
  const clouds = D.clouds.map((c) => ({ ...c, v: 5 + 10 * Math.min(1, c.y / 60) + rnd() * 2 }));

  // ---- stars: procedural, top sky band, avoiding the moon
  const stars = [];
  const [mx, my] = D.moonPos;
  while (stars.length < 70) {
    const x = Math.floor(rnd() * 500), y = Math.floor(rnd() * 42);
    if (Math.hypot(x - mx, y - my) < 20) continue;
    stars.push({ x, y, w: 0.6 + rnd() * 2.2, p: rnd() * 6.28, big: rnd() < 0.12, warm: rnd() < 0.3 });
  }

  // ---- river sparkles (bright river cells) + moon-reflection cells
  const M = D.moon;
  const sparks = D.riverBright.map(([x, y]) => {
    const inMoon = x >= M.x0 && x <= M.x1 && y >= M.y0 && y <= M.y1;
    return { x, y, s: 0.5 + rnd() * 1.5, p: rnd() * 6.28, moon: inMoon };
  }).filter((s) => s.moon || rnd() < 0.45);
  const rows = Object.entries(D.riverRows).map(([y, [a, b]]) => ({ y: +y, a, b }))
    .filter((r) => r.y % 3 === 0 && r.b - r.a > 10);
  const streaks = [];
  rows.forEach((r) => { const n = 1 + Math.floor((r.b - r.a) / 45); for (let i = 0; i < n; i++)
    streaks.push({ r, off: rnd() * (r.b - r.a), len: 3 + Math.floor(rnd() * 6), v: 1 + rnd() * 2, p: rnd() * 6.28 }); });

  // ---- trickles + drain particles
  const trick = D.trickles.map((t) => Array.from({ length: 7 }, () => ({ x: t.x0 + Math.floor(rnd() * (t.x1 - t.x0 + 1)), o: rnd(), v: 0.6 + rnd() * 0.5 })));
  const drops = []; let lastT = 0, spawnAcc = 0;
  const mist = Array.from({ length: 5 }, () => ({ o: rnd(), x: rnd() }));

  function draw(ctx, t, sky, fg, cloudImg, LW, LH) {
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sky, 0, 0, LW, LH / 2);
    // clouds (atlas is 4x the grid)
    if (cloudImg) {
      const k = cloudImg.naturalWidth / D.clouds.reduce((m, c) => Math.max(m, c.sx + c.w), 0);
      for (const c of clouds) {
        const w = c.w * C, span = LW + w + 40;
        let x = ((c.x * C + c.v * t) % span + span) % span - w - 20;
        ctx.drawImage(cloudImg, c.sx * k, c.sy * k, c.w * k, c.h * k, Math.round(x), c.y * C, w, c.h * C);
      }
    }
    // stars
    for (const s of stars) {
      const a = 0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin(t * s.w + s.p), 3);
      ctx.globalAlpha = a;
      ctx.fillStyle = s.warm ? '#fff3c8' : '#e8f4ff';
      ctx.fillRect(s.x * C, s.y * C, C, C);
      if (s.big && a > 0.6) { ctx.globalAlpha = a * 0.5; ctx.fillRect(s.x * C - C, s.y * C, C * 3, C); ctx.fillRect(s.x * C, s.y * C - C, C, C * 3); }
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(fg, 0, 0, LW, LH);

    // ---- calm river: slow horizontal ripples + twinkling sparkles
    for (const st of streaks) {
      const r = st.r, span = r.b - r.a;
      const x = r.a + (((st.off + st.v * t) % span) + span) % span;
      const len = Math.min(st.len, r.b - x);
      if (len < 1) continue;
      ctx.globalAlpha = 0.10 + 0.10 * Math.sin(t * 0.7 + st.p);
      ctx.fillStyle = '#bcd8ff';
      ctx.fillRect(Math.round(x) * C, r.y * C, len * C, C / 2);
    }
    for (const s of sparks) {
      const a = Math.pow(Math.max(0, Math.sin(t * s.s + s.p)), s.moon ? 4 : 10);
      if (a < 0.05) continue;
      ctx.globalAlpha = a * (s.moon ? 0.9 : 0.6);
      ctx.fillStyle = s.moon ? '#fff6dc' : '#d6e8ff';
      const wob = s.moon ? Math.round(Math.sin(t * 0.8 + s.y * 0.6) * 1) : 0;   // slow sideways ripple in the reflection
      ctx.fillRect((s.x + wob) * C, s.y * C, C, C);
    }
    // ---- side trickles: light pixels sliding down
    D.trickles.forEach((tr, i) => {
      const h = tr.y1 - tr.y0;
      for (const p of trick[i]) {
        const y = tr.y0 + ((p.o + t * p.v * 0.5) % 1) * h;
        ctx.globalAlpha = 0.45; ctx.fillStyle = '#e4f0ff';
        ctx.fillRect(p.x * C, Math.round(y) * C, C, C * 2);
      }
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 5 + i);     // tiny splash at the foot
      ctx.fillRect((tr.x0 - 1) * C, tr.y1 * C, (tr.x1 - tr.x0 + 3) * C, C);
    });
    // ---- drain outflow: scrolling light rows + droplets + mist
    const dr = D.drain, dh = dr.y1 - dr.y0;
    ctx.fillStyle = '#dbeaff';
    for (let i = 0; i < 6; i++) {
      const y = dr.y0 + ((i / 6 + t * 0.45) % 1) * dh;
      const x = dr.x0 + 3 + ((i * 7 + Math.floor(t * 3)) % (dr.x1 - dr.x0 - 6));
      ctx.globalAlpha = 0.35; ctx.fillRect(x * C, Math.round(y) * C, C * 3, C);
    }
    spawnAcc += dt * 9;
    while (spawnAcc > 1 && drops.length < 24) { spawnAcc -= 1;
      drops.push({ x: (dr.x0 + 2 + rnd() * (dr.x1 - dr.x0 - 4)) * C, y: dr.lip * C, vx: (rnd() - 0.5) * 8, vy: 5 + rnd() * 10, life: 0.9 + rnd() * 0.6 }); }
    if (spawnAcc > 1) spawnAcc = 1;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.life -= dt; d.vy += 90 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.life <= 0 || d.y > LH) { drops.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, d.life) * 0.8; ctx.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
    }
    for (const m of mist) {
      const ph = (m.o + t * 0.12) % 1;
      ctx.globalAlpha = 0.10 * Math.sin(ph * Math.PI);
      ctx.fillStyle = '#c8d8f0';
      const w = (10 + ph * 10) * C;
      ctx.fillRect(Math.round((dr.x0 + m.x * (dr.x1 - dr.x0)) * C - w / 2), Math.round((dr.y1 - ph * 10) * C), w, C * 2);
    }
    // ---- brazier glow flicker
    ctx.globalCompositeOperation = 'lighter';
    D.braziers.forEach(([bx, by], i) => {
      const f = 0.75 + 0.15 * Math.sin(t * 9.1 + i) + 0.1 * Math.sin(t * 23.7 + i * 2);
      const r = 46 * f, x = bx * C, y = by * C;
      const gr = ctx.createRadialGradient(x, y, 2, x, y, r);
      gr.addColorStop(0, 'rgba(255,170,70,' + (0.28 * f).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  window.StageFX = { draw };
})();
