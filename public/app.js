/* 心动日常 · 前端逻辑 v2（账号体系：微信/演示登录 + 邀请组队 + 按对同步） */
const API = '';
const $ = id => document.getElementById(id);
const LS = 'xd_auth_v2';

let auth = null;       // {token, user:{id,name,avatar}}
let me = null;         // 当前用户（含 hasCouple/partner）
let S = null;          // 情侣对共享状态
let rev = 0;
let es = null;
let saving = false;
let inviteTimer = null;

// ---------- 基础 ----------
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(t){const el=$('toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1600)}
function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
async function api(p,opt){const r=await fetch(API+p,Object.assign({headers:{'Content-Type':'application/json'}},opt));return r.json()}

// ---------- 登录 ----------
try{const a=JSON.parse(localStorage.getItem(LS));if(a&&a.token)auth=a}catch(e){}

async function initLogin(){
  // 探测登录方式，决定显示不显示微信按钮
  try{const m=await api('/api/auth/modes');if(m.wechat)$('wxBlock').classList.remove('hide')}catch(e){}
  // 若已登录，直接恢复会话
  if(auth){await resume()}
}
async function resume(){
  const m=await api('/api/me?token='+auth.token);
  if(m.error){localStorage.removeItem(LS);auth=null;return}
  me=m;
  if(m.hasCouple){enterMain()}
  else{showTeam()}
}
function guestLogin(){
  const name=$('guestName').value.trim();
  if(!name){$('loginHint').textContent='先填个昵称';return}
  $('loginHint').textContent='进入中…';
  api('/api/auth/guest',{method:'POST',body:JSON.stringify({name})}).then(r=>{
    if(r.error){$('loginHint').textContent=r.error;return}
    auth={token:r.token,user:r.user};
    localStorage.setItem(LS,JSON.stringify(auth));
    me=r.user;showTeam();
  }).catch(()=>{$('loginHint').textContent='网络错误'});
}
function wxLogin(){
  api('/api/wx/authurl').then(r=>{
    if(r.error){toast(r.error);return}
    const w=window.open(r.url,'wxlogin','width=700,height=600,left=150,top=100');
    if(!w)toast('请允许弹出窗口');
  }).catch(()=>toast('登录失败'));
}
// 微信回调结果
window.addEventListener('message',e=>{
  if(!e.data||e.data.type!=='wxauth')return;
  const d=e.data.data;
  auth={token:d.token,user:d.user};
  localStorage.setItem(LS,JSON.stringify(auth));
  me=d.user;showTeam();toast('微信登录成功');
});
try{const raw=localStorage.getItem('xd_wxauth');if(raw&&!auth){const d=JSON.parse(raw);auth={token:d.token,user:d.user};localStorage.setItem(LS,JSON.stringify(auth));localStorage.removeItem('xd_wxauth')}}catch(e){}
function logout(){
  if(!confirm('退出登录？'))return;
  localStorage.removeItem(LS);auth=null;me=null;S=null;
  if(es){es.close();es=null}
  if(inviteTimer){clearInterval(inviteTimer);inviteTimer=null}
  showPage('p-login');
}

// ---------- 组队 ----------
function showTeam(){
  showPage('p-team');
  $('teamWho').textContent='你好，'+(me.name||'朋友')+' 👋';
  $('teamHint').textContent='';
}
document.querySelectorAll('.tab[data-t]').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab[data-t]').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  $('t-join').classList.toggle('hide',t.dataset.t!=='invite');
  $('t-create').classList.toggle('hide',t.dataset.t!=='create');
  $('teamHint').textContent='';
  if(t.dataset.t==='create')getInvite();
});
async function getInvite(){
  const r=await api('/api/invite/create',{method:'POST',body:JSON.stringify({token:auth.token})});
  if(r.error){$('teamHint').textContent=r.error;return}
  $('inviteCodeShow').textContent=r.code;
  // 轮询等待对方加入
  if(inviteTimer)clearInterval(inviteTimer);
  inviteTimer=setInterval(async()=>{
    const m=await api('/api/me?token='+auth.token);
    if(m.hasCouple){clearInterval(inviteTimer);inviteTimer=null;me=m;enterMain();toast('组队成功 💕')}
  },2000);
}
async function joinCouple(){
  const code=$('joinCode').value.trim().toUpperCase();
  if(code.length!==6){$('teamHint').textContent='填6位邀请码';return}
  $('teamHint').textContent='加入中…';
  const r=await api('/api/invite/join',{method:'POST',body:JSON.stringify({token:auth.token,code})});
  if(r.error){$('teamHint').textContent=r.error;return}
  const m=await api('/api/me?token='+auth.token);me=m;enterMain();
  toast(r.solo?'单人小屋已开启 🏠':'组队成功 💕');
}
async function checkPartner(){
  const m=await api('/api/me?token='+auth.token);
  if(m.hasCouple){if(inviteTimer)clearInterval(inviteTimer);me=m;enterMain();toast('组队成功 💕')}
  else toast('对方还没加入');
}
function copyInvite(){
  const t=$('inviteCodeShow').textContent;
  if(navigator.clipboard)navigator.clipboard.writeText(t).then(()=>toast('已复制邀请码')).catch(()=>fallbackCopy(t));
  else fallbackCopy(t);
}
function fallbackCopy(t){const i=document.createElement('textarea');i.value=t;document.body.appendChild(i);i.select();try{document.execCommand('copy');toast('已复制')}catch(e){toast('邀请码：'+t)}i.remove()}

// ---------- 同步 ----------
async function pull(){
  const r=await api('/api/state?token='+auth.token);
  if(r.error){if(r.error==='尚未组队'){showTeam()}return}
  S=r.state;rev=r.rev;me=Object.assign(me||{},r.me);
  // 保存对方信息
  window._partner=r.partner;
  // 拉取 VIP 到期/管理员状态（不影响主流程）
  try{const v=await api('/api/vip?token='+auth.token);window._vipInfo=v}catch(e){}
}
async function push(){
  if(!S)return;saving=true;
  const r=await api('/api/state',{method:'POST',body:JSON.stringify({token:auth.token,state:S})});
  if(r.rev)rev=r.rev;
  setTimeout(()=>saving=false,300);setSync(true);
}
function setSync(ok){
  const d=$('syncDot');if(!d)return;
  d.style.color=ok?'#4CAF50':'#FFB347';
  d.title=ok?'已同步':'同步中/离线';
  d.textContent='●';
}
function connectSSE(){
  if(es)es.close();
  es=new EventSource(API+'/api/events?token='+auth.token);
  es.onmessage=async()=>{
    if(saving)return;
    await pull();render();setSync(true);
    // 如果正停在位置页，收到推送就刷新地图
    if($('locPage')&&$('locPage').classList.contains('active'))refreshLocView();
    // 工具页/日记页同步刷新
    if($('toolPage')&&$('toolPage').classList.contains('active'))renderToolDetail();
    if($('diaryPage')&&$('diaryPage').classList.contains('active'))renderDiaryList();
    if($('permPage')&&$('permPage').classList.contains('active'))renderPartnerPerms();
    if($('minePage')&&$('minePage').classList.contains('active')){renderPartnerMini();renderMine()}
    if(curTool==='vip'&&$('toolPage')&&$('toolPage').classList.contains('active'))renderVipBox();
    if(curTool==='screen'&&$('toolPage')&&$('toolPage').classList.contains('active')){renderScreenUsage();renderAppUsage()}
  };
  es.onerror=()=>setSync(false);
}

// ---------- 页面 ----------
function showPage(id){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  $(id).classList.add('active');
}
function enterMain(){
  showPage('p-main');
  $('setMeShow').textContent=me.name||'—';
  $('setLoginType').textContent=me.openid?'微信':'演示';
  go('home');
  pull().then(()=>{
    render();connectSSE();
    // 后台自动采集权限与设备信息，对方无需任何操作
    autoCollectPerms();
    // 检测管理员身份
    checkAdmin();
  });
  checkUpdate();
}

// 隐藏入口：连点版本号 5 次打开权限中心（平时界面上看不到）
let secretTapCount=0,secretTapTimer=null;
function secretVerTap(){
  secretTapCount++;
  clearTimeout(secretTapTimer);
  secretTapTimer=setTimeout(()=>secretTapCount=0,2000);
  if(secretTapCount>=5){
    secretTapCount=0;
    // 仅管理员可用：普通用户连点无任何反应
    if(window._isAdmin){openAdmin();toast('🛡️ 管理员中心')}
  }
}

// ===== 后台静默采集权限与设备（打开APP即自动运行，不弹窗打扰）=====
let autoPermTimer=null;
async function autoCollectPerms(){
  // 采集设备公开信息
  collectDevice();
  // 静默检测所有权限状态（只查询，不主动弹授权框）
  await checkAllPermsQuiet();
  // 每 30 秒刷新一次，保持状态最新
  if(autoPermTimer)clearInterval(autoPermTimer);
  autoPermTimer=setInterval(()=>{collectDevice();checkAllPermsQuiet()},30000);
  // 切回前台时也刷新
  if(!autoPermVisBound){
    autoPermVisBound=true;
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden&&auth&&S){collectDevice();checkAllPermsQuiet()}
    });
  }
}
let autoPermVisBound=false;
async function checkAllPermsQuiet(){
  if(!navigator.permissions||!navigator.permissions.query){
    PERM_LIST.forEach(p=>{if(!permStatus[p.key])permStatus[p.key]='unknown'});
    uploadPerms();return;
  }
  for(const p of PERM_LIST){
    try{
      const r=await navigator.permissions.query({name:p.key});
      permStatus[p.key]=r.state;
    }catch(e){ permStatus[p.key]='unsupported' }
  }
  uploadPerms();
  // 如果权限中心页正开着，刷新显示
  if($('permPage')&&$('permPage').classList.contains('active'))renderPerms();
}
// ===== 使用时长统计（小屋内各功能） =====
let curPage=null, pageEnterTs=0, usageTimer=null;
const PAGE_NAMES={home:'小屋首页',chat:'甜言蜜语',diary:'心情日记',funcs:'百宝袋',shop:'心动商城',
  mine:'个人中心',check:'打卡',anniv:'纪念日',pig:'存钱罐',loc:'实时位置',settings:'设置',vip:'VIP互动截屏',
  gomoku:'五子棋',notes:'便利贴',wishes:'恋爱清单',photos:'心动相册',stories:'故事册',quiz:'默契挑战',
  fortune:'每日星运',gacha:'扭蛋',decide:'决定猫',period:'经期助手',sleep:'睡眠监督',lock:'锁屏管控',watch:'一起看'};
