/**
 * 微信网站应用登录（OAuth2 扫码授权）——可选模块
 * 启用方式：Render 环境变量配置 WX_APPID / WX_SECRET / WX_REDIRECT
 * 三项齐全时自动启用，登录页才会出现「微信登录」按钮。
 *
 * WX_REDIRECT 必须是微信开放平台「网站应用」里配置的回调域名，且为 HTTPS。
 */
const APPID = process.env.WX_APPID || '';
const SECRET = process.env.WX_SECRET || '';
const REDIRECT = process.env.WX_REDIRECT || '';

const enabled = !!(APPID && SECRET && REDIRECT);

// 待处理的 state（防 CSRF），生产环境建议换成带过期时间的存储
const pending = new Map();

function makeState() {
  const s = Math.random().toString(36).slice(2) + Date.now().toString(36);
  pending.set(s, Date.now());
  // 5 分钟过期
  setTimeout(() => pending.delete(s), 5 * 60 * 1000);
  return s;
}
function validState(s) {
  if (!s || !pending.has(s)) return false;
  pending.delete(s);
  return true;
}

// 生成扫码授权跳转地址
function authUrl(state) {
  return 'https://open.weixin.qq.com/connect/qrconnect?appid=' + APPID +
    '&redirect_uri=' + encodeURIComponent(REDIRECT) +
    '&response_type=code&scope=snsapi_login&state=' + encodeURIComponent(state) +
    '#wechat_redirect';
}

// code 换 access_token + openid
async function getToken(code) {
  const u = 'https://api.weixin.qq.com/sns/oauth2/access_token?appid=' + APPID +
    '&secret=' + SECRET + '&code=' + encodeURIComponent(code) +
    '&grant_type=authorization_code';
  const r = await fetch(u);
  return r.json();
}

// 拉用户信息（需 scope=snsapi_login）
async function getUser(accessToken, openid) {
  const u = 'https://api.weixin.qq.com/sns/userinfo?access_token=' + encodeURIComponent(accessToken) +
    '&openid=' + encodeURIComponent(openid) + '&lang=zh_CN';
  const r = await fetch(u);
  return r.json();
}

module.exports = { enabled, makeState, validState, authUrl, getToken, getUser };
