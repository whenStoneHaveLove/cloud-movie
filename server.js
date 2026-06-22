const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const url = require('url'); // 保留用于 http-proxy-agent 依赖，代码本体用 WHATWG URL

// Load config (必须在 PORT 之前)
let CONFIG = {};
try {
    CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (e) {
    console.warn('config.json not found or invalid, using defaults');
}

const PORT = CONFIG.port || process.env.PORT || 8081;
const STATIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const VISITORS_FILE = 'visitors.json';
const ONLINE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// ===== Visitor Tracking =====

function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx > -1) {
            cookies[pair.substring(0, idx).trim()] = pair.substring(idx + 1).trim();
        }
    });
    return cookies;
}

function generateVisitorId() {
    return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
}

function trackVisitor(req, res, pagePath) {
    const cookies = parseCookies(req);
    let visitorId = cookies.cm_visitor_id;

    if (!visitorId) {
        visitorId = generateVisitorId();
        res.setHeader('Set-Cookie', `cm_visitor_id=${visitorId}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`);
    }

    const now = Date.now();
    const ip = getClientIP(req);
    const userAgent = (req.headers['user-agent'] || '').substring(0, 200);

    const data = readJSON(VISITORS_FILE, { visitors: {}, sessions: {}, pageStats: {} });

    // Update visitor
    if (!data.visitors[visitorId]) {
        data.visitors[visitorId] = {
            id: visitorId,
            ip,
            userAgent,
            firstVisit: now,
            lastVisit: now,
            visitCount: 1,
            pages: {},
        };
    } else {
        const v = data.visitors[visitorId];
        v.ip = ip;
        v.userAgent = userAgent;
        v.lastVisit = now;
        v.visitCount = (v.visitCount || 0) + 1;
    }

    // Update page count
    const v = data.visitors[visitorId];
    v.pages[pagePath] = (v.pages[pagePath] || 0) + 1;

    // Update global page stats
    data.pageStats[pagePath] = (data.pageStats[pagePath] || 0) + 1;

    // Update session
    data.sessions[visitorId] = now;

    // Clean up stale sessions
    for (const [vid, timestamp] of Object.entries(data.sessions)) {
        if (now - timestamp > ONLINE_TIMEOUT) {
            delete data.sessions[vid];
        }
    }

    writeJSON(VISITORS_FILE, data);
}

function getVisitorStats() {
    const data = readJSON(VISITORS_FILE, { visitors: {}, sessions: {}, pageStats: {} });
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const visitors = Object.values(data.visitors);
    const todayVisitors = visitors.filter(v => v.lastVisit >= todayMs).length;

    // Top pages
    const topPages = Object.entries(data.pageStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([path, count]) => ({ path, count }));

    return {
        totalVisitors: visitors.length,
        todayVisitors,
        onlineCount: Object.keys(data.sessions).length,
        totalVisits: visitors.reduce((sum, v) => sum + (v.visitCount || 0), 0),
        topPages,
    };
}

