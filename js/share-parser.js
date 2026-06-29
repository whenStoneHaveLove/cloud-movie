/**
 * ShareParser - 移动云盘分享链接解析器
 * 支持懒加载目录树浏览，按需获取子目录内容
 */
const ShareParser = (() => {
    const API_URL = 'https://share-kd-njs.yun.139.com/yun-share/richlifeApp/devapp/IOutLink/getOutLinkInfoV6';

    const VIDEO_EXTS = new Set([
        'mp4', 'mkv', 'avi', 'wmv', 'flv', 'rmvb', 'mov', 'ts', 'm4v',
        'webm', 'mpg', 'mpeg', '3gp', 'rm', 'vob',
    ]);

    // ===== URL Parsing =====

    function parseShareUrl(url) {
        url = url.trim();
        let linkID = '';
        let pwd = '';

        const pathMatch = url.match(/\/i\/([A-Za-z0-9]+)/);
        if (pathMatch) {
            linkID = pathMatch[1];
        } else if (/^[A-Za-z0-9]{8,}$/.test(url)) {
            linkID = url;
        }

        const pwdMatch = url.match(/[?&]pwd=([^&]+)/);
        if (pwdMatch) pwd = decodeURIComponent(pwdMatch[1]);

        const codeMatch = url.match(/(?:提取码|密码|pwd|code)[：:\s]*([A-Za-z0-9]{4,})/i);
        if (codeMatch && !pwd) pwd = codeMatch[1];

        return { linkID, pwd };
    }

    // ===== Utility =====

    function isVideoFile(fileName) {
        if (!fileName) return false;
        const ext = fileName.split('.').pop().toLowerCase();
        return VIDEO_EXTS.has(ext);
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let size = bytes;
        while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
        return size.toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
    }

    // ===== API Communication =====

    function buildPayload(linkID, passwd, pCaID, bNum, eNum) {
        return {
            getOutLinkInfoReq: {
                account: '',
                linkID: linkID,
                passwd: passwd || '',
                caSrt: 0,
                coSrt: 0,
                srtDr: 1,
                bNum: bNum || 1,
                pCaID: pCaID || 'root',
                eNum: eNum || 200,
            }
        };
    }

    /**
     * 获取目录全部内容（自动翻页，直到获取所有文件）
     */
    async function fetchAllCatalog(linkID, passwd, pCaID) {
        const PAGE_SIZE = 200;
        let bNum = 1;
        const allCaLst = [];  // 文件夹
        const allCoLst = [];  // 文件

        let maxPages = 50; // 最多50页，防止死循环
        while (maxPages-- > 0) {
            const payload = buildPayload(linkID, passwd, pCaID, bNum, bNum + PAGE_SIZE - 1);
            const bodyStr = JSON.stringify(payload);

            let lastError = null;
            let timeoutId = null;

            for (const attempt of [{
                name: '服务器转发',
                url: '/api/proxy?target=' + encodeURIComponent(API_URL),
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            }]) {
                try {
                    const controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), 20000);
                    const resp = await fetch(attempt.url, {
                        method: 'POST',
                        headers: attempt.headers,
                        body: bodyStr,
                        signal: controller.signal,
                    });
                    clearTimeout(timeoutId);
                    if (!resp.ok) { lastError = new Error('HTTP ' + resp.status); continue; }

                    const text = await resp.text();
                    if (!text) { lastError = new Error('空响应'); continue; }
                    let json;
                    try { json = JSON.parse(text); } catch (e) { lastError = new Error('非JSON'); continue; }

                    const resultCode = json.resultCode || json.code;
                    if (resultCode && String(resultCode) !== '0') {
                        const msg = json.desc || json.message || 'code:' + resultCode;
                        if (String(resultCode) === '9188') throw new Error('提取码错误');
                        if (String(resultCode) === '200000727') throw new Error('分享链接已失效');
                        lastError = new Error(msg);
                        continue;
                    }

                    const data = json.data || json;
                    const pageFolders = data.caLst || [];
                    const pageFiles = data.coLst || [];

                    allCaLst.push(...pageFolders);
                    allCoLst.push(...pageFiles);

                    console.log('[Scan] 翻页: bNum=' + bNum + ' → 获取' + pageFolders.length + '目录+' + pageFiles.length + '文件, 累计' + allCoLst.length + '文件');

                    // 如果返回0条，说明已到最后一页
                    if (pageFolders.length + pageFiles.length === 0) {
                        return { ...data, caLst: allCaLst, coLst: allCoLst };
                    }

                    bNum += PAGE_SIZE;

                } catch (e) {
                    if (timeoutId) clearTimeout(timeoutId);
                    if (e.name === 'AbortError') { lastError = new Error('超时'); continue; }
                    if (e.message === '提取码错误' || e.message === '分享链接已失效') throw e;
                    lastError = e;
                }
            }

            if (lastError) throw lastError;
        }
    }

    async function fetchCatalog(linkID, passwd, pCaID) {
        const payload = buildPayload(linkID, passwd, pCaID);
        const bodyStr = JSON.stringify(payload);

        const attempts = [
            {
                name: '服务器转发',
                url: '/api/proxy?target=' + encodeURIComponent(API_URL),
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            },
        ];

        let lastError = null;
        let lastBusinessError = null; // 业务错误（如链接过期、提取码错误）优先级更高
        let timeoutId = null;
        for (const attempt of attempts) {
            try {
                const controller = new AbortController();
                timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

                const resp = await fetch(attempt.url, {
                    method: 'POST',
                    headers: attempt.headers,
                    body: bodyStr,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!resp.ok) {
                    // Try to read error body for details
                    let errBody = '';
                    try { errBody = await resp.text(); } catch(e2) { /* ignore */ }
                    lastError = new Error(`HTTP ${resp.status} (${attempt.name}): ${errBody.slice(0, 100)}`);
                    continue;
                }

                const text = await resp.text();
                if (!text || text.trim() === '') {
                    lastError = new Error(`${attempt.name} 返回空响应`);
                    continue;
                }

                let json;
                try {
                    json = JSON.parse(text);
                } catch (parseErr) {
                    lastError = new Error(`${attempt.name} 返回非JSON数据: ${text.slice(0, 80)}`);
                    continue;
                }

                const resultCode = json.resultCode || json.code;
                if (resultCode && String(resultCode) !== '0') {
                    const msg = json.desc || json.message || '解析失败 (code: ' + resultCode + ')';
                    if (String(resultCode) === '9188') throw new Error('提取码错误');
                    if (String(resultCode) === '200000727') throw new Error('分享链接已失效或被取消');
                    lastBusinessError = new Error(`[${attempt.name}] ${msg} (code: ${resultCode})`);
                    lastError = lastBusinessError;
                    continue;
                }

                return json.data || json;
            } catch (e) {
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = null;
                if (e.message === '提取码错误' || e.message === '分享链接已失效或被取消') throw e;
                if (e.name === 'AbortError') {
                    lastError = new Error(`${attempt.name} 请求超时 (20秒)`);
                    continue;
                }
                lastError = e; // TypeError "Failed to fetch", network errors etc.
                continue;
            }
        }

        // Provide a clearer error message
        if (!lastError) return null;

        // Prefer business error (e.g., expired link, wrong password) over network error
        if (lastBusinessError) throw lastBusinessError;

        // Wrap generic fetch errors with actionable info
        const errMsg = lastError.message || String(lastError);
        if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError') || errMsg.includes('TypeError')) {
            throw new Error(
                '无法连接到服务器，请检查:\n' +
                '1. 确认服务器已启动 (node server.js)\n' +
                '2. 尝试刷新页面后重新解析\n' +
                '3. 检查分享链接是否有效'
            );
        }

        throw lastError;
    }

    // ===== Tree Node Construction =====

    function buildTreeNode(item, type, parentPath) {
        const path = parentPath ? `${parentPath}/${item.id}` : item.id;
        return {
            id: item.id,
            path: path,
            name: item.name,
            type: type,
            size: item.size || 0,
            sizeText: type === 'file' ? formatFileSize(item.size || 0) : null,
            downloadUrl: item.downloadUrl || '',
            thumbUrl: item.thumbUrl || '',
            parentPath: parentPath || null,
            children: null,
            childrenLoaded: false,
            expanded: false,
            loading: false,
        };
    }

    function parseApiChildren(data, parentPath) {
        const folders = (data.caLst || []).map(f =>
            buildTreeNode(
                { id: f.caID, name: f.caName },
                'folder',
                parentPath
            )
        );
        const files = (data.coLst || [])
            .filter(f => isVideoFile(f.coName || f.caName || ''))
            .map(f =>
                buildTreeNode(
                    {
                        id: f.coID,
                        name: f.coName || f.caName || '',
                        size: f.coSize || 0,
                        downloadUrl: f.presentURL || f.cdnDownLoadUrl || '',
                        thumbUrl: f.thumbnailURL || f.bthumbnailURL || '',
                    },
                    'file',
                    parentPath
                )
            );
        return [...folders, ...files];
    }

    // ===== Public: Share Root =====

    /**
     * 解析分享链接并获取根目录内容（不递归）
     * @returns {{ linkID, linkName, children, sharePath }}
     */
    async function parseShareLink(shareUrl, password) {
        const { linkID, pwd } = parseShareUrl(shareUrl);
        if (!linkID) {
            throw new Error('无法解析分享链接，请输入有效的移动云盘链接');
        }

        const finalPwd = password || pwd || '';
        const rootData = await fetchCatalog(linkID, finalPwd, 'root');

        const linkName = rootData.lkName || '分享文件';
        const sharePath = 'share-root';
        const children = parseApiChildren(rootData, sharePath);

        return {
            linkID,
            passwd: finalPwd,
            linkName,
            children,
            sharePath,
        };
    }

    // ===== Public: Folder Contents (Lazy Load) =====

    /**
     * 按需获取指定文件夹的子内容
     */
    async function getFolderContents(linkID, passwd, folderCaID, parentPath) {
        const data = await fetchAllCatalog(linkID, passwd, folderCaID);
        const result = parseApiChildren(data, parentPath);
        console.log('[Scan] 加载文件夹: ' + (parentPath || 'root') + ' → ' + result.length + ' 子项 (' + (data.coLst?.length || 0) + '文件 + ' + (data.caLst?.length || 0) + '目录)');
        return result;
    }

    // ===== Public: Collect Files from Selection =====

    /**
     * 从已选中的树节点递归收集视频文件
     * @param {Array} roots - 顶层树节点
     * @param {Set} checkedSet - 已选中的节点 path 集合
     * @param {string} linkID
     * @param {string} passwd
     * @returns {Array} 视频文件列表（扁平化，含 folderPath）
     */
    async function collectSelectedFiles(roots, checkedSet, linkID, passwd) {
        const files = [];

        async function collect(nodes, parentChecked, folderPath, parentCaId) {
            for (const node of nodes) {
                const isNodeChecked = checkedSet.has(node.path);
                const ancestorChecked = parentChecked;

                if (node.type === 'folder') {
                    const includeAll = isNodeChecked || ancestorChecked;
                    const subPath = folderPath ? `${folderPath} / ${node.name}` : node.name;

                    if (includeAll) {
                        // Load children if not loaded yet
                        if (!node.childrenLoaded) {
                            node.children = await getFolderContents(
                                linkID, passwd, node.id, node.path
                            );
                            node.childrenLoaded = true;
                        }
                        await collect(node.children, true, subPath, node.id);
                    } else {
                        // Only recurse into children that are individually checked
                        if (node.childrenLoaded && node.children) {
                            await collect(node.children, false, subPath, node.id);
                        }
                    }
                } else if (node.type === 'file') {
                    if (isNodeChecked || ancestorChecked) {
                        files.push({
                            name: node.name,
                            size: node.size,
                            sizeText: node.sizeText,
                            fileId: node.id,
                            downloadUrl: node.downloadUrl,
                            thumbUrl: node.thumbUrl,
                            folderPath: folderPath || '',
                            parentCaId: parentCaId || 'root',
                            isDir: false,
                        });
                    }
                }
            }
        }

        await collect(roots, false, '', 'root');
        return files;
    }

    // ===== Recursive Collect (no render, pure data) =====

    /**
     * 递归收集指定文件夹下的所有视频文件（不渲染，纯数据）
     */
    async function recursiveCollectFiles(linkID, passwd, roots, onProgress) {
        console.log('[Scan] recursiveCollectFiles 开始, ' + roots.length + ' 个根节点');
        const startTime = Date.now();
        const files = [];
        let scanned = 0;
        let found = 0;
        let lastUpdate = 0;

        async function loadFolderChildren(node) {
            // 强制重新加载，不走旧缓存
            try {
                node.children = await getFolderContents(linkID, passwd, node.id, node.path);
                node.childrenLoaded = true;
            } catch (e) {
                console.warn('加载文件夹失败: ' + node.name, e.message);
            }
        }

        async function traverse(nodes, folderPath, parentCaId) {
            // 先并行加载所有子文件夹
            const folders = nodes.filter(n => n.type === 'folder');
            if (folders.length > 0) {
                await Promise.all(folders.map(f => loadFolderChildren(f)));
            }

            // 然后递归处理
            for (const node of nodes) {
                if (node.type === 'folder') {
                    scanned++;
                    if (!node.children || node.children.length === 0) continue;
                    const subPath = folderPath ? folderPath + ' / ' + node.name : node.name;
                    await traverse(node.children, subPath, node.id);
                } else if (node.type === 'file' && isVideoFile(node.name)) {
                    scanned++;
                    found++;
                    files.push({
                        name: node.name,
                        size: node.size,
                        sizeText: node.sizeText,
                        fileId: node.id,
                        downloadUrl: node.downloadUrl,
                        thumbUrl: node.thumbUrl,
                        folderPath: folderPath || '',
                        parentCaId: parentCaId || 'root',
                        isDir: false,
                    });

                    // 每 200 个文件或每 1 秒更新一次 UI
                    const now = Date.now();
                    if (onProgress && (found % 200 === 0 || now - lastUpdate > 1000)) {
                        onProgress({ scanned, found, currentFolder: node.name });
                        lastUpdate = now;
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }
        }

        await traverse(roots, '', 'root');
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('[Scan] 完成: ' + found + ' 个视频文件, 扫描 ' + scanned + ' 个节点, 耗时 ' + elapsed + 's');
        if (onProgress) onProgress({ scanned, found, currentFolder: '完成' });
        return files;
    }

    // ===== Legacy compatibility =====

    async function importFromShare(shareUrl, password) {
        return await parseShareLink(shareUrl, password);
    }

    /**
     * 刷新网盘视频下载链接（签名 URL 24小时过期）
     * @param {string} linkID - 分享链接 ID
     * @param {string} passwd - 提取码
     * @param {string} fileId - 文件 coID
     * @param {string} pCaID - 文件所在文件夹 caID
     * @returns {string|null} 新的下载链接
     */
    async function refreshDownloadUrl(linkID, passwd, fileId, pCaID) {
        if (!linkID || !fileId) return null;
        try {
            // 使用与导入相同的请求格式 buildPayload
            const payload = buildPayload(linkID, passwd, pCaID || 'root', 1, 999);
            const bodyStr = JSON.stringify(payload);
            const resp = await fetch('/api/proxy?target=' + encodeURIComponent(API_URL), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                body: bodyStr,
            });
            const data = await resp.json();

            // 使用与 parseApiChildren 相同的解析方式：data.coLst
            const items = data.coLst || [];
            for (const item of items) {
                if (item.coID === fileId) {
                    return item.presentURL || item.cdnDownLoadUrl || null;
                }
            }
            return null;
        } catch (e) {
            console.warn('[Refresh] 刷新链接失败:', e.message);
            return null;
        }
    }

    return {
        parseShareUrl,
        parseShareLink,
        getFolderContents,
        collectSelectedFiles,
        recursiveCollectFiles,
        importFromShare,
        formatFileSize,
        isVideoFile,
        refreshDownloadUrl,
        VIDEO_EXTS,
    };
})();
