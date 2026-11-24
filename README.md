# 心动日常 · 情侣小屋（双人联网版）

两个人，一个小屋。创建房间 → 把 6 位房间码发给对方 → 两人实时同步打卡、纪念日、存钱罐、悄悄话。

## 特性
- 💬 **微信登录（可选）**：扫码授权、自动填昵称，配置详见 WECHAT-LOGIN.md
- ✅ **双人配对**：一人创建房间，一人用房号加入
- 🔄 **实时同步**：SSE 推送，一方改动另一方秒级刷新
- 📦 **可安装**：PWA，浏览器「添加到主屏幕」即像原生 APP
- 🆕 **可更新**：服务端 version.json + Service Worker，打开即检测新版本
- 💾 **可持久化**：房间数据存服务端 data/rooms.json，重启不丢
- 📱 **APK**：用 PWABuilder 一键打包安卓 APK（见文末）

## 一、本地运行（测试）

需要 Node 18+：

```bash
cd xindong-fullstack
node server.js
# 打开 http://localhost:3000
```

手机和电脑在 same WiFi 时，用 `http://电脑IP:3000` 访问。

## 二、部署到公网（两人异地使用）

选一台云服务器（或免费 PaaS），把项目放上去，保证 3000 端口可访问。

### 方式 A：Node 直接跑

```bash
node server.js
# 建议用 pm2 守护：
# npm i -g pm2 && pm2 start server.js --name xindong
```

### 方式 B：Docker

```bash
cd deploy
docker compose up -d --build
```

### 方式 C：免费 PaaS

Render / Railway / Fly.io 都支持 Node，build 命令 `npm install`，start 命令 `node server.js`，端口用环境变量 PORT。

> 建议配 HTTPS（PWA 安装和 Service Worker 需要 HTTPS 或 localhost）。可用 Caddy/Nginx 反代 + 免费证书。

## 三、两人怎么用

1. A 打开网址 → 「创建小屋」→ 填昵称、在一起日期 → 创建
2. 小屋页显示 6 位**房间码**，发给 B
3. B 打开网址 → 「加入小屋」→ 填昵称和房间码 → 加入
4. 之后任一方改动，另一方自动同步

## 四、发布更新

1. 改代码（前端或后端）
2. 修改 `version.json` 的 `version`（如 1.0.0 → 1.0.1）
3. 修改 `public/sw.js` 里的 `CACHE` 常量为对应版本
4. 同步修改 `public/app.js` 里的 `CURRENT_VERSION`
5. 重启服务
6. 对方打开 APP 会提示「发现新版本，点击更新」，点一下即刷新到新版

## 五、打包成 APK（安卓安装）

1. 先把网站部署到公网 HTTPS 地址
2. 打开 https://www.pwabuilder.com/
3. 输入你的网址 → 点「Start」→ 生成
4. 选 Android → 打包选项里可自定义图标/名称 → 下载 APK
5. 发给你对象安装即可

也可本地用 Bubblewrap / Capacitor 打包，文档见 PWABuilder 站点。

## 目录结构
```
xindong-fullstack/
├── server.js            # 零依赖后端（配对/同步/SSE/版本/静态）
├── version.json         # 版本号（更新检测用）
├── package.json
├── Dockerfile
├── data/rooms.json      # 房间数据（运行时生成）
├── public/
│   ├── index.html       # 前端页面
│   ├── style.css
│   ├── app.js           # 前端逻辑+API+同步
│   ├── sw.js            # Service Worker（离线+更新）
│   ├── manifest.json    # PWA 清单
│   └── icon.svg         # 图标
└── deploy/docker-compose.yml
```
