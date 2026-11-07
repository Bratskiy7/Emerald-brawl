'use strict';
// Кадр — фото-соцсеть. Сервер без npm-зависимостей (Node 18+).
// Хранилище: data/data.json, медиа: data/uploads/. Порт: PORT (по умолчанию 3200).
const http = require('http');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3200;
const HOST = process.env.HOST || '127.0.0.1';
const DIR = process.env.KADR_DATA || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const UP = path.join(DIR, 'uploads');
const DB_FILE = path.join(DIR, 'data.json');
const MAX_UPLOAD = 80 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;

fs.mkdirSync(UP, { recursive: true });

/* ---------------- storage ---------------- */
let db = { users: {}, sessions: {}, posts: {}, tickets: {}, reports: {}, tgLinks: {}, tgOffset: 0, seq: 0 };
if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
db.reports = db.reports || {}; db.tgLinks = db.tgLinks || {}; db.seq = db.seq || 0;
db.activity = db.activity || {}; db.stories = db.stories || {}; db.resets = db.resets || {}; db.emailCodes = db.emailCodes || {};
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
function flush() {
  clearTimeout(saveTimer);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { flush(); } finally { process.exit(0); } });

const newId = p => p + crypto.randomBytes(8).toString('hex');
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPw(u, pw) {
  const h = crypto.scryptSync(String(pw), u.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex'));
}
const genPassword = () => crypto.randomBytes(9).toString('base64url');

/* ---------------- official account @kadr ---------------- */
const official = () => Object.values(db.users).find(u => u.official);
if (!official()) {
  const pw = process.env.KADR_ADMIN_PASSWORD || genPassword();
  const u = {
    id: newId('u'), handle: 'kadr', name: 'Кадр', official: true, role: 'admin', verified: true,
    bio: 'Официальный канал Кадра: новости, обновления и поддержка.\nВопрос или проблема? Профиль → «Поддержка».',
    avatar: null, follows: [], saved: [], createdAt: Date.now(), ...hashPw(pw)
  };
  db.users[u.id] = u;
  const p = { id: newId('p'), userId: u.id, type: 'text', media: null, ts: Date.now(), likes: [], comments: [], loc: '',
    cap: 'Добро пожаловать в Кадр! Это официальный канал: здесь будут новости и обновления. На него подписаны все. Если что-то не работает, напишите в поддержку: Профиль → «Поддержка». #кадр' };
  db.posts[p.id] = p;
  flush();
  if (!process.env.KADR_ADMIN_PASSWORD) {
    const f = path.join(DIR, 'ADMIN_PASSWORD.txt');
    fs.writeFileSync(f, `Вход в официальный аккаунт Кадра\nЛогин: kadr\nПароль: ${pw}\nПосле входа смените пароль: Профиль → Настройки.\n`, { mode: 0o600 });
    console.log('[kadr] Создан аккаунт @kadr. Пароль записан в ' + f);
  }
}

/* registration numbers */
for (const u of Object.values(db.users).filter(u => !u.official && !u.num).sort((a, b) => a.createdAt - b.createdAt)) u.num = ++db.seq;

/* ---------------- telegram bot ---------------- */
const TG_FILE = path.join(DIR, 'telegram.json');
let TG = { token: null, username: null };
function loadTg() { try { TG = JSON.parse(fs.readFileSync(TG_FILE, 'utf8')); } catch { TG = { token: null, username: null }; } }
loadTg();
fs.watchFile(TG_FILE, { interval: 5000 }, loadTg);
let BASE = process.env.KADR_URL ? process.env.KADR_URL.replace(/\/?$/, '/') : '';
const htmlEsc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function tgCall(method, body, timeoutMs = 15000) {
  return new Promise(resolve => {
    if (!TG.token) return resolve(null);
    const data = JSON.stringify(body);
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${TG.token}/${method}`, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(data);
  });
}
const openBtn = (text, pathQ) => BASE ? { inline_keyboard: [[{ text, web_app: { url: BASE + (pathQ || '') } }]] } : undefined;
function notify(userId, text, pathQ, btn = 'Открыть') {
  const u = db.users[userId];
  if (!u || u.banned || !u.tg || u.tg.notify === false) return;
  tgCall('sendMessage', { chat_id: u.tg.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: openBtn(btn, pathQ) })
    .then(r => { if (r && r.ok === false && r.error_code === 403) { u.tg = null; save(); } });
}
function notifyAdmins(text, pathQ) { for (const u of Object.values(db.users)) if (u.role === 'admin') notify(u.id, text, pathQ, 'Открыть админ-панель'); }
const at = u => '@' + htmlEsc(u.handle);
async function handleTgUpdate(upd) {
  const m = upd.message; if (!m || !m.text || m.chat.type !== 'private') return;
  const chatId = m.chat.id, text = m.text.trim();
  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1] || '';
    const link = db.tgLinks[code];
    if (link && link.exp > Date.now() && db.users[link.userId]) {
      for (const x of Object.values(db.users)) if (x.tg && x.tg.chatId === chatId && x.id !== link.userId) x.tg = null;
      const u = db.users[link.userId]; u.tg = { chatId, notify: true }; delete db.tgLinks[code]; save();
      return tgCall('sendMessage', { chat_id: chatId, parse_mode: 'HTML', reply_markup: openBtn('Открыть Кадр'),
        text: `Готово! Telegram подключён к ${at(u)}.\nБуду присылать уведомления о лайках, комментариях, подписках и ответах поддержки.\n\nОтключить: /stop` });
    }
    return tgCall('sendMessage', { chat_id: chatId, parse_mode: 'HTML', reply_markup: openBtn('Открыть Кадр'),
      text: '<b>Кадр</b> — соцсеть для фото и рилсов 📸\n\nНажмите кнопку ниже, чтобы открыть Кадр прямо в Telegram.\n\nЧтобы получать уведомления, откройте Кадр → Профиль → шестерёнка → «Подключить Telegram».' });
  }
  if (text === '/stop') {
    let n = 0; for (const x of Object.values(db.users)) if (x.tg && x.tg.chatId === chatId) { x.tg.notify = false; n++; }
    save();
    return tgCall('sendMessage', { chat_id: chatId, text: n ? 'Уведомления выключены. Включить снова можно в настройках Кадра.' : 'Этот Telegram не подключён ни к одному аккаунту Кадра.' });
  }
}
(async function pollTelegram() {
  for (;;) {
    if (!TG.token) { await new Promise(r => setTimeout(r, 10000)); continue; }
    const r = await tgCall('getUpdates', { offset: db.tgOffset || 0, timeout: 50, allowed_updates: ['message'] }, 65000);
    if (!r || !r.ok) { await new Promise(r2 => setTimeout(r2, 5000)); continue; }
    for (const upd of r.result) { db.tgOffset = upd.update_id + 1; try { await handleTgUpdate(upd); } catch (e) { console.error(e); } }
    if (r.result.length) save();
  }
})();

/* ---------------- e-mail (SMTP over TLS, port 465) ---------------- */
const MAIL_FILE = path.join(DIR, 'mail.json');
let MAIL = {};
function loadMail() { try { MAIL = JSON.parse(fs.readFileSync(MAIL_FILE, 'utf8')); } catch { MAIL = {}; } }
loadMail();
fs.watchFile(MAIL_FILE, { interval: 5000 }, loadMail);
const mailReady = () => !!(MAIL.host && MAIL.user && MAIL.pass);
const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-zа-яё]{2,}$/i;
const normEmail = e => String(e || '').trim().toLowerCase();
const byEmail = e => { e = normEmail(e); return e ? Object.values(db.users).find(u => u.email === e) : null; };
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
function smtpSend(to, subject, text) {
  return new Promise((resolve, reject) => {
    if (!mailReady()) return reject(new Error('Почта не настроена'));
    const from = MAIL.from || MAIL.user;
    const sock = tls.connect({ host: MAIL.host, port: +MAIL.port || 465, servername: MAIL.host, timeout: 20000 });
    let buf = '', waiter = null, done = false;
    const finish = err => { if (done) return; done = true; try { sock.end(); } catch {} err ? reject(err) : resolve(); };
    sock.setEncoding('utf8');
    sock.on('data', d => { buf += d; if (/(^|\n)\d{3} [^\n]*\n$/.test(buf.replace(/\r/g, '')) && waiter) { const w = waiter; waiter = null; const r = buf; buf = ''; w(r); } });
    sock.on('error', e => finish(e)); sock.on('timeout', () => finish(new Error('SMTP timeout')));
    const expect = (code) => new Promise((res2, rej2) => { waiter = r => { const last = r.replace(/\r/g, '').trim().split('\n').pop(); last.startsWith(String(code)) ? res2(r) : rej2(new Error('SMTP: ' + last.slice(0, 200))); }; });
    const cmd = (line, code) => { const p = expect(code); sock.write(line + '\r\n'); return p; };
    const body = b64(text).replace(/.{76}/g, '$&\r\n');
    const msg = [`From: =?UTF-8?B?${b64('Кадр')}?= <${from}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${from.split('@')[1]}>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body, '.'].join('\r\n');
    (async () => {
      await expect(220);
      await cmd('EHLO kadr', 250);
      await cmd('AUTH LOGIN', 334); await cmd(b64(MAIL.user), 334); await cmd(b64(MAIL.pass), 235);
      await cmd(`MAIL FROM:<${from}>`, 250); await cmd(`RCPT TO:<${to}>`, 250);
      await cmd('DATA', 354); await cmd(msg, 250);
      sock.write('QUIT\r\n'); finish();
    })().catch(finish);
  });
}
function newCode() { const code = String(crypto.randomInt(100000, 1000000)); const salt = crypto.randomBytes(8).toString('hex'); return { code, salt, hash: crypto.scryptSync(code, salt, 32).toString('hex') }; }
const codeOk = (rec, code) => crypto.timingSafeEqual(crypto.scryptSync(String(code || '').trim(), rec.salt, 32), Buffer.from(rec.hash, 'hex'));
async function sendEmailCode(u) {
  if (!mailReady() || !u.email) return false;
  const c = newCode();
  db.emailCodes[u.id] = { email: u.email, salt: c.salt, hash: c.hash, exp: Date.now() + 30 * 60e3, tries: 0, sentAt: Date.now() }; save();
  try {
    await smtpSend(u.email, `Код подтверждения Кадра: ${c.code}`,
      `Здравствуйте, ${u.name}!\n\nВаш код для подтверждения почты в Кадре: ${c.code}\n\nКод действует 30 минут. Если вы не регистрировались в Кадре, просто проигнорируйте это письмо.\n\n— Команда Кадра`);
    return true;
  } catch (e) { console.error('[mail]', e.message); return false; }
}

