/* Ролик 3: «Просто кадры» — кинетическая типографика, 120 BPM, смены на каждом такте (2 с) */
const BEAT3 = 0.5;
function fitText(s, cy, maxSize, font, col, weight, alpha, maxW = 860, cx = W / 2) {
  x.font = `${weight} ${maxSize}px ${font}`; const fs = Math.min(maxSize, Math.floor(maxSize * maxW / x.measureText(s).width));
  text(s, cx, cy, fs, font, col, 'center', weight, alpha); return fs;
}
function pop(t, a) { return eb(pr(t, a, a + .28)); }
function hearts(t, t0, n, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const st = t0 + r() * 1.2, k = pr(t, st, st + 1.4); const bx = W * (.15 + r() * .7), sz = 40 + r() * 70, sway = (r() - .5) * 160;
    if (k <= 0 || k >= 1) { r(); continue; }
    x.save(); x.globalAlpha = Math.sin(k * Math.PI) * .9; x.fillStyle = r() > .3 ? HEART : '#FF7AA2';
    heartPath(bx + Math.sin(k * 6) * sway * .3, H * .95 - k * H * .8, sz); x.fill(); x.restore();
  }
}
const GRID = [];
function prep3() {
  PAL.dune = PAL.dune || ['#FDE6C4', '#F2A65A', '#C0603A', '#5A2A27'];
  PAL.mint = PAL.mint || ['#E6FFF6', '#5ED6B4', '#2462A8', '#FFD166'];
  const kinds = [['sea', 'dusk', 11], ['city', 'night', 22], ['taiga', 'taiga', 33], ['bloom', 'bloom', 44], ['mountains', 'dune', 55], ['sea', 'sea', 66], ['mountains', 'frost', 77], ['bloom', 'mint', 99], ['mountains', 'mint', 110]];
  for (const [k, p, s] of kinds) GRID.push(scene(s, k, p, 360, 360));
}