function getVisitorList() {
    const data = readJSON(VISITORS_FILE, { visitors: {}, sessions: {} });
    const now = Date.now();
    const sessions = data.sessions || {};

    return Object.values(data.visitors)
        .map(v => ({
            id: v.id,
            ip: v.ip,
            firstVisit: v.firstVisit,
            lastVisit: v.lastVisit,
            visitCount: v.visitCount || 1,
            online: (now - (sessions[v.id] || 0)) < ONLINE_TIMEOUT,
            topPages: Object.entries(v.pages || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
        }))
        .sort((a, b) => b.lastVisit - a.lastVisit);
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ===== Simple JSON file DB =====

const fileLocks = {};

/**
 * Read a JSON file, return parsed data or a default value.
 */
function readJSON(fileName, defaultValue) {
    const filePath = path.join(DATA_DIR, fileName);
    try {
        if (!fs.existsSync(filePath)) return defaultValue;
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error(`readJSON(${fileName}) error:`, e.message);
        return defaultValue;
    }
}

/**
 * Write a JSON file atomically (write to .tmp then rename).
 */
function writeJSON(fileName, data) {
    const filePath = path.join(DATA_DIR, fileName);
    const tmpPath = filePath + '.tmp';

    if (!fileLocks[fileName]) fileLocks[fileName] = Promise.resolve();
    // Queue writes to prevent corruption
    fileLocks[fileName] = fileLocks[fileName].then(() => {
        return new Promise((resolve, reject) => {
            try {
                fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
                fs.renameSync(tmpPath, filePath);
                resolve();
            } catch (e) {
                console.error(`writeJSON(${fileName}) error:`, e.message);
                reject(e);
            }
        });
    });
    return fileLocks[fileName];
}

// ===== Metadata API =====

const META_FILE = 'metadata.json';
const MOVIES_FILE = 'movies.json';

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : null);
            } catch (e) {
                reject(new Error('Invalid JSON: ' + e.message));
            }
        });
        req.on('error', reject);
    });
}

