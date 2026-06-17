/**
 * DB - 影片元数据存储模块
 *
 * 原使用浏览器 IndexedDB（仅当前用户可见）。
 * 现已改为通过服务器 REST API 读写 data/metadata.json，
 * 所有访问者共享同一份刮削数据，无需重复刮削。
 */

const DB = (() => {
    const API_BASE = '/api/metadata';

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

    return {
        async getAll() {
            return await api('');
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
