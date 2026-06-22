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

### 环境要求

- **Node.js** ≥ 14.x （纯内置模块，无需安装任何 npm 包）

### 1. 克隆项目

```bash
git clone https://github.com/whenStoneHaveLove/cloud-movie.git
cd cloud-movie
```

### 2. 配置 TMDB API Key

注册 [TMDB](https://www.themoviedb.org/signup) 账号，在 [API 设置](https://www.themoviedb.org/settings/api) 中申请密钥。

编辑 `config.json`：

```json
{
    "tmdb": {
        "apiKey": "你的TMDB_API_KEY",
        "mirrors": [
            "https://api.themoviedb.org/3",
            "https://api.tmdb.org/3"
        ],
        "timeout": 8000
    },
    "proxy": "127.0.0.1:10808",
    "adminPassword": "admin123"
}
```

| 配置项 | 说明 |
|--------|------|
| `tmdb.apiKey` | **必填**，TMDB API 密钥 |
| `tmdb.mirrors` | TMDB API 镜像地址，国内可修改为代理地址 |
| `tmdb.timeout` | 请求超时时间（毫秒） |
| `proxy` | 本地代理地址（v2rayN/Clash 等），用于访问 TMDB；不需要可留空 |
| `adminPassword` | 管理员登录密码 |

### 3. 启动服务

```bash
node server.js
```

浏览器打开 `http://localhost:8081` 即可使用。

> 💡 端口默认为 **8081**，如需修改请编辑 `server.js` 中的 `PORT` 常量。

### 4. 服务器部署（后台运行）

#### 方式一：PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动（确保在项目目录下）
pm2 start server.js --name cloud-movie

# 设置开机自启
pm2 save
pm2 startup
```

管理命令：
```bash
pm2 status          # 查看运行状态
pm2 logs cloud-movie # 查看日志
pm2 restart cloud-movie  # 重启
```

#### 方式二：nohup（轻量）

```bash
nohup node server.js > server.log 2>&1 &
```

#### 方式三：宝塔面板 / 1Panel

在面板中创建 Node 项目，启动命令填 `node server.js`，端口设为 `8081`。

### 5. 开放端口

确保服务器防火墙/安全组放行 **8081** 端口（或你自定义的端口）：

```bash
# Linux (ufw)
ufw allow 8081

# 云服务器还需在控制台安全组中添加入站规则：TCP 8081
```

部署完成后，通过 `http://你的服务器IP:8081` 即可访问。如需域名，配置 Nginx/Caddy 反代即可。

---

## 📖 使用指南

### 导入影片

1. 在手机端「和彩云」App 中复制分享链接
2. 在云盘影院左侧点击 **「导入资源」** → 粘贴链接 → 输入提取码（如有）
3. 勾选要导入的文件夹（推荐勾选 `电视剧` 或 `电影` 上级目录）
4. 点击 **「智能导入」**，系统自动完成目录遍历、分组分析、TMDB 刮削，全程无需人工干预

> 💡 视频文件仍存储在网盘云端，播放时直接从网盘 CDN 加载，**服务端零流量消耗**。

### 分类规则

| 文件夹名 | 识别类型 |
|----------|----------|
| `电视剧` | 强制按剧集处理 |
| `电影` | 强制按电影处理 |
| `动漫` | 根据文件特征自动判断（单文件=电影，多文件=剧集） |
| `综艺` / `纪录片` | 按剧集处理 |
| 其他 | 根据文件名特征自动分析 |

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
    "山海qing2021": "山海情 (2021)",       // 拼音混杂
    "kuang飙 2023": "狂飙 (2023)",         // 拼音变形
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
