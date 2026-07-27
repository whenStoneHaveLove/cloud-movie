/**
 * 播放链接刷新（网盘签名 URL 24h 过期）
 *   - refreshAllUrls / startRefreshTask：定时批量刷新所有影片的 videoUrl（兜底）
 *   - refreshSingleUrl：点播时按需精准刷新单个文件链接（无需遍历整目录）
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

// 获取一个文件夹的全部内容（自动翻页，和导入时的 fetchAllCatalog 一致）
async function fetchAllFiles(linkID, passwd, caId) {
    const allFiles = [];
    const allFolders = [];
    let bNum = 1;
    const PAGE_SIZE = 200;
    let maxPages = 50;

    while (maxPages-- > 0) {
        const payload = {
            getOutLinkInfoReq: {
                account: '',
                linkID: linkID,
                passwd: passwd || '',
                caSrt: 0,
                coSrt: 0,
                srtDr: 1,
                bNum: bNum,
                pCaID: caId || 'root',
                eNum: bNum + PAGE_SIZE - 1,
            }
        };
        const data = await postApi(payload);
        // 响应格式：{ resultCode, desc, data: { coLst, caLst }, success, code }
        const inner = data.data || data;
        const files = inner.coLst || [];
        const folders = bNum === 1 ? (inner.caLst || []) : []; // 只取第一页的文件夹

        allFiles.push(...files);
        if (bNum === 1) allFolders.push(...folders);

        // 如果返回数量不足一页，说明已到末尾
        if (files.length < PAGE_SIZE) break;
        bNum += PAGE_SIZE;
    }
    return { coLst: allFiles, caLst: allFolders };
}

async function buildFileMap(linkID, passwd, caId, depth) {
    if (depth > 5) return {};
    const map = {};
    const data = await fetchAllFiles(linkID, passwd, caId);
    const files = data.coLst || [];
    const folders = data.caLst || [];

    console.log(`  [${depth}] folder=${caId} files=${files.length} folders=${folders.length}` +
        (files.length > 0 ? ` sampleId=${files[0].coID} hasURL=${!!(files[0].presentURL || files[0].cdnDownLoadUrl)}` : ''));

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

/**
 * 刷新单个文件的下载链接（供播放时按需调用）
 * 服务端按 coID + 文件夹 caID 精准列出所在文件夹，取最新签名 URL。
 * @returns {string|null} 新的下载链接，找不到或出错时返回 null
 */
async function refreshSingleUrl(linkID, passwd, fileId, folderId) {
    if (!linkID || !fileId) return null;
    try {
        let fileMap;
        if (folderId) {
            // 精准：只列该文件所在文件夹（1 次请求），按 coID 取最新签名 URL
            const data = await fetchAllFiles(linkID, passwd, folderId);
            fileMap = {};
            for (const f of (data.coLst || [])) {
                if (f.coID) fileMap[f.coID] = f.presentURL || f.cdnDownLoadUrl || '';
            }
        } else {
            // 兜底：旧数据没有 folderId 时，遍历整棵目录
            fileMap = await buildFileMap(linkID, passwd, 'root', 0);
        }
        const url = fileMap[fileId];
        return url || null;
    } catch (e) {
        console.error(`[Refresh] refreshSingleUrl 失败: ${e.message}`);
        return null;
    }
}

/**
 * 定时批量刷新所有影片的播放链接，写入各自 videoUrl（兜底，保证刷新接口偶发失败仍可播放）
 * @returns {number} 更新了多少个链接
 */
async function refreshAllUrls(moviesPath) {
    const filePath = moviesPath || path.join(__dirname, 'data', 'movies.json');
    const movies = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const groups = {};
    for (const m of movies) {
        if (!m._linkID || !m._fileId) continue;
        if (!m.videoUrl || !m.videoUrl.includes('mcloud.139.com')) continue;
        const key = m._linkID + '|' + (m._passwd || '');
        if (!groups[key]) groups[key] = { linkID: m._linkID, passwd: m._passwd, movies: [] };
        groups[key].movies.push(m);
    }

    let updated = 0;
    for (const [key, g] of Object.entries(groups)) {
        try {
            const fileMap = await buildFileMap(g.linkID, g.passwd, 'root', 0);
            for (const m of g.movies) {
                const freshUrl = fileMap[m._fileId];
                if (freshUrl && freshUrl !== m.videoUrl) {
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

function startRefreshTask() {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setInterval(() => {
        refreshAllUrls().catch(e => console.error('[Refresh] 定时刷新失败:', e.message));
    }, TWENTY_FOUR_HOURS);
    console.log('[Refresh] 已启动 24h 定时刷新任务');
}

// 直接运行时执行（node refresh-urls.js）
if (require.main === module) {
    refreshAllUrls().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { refreshAllUrls, refreshSingleUrl, startRefreshTask };