/* in-app activity feed */
function addActivity(userId, a) {
  if (!db.users[userId] || userId === a.fromId) return;
  const list = db.activity[userId] ??= [];
  list.unshift({ id: newId('a'), ts: Date.now(), read: false, ...a });
  if (list.length > 200) list.length = 200;
  save();
}
const notified = new Set(); // like/follow notifications already sent since start (no spam on re-like)

/* ---------------- invites & badges ---------------- */
const INVITES_FOR_BADGE = 3;
function inviteStats(u) {
  const inv = Object.values(db.users).filter(x => x.invitedBy === u.id && !x.banned);
  const active = inv.filter(x => Object.values(db.posts).some(p => p.userId === x.id)).length;
  return { total: inv.length, active, need: INVITES_FOR_BADGE };
}
function badgesOf(u) {
  const b = [];
  if (!u.official && inviteStats(u).active >= INVITES_FOR_BADGE) b.push('ambassador');
  return b;
}

/* ---------------- helpers ---------------- */
const HANDLE_RE = /^[a-z0-9._]{3,24}$/;
const RESERVED = new Set(['kadr', 'admin', 'support', 'root', 'api', 'uploads', 'moderator', 'podderzhka']);
const byHandle = h => Object.values(db.users).find(u => u.handle === String(h || '').toLowerCase());
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
const followersOf = u => Object.values(db.users).reduce((n, x) => n + (!x.banned && x.follows.includes(u.id) ? 1 : 0), 0);
const visible = p => p && db.users[p.userId] && !db.users[p.userId].banned;

function lite(u) {
  return { id: u.id, handle: u.handle, name: u.name, avatar: u.avatar || null, verified: !!u.verified, official: !!u.official };
}
function pubUser(u, me) {
  return {
    ...lite(u), bio: u.bio || '', followers: followersOf(u), following: u.follows.length, badges: badgesOf(u),
    posts: Object.values(db.posts).filter(p => p.userId === u.id).length,
    isFollowing: !!me && me.follows.includes(u.id), isMe: !!me && me.id === u.id
  };
}
function pubPost(p, me, full) {
  const a = db.users[p.userId];
  const cm = p.comments.filter(c => db.users[c.userId] && !db.users[c.userId].banned);
  const map = c => ({ id: c.id, text: c.text, ts: c.ts, author: lite(db.users[c.userId]) });
  return {
    id: p.id, type: p.type, media: p.media, cap: p.cap, loc: p.loc, ts: p.ts, author: lite(a),
    likes: p.likes.length, liked: !!me && p.likes.includes(me.id), saved: !!me && me.saved.includes(p.id),
    commentCount: cm.length, comments: full ? cm.map(map) : cm.slice(-2).map(map),
    canDelete: !!me && (me.id === p.userId || me.role === 'admin')
  };
}
function meView(u) {
  const t = Object.values(db.tickets).filter(t => t.userId === u.id && t.unreadUser).length;
  const out = { ...pubUser(u, u), role: u.role || 'user', supportUnread: t, activityUnread: (db.activity[u.id] || []).filter(a => !a.read).length,
    tg: { available: !!TG.token, bot: TG.username || null, linked: !!u.tg, notify: !!(u.tg && u.tg.notify !== false) },
    email: u.email || null, emailVerified: !!u.emailVerified, mailAvailable: mailReady(),
    invite: { ...inviteStats(u), path: '?ref=' + u.handle } };
  if (u.role === 'admin') {
    out.adminOpen = Object.values(db.tickets).filter(t => t.status === 'open').length;
    out.adminReports = new Set(Object.values(db.reports).filter(r => r.status === 'open' && db.posts[r.postId]).map(r => r.postId)).size;
  }
  return out;
}
function ticketView(t, forStaff) {
  const u = db.users[t.userId];
  return {
    id: t.id, kind: t.kind, subject: t.subject, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt,
    unread: forStaff ? !!t.unreadStaff : !!t.unreadUser, user: u ? { ...lite(u), banned: !!u.banned } : null,
    messages: t.messages.map(m => ({ from: m.from, text: m.text, ts: m.ts, staff: m.staffId && db.users[m.staffId] ? lite(db.users[m.staffId]) : null }))
  };
}