function sendJSON(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

/**
 * Handle /api/metadata routes
 */
async function handleMetadata(req, res) {
    const method = req.method;
    // Path: /api/metadata or /api/metadata/meta-xxx
    const rawPath = req.url.replace('/api/metadata', '');
    const id = rawPath.replace(/^\/+/, '') || null;  // e.g. "meta-xxx" or empty

    try {
        // /api/metadata/merge - 批量追加不覆盖
        if (id === 'merge') {
            if (method !== 'POST') return sendJSON(res, 405, { error: 'Use POST for merge' });
            const newRecords = await readBody(req);
            if (!Array.isArray(newRecords)) return sendJSON(res, 400, { error: 'Expected array' });
            console.log('[Server] metadata/merge: 收到 ' + newRecords.length + ' 条记录');
            const all = readJSON(META_FILE, []);
            console.log('[Server] metadata/merge: 已有 ' + all.length + ' 条, 合并中...');
            const idMap = new Map(all.map(r => [r.id, r]));
            let added = 0;
            for (const rec of newRecords) {
                if (!rec.id) continue;
                idMap.set(rec.id, rec);
                added++;
            }
            const result = [...idMap.values()];
            await writeJSON(META_FILE, result);
            console.log('[Server] metadata/merge: 完成, 新增 ' + added + ' 条, 总数 ' + result.length);
            return sendJSON(res, 200, { ok: true, added });
        }

        if (!id) {
            // /api/metadata
            if (method === 'GET') {
                const data = readJSON(META_FILE, []);
                sendJSON(res, 200, data);
            } else if (method === 'PUT') {
                // Bulk replace (for bulk import)
                const records = await readBody(req);
                if (!Array.isArray(records)) {
                    return sendJSON(res, 400, { error: 'Expected array of records' });
                }
                await writeJSON(META_FILE, records);
                sendJSON(res, 200, { ok: true, count: records.length });
            } else if (method === 'DELETE') {
                await writeJSON(META_FILE, []);
                sendJSON(res, 200, { ok: true });
            } else {
                sendJSON(res, 405, { error: 'Method not allowed' });
            }
        } else {
            // /api/metadata/:id
            const all = readJSON(META_FILE, []);
            const idx = all.findIndex(r => r.id === id);

            if (method === 'GET') {
                if (idx >= 0) sendJSON(res, 200, all[idx]);
                else sendJSON(res, 404, { error: 'Not found' });
            } else if (method === 'PUT') {
                const record = await readBody(req);
                if (!record || !record.id) {
                    return sendJSON(res, 400, { error: 'Record must have an id' });
                }
                record.id = id; // ensure id matches URL
                if (idx >= 0) all[idx] = record;
                else all.push(record);
                await writeJSON(META_FILE, all);
                sendJSON(res, 200, { ok: true });
            } else if (method === 'DELETE') {
                if (idx >= 0) {
                    all.splice(idx, 1);
                    await writeJSON(META_FILE, all);
                    sendJSON(res, 200, { ok: true });
                } else {
                    sendJSON(res, 404, { error: 'Not found' });
                }
            } else {
                sendJSON(res, 405, { error: 'Method not allowed' });
            }
        }
    } catch (e) {
        console.error('Metadata API error:', e.message);
        sendJSON(res, 500, { error: e.message });
    }
}

/**
 * Handle /api/movies routes
 */
async function handleMovies(req, res) {
    const method = req.method;

    try {
        if (method === 'GET') {
            const data = readJSON(MOVIES_FILE, []);
            sendJSON(res, 200, data);
        } else if (method === 'PUT') {
            const movies = await readBody(req);
            if (!Array.isArray(movies)) {
                return sendJSON(res, 400, { error: 'Expected array of movies' });
            }
            console.log('[Server] movies PUT: 保存 ' + movies.length + ' 部影片');
            await writeJSON(MOVIES_FILE, movies);
            console.log('[Server] movies PUT: 完成');
            sendJSON(res, 200, { ok: true, count: movies.length });
        } else {
            sendJSON(res, 405, { error: 'Method not allowed' });
        }
    } catch (e) {
        console.error('Movies API error:', e.message);
        sendJSON(res, 500, { error: e.message });
    }
}

const TMDB_API_KEY = CONFIG.tmdb?.apiKey || process.env.TMDB_API_KEY || '';
const ADMIN_PASSWORD = CONFIG.adminPassword || process.env.ADMIN_PASSWORD || 'admin123';

// Admin tokens (in-memory, resets on server restart)
const adminTokens = new Set();

function generateToken() {
    return 'adm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 15);
}

// ===== Admin API =====

async function handleAdmin(req, res) {
    const method = req.method;
    const adminPath = req.url.replace('/api/admin', '');

    try {
        // Login
        if (adminPath === '/login' && method === 'POST') {
            const body = await readBody(req);
            if (body && body.password === ADMIN_PASSWORD) {
                const token = generateToken();
                adminTokens.add(token);
                // Clean old tokens if too many
                if (adminTokens.size > 20) {
                    const arr = [...adminTokens];
                    adminTokens.clear();
                    arr.slice(-10).forEach(t => adminTokens.add(t));
                }
                sendJSON(res, 200, { ok: true, token });
            } else {
                sendJSON(res, 401, { error: '密码错误' });
            }
            return;
        }

        // Verify token
        if (adminPath === '/verify' && method === 'POST') {
            const body = await readBody(req);
            if (body && body.token && adminTokens.has(body.token)) {
                sendJSON(res, 200, { ok: true });
            } else {
                sendJSON(res, 401, { error: '未登录或登录已过期' });
            }
            return;
        }

        // Logout
        if (adminPath === '/logout' && method === 'POST') {
            const body = await readBody(req);
            if (body && body.token) adminTokens.delete(body.token);
            sendJSON(res, 200, { ok: true });
            return;
        }

        // All other admin endpoints require auth
        const authHeader = req.headers['authorization'] || '';
        const cookies = parseCookies(req);
        const token =
            authHeader.replace('Bearer ', '') ||
            cookies.cm_admin_token || '';

        // Also check body for token
        let bodyToken = '';
        if (method === 'POST' || method === 'PUT') {
            try {
                const body = await readBody(req);
                bodyToken = body?.token || '';
            } catch (e) { /* ignore */ }
        }
        const effectiveToken = token || bodyToken;

        if (!effectiveToken || !adminTokens.has(effectiveToken)) {
            return sendJSON(res, 401, { error: '需要管理员权限' });
        }

        // Stats
        if (adminPath === '/stats' && method === 'GET') {
            return sendJSON(res, 200, getVisitorStats());
        }

        // Visitor list
        if (adminPath === '/visitors' && method === 'GET') {
            return sendJSON(res, 200, getVisitorList());
        }

        // Backup data
        if (adminPath === '/backup' && method === 'POST') {
            try {
                const backupDir = path.join(DATA_DIR, 'backups');
                if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const movieData = readJSON(MOVIES_FILE, []);
                const metaData = readJSON(META_FILE, []);
                fs.writeFileSync(path.join(backupDir, `${timestamp}_movies.json`), JSON.stringify(movieData, null, 2), 'utf-8');
                fs.writeFileSync(path.join(backupDir, `${timestamp}_metadata.json`), JSON.stringify(metaData, null, 2), 'utf-8');
                console.log(`[Admin] 备份完成: ${timestamp} (${movieData.length} 影片, ${metaData.length} 元数据)`);
                return sendJSON(res, 200, { ok: true, timestamp, movies: movieData.length, metadata: metaData.length });
            } catch (e) {
                console.error('Backup error:', e.message);
                return sendJSON(res, 500, { error: '备份失败: ' + e.message });
            }
        }

        // List backups
        if (adminPath === '/backups' && method === 'GET') {
            try {
                const backupDir = path.join(DATA_DIR, 'backups');
                if (!fs.existsSync(backupDir)) return sendJSON(res, 200, { backups: [] });
                const files = fs.readdirSync(backupDir);
                const timestamps = [...new Set(files.map(f => f.split('_')[0]))].sort().reverse();
                const backups = timestamps.map(ts => {
                    const moviePath = path.join(backupDir, `${ts}_movies.json`);
                    const metaPath = path.join(backupDir, `${ts}_metadata.json`);
                    let movieCount = 0, metaCount = 0;
                    try { if (fs.existsSync(moviePath)) movieCount = JSON.parse(fs.readFileSync(moviePath, 'utf-8')).length; } catch(e){}
                    try { if (fs.existsSync(metaPath)) metaCount = JSON.parse(fs.readFileSync(metaPath, 'utf-8')).length; } catch(e){}
                    return {
                        timestamp: ts,
                        label: ts.replace('T', ' ').replace(/-/g, ':').replace(/:(\d{2})-(\d{2})$/, ':$1:$2'),
                        movieCount,
                        metaCount,
                    };
                });
                return sendJSON(res, 200, { backups });
            } catch (e) {
                return sendJSON(res, 500, { error: '读取备份列表失败: ' + e.message });
            }
        }

        // Restore from backup (body: { timestamp: "2026-06-17T00-00-00-000Z" })
        if (adminPath === '/restore' && method === 'POST') {
            try {
                const body = await readBody(req);
                const ts = body && body.timestamp;
                if (!ts) return sendJSON(res, 400, { error: '请指定要恢复的备份时间戳' });
                const backupDir = path.join(DATA_DIR, 'backups');
                const movieBackup = path.join(backupDir, `${ts}_movies.json`);
                const metaBackup = path.join(backupDir, `${ts}_metadata.json`);
                if (!fs.existsSync(movieBackup) || !fs.existsSync(metaBackup)) {
                    return sendJSON(res, 404, { error: '备份文件不存在: ' + ts });
                }
                // Restore
                const movieData = JSON.parse(fs.readFileSync(movieBackup, 'utf-8'));
                const metaData = JSON.parse(fs.readFileSync(metaBackup, 'utf-8'));
                await writeJSON(MOVIES_FILE, movieData);
                await writeJSON(META_FILE, metaData);
                console.log(`[Admin] 恢复完成: ${ts} (${movieData.length} 影片, ${metaData.length} 元数据)`);
                return sendJSON(res, 200, { ok: true, movies: movieData.length, metadata: metaData.length });
            } catch (e) {
                console.error('Restore error:', e.message);
                return sendJSON(res, 500, { error: '恢复失败: ' + e.message });
            }
        }

        sendJSON(res, 404, { error: 'Admin API not found' });

    } catch (e) {
        console.error('Admin API error:', e.message);
        sendJSON(res, 500, { error: e.message });
    }
}

// Multiple TMDB API mirrors for China network compatibility
const TMDB_MIRRORS = CONFIG.tmdb?.mirrors || [
    'https://api.themoviedb.org/3',
    'https://api.tmdb.org/3',
];
const TMDB_TIMEOUT = CONFIG.tmdb?.timeout || 12000; // 12 second timeout per mirror

// Local proxy for bypassing GFW (v2rayN, Clash, etc.)
const LOCAL_PROXY = CONFIG.proxy || process.env.HTTP_PROXY || '';
const PROXY_HOST = LOCAL_PROXY.split(':')[0] || '127.0.0.1';
const PROXY_PORT = parseInt(LOCAL_PROXY.split(':')[1]) || 10808;

/**
 * Create an HTTP CONNECT tunnel through local proxy (v2rayN/Clash)
 * @returns {Promise<net.Socket>}
 */
function createProxyTunnel(host, port) {
    return new Promise((resolve, reject) => {
        const connectReq = http.request({
            hostname: PROXY_HOST,
            port: PROXY_PORT,
            method: 'CONNECT',
            path: `${host}:${port}`,
            timeout: 5000,
        });
        connectReq.on('connect', (res, socket) => {
            if (res.statusCode === 200) {
                resolve(socket);
            } else {
                socket.destroy();
                reject(new Error(`Proxy tunnel failed: ${res.statusCode}`));
            }
        });
        connectReq.on('error', reject);
        connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('Proxy tunnel timeout')); });
        connectReq.end();
    });
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
    let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url);
    filePath = filePath.split('?')[0];

    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

