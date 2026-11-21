/**
 * 云端服务：REST API（配置持久化）+ WebSocket（消息队列订阅）+ 静态托管统一核心
 * 纯 Node 原生实现，零 npm 依赖。启动：node server.js
 *
 * REST:
 *   GET    /api/info                -> 平台信息
 *   GET    /api/configs             -> 配置列表
 *   GET    /api/config/:id          -> 读取配置
 *   POST   /api/config/:id          -> 保存配置（body=JSON）
 *   DELETE /api/config/:id          -> 删除配置
 *   POST   /api/publish             -> 发布消息到 MQ（body={topic,message}）
 *   GET    /api/mq/status           -> MQ 状态
 *   GET    /api/mq/replay/:topic    -> 回放 topic 消息
 * WS:
 *   ws://host/ws?topic=xxx          -> 订阅 topic，消息以 JSON 文本推送
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FileMQ } = require('./mq.cjs');

const PORT = process.env.PORT || 8791;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const WEB_DIR = process.env.WEB_DIR || path.resolve(__dirname, '..'); // 统一核心所在目录
const CFG_DIR = path.join(DATA_DIR, 'configs');
const MQ_DIR = path.join(DATA_DIR, 'mq');

fs.mkdirSync(CFG_DIR, { recursive: true });
const mq = new FileMQ(MQ_DIR);

const wss = new Set(); // { socket, topics:Set }

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 10 * 1024 * 1024) reject(new Error('body too large')); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
  });
}
function safeId(id) { return String(id).replace(/[^\w\-\u4e00-\u9fa5]/g, '_'); }
function cfgPath(id) { return path.join(CFG_DIR, safeId(id) + '.json'); }
function listConfigs() {
  return fs.readdirSync(CFG_DIR).filter(f => f.endsWith('.json')).map(f => {
    const p = path.join(CFG_DIR, f);
    const st = fs.statSync(p);
    let name = f;
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); name = (j.meta && j.meta.configName) || f; } catch (e) {}
    return { id: f.replace(/\.json$/, ''), name, updatedAt: st.mtime.toISOString(), size: st.size };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ---------- WebSocket（原生握手 + 帧） ---------- */
function wsSend(socket, obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x81; // FIN + text
  socket.write(Buffer.concat([header, payload]));
}
function wsFrameParse(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) === 0x80;
  let len = buf[1] & 0x7f, off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  if (masked) {
    if (buf.length < off + 4) return null;
    const mask = buf.slice(off, off + 4); off += 4;
    const data = Buffer.alloc(len);
    for (let i = 0; i < len; i++) data[i] = buf[off + i] ^ mask[i % 4];
    return { opcode, data, consumed: off + len };
  }
  return { opcode, data: buf.slice(off, off + len), consumed: off + len };
}
function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const url = new URL(req.url, 'http://localhost');
  const topics = new Set((url.searchParams.get('topic') || '').split(',').filter(Boolean));
  const client = { socket, topics, buf: Buffer.alloc(0) };
  wss.add(client);
  wsSend(socket, { type: 'hello', topics: [...topics], at: new Date().toISOString() });
  // 回放已有消息
  topics.forEach(t => mq.replay(t).forEach(r => wsSend(socket, { type: 'mq', record: r })));
  // 订阅广播
  const unsubs = [...topics].map(t => mq.subscribe(t, r => {
    if (wss.has(client)) wsSend(socket, { type: 'mq', record: r });
  }));
  socket.on('data', chunk => {
    client.buf = Buffer.concat([client.buf, chunk]);
    while (client.buf.length) {
      const f = wsFrameParse(client.buf);
      if (!f) break;
      client.buf = client.buf.slice(f.consumed);
      if (f.opcode === 8) { socket.end(); break; }
      if (f.opcode === 1) {
        try {
          const msg = JSON.parse(f.data.toString());
          if (msg.type === 'subscribe' && msg.topic) {
            topics.add(msg.topic);
            mq.subscribe(msg.topic, r => { if (wss.has(client)) wsSend(socket, { type: 'mq', record: r }); });
            wsSend(socket, { type: 'subscribed', topic: msg.topic });
          }
        } catch (e) { /* ignore */ }
      }
    }
  });
  socket.on('error', () => { wss.delete(client); unsubs.forEach(u => u()); });
  socket.on('close', () => { wss.delete(client); unsubs.forEach(u => u()); });
}

/* ---------- 静态文件 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xmind': 'application/octet-stream', '.exe': 'application/octet-stream', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };
function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/cloud/index.html';
  // 安全：禁止跳出 WEB_DIR
  const full = path.join(WEB_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(WEB_DIR)) return json(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return json(res, 404, { error: 'not found', path: rel });
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

/* ---------- HTTP ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (p === '/api/info') return json(res, 200, { platform: 'cloud', label: '网页云端 · REST + FileMQ', capabilities: { persist: true, queue: true, filesystem: true }, mq: mq.status() });
    if (p === '/api/configs' && req.method === 'GET') return json(res, 200, listConfigs());
    if (p.startsWith('/api/config/')) {
      const id = p.slice('/api/config/'.length);
      if (req.method === 'GET') {
        const f = cfgPath(id);
        if (!fs.existsSync(f)) return json(res, 404, { error: 'not found' });
        return json(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        fs.writeFileSync(cfgPath(id), JSON.stringify(body, null, 2));
        mq.publish('poster-config', { action: 'save', id, name: (body.meta && body.meta.configName) || id, at: new Date().toISOString() });
        return json(res, 200, { ok: true, id, updatedAt: new Date().toISOString() });
      }
      if (req.method === 'DELETE') {
        const f = cfgPath(id);
        if (fs.existsSync(f)) fs.unlinkSync(f);
        mq.publish('poster-config', { action: 'delete', id, at: new Date().toISOString() });
        return json(res, 200, { ok: true });
      }
    }
    if (p === '/api/publish' && req.method === 'POST') {
      const body = await readBody(req);
      const rec = mq.publish(body.topic || 'poster-config', body.message != null ? body.message : body);
      return json(res, 200, { ok: true, seq: rec.seq, topic: rec.topic });
    }
    if (p === '/api/mq/status') return json(res, 200, mq.status());
    if (p.startsWith('/api/mq/replay/')) {
      const topic = p.slice('/api/mq/replay/'.length);
      const from = u.searchParams.get('from');
      return json(res, 200, mq.replay(topic, from !== null ? Number(from) : undefined));
    }
    // CORS 预检
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'api not found' });
    return serveStatic(res, req.url);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});
server.on('upgrade', handleUpgrade);
server.listen(PORT, () => {
  console.log('云端服务已启动: http://localhost:' + PORT);
  console.log('数据目录: ' + DATA_DIR);
  console.log('Web 目录: ' + WEB_DIR);
});
