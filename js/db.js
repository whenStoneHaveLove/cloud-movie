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
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    }

    // 内存缓存（秒级命中）+ IndexedDB（持久化）
    let memCache = null;
    let idbReady = false;

    // 预打开 IndexedDB
    openCache().then(() => { idbReady = true; }).catch(() => {});

    // 缓存 MD5 摘要
    function simpleHash(str) {
        let h = 0;
        for (let i = 0; i < Math.min(str.length, 5000); i++) h = ((h << 5) - h) + str.charCodeAt(i);
        return Math.abs(h).toString(36);
    }

    async function fetchAndCache() {
        const fresh = await api('');
        memCache = fresh;
        const hash = simpleHash(JSON.stringify(fresh));
        if (idbReady) setCache('all', { data: fresh, _hash: hash, _time: Date.now() }).catch(() => {});
        return fresh;
    }

    return {
        async getAll() {
            // 1. 内存缓存（同页面内秒开）
            if (memCache) return memCache;
            // 2. IndexedDB（刷新页面时快速恢复）
            if (idbReady) {
                try {
                    const cached = await getCached('all');
                    if (cached && cached.data) {
                        memCache = cached.data;
                        // 后台更新
                        fetchAndCache().catch(() => {});
                        return cached.data;
                    }
                } catch (e) {}
            }
            // 3. 网络（首次加载）
            return await fetchAndCache();
        },

        async get(id) {
            return await api(id);
        },

        async put(record) {
            return await api(record.id, {
                method: 'PUT',
                body: JSON.stringify(record),
            });
        },

        async batchMerge(records) {
            if (!Array.isArray(records) || records.length === 0) return 0;
            const data = await api('merge', {
                method: 'POST',
                body: JSON.stringify(records),
            });
            return data.added || 0;
        },

        async bulkPut(records) {
            if (!Array.isArray(records) || records.length === 0) return 0;
            return await api('', {
                method: 'PUT',
                body: JSON.stringify(records),
            });
        },

        async delete(id) {
            return await api(id, { method: 'DELETE' });
        },

        async clear() {
            return await api('', { method: 'DELETE' });
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