function proxyApi(req, res) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const defaultTarget = 'https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6';
    const targetUrl = parsedUrl.searchParams.get('target') || defaultTarget;

    let responded = false;

    function safeRespond(statusCode, headers, body) {
        if (responded) return;
        responded = true;
        try {
            res.writeHead(statusCode, headers);
            res.end(body);
        } catch (e) {
            console.error('proxyApi safeRespond error:', e.message);
        }
    }

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        try {
        const body = Buffer.concat(chunks);
        const clientContentType = req.headers['content-type'] || 'application/json;charset=UTF-8';

        const proxyReq = https.request(targetUrl, {
            method: 'POST',
            timeout: 15000,
            headers: {
                'Content-Type': clientContentType,
                'Content-Length': body.length,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
                'Origin': 'https://yun.139.com',
                'Referer': 'https://yun.139.com/shareweb/',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Connection': 'keep-alive',
                'x-yun-channel-source': 'web',
                'x-yun-app-channel': 'web',
            },
        }, (proxyRes) => {
            if (responded) { proxyRes.resume(); return; }

            const resChunks = [];
            proxyRes.on('data', chunk => resChunks.push(chunk));
            proxyRes.on('error', (e) => {
                console.error('Proxy response stream error:', e.message);
                safeRespond(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                    JSON.stringify({ error: '上游响应中断: ' + e.message }));
            });
            proxyRes.on('end', () => {
                const rawBuf = Buffer.concat(resChunks);
                const encoding = proxyRes.headers['content-encoding'];

                // console.log('Share API proxy:', proxyRes.statusCode, 'len:', rawBuf.length); // 静默，避免刷屏

                let finalBuf = rawBuf;
                try {
                    if (encoding === 'gzip') finalBuf = zlib.gunzipSync(rawBuf);
                    else if (encoding === 'deflate') finalBuf = zlib.inflateSync(rawBuf);
                    else if (encoding === 'br') finalBuf = zlib.brotliDecompressSync(rawBuf);
                } catch (e) {
                    console.error('Decompression error:', e.message);
                    // Fall through with raw buffer
                }

                const upstreamContentType = proxyRes.headers['content-type'] || 'application/json; charset=utf-8';
                safeRespond(proxyRes.statusCode, {
                    'Content-Type': upstreamContentType,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }, finalBuf);
            });
        });

        proxyReq.on('timeout', () => {
            if (!responded) {
                console.warn('Share API proxy timeout -> destroying request');
                proxyReq.destroy();
                safeRespond(504, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                    JSON.stringify({ error: '上游 API 请求超时 (15s)' }));
            }
        });

        proxyReq.on('error', (e) => {
            if (!responded) {
                console.error('Proxy request error:', e.message);
                safeRespond(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                    JSON.stringify({ error: e.message }));
            }
        });

        proxyReq.write(body);
        proxyReq.end();
        } catch (e) {
            console.error('proxyApi handler error:', e.message, e.stack);
            safeRespond(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                JSON.stringify({ error: '内部错误: ' + e.message }));
        }
    });

    req.on('error', (e) => {
        console.error('Client request error:', e.message);
        safeRespond(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            JSON.stringify({ error: '客户端连接中断' }));
    });
}

