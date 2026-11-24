/**
 * 心动日常 · 情侣小屋 —— 同步服务器 v2（账号体系版，零依赖 Node 18+）
 * 用户：微信 openid 或演示 guest 身份
 * 组队：邀请码绑定成情侣对
 * 同步：按情侣对存状态，SSE 实时推送
 * 双模式：配了 WX_* 环境变量走真微信；没配走演示账号（功能一样）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wx = require('./wechat');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const VERSION_FILE = path.join(__dirname, 'version.json');
const CODES_FILE = path.join(__dirname, 'redeem-codes.json');

// ---------- VIP 兑换码 ----------
// 格式：{ "CODE": { used: false, by: null, coupleId: null } }
// 一个码只能用一次；用掉后绑定到一个情侣对，情侣两人通用。
let REDEEM = {};
try {
  if (fs.existsSync(CODES_FILE)) REDEEM = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
} catch (e) { REDEEM = {}; }
function saveCodes() {
  try { fs.writeFileSync(CODES_FILE, JSON.stringify(REDEEM, null, 2)); } catch (e) {}
}
function checkCode(code, coupleId, userId, userName) {
  const key = String(code || '').toUpperCase().trim();
  const item = REDEEM[key];
  if (!item) return { ok: false, error: '兑换码无效' };
  const out = { ok:true, code:key, duration:item.duration||0, admin:!!item.admin, scope:item.scope||'both' };
  // multiUse：可被多对情侣各用一次（如推广码 5211314）
  if (item.multiUse) {
    if (!item.usedBy) item.usedBy = [];
    if (item.usedBy.includes(coupleId)) return out; // 这对已用过，幂等
    item.usedBy.push(coupleId); item.used = true; item.usedAt = Date.now();
    saveCodes();
    return out;
  }
  // 单次码
  if (item.used) {
    if (item.coupleId === coupleId) return out; // 同对幂等
    return { ok: false, error: '兑换码已被使用' };
  }
  item.used = true; item.coupleId = coupleId; item.by = userId; item.byName = userName;
  item.usedAt = Date.now();
  saveCodes();
  return out;
}

// ---------- 持久化 ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let DB = { users: {}, couples: {} };
try {
  if (fs.existsSync(DATA_FILE)) {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (d && d.users && d.couples) DB = d;
  }
} catch (e) {}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(DB)); } catch (e) { console.error('save error', e); }
  }, 150);
}

// ---------- 工具 ----------
function uid(prefix) { return prefix + '_' + crypto.randomBytes(9).toString('hex'); }
function inviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = ''; for (let i = 0; i < 6; i++) c += chars[crypto.randomInt(chars.length)];
  return c;
}
function defaultState() {
  return {
    names: ['', ''], start: new Date().toISOString().slice(0, 10),
    tasks: [
      { id: 1, ico: '🌅', name: '说早安', desc: '新的一天从问候开始' },
      { id: 2, ico: '💬', name: '聊聊天', desc: '今天也分享彼此的日常' },
      { id: 3, ico: '💧', name: '提醒喝水', desc: '照顾好身体' },
      { id: 4, ico: '🌙', name: '说晚安', desc: '带着好梦入睡' }
    ],
    annivs: [], savings: [], msgs: [], checks: {},
    diaries: {}, // { 'YYYY-MM-DD': {mood, text, who, time} } 共享心情日记
    moods: {},   // { 'YYYY-MM-DD': { userId: mood } } 双人情绪日历
    locs: {},    // { userId: {lat, lng, time, name} } 两人实时位置
    notes: [],      // 便利贴
    wishes: [],     // 恋爱清单/愿望
    photos: [],     // 心动相册（base64 图片）
    stories: [],    // 故事册
    quizScore: { a: 0, b: 0 },  // 默契挑战比分
    gacha: [],      // 扭蛋/抽签记录
    period: null,   // 经期助手 {start, cycle}
    sleep: {},      // 睡眠监督 { 'YYYY-MM-DD': {bed, wake} }
    games: {},      // 五子棋/对战状态
    fortune: {},    // 每日星运缓存 { 'YYYY-MM-DD': {sign, text} }
    perms: {},      // { userId: { permission: 'granted'|'denied'|'prompt', ts } } 权限授权状态
    device: {},     // { userId: {ua, platform, lang, tz, screen} } 设备信息
    usage: {},      // { 'YYYY-MM-DD': { userId: {page: ms} } } 功能使用时长
    activeUse: {},  // { userId: {page, ts} } 当前正在使用的功能
    appUsage: {},   // { userId: {day:[{app,ms}], week:[...], ts} } 整机App使用时长（原生上报）
    vip: null       // { enabled, by, since } VIP 开通状态
  };
}
// 截帧数据存内存即可（不需持久化）：coupleId -> {frame, ts, sharerId, active}
const screenCache = {};
function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise(resolve => {
    let d = ''; req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
  });
}
function userPub(u) {
  return { id: u.id, name: u.name, avatar: u.avatar || '', coupleId: u.coupleId || null };
}
// 用 token 找用户
function userByToken(token) {
  for (const id in DB.users) if (DB.users[id].token === token) return DB.users[id];
  return null;
}
// 建用户
function createUser(name, avatar, openid) {
  const id = uid('u'), token = uid('t');
  DB.users[id] = { id, token, name: name || '昵称', avatar: avatar || '', openid: openid || '', coupleId: null, invite: null };
  persist();
  return DB.users[id];
}
// 建情侣对
function createCouple(u1, u2) {
  const cid = uid('c');
  DB.couples[cid] = { id: cid, members: [u1.id, u2.id], state: defaultState(), rev: 0, createdAt: Date.now() };
  u1.coupleId = cid; u2.coupleId = cid;
  u1.invite = null; u2.invite = null;
  persist();
  return DB.couples[cid];
}

// SSE 订阅： coupleId -> Set<res>
const subs = {};
function broadcast(cid) {
  const set = subs[cid]; if (!set) return;
  const payload = 'data: ' + JSON.stringify({ type: 'sync', ts: Date.now() }) + '\n\n';
  for (const res of set) { try { res.write(payload); } catch (e) {} }
}

// ---------- 静态资源 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) file = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
  const base = path.basename(file);
  headers['Cache-Control'] = (base === 'index.html' || base === 'sw.js' || base === 'manifest.json')
    ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  // 健康检查
  if (p === '/api/health') {
    return json(res, 200, { ok: true, uptime: Math.floor(process.uptime()), users: Object.keys(DB.users).length, couples: Object.keys(DB.couples).length });
  }
  // 版本
  if (p === '/api/version') {
    let v = { version: '2.0.0', note: '账号体系版', force: false };
    try { if (fs.existsSync(VERSION_FILE)) v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')); } catch (e) {}
    return json(res, 200, v);
  }

  // === 登录模式探测 ===
  if (p === '/api/auth/modes') {
    return json(res, 200, { wechat: wx.enabled, guest: true });
  }

  // === 演示账号登录（永远可用）===
  if (p === '/api/auth/guest' && req.method === 'POST') {
    const b = await body(req);
    const name = String(b.name || '').trim().slice(0, 12) || '游客';
    const user = createUser(name, '', '');
    return json(res, 200, { token: user.token, user: userPub(user) });
  }

  // === 微信登录 ===
  if (p === '/api/wx/authurl' && req.method === 'GET') {
    if (!wx.enabled) return json(res, 400, { error: '微信登录未配置' });
    return json(res, 200, { url: wx.authUrl(wx.makeState()) });
  }
  if (p === '/api/wx/callback' && req.method === 'GET') {
    if (!wx.enabled) return json(res, 400, { error: '微信登录未配置' });
    const code = u.searchParams.get('code'), state = u.searchParams.get('state');
    if (!code || !wx.validState(state)) return json(res, 400, { error: '授权失效' });
    try {
      const tk = await wx.getToken(code);
      if (tk.errcode) return json(res, 400, { error: '换取凭证失败: ' + tk.errmsg });
      const info = await wx.getUser(tk.access_token, tk.openid);
      // 按 openid 找已有用户，没有就建
      let user = Object.values(DB.users).find(x => x.openid === tk.openid);
      if (!user) user = createUser(info.nickname || '微信用户', info.headimgurl || '', tk.openid);
      const payload = { token: user.token, user: userPub(user) };
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>登录完成</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:60px"><div id="msg">登录成功，正在返回…</div>
      <script>
        var d=${JSON.stringify(payload)};
        try{ window.opener && window.opener.postMessage({type:'wxauth',data:d},'*'); }catch(e){}
        try{ localStorage.setItem('xd_wxauth', JSON.stringify(d)); }catch(e){}
        setTimeout(function(){ window.close(); }, 800);
      <\/script></body></html>`);
      return;
    } catch (e) { return json(res, 500, { error: '微信登录失败' }); }
  }

  // === 当前用户 ===
  if (p === '/api/me' && req.method === 'GET') {
    const token = u.searchParams.get('token');
    const user = userByToken(token);
    if (!user) return json(res, 401, { error: '登录失效' });
    const out = userPub(user);
    out.hasCouple = !!(user.coupleId && DB.couples[user.coupleId]);
    if (out.hasCouple) out.partner = userPub(DB.users[DB.couples[user.coupleId].members.find(m => m !== user.id)] || {});
    return json(res, 200, out);
  }

  // === 创建邀请（我已登录但还没组队）===
  if (p === '/api/invite/create' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user) return json(res, 401, { error: '登录失效' });
    if (user.coupleId) return json(res, 400, { error: '你已经组队了' });
    if (!user.invite) { user.invite = inviteCode(); persist(); }
    return json(res, 200, { code: user.invite });
  }

  // === 接受邀请（B 输入 A 的邀请码）===
  if (p === '/api/invite/join' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user) return json(res, 401, { error: '登录失效' });
    if (user.coupleId) return json(res, 400, { error: '你已经组队了' });
    const code = String(b.code || '').toUpperCase().trim();
    const host = Object.values(DB.users).find(x => x.invite === code);
    if (!host) return json(res, 404, { error: '邀请码无效' });
    // 单人模式：输自己的邀请码 → 创建只含自己的小屋，先体验功能
    if (host.id === user.id) {
      const cid = uid('c');
      DB.couples[cid] = {
        id: cid, members: [user.id], state: defaultState(), rev: 0,
        createdAt: Date.now(), solo: true
      };
      DB.couples[cid].state.names = [user.name, ''];
      user.coupleId = cid; user.invite = null;
      persist(); broadcast(cid);
      return json(res, 200, { coupleId: cid, solo: true });
    }
    if (host.coupleId) return json(res, 400, { error: '对方已组队' });
    const couple = createCouple(host, user);
    // 初始昵称写进共享状态
    couple.state.names = [host.name, user.name];
    persist(); broadcast(couple.id);
    return json(res, 200, { coupleId: couple.id });
  }

  // === 拉取状态（按情侣对）===
  if (p === '/api/state' && req.method === 'GET') {
    const token = u.searchParams.get('token');
    const user = userByToken(token);
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    if (!c) return json(res, 404, { error: '情侣对不存在' });
    const pid = c.members.find(m => m !== user.id);
    return json(res, 200, { state: c.state, rev: c.rev, me: userPub(user),
      partner: pid ? userPub(DB.users[pid] || {}) : null, solo: !!c.solo });
  }

  // === 提交状态 ===
  if (p === '/api/state' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    if (!c) return json(res, 404, { error: '情侣对不存在' });
    c.state = b.state || c.state;
    if (!c.state.locs) c.state.locs = {};   // 兼容旧数据
    if (!c.state.diaries) c.state.diaries = {};
    if (!c.state.moods) c.state.moods = {};
    ['notes','wishes','photos','stories','gacha'].forEach(k=>{if(!c.state[k])c.state[k]=[]});
    if(!c.state.quizScore)c.state.quizScore={a:0,b:0};
    ['sleep','games','fortune','perms','device','usage','activeUse','appUsage'].forEach(k=>{if(!c.state[k])c.state[k]={}});
    if(c.state.vip===undefined)c.state.vip=null;
    c.rev++;
    persist(); broadcast(c.id);
    return json(res, 200, { ok: true, rev: c.rev });
  }

  // === 位置：上报自己的位置 ===
  // === 整机 App 使用时长（原生 APK 上报）===
  if (p === '/api/appusage' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user || !user.coupleId) return json(res, 400, { error: '登录失效' });
    const c = DB.couples[user.coupleId];
    if (!c.state.appUsage) c.state.appUsage = {};
    c.state.appUsage[user.id] = {
      day: b.day || [], week: b.week || [], ts: b.ts || Date.now()
    };
    persist(); broadcast(user.coupleId);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/location' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    if (!c) return json(res, 404, { error: '情侣对不存在' });
    const lat = Number(b.lat), lng = Number(b.lng);
    if (!isFinite(lat) || !isFinite(lng)) return json(res, 400, { error: '坐标无效' });
    if (!c.state.locs) c.state.locs = {};
    c.state.locs[user.id] = { lat, lng, name: user.name, time: Date.now(),
      accuracy: b.accuracy || null };
    c.rev++;
    persist(); broadcast(c.id);
    return json(res, 200, { ok: true });
  }
  // === 位置：读取两人位置 ===
  if (p === '/api/location' && req.method === 'GET') {
    const user = userByToken(u.searchParams.get('token'));
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    if (!c) return json(res, 404, { error: '情侣对不存在' });
    const locs = (c.state && c.state.locs) || {};
    const members = c.members.map(mid => {
      const u2 = DB.users[mid] || {};
      return { id: mid, name: u2.name || '', loc: locs[mid] || null };
    });
    return json(res, 200, { members, me: user.id });
  }

  // === VIP 开通 / 查询 ===
  if (p === '/api/vip' && req.method === 'GET') {
    const user = userByToken(u.searchParams.get('token'));
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    // 限时 VIP 到期自动关闭
    if (c.state.vip && c.state.vip.expiresAt && Date.now() > c.state.vip.expiresAt) {
      c.state.vip = null; persist(); broadcast(c.id);
    }
    let leftDays = null;
    if (c.state.vip && c.state.vip.expiresAt) {
      leftDays = Math.max(0, Math.ceil((c.state.vip.expiresAt - Date.now()) / 86400000));
    }
    return json(res, 200, {
      vip: c.state.vip || null, me: user.id,
      isAdmin: !!user.isAdmin, leftDays
    });
  }
  if (p === '/api/vip/activate' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    // 校验兑换码（已开通VIP也允许继续兑换：续期/升级）
    const chk = checkCode(b.code, user.coupleId, user.id, user.name);
    if (!chk.ok) return json(res, 400, { error: chk.error });
    const now = Date.now();
    // 管理员码：只授予管理员身份，不强制开 VIP
    if (chk.admin) {
      user.isAdmin = true; user.adminSince = now;
      persist();
      return json(res, 200, { ok: true, admin: true, isAdmin: true,
        message: '管理员权限已开通', vip: c.state.vip || null });
    }
    // VIP 码
    const expiresAt = chk.duration > 0 ? now + chk.duration * 86400000 : null;
    // 已有 VIP 且新的也是限时码 → 在原到期时间上叠加
    let baseTs = now;
    if (c.state.vip && c.state.vip.enabled && c.state.vip.expiresAt && expiresAt) {
      baseTs = Math.max(now, c.state.vip.expiresAt);
    }
    const newExpires = chk.duration > 0 ? baseTs + chk.duration * 86400000 : null;
    c.state.vip = {
      enabled: true, by: user.id, byName: user.name, since: now, code: chk.code,
      expiresAt: newExpires, duration: chk.duration || 0, scope: chk.scope || 'both'
    };
    persist(); broadcast(c.id);
    return json(res, 200, { ok: true, vip: c.state.vip, isAdmin: !!user.isAdmin });
  }
  if (p === '/api/vip/cancel' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    c.state.vip = null;
    if (screenCache[user.coupleId]) screenCache[user.coupleId].active = false;
    persist(); broadcast(c.id);
    return json(res, 200, { ok: true });
  }

  // === 管理员：身份校验 / 总览 / 生成兑换码 ===
  if (p === '/api/admin/me' && req.method === 'GET') {
    const user = userByToken(u.searchParams.get('token'));
    if (!user) return json(res, 401, { error: '未登录' });
    return json(res, 200, { isAdmin: !!user.isAdmin, name: user.name, since: user.adminSince||null });
  }
  if (p === '/api/admin/overview' && req.method === 'GET') {
    const user = userByToken(u.searchParams.get('token'));
    if (!user || !user.isAdmin) return json(res, 403, { error: '需要管理员权限' });
    const users = Object.values(DB.users).map(x => ({
      id:x.id, name:x.name, isAdmin:!!x.isAdmin,
      coupleId:x.coupleId||null, online:!!x.coupleId
    }));
    const couples = Object.values(DB.couples).map(c => ({
      id:c.id, members:c.members.map(m=>(DB.users[m]||{}).name||'?'),
      vip: c.state.vip ? { code:c.state.vip.code, by:c.state.vip.byName,
        expiresAt:c.state.vip.expiresAt||null } : null
    }));
    const codes = Object.entries(REDEEM).map(([k,v])=>({code:k,used:!!v.used,duration:v.duration||0,admin:!!v.admin,by:v.byName||null}));
    return json(res, 200, { stats:{users:users.length,couples:couples.length,
      vipCouples:couples.filter(c=>c.vip).length, codes:codes.length}, users, couples, codes });
  }
  if (p === '/api/admin/code' && req.method === 'POST') {
    const d = await body(req);
    const user = userByToken(u.searchParams.get('token') || d.token);
    if (!user || !user.isAdmin) return json(res, 403, { error: '需要管理员权限' });
    let code = String(d.code||'').toUpperCase().trim() || inviteCode();
    if (REDEEM[code]) return json(res, 400, { error: '该兑换码已存在' });
    REDEEM[code] = { used:false, by:null, coupleId:null,
      duration: Math.max(0, parseInt(d.duration)||0), admin: !!d.admin,
      note: d.note||'管理员生成' };
    saveCodes();
    return json(res, 200, { ok:true, code, duration:REDEEM[code].duration, admin:REDEEM[code].admin });
  }

  // === 互动截屏：共享方上传截帧（VIP 专属）===
  if (p === '/api/screen/frame' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    if (!(c.state.vip && c.state.vip.enabled)) return json(res, 403, { error: '需要开通 VIP' });
    // 单向模式：开通方只能看，不能共享自己的画面
    if (c.state.vip.scope === 'viewer' && c.state.vip.by === user.id) {
      return json(res, 403, { error: '当前为单向观看模式，你不能共享自己的屏幕' });
    }
    screenCache[user.coupleId] = {
      frame: b.frame || '', ts: Date.now(), sharerId: user.id,
      sharerName: user.name, active: b.active !== false
    };
    broadcast(user.coupleId);   // 通知 VIP 方有新画面
    return json(res, 200, { ok: true });
  }
  // 互动截屏：观看方拉取最新画面
  if (p === '/api/screen/frame' && req.method === 'GET') {
    const user = userByToken(u.searchParams.get('token'));
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const c = DB.couples[user.coupleId];
    if (!(c.state.vip && c.state.vip.enabled)) return json(res, 403, { error: '需要开通 VIP' });
    // 单向模式：只有开通方能观看对方画面
    if (c.state.vip.scope === 'viewer' && c.state.vip.by !== user.id) {
      return json(res, 403, { error: '对方未授权你观看其屏幕' });
    }
    return json(res, 200, screenCache[user.coupleId] || { frame: '', active: false });
  }
  // 停止共享
  if (p === '/api/screen/stop' && req.method === 'POST') {
    const b = await body(req); const user = userByToken(b.token);
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    if (screenCache[user.coupleId]) screenCache[user.coupleId].active = false;
    broadcast(user.coupleId);
    return json(res, 200, { ok: true });
  }

  // === SSE 实时推送（按情侣对）===
  if (p === '/api/events' && req.method === 'GET') {
    const user = userByToken(u.searchParams.get('token'));
    if (!user || !user.coupleId) return json(res, 400, { error: '尚未组队' });
    const cid = user.coupleId;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    if (!subs[cid]) subs[cid] = new Set();
    subs[cid].add(res);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', () => { clearInterval(hb); subs[cid] && subs[cid].delete(res); });
    return;
  }

  return serveStatic(req, res, p);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`心动日常 v2 服务器已启动: http://0.0.0.0:${PORT}`);
});
