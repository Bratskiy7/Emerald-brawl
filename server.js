'use strict';
// Кадр — фото-соцсеть. Сервер без npm-зависимостей (Node 18+).
// Хранилище: data/data.json, медиа: data/uploads/. Порт: PORT (по умолчанию 3200).
const http = require('http');
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
let db = { users: {}, sessions: {}, posts: {}, tickets: {} };
if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
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
    ...lite(u), bio: u.bio || '', followers: followersOf(u), following: u.follows.length,
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
  const out = { ...pubUser(u, u), role: u.role || 'user', supportUnread: t };
  if (u.role === 'admin') out.adminOpen = Object.values(db.tickets).filter(t => t.status === 'open').length;
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
  const off = official();
  const u = { id: newId('u'), handle, name, bio: '', avatar: null, role: 'user', verified: false, follows: off ? [off.id] : [], saved: [], createdAt: Date.now(), ...hashPw(pw) };
  db.users[u.id] = u; save();
  send(res, 200, { me: meView(u) }, { 'Set-Cookie': startSession(req, res, u) });
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
});
route('DELETE', '/api/posts/:id/comments/:cid', 'user', async (req, res, me, id, cid) => {
  const p = findPost(id); const i = p.comments.findIndex(c => c.id === cid); need(i >= 0, 404, 'Комментарий не найден');
  need(p.comments[i].userId === me.id || p.userId === me.id || me.role === 'admin', 403, 'Нельзя удалить чужой комментарий');
  p.comments.splice(i, 1); save(); send(res, 200, { post: pubPost(p, me, true) });
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
});

/* admin */
route('GET', '/api/admin/stats', 'admin', async (req, res) => {
  const day = Date.now() - 864e5; const posts = Object.values(db.posts); const users = Object.values(db.users); const tk = Object.values(db.tickets);
  send(res, 200, { users: users.length, newUsers: users.filter(u => u.createdAt > day).length, verified: users.filter(u => u.verified).length, banned: users.filter(u => u.banned).length,
    posts: posts.filter(p => p.type !== 'reel').length, reels: posts.filter(p => p.type === 'reel').length, newPosts: posts.filter(p => p.ts > day).length,
    ticketsOpen: tk.filter(t => t.status === 'open').length, ticketsAll: tk.length });
});
route('GET', '/api/admin/users', 'admin', async (req, res) => {
  const q = clean(new URL(req.url, 'http://x').searchParams.get('q'), 60).toLowerCase().replace(/^@/, '');
  const list = Object.values(db.users).filter(u => !q || u.handle.includes(q) || u.name.toLowerCase().includes(q)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  send(res, 200, { users: list.map(u => ({ ...lite(u), role: u.role || 'user', banned: !!u.banned, createdAt: u.createdAt, followers: followersOf(u), posts: Object.values(db.posts).filter(p => p.userId === u.id).length })) });
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
});

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
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