function draw(t) {
  if (!GRID.length) prep3();
  bg(t);
  const shake = (a) => { const k = pr(t, a, a + .15); return k > 0 && k < 1 ? Math.sin(k * 40) * 12 * (1 - k) : 0; };

  /* S1 0–2: «Устал от бесконечной рекламы?» — слова по долям */
  if (t < 2.05) {
    const o = eio(pr(t, 1.8, 2.0));
    x.save(); x.globalAlpha = 1 - o; x.translate(shake(1.0), 0);
    const w1 = pop(t, 0.0), w2 = pop(t, 0.5), w3 = pop(t, 1.0);
    if (w1 > 0) { x.save(); x.translate(W / 2, 760); x.scale(w1, w1); fitText('Устал от', 0, 120, D, FG, 800, 1, 860, 0); x.restore(); }
    if (w2 > 0) { x.save(); x.translate(W / 2, 920); x.scale(w2, w2); fitText('бесконечной', 0, 120, D, FG, 800, 1, 860, 0); x.restore(); }
    if (w3 > 0) { x.save(); x.translate(W / 2, 1100); x.scale(w3, w3); fitText('рекламы?', 0, 150, D, HEART, 800, 1, 860, 0); x.restore();
      // «рекламные» плашки, которые зачёркиваются
      const ads = ['РЕКЛАМА', 'СКИДКА 90%', 'ПОДПИШИСЬ', 'КУПИ СЕЙЧАС'];
      ads.forEach((a, i) => { const k = pop(t, 1.05 + i * .12); if (k <= 0) return; const ax = W * (.22 + (i % 2) * .56), ay = 420 + Math.floor(i / 2) * 1000;
        x.save(); x.translate(ax, ay); x.rotate((i % 2 ? 1 : -1) * .12); x.scale(k, k); x.fillStyle = 'rgba(229,51,75,.18)'; rr(-180, -46, 360, 92, 18); x.fill();
        text(a, 0, 14, 36, B, '#FF8FA0', 'center', 800); x.strokeStyle = HEART; x.lineWidth = 8; x.beginPath(); x.moveTo(-170, 0); x.lineTo(-170 + 340 * pr(t, 1.45, 1.7), 0); x.stroke(); x.restore(); });
    }
    x.restore();
  }

  /* S2 2–4: сетка фото + «А тут её нет.» */
  if (t >= 1.95 && t < 4.05) {
    const o = eio(pr(t, 3.8, 4.0));
    x.save(); x.globalAlpha = 1 - o;
    const z = 1 + .08 * pr(t, 2, 4);
    x.save(); x.translate(W / 2, H / 2); x.scale(z, z); x.translate(-W / 2, -H / 2);
    const cell = 340, gap = 14, gx = (W - cell * 3 - gap * 2) / 2, gy = (H - cell * 5 - gap * 4) / 2;
    for (let i = 0; i < 15; i++) {
      const k = eo(pr(t, 2 + (i % 9) * .045 + Math.floor(i / 9) * .1, 2.35 + (i % 9) * .045 + Math.floor(i / 9) * .1)); if (k <= 0) continue;
      const cx = gx + (i % 3) * (cell + gap), cy = gy + Math.floor(i / 3) * (cell + gap);
      x.save(); x.globalAlpha *= k; x.translate(cx + cell / 2, cy + cell / 2); x.scale(.8 + .2 * k, .8 + .2 * k);
      rr(-cell / 2, -cell / 2, cell, cell, 26); x.save(); x.clip(); x.drawImage(GRID[i % 9], -cell / 2, -cell / 2, cell, cell); x.restore(); x.restore();
    }
    x.restore();
    const k = pop(t, 2.5); if (k > 0) { x.fillStyle = `rgba(11,13,20,${.55 * Math.min(1, k)})`; x.fillRect(0, 0, W, H);
      x.save(); x.translate(W / 2, 900); x.scale(k, k); fitText('А тут её нет.', 0, 130, D, FG, 800, 1, 860, 0); x.restore();
      text('Ни одного рекламного поста', W / 2, 1040, 46, B, MUT, 'center', 700, eo(pr(t, 2.9, 3.2))); }
    x.restore();
  }

  /* S3 4–6: лента по времени */
  if (t >= 3.95 && t < 6.05) {
    const o = eio(pr(t, 5.8, 6.0)), inK = eo(pr(t, 4.0, 4.4));
    x.save(); x.globalAlpha = 1 - o;
    fitText('Лента по порядку', 300, 96, D, FG, 800, eo(pr(t, 4.0, 4.3)));
    text('новое — сверху. Без алгоритмов', W / 2, 390, 44, B, MUT, 'center', 700, eo(pr(t, 4.2, 4.5)));
    phone(W / 2, lerp(H, 520, inK), 1, 1, () => {
      x.fillStyle = '#131623'; x.fillRect(0, 0, PW, PH);
      const scroll = eio(pr(t, 4.5, 5.7)) * 900;
      x.save(); x.translate(0, -scroll);
      const times = ['только что', '5 мин', '1 ч', '3 ч'];
      [GRID[0], GRID[6], GRID[3], GRID[1]].forEach((img, i) => { const y = 130 + i * 470;
        x.fillStyle = ['#C2477A', '#3C8DB5', '#2E5246', '#6A5BFF'][i]; x.beginPath(); x.arc(54, y + 30, 24, 0, 7); x.fill();
        text(['alisa', 'tim', 'vera', 'sasha'][i], 92, y + 40, 26, B, FG, 'left', 800); text(times[i], PW - 30, y + 40, 24, B, MUT, 'right', 600);
        x.save(); rr(24, y + 70, PW - 48, 380, 24); x.clip(); x.drawImage(img, 24, y + 70, PW - 48, (PW - 48)); x.restore(); });
      x.restore();
      appTop(0, 'logo'); tabbar();
    });
    x.restore();
  }

  /* S4 6–8: «Твои кадры увидят» + лайки летят */
  if (t >= 5.95 && t < 8.05) {
    const o = eio(pr(t, 7.8, 8.0));
    x.save(); x.globalAlpha = 1 - o; x.translate(shake(6.0), 0);
    const k = pop(t, 6.0);
    x.save(); x.translate(W / 2, 640); x.scale(k, k); x.save(); rr(-300, -300, 600, 600, 48); x.clip(); x.drawImage(GRID[4], -300, -300, 600, 600); x.restore(); x.restore();
    const n = Math.floor(lerp(0, 1284, eo(pr(t, 6.2, 7.6))));
    const hk = pop(t, 6.2); if (hk > 0) { x.save(); x.translate(W / 2 - 270, 1085); x.scale(hk, hk); x.fillStyle = HEART; heartPath(0, 0, 90); x.fill(); x.restore();
      text(n.toLocaleString('ru-RU'), W / 2 + 70, 1120, 110, D, FG, 'center', 800, hk); }
    fitText('Твои кадры заметят', 1300, 84, D, FG, 800, eo(pr(t, 6.5, 6.8)));
    text('лайки, комментарии, подписчики', W / 2, 1390, 44, B, MUT, 'center', 700, eo(pr(t, 6.7, 7.0)));
    hearts(t, 6.2, 16, 9);
    x.restore();
  }

  /* S5 8–10: «Истории. Рилсы. Друзья.» — строки с плашками */
  if (t >= 7.95 && t < 10.05) {
    const o = eio(pr(t, 9.8, 10.0));
    x.save(); x.globalAlpha = 1 - o;
    const rows = [['Истории', 'на 24 часа', ACC], ['Рилсы', 'вертикальные видео', HEART], ['Друзья', 'отправь в два касания', GOLD], ['Галочка', 'для настоящих авторов', ACC2]];
    rows.forEach(([a, b, c], i) => { const k = pop(t, 8.0 + i * BEAT3 * .9); if (k <= 0) return; const y = 560 + i * 250;
      x.save(); x.translate(W / 2 + (1 - Math.min(1, k)) * 300 * (i % 2 ? 1 : -1), y); x.globalAlpha *= Math.min(1, k);
      x.fillStyle = c + '33'; rr(-430, -95, 860, 190, 40); x.fill(); x.fillStyle = c; rr(-430, -95, 18, 190, 9); x.fill();
      text(a, -380, 10, 72, D, FG, 'left', 800); text(b, -380, 62, 34, B, MUT, 'left', 700);
      if (a === 'Галочка') vbadge(330, -10, 50, ACC2, '#fff');
      else if (a === 'Истории') { const g = x.createConicGradient(0, 330, -10); g.addColorStop(0, ACC); g.addColorStop(.33, HEART); g.addColorStop(.66, GOLD); g.addColorStop(1, ACC); x.strokeStyle = g; x.lineWidth = 10; x.beginPath(); x.arc(330, -10, 50, 0, 7); x.stroke(); }
      else if (a === 'Рилсы') { x.fillStyle = FG; x.beginPath(); x.moveTo(312, -40); x.lineTo(312, 20); x.lineTo(362, -10); x.closePath(); x.fill(); }
      else { x.strokeStyle = FG; x.lineWidth = 7; x.lineJoin = 'round'; x.beginPath(); x.moveTo(290, -10); x.lineTo(370, -45); x.lineTo(340, 30); x.closePath(); x.stroke(); }
      x.restore(); });
    x.restore();
  }

  /* S6 10–13: призыв */
  if (t >= 9.95) {
    const k = eb(pr(t, 10.0, 10.5)); logoMark(W / 2, 600, 210 * k, 0);
    fitText('Просто кадры.', 900, 120, D, FG, 800, eo(pr(t, 10.2, 10.6)));
    const pk = eo(pr(t, 10.6, 11.0)); x.save(); x.globalAlpha = pk; x.translate(0, 30 * (1 - pk));
    x.font = `800 64px ${B}`; const uw = x.measureText('getkadr.space').width + 110;
    const pulse = 1 + .035 * Math.sin(t * Math.PI * 4) * pr(t, 11.2, 11.6); x.save(); x.translate(W / 2, 1090); x.scale(pulse, pulse);
    const g = x.createLinearGradient(-uw / 2, 0, uw / 2, 0); g.addColorStop(0, ACC); g.addColorStop(1, '#7B4BE0'); x.fillStyle = g; rr(-uw / 2, -66, uw, 132, 66); x.fill();
    text('getkadr.space', 0, 22, 64, B, '#fff', 'center', 800); x.restore(); x.restore();
    text('Бесплатно · Android и iPhone', W / 2, 1270, 46, B, FG, 'center', 800, eo(pr(t, 11.0, 11.4)));
    text('без рекламы', W / 2, 1350, 40, B, MUT, 'center', 700, eo(pr(t, 11.2, 11.6)));
  }

  // вспышки на сменах (каждый такт)
  for (const tt of [2, 4, 6, 8, 10]) { const k = pr(t, tt - .06, tt + .18); if (k > 0 && k < 1) { x.fillStyle = `rgba(255,255,255,${.16 * Math.sin(k * Math.PI)})`; x.fillRect(0, 0, W, H); } }
}
