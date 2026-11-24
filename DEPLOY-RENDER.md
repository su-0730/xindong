# 部署到 Render（免费、带 HTTPS、改代码即自动更新）

按这个做，2 分钟拿到公网 HTTPS 网址。APK 和异地同步都靠这个网址。

## 前置
- 一个邮箱（注册 Render 用）
- 一个 GitHub 账号（Render 从 GitHub 拉代码，改代码后自动重新部署 = 静默更新的关键）

## 第 1 步：把代码传到 GitHub
1. 打开 https://github.com/new 新建一个仓库，名字随便（如 `xindong`），选 **Public**，点 Create repository
2. 在手机上把这个项目解压，进入 `xindong-fullstack` 目录
3. 执行（把 `你的用户名` 和 `xindong` 换成你自己的）：
```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/xindong.git
git push -u origin main
```
> 提示要登录时，GitHub 现在用 Personal Access Token 当密码。去 https://github.com/settings/tokens 生成一个（勾 repo 权限）复制备用。

## 第 2 步：Render 部署
1. 打开 https://render.com 用邮箱注册/登录
2. 点右上角 **New +** → **Web Service**
3. 点 **Connect** 连你的 GitHub，选刚才那个 `xindong` 仓库
4. 配置项（render.yaml 已经自动填好大部分，核对一下）：
   - **Name**: xindong-couple（随便）
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
5. 点 **Create Web Service**
6. 等 1-2 分钟，状态变 **Live**，顶部出现网址，形如：
   `https://xindong-couple.onrender.com`
   ← 这就是你的公网地址，记下来

> 免费版注意：15 分钟没人访问会休眠，第一次打开要等约 30 秒唤醒。两人常用的话基本无感；介意的话可升级付费版（$7/月）保持常活。

## 第 3 步：验证
浏览器打开 `https://你的地址.onrender.com`，能看到登录页就成了。
再打开 `https://你的地址.onrender.com/api/health`，返回 `{"ok":true,...}` 即正常。

## 第 4 步：做 APK
把你的公网网址发给我，我用 PWABuilder / Bubblewrap 生成一个真 `.apk` 给你。
两人装上 APK，A 创建小屋拿 6 位房间码，B 输房间码加入，就能异地同步了。

## 以后怎么"静默更新"
1. 改代码后 `git push` 到 GitHub
2. Render 检测到推送，自动重新部署（约 1-2 分钟）
3. APP 打开时自动探测到新版本 → 自动刷新 → 你们看到的就是新版
4. **全程不用重装 APK**，APK 只是个加载网址的壳

> 记得每次改前端时同步改这三个版本号（否则 SW 可能不刷新）：
> `version.json` 的 version、`public/sw.js` 的 CACHE、`public/app.js` 的 CURRENT_VERSION