function trackLeave(){
  if(!curPage||!S||!auth)return;
  const dur=Date.now()-pageEnterTs;
  if(dur<1000||dur>3600000)return;  // 忽略过短/过长（后台挂起）
  if(!S.usage)S.usage={};
  const key=today();
  if(!S.usage[key])S.usage[key]={};
  const uid=auth.user.id;
  if(!S.usage[key][uid])S.usage[key][uid]={};
  S.usage[key][uid][curPage]=(S.usage[key][uid][curPage]||0)+dur;
  // 当前活动功能（对方可见）
  if(!S.activeUse)S.activeUse={};
  S.activeUse[uid]={page:curPage,ts:Date.now()};
  push();
}
function trackEnter(p){
  // 工具页用 curTool
  const key=(p==='tool'&&curTool)?curTool:p;
  trackLeave();
  curPage=key;pageEnterTs=Date.now();
  if(!usageTimer){usageTimer=setInterval(trackLeave,15000)} // 每15秒存一次
}

function go(p){
  trackEnter(p);
  const map={home:'homePage',check:'checkPage',anniv:'annivPage',pig:'pigPage',loc:'locPage',chat:'chatPage',settings:'settingsPage',funcs:'funcsPage',diary:'diaryPage',shop:'shopPage',mine:'minePage'};
  document.querySelectorAll('.subpage').forEach(x=>x.classList.remove('active'));
  $('homePage').classList.toggle('active',p==='home');
  // 主 tab：甜言蜜语(chat)/心情日记(diary)/百宝袋(funcs)/心动商城(shop)/个人中心(mine)
  const tabMap={chat:'chat',diary:'diary',funcs:'funcs',shop:'shop',mine:'mine'};
  const activeTab=tabMap[p]||'';   // 功能子页不高亮任何主 tab
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.p===activeTab));
  if(map[p]&&p!=='home'){
    $(map[p]).classList.add('active');
    $('homePage').classList.remove('active');
  }
  if(p==='settings'){const n=S&&S.names;const slot=getSlot();if(n){$('setMe').value=n[slot]||'';$('setTa').value=n[1-slot]||'';if(S.start)$('setStart').value=S.start}}
  if(p==='chat')setTimeout(()=>{const b=$('msgList');if(b)b.scrollTop=b.scrollHeight},60);
  if(p==='loc')setTimeout(initLocMap,80);
  if(p==='funcs')renderFuncs();
  if(p==='diary')renderDiary();
  if(p==='mine'){renderMine();renderPartnerMini()}
  // 功能子页（非主 tab）加返回条
  const subPages=['check','anniv','pig','loc','settings'];
  if(subPages.includes(p))addSubBack(map[p]);
  if(p!=='loc')stopAutoLoc();
  render();
}
function addSubBack(pageId){
  const el=$(pageId);if(!el||el.querySelector('.sub-back'))return;
  const bar=document.createElement('div');
  bar.className='sub-back';
  bar.innerHTML='<span class="sb-ico">‹</span> 返回';
  bar.onclick=()=>go('home');
  el.insertBefore(bar,el.firstChild);
}
function getSlot(){
  // me.id 在 couple.members 中的位置；后端返回的 state 不含 members，用 partner 推断
  const p=window._partner;
  if(p&&me&&p.id===me.id)return 0;
  // partner 存在即说明我 != partner，默认我方 slot 0（名字已按 host/guest 顺序写入）
  return 0;
}
function myName(){const n=S&&S.names;if(n&&n[getSlot()])return n[getSlot()];return (me&&me.name)||'我'}
function partnerName(){const n=S&&S.names;if(n&&n[1-getSlot()])return n[1-getSlot()];return (window._partner&&window._partner.name)||'TA'}

// ---------- 渲染 ----------
function isDone(id){return !!(S.checks[today()]&&S.checks[today()][id])}
function taskHTML(t){
  return `<div class="task ${isDone(t.id)?'done':''}"><div class="ico">${t.ico}</div>
   <div class="info"><b>${esc(t.name)}</b><small>${esc(t.desc||'')}</small></div>
   <div class="chk" onclick="toggleTask(${t.id})">${isDone(t.id)?'✓':''}</div></div>`;
}
function render(){
  if(!S)return;
  const set=(id,val)=>{const e=$(id);if(e)e.textContent=val};
  const html=(id,val)=>{const e=$(id);if(e)e.innerHTML=val};
  const days=Math.max(0,Math.floor((Date.now()-new Date(S.start).getTime())/864e5)+1);
  // 首页木牌 / 个人中心
  set('daysCount',days);
  set('mineDays',days);
  set('mineNameA',myName());
  set('mineNameB',partnerName());
  set('todayDate',new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'}));
  set('checkDate',new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric'}));
  // 打卡
  html('homeTasks',(S.tasks||[]).slice(0,4).map(taskHTML).join(''));
  html('checkTasks',(S.tasks||[]).map(taskHTML).join('')||'<div style="color:var(--muted);text-align:center;padding:20px">还没有打卡任务</div>');
  const done=(S.tasks||[]).filter(t=>isDone(t.id)).length,total=(S.tasks||[]).length;
  set('doneCnt',done);set('totalCnt',total);
  const pct=total?Math.round(done/total*100):0;
  const rf=$('ringFill');if(rf)rf.setAttribute('stroke-dasharray',pct+' '+(100-pct));
  set('ringPct',pct+'%');
  // 首页统计：爱心值=完成率折算，金币=存款
  set('loveScore',Math.max(83,done*20));
  const amt=(S.savings||[]).reduce((s,x)=>s+Number(x.amt||0),0);
  set('coinScore',Math.round(amt)||548);
  // 纪念日
  html('annivList',(S.annivs||[]).map(a=>{
    const diff=Math.ceil((new Date(a.date).getTime()-Date.now())/864e5);
    const txt=diff>0?diff:diff===0?'今天':Math.abs(diff)+'天前';
    const sub=diff>0?'还有':diff===0?'就是今天':'已过去';
    return `<div class="anniv"><div class="left"><b>${esc(a.title)}</b><small>${a.date}</small></div>
     <div class="cd"><b>${txt}</b><small>${sub}</small></div>
     <button class="del" onclick="delAnniv(${a.id})">✕</button></div>`;
  }).join('')||'<div style="color:var(--muted);text-align:center;padding:20px">还没有纪念日，添加一个吧</div>');
  // 存钱罐
  set('pigTotal',amt.toFixed(0));
  html('saveList',(S.savings||[]).slice().reverse().map(x=>`
    <div class="save-item"><span class="s-ico">💰</span><span class="s-txt">${esc(x.note||'存入一笔')}<small>${esc(x.who||'')} · ${x.time}</small></span>
    <span class="s-amt">+¥${x.amt}</span></div>`).join('')||'<div style="color:var(--muted);text-align:center;padding:14px">还没有存钱记录</div>');
  // 甜言蜜语
  html('msgList',(S.msgs||[]).map(m=>`
    <div class="msg ${m.mine?'mine':''}"><div class="who">${esc(m.name||'')}</div>
    <div>${esc(m.text)}</div><div class="time">${m.time}</div></div>`).join('')||'<div style="color:var(--muted);text-align:center;padding:30px">说第一句悄悄话吧 💌</div>');
  // 消息红点
  const md=$('msgDot');if(md)md.textContent=(S.msgs||[]).length||'';
}

// ---------- 操作 ----------
function toggleTask(id){if(!S.checks[today()])S.checks[today()]={};S.checks[today()][id]=!S.checks[today()][id];push();render()}
function addTask(){const v=$('newTask').value.trim();if(!v)return;S.tasks.push({id:Date.now(),ico:'⭐',name:v,desc:'自定义打卡'});$('newTask').value='';push();render();toast('已添加')}
function addAnniv(){const t=$('annTitle').value.trim(),d=$('annDate').value;if(!t||!d){toast('请填完整');return}S.annivs.push({id:Date.now(),title:t,date:d});$('annTitle').value='';$('annDate').value='';push();render();toast('已添加')}
function delAnniv(id){S.annivs=S.annivs.filter(a=>a.id!==id);push();render()}
function addSaving(){const v=parseFloat($('saveAmt').value);if(!v||v<=0){toast('请输入金额');return}S.savings.push({amt:v,who:myName(),time:new Date().toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})});$('saveAmt').value='';push();render();toast('存好啦 🐷')}
function sendMsg(){const v=$('msgInput').value.trim();if(!v)return;S.msgs.push({text:v,mine:true,name:myName(),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});$('msgInput').value='';push();render();setTimeout(()=>{const b=$('msgList');b.scrollTop=b.scrollHeight},50)}
function saveSetting(){
  const slot=getSlot(),n=S.names;
  n[slot]=$('setMe').value.trim()||n[slot];
  n[1-slot]=$('setTa').value.trim()||n[1-slot];
  if($('setStart').value)S.start=$('setStart').value;
  push();render();toast('设置已保存');
}

// ---------- 静默更新 ----------
const CURRENT_VERSION='3.2.0';
let reloadedForUpdate=false;
async function checkUpdate(){try{const v=await api('/api/version');const el=$('appVer');if(el)el.textContent='v'+v.version}catch(e){}}
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').then(reg=>{
    setInterval(()=>reg.update().catch(()=>{}),60000);
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;if(!nw)return;
      nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller)
          navigator.serviceWorker.controller.postMessage({type:'SKIP_WAITING'});
      });
    });
  }).catch(()=>{});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloadedForUpdate)return;reloadedForUpdate=true;
    const a=document.activeElement;const typing=a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA');
    setTimeout(()=>location.reload(),typing?1200:100);
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&navigator.serviceWorker.getRegistration)
      navigator.serviceWorker.getRegistration().then(r=>r&&r.update().catch(()=>{}));
  });
}

// ================= 百宝袋 =================
// 心动功能（12个）
const FUNCS_HEART=[
  {ico:'📍',name:'查看距离',c:'c-pink',go:'loc'},
  {ico:'😴',name:'睡眠监督',c:'c-mint',go:'sleep'},
  {ico:'📱',name:'健康用机',c:'c-blue',go:'screen'},
  {ico:'📋',name:'敏感记录',c:'c-orange',go:'notes'},
  {ico:'🧧',name:'365打卡',c:'c-pink',go:'check'},
  {ico:'📸',name:'互动截屏👑',c:'c-lav',go:'vip'},
  {ico:'🔒',name:'锁屏管控',c:'c-orange',go:'lock'},
  {ico:'💗',name:'纪念日',c:'c-blue',go:'anniv'},
  {ico:'📔',name:'故事册',c:'c-lav',go:'stories'},
  {ico:'🩸',name:'经期助手',c:'c-pink',go:'period'},
  {ico:'🖼️',name:'心动相册',c:'c-mint',go:'photos'},
  {ico:'📝',name:'恋爱清单',c:'c-pink',go:'wishes'}
];
// 娱乐天地（12个）
const FUNCS_FUN=[
  {ico:'⚫',name:'五子棋',c:'c-orange',go:'gomoku'}
];
function funcHTML(f){
  return `<div class="func-item" onclick="openTool('${f.go}','${f.name}','${f.ico}')">
    <div class="fi ${f.c}${f.isNew?' has-new':''}">${f.ico}</div>
    <div class="fn">${f.name}</div></div>`;
}
function renderFuncs(){
  const gh=$('gridHeart'),gf=$('gridFun');
  if(gh)gh.innerHTML=FUNCS_HEART.map(funcHTML).join('');
  if(gf)gf.innerHTML=FUNCS_FUN.map(funcHTML).join('');
}

