# 🎬 云盘影院 (Cloud-Movie)

> **免费端到端**：粘贴网盘分享链接 → 自动刮削 TMDB 元数据 → 生成海报墙影院。
> **服务端零流量消耗**，视频直连云盘，不中转、不存储。
> **打开浏览器就能看**，无需安装 App、无需下载文件、无需额外配置播放器。

无需数据库、无需 Docker、零 npm 依赖，下载即用。

---

## ✨ 功能特性

- **💰 零流量成本** — 服务端不下载、不中转视频，影片直接从网盘 CDN 加载播放，服务器只需转发 TMDB 查询请求（KB 级）
- **🔗 端到端自动化** — 贴链接 → 勾选文件夹 → 等待 → 影院就绪，全程一条龙
- **📥 网盘导入** — 粘贴移动云盘分享链接，在线浏览目录树，勾选即导入
- **🔍 智能刮削** — 自动从 TMDB 获取海报、评分、简介、演员、类型等元数据
- **📺 剧集识别** — 自动识别电视剧分集、多季结构、`E01`/`第X集` 等命名，同名文件自动去重
- **🗂️ 智能分组** — 按文件夹结构自动分组：电视剧合并为剧集组，电影集合逐个独立刮削
- **🀄 拼音支持** — 拼音文件夹名自动转中文搜索（如 `kuang飙` → `狂飙`），支持同音字
- **📋 字典映射** — 内置 335 条文件名→标准名映射，精准处理含特殊字符的命名
- **🎨 影院 UI** — 深色主题、分类筛选、高级搜索、自定义视频播放器
- **🌐 国内优化** — 支持 v2rayN/Clash 本地代理访问 TMDB，多镜像自动回退
- **👥 多用户共享** — 元数据和影片数据存于服务端，局域网内共享刮削成果
- **📊 管理员面板** — 访客统计、在线人数、影片管理

---

## 🚀 快速开始

### 1. 安装环境

#### Node.js & npm（三选一）

<details>
<summary><b>Ubuntu / Debian</b></summary>

```bash
# 方式一：NodeSource 官方源（推荐，版本最新）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 方式二：系统自带（版本可能较旧）
sudo apt update && sudo apt install -y nodejs npm

# 验证
node -v    # ≥ 14.x 即可
npm -v
```
</details>

<details>
<summary><b>CentOS / RHEL / OpenCloudOS</b></summary>

```bash
# 方式一：NodeSource 官方源
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo yum install -y nodejs

# 方式二：dnf（Fedora / RHEL 8+）
sudo dnf module install nodejs:22

# 验证
node -v
npm -v
```
</details>

<details>
<summary><b>macOS</b></summary>

```bash
# Homebrew
brew install node

# 验证
node -v
npm -v
```
</details>

> 💡 本项目零 npm 依赖，只需 Node.js 本体即可运行。

#### Caddy（可选，需要域名时安装）

<details>
<summary><b>Ubuntu / Debian</b></summary>

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```
</details>

<details>
<summary><b>CentOS / RHEL / OpenCloudOS</b></summary>

```bash
# Caddy 官方 COPR 仓库
sudo yum install -y yum-plugin-copr
sudo yum copr enable -y @caddy/caddy
sudo yum install -y caddy
```
</details>

<details>
<summary><b>通用方式（任何 Linux）</b></summary>

```bash
# 下载二进制
curl -L "https://caddyserver.com/api/download?os=linux&arch=amd64" -o caddy
sudo mv caddy /usr/local/bin/
sudo chmod +x /usr/local/bin/caddy

# 验证
caddy version
```
</details>

### 2. 克隆项目 & 配置

```bash
git clone https://github.com/whenStoneHaveLove/cloud-movie.git
cd cloud-movie
cp config.example.json config.json
nano config.json   # 填入 TMDB Key 和管理员密码
```

```json
{
    "port": 8081,
    "tmdb": {
        "apiKey": "请填入你的TMDB API KEY",
        "mirrors": ["https://api.themoviedb.org", "https://api.tmdb.org"],
        "timeout": 8000
    },
    "proxy": "",
    "adminPassword": "请修改默认管理员密码"
}
```

| 配置项 | 说明 |
|--------|------|
| `port` | 服务端口，默认 `8081` |
| `tmdb.apiKey` | **必填**，TMDB API 密钥 |
| `tmdb.mirrors` | TMDB 镜像地址，国内服务器直连不通时可配代理 |
| `tmdb.timeout` | 请求超时毫秒，默认 8000 |
| `proxy` | 本地代理（如 `127.0.0.1:10808`），留空不启用 |
| `adminPassword` | 管理员面板登录密码 |

### 3. 启动服务

```bash
node server.js
```

浏览器打开 `http://localhost:8081`。

> 💡 端口默认 **8081**，可在 `config.json` 中修改 `port` 字段。

### 4. 后台运行（PM2）

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start server.js --name cloud-movie