// TMDB API proxy with local proxy tunnel + multi-mirror fallback
function proxyTmdb(req, res) {
    if (!TMDB_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'TMDB API Key not configured. Add your key to config.json' }));
        return;
    }

    // Extract TMDB path: /api/tmdb/search/multi -> /search/multi
    const tmdbPath = req.url.replace(/^\/api\/tmdb/, '');
    const parsedUrl = new URL(tmdbPath, 'http://localhost');

    // Add API key to query params
    const queryParams = Object.fromEntries(parsedUrl.searchParams);
    queryParams.api_key = TMDB_API_KEY;
    const queryString = new URLSearchParams(queryParams).toString();

    let responded = false;

    function safeRespond(statusCode, headers, body) {
        if (responded) return;
        responded = true;
        try { res.writeHead(statusCode, headers); res.end(body); }
        catch (e) { console.error('TMDB safeRespond error:', e.message); }
    }

    // Strategy 1: Try local proxy tunnel (v2rayN/Clash)
    async function tryViaProxy() {
        let tunnelSocket;
        try {
            tunnelSocket = await createProxyTunnel('api.tmdb.org', 443);
        } catch (e) {
            console.warn('Local proxy tunnel failed:', e.message, '-> falling back to direct');
            await tryDirectMirrors();
            return;
        }

        // Send request through tunnel - use TLS over the CONNECT socket
        const reqPath = parsedUrl.pathname + '?' + queryString;
        const tlsSock = tls.connect({
            socket: tunnelSocket,
            servername: 'api.tmdb.org',
            rejectUnauthorized: false,
        });

        const tmdbReq = https.request({
            hostname: 'api.tmdb.org',
            path: reqPath,
            method: 'GET',
            timeout: TMDB_TIMEOUT,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'CloudMovie/1.0',
                'Host': 'api.tmdb.org',
            },
            createConnection: () => tlsSock,
        }, (proxyRes) => {
            if (responded) { proxyRes.resume(); return; }

            const chunks = [];
            proxyRes.on('data', chunk => chunks.push(chunk));
            proxyRes.on('error', (e) => {
                console.error('TMDB proxy stream error:', e.message);
                safeRespond(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                    JSON.stringify({ error: 'TMDB 响应中断' }));
            });
            proxyRes.on('end', () => {
                const rawBuf = Buffer.concat(chunks);
                const encoding = proxyRes.headers['content-encoding'];

                let finalBuf = rawBuf;
                try {
                    if (encoding === 'gzip') finalBuf = zlib.gunzipSync(rawBuf);
                    else if (encoding === 'deflate') finalBuf = zlib.inflateSync(rawBuf);
                } catch (e) {
                    console.error('TMDB decompression error:', e.message);
                }

                // console.log('TMDB proxy OK:', proxyRes.statusCode, parsedUrl.pathname, 'via local proxy');

                safeRespond(proxyRes.statusCode, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=3600',
                }, finalBuf);
            });
        });

        tmdbReq.on('timeout', () => {
            if (!responded) {
                console.warn('TMDB proxy request timeout -> trying direct mirrors');
                tmdbReq.destroy();
                tlsSock.destroy();
                tryDirectMirrors();
            }
        });

        tmdbReq.on('error', (e) => {
            if (!responded) {
                console.warn('TMDB proxy request error:', e.message, '-> trying direct mirrors');
                tlsSock.destroy();
                tryDirectMirrors();
            }
        });

        tlsSock.on('error', (e) => {
            if (!responded) {
                console.warn('TLS socket error:', e.message);
            }
        });

        tmdbReq.end();
    }

    // Strategy 2: Direct connection with mirror fallback (original behavior)
    async function tryDirectMirrors() {
        console.log('[TMDB] 开始直连，共 ' + TMDB_MIRRORS.length + ' 个镜像');
        for (let i = 0; i < TMDB_MIRRORS.length; i++) {
            if (responded) return;

            const baseUrl = TMDB_MIRRORS[i];
            const targetUrl = baseUrl + parsedUrl.pathname + '?' + queryString;

            console.log('[TMDB] 直连尝试 ' + (i+1) + '/' + TMDB_MIRRORS.length + ': ' + baseUrl);

            await new Promise((resolve) => {
                const target = new URL(targetUrl);
                const proxyReq = https.request({
                    hostname: target.hostname,
                    path: target.pathname + target.search,
                    method: 'GET',
                    timeout: TMDB_TIMEOUT,   // 数据传输空闲超时
                    connectTimeout: 6000,    // TCP 连接建立超时 (Node 22+)
                    family: 4,               // 强制 IPv4，避免 IPv6 超时
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'CloudMovie/1.0',
                    },
                }, (proxyRes) => {
                    if (responded) { proxyRes.resume(); resolve(); return; }
                    responded = true;

                    const chunks = [];
                    proxyRes.on('data', chunk => chunks.push(chunk));
                    proxyRes.on('error', (e) => {
                        console.error('TMDB direct stream error:', e.message);
                        safeRespond(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            JSON.stringify({ error: 'TMDB 响应中断' }));
                        resolve();
                    });
                    proxyRes.on('end', () => {
                        const rawBuf = Buffer.concat(chunks);
                        const encoding = proxyRes.headers['content-encoding'];

                        let finalBuf = rawBuf;
                        try {
                            if (encoding === 'gzip') finalBuf = zlib.gunzipSync(rawBuf);
                            else if (encoding === 'deflate') finalBuf = zlib.inflateSync(rawBuf);
                        } catch (e) {
                            console.error('TMDB decompression error:', e.message);
                        }

                        // console.log('TMDB direct OK:', proxyRes.statusCode, parsedUrl.pathname, 'via', baseUrl);

                        safeRespond(proxyRes.statusCode, {
                            'Content-Type': 'application/json; charset=utf-8',
                            'Access-Control-Allow-Origin': '*',
                            'Cache-Control': 'public, max-age=3600',
                        }, finalBuf);
                        resolve();
                    });
                });

                proxyReq.on('timeout', () => {
                    if (!responded) {
                        console.warn('TMDB direct timeout:', baseUrl, '(连接/读写超时)');
                        proxyReq.destroy(new Error('timeout'));
                    }
                    resolve();
                });

                proxyReq.on('error', (e) => {
                    if (!responded) {
                        console.warn('TMDB direct error:', baseUrl, 'code=' + (e.code || '?'), 'msg=' + e.message);
                    }
                    resolve();
                });

                // 手动连接超时（兼容不支持 connectTimeout 的 Node.js 版本）
                const connTimer = setTimeout(() => {
                    if (!responded) {
                        console.warn('TMDB connection timeout:', baseUrl, '(TCP 连接超时)');
                        proxyReq.destroy(new Error('connection timeout'));
                        resolve();
                    }
                }, 8000);

                // 监听 socket 级别的错误
                proxyReq.on('socket', (sock) => {
                    clearTimeout(connTimer); // socket 建立成功，清除连接超时
                    sock.on('error', (e) => {
                        console.warn('TMDB socket error:', baseUrl, 'code=' + (e.code || '?'), 'msg=' + e.message);
                    });
                });

                proxyReq.end();
            });
        }

        // All mirrors exhausted
        if (!responded) {
            console.error('TMDB: All mirrors failed');
            safeRespond(502, { 'Content-Type': 'application/json' },
                JSON.stringify({ error: 'TMDB API 所有方式均不可达。请确认本地代理已开启' }));
        }
    }

    console.log('[TMDB] 请求 ' + parsedUrl.pathname + ' | 代理=' + (LOCAL_PROXY ? LOCAL_PROXY : '未配置→直连'));

    // Start with local proxy tunnel（仅当配置了代理时）
    if (LOCAL_PROXY) {
        console.log('[TMDB] 策略1: 走本地代理 ' + LOCAL_PROXY);
        tryViaProxy().catch((e) => {
            console.error('TMDB tryViaProxy unhandled error:', e.message);
            if (!responded) tryDirectMirrors();
        });
    } else {
        console.log('[TMDB] 策略2: 直连 TMDB 镜像');
        tryDirectMirrors();
    }
}