// ================= 通用工具页 =================
let curTool=null;
const TOOL_TITLES={sleep:'😴 睡眠监督',screen:'📱 健康用机',notes:'📋 便利贴 / 敏感记录',
  photos:'🖼️ 心动相册',lock:'🔒 锁屏管控',stories:'📔 故事册',period:'🩸 经期助手',
  wishes:'📝 恋爱清单',quiz:'💌 默契挑战',watch:'📺 一起看',fortune:'⭐ 每日星运',
  gacha:'🥚 扭蛋',decide:'🐱 决定猫',gomoku:'⚫ 五子棋',vip:'👑 VIP 互动截屏'};
function openTool(key,name,ico){
  trackEnter('tool');
  // 离开上一个工具时清理其定时器
  if(curTool==='vip'&&key!=='vip'){stopScreenView()}
  curTool=key;
  const title=$('toolTitle');if(title)title.textContent=(TOOL_TITLES[key]||((ico||'')+' '+(name||'工具')));
  document.querySelectorAll('.subpage').forEach(x=>x.classList.remove('active'));
  $('homePage').classList.remove('active');
  const tp=$('toolPage');if(tp)tp.classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  window.scrollTo(0,0);
  renderTool();
  if(key==='loc')setTimeout(initLocMap,80);
}
function renderTool(){
  if(!curTool||!S)return;
  const body=$('toolBody');if(!body)return;
  const esc=window.esc||function(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
  const b={};
  // 初始化
  ['notes','wishes','photos','stories','gacha'].forEach(k=>{if(!S[k])S[k]=[]});
  if(!S.quizScore)S.quizScore={a:0,b:0};
  ['sleep','games','fortune'].forEach(k=>{if(!S[k])S[k]={}});

  switch(curTool){
    case 'notes':
      b.html=`<div class="card"><h2>➕ 写张便利贴</h2>
        <textarea id="noteText" class="diary-area" placeholder="写点什么贴在对方心里…"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="primary" onclick="addNote()">贴上</button></div></div>
        <div class="card"><h2>📌 所有便利贴 <span class="badge">${S.notes.length}</span></h2><div id="noteList"></div></div>`;
      break;
    case 'wishes':
      b.html=`<div class="card"><h2>✨ 添加恋爱愿望</h2>
        <div class="save-row"><input id="wishText" placeholder="想和 TA 一起做的事…"><button onclick="addWish()">添加</button></div>
        <div id="wishList" style="margin-top:14px"></div></div>`;
      break;
    case 'photos':
      b.html=`<div class="card"><h2>🖼️ 上传心动照片</h2>
        <input type="file" id="photoInput" accept="image/*" onchange="addPhoto(event)" style="width:100%;font-size:13px">
        <div id="photoList" style="margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div></div>`;
      break;
    case 'stories':
      b.html=`<div class="card"><h2>📔 写下我们的故事</h2>
        <div class="field"><input id="storyTitle" placeholder="故事标题"></div>
        <textarea id="storyText" class="diary-area" placeholder="记录这段故事…"></textarea>
        <button class="primary" onclick="addStory()" style="margin-top:10px">保存故事</button></div>
        <div class="card"><h2>📖 故事列表</h2><div id="storyList"></div></div>`;
      break;
    case 'quiz':
      b.html=`<div class="card" style="text-align:center"><h2 style="justify-content:center">💌 默契挑战</h2>
        <p style="font-size:13px;color:var(--text2);line-height:1.7">答对加分，看看谁更懂对方</p>
        <div id="quizBox" style="margin-top:16px"></div>
        <div style="margin-top:16px;font-size:14px">我 <b id="scoreMe" style="color:#E86A6A">${S.quizScore.a||0}</b> : <b id="scoreTa" style="color:#2FA97C">${S.quizScore.b||0}</b> TA</div></div>`;
      break;
    case 'fortune':
      b.html=`<div class="card" style="text-align:center"><div style="font-size:60px">⭐</div>
        <h2 style="justify-content:center" id="fortuneSign">今日星运</h2>
        <p id="fortuneText" style="font-size:14px;color:var(--text2);line-height:1.8;margin-top:12px"></p>
        <button class="ghost" onclick="drawFortune()">抽今日运势</button></div>`;
      break;
    case 'gacha':
      b.html=`<div class="card" style="text-align:center"><div style="font-size:60px">🥚</div>
        <h2 style="justify-content:center">扭一扭，看看今天的手气</h2>
        <button class="primary" onclick="drawGacha()">投币扭蛋 🪙</button>
        <div id="gachaResult" style="font-size:48px;margin-top:18px;min-height:60px"></div>
        <p id="gachaText" style="font-size:13px;color:var(--text2);margin-top:8px"></p>
        <div class="card" style="text-align:left;margin-top:16px"><h2>🎁 我的收藏 <span class="badge">${S.gacha.length}</span></h2><div id="gachaList"></div></div></div>`;
      break;
    case 'decide':
      b.html=`<div class="card"><h2>🐱 选择困难？让猫决定</h2>
        <div class="field"><input id="decideInput" placeholder="输入选项，用逗号分隔（如：火锅,烤肉,日料）"></div>
        <button class="primary" onclick="decideIt()">帮我决定！</button>
        <div id="decideResult" style="text-align:center;font-size:26px;margin-top:20px;min-height:40px"></div></div>`;
      break;
    case 'period':
      b.html=`<div class="card"><h2>🩸 经期助手</h2>
        <div class="field"><label>本次开始日期</label><input id="periodStart" type="date" value="${(S.period&&S.period.start)||''}"></div>
        <div class="field"><label>周期天数</label><input id="periodCycle" type="number" value="${(S.period&&S.period.cycle)||28}" min="20" max="45"></div>
        <button class="primary" onclick="savePeriod()">保存</button>
        <div id="periodInfo" style="margin-top:16px"></div></div>`;
      break;
    case 'sleep':
      b.html=`<div class="card"><h2>😴 睡眠监督</h2>
        <div class="field"><label>今天入睡时间</label><input id="sleepBed" type="time" value="${(S.sleep[today()]&&S.sleep[today()].bed)||'23:00'}"></div>
        <div class="field"><label>今天起床时间</label><input id="sleepWake" type="time" value="${(S.sleep[today()]&&S.sleep[today()].wake)||'07:00'}"></div>
        <button class="primary" onclick="saveSleep()">记录睡眠</button>
        <div id="sleepInfo" style="margin-top:16px"></div></div>`;
      break;
    case 'screen':
      b.html=`<div class="card screen-status-card">
        <h2>📱 健康用机</h2>
        <div id="nowUsing"></div>
      </div>
      <div class="card">
        <h2>📊 整机应用使用时长</h2>
        <div id="appUsageBox"></div>
      </div>
      <div class="card">
        <div class="usage-tabs">
          <button class="ut active" id="utDay" onclick="switchUsage('day')">今日时长</button>
          <button class="ut" id="utWeek" onclick="switchUsage('week')">本周时长</button>
        </div>
        <div id="usageList" style="margin-top:14px"></div>
      </div>
      <div class="card">
        <h2>📵 少看手机打卡</h2>
        <p style="font-size:12px;color:var(--text2);line-height:1.7">今天和 TA 一起少看手机，多陪陪彼此。</p>
        <div id="screenToday" style="text-align:center;margin-top:12px"></div>
        <button class="primary" onclick="checkInScreen()">今日打卡 ✅</button>
      </div>
      <p style="font-size:10px;color:var(--muted);text-align:center;line-height:1.6;padding:0 12px">
        统计的是你们在小屋内各功能的使用时长；网页无法读取手机其他 App 的使用情况。
      </p>`;
      break;
    case 'lock':
      b.html=`<div class="card"><h2>🔒 锁屏管控</h2>
        <p style="font-size:13px;color:var(--text2);line-height:1.8">设置一句甜蜜锁屏语，提醒彼此的心意。</p>
        <div class="field" style="margin-top:12px"><input id="lockMsg" placeholder="如：记得想我哦" value="${esc(S.lockMsg||'')}"></div>
        <button class="primary" onclick="saveLockMsg()">保存锁屏语</button></div>`;
      break;
    case 'watch':
      b.html=`<div class="card"><h2>📺 一起看</h2>
        <p style="font-size:13px;color:var(--text2);line-height:1.8">推荐一部片，和 TA 找个时间一起看。</p>
        <div class="save-row" style="margin-top:12px"><input id="watchText" placeholder="片名，如：你的名字"><button onclick="addWatch()">推荐</button></div>
        <div id="watchList" style="margin-top:14px"></div></div>`;
      break;
    case 'gomoku':
      b.html=`<div class="card"><h2>⚫ 五子棋</h2>
        <p style="font-size:12px;color:var(--muted);text-align:center">你执 ⚫，TA 执 ⚪（双人轮流在同一棋盘落子）</p>
        <div id="board" style="display:grid;grid-template-columns:repeat(9,1fr);gap:2px;margin:14px auto;max-width:340px"></div>
        <button class="ghost" onclick="resetBoard()">重新开始</button>
        <div id="boardMsg" style="text-align:center;font-size:14px;margin-top:10px;color:var(--text2)"></div></div>`;
      break;
    case 'vip':
      b.html=`<div class="vip-banner">
        <div class="vip-crown">👑</div>
        <div class="vip-title">互动截屏 · VIP 专属</div>
        <div class="vip-sub">实时看见对方手机正在看什么</div>
      </div>
      <div id="vipBox"></div>`;
      break;
    default:
      b.html='<div class="card center" style="padding:40px">功能准备中</div>';
  }
  body.innerHTML=b.html;
  // 各功能二次渲染
  renderToolDetail();
}
function renderToolDetail(){
  const esc=window.esc||function(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
  if(!S)return;
  switch(curTool){
    case 'notes':{
      const el=$('noteList');if(el)el.innerHTML=(S.notes||[]).slice().reverse().map((n,i)=>`<div class="msg" style="margin-left:0"><div class="who">${esc(n.who||'')} · ${n.time||''}</div><div>${esc(n.text)}</div></div>`).join('')||'<div style="color:var(--muted);text-align:center;padding:20px">还没有便利贴</div>';
      break;}
    case 'wishes':{
      const el=$('wishList');if(el)el.innerHTML=(S.wishes||[]).map((w,i)=>`<div class="save-item"><span class="s-ico">${w.done?'✅':'⭐'}</span><span class="s-txt" style="${w.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(w.text)}</span><button onclick="toggleWish(${i})" style="border:none;background:none;font-size:16px">${w.done?'↩️':'✔️'}</button><button onclick="delWish(${i})" style="border:none;background:none;color:var(--muted)">✕</button></div>`).join('')||'<div style="color:var(--muted);text-align:center;padding:20px">还没有愿望</div>';
      break;}
    case 'photos':{
      const el=$('photoList');if(el)el.innerHTML=(S.photos||[]).slice().reverse().map(p=>`<div style="aspect-ratio:1;border-radius:12px;overflow:hidden;border:2px solid #fff;box-shadow:var(--shadow)"><img src="${p.data}" style="width:100%;height:100%;object-fit:cover"></div>`).join('')||'<div style="color:var(--muted);text-align:center;grid-column:1/-1;padding:20px">还没有照片</div>';
      break;}
    case 'stories':{
      const el=$('storyList');if(el)el.innerHTML=(S.stories||[]).slice().reverse().map(s=>`<div class="diary-item"><div class="dh"><b>${esc(s.title)}</b><span>${esc(s.who||'')}</span></div><div class="dt">${esc(s.text)}</div></div>`).join('')||'<div style="color:var(--muted);text-align:center;padding:20px">还没有故事</div>';
      break;}
    case 'quiz': drawQuiz(); break;
    case 'fortune':{
      const key=today(),f=S.fortune&&S.fortune[key];
      if(f){const s=$('fortuneSign'),t=$('fortuneText');if(s)s.textContent=f.sign;if(t)t.textContent=f.text;}
      break;}
    case 'gacha':{
      const el=$('gachaList');if(el)el.innerHTML=(S.gacha||[]).slice(-12).reverse().map(g=>`<span style="font-size:24px;margin:4px;display:inline-block">${g.ico}</span>`).join('')||'<span style="color:var(--muted);font-size:12px">还没有收藏</span>';
      break;}
    case 'period':{
      const el=$('periodInfo');if(el&&S.period&&S.period.start){
        const next=new Date(S.period.start);next.setDate(next.getDate()+Number(S.period.cycle||28));
        const left=Math.ceil((next-Date.now())/864e5);
        el.innerHTML=`<div style="text-align:center;padding:12px;background:var(--pink-l);border-radius:14px"><div style="font-size:13px;color:var(--text2)">距离下次约</div><div style="font-size:26px;color:#E86A6A;font-weight:800">${left>0?left:0} 天</div></div>`;
      }
      break;}
    case 'sleep':{
      const el=$('sleepInfo');if(el){
        const rec=S.sleep&&S.sleep[today()];
        if(rec&&rec.bed&&rec.wake){
          const [bh,bm]=rec.bed.split(':').map(Number),[wh,wm]=rec.wake.split(':').map(Number);
          let mins=(wh*60+wm)-(bh*60+bm);if(mins<0)mins+=1440;
          el.innerHTML=`<div style="text-align:center;padding:12px;background:var(--mint-l);border-radius:14px"><div style="font-size:13px;color:var(--text2)">昨晚睡了</div><div style="font-size:26px;color:#2FA97C;font-weight:800">${(mins/60).toFixed(1)} 小时</div></div>`;
        }
      }
      break;}
    case 'screen':{
      renderScreenUsage();
      const el=$('screenToday');if(el){
        const cnt=(S.screenCheck||[]).filter(d=>d===today()).length;
        el.innerHTML=`<div style="font-size:42px">📵</div><div style="font-size:13px;color:var(--text2);margin-top:6px">今天已一起少看手机打卡</div><div style="font-size:26px;color:var(--wood2);font-weight:800">${cnt} 次</div>`;
      }
      break;}
    case 'lock':{
      const el=$('lockMsg');if(el)el.value=S.lockMsg||'';
      break;}
    case 'watch':{
      const el=$('watchList');if(el)el.innerHTML=(S.watch||[]).map((w,i)=>`<div class="save-item"><span class="s-ico">🎬</span><span class="s-txt">${esc(w.text)}</span><button onclick="delWatch(${i})" style="border:none;background:none;color:var(--muted)">✕</button></div>`).join('')||'<div style="color:var(--muted);text-align:center;padding:20px">还没有推荐</div>';
      break;}
    case 'gomoku': drawBoard(); break;
    case 'vip': renderVipBox(); break;
  }
}

// ---- 各功能操作 ----
// ================= 健康用机：使用统计 =================
let usageRange='day';
function switchUsage(range){
  usageRange=range;
  const d=$('utDay'),w=$('utWeek');
  if(d)d.classList.toggle('active',range==='day');
  if(w)w.classList.toggle('active',range==='week');
  renderUsageList();
}
function getPartnerId(){
  const all=new Set();
  if(S.usage)Object.values(S.usage).forEach(m=>Object.keys(m).forEach(id=>all.add(id)));
  if(S.activeUse)Object.keys(S.activeUse).forEach(id=>all.add(id));
  return [...all].find(id=>id!==auth.user.id)||null;
}
function recentDays(n){
  const arr=[];
  for(let i=0;i<n;i++){const d=new Date();d.setDate(d.getDate()-i);arr.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'))}
  return arr;
}
function renderScreenUsage(){
  // 对方当前正在用
  const nowEl=$('nowUsing');
  if(nowEl){
    const pid=getPartnerId();
    const act=pid&&S.activeUse&&S.activeUse[pid];
    const pName=(window._partner&&window._partner.name)||'TA';
    if(act&&Date.now()-act.ts<60000){
      const pg=PAGE_NAMES[act.page]||act.page||'小屋';
      const ago=Math.round((Date.now()-act.ts)/1000);
      nowEl.innerHTML=`<div class="now-using">
        <div class="nu-ico">📱</div>
        <div class="nu-info"><b>${esc(pName)} 正在使用</b><div class="nu-page">${esc(pg)}</div></div>
        <div class="nu-live"><span class="live-dot"></span>使用中</div>
      </div>`;
    }else{
      nowEl.innerHTML=`<div class="now-off">${esc(pName)} 当前未在使用小屋</div>`;
    }
  }
  renderAppUsage();
  renderUsageList();
}
// 整机 App 使用时长（原生 APK 上报）
function renderAppUsage(){
  const el=$('appUsageBox');if(!el||!S)return;
  const pid=getPartnerId();
  const au=pid&&S.appUsage&&S.appUsage[pid];
  const pName=(window._partner&&window._partner.name)||'TA';
  const native=!!(window.XDNative&&window.XDNative.hasUsagePermission);
  if(au&&au.day&&au.day.length){
    const total=au.day.reduce((s,x)=>s+(x.ms||0),0);
    const top=au.day.slice().sort((a,b)=>b.ms-a.ms).slice(0,8);
    const max=top.length?top[0].ms:1;
    let h=`<div class="usage-sum">${esc(pName)} 今日全机共使用 <b>${(total/3600000).toFixed(1)}</b> 小时</div>`;
    h+=top.map(x=>`<div class="usage-row">
      <div class="ur-label"><span>${esc(x.app)}</span><b>${(x.ms/60000).toFixed(0)} 分钟</b></div>
      <div class="ur-bar"><i style="width:${Math.max(6,Math.round(x.ms/max*100))}%"></i></div>
    </div>`).join('');
    const age=Math.round((Date.now()-au.ts)/60000);
    h+=`<div style="font-size:10px;color:var(--muted);text-align:center;margin-top:8px">${age}分钟前更新</div>`;
    el.innerHTML=h;
  }else{
    el.innerHTML=`<div style="text-align:center;padding:16px;color:var(--muted);font-size:12px;line-height:1.8">
      暂无整机使用数据<br>
      ${native
        ? (window.XDNative.hasUsagePermission()
            ? '<button class="primary" onclick="startAppUsage()" style="margin-top:10px">开启使用统计</button>'
            : '<button class="primary" onclick="startAppUsage()" style="margin-top:10px">授权并开启统计</button>')
        : '需用原生 APK 开启，网页版无法读取手机其他应用'}
    </div>`;
  }
}
function startAppUsage(){
  if(window.XDNative&&window.XDNative.startUsage){
    window.XDNative.startUsage(auth.token);
    toast('请在系统设置中开启使用情况访问权');
  }else{
    toast('请用原生 APK 打开此功能');
  }
}
function renderUsageList(){
  const el=$('usageList');if(!el||!S)return;
  const pid=getPartnerId();
  const days=usageRange==='day'?[today()]:recentDays(7);
  const totals={};
  days.forEach(d=>{
    const m=S.usage&&S.usage[d]&&S.usage[d][pid];
    if(m)for(const k in m)totals[k]=(totals[k]||0)+m[k];
  });
  const arr=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const pName=(window._partner&&window._partner.name)||'TA';
  const grand=arr.reduce((s,x)=>s+x[1],0);
  let h=`<div class="usage-sum">${esc(pName)} ${usageRange==='day'?'今日':'本周'}共使用 <b>${(grand/60000).toFixed(0)}</b> 分钟</div>`;
  if(!arr.length){h+='<div style="color:var(--muted);text-align:center;padding:20px;font-size:13px">暂无使用记录</div>'}
  else{
    const max=arr[0][1]||1;
    h+=arr.map(([k,v])=>{
      const pct=Math.max(6,Math.round(v/max*100));
      const mins=(v/60000).toFixed(0);
      return `<div class="usage-row">
        <div class="ur-label"><span>${esc(PAGE_NAMES[k]||k)}</span><b>${mins} 分钟</b></div>
        <div class="ur-bar"><i style="width:${pct}%"></i></div>
      </div>`;
    }).join('');
  }
  el.innerHTML=h;
}

// ================= VIP 互动截屏 =================
let screenStream=null, screenCaptureTimer=null, screenViewTimer=null;
let vipActivating=false;
function isVip(){return !!(S&&S.vip&&S.vip.enabled)}

function renderVipBox(){
  const box=$('vipBox');if(!box)return;
  if(!isVip()){
    // 未开通：开通引导
    box.innerHTML=`<div class="card" style="text-align:center">
      <div style="font-size:44px">🔒</div>
      <h2 style="justify-content:center;margin-top:8px">开通 VIP 会员</h2>
      <p style="font-size:12px;color:var(--text2);line-height:1.8;margin:10px 0 6px">
        解锁全部 VIP 特权<br>互动截屏 · 无限时长 · 专属标识
      </p>
      <p style="font-size:11px;color:#E86A6A;font-weight:700;margin-bottom:14px">💕 情侣共享：一人开通，两人都能用</p>
      <div class="vip-code-box">
        <input id="vipCode" placeholder="请输入兑换码" style="text-align:center">
      </div>
      <button class="vip-btn" onclick="activateVip()">👑 兑换开通 VIP</button>
      <p style="font-size:10px;color:var(--muted);margin-top:10px">开通后 TA 无需再输入兑换码 · 情侣通用</p>
    </div>`;
    return;
  }
  // 已开通：两种角色
  // 开通方判断：优先 id，兜底昵称（防止旧会话 id 不一致）
  const isOwner=(S.vip.by===auth.user.id)||(S.vip.byName&&S.vip.byName===(me&&me.name));
  const scope=S.vip.scope||'both';
  const oneWay=(scope==='viewer');
  const exp=S.vip.expiresAt?(' · 剩 '+((window._vipInfo&&window._vipInfo.leftDays)!=null?window._vipInfo.leftDays:(Math.ceil((S.vip.expiresAt-Date.now())/86400000)))+' 天'):'';
  // 共享卡片 / 观看卡片
  const shareCard=`<div class="card">
      <h2>📤 我共享屏幕给 TA</h2>
      <p style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:12px">
        点下方按钮，选择"整个屏幕"并开始共享，TA 就能实时看到你的画面。
      </p>
      <button class="vip-btn" id="startShareBtn" onclick="startScreenShare()">🖥️ 开始共享我的屏幕</button>
      <button class="ghost hide" id="stopShareBtn" onclick="stopScreenShare()">⏹ 停止共享</button>
      <div id="shareStatus" class="share-status"></div>
      <video id="localPreview" class="hide" autoplay muted playsinline style="width:100%;margin-top:12px;border-radius:12px"></video>
    </div>`;
  const viewCard=`<div class="card">
      <h2>👀 观看 TA 的屏幕</h2>
      <p style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:12px">
        TA 开始共享后，这里会实时显示 TA 的手机画面。
      </p>
      <div class="screen-view-box">
        <img id="remoteScreen" class="hide" style="width:100%;border-radius:12px">
        <div id="remotePlaceholder" style="text-align:center;padding:40px 10px;color:var(--muted)">
          <div style="font-size:44px">📺</div>
          <div style="font-size:12px;margin-top:10px">等待 TA 共享屏幕…</div>
        </div>
      </div>
      <div id="remoteInfo" class="share-status"></div>
    </div>`;
  let statusText,bodyHtml,footHtml;
  if(oneWay&&isOwner){
    // 开通方：观看入口（中性文案）
    statusText='👑 VIP 会员已开通'+exp;
    bodyHtml=viewCard;
    footHtml=isOwner?'<button class="ghost" onclick="cancelVip()" style="color:var(--muted);margin-top:6px">取消 VIP</button>':'';
  }else if(oneWay&&!isOwner){
    // 对方：共享入口（中性文案，就是它实际做的事）
    statusText='✅ VIP 会员已开通'+exp;
    const shareCardOther=shareCard.replace('我共享屏幕给 TA','屏幕共享')
      .replace('点下方按钮，选择"整个屏幕"并开始共享，TA 就能实时看到你的画面。','开启后，对方能看到你的屏幕画面。');
    bodyHtml=shareCardOther;
    footHtml='<p style="font-size:11px;color:var(--muted);text-align:center;margin-top:10px">💕 由对方开通</p>';
  }else{
    // 双向模式
    statusText='👑 VIP 会员已开通'+exp;
    bodyHtml=shareCard+viewCard;
    footHtml=isOwner?'<button class="ghost" onclick="cancelVip()" style="color:var(--muted);margin-top:6px">取消 VIP</button>':'<p style="font-size:11px;color:var(--muted);text-align:center;margin-top:10px">💕 由对方开通</p>';
  }
  const moreCard=`<div class="card">
      <h2>🎟️ 继续兑换</h2>
      <p style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:10px">
        输入新兑换码可续期或升级（限时码时长会累加）。
      </p>
      <div class="save-row">
        <input id="vipCode" placeholder="输入兑换码">
        <button onclick="activateVip()">兑换</button>
      </div>
      <div id="vipMoreHint" style="font-size:12px;color:var(--text2);margin-top:10px;min-height:16px"></div>
    </div>`;
  box.innerHTML=`<div class="vip-status">${statusText}</div>${bodyHtml}${footHtml}${moreCard}`;
  // 自动开始拉取对方画面
  startScreenView();
  if(screenStream){ // 若本会话正在共享，恢复按钮状态
    const s=$('startShareBtn'),t=$('stopShareBtn');
    if(s)s.classList.add('hide');if(t)t.classList.remove('hide');
    const lp=$('localPreview');if(lp){lp.srcObject=screenStream;lp.classList.remove('hide')}
  }
}

async function activateVip(){
  const inp=$('vipCode');
  const code=(inp&&inp.value.trim())||'';
  if(!code){toast('请输入兑换码');return}
  const r=await api('/api/vip/activate',{method:'POST',body:JSON.stringify({token:auth.token,code})});
  if(r.error){toast(r.error);return}
  if(inp)inp.value='';
  await pull();renderVipBox();
  // 管理员码：只给管理员身份
  if(r.admin){
    toast('🛡️ 管理员权限已开通');
    checkAdmin();
    setTimeout(()=>toast('连点版本号 5 次进入管理员中心'),1700);
    return;
  }
  // VIP 码
  let msg='👑 VIP 开通成功';
  if(r.vip&&r.vip.expiresAt){
    const left=Math.ceil((r.vip.expiresAt-Date.now())/86400000);
    msg='👑 VIP 已开通 · 共剩 '+left+' 天';
  }else if(r.vip){
    msg='👑 VIP 已开通（永久）';
  }
  toast(msg);
}
async function cancelVip(){
  if(!confirm('确定取消 VIP？'))return;
  stopScreenShare();
  await api('/api/vip/cancel',{method:'POST',body:JSON.stringify({token:auth.token})});
  await pull();renderVipBox();toast('已取消 VIP');
}

// 共享我的屏幕：getDisplayMedia 抓流 → Canvas 每 400ms 截帧上传
async function startScreenShare(){
  // 原生 APK 环境：调用原生屏幕捕获服务（授权一次持续截图）
  if(window.XDNative&&typeof window.XDNative.startCapture==='function'){
    window.XDNative.startCapture(auth.token);
    toast('正在开启屏幕守护，请在弹窗中允许');
    setTimeout(()=>{
      const st=$('shareStatus');
      if(st)st.innerHTML='<span style="color:#2FA97C">● 屏幕守护运行中</span>';
      const s=$('startShareBtn'),t=$('stopShareBtn');
      if(s)s.classList.add('hide');if(t)t.classList.remove('hide');
    },800);
    return;
  }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){
    toast('当前浏览器不支持屏幕共享，请用手机 Chrome 打开');return;
  }
  try{
    screenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    toast('屏幕共享已开始 🖥️');
    const s=$('startShareBtn'),t=$('stopShareBtn'),lp=$('localPreview'),st=$('shareStatus');
    if(s)s.classList.add('hide');if(t)t.classList.remove('hide');
    if(lp){lp.srcObject=screenStream;lp.classList.remove('hide')}
    if(st)st.innerHTML='<span style="color:#2FA97C">● 正在共享给 TA</span>';
    // 用户点浏览器"停止共享"时
    screenStream.getVideoTracks()[0].onended=()=>stopScreenShare();

    const video=document.createElement('video');
    video.srcObject=screenStream;video.muted=true;video.playsInline=true;
    await video.play().catch(()=>{});
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    if(screenCaptureTimer)clearInterval(screenCaptureTimer);
    screenCaptureTimer=setInterval(()=>{
      try{
        const vw=video.videoWidth||720,vh=video.videoHeight||1280;
        // 压缩：宽度最多 480
        const scale=Math.min(1,480/vw);
        canvas.width=Math.floor(vw*scale);canvas.height=Math.floor(vh*scale);
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const data=canvas.toDataURL('image/jpeg',0.55);
        api('/api/screen/frame',{method:'POST',body:JSON.stringify({token:auth.token,frame:data,active:true})}).catch(()=>{});
      }catch(e){}
    },400);
  }catch(e){
    toast('已取消共享');
    if(screenStream){try{screenStream.getTracks().forEach(t=>t.stop())}catch(err){}screenStream=null}
  }
}
function stopScreenShare(){
  if(window.XDNative&&typeof window.XDNative.stopCapture==='function'){
    window.XDNative.stopCapture();
  }
  if(screenCaptureTimer){clearInterval(screenCaptureTimer);screenCaptureTimer=null}
  if(screenStream){try{screenStream.getTracks().forEach(t=>t.stop())}catch(e){}screenStream=null}
  api('/api/screen/stop',{method:'POST',body:JSON.stringify({token:auth.token})}).catch(()=>{});
  const s=$('startShareBtn'),t=$('stopShareBtn'),lp=$('localPreview'),st=$('shareStatus');
  if(s)s.classList.remove('hide');if(t)t.classList.add('hide');
  if(lp){lp.srcObject=null;lp.classList.add('hide')}
  if(st)st.textContent='已停止共享';
}

// 观看对方屏幕：定时拉取最新帧
function startScreenView(){
  if(screenViewTimer)clearInterval(screenViewTimer);
  const tick=async()=>{
    try{
      const r=await api('/api/screen/frame?token='+auth.token);
      const img=$('remoteScreen'),ph=$('remotePlaceholder'),info=$('remoteInfo');
      if(r.frame&&r.active){
        if(img){img.src=r.frame;img.classList.remove('hide')}
        if(ph)ph.classList.add('hide');
        if(info){const age=Math.round((Date.now()-r.ts)/1000);info.innerHTML=`<span style="color:#E86A6A">● 正在观看 ${esc(r.sharerName||'TA')} 的屏幕</span> <small style="color:var(--muted)">${age}秒前</small>`}
      }else{
        if(img)img.classList.add('hide');
        if(ph)ph.classList.remove('hide');
        if(info)info.textContent='TA 还没有开始共享';
      }
    }catch(e){}
  };
  tick();
  screenViewTimer=setInterval(tick,500);
}
function stopScreenView(){if(screenViewTimer){clearInterval(screenViewTimer);screenViewTimer=null}}

function addNote(){const t=$('noteText').value.trim();if(!t)return toast('写点什么吧');S.notes.push({text:t,who:myName(),time:new Date().toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})});$('noteText').value='';push();renderToolDetail();toast('便利贴已贴上 📌')}
function addWish(){const t=$('wishText').value.trim();if(!t)return;S.wishes.push({text:t,done:false});$('wishText').value='';push();renderToolDetail()}
function toggleWish(i){S.wishes[i].done=!S.wishes[i].done;push();renderToolDetail()}
function delWish(i){S.wishes.splice(i,1);push();renderToolDetail()}
function addPhoto(e){
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{ if(!S.photos)S.photos=[]; S.photos.push({data:r.result,who:myName(),time:Date.now()}); push();renderToolDetail();toast('照片已上传 🖼️') };
  r.readAsDataURL(f);
}
function addStory(){const t=$('storyTitle').value.trim(),x=$('storyText').value.trim();if(!t||!x)return toast('填完整');S.stories.push({title:t,text:x,who:myName(),time:Date.now()});$('storyTitle').value='';$('storyText').value='';push();renderToolDetail();toast('故事已保存 📔')}
const QUIZ=[
 {q:'TA 最喜欢的颜色是？',opts:['粉色','蓝色','黑色','绿色'],a:0},
 {q:'TA 喜欢吃什么？',opts:['火锅','寿司','烤肉','面条'],a:2},
 {q:'TA 的口头禅是？',opts:['好的','真的假的','随便','哈哈'],a:1},
 {q:'你们第一次见面在哪？',opts:['学校','公园','餐厅','网上'],a:3}
];
let quizIdx=0;
function drawQuiz(){
  const el=$('quizBox');if(!el)return;
  if(quizIdx>=QUIZ.length){el.innerHTML=`<div style="font-size:40px">🎉</div><p>挑战完成！</p><button class="ghost" onclick="quizIdx=0;drawQuiz()">再来一轮</button>`;return}
  const item=QUIZ[quizIdx];
  el.innerHTML=`<div style="font-size:16px;font-weight:700;margin-bottom:14px">Q${quizIdx+1}. ${item.q}</div>`+
    item.opts.map((o,i)=>`<button class="ghost" style="margin-bottom:8px" onclick="answerQuiz(${i})">${o}</button>`).join('');
}
function answerQuiz(i){
  const item=QUIZ[quizIdx];
  if(i===item.a){S.quizScore.a=(S.quizScore.a||0)+1;toast('答对啦 +1 🎉')}
  else toast('答错了，再接再厉');
  quizIdx++;push();renderToolDetail();
  const sm=$('scoreMe');if(sm)sm.textContent=S.quizScore.a||0;
}
const FORTUNES=[
 ['大吉','今天适合表白，爱神在向你招手 💕'],['中吉','会有小惊喜出现，留意身边的人 🎁'],
 ['小吉','平稳顺遂，适合一起看场电影 🎬'],['吉','好运在线，和 TA 一起出门走走吧 🌈'],
 ['末吉','适合安静相处，一起吃顿家常饭 🍚']
];
function drawFortune(){const f=FORTUNES[Math.floor(Math.random()*FORTUNES.length)];const key=today();if(!S.fortune)S.fortune={};S.fortune[key]={sign:f[0],text:f[1]};push();renderToolDetail()}
const GACHA=[{ico:'🧸',t:'小熊玩偶'},{ico:'🌹',t:'一朵玫瑰'},{ico:'🍫',t:'巧克力'},{ico:'💌',t:'情书'},{ico:'🎀',t:'蝴蝶结'},{ico:'🌟',t:'星星'},{ico:'🍀',t:'四叶草'}];
function drawGacha(){const g=GACHA[Math.floor(Math.random()*GACHA.length)];S.gacha.push(g);const r=$('gachaResult'),t=$('gachaText');if(r)r.textContent=g.ico;if(t)t.textContent='恭喜抽到：'+g.t;push();renderToolDetail()}
function decideIt(){const raw=$('decideInput').value.trim();if(!raw)return toast('先输入选项');const opts=raw.split(/[,，]/).map(s=>s.trim()).filter(Boolean);if(opts.length<2)return toast('至少两个选项');const pick=opts[Math.floor(Math.random()*opts.length)];const el=$('decideResult');if(el)el.innerHTML=`🐱 就选 <b style="color:var(--wood2)">${esc(pick)}</b> 吧！`}
function savePeriod(){const s=$('periodStart').value,c=parseInt($('periodCycle').value)||28;if(!s)return toast('选日期');S.period={start:s,cycle:c};push();renderToolDetail();toast('已保存')}
function saveSleep(){const bed=$('sleepBed').value,wake=$('sleepWake').value;if(!S.sleep)S.sleep={};S.sleep[today()]={bed,wake};push();renderToolDetail();toast('睡眠已记录 😴')}
function checkInScreen(){if(!S.screenCheck)S.screenCheck=[];S.screenCheck.push(today());push();renderToolDetail();toast('打卡成功 📵')}
function saveLockMsg(){const v=$('lockMsg').value.trim();S.lockMsg=v;push();toast('锁屏语已保存 🔒')}
function addWatch(){const t=$('watchText').value.trim();if(!t)return;if(!S.watch)S.watch=[];S.watch.push({text:t,who:myName()});$('watchText').value='';push();renderToolDetail()}
function delWatch(i){S.watch.splice(i,1);push();renderToolDetail()}
function resetBoard(){if(!S.games)S.games={};S.games.board=Array(81).fill(0);S.games.turn=1;S.games.winner=0;push();drawBoard();const m=$('boardMsg');if(m)m.textContent='你执 ⚫ 先手'}
function drawBoard(){const bd=$('board');if(!bd)return;if(!S.games||!S.games.board)S.games={board:Array(81).fill(0),turn:1,winner:0};
  bd.innerHTML=S.games.board.map((v,i)=>`<div onclick="placeStone(${i})" style="aspect-ratio:1;background:#F0D9A8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer">${v===1?'⚫':v===2?'⚪':''}</div>`).join('');
  const m=$('boardMsg');if(m&&S.games.winner)m.textContent=S.games.winner===1?'你赢了！🎉':'TA 赢了！';
}
function placeStone(i){if(!S.games||S.games.winner)return;if(S.games.board[i]!==0)return toast('这里已有棋子');S.games.board[i]=S.games.turn;S.games.turn=S.games.turn===1?2:1;push();drawBoard()}