# 开机自启
pm2 save && pm2 startup

# 常用命令
pm2 status              # 状态
pm2 logs cloud-movie    # 日志
pm2 restart cloud-movie # 重启
```

### 5. 配置 Caddy 反代（域名 + HTTPS）

编辑 Caddyfile（位置根据安装方式不同）：
- Ubuntu apt 安装：`/etc/caddy/Caddyfile`
- 二进制安装：项目目录下创建 `Caddyfile`

```caddy
tv.your-domain.com {
    reverse_proxy localhost:8081
}
```

重载：

```bash
# systemd 安装
sudo systemctl reload caddy

# 二进制安装
caddy reload --config /path/to/Caddyfile
```

Caddy 自动申请 Let's Encrypt 证书，访问 `https://tv.your-domain.com` 即可。

> 🚫 如果只用 IP 访问，不需要 Caddy，只需确保服务器安全组放行 **8081** 端口。

---

## 📖 使用指南

### 导入影片

1. 在手机端「和彩云」App 中复制分享链接
2. 在云盘影院左侧点击 **「导入资源」** → 粘贴链接 → 输入提取码（如有）
3. 勾选要导入的文件夹（推荐勾选 `电视剧` 或 `电影` 上级目录）
4. 点击 **「智能导入」**，系统自动完成目录遍历、分组分析、TMDB 刮削，全程无需人工干预

> 💡 视频文件仍存储在网盘云端，播放时直接从网盘 CDN 加载，**服务端零流量消耗**。

### 分类规则

| 文件夹名          | 识别类型                                         |
| ----------------- | ------------------------------------------------ |
| `电视剧`          | 强制按剧集处理                                   |
| `电影`            | 强制按电影处理                                   |
| `动漫`            | 根据文件特征自动判断（单文件=电影，多文件=剧集） |
| `综艺` / `纪录片` | 按剧集处理                                       |
| 其他              | 根据文件名特征自动分析                           |

### 浏览与搜索

- **首页**：按最近添加、分类行展示
- **搜索**：支持中文片名、演员、导演搜索
- **高级筛选**：按评分 (7+/8+/9+)、年代、类型、标签过滤
- **收藏**：点击影片详情页的心形图标
- **历史**：自动记录最近观看的 50 部影片

### 管理员功能

访问管理员面板（默认密码 `admin123`）：

- 查看访客统计（总访客、今日访客、在线人数）
- 查看访客详情（IP、访问次数、浏览页面）
- 刮削失败的影片可手动重新刮削

---

## 🛠 技术架构

```
浏览器 (SPA)
    │
    ├── index.html         单页应用入口
    ├── css/style.css      影院级 UI 样式
    ├── js/
    │   ├── app.js         主控制器（导入流程、状态管理）
    │   ├── scraper.js     智能刮削引擎（TMDB 搜索、标题清洗）
    │   ├── share-parser.js 网盘分享链接解析器
    │   ├── player.js      自定义视频播放器
    │   ├── render.js      UI 渲染
    │   ├── db.js          元数据存储（REST API 封装）
    │   ├── store.js       本地存储（收藏/历史/主题）
    │   └── admin.js       管理员模块
    │
    ▼ HTTP API
server.js (Node.js :8081)
    │
    ├── /api/proxy         代理 → 和彩云分享 API
    ├── /api/tmdb          代理 → TMDB API（支持本地代理隧道）
    ├── /api/movies        CRUD → data/movies.json
    ├── /api/metadata      CRUD → data/metadata.json
    └── /api/admin         管理员接口
```

### 数据存储

- `data/movies.json` — 已导入影片列表（服务端共享）
- `data/metadata.json` — TMDB 刮削元数据（服务端共享）
- `data/visitors.json` — 访客统计
- 浏览器 `localStorage` — 收藏、观看历史、主题偏好

---

## 🎯 自定义字典

如果你网盘中有特殊命名的文件夹，可以在 `js/scraper.js` 的 `MEDIA_NAME_MAP` 中添加映射：

```javascript
const MEDIA_NAME_MAP = {
  山海qing2021: "山海情 (2021)", // 拼音混杂
  "kuang飙 2023": "狂飙 (2023)", // 拼音变形
  "红楼梦 (1987)  陈晓旭": "红楼梦 (1987)", // 带多余信息
  "001.肖申克的救赎.1994.4K.mp4": "肖申克的救赎 (1994)", // 电影文件
};
```

- **电视剧**：key 为文件夹名，value 为 `剧名 (年份)`
- **电影**：key 为文件名（含扩展名），value 为 `片名 (年份)`

---

## 📄 License

MIT © 2026

---

## 🙏 致谢

- [TMDB](https://www.themoviedb.org/) — 电影数据库 API
- [Font Awesome](https://fontawesome.com/) — 图标库
- [hls.js](https://github.com/video-dev/hls.js) — HLS 播放支持
