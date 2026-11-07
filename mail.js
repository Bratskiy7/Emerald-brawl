'use strict';
// Почта Кадра без зависимостей: приём писем (SMTP, порт 25), разбор MIME,
// отправка напрямую на MX получателя с подписью DKIM или через внешний SMTP (relay, порт 465).
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const CRLF = '\r\n';

/* ---------------- decoding helpers ---------------- */
function decodeCharset(buf, charset) {
  charset = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  if (charset === 'us-ascii' || charset === 'ascii') charset = 'utf-8';
  try { return new TextDecoder(charset).decode(buf); } catch { return buf.toString('utf8'); }
}
function qpDecode(s) {
  const out = []; s = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else out.push(...Buffer.from(s[i], 'latin1'));
  }
  return Buffer.from(out);
}
function decodeWords(s) {
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    try {
      const buf = enc.toUpperCase() === 'B' ? Buffer.from(txt, 'base64') : qpDecode(txt.replace(/_/g, ' '));
      return decodeCharset(buf, cs);
    } catch { return m; }
  });
}
const fixRaw = v => /[\x80-\xff]/.test(v) ? Buffer.from(v, 'latin1').toString('utf8') : v;
function parseHeaders(block) {
  const lines = block.replace(/\r\n[ \t]+/g, ' ').split(/\r\n/);
  const h = {};
  for (const l of lines) { const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); const v = fixRaw(l.slice(i + 1).trim()); h[k] = h[k] ? h[k] + ', ' + v : v; } }
  return h;
}
function param(value, name) {
  const ext = new RegExp(name + "\\*=([^']*)'[^']*'([^;\\s]+)", 'i').exec(value || '');
  if (ext) { try { return decodeCharset(Buffer.from(ext[2].replace(/%([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'), ext[1] || 'utf-8'); } catch {} }
  const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|[^;\\s]+)', 'i').exec(value || '');
  return m ? (m[2] !== undefined ? m[2] : m[1]) : '';
}
const stripHtml = h => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|li)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();

function parsePart(raw, acc) {
  const i = raw.indexOf('\r\n\r\n');
  const head = i >= 0 ? raw.slice(0, i) : raw, body = i >= 0 ? raw.slice(i + 4) : '';
  const h = parseHeaders(head);
  const ct = (h['content-type'] || 'text/plain').toLowerCase();
  const disp = (h['content-disposition'] || '').toLowerCase();
  if (ct.startsWith('multipart/')) {
    const boundary = param(h['content-type'], 'boundary');
    if (!boundary) return h;
    const parts = body.split('--' + boundary);
    for (const p of parts.slice(1)) { if (p.startsWith('--')) break; parsePart(p.replace(/^\r\n/, ''), acc); }
    return h;
  }
  const isAttachment = disp.startsWith('attachment') || param(h['content-disposition'], 'filename') || param(h['content-type'], 'name');
  if (isAttachment && !ct.startsWith('text/')) { acc.attachments.push(decodeWords(param(h['content-disposition'], 'filename') || param(h['content-type'], 'name') || 'файл')); return h; }
  if (!ct.startsWith('text/')) return h;
  const enc = (h['content-transfer-encoding'] || '').toLowerCase();
  const buf = enc === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : enc === 'quoted-printable' ? qpDecode(body) : Buffer.from(body, 'latin1');
  const text = decodeCharset(buf, param(h['content-type'], 'charset') || 'utf-8');
  if (ct.startsWith('text/plain') && !acc.text) acc.text = text;
  else if (ct.startsWith('text/html') && !acc.html) acc.html = text;
  return h;
}
function parseMessage(raw) {
  const acc = { text: '', html: '', attachments: [] };
  const h = parsePart(raw, acc);
  const text = (acc.text || (acc.html ? stripHtml(acc.html) : '')).replace(/\r\n/g, '\n').trim();
  return {
    from: decodeWords(h.from || ''), to: decodeWords(h.to || ''), cc: decodeWords(h.cc || ''), subject: decodeWords(h.subject || '(без темы)'),
    date: Date.parse(h.date || '') || Date.now(), messageId: (h['message-id'] || '').trim(), inReplyTo: (h['in-reply-to'] || '').trim(),
    replyTo: decodeWords(h['reply-to'] || ''), text: text.slice(0, 200000), attachments: acc.attachments.slice(0, 50),
    authResults: h['authentication-results'] || ''
  };
}
const addrOf = s => { const m = /<([^>]+)>/.exec(s || ''); return (m ? m[1] : String(s || '').trim()).toLowerCase(); };

/* ---------------- building and signing outgoing mail ---------------- */
function encWord(s) { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; }
function buildMessage({ from, fromName, to, subject, text, replyTo, inReplyTo, domain }) {
  const id = `<${crypto.randomBytes(12).toString('hex')}@${domain || from.split('@')[1]}>`;
  const headers = [
    ['From', fromName ? `${encWord(fromName)} <${from}>` : `<${from}>`],
    ['To', `<${to}>`],
    ['Subject', encWord(subject)],
    ['Date', new Date().toUTCString().replace('GMT', '+0000')],
    ['Message-ID', id],
    ['MIME-Version', '1.0'],
    ['Content-Type', 'text/plain; charset=utf-8'],
    ['Content-Transfer-Encoding', 'base64'],
  ];
  if (replyTo) headers.push(['Reply-To', `<${replyTo}>`]);
  if (inReplyTo) { headers.push(['In-Reply-To', inReplyTo]); headers.push(['References', inReplyTo]); }
  const body = b64(text.replace(/\r?\n/g, CRLF)).replace(/.{76}/g, '$&' + CRLF) + CRLF;
  return { headers, body, id };
}
const relaxHeader = (name, value) => name.toLowerCase() + ':' + String(value).replace(/\r\n[ \t]+/g, ' ').replace(/[ \t]+/g, ' ').trim();
function relaxBody(body) {
  let lines = body.split(CRLF).map(l => l.replace(/[ \t]+/g, ' ').replace(/ +$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? lines.join(CRLF) + CRLF : '';
}
function dkimSign(msg, { domain, selector, privateKey }) {
  const bh = crypto.createHash('sha256').update(relaxBody(msg.body)).digest('base64');
  const signed = msg.headers.filter(([n]) => ['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type', 'content-transfer-encoding', 'reply-to', 'in-reply-to', 'references'].includes(n.toLowerCase()));
  const hlist = signed.map(([n]) => n.toLowerCase()).join(':');
  const dkimVal = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=${selector}; t=${Math.floor(Date.now() / 1000)}; h=${hlist}; bh=${bh}; b=`;
  const data = signed.map(([n, v]) => relaxHeader(n, v) + CRLF).join('') + relaxHeader('DKIM-Signature', dkimVal);
  const b = crypto.createSign('RSA-SHA256').update(data).sign(privateKey, 'base64');
  return ['DKIM-Signature', dkimVal + b];
}
function serialize(msg, extraFirst) {
  const hs = (extraFirst ? [extraFirst] : []).concat(msg.headers);
  return hs.map(([n, v]) => `${n}: ${v}`).join(CRLF) + CRLF + CRLF + msg.body;
}
const dotStuff = s => s.replace(/(^|\r\n)\./g, '$1..');

/* ---------------- SMTP client (generic) ---------------- */
function smtpSession(sock) {
  let buf = '', waiter = null;
  const onData = d => { buf += d; if (/(^|\r?\n)\d{3} [^\n]*\r?\n$/.test(buf) && waiter) { const w = waiter; waiter = null; const r = buf; buf = ''; w(r); } };
  const attach = s => { s.setEncoding('utf8'); s.on('data', onData); };
  attach(sock);
  const api = {
    sock,
    expect(code) {
      return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('SMTP: нет ответа от сервера')), 60000);
        waiter = r => { clearTimeout(t); const last = r.trim().split(/\r?\n/).pop(); last.startsWith(String(code)) ? res(r) : rej(Object.assign(new Error('SMTP: ' + last.slice(0, 300)), { smtpCode: +last.slice(0, 3) })); };
      });
    },
    cmd(line, code) { const p = api.expect(code); api.sock.write(line + CRLF); return p; },
    upgrade(servername) {
      return new Promise((res, rej) => {
        api.sock.removeListener('data', onData);
        const t = tls.connect({ socket: api.sock, servername, rejectUnauthorized: false }, () => { api.sock = t; attach(t); res(); });
        t.on('error', rej);
      });
    }
  };
  return api;
}

/* relay over implicit TLS (465) with AUTH LOGIN */
async function sendViaRelay(cfg, envFrom, to, data) {
  const sock = tls.connect({ host: cfg.host, port: +cfg.port || 465, servername: cfg.host, timeout: 30000 });
  sock.on('timeout', () => sock.destroy(new Error('SMTP timeout')));
  const s = smtpSession(sock);
  try {
    await s.expect(220);
    await s.cmd('EHLO kadr', 250);
    await s.cmd('AUTH LOGIN', 334); await s.cmd(b64(cfg.user), 334); await s.cmd(b64(cfg.pass), 235);
    await s.cmd(`MAIL FROM:<${envFrom}>`, 250); await s.cmd(`RCPT TO:<${to}>`, 250);
    await s.cmd('DATA', 354); await s.cmd(dotStuff(data) + CRLF + '.', 250);
    s.sock.write('QUIT' + CRLF);
  } finally { setTimeout(() => s.sock.destroy(), 1000); }
}

/* direct to recipient MX on port 25 (opportunistic STARTTLS) */
async function sendDirect(heloDomain, envFrom, to, data, mxOverride) {
  const domain = to.split('@')[1];
  let hosts;
  if (mxOverride) hosts = [mxOverride];
  else {
    try { hosts = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority).map(m => m.exchange); } catch { hosts = []; }
    if (!hosts.length) hosts = [domain];
  }
  let lastErr;
  for (const h of hosts) {
    const [host, port] = h.includes(':') ? h.split(':') : [h, 25];
    try {
      const sock = net.connect({ host, port: +port, timeout: 30000 });
      sock.on('timeout', () => sock.destroy(new Error('Нет ответа от ' + host + ' (порт 25 закрыт?)')));
      await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
      const s = smtpSession(sock);
      try {
        await s.expect(220);
        const ehlo = await s.cmd('EHLO ' + heloDomain, 250);
        if (/STARTTLS/i.test(ehlo)) { await s.cmd('STARTTLS', 220); await s.upgrade(host); await s.cmd('EHLO ' + heloDomain, 250); }
        await s.cmd(`MAIL FROM:<${envFrom}>`, 250); await s.cmd(`RCPT TO:<${to}>`, 250);
        await s.cmd('DATA', 354); await s.cmd(dotStuff(data) + CRLF + '.', 250);
        s.sock.write('QUIT' + CRLF);
        return;
      } finally { setTimeout(() => s.sock.destroy(), 1000); }
    } catch (e) { lastErr = e; if (e.smtpCode && e.smtpCode >= 500 && e.smtpCode < 600) throw e; }
  }
  throw lastErr || new Error('Не удалось доставить письмо');
}

/* ---------------- inbound SMTP server ---------------- */
function startInbound({ port, host, domain, certFiles, onMessage, log }) {
  let secureContext = null;
  const loadCert = () => {
    try { secureContext = tls.createSecureContext({ cert: fs.readFileSync(certFiles.cert), key: fs.readFileSync(certFiles.key) }); }
    catch { secureContext = null; }
  };
  loadCert(); setInterval(loadCert, 12 * 3600e3).unref();
  const perIp = new Map(); let active = 0;
  const server = net.createServer(sock => {
    const ip = sock.remoteAddress || '';
    const now = Date.now(); const hits = (perIp.get(ip) || []).filter(t => now - t < 3600e3); hits.push(now); perIp.set(ip, hits);
    if (active > 50 || hits.length > 120) { sock.end('421 Too busy, try later' + CRLF); return; }
    active++; sock.on('close', () => active--);
    sock.setTimeout(120000, () => sock.destroy());
    let s = sock, buf = '', state = 'cmd', from = '', rcpts = [], data = [], size = 0, tlsOn = false;
    const write = l => { try { s.write(l + CRLF); } catch {} };
    const reset = () => { from = ''; rcpts = []; data = []; size = 0; state = 'cmd'; };
    const onLine = line => {
      if (state === 'data') {
        if (line === '.') {
          state = 'cmd';
          if (size > 15 * 1024 * 1024) { write('552 Message too large'); reset(); return; }
          const raw = data.map(l => l.startsWith('..') ? l.slice(1) : l).join(CRLF);
          try { onMessage({ from, rcpts: rcpts.slice(), raw, ip, tls: tlsOn }); write('250 OK: queued'); } catch (e) { log(e); write('451 Temporary error'); }
          reset(); return;
        }
        size += line.length + 2; if (size <= 15 * 1024 * 1024) data.push(line); return;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { write(`250-${domain}`); write('250-SIZE 15728640'); write('250-8BITMIME'); if (secureContext && !tlsOn) write('250-STARTTLS'); write('250 SMTPUTF8'); }
      else if (cmd === 'HELO') write(`250 ${domain}`);
      else if (line.toUpperCase() === 'STARTTLS' && secureContext && !tlsOn) {
        write('220 Ready to start TLS');
        s.removeAllListeners('data');
        const t = new tls.TLSSocket(s, { isServer: true, secureContext });
        t.setEncoding('latin1'); t.on('data', onData); t.on('error', () => sock.destroy());
        s = t; tlsOn = true; buf = ''; reset();
      }
      else if (cmd === 'MAIL') { from = addrOf((/FROM:\s*(<[^>]*>|\S+)/i.exec(line) || [])[1] || ''); rcpts = []; write('250 OK'); }
      else if (cmd === 'RCPT') {
        const to = addrOf((/TO:\s*(<[^>]*>|\S+)/i.exec(line) || [])[1] || '');
        if (!to.endsWith('@' + domain)) write('550 5.7.1 Relaying denied');
        else if (rcpts.length >= 50) write('452 Too many recipients');
        else { rcpts.push(to); write('250 OK'); }
      }
      else if (cmd === 'DATA') { if (!rcpts.length) write('503 Need RCPT first'); else { state = 'data'; data = []; size = 0; write('354 End data with <CR><LF>.<CR><LF>'); } }
      else if (cmd === 'RSET') { reset(); write('250 OK'); }
      else if (cmd === 'NOOP') write('250 OK');
      else if (cmd === 'QUIT') { write('221 Bye'); s.end(); }
      else if (cmd === 'VRFY') write('252 Cannot verify');
      else write('502 Command not implemented');
    };
    const onData = d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); onLine(line); } if (buf.length > 1e6 && state !== 'data') sock.destroy(); };
    sock.setEncoding('latin1'); sock.on('data', onData); sock.on('error', () => {});
    write(`220 ${domain} ESMTP Kadr`);
  });
  server.on('error', e => log(`[mail] приём писем на порту ${port} не запущен: ${e.message}`));
  server.listen(port, host, () => log(`[mail] приём писем: порт ${port}, домен @${domain}`));
  return server;
}

/* ---------------- DKIM key ---------------- */
function loadDkim(dir) {
  const f = path.join(dir, 'dkim.pem');
  if (!fs.existsSync(f)) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(f, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(f));
  const pub = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  return { privateKey, dnsValue: `v=DKIM1; k=rsa; p=${pub}` };
}

module.exports = { parseMessage, buildMessage, dkimSign, serialize, sendViaRelay, sendDirect, startInbound, loadDkim, addrOf, decodeWords };