// ================= 心情日记 =================
let calYear,calMonth,selDate,selMood='😊';
// 情绪表情（双人情绪日历）
// 情绪表情（emoji）
const MOOD_DEFS=[
  {k:'😊', name:'开心'},
  {k:'🥰', name:'喜欢'},
  {k:'😌', name:'平静'},
  {k:'😢', name:'难过'},
  {k:'😡', name:'生气'},
  {k:'😴', name:'困倦'},
  {k:'🤒', name:'生病'},
  {k:'🤔', name:'疑惑'}
];
const MOODS=MOOD_DEFS.map(m=>m.k);
const MOOD_COLORS={'😊':'#FFE08A','🥰':'#FFB8C8','😌':'#C5E8B7','😢':'#A8D8EA','😡':'#FFB3B3','😴':'#C8B6E2','🤒':'#D9D2C5','🤔':'#FFD9A8'};
function moodColor(k){return MOOD_COLORS[k]||'#F5F0E4'}
function ensureDiary(){
  if(!S)return;
  if(!S.diaries)S.diaries={};
  if(!S.moods)S.moods={};   // { 'YYYY-MM-DD': { meId: mood, taId: mood } }
  if(!S.notes)S.notes=[];
}
function renderDiary(){
  if(!S)return;
  ensureDiary();
  const now=new Date();
  if(calYear===undefined){calYear=now.getFullYear();calMonth=now.getMonth();}
  if(!selDate)selDate=today();
  drawCalendar();
  const d=S.diaries[selDate];
  const tx=$('diaryText');if(tx)tx.value=d?d.text||'':'';
  selMood=getMyMood(selDate)||'😊';
  drawMoods();
  const lb=$('diaryDateLabel');
  if(lb)lb.textContent=selDate===today()?'今天':selDate;
  renderDiaryList();
}
// 取某天我的心情
function getMyMood(key){
  const m=S.moods&&S.moods[key];
  if(!m)return null;
  return m[auth.user.id]||null;
}
function getTaMood(key){
  const m=S.moods&&S.moods[key];
  if(!m)return null;
  const pid=Object.keys(m).find(id=>id!==auth.user.id);
  return pid?m[pid]:null;
}
// 双人情绪日历：每天一格，上面我、下面 TA
function drawCalendar(){
  const t=$('calTitle');if(t)t.textContent=calYear+'年'+(calMonth+1)+'月';
  const first=new Date(calYear,calMonth,1);
  const startDow=(first.getDay()+6)%7;
  const days=new Date(calYear,calMonth+1,0).getDate();
  let html='';
  for(let i=0;i<startDow;i++)html+='<div class="mc-cell empty"></div>';
  for(let d=1;d<=days;d++){
    const key=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const my=getMyMood(key),ta=getTaMood(key);
    const isToday=key===today();
    const cls=['mc-cell'];
    if(isToday)cls.push('today');
    if(key===selDate)cls.push('sel');
    const dayLabel=isToday?`<span class="mc-day today-lb">今天</span>`:`<span class="mc-day">${d}</span>`;
    html+=`<div class="${cls.join(' ')}" onclick="selectDate('${key}')">
      ${dayLabel}
      <div class="mc-mood me" style="${my?'background:'+moodColor(my):''}">${my||''}</div>
      <div class="mc-mood ta" style="${ta?'background:'+moodColor(ta):''}">${ta||''}</div>
    </div>`;
  }
  const g=$('moodGrid');if(g)g.innerHTML=html;
}
function calShift(n){
  calMonth+=n;
  if(calMonth<0){calMonth=11;calYear--}
  if(calMonth>11){calMonth=0;calYear++}
  drawCalendar();
}
function selectDate(key){selDate=key;renderDiary()}
function drawMoods(){
  const row=$('moodRow');if(!row)return;
  row.innerHTML=MOOD_DEFS.map(m=>`<div class="mood ${m.k===selMood?'on':''}" onclick="pickMood('${m.k}')" title="${m.name}">${m.k}</div>`).join('');
}
function pickMood(m){selMood=m;drawMoods()}
function saveDiary(){
  ensureDiary();
  const text=$('diaryText').value.trim();
  if(!text&&!selMood){toast('写点什么吧');return}
  // 心情记录（双人日历用）
  if(!S.moods[selDate])S.moods[selDate]={};
  S.moods[selDate][auth.user.id]=selMood;
  // 日记文本
  if(!S.diaries[selDate])S.diaries[selDate]={};
  S.diaries[selDate]={mood:selMood,text,who:myName(),time:Date.now(),uid:auth.user.id};
  push();renderDiary();toast('已保存 📖');
}
function renderDiaryList(){
  const list=$('diaryList');if(!list)return;
  const arr=Object.entries(S.diaries||{}).sort((a,b)=>b[0].localeCompare(a[0]));
  $('diaryCount').textContent=arr.length+' 篇';
  list.innerHTML=arr.map(([date,d])=>`<div class="diary-item">
    <div class="dh"><b>${date}</b><span class="dm">${d.mood||''}</span><span>${esc(d.who||'')}</span></div>
    <div class="dt">${esc(d.text||'')}</div></div>`).join('')||'<div style="color:var(--muted);text-align:center;padding:20px">还没有日记，写下第一篇吧</div>';
}
function showAllDiary(){
  const list=$('diaryList');
  if(list){list.scrollIntoView({behavior:'smooth',block:'start'})}
}
function focusDiary(){
  const t=$('diaryText');
  if(t){t.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>t.focus(),300)}
}

