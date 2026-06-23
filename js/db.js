/**
 * DB - 影片元数据存储模块
 *
 * 服务端 data/metadata.json + 浏览器 IndexedDB 缓存。
 * 首次加载后存入本地，后续秒开。
 */

const DB = (() => {
    const API_BASE = '/api/metadata';
    const CACHE_DB = 'CloudMovieCache';
    const CACHE_STORE = 'metadata';
    let cacheReady = false;

    // 打开 IndexedDB 缓存
    function openCache() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(CACHE_DB, 1);
            req.onupgradeneeded = () => { req.result.createObjectStore(CACHE_STORE); };
            req.onsuccess = () => { cacheReady = true; resolve(req.result); };
            req.onerror = () => reject(req.error);
        });
    }

    // 从缓存读
    async function getCached(key) {
        if (!cacheReady) await openCache();
        const db = await openCache();
        return new Promise((resolve) => {
            const tx = db.transaction(CACHE_STORE, 'readonly');
            const req = tx.objectStore(CACHE_STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    }

    // 写入缓存
    async function setCache(key, value) {
        if (!cacheReady) await openCache();
        const db = await openCache();
        const tx = db.transaction(CACHE_STORE, 'readwrite');
        tx.objectStore(CACHE_STORE).put(value, key);
    }

    async function api(path, options = {}) {
        const url = path ? `${API_BASE}/${encodeURIComponent(path)}` : API_BASE;
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (res.status === 304) return { _notModified: true };
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        data._etag = res.headers.get('ETag') || '';
        return data;
    }

    // 内存缓存 + IndexedDB + ETag 条件请求
    let memCache = null;
    let savedETag = null;
    const idbPromise = openCache().then(() => true).catch(() => false);
    idbPromise;

    function simpleHash(str) {
        let h = 0;
        for (let i = 0; i < Math.min(str.length, 5000); i++) h = ((h << 5) - h) + str.charCodeAt(i);
        return Math.abs(h).toString(36);
    }

    // 带 ETag 的条件请求：数据没变返回 null（网络只需要几个字节的 304 响应头）
    async function conditionalFetch(etag) {
        const headers = { 'Content-Type': 'application/json' };
        if (etag) headers['If-None-Match'] = etag;
        const res = await fetch(API_BASE, { headers });
        if (res.status === 304) return null;
        if (!res.ok) return null;
        const data = await res.json();
        savedETag = res.headers.get('ETag') || '';
        return data;
    }

    async function fetchAndCache() {
        const fresh = await conditionalFetch(null);
        if (!fresh) return [];
        memCache = fresh;
        const hash = simpleHash(JSON.stringify(fresh));
        const idbReady = await idbPromise;
        if (idbReady) setCache('all', { data: fresh, _hash: hash, _time: Date.now(), _etag: savedETag }).catch(() => {});
        return fresh;
    }

    return {
        async getAll() {
            if (memCache) return memCache;
            const idbReady = await idbPromise;
            if (idbReady) {
                try {
                    const cached = await getCached('all');
                    if (cached && cached.data && cached.data.length) {
                        console.log('[DB] 命中 IndexedDB 缓存: ' + cached.data.length + ' 条');
                        memCache = cached.data;
                        savedETag = cached._etag || '';
                        conditionalFetch(savedETag).then(fresh => {
                            if (fresh) {
                                console.log('[DB] 后台更新: ' + fresh.length + ' 条');
                                memCache = fresh;
                                const hash = simpleHash(JSON.stringify(fresh));
                                setCache('all', { data: fresh, _hash: hash, _time: Date.now(), _etag: savedETag }).catch(() => {});
                            } else {
                                console.log('[DB] 后台检查: 数据未变化 (304)');
                            }
                        }).catch(() => {});
                        return cached.data;
                    }
                    // 缓存存在但为空 → 清掉，走网络
                    if (cached && cached.data) {
                        console.log('[DB] 缓存为空数组，清除并走网络');
                        savedETag = null;
                    }
                } catch (e) { console.log('[DB] 缓存读取失败:', e); }
            }
            console.log('[DB] 走网络加载...');
            return await fetchAndCache();
        },

        async get(id) {
            return await api(id);
        },

        // 写入失效缓存（下次 getAll 会走条件请求刷新）
        _invalidate() {
            memCache = null;
            savedETag = null;
        },

        async put(record) {
            const result = await api(record.id, {
                method: 'PUT',
                body: JSON.stringify(record),
            });
            this._invalidate();
            return result;
        },

        async batchMerge(records) {
            if (!Array.isArray(records) || records.length === 0) return 0;
            const data = await api('merge', {
                method: 'POST',
                body: JSON.stringify(records),
            });
            this._invalidate();
            return data.added || 0;
        },

        async bulkPut(records) {
            if (!Array.isArray(records) || records.length === 0) return 0;
            const result = await api('', {
                method: 'PUT',
                body: JSON.stringify(records),
            });
            this._invalidate();
            return result;
        },

        async delete(id) {
            const result = await api(id, { method: 'DELETE' });
            this._invalidate();
            return result;
        },

        async clear() {
            const result = await api('', { method: 'DELETE' });
            this._invalidate();
            return result;
        },

        async count() {
            const all = await this.getAll();
            return all.length;
        },

        async getByIndex(indexName, value) {
            const all = await this.getAll();
            return all.filter(r => r[indexName] === value);
        },
    };
})();