/* ---------------- http plumbing ---------------- */
function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const fail = (res, code, msg) => send(res, code, { error: msg });
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_JSON) { reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Неверный формат запроса'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function sessionUser(req) {
  const sid = cookies(req).sid; const s = sid && db.sessions[sid];
  if (!s) return null; const u = db.users[s.userId];
  if (!u || u.banned) return null;
  return u;
}
function startSession(req, res, u) {
  const sid = crypto.randomBytes(24).toString('hex');
  db.sessions[sid] = { userId: u.id, createdAt: Date.now() }; save();
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`;
}
const ipHits = new Map();
function limited(req, key, max, windowMs) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = key + '|' + ip, now = Date.now();
  const arr = (ipHits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); ipHits.set(k, arr);
  return arr.length > max;
}

/* ---------------- uploads ---------------- */
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', ico: 'image/x-icon', json: 'application/json', webmanifest: 'application/manifest+json' };
const MEDIA_RE = /^uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif|mp4|webm|mov)$/;
function handleUpload(req, res, me) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = TYPES[type];
  if (!ext) return fail(res, 415, 'Можно загрузить фото (JPG, PNG, WebP, GIF) или видео (MP4, WebM, MOV)');
  if (+req.headers['content-length'] > MAX_UPLOAD) return fail(res, 413, 'Файл больше 80 МБ');
  if (limited(req, 'up:' + me.id, 60, 3600e3)) return fail(res, 429, 'Слишком много загрузок. Подождите немного');
  const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
  const file = path.join(UP, name); const out = fs.createWriteStream(file, { mode: 0o644 });
  let size = 0, aborted = false;
  req.on('data', c => { size += c.length; if (size > MAX_UPLOAD && !aborted) { aborted = true; out.destroy(); fs.rm(file, () => {}); fail(res, 413, 'Файл больше 80 МБ'); req.destroy(); } });
  req.pipe(out);
  out.on('finish', () => { if (!aborted) send(res, 200, { url: 'uploads/' + name, video: type.startsWith('video/') }); });
  out.on('error', () => { if (!aborted) { aborted = true; fail(res, 500, 'Не удалось сохранить файл'); } });
}
function mediaOk(m) { return typeof m === 'string' && MEDIA_RE.test(m) && fs.existsSync(path.join(DIR, m)); }

/* ---------------- static ---------------- */
function serveFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return fallback(req, res);
    const ext = path.extname(file).slice(1).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] === '' ? st.size - +range[2] : +range[1];
      let end = range[1] !== '' && range[2] !== '' ? +range[2] : st.size - 1;
      if (start < 0 || start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
function fallback(req, res) { serveFile(req, res, path.join(PUB, 'index.html'), 'no-cache'); }

/* ---------------- routes ---------------- */
const routes = [];
const route = (method, pattern, auth, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), auth, fn });
const need = (cond, code, msg) => { if (!cond) throw Object.assign(new Error(msg), { status: code }); };
const findPost = id => { const p = db.posts[id]; need(visible(p), 404, 'Пост не найден'); return p; };

route('POST', '/api/register', null, async (req, res) => {
  need(!limited(req, 'reg', 10, 3600e3), 429, 'Слишком много попыток. Попробуйте через час');
  const b = await readJson(req);
  const handle = String(b.handle || '').trim().toLowerCase().replace(/^@/, '');
  const name = clean(b.name, 40), pw = String(b.password || '');
  need(HANDLE_RE.test(handle), 400, 'Имя пользователя: 3–24 символа, латиница, цифры, точка или _');
  need(!RESERVED.has(handle) && !byHandle(handle), 409, 'Это имя пользователя уже занято');
  need(name.length >= 1, 400, 'Укажите имя');
  need(pw.length >= 6 && pw.length <= 200, 400, 'Пароль должен быть не короче 6 символов');
  const email = normEmail(b.email);
  need(EMAIL_RE.test(email) && email.length <= 120, 400, 'Укажите настоящую почту, например name@yandex.ru');
  need(!byEmail(email), 409, 'Эта почта уже привязана к другому аккаунту. Войдите в него или восстановите пароль');
  const off = official();
  const inviter = b.ref ? byHandle(String(b.ref).replace(/^@/, '')) : null;
  const u = { id: newId('u'), handle, name, bio: '', avatar: null, role: 'user', verified: false, follows: off ? [off.id] : [], saved: [], createdAt: Date.now(),
    num: ++db.seq, invitedBy: inviter && !inviter.banned ? inviter.id : undefined, email, emailVerified: false, ...hashPw(pw) };
  if (inviter && !inviter.banned && !inviter.official) u.follows.push(inviter.id);
  db.users[u.id] = u; save();
  if (u.invitedBy) {
    const s = inviteStats(inviter);
    addActivity(inviter.id, { type: 'invite', fromId: u.id });
    notify(inviter.id, `🎉 По вашей ссылке зарегистрировался ${at(u)}!\nКогда друг опубликует первый пост, он засчитается в «Амбассадора»: сейчас ${s.active} из ${s.need}.`, '?u=' + u.handle);
  }
  const sent = await sendEmailCode(u);
  send(res, 200, { me: meView(u), emailSent: sent }, { 'Set-Cookie': startSession(req, res, u) });
});
route('POST', '/api/login', null, async (req, res) => {
  need(!limited(req, 'login', 20, 600e3), 429, 'Слишком много попыток входа. Подождите 10 минут');
  const b = await readJson(req);
  const u = byHandle(String(b.handle || '').trim().replace(/^@/, ''));
  need(u && checkPw(u, b.password || ''), 401, 'Неверное имя пользователя или пароль');
  need(!u.banned, 403, 'Аккаунт заблокирован. Напишите на почту поддержки сервиса');
  send(res, 200, { me: meView(u) }, { 'Set-Cookie': startSession(req, res, u) });
});
route('POST', '/api/logout', null, async (req, res) => {
  const sid = cookies(req).sid; if (sid) { delete db.sessions[sid]; save(); }
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
});
route('GET', '/api/me', 'user', async (req, res, me) => send(res, 200, { me: meView(me) }));
route('PATCH', '/api/me', 'user', async (req, res, me) => {
  const b = await readJson(req);
  if (b.name !== undefined) { const n = clean(b.name, 40); need(n, 400, 'Имя не может быть пустым'); me.name = n; }
  if (b.bio !== undefined) me.bio = clean(b.bio, 300);
  if (b.tgNotify !== undefined && me.tg) me.tg.notify = !!b.tgNotify;
  if (b.avatar !== undefined) { need(b.avatar === null || (mediaOk(b.avatar) && !/\.(mp4|webm|mov)$/.test(b.avatar)), 400, 'Неверное фото профиля'); me.avatar = b.avatar; }
  if (b.handle !== undefined && b.handle !== me.handle) {
    need(!me.official, 400, 'Имя официального аккаунта менять нельзя');
    const h = String(b.handle).trim().toLowerCase();
    need(HANDLE_RE.test(h), 400, 'Имя пользователя: 3–24 символа, латиница, цифры, точка или _');
    need(!RESERVED.has(h) && !byHandle(h), 409, 'Это имя пользователя уже занято');
    me.handle = h;
  }
  save(); send(res, 200, { me: meView(me) });
});
route('POST', '/api/me/password', 'user', async (req, res, me) => {
  const b = await readJson(req);
  need(checkPw(me, b.old || ''), 400, 'Текущий пароль указан неверно');
  const pw = String(b.password || ''); need(pw.length >= 6 && pw.length <= 200, 400, 'Новый пароль должен быть не короче 6 символов');
  Object.assign(me, hashPw(pw));
  const cur = cookies(req).sid;
  for (const [sid, s] of Object.entries(db.sessions)) if (s.userId === me.id && sid !== cur) delete db.sessions[sid];
  if (me.official) fs.rm(path.join(DIR, 'ADMIN_PASSWORD.txt'), () => {});
  save(); send(res, 200, { ok: true });
});
route('POST', '/api/upload', 'user', async (req, res, me) => handleUpload(req, res, me));
route('POST', '/api/me/telegram', 'user', async (req, res, me) => {
  need(TG.token && TG.username, 503, 'Telegram-бот ещё не подключён к серверу. Напишите в поддержку');
  for (const [c, l] of Object.entries(db.tgLinks)) if (l.exp < Date.now() || l.userId === me.id) delete db.tgLinks[c];
  const code = crypto.randomBytes(12).toString('hex');
  db.tgLinks[code] = { userId: me.id, exp: Date.now() + 15 * 60e3 }; save();
  send(res, 200, { url: `https://t.me/${TG.username}?start=${code}` });
});
route('POST', '/api/me/email', 'user', async (req, res, me) => {
  need(!limited(req, 'em:' + me.id, 6, 3600e3), 429, 'Слишком много писем за час. Подождите немного');
  const b = await readJson(req); const email = normEmail(b.email);
  if (email && email !== me.email) {
    need(EMAIL_RE.test(email) && email.length <= 120, 400, 'Укажите настоящую почту, например name@yandex.ru');
    const other = byEmail(email); need(!other || other.id === me.id, 409, 'Эта почта уже привязана к другому аккаунту');
    me.email = email; me.emailVerified = false; delete db.emailCodes[me.id]; save();
  }
  need(me.email, 400, 'Укажите почту');
  need(!me.emailVerified, 400, 'Почта уже подтверждена');
  need(mailReady(), 503, 'Отправка писем пока не настроена. Почта сохранена, подтвердить её можно будет позже');
  const prev = db.emailCodes[me.id];
  need(!(prev && prev.email === me.email && Date.now() - prev.sentAt < 60e3), 429, 'Письмо уже отправлено. Новое можно запросить через минуту');
  need(await sendEmailCode(me), 502, 'Не получилось отправить письмо. Проверьте адрес или попробуйте позже');
  send(res, 200, { me: meView(me) });
});
route('POST', '/api/me/email/verify', 'user', async (req, res, me) => {
  const b = await readJson(req); const r = db.emailCodes[me.id];
  need(r && r.email === me.email && r.exp > Date.now(), 400, 'Код устарел. Отправьте письмо ещё раз');
  r.tries++; save(); need(r.tries <= 5, 400, 'Слишком много неверных попыток. Отправьте письмо ещё раз');
  need(codeOk(r, b.code), 400, `Неверный код. Осталось попыток: ${5 - r.tries}`);
  me.emailVerified = true; delete db.emailCodes[me.id]; save();
  send(res, 200, { me: meView(me) });
});
route('DELETE', '/api/me/telegram', 'user', async (req, res, me) => {
  if (me.tg) tgCall('sendMessage', { chat_id: me.tg.chatId, text: 'Telegram отключён от аккаунта Кадра. Уведомлений больше не будет.' });
  me.tg = null; save(); send(res, 200, { me: meView(me) });
});