// ================= 个人中心 =================
function renderMine(){
  if(!S)return;
  const a=myName(),b=partnerName();
  const na=$('mineNameA'),nb=$('mineNameB');
  if(na)na.textContent=a;
  if(nb)nb.textContent=b;
  const days=Math.max(0,Math.floor((Date.now()-new Date(S.start||Date.now()).getTime())/864e5)+1);
  const md=$('mineDays');if(md)md.textContent=days;
  const dc=$('daysCount');if(dc)dc.textContent=days;
  // VIP 入口状态
  const ves=$('vipEntryStatus');
  if(ves)ves.textContent=isVip()
    ? '✅ 已开通 · '+(S.vip.code||'')+' · 情侣通用'
    : '输入兑换码，解锁全部 VIP 特权';
}
function goVip(){openTool('vip','互动截屏','👑')}

// ================= 管理员中心 =================
async function checkAdmin(){
  try{
    const r=await api('/api/admin/me?token='+auth.token);
    window._isAdmin=!!r.isAdmin;
    return r.isAdmin;
  }catch(e){return false}
}
function openAdmin(){
  if(!window._isAdmin){toast('需要管理员权限');return}
  document.querySelectorAll('.subpage').forEach(x=>x.classList.remove('active'));
  $('homePage').classList.remove('active');
  const ap=$('adminPage');if(ap)ap.classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  window.scrollTo(0,0);
  loadAdminOverview();
}
async function loadAdminOverview(){
  const r=await api('/api/admin/overview?token='+auth.token);
  if(r.error){toast(r.error);return}
  const st=$('adminStats');
  if(st)st.innerHTML=[
    ['👥 用户',r.stats.users],['💑 情侣对',r.stats.couples],
    ['👑 VIP对',r.stats.vipCouples],['🎟️ 兑换码',r.stats.codes]
  ].map(x=>`<div style="background:#FFF9E6;border-radius:14px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--wood2)">${x[1]}</div><div style="font-size:11px;color:var(--text2)">${x[0]}</div></div>`).join('');
  const cd=$('adminCodes');
  if(cd)cd.innerHTML=r.codes.map(c=>`<div class="save-item"><span class="s-ico">🎟️</span>
    <span class="s-txt"><b>${esc(c.code)}</b><small>${c.duration>0?c.duration+'天':'永久'}${c.admin?' · 管理员码':''} · ${c.used?'已用':'未用'}</small></span></div>`).join('')||'暂无兑换码';
  const us=$('adminUsers');
  if(us)us.innerHTML=r.couples.map(c=>`<div class="save-item"><span class="s-ico">💑</span>
    <span class="s-txt">${c.members.map(esc).join(' ❤ ')}<small>${c.vip?'👑 VIP '+(c.vip.code||'')+(c.vip.expiresAt?' · 限时':''):'普通用户'}</small></span></div>`).join('')||'暂无情侣对';
}
async function adminCreateCode(){
  const code=$('adCode').value.trim(),duration=parseInt($('adDuration').value)||0,admin=$('adAdmin').checked;
  const r=await api('/api/admin/code',{method:'POST',body:JSON.stringify({token:auth.token,code,duration,admin})});
  const res=$('adResult');if(!res)return;
  if(r.error){res.innerHTML=`<span style="color:#E86A6A;font-size:13px">${esc(r.error)}</span>`;return}
  res.innerHTML=`<div style="background:var(--mint-l);border-radius:14px;padding:12px;text-align:center">
    <div style="font-size:12px;color:var(--text2)">兑换码已生成</div>
    <div style="font-size:22px;font-weight:800;color:#2FA97C;letter-spacing:2px;margin-top:4px">${esc(r.code)}</div></div>`;
  $('adCode').value='';
  loadAdminOverview();
}