// Serve config status (not the key itself)
function configStatus(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        tmdbConfigured: !!TMDB_API_KEY,
        proxy: LOCAL_PROXY,
    }));
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Track page views (non-API, non-static-asset paths)
    const pagePath = req.url.split('?')[0];
    const isApi = pagePath.startsWith('/api/');
    const isAsset = /\.(js|css|png|jpg|svg|ico|woff2?|ttf|map)$/i.test(pagePath);

    if (!isApi && !isAsset) {
        trackVisitor(req, res, pagePath);
    }

    if (req.url.startsWith('/api/admin')) {
        handleAdmin(req, res);
    } else if (req.url.startsWith('/api/track') && req.method === 'POST') {
        // Client-side SPA page tracking
        try {
            const body = await readBody(req);
            if (body && body.page) {
                trackVisitor(req, res, '#' + body.page);
            }
            sendJSON(res, 200, { ok: true });
        } catch (e) {
            sendJSON(res, 200, { ok: false, error: e.message });
        }
    } else if (req.url.startsWith('/api/metadata')) {
        handleMetadata(req, res);
    } else if (req.url.startsWith('/api/movies')) {
        handleMovies(req, res);
    } else if (req.url.startsWith('/api/proxy')) {
        proxyApi(req, res);
    } else if (req.url.startsWith('/api/tmdb')) {
        proxyTmdb(req, res);
    } else if (req.url === '/api/config') {
        configStatus(req, res);
    } else {
        serveStatic(req, res);
    }
});

// Handle malformed client requests without crashing
server.on('clientError', (err, socket) => {
    console.error('Client error:', err.message);
    if (socket.writable) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
});

// Global error handlers - prevent server crashes
process.on('uncaughtException', (err) => {
    console.error('=== Uncaught Exception (server stays alive) ===');
    console.error(err.stack || err.message || err);
});

process.on('unhandledRejection', (reason) => {
    console.error('=== Unhandled Rejection (server stays alive) ===');
    console.error(reason);
});

server.listen(PORT, () => {
    console.log(`云盘影院服务器已启动: http://localhost:${PORT}`);
    console.log(`TMDB API Key: ${TMDB_API_KEY ? '已配置 ✓' : '未配置 ✗ (请在 config.json 中添加 apiKey)'}`);
    console.log(`本地代理: ${LOCAL_PROXY || '未配置（TMDB将直连，国内服务器建议配置代理）'}`);
    console.log(`TMDB 镜像: ${TMDB_MIRRORS.join(', ')}`);
    console.log(`TMDB 超时: ${TMDB_TIMEOUT}ms`);
    console.log('按 Ctrl+C 停止');
});