route('GET', '/api/feed', 'user', async (req, res, me) => {
  const ids = new Set([me.id, ...me.follows]);
  const list = Object.values(db.posts).filter(p => ids.has(p.userId) && visible(p)).sort((a, b) => b.ts - a.ts).slice(0, 100);
  const fol = new Set(me.follows);
  const suggest = Object.values(db.users).filter(u => !u.banned && u.id !== me.id && !fol.has(u.id))
    .map(u => [u, followersOf(u)]).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([u]) => pubUser(u, me));
  send(res, 200, { posts: list.map(p => pubPost(p, me)), suggest });
});
route('GET', '/api/explore', 'user', async (req, res, me) => {
  const url = new URL(req.url, 'http://x'); const q = clean(url.searchParams.get('q'), 60).toLowerCase().replace(/^[#@]/, '');
  const tag = clean(url.searchParams.get('tag'), 60).toLowerCase();
  let posts = Object.values(db.posts).filter(visible);
  if (tag) posts = posts.filter(p => (p.cap || '').toLowerCase().includes('#' + tag));
  else if (q) posts = posts.filter(p => ((p.cap || '') + ' ' + (p.loc || '')).toLowerCase().includes(q));
  posts = posts.sort((a, b) => b.ts - a.ts).slice(0, 150);
  const users = q ? Object.values(db.users).filter(u => !u.banned && (u.handle.includes(q) || u.name.toLowerCase().includes(q))).slice(0, 20).map(u => pubUser(u, me)) : [];
  const counts = {};
  for (const p of Object.values(db.posts)) if (visible(p)) for (const t of new Set(((p.cap || '').toLowerCase().match(/#[\p{L}\d_]+/gu) || []))) counts[t.slice(1)] = (counts[t.slice(1)] || 0) + 1;
  const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20).map(x => x[0]);
  send(res, 200, { posts: posts.map(p => pubPost(p, me)), users, tags });
});
route('GET', '/api/reels', 'user', async (req, res, me) => {
  const list = Object.values(db.posts).filter(p => p.type === 'reel' && visible(p)).sort((a, b) => b.ts - a.ts).slice(0, 80);
  send(res, 200, { posts: list.map(p => pubPost(p, me)) });
});
route('GET', '/api/saved', 'user', async (req, res, me) => {
  const list = me.saved.map(id => db.posts[id]).filter(visible).reverse();
  send(res, 200, { posts: list.map(p => pubPost(p, me)) });
});
route('GET', '/api/users/:handle', 'user', async (req, res, me, h) => {
  const u = byHandle(decodeURIComponent(h)); need(u && !u.banned, 404, 'Пользователь не найден');
  const posts = Object.values(db.posts).filter(p => p.userId === u.id).sort((a, b) => b.ts - a.ts);
  send(res, 200, { user: pubUser(u, me), posts: posts.map(p => pubPost(p, me)) });
});
route('POST', '/api/users/:handle/follow', 'user', async (req, res, me, h) => {
  const u = byHandle(decodeURIComponent(h)); need(u && !u.banned && u.id !== me.id, 404, 'Пользователь не найден');
  const i = me.follows.indexOf(u.id); if (i >= 0) me.follows.splice(i, 1); else me.follows.push(u.id);
  save(); send(res, 200, { user: pubUser(u, me) });
  if (i < 0) {
    const key = me.id + '>' + u.id;
    if (!notified.has(key)) { notified.add(key); addActivity(u.id, { type: 'follow', fromId: me.id }); notify(u.id, `👤 ${at(me)} подписался(-ась) на вас`, '?u=' + me.handle); }
  }
});

route('POST', '/api/posts', 'user', async (req, res, me) => {
  need(!limited(req, 'post:' + me.id, 30, 3600e3), 429, 'Слишком много публикаций за час');
  const b = await readJson(req);
  const type = ['photo', 'reel', 'text'].includes(b.type) ? b.type : null; need(type, 400, 'Неизвестный тип публикации');
  const cap = clean(b.cap, 2200), loc = clean(b.loc, 80);
  if (type === 'text') { need(cap.length > 0, 400, 'Напишите текст'); need(me.role === 'admin', 403, 'Текстовые посты доступны только официальному каналу'); }
  else {
    need(mediaOk(b.media), 400, 'Сначала загрузите файл');
    need((type === 'reel') === /\.(mp4|webm|mov)$/.test(b.media), 400, type === 'reel' ? 'Для рилса нужно видео' : 'Для поста нужно фото');
  }
  const p = { id: newId('p'), userId: me.id, type, media: type === 'text' ? null : b.media, cap, loc, ts: Date.now(), likes: [], comments: [] };
  db.posts[p.id] = p; save(); send(res, 200, { post: pubPost(p, me) });
});
route('GET', '/api/posts/:id', 'user', async (req, res, me, id) => send(res, 200, { post: pubPost(findPost(id), me, true) }));
route('DELETE', '/api/posts/:id', 'user', async (req, res, me, id) => {
  const p = findPost(id); need(p.userId === me.id || me.role === 'admin', 403, 'Удалить можно только свою публикацию');
  delete db.posts[id]; save(); send(res, 200, { ok: true });
});
route('POST', '/api/posts/:id/like', 'user', async (req, res, me, id) => {
  const p = findPost(id); const i = p.likes.indexOf(me.id);
  const b = await readJson(req);
  if (b.on === true && i < 0) p.likes.push(me.id); else if (b.on === false && i >= 0) p.likes.splice(i, 1);
  else if (b.on === undefined) { if (i >= 0) p.likes.splice(i, 1); else p.likes.push(me.id); }
  save(); send(res, 200, { post: pubPost(p, me) });
  if (i < 0 && p.likes.includes(me.id) && p.userId !== me.id) {
    const key = me.id + '♥' + p.id;
    if (!notified.has(key)) { notified.add(key); addActivity(p.userId, { type: 'like', fromId: me.id, postId: p.id }); notify(p.userId, `❤️ ${at(me)} оценил(-а) ваш ${p.type === 'reel' ? 'рилс' : 'пост'}${p.cap ? ': «' + htmlEsc(p.cap.slice(0, 60)) + (p.cap.length > 60 ? '…' : '') + '»' : ''}`, '?p=' + p.id); }
  }
});
route('POST', '/api/posts/:id/save', 'user', async (req, res, me, id) => {
  findPost(id); const i = me.saved.indexOf(id); if (i >= 0) me.saved.splice(i, 1); else me.saved.push(id);
  save(); send(res, 200, { saved: i < 0 });
});
route('POST', '/api/posts/:id/comments', 'user', async (req, res, me, id) => {
  need(!limited(req, 'cm:' + me.id, 120, 3600e3), 429, 'Слишком много комментариев. Подождите немного');
  const p = findPost(id); const b = await readJson(req); const text = clean(b.text, 1000); need(text, 400, 'Комментарий пустой');
  p.comments.push({ id: newId('c'), userId: me.id, text, ts: Date.now() }); save();
  send(res, 200, { post: pubPost(p, me, true) });
  const short = htmlEsc(text.slice(0, 200)) + (text.length > 200 ? '…' : '');
  if (p.userId !== me.id) addActivity(p.userId, { type: 'comment', fromId: me.id, postId: p.id, text: text.slice(0, 200) });
  if (p.userId !== me.id) notify(p.userId, `💬 ${at(me)} прокомментировал(-а) ваш ${p.type === 'reel' ? 'рилс' : 'пост'}:\n${short}`, '?p=' + p.id + '&c=1');
  const mentioned = new Set((text.match(/@([a-z0-9._]{3,24})/g) || []).map(h => h.slice(1)));
  for (const h of mentioned) { const u = byHandle(h); if (u && u.id !== me.id && u.id !== p.userId) addActivity(u.id, { type: 'mention', fromId: me.id, postId: p.id, text: text.slice(0, 200) }); if (u && u.id !== me.id && u.id !== p.userId) notify(u.id, `📣 ${at(me)} упомянул(-а) вас в комментарии:\n${short}`, '?p=' + p.id + '&c=1'); }
});

/* reports */
const REASONS = { spam: 'Спам или реклама', abuse: 'Оскорбления или травля', nsfw: 'Материалы 18+', violence: 'Насилие или опасные действия', fake: 'Обман или фейк', other: 'Другое' };
route('POST', '/api/posts/:id/report', 'user', async (req, res, me, id) => {
  const p = findPost(id); need(p.userId !== me.id, 400, 'Нельзя пожаловаться на свою публикацию');
  need(!limited(req, 'rep:' + me.id, 20, 3600e3), 429, 'Слишком много жалоб. Подождите немного');
  const b = await readJson(req); need(REASONS[b.reason], 400, 'Выберите причину');
  const exists = Object.values(db.reports).find(r => r.postId === p.id && r.userId === me.id && r.status === 'open');
  if (!exists) {
    const r = { id: newId('r'), postId: p.id, userId: me.id, reason: b.reason, text: clean(b.text, 500), ts: Date.now(), status: 'open' };
    db.reports[r.id] = r; save();
    notifyAdmins(`🚩 Жалоба на ${p.type === 'reel' ? 'рилс' : 'пост'} ${at(db.users[p.userId])}: ${REASONS[b.reason]}`, '?admin=reports');
  }
  send(res, 200, { ok: true });
});
route('DELETE', '/api/posts/:id/comments/:cid', 'user', async (req, res, me, id, cid) => {
  const p = findPost(id); const i = p.comments.findIndex(c => c.id === cid); need(i >= 0, 404, 'Комментарий не найден');
  need(p.comments[i].userId === me.id || p.userId === me.id || me.role === 'admin', 403, 'Нельзя удалить чужой комментарий');
  p.comments.splice(i, 1); save(); send(res, 200, { post: pubPost(p, me, true) });
});

/* activity */
route('GET', '/api/activity', 'user', async (req, res, me) => {
  const list = (db.activity[me.id] || []).filter(a => db.users[a.fromId] && !db.users[a.fromId].banned).slice(0, 100);
  const out = list.map(a => {
    const p = a.postId && db.posts[a.postId];
    return { id: a.id, type: a.type, ts: a.ts, read: a.read, text: a.text || '', from: lite(db.users[a.fromId]),
      isFollowing: me.follows.includes(a.fromId),
      post: p ? { id: p.id, type: p.type, media: p.media, cap: (p.cap || '').slice(0, 80) } : null };
  });
  for (const a of db.activity[me.id] || []) a.read = true;
  save(); send(res, 200, { items: out });
});

/* stories (24 h) */
const STORY_TTL = 24 * 3600e3;
const liveStory = s => s && Date.now() - s.ts < STORY_TTL && db.users[s.userId] && !db.users[s.userId].banned;
function cleanupStories() {
  let changed = false;
  for (const [id, s] of Object.entries(db.stories)) if (Date.now() - s.ts > STORY_TTL) {
    delete db.stories[id]; changed = true;
    if (s.media && !Object.values(db.posts).some(p => p.media === s.media) && !Object.values(db.users).some(u => u.avatar === s.media)) fs.rm(path.join(DIR, s.media), () => {});
  }
  for (const [uid, r] of Object.entries(db.resets)) if (r.exp < Date.now()) { delete db.resets[uid]; changed = true; }
  for (const [uid, r] of Object.entries(db.emailCodes)) if (r.exp < Date.now()) { delete db.emailCodes[uid]; changed = true; }
  if (changed) save();
}
setInterval(cleanupStories, 10 * 60e3).unref();
route('GET', '/api/stories', 'user', async (req, res, me) => {
  const ids = new Set([me.id, ...me.follows]); const groups = {};
  for (const s of Object.values(db.stories)) {
    if (!liveStory(s) || !ids.has(s.userId)) continue;
    (groups[s.userId] ??= []).push(s);
  }
  const out = Object.entries(groups).map(([uid, list]) => {
    list.sort((a, b) => a.ts - b.ts);
    const items = list.map(s => ({ id: s.id, media: s.media, type: s.type, ts: s.ts, viewed: s.views.includes(me.id), views: uid === me.id ? s.views.length : undefined }));
    return { user: lite(db.users[uid]), items, seen: items.every(i => i.viewed), last: list[list.length - 1].ts, mine: uid === me.id };
  }).sort((a, b) => (b.mine - a.mine) || (a.seen - b.seen) || (b.last - a.last));
  send(res, 200, { groups: out });
});
route('POST', '/api/stories', 'user', async (req, res, me) => {
  need(!limited(req, 'st:' + me.id, 30, 24 * 3600e3), 429, 'Слишком много историй за сутки');
  const b = await readJson(req); need(mediaOk(b.media), 400, 'Сначала загрузите фото или видео');
  const s = { id: newId('s'), userId: me.id, media: b.media, type: /\.(mp4|webm|mov)$/.test(b.media) ? 'video' : 'photo', ts: Date.now(), views: [] };
  db.stories[s.id] = s; save(); send(res, 200, { ok: true, id: s.id });
});
route('POST', '/api/stories/:id/view', 'user', async (req, res, me, id) => {
  const s = db.stories[id]; need(liveStory(s), 404, 'История уже исчезла');
  if (s.userId !== me.id && !s.views.includes(me.id)) { s.views.push(me.id); save(); }
  send(res, 200, { ok: true });
});
route('GET', '/api/stories/:id/viewers', 'user', async (req, res, me, id) => {
  const s = db.stories[id]; need(liveStory(s) && (s.userId === me.id || me.role === 'admin'), 404, 'История не найдена');
  send(res, 200, { viewers: s.views.slice().reverse().map(uid => db.users[uid]).filter(u => u && !u.banned).map(lite) });
});
route('DELETE', '/api/stories/:id', 'user', async (req, res, me, id) => {
  const s = db.stories[id]; need(s && (s.userId === me.id || me.role === 'admin'), 404, 'История не найдена');
  delete db.stories[id]; save(); send(res, 200, { ok: true });
});

/* password reset via e-mail and/or Telegram */
const findAccount = x => { x = String(x || '').trim(); return x.includes('@') && !x.startsWith('@') ? byEmail(x) : byHandle(x.replace(/^@/, '')); };
route('POST', '/api/reset/request', null, async (req, res) => {
  need(!limited(req, 'rst', 8, 3600e3), 429, 'Слишком много попыток. Попробуйте через час');
  const b = await readJson(req); const u = findAccount(b.login || b.handle);
  const generic = { ok: true, message: 'Если такой аккаунт есть и к нему подтверждена почта или подключён Telegram, мы отправили туда код. Он действует 15 минут.' };
  if (!u || u.banned) return send(res, 200, generic);
  const viaMail = mailReady() && u.email && u.emailVerified, viaTg = !!(u.tg && TG.token);
  if (!viaMail && !viaTg) return send(res, 200, generic);
  const prev = db.resets[u.id];
  if (prev && prev.sentAt && Date.now() - prev.sentAt < 60e3) return send(res, 200, generic);
  const c = newCode();
  db.resets[u.id] = { salt: c.salt, hash: c.hash, exp: Date.now() + 15 * 60e3, tries: 0, sentAt: Date.now() }; save();
  if (viaTg) tgCall('sendMessage', { chat_id: u.tg.chatId, parse_mode: 'HTML',
    text: `🔑 Код для сброса пароля в Кадре: <code>${c.code}</code>\n\nДействует 15 минут. Если вы не запрашивали сброс, просто проигнорируйте это сообщение — пароль не изменится.` });
  if (viaMail) smtpSend(u.email, `Сброс пароля в Кадре: ${c.code}`,
    `Здравствуйте, ${u.name}!\n\nКто-то (надеемся, вы) запросил сброс пароля для @${u.handle}.\nКод: ${c.code}\n\nКод действует 15 минут. Если вы не запрашивали сброс, просто проигнорируйте это письмо — пароль не изменится.\n\n— Команда Кадра`)
    .catch(e => console.error('[mail]', e.message));
  send(res, 200, generic);
});
route('POST', '/api/reset/confirm', null, async (req, res) => {
  need(!limited(req, 'rstc', 30, 3600e3), 429, 'Слишком много попыток. Попробуйте через час');
  const b = await readJson(req); const u = findAccount(b.login || b.handle);
  const r = u && db.resets[u.id];
  need(r && r.exp > Date.now(), 400, 'Код устарел или не запрашивался. Запросите новый');
  r.tries++; save();
  need(r.tries <= 5, 400, 'Слишком много неверных попыток. Запросите новый код');
  const ok = codeOk(r, b.code);
  need(ok, 400, `Неверный код. Осталось попыток: ${5 - r.tries}`);
  const pw = String(b.password || ''); need(pw.length >= 6 && pw.length <= 200, 400, 'Новый пароль должен быть не короче 6 символов');
  Object.assign(u, hashPw(pw)); delete db.resets[u.id];
  for (const [sid, sv] of Object.entries(db.sessions)) if (sv.userId === u.id) delete db.sessions[sid];
  if (u.official) fs.rm(path.join(DIR, 'ADMIN_PASSWORD.txt'), () => {});
  save();
  if (u.tg) tgCall('sendMessage', { chat_id: u.tg.chatId, text: 'Пароль в Кадре изменён. Все другие устройства вышли из аккаунта.' });
  send(res, 200, { me: meView(u) }, { 'Set-Cookie': startSession(req, res, u) });
});

/* support */
route('GET', '/api/support', 'user', async (req, res, me) => {
  const list = Object.values(db.tickets).filter(t => t.userId === me.id).sort((a, b) => b.updatedAt - a.updatedAt);
  send(res, 200, { tickets: list.map(t => ticketView(t, false)) });
});
route('POST', '/api/support', 'user', async (req, res, me) => {
  need(!limited(req, 'tk:' + me.id, 10, 3600e3), 429, 'Слишком много обращений. Подождите немного');
  const b = await readJson(req); const text = clean(b.text, 2000); need(text, 400, 'Опишите вопрос');
  const kind = b.kind === 'verify' ? 'verify' : 'help';
  if (kind === 'verify') {
    need(!me.verified, 400, 'У вас уже есть галочка');
    need(!Object.values(db.tickets).some(t => t.userId === me.id && t.kind === 'verify' && t.status !== 'closed'), 409, 'Заявка на галочку уже на рассмотрении');
  }
  const now = Date.now();
  const t = { id: newId('t'), userId: me.id, kind, subject: kind === 'verify' ? 'Заявка на галочку' : clean(text.split('\n')[0], 80), status: 'open',
    createdAt: now, updatedAt: now, unreadStaff: true, unreadUser: false, messages: [{ from: 'user', text, ts: now }] };
  db.tickets[t.id] = t; save(); send(res, 200, { ticket: ticketView(t, false) });
  notifyAdmins(`${kind === 'verify' ? '✅ Заявка на галочку' : '🛟 Новое обращение'} от ${at(me)}:\n${htmlEsc(text.slice(0, 300))}`, '?admin=tickets');
});
route('GET', '/api/support/:id', 'user', async (req, res, me, id) => {
  const t = db.tickets[id]; need(t && t.userId === me.id, 404, 'Обращение не найдено');
  if (t.unreadUser) { t.unreadUser = false; save(); }
  send(res, 200, { ticket: ticketView(t, false) });
});
route('POST', '/api/support/:id', 'user', async (req, res, me, id) => {
  const t = db.tickets[id]; need(t && t.userId === me.id, 404, 'Обращение не найдено');
  need(!limited(req, 'tm:' + me.id, 60, 3600e3), 429, 'Слишком много сообщений. Подождите немного');
  const b = await readJson(req); const text = clean(b.text, 2000); need(text, 400, 'Сообщение пустое');
  t.messages.push({ from: 'user', text, ts: Date.now() }); t.status = 'open'; t.unreadStaff = true; t.updatedAt = Date.now();
  save(); send(res, 200, { ticket: ticketView(t, false) });
  notifyAdmins(`🛟 ${at(me)} ответил(-а) в обращении «${htmlEsc(t.subject)}»:\n${htmlEsc(text.slice(0, 300))}`, '?admin=tickets');
});

/* admin */
route('GET', '/api/admin/stats', 'admin', async (req, res) => {
  const day = Date.now() - 864e5; const posts = Object.values(db.posts); const users = Object.values(db.users); const tk = Object.values(db.tickets);
  send(res, 200, { users: users.length, newUsers: users.filter(u => u.createdAt > day).length, verified: users.filter(u => u.verified).length, banned: users.filter(u => u.banned).length,
    posts: posts.filter(p => p.type !== 'reel').length, reels: posts.filter(p => p.type === 'reel').length, newPosts: posts.filter(p => p.ts > day).length,
    ticketsOpen: tk.filter(t => t.status === 'open').length, ticketsAll: tk.length,
    reportsOpen: new Set(Object.values(db.reports).filter(r => r.status === 'open' && db.posts[r.postId]).map(r => r.postId)).size,
    telegramLinked: users.filter(u => u.tg).length, invited: users.filter(u => u.invitedBy).length });
});
route('GET', '/api/admin/users', 'admin', async (req, res) => {
  const q = clean(new URL(req.url, 'http://x').searchParams.get('q'), 60).toLowerCase().replace(/^@/, '');
  const list = Object.values(db.users).filter(u => !q || u.handle.includes(q) || u.name.toLowerCase().includes(q)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  send(res, 200, { users: list.map(u => ({ ...lite(u), email: u.email || null, emailVerified: !!u.emailVerified, role: u.role || 'user', banned: !!u.banned, createdAt: u.createdAt, followers: followersOf(u), posts: Object.values(db.posts).filter(p => p.userId === u.id).length })) });
});
route('POST', '/api/admin/users/:id', 'admin', async (req, res, me, id) => {
  const u = db.users[id]; need(u, 404, 'Пользователь не найден'); const b = await readJson(req);
  if (b.verified !== undefined) u.verified = !!b.verified;
  if (b.banned !== undefined) { need(!u.official && u.id !== me.id, 400, 'Этот аккаунт заблокировать нельзя'); u.banned = !!b.banned; if (u.banned) for (const [s, v] of Object.entries(db.sessions)) if (v.userId === u.id) delete db.sessions[s]; }
  if (b.role !== undefined) { need(!u.official && u.id !== me.id, 400, 'Роль этого аккаунта менять нельзя'); u.role = b.role === 'admin' ? 'admin' : 'user'; }
  save(); send(res, 200, { ok: true });
});
route('POST', '/api/admin/users/:id/reset', 'admin', async (req, res, me, id) => {
  const u = db.users[id]; need(u && !u.official, 400, 'Пароль этого аккаунта так сбросить нельзя');
  const pw = genPassword(); Object.assign(u, hashPw(pw));
  for (const [s, v] of Object.entries(db.sessions)) if (v.userId === u.id) delete db.sessions[s];
  save(); send(res, 200, { password: pw });
});
route('GET', '/api/admin/tickets', 'admin', async (req, res) => {
  const st = new URL(req.url, 'http://x').searchParams.get('status') || 'open';
  const list = Object.values(db.tickets).filter(t => st === 'all' || t.status === st).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
  send(res, 200, { tickets: list.map(t => ticketView(t, true)) });
});
route('GET', '/api/admin/tickets/:id', 'admin', async (req, res, me, id) => {
  const t = db.tickets[id]; need(t, 404, 'Обращение не найдено'); if (t.unreadStaff) { t.unreadStaff = false; save(); }
  send(res, 200, { ticket: ticketView(t, true) });
});
route('POST', '/api/admin/tickets/:id/reply', 'admin', async (req, res, me, id) => {
  const t = db.tickets[id]; need(t, 404, 'Обращение не найдено'); const b = await readJson(req); const text = clean(b.text, 4000); need(text, 400, 'Ответ пустой');
  t.messages.push({ from: 'staff', staffId: me.id, text, ts: Date.now() }); t.status = b.close ? 'closed' : 'answered'; t.unreadUser = true; t.unreadStaff = false; t.updatedAt = Date.now();
  save(); send(res, 200, { ticket: ticketView(t, true) });
  notify(t.userId, `🛟 Поддержка Кадра ответила:\n${htmlEsc(text.slice(0, 500))}`, '?support=' + t.id, 'Открыть чат');
});
route('POST', '/api/admin/tickets/:id/status', 'admin', async (req, res, me, id) => {
  const t = db.tickets[id]; need(t, 404, 'Обращение не найдено'); const b = await readJson(req);
  need(['open', 'answered', 'closed'].includes(b.status), 400, 'Неизвестный статус'); t.status = b.status; t.updatedAt = Date.now();
  save(); send(res, 200, { ticket: ticketView(t, true) });
});
route('POST', '/api/admin/tickets/:id/verify', 'admin', async (req, res, me, id) => {
  const t = db.tickets[id]; need(t, 404, 'Обращение не найдено'); const u = db.users[t.userId]; need(u, 404, 'Пользователь не найден');
  const b = await readJson(req); const grant = b.grant !== false; u.verified = grant;
  t.messages.push({ from: 'staff', staffId: me.id, ts: Date.now(), text: grant ? 'Готово: вам выдана синяя галочка. Она уже видна рядом с вашим именем.' : 'Заявку на галочку пока отклонили. Добавьте фото профиля, описание и несколько публикаций, потом подайте заявку снова.' });
  t.status = 'closed'; t.unreadUser = true; t.unreadStaff = false; t.updatedAt = Date.now();
  save(); send(res, 200, { ticket: ticketView(t, true) });
  notify(u.id, grant ? '✅ Поздравляем! Вам выдана синяя галочка.' : 'Заявку на галочку пока отклонили. Подробности в поддержке.', '?support=' + t.id, 'Открыть');
});
route('GET', '/api/admin/reports', 'admin', async (req, res, me) => {
  const groups = {};
  for (const r of Object.values(db.reports)) {
    if (r.status !== 'open') continue; const p = db.posts[r.postId]; if (!p || !db.users[p.userId]) continue;
    const g = groups[r.postId] ??= { post: pubPost(p, me), author: { ...lite(db.users[p.userId]), banned: !!db.users[p.userId].banned }, reports: [], last: 0 };
    g.reports.push({ reason: REASONS[r.reason], text: r.text, ts: r.ts, by: db.users[r.userId] ? lite(db.users[r.userId]) : null }); g.last = Math.max(g.last, r.ts);
  }
  send(res, 200, { items: Object.values(groups).sort((a, b) => b.reports.length - a.reports.length || b.last - a.last) });
});
route('POST', '/api/admin/reports/:postId', 'admin', async (req, res, me, postId) => {
  const b = await readJson(req); need(['dismiss', 'delete', 'ban'].includes(b.action), 400, 'Неизвестное действие');
  const p = db.posts[postId];
  for (const r of Object.values(db.reports)) if (r.postId === postId && r.status === 'open') { r.status = b.action === 'dismiss' ? 'dismissed' : 'resolved'; r.resolvedBy = me.id; }
  if (p && (b.action === 'delete' || b.action === 'ban')) {
    const author = db.users[p.userId];
    delete db.posts[postId];
    if (author) notify(author.id, `Ваша публикация удалена модератором за нарушение правил Кадра.${b.action === 'ban' ? ' Аккаунт заблокирован.' : ''}`);
    if (b.action === 'ban' && author && !author.official && author.role !== 'admin') {
      author.banned = true; for (const [s, v] of Object.entries(db.sessions)) if (v.userId === author.id) delete db.sessions[s];
    }
  }
  save(); send(res, 200, { ok: true });
});

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (!BASE && req.headers['x-forwarded-proto'] === 'https') BASE = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host) + '/';
  try {
    if (url.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url); if (!m) continue;
        let me = null;
        if (r.auth) { me = sessionUser(req); need(me, 401, 'Войдите в аккаунт'); if (r.auth === 'admin') need(me.role === 'admin', 403, 'Нет доступа'); }
        if (req.method !== 'GET' && req.headers.origin) {
          const host = req.headers['x-forwarded-host'] || req.headers.host;
          need(new URL(req.headers.origin).host === host, 403, 'Запрос с чужого сайта');
        }
        return await r.fn(req, res, me, ...m.slice(1));
      }
      return fail(res, 404, 'Нет такого адреса');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Метод не поддерживается');
    if (url.startsWith('/uploads/')) {
      const name = url.slice(9); if (!/^[a-f0-9]{32}\.\w{3,4}$/.test(name)) return fail(res, 404, 'Нет файла');
      return serveFile(req, res, path.join(UP, name), 'public, max-age=31536000, immutable');
    }
    const rel = path.normalize(decodeURIComponent(url)).replace(/^([/\\])+/, '');
    const file = path.join(PUB, rel || 'index.html');
    if (!file.startsWith(PUB)) return fail(res, 404, 'Нет файла');
    serveFile(req, res, file, rel.endsWith('.html') || !rel ? 'no-cache' : 'public, max-age=3600');
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Ошибка сервера');
    if (!e.status) console.error(e);
  }
});
server.listen(PORT, HOST, () => console.log(`[kadr] http://${HOST}:${PORT}`));