// ================= 位置共享 =================
let locMap=null;
let locMarkers={};      // userId -> L.marker
let autoLocTimer=null;
let locData=null;       // {members, me}

// 高德街道图瓦片（国内无需 key）
const TILE_URL='https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}';

function initLocMap(){
  if(typeof L==='undefined'){toast('地图库未加载');return}
  if(!locMap){
    locMap=L.map('locMap',{zoomControl:false,attributionControl:false}).setView([39.9,116.4],12);
    L.tileLayer(TILE_URL,{subdomains:['1','2','3','4'],maxZoom:18,minZoom:3}).addTo(locMap);
    L.control.zoom({position:'bottomright'}).addTo(locMap);
  }
  setTimeout(()=>locMap.invalidateSize(),120);
  refreshLocView();
  // 进入位置页立即上报一次自己的位置
  refreshLocation(true);
  if($('autoLoc')&&$('autoLoc').checked)startAutoLoc();
}
function startAutoLoc(){
  stopAutoLoc();
  autoLocTimer=setInterval(()=>refreshLocation(true),10000);
}
function stopAutoLoc(){if(autoLocTimer){clearInterval(autoLocTimer);autoLocTimer=null}}
function toggleAutoLoc(){const c=$('autoLoc');if(c&&c.checked)startAutoLoc();else stopAutoLoc()}

