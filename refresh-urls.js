/**
 * 定时刷新所有影片的播放链接（网盘签名 URL 24h 过期）
 *
 * 用法：
 *   1. 独立执行：node refresh-urls.js
 *   2. server.js 自动调用：require('./refresh-urls.js').refreshAllUrls()
 */
const fs = require('fs');
const https = require('https');
const path = require('path');
const zlib = require('zlib');

const API_URL = 'https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6';

function postApi(body) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_URL);
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'Content-Length': Buffer.byteLength(data),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://yun.139.com',
                'Referer': 'https://yun.139.com/shareweb/',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Connection': 'keep-alive',
                'x-yun-channel-source': 'web',
                'x-yun-app-channel': 'web',
            },
        }, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks);
                    let buf = raw;
                    if (res.headers['content-encoding'] === 'gzip') {
                        buf = zlib.gunzipSync(raw);
                    }
                    resolve(JSON.parse(buf.toString()));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(data);
        req.end();
    });
}

async function fetchFolderContents(linkID, passwd, caId) {
    const payload = {
        getOutLinkInfoReq: {
            account: '',
            linkID: linkID,
            passwd: passwd || '',
            caSrt: 0,
            coSrt: 0,
            srtDr: 1,
            bNum: 1,
            pCaID: caId || 'root',
            eNum: 5000,
        }
    };
    return await postApi(payload);
}

async function buildFileMap(linkID, passwd, caId, depth) {
    if (depth > 5) return {};
    const map = {};
    const data = await fetchFolderContents(linkID, passwd, caId);
    const files = data.coLst || [];
    const folders = data.caLst || [];

    for (const f of files) {
        if (f.coID) {
            map[f.coID] = f.presentURL || f.cdnDownLoadUrl || '';
        }
    }
    for (const f of folders) {
        const sub = await buildFileMap(linkID, passwd, f.caID, depth + 1);
        Object.assign(map, sub);
    }
    return map;
}

async function refreshAllUrls(moviesPath) {
    const filePath = moviesPath || path.join(__dirname, 'data', 'movies.json');
    console.log('[Refresh] 读取 ' + filePath);
    const movies = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // 按 linkID 分组
    const groups = {};
    for (const m of movies) {
        if (!m._linkID || !m._fileId) continue;
        if (!m.videoUrl || !m.videoUrl.includes('mcloud.139.com')) continue;
        const key = m._linkID + '|' + (m._passwd || '');
        if (!groups[key]) groups[key] = { linkID: m._linkID, passwd: m._passwd, movies: [] };
        groups[key].movies.push(m);
    }

    const groupEntries = Object.entries(groups);
    if (groupEntries.length === 0) {
        console.log('[Refresh] 没有需要刷新的影片');
        return 0;
    }
    console.log(`[Refresh] ${groupEntries.length} 个分享链接，共 ${movies.filter(m => m._linkID && m.videoUrl && m.videoUrl.includes('mcloud.139.com')).length} 部影片`);

    let updated = 0;
    for (const [key, g] of groupEntries) {
        console.log(`[Refresh] 处理 ${g.movies.length} 部影片, linkID=${g.linkID}`);
        try {
            const fileMap = await buildFileMap(g.linkID, g.passwd, 'root', 0);
            for (const m of g.movies) {
                const freshUrl = fileMap[m._fileId];
                if (freshUrl && freshUrl !== m.videoUrl) {
                    console.log(`  更新: ${m.title}`);
                    m.videoUrl = freshUrl;
                    updated++;
                }
            }
        } catch (e) {
            console.error(`[Refresh] 失败: ${key}`, e.message);
        }
    }

    fs.writeFileSync(filePath, JSON.stringify(movies, null, 2), 'utf8');
    console.log(`[Refresh] 完成，更新了 ${updated} 个链接`);
    return updated;
}

// 直接运行时执行
if (require.main === module) {
    refreshAllUrls().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { refreshAllUrls };
