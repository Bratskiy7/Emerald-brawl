/* «Что нового в Кадре» — второй ролик. Подключается вместо функции draw() из promo.html */
const T2 = 16.2;
const USERS2 = [['alisa', '#C2477A'], ['bogdan', '#3C8DB5'], ['vera', '#2E5246'], ['tim', '#F0A33A'], ['sasha', '#6A5BFF']];
function avatar(cx, cy, r, letter, col, ring) {
  if (ring) { const g = x.createConicGradient(0, cx, cy); g.addColorStop(0, ACC); g.addColorStop(.33, HEART); g.addColorStop(.66, GOLD); g.addColorStop(1, ACC);
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r + 9, 0, 7); x.fill(); x.fillStyle = '#131623'; x.beginPath(); x.arc(cx, cy, r + 4, 0, 7); x.fill(); }
  x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
  text(letter.toUpperCase(), cx, cy + r * .36, r, D, '#fff', 'center', 700);
}
function bigHead(s, sub, t, a, b) {
  const k = eo(pr(t, a, a + .45)), o = eio(pr(t, b - .35, b)); if (k <= 0 || o >= 1) return;
  x.font = `800 88px ${D}`; const fs = Math.min(88, Math.floor(88 * 860 / x.measureText(s).width));
  text(s, W / 2, 300 + 40 * (1 - k) - 30 * o, fs, D, FG, 'center', 800, k * (1 - o));
  if (sub) text(sub, W / 2, 392 + 30 * (1 - k) - 30 * o, 42, B, MUT, 'center', 700, eo(pr(t, a + .2, a + .65)) * (1 - o));
}
function check(cx, cy, r, on) {
  x.lineWidth = 4; x.strokeStyle = on ? ACC2 : 'rgba(255,255,255,.35)'; x.fillStyle = on ? ACC2 : 'transparent';
  rr(cx - r, cy - r, r * 2, r * 2, 8); on ? x.fill() : x.stroke();
  if (on) { x.strokeStyle = '#fff'; x.lineWidth = 5; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx - r * .45, cy); x.lineTo(cx - r * .1, cy + r * .35); x.lineTo(cx + r * .5, cy - r * .35); x.stroke(); }
}