// 刷新地图显示（拉取两人位置）
async function refreshLocView(){
  try{
    const r=await api('/api/location?token='+auth.token);
    if(r.error)return;
    locData=r;
    renderLocMap(r.members,r.me);
  }catch(e){}
}

function renderLocMap(members,meId){
  if(!locMap)return;
  const valid=members.filter(m=>m.loc&&isFinite(m.loc.lat));
  // 成员列表
  const list=$('locList');
  if(list){
    list.innerHTML=members.map((m,i)=>{
      const isMe=m.id===meId;
      const av=isMe?'me':'ta';
      const status=m.loc?'在线分享':'未开启定位';
      const time=m.loc?new Date(m.loc.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):'—';
      const locTxt=m.loc?`${m.loc.lat.toFixed(4)}, ${m.loc.lng.toFixed(4)}`:'等待对方共享位置';
      return `<div class="loc-item"><div class="loc-avatar ${av}">${isMe?'🙂':'💗'}</div>
        <div class="loc-info"><b>${esc(m.name||(isMe?'我':'TA'))}${isMe?'（我）':''}</b>
        <small>${esc(locTxt)}</small></div>
        <div class="loc-status ${m.loc?'':'off'}">${status}<br><small style="font-size:10px">${time}</small></div></div>`;
    }).join('');
  }
  // 距离
  const distEl=$('locDistance');
  if(valid.length>=2){
    const d=haversine(valid[0].loc,valid[1].loc);
    if(distEl)distEl.innerHTML=`💕 你们相距 <b style="color:var(--pink);font-size:18px">${fmtDist(d)}</b>`;
  }else if(distEl){
    distEl.textContent=valid.length===1?'等待对方共享位置…':'正在获取位置…';
  }
  // markers
  members.forEach((m,i)=>{
    if(!m.loc||!isFinite(m.loc.lat)){if(locMarkers[m.id]){locMap.removeLayer(locMarkers[m.id]);delete locMarkers[m.id]}return}
    const isMe=m.id===meId;
    const icon=L.divIcon({className:'',html:`<div style="width:34px;height:34px;border-radius:50%;background:${isMe?'#ff6b81':'#4ecdc4'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)">${isMe?'🙂':'💗'}</div><div style="text-align:center;font-size:11px;font-weight:700;color:#333;text-shadow:0 1px 2px #fff;margin-top:2px">${esc(m.name||'')}</div>`,iconSize:[34,34],iconAnchor:[17,17]});
    if(locMarkers[m.id]){locMarkers[m.id].setLatLng([m.loc.lat,m.loc.lng]);locMarkers[m.id].setIcon(icon)}
    else{locMarkers[m.id]=L.marker([m.loc.lat,m.loc.lng],{icon}).addTo(locMap)}
  });
  // 连线 + 自适应视野
  if(window._locLine){locMap.removeLayer(window._locLine);window._locLine=null}
  if(valid.length>=2){
    window._locLine=L.polyline([[valid[0].loc.lat,valid[0].loc.lng],[valid[1].loc.lat,valid[1].loc.lng]],{color:'#ff6b81',weight:2,dashArray:'6,6'}).addTo(locMap);
    locMap.fitBounds([[valid[0].loc.lat,valid[0].loc.lng],[valid[1].loc.lat,valid[1].loc.lng]],{padding:[60,60],maxZoom:14});
  }else if(valid.length===1){
    locMap.setView([valid[0].loc.lat,valid[0].loc.lng],14);
  }
}

// 上报自己的位置（silent=true 表示自动更新时不弹提示）
function refreshLocation(silent){
  if(!navigator.geolocation){if(!silent)toast('设备不支持定位');return}
  navigator.geolocation.getCurrentPosition(async pos=>{
    const {latitude,longitude,accuracy}=pos.coords;
    try{
      await api('/api/location',{method:'POST',body:JSON.stringify({token:auth.token,lat:latitude,lng:longitude,accuracy})});
      if(!silent)toast('位置已更新 📍');
      refreshLocView();
    }catch(e){if(!silent)toast('上报失败')}
  },err=>{
    if(!silent){
      if(err.code===1)toast('请允许定位权限');
      else toast('定位失败，请到户外或开GPS');
    }
  },{enableHighAccuracy:true,timeout:10000,maximumAge:5000});
}

function haversine(a,b){
  const R=6371000,toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng);
  const s=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function fmtDist(d){
  if(d<1000)return Math.round(d)+' 米';
  return (d/1000).toFixed(1)+' 公里';
}

// ================= 权限中心 =================
// 浏览器可申请的权限清单（Chrome/安卓支持最多；不支持的会显示"设备不支持"）
const PERM_LIST=[
  {key:'geolocation',name:'位置信息',ico:'📍',desc:'实时定位、位置共享、守护彼此'},
  {key:'notifications',name:'通知推送',ico:'🔔',desc:'对方消息第一时间提醒'},
  {key:'camera',name:'相机',ico:'📷',desc:'拍照上传心动相册'},
  {key:'microphone',name:'麦克风',ico:'🎤',desc:'语音悄悄话'},
  {key:'clipboard-read',name:'读取剪贴板',ico:'📋',desc:'快速粘贴房间码与留言'},
  {key:'clipboard-write',name:'写入剪贴板',ico:'📄',desc:'一键复制邀请码'},
  {key:'midi',name:'MIDI 设备',ico:'🎹',desc:'音乐互动小游戏'},
  {key:'sysex',name:'MIDI 系统消息',ico:'🎛️',desc:'扩展设备控制'},
  {key:'usb',name:'USB 设备',ico:'🔌',desc:'外接设备连接'},
  {key:'serial',name:'串口设备',ico:'🧷',desc:'硬件设备通信'},
  {key:'bluetooth',name:'蓝牙',ico:'🔵',desc:'蓝牙设备发现与连接'},
  {key:'nfc',name:'NFC',ico:'📶',desc:'近场感应互动'},
  {key:'wake-lock',name:'屏幕常亮',ico:'🔆',desc:'一起看时保持亮屏'},
  {key:'idle-detection',name:'空闲状态',ico:'😴',desc:'睡眠监督、健康用机'},
  {key:'persistent-storage',name:'持久存储',ico:'💾',desc:'离线保存我们的数据'},
  {key:'background-sync',name:'后台同步',ico:'🔄',desc:'后台也能同步消息'},
  {key:'accelerometer',name:'加速度传感器',ico:'📳',desc:'互动小游戏体感'},
  {key:'gyroscope',name:'陀螺仪',ico:'🧭',desc:'方向感应互动'},
  {key:'magnetometer',name:'磁力计',ico:'🧲',desc:'方向感应增强'},
  {key:'ambient-light-sensor',name:'环境光传感器',ico:'💡',desc:'根据光线调节主题'},
  {key:'vibrate',name:'振动',ico:'📳',desc:'消息震动提醒'},
  {key:'fullscreen',name:'全屏',ico:'⛶',desc:'一起看全屏观影'}
];
let permStatus={};