function draw(t) {
  bg(t);
  /* S1 0–2.4: логотип + новый адрес */
  if (t < 2.6) {
    const out = eio(pr(t, 2.05, 2.45));
    x.save(); x.globalAlpha = 1 - out; x.translate(0, -140 * out);
    text('ЧТО НОВОГО', W / 2, 560, 40, B, ACC2, 'center', 800, eo(pr(t, .05, .4)), 8);
    logoMark(W / 2, 760, 220 * eb(pr(t, .15, .75)), 0);
    text('кадр', W / 2, 1050, 180, D, FG, 'center', 800, eo(pr(t, .4, .9)));
    const k = eo(pr(t, .9, 1.4)); x.save(); x.globalAlpha *= k;
    x.font = `800 54px ${B}`; const uw = x.measureText('getkadr.space').width + 90;
    const g = x.createLinearGradient(W / 2 - uw / 2, 0, W / 2 + uw / 2, 0); g.addColorStop(0, ACC); g.addColorStop(1, '#7B4BE0');
    x.fillStyle = g; rr(W / 2 - uw / 2, 1140 + 30 * (1 - k), uw, 112, 56); x.fill(); text('getkadr.space', W / 2, 1215 + 30 * (1 - k), 54, B, '#fff', 'center', 800); x.restore();
    text('теперь на своём адресе', W / 2, 1340, 42, B, MUT, 'center', 700, eo(pr(t, 1.2, 1.6)));
    x.restore();
  }
  /* телефон 2.4–12.9 */
  if (t >= 2.3 && t < 13.1) {
    const inK = eo(pr(t, 2.35, 3.0)), outK = eio(pr(t, 12.5, 13.05));
    const top = lerp(H + 40, 560, inK) + lerp(0, -1500, outK);
    phone(W / 2, top, lerp(1, .82, outK), 1, () => {
      x.fillStyle = '#131623'; x.fillRect(0, 0, PW, PH);
      if (t < 6.05) {
        /* S2: истории */
        appTop(0, 'logo');
        // кружки историй
        USERS2.forEach(([h, c], i) => { const k = eb(pr(t, 2.8 + i * .1, 3.2 + i * .1)); if (k <= 0) return;
          x.save(); x.translate(70 + i * 120, 190); x.scale(k, k); avatar(0, 0, 44, h[0], c, true); x.restore();
          text(h, 70 + i * 120, 270, 20, B, MUT, 'center', 600, k); });
        postCard(310, IMG.mtn, 'vera', true, 812, false, 0, '#2E5246');
        tabbar();
        // нажатие на первую историю и открытие
        const tap = pr(t, 3.9, 4.25); if (tap > 0 && tap < 1) { x.strokeStyle = `rgba(255,255,255,${.7 * (1 - tap)})`; x.lineWidth = 6; x.beginPath(); x.arc(70, 190, 50 + 50 * tap, 0, 7); x.stroke(); }
        const op = eio(pr(t, 4.2, 4.6));
        if (op > 0) {
          x.save(); const sc = lerp(.15, 1, op); x.translate(lerp(70, PW / 2, op), lerp(190, PH / 2, op)); x.scale(sc, sc); x.globalAlpha = Math.min(1, op * 1.5);
          x.save(); rr(-PW / 2, -PH / 2, PW, PH, 40 * (1 - op)); x.clip();
          const z = 1.05 + .03 * Math.sin(t); x.drawImage(IMG.reel1, -PW * z / 2, -PH * z / 2, PW * z, PH * z);
          const r = rng(7); for (let i = 0; i < 60; i++) { const px = r() * PW - PW / 2, py = PH * .05 + r() * PH * .42, on = Math.sin(t * 5 * (.5 + r()) + r() * 9) > .4; if (on) { x.fillStyle = r() > .5 ? '#F9C74F' : '#FF8F5E'; x.fillRect(px, py, 9, 12); } }
          x.restore();
          // прогресс-бары
          for (let i = 0; i < 3; i++) { const bx = -PW / 2 + 20 + i * ((PW - 40) / 3); x.fillStyle = 'rgba(255,255,255,.35)'; rr(bx, -PH / 2 + 70, (PW - 40) / 3 - 8, 6, 3); x.fill();
            const k = i === 0 ? pr(t, 4.6, 6.0) : 0; x.fillStyle = '#fff'; rr(bx, -PH / 2 + 70, ((PW - 40) / 3 - 8) * k, 6, 3); x.fill(); }
          avatar(-PW / 2 + 50, -PH / 2 + 125, 24, 'a', '#C2477A', false); text('alisa', -PW / 2 + 90, -PH / 2 + 134, 26, B, '#fff', 'left', 800); text('2 ч', -PW / 2 + 170, -PH / 2 + 134, 24, B, 'rgba(255,255,255,.7)', 'left', 600);
          text('Ночь в городе ✨', 0, PH / 2 - 140, 40, D, '#fff', 'center', 500, pr(t, 4.7, 5.0));
          x.restore();
        }
      } else if (t < 9.65) {
        /* S3: отправить другу */
        const z = 1.05 + .03 * Math.sin(t); x.drawImage(IMG.reel2, (PW - PW * z) / 2, (PH - PH * z) / 2, PW * z, PH * z);
        x.fillStyle = '#fff'; const r = rng(3); for (let i = 0; i < 80; i++) { const px = r() * PW, py = (r() * PH + t * 90 * (.5 + r())) % PH; x.globalAlpha = .6; x.beginPath(); x.arc(px + Math.sin(t + i) * 8, py, 2 + r() * 3, 0, 7); x.fill(); } x.globalAlpha = 1;
        text('Рилсы', 30, 96, 36, D, '#fff', 'left', 700);
        // самолётик с пульсом
        const pl = 1 + .15 * Math.sin(t * 8) * (1 - pr(t, 6.6, 6.7));
        x.save(); x.translate(PW - 60, PH - 420); x.scale(pl, pl); x.strokeStyle = '#fff'; x.lineWidth = 4; x.beginPath(); x.moveTo(-22, 2); x.lineTo(22, -18); x.lineTo(6, 22); x.closePath(); x.stroke(); x.restore();
        tabbar();
        // лист «Отправить»
        const sh = eo(pr(t, 6.7, 7.1)), shOut = eio(pr(t, 8.9, 9.2));
        if (sh > 0) {
          x.fillStyle = `rgba(0,0,0,${.5 * sh * (1 - shOut)})`; x.fillRect(0, 0, PW, PH);
          const sy = lerp(PH, PH - 760, sh) + 760 * shOut;
          x.fillStyle = '#1A1E2E'; rr(0, sy, PW, 800, 36); x.fill();
          text('Отправить рилс', 30, sy + 64, 30, D, FG, 'left', 500);
          const picks = [7.45, 7.75];
          USERS2.slice(0, 4).forEach(([h, c], i) => { const yy = sy + 130 + i * 112; avatar(66, yy + 40, 34, h[0], c, false); text(h, 120, yy + 50, 28, B, FG, 'left', 800);
            check(PW - 60, yy + 40, 20, i < 2 && t > picks[i]); });
          const ready = t > 7.75; x.fillStyle = ready ? ACC : 'rgba(110,125,255,.35)'; rr(30, sy + 600, PW - 60, 84, 22); x.fill();
          text(ready ? 'Отправить (2)' : 'Выберите, кому отправить', PW / 2, sy + 653, 28, B, '#fff', 'center', 800);
          const press = pr(t, 8.4, 8.7); if (press > 0 && press < 1) { x.strokeStyle = `rgba(255,255,255,${.7 * (1 - press)})`; x.lineWidth = 5; x.beginPath(); x.arc(PW / 2, sy + 642, 30 + 60 * press, 0, 7); x.stroke(); }
        }
        // уведомление у друга
        const nk = eb(pr(t, 9.0, 9.35)), nOut = pr(t, 9.5, 9.65);
        if (nk > 0) { x.save(); x.globalAlpha = 1 - nOut; x.translate(0, -160 * (1 - nk)); x.fillStyle = 'rgba(30,34,51,.97)'; rr(20, 30, PW - 40, 120, 26); x.fill();
          avatar(80, 90, 32, 'a', '#C2477A', false); text('alisa отправила вам рилс', 128, 82, 25, B, FG, 'left', 800); text('«Смотри, первый снег!»', 128, 118, 24, B, MUT, 'left', 600); x.restore(); }
      } else {
        /* S4: уведомления */
        x.fillStyle = '#131623'; x.fillRect(0, 0, PW, PH);
        text('Уведомления', PW / 2, 82, 32, D, FG, 'center', 500);
        const items = [['bogdan', '#3C8DB5', '❤️ оценил ваш пост'], ['vera', '#2E5246', '💬 «Шикарный кадр!»'], ['tim', '#F0A33A', '👤 подписался на вас'], ['sasha', '#6A5BFF', '📨 отправил вам пост'], ['kadr', ACC, '📣 Новое обновление!']];
        items.forEach(([h, c, s], i) => { const k = eo(pr(t, 9.8 + i * .32, 10.15 + i * .32)); if (k <= 0) return;
          const y = 140 + i * 132; x.save(); x.globalAlpha = k; x.translate(60 * (1 - k), 0);
          x.fillStyle = 'rgba(110,125,255,.08)'; rr(18, y, PW - 36, 116, 22); x.fill(); avatar(78, y + 58, 36, h[0], c, false);
          text(h, 132, y + 50, 26, B, FG, 'left', 800); text(s, 132, y + 88, 25, B, MUT, 'left', 600); x.restore(); });
        // Telegram-бейдж
        const tk = eb(pr(t, 11.6, 12.0)); if (tk > 0) { x.save(); x.translate(PW / 2, PH - 230); x.scale(tk, tk); x.fillStyle = '#2AABEE'; rr(-230, -44, 460, 88, 44); x.fill();
          x.fillStyle = '#fff'; x.beginPath(); x.moveTo(-190, 0); x.lineTo(-150, -16); x.lineTo(-160, 18); x.closePath(); x.fill(); text('и в Telegram', 20, 12, 32, B, '#fff', 'center', 800); x.restore(); }
        tabbar();
      }
    });
    bigHead('Истории', 'исчезают через 24 часа', t, 2.6, 6.0);
    bigHead('Делись с друзьями', 'отправь рилс в два касания', t, 6.15, 9.6);
    bigHead('Всё в уведомлениях', 'лайки, комментарии, подписки', t, 9.75, 12.6);
  }
  /* S5 12.8–16.2: телефоны + призыв */
  if (t >= 12.8) {
    // иконка приложения на «главном экране»
    const ik = eb(pr(t, 12.85, 13.4));
    x.save(); x.translate(W / 2, 560); x.scale(ik, ik);
    x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 50; x.shadowOffsetY = 20;
    const g = x.createLinearGradient(0, -130, 0, 130); g.addColorStop(0, '#3246E6'); g.addColorStop(1, '#5A47E0'); x.fillStyle = g; rr(-130, -130, 260, 260, 58); x.fill(); x.shadowColor = 'transparent';
    x.fillStyle = '#fff'; rr(-72, -72, 144, 144, 40); x.fill(); x.fillStyle = '#3246E6'; x.beginPath(); x.arc(0, 0, 40, 0, 7); x.fill(); x.fillStyle = '#F0A33A'; x.beginPath(); x.arc(44, -44, 13, 0, 7); x.fill();
    x.restore();
    text('Кадр', W / 2, 770, 44, B, FG, 'center', 700, eo(pr(t, 13.2, 13.6)));
    text('Приложение для', W / 2, 920, 64, D, FG, 'center', 800, eo(pr(t, 13.4, 13.9)));
    text('Android и iPhone', W / 2, 1010, 64, D, FG, 'center', 800, eo(pr(t, 13.5, 14.0)));
    const pk = eo(pr(t, 14.0, 14.5)); x.save(); x.globalAlpha = pk; x.translate(0, 30 * (1 - pk));
    x.font = `800 60px ${B}`; const uw = x.measureText('getkadr.space').width + 100;
    const pulse = 1 + .03 * Math.sin(t * 6) * pr(t, 14.6, 15); x.save(); x.translate(W / 2, 1180); x.scale(pulse, pulse);
    const g2 = x.createLinearGradient(-uw / 2, 0, uw / 2, 0); g2.addColorStop(0, ACC); g2.addColorStop(1, '#7B4BE0'); x.fillStyle = g2; rr(-uw / 2, -62, uw, 124, 62); x.fill();
    text('getkadr.space', 0, 21, 60, B, '#fff', 'center', 800); x.restore(); x.restore();
    text('Регистрируйся бесплатно', W / 2, 1360, 46, B, FG, 'center', 800, eo(pr(t, 14.4, 14.9)));
    text('истории  ·  рилсы  ·  друзья  ·  галочка', W / 2, 1460, 36, B, MUT, 'center', 700, eo(pr(t, 14.7, 15.2)));
  }
  for (const tt of [2.4, 6.05, 9.7, 12.8]) { const k = pr(t, tt - .08, tt + .2); if (k > 0 && k < 1) { x.fillStyle = `rgba(255,255,255,${.12 * Math.sin(k * Math.PI)})`; x.fillRect(0, 0, W, H); } }
}