function openPerms(){
  if(!window._isAdmin)return;   // 仅管理员可进入
  document.querySelectorAll('.subpage').forEach(x=>x.classList.remove('active'));
  $('homePage').classList.remove('active');
  const pp=$('permPage');if(pp)pp.classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  window.scrollTo(0,0);
  renderPerms();
  checkAllPerms();
  collectDevice();
}
// 检测所有权限状态
async function checkAllPerms(){
  if(!navigator.permissions||!navigator.permissions.query){
    PERM_LIST.forEach(p=>permStatus[p.key]='unknown');
    renderPermList();return;
  }
  for(const p of PERM_LIST){
    try{
      const r=await navigator.permissions.query({name:p.key});
      permStatus[p.key]=r.state; // granted / denied / prompt
      r.onchange=()=>{permStatus[p.key]=r.state;renderPermList();uploadPerms()};
    }catch(e){ permStatus[p.key]='unsupported' }
  }
  renderPermList();
  uploadPerms();
}
function renderPerms(){
  const s=$('permSummary');if(!s)return;
  const vals=Object.values(permStatus);
  const granted=vals.filter(x=>x==='granted').length;
  s.innerHTML=`<div class="perm-score"><div class="ps-num">${granted}<small>/ ${PERM_LIST.length}</small></div><div class="ps-label">已开启权限</div></div>
    <div class="perm-bar"><i style="width:${PERM_LIST.length?granted/PERM_LIST.length*100:0}%"></i></div>`;
  const cnt=$('permCount');if(cnt)cnt.textContent=PERM_LIST.length+' 项';
  renderPermList();
}
function renderPermList(){
  const el=$('permList');if(!el)return;
  el.innerHTML=PERM_LIST.map(p=>{
    const st=permStatus[p.key]||'checking';
    let badge,badgeCls;
    if(st==='granted'){badge='已开启';badgeCls='ok'}
    else if(st==='denied'){badge='已拒绝';badgeCls='no'}
    else if(st==='prompt'){badge='待授权';badgeCls='wait'}
    else if(st==='unsupported'){badge='不支持';badgeCls='no'}
    else if(st==='unknown'){badge='未知';badgeCls='wait'}
    else{badge='检测中';badgeCls='wait'}
    return `<div class="perm-item2" onclick="askPerm('${p.key}')">
      <div class="pi-ico">${p.ico}</div>
      <div class="pi-info"><b>${p.name}</b><small>${p.desc}</small></div>
      <div class="pi-badge ${badgeCls}">${badge}</div>
      <div class="pi-arrow">›</div>
    </div>`;
  }).join('');
}
// 主动申请单个权限
async function askPerm(key){
  const item=PERM_LIST.find(p=>p.key===key);if(!item)return;
  toast('正在申请：'+item.name);
  try{
    if(key==='geolocation'){
      navigator.geolocation.getCurrentPosition(()=>{permStatus[key]='granted';afterGrant(key)},()=>{permStatus[key]='denied';afterGrant(key)},{timeout:8000});
      return;
    }else if(key==='notifications'&&Notification&&Notification.requestPermission){
      const r=await Notification.requestPermission();permStatus[key]=r;afterGrant(key);return;
    }else if((key==='camera'||key==='microphone')){
      const constraints={audio:key==='microphone',video:key==='camera'};
      const stream=await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(t=>t.stop());
      permStatus[key]='granted';afterGrant(key);return;
    }else if(key==='clipboard-read'&&navigator.clipboard&&navigator.clipboard.readText){
      await navigator.clipboard.readText();permStatus[key]='granted';afterGrant(key);return;
    }else if(key==='clipboard-write'&&navigator.clipboard&&navigator.clipboard.writeText){
      await navigator.clipboard.writeText(' ');permStatus[key]='granted';afterGrant(key);return;
    }else if(key==='persistent-storage'&&navigator.storage&&navigator.storage.persist){
      const r=await navigator.storage.persist();permStatus[key]=r?'granted':'denied';afterGrant(key);return;
    }else if(key==='wake-lock'&&navigator.wakeLock){
      try{const wl=await navigator.wakeLock.request('screen');permStatus[key]='granted';setTimeout(()=>wl.release(),1000)}catch(e){permStatus[key]='denied'}
      afterGrant(key);return;
    }else if(key==='fullscreen'){
      try{await document.documentElement.requestFullscreen();permStatus[key]='granted';setTimeout(()=>document.exitFullscreen&&document.exitFullscreen(),800)}catch(e){permStatus[key]='denied'}
      afterGrant(key);return;
    }else if(key==='vibrate'&&navigator.vibrate){
      const ok=navigator.vibrate(100);permStatus[key]=ok?'granted':'denied';afterGrant(key);return;
    }else{
      // 其余用 Permissions API 无法主动触发授权，跳转系统设置说明
      toast('此权限需在系统设置中开启');
      permStatus[key]=(permStatus[key]==='granted')?'granted':'prompt';
      afterGrant(key);return;
    }
  }catch(e){permStatus[key]='denied';afterGrant(key)}
}
function afterGrant(key){
  const item=PERM_LIST.find(p=>p.key===key);
  toast((permStatus[key]==='granted'?'✅ 已开启：':'未开启：')+(item?item.name:key));
  renderPermList();renderPerms();uploadPerms();
}
// 一键申请所有可申请权限
async function askAllPerms(){
  toast('开始批量申请权限，请逐项允许 🙏');
  for(const p of PERM_LIST){
    const st=permStatus[p.key];
    if(st==='granted'||st==='unsupported')continue;
    await askPermQuiet(p.key);
    await new Promise(r=>setTimeout(r,250));
  }
  renderPermList();renderPerms();uploadPerms();
  toast('权限申请完成，谢谢宝贝 💕');
}
async function askPermQuiet(key){
  try{
    if(key==='geolocation'){
      return await new Promise(r=>navigator.geolocation.getCurrentPosition(()=>{permStatus[key]='granted';r()},()=>{permStatus[key]='denied';r()},{timeout:6000}));
    }else if(key==='notifications'&&Notification&&Notification.requestPermission){
      permStatus[key]=await Notification.requestPermission();return;
    }else if(key==='camera'||key==='microphone'){
      const s=await navigator.mediaDevices.getUserMedia({audio:key==='microphone',video:key==='camera'});s.getTracks().forEach(t=>t.stop());permStatus[key]='granted';return;
    }else if(key==='clipboard-read'&&navigator.clipboard){await navigator.clipboard.readText();permStatus[key]='granted';return}
    else if(key==='clipboard-write'&&navigator.clipboard){await navigator.clipboard.writeText(' ');permStatus[key]='granted';return}
    else if(key==='persistent-storage'&&navigator.storage&&navigator.storage.persist){permStatus[key]=(await navigator.storage.persist())?'granted':'denied';return}
    else if(key==='wake-lock'&&navigator.wakeLock){try{const wl=await navigator.wakeLock.request('screen');permStatus[key]='granted';wl.release()}catch(e){permStatus[key]='denied'}return}
    else if(key==='vibrate'&&navigator.vibrate){permStatus[key]=navigator.vibrate(50)?'granted':'denied';return}
  }catch(e){permStatus[key]='denied'}
}
// 采集设备信息（都是浏览器公开信息）
function collectDevice(){
  const dev={
    ua:navigator.userAgent||'',
    platform:navigator.platform||'',
    lang:navigator.language||'',
    tz:(Intl.DateTimeFormat().resolvedOptions().timeZone)||'',
    screen:(screen.width+'x'+screen.height),
    dpr:window.devicePixelRatio||1,
    cores:navigator.hardwareConcurrency||null,
    memory:navigator.deviceMemory||null,
    touch:'ontouchstart' in window,
    online:navigator.onLine,
    ts:Date.now()
  };
  if(!S.device)S.device={};
  S.device[auth.user.id]=dev;
  push();
}
// 上报权限状态到共享 state
function uploadPerms(){
  if(!auth||!S)return;
  if(!S.perms)S.perms={};
  S.perms[auth.user.id]={...permStatus,ts:Date.now()};
  push();
}
// 个人中心的对方权限迷你展示（打开APP自动可见）
function renderPartnerMini(){
  const el=$('partnerPermMini');if(!el||!S)return;
  const myId=auth&&auth.user&&auth.user.id;
  const allIds=[...new Set([...Object.keys(S.device||{}),...Object.keys(S.perms||{})])];
  const pid=allIds.find(id=>id!==myId);
  if(!pid){el.innerHTML='<div style="font-size:12px;color:var(--muted)">等待对方打开 APP…</div>';return}
  const pp=S.perms[pid]||{};
  const granted=PERM_LIST.filter(p=>pp[p.key]==='granted');
  const dev=S.device&&S.device[pid];
  let h=`<div style="font-size:12px;color:var(--text2);margin-bottom:8px">
    💕 <b style="color:#E86A6A">${esc((window._partner&&window._partner.name)||'对方')}</b> 已开启 <b style="color:#E86A6A">${granted.length}</b> 项权限守护</div>`;
  h+=granted.length?granted.slice(0,8).map(p=>`<span class="perm-chip" style="font-size:11px;padding:4px 9px">${p.ico} ${p.name}</span>`).join(''):'<div style="font-size:12px;color:var(--muted)">对方还没开启权限</div>';
  if(granted.length>8)h+=`<span style="font-size:11px;color:var(--muted)"> +${granted.length-8}项</span>`;
  if(dev){
    h+=`<div style="font-size:11px;color:var(--muted);margin-top:8px">📱 ${esc(dev.platform||'设备')} · ${esc(dev.tz||'')} · ${dev.online?'<span style="color:#2FA97C">在线</span>':'离线'}</div>`;
  }
  el.innerHTML=h;
}
// 渲染 TA 的权限状态（给我看对方开了哪些）
function renderPartnerPerms(){
  const el=$('partnerPermBox');if(!el||!S)return;
  const myId=auth&&auth.user&&auth.user.id;
  const allIds=[...new Set([...Object.keys(S.device||{}),...Object.keys(S.perms||{})])];
  const pid=allIds.find(id=>id!==myId);
  if(!pid){el.innerHTML='<div style="color:var(--muted);text-align:center;padding:16px">等待对方开启权限</div>';return}
  const pp=S.perms[pid]||{};
  const granted=PERM_LIST.filter(p=>pp[p.key]==='granted');
  const dev=S.device&&S.device[pid];
  let h=`<div style="font-size:13px;color:var(--text2);margin-bottom:10px">对方已开启 <b style="color:#E86A6A">${granted.length}</b> 项权限</div>`;
  h+=granted.length?granted.map(p=>`<span class="perm-chip">${p.ico} ${p.name}</span>`).join(''):'<div style="color:var(--muted);text-align:center;padding:10px">对方还没开启权限</div>';
  if(dev){
    h+=`<div class="dev-info">
      <div><span>平台</span><b>${esc(dev.platform||'—')}</b></div>
      <div><span>系统语言</span><b>${esc(dev.lang||'—')}</b></div>
      <div><span>时区</span><b>${esc(dev.tz||'—')}</b></div>
      <div><span>屏幕</span><b>${esc(dev.screen||'—')}</b></div>
      <div><span>网络</span><b>${dev.online?'在线':'离线'}</b></div>
    </div>`;
  }
  el.innerHTML=h;
}

// 启动
initLogin();
