/**
 * Render - 云盘影院渲染引擎
 * 负责所有 UI 组件的渲染：卡片、网格、分类行、文件树、历史记录
 */
const Render = (() => {
    const FALLBACK_POSTER = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">' +
        '<rect fill="#1a1a2e" width="200" height="300"/>' +
        '<text x="50%" y="50%" fill="#6c5ce7" text-anchor="middle" dy=".3em" font-size="48" font-family="sans-serif">&#127909;</text>' +
        '</svg>'
    );

    // ===== Movie Card =====

    function movieCard(movie) {
        const isFav = Store.isFavorite(movie.seriesId || movie.id);
        const poster = movie.poster || FALLBACK_POSTER;
        const subtitle = movie.originalTitle && movie.originalTitle !== movie.title
            ? movie.originalTitle
            : (movie.year || '');
        const hasMeta = movie._hasMeta !== false && (movie.tmdbId || movie.poster);
        const isSeries = movie.isSeries && movie.episodes && movie.episodes.length > 1;
        const clickAction = isSeries ? `App.showDetail('${movie.seriesId}')` : `App.playMovie('${movie.id}')`;

        return `
            <div class="movie-card ${!hasMeta ? 'movie-card-unscraped' : ''}" onclick="${clickAction}">
                <div class="card-poster">
                    <img src="${poster}" alt="${escapeHtml(movie.title)}" loading="lazy"
                         onerror="this.src='${FALLBACK_POSTER}'">
                    <div class="card-overlay">
                        <div class="play-icon"><i class="fas ${isSeries ? 'fa-list' : (hasMeta ? 'fa-play' : 'fa-magnifying-glass')}"></i></div>
                    </div>
                    ${movie.rating ? `<div class="card-rating"><i class="fas fa-star"></i> ${movie.rating}</div>` : ''}
                    ${isFav ? '<div class="card-fav"><i class="fas fa-heart"></i></div>' : ''}
                    ${!hasMeta ? '<div class="card-unscraped-badge"><i class="fas fa-wand-magic-sparkles"></i></div>' : ''}
                    ${isSeries ? `<div class="card-episode-badge"><i class="fas fa-layer-group"></i> ${movie.episodes.length}集</div>` : ''}
                </div>
                <div class="card-body">
                    <div class="card-title" title="${escapeHtml(movie.title)}">${escapeHtml(movie.title)}</div>
                    ${subtitle && !isSeries ? `<div class="card-subtitle">${subtitle}</div>` : ''}
                </div>
            </div>`;
    }

    // ===== Grid =====

    function movieGrid(container, movies) {
        if (!movies.length) {
            container.innerHTML = '';
            return false;
        }
        container.innerHTML = movies.map(movieCard).join('');
        return true;
    }

    // ===== Genre Buttons =====

    function genreButtons(genres, container) {
        container.innerHTML = genres.map(g =>
            `<button class="filter-btn" data-genre="${g}" onclick="App.filterGenre('${g}')">${g}</button>`
        ).join('');
    }

    // ===== Category Rows =====

    function categoryRow(row) {
        const cards = row.movies.map(movieCard).join('');
        return `
            <section class="media-row" id="row-${row.id}">
                <div class="media-row-header">
                    <h2 class="media-row-title">
                        <i class="fas ${row.icon}"></i>
                        ${row.title}
                    </h2>
                    <span class="media-row-count">${row.movies.length} 项</span>
                </div>
                <div class="media-row-scroll">
                    ${cards}
                </div>
            </section>`;
    }

    function categoryRows(rows, container) {
        if (!rows.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-film"></i>
                    <p>暂无影片，请先导入</p>
                </div>`;
            return;
        }
        container.innerHTML = rows.map(categoryRow).join('');
    }

    // ===== History =====

    function historyItem(item) {
        const d = new Date(item.watchedAt);
        const timeStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        return `
            <div class="history-item" onclick="App.playMovie('${item.id}')">
                <div class="history-poster">
                    <img src="${item.poster || FALLBACK_POSTER}" alt="${item.title}"
                         onerror="this.src='${FALLBACK_POSTER}'">
                </div>
                <div class="history-info">
                    <h4>${item.title}</h4>
                    <p>${item.year || ''} ${item.genre ? '· ' + item.genre : ''}</p>
                </div>
                <span class="history-time">${timeStr}</span>
            </div>`;
    }

    function historyList(container, items) {
        if (!items.length) {
            container.innerHTML = '';
            return false;
        }
        container.innerHTML = items.map(historyItem).join('');
        return true;
    }

    // ===== File Tree (Import Page) =====

    /**
     * Determine checkbox state for a tree node
     * @returns 'all' | 'partial' | 'none'
     */
    function getCheckboxState(path, treeChildrenMap, checkedSet) {
        // Direct check
        if (checkedSet.has(path)) return 'all';

        // Ancestor check
        let current = path;
        while (true) {
            const lastSlash = current.lastIndexOf('/');
            if (lastSlash === -1) break;
            current = current.substring(0, lastSlash);
            if (checkedSet.has(current)) return 'all';
        }

        // Check descendants
        const children = treeChildrenMap.get(path);
        if (!children || children.length === 0) return 'none';

        let allChecked = true;
        let anyChecked = false;
        for (const child of children) {
            const state = getCheckboxState(child.path, treeChildrenMap, checkedSet);
            if (state !== 'none') anyChecked = true;
            if (state !== 'all') allChecked = false;
        }

        if (allChecked && anyChecked) return 'all';
        if (anyChecked) return 'partial';
        return 'none';
    }

    /**
     * Count total video files under a node (from loaded children)
     */
    function countLeafFiles(node, treeChildrenMap) {
        if (node.type === 'file') return 1;
        const children = treeChildrenMap.get(node.path);
        if (!children || children.length === 0) return 0;
        let count = 0;
        for (const child of children) {
            count += countLeafFiles(child, treeChildrenMap);
        }
        return count;
    }

    /**
     * Count checked leaf files under a node
     */
    function countCheckedFiles(path, treeChildrenMap, checkedSet) {
        if (checkedSet.has(path)) {
            // All descendants are checked
            // Find the node to count leaves
            const children = treeChildrenMap.get(path);
            if (!children) return 0;
            let count = 0;
            for (const child of children) count += countLeafFiles(child, treeChildrenMap);
            return count;
        }

        // Ancestor check
        let current = path;
        while (true) {
            const lastSlash = current.lastIndexOf('/');
            if (lastSlash === -1) break;
            current = current.substring(0, lastSlash);
            if (checkedSet.has(current)) {
                const children = treeChildrenMap.get(path);
                if (!children) return 0;
                let count = 0;
                for (const child of children) count += countLeafFiles(child, treeChildrenMap);
                return count;
            }
        }

        // Check individual children
        const children = treeChildrenMap.get(path);
        if (!children || children.length === 0) return 0;

        let count = 0;
        for (const child of children) {
            if (child.type === 'file') {
                if (checkedSet.has(child.path)) count++;
            } else {
                count += countCheckedFiles(child.path, treeChildrenMap, checkedSet);
            }
        }
        return count;
    }

    /**
     * Render the file tree HTML
     * @param {Array} nodes - tree nodes at this level
     * @param {Map} treeChildrenMap - path -> children array
     * @param {Set} checkedSet - set of checked paths
     * @param {number} depth - indentation level
     * @returns {string} HTML
     */
    function renderTreeLevel(nodes, treeChildrenMap, checkedSet, depth) {
        if (!nodes || nodes.length === 0) {
            return `<div class="tree-empty-hint" style="padding-left:${(depth+1)*24}px">此文件夹为空</div>`;
        }

        // Sort: folders first, then files
        const sorted = [...nodes].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name, 'zh');
        });

        let html = '';
        for (const node of sorted) {
            html += renderTreeNode(node, treeChildrenMap, checkedSet, depth);
        }
        return html;
    }

    function renderTreeNode(node, treeChildrenMap, checkedSet, depth) {
        const indent = depth * 24;
        const state = getCheckboxState(node.path, treeChildrenMap, checkedSet);
        const isFolder = node.type === 'folder';

        if (isFolder) {
            const chevronIcon = node.expanded ? 'fa-chevron-down' : 'fa-chevron-right';
            const folderIcon = node.expanded ? 'fa-folder-open' : 'fa-folder';
            const childCount = treeChildrenMap.get(node.path)?.length || 0;
            const hasChildren = node.childrenLoaded && childCount > 0;

            let checkboxClass = 'tree-checkbox';
            if (state === 'all') checkboxClass += ' checked';
            else if (state === 'partial') checkboxClass += ' indeterminate';

            let childrenHtml = '';
            if (node.expanded && node.childrenLoaded) {
                childrenHtml = renderTreeLevel(node.children, treeChildrenMap, checkedSet, depth + 1);
            }

            const loadingHtml = node.loading
                ? `<div class="tree-loading" style="padding-left:${(depth+2)*24}px">
                       <div class="loading-spinner-sm"></div>
                       <span>加载中...</span>
                   </div>`
                : '';

            return `
                <div class="tree-node" data-path="${node.path}" data-type="folder" data-caid="${node.id}">
                    <div class="tree-node-row" style="padding-left:${indent}px">
                        <span class="tree-expand" onclick="App.toggleTreeNode('${node.path}')" title="展开/折叠">
                            ${node.childrenLoaded && childCount > 0
                                ? `<i class="fas ${chevronIcon}"></i>`
                                : `<i class="fas fa-chevron-right tree-expand-disabled"></i>`
                            }
                        </span>
                        <span class="${checkboxClass}" onclick="App.toggleTreeCheck('${node.path}')" title="选择"></span>
                        <i class="fas ${folderIcon} tree-icon-folder"></i>
                        <span class="tree-node-name" onclick="App.toggleTreeNode('${node.path}')">${escapeHtml(node.name)}</span>
                        ${node.childrenLoaded ? `<span class="tree-node-count">${childCount}</span>` : ''}
                    </div>
                    ${loadingHtml}
                    ${childrenHtml}
                </div>`;
        } else {
            // File node
            const ext = node.name.split('.').pop().toUpperCase();
            let checkboxClass = 'tree-checkbox';
            if (state === 'all') checkboxClass += ' checked';

            return `
                <div class="tree-node" data-path="${node.path}" data-type="file">
                    <div class="tree-node-row" style="padding-left:${indent}px">
                        <span class="tree-expand-placeholder"></span>
                        <span class="${checkboxClass}" onclick="App.toggleTreeCheck('${node.path}')"></span>
                        <i class="fas fa-film tree-icon-file"></i>
                        <span class="tree-node-name" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span>
                        <span class="tree-node-meta">${node.sizeText} &middot; ${ext}</span>
                    </div>
                </div>`;
        }
    }

    /**
     * Render the complete file tree into a container
     */
    function renderFileTree(container, shareData, treeChildrenMap, checkedSet) {
        if (!shareData || !shareData.children || shareData.children.length === 0) {
            container.innerHTML = `
                <div class="tree-empty">
                    <i class="fas fa-folder-open"></i>
                    <p>此分享链接中没有文件</p>
                </div>`;
            return;
        }

        const treeHtml = renderTreeLevel(shareData.children, treeChildrenMap, checkedSet, 0);

        // Compute selection summary
        let totalFiles = 0;
        let selectedFiles = 0;
        for (const child of shareData.children) {
            totalFiles += countLeafFiles(child, treeChildrenMap);
            selectedFiles += countCheckedFiles(child.path, treeChildrenMap, checkedSet);
        }

        container.innerHTML = `
            <div class="file-tree">
                <div class="file-tree-root">
                    <div class="tree-node-row tree-root-row">
                        <span class="tree-expand-placeholder"></span>
                        <span class="tree-checkbox ${getCheckboxState(shareData.sharePath, treeChildrenMap, checkedSet) === 'all' ? 'checked' : (getCheckboxState(shareData.sharePath, treeChildrenMap, checkedSet) === 'partial' ? 'indeterminate' : '')}"
                              onclick="App.toggleTreeCheck('${shareData.sharePath}')"></span>
                        <i class="fas fa-cloud tree-icon-root"></i>
                        <span class="tree-node-name tree-root-name">${escapeHtml(shareData.linkName)}</span>
                        <span class="tree-node-count">${totalFiles} 个视频</span>
                    </div>
                    ${treeHtml}
                </div>
            </div>`;
    }

    /**
     * Render the import toolbar with selection count and actions
     */
    function renderImportToolbar(container, selectedCount, totalCount, isImporting, hasChecked) {
        const canSmart = (hasChecked || selectedCount > 0) && !isImporting;
        container.innerHTML = `
            <div class="import-toolbar">
                <div class="import-toolbar-info">
                    <span class="import-selection-count">
                        已选择 <strong>${selectedCount}</strong> / ${totalCount} 个视频文件
                    </span>
                </div>
                <div class="import-toolbar-actions">
                    <button class="btn-toolbar btn-check-all" onclick="App.selectAllTree()">
                        <i class="fas fa-check-double"></i> 全选
                    </button>
                    <button class="btn-toolbar btn-uncheck-all" onclick="App.unselectAllTree()">
                        <i class="fas fa-xmark"></i> 取消全选
                    </button>
                    <button class="btn-toolbar btn-smart-import ${!canSmart ? 'disabled' : ''}"
                            onclick="App.smartImport()" ${!canSmart ? 'disabled' : ''} title="勾选文件夹自动遍历，或勾选文件直接导入">
                        <i class="fas fa-wand-magic-sparkles"></i> 导入
                    </button>
                </div>
            </div>`;
    }

    // ===== Detail Page =====

    /**
     * Render movie/series detail page (Popcorn/Netflix style)
     * @param {HTMLElement} container - #detailContent
     * @param {Object} series - series object with episodes array
     */
    function renderDetail(container, series) {
        if (!series) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-film"></i><p>未找到该影片</p></div>';
            return;
        }

        const poster = series.poster || FALLBACK_POSTER;
        const backdrop = series.backdrop || series.poster || FALLBACK_POSTER;
        const episodes = series.episodes || [];
        const isSeries = episodes.length > 1;
        const hasMeta = series._hasMeta !== false;
        const rating = series.rating;
        const year = series.year;
        const genre = series.genre;
        const genres = series.genres || [];
        const desc = series.desc || '';
        const director = series.director || '';
        const cast = series.cast || [];
        const originalTitle = series.originalTitle;
        const seasons = series.seasons || [];
        const hasSeasons = seasons.length > 1;

        // Episodes horizontal scroll
        let episodesHtml = '';
        if (isSeries) {
            // For multi-season: render per-season with season selector
            const renderEpCards = (eps, baseIdx) => eps.map((ep, idx) => {
                const epName = ep.episodeName || ep.name || ep.title || (baseIdx + idx + 1);
                const epThumb = App.proxyImageUrl(ep.episodeStill || ep.poster) || poster || '';
                const epNum = ep.episodeNumber || (baseIdx + idx + 1);
                return `
                    <div class="ep-item" onclick="App.playMovie('${ep.id}')">
                        <div class="ep-thumb">
                            ${epThumb && epThumb !== FALLBACK_POSTER ? `<img src="${epThumb}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'ep-thumb-fallback\\'>${epNum}</div>'">` : `<div class="ep-thumb-fallback">${epNum}</div>`}
                            <div class="ep-overlay"><i class="fas fa-play-circle"></i></div>
                        </div>
                        <div class="ep-num">${epNum}. ${escapeHtml(epName)}</div>
                    </div>`;
            }).join('');

            if (hasSeasons) {
                // Season tabs + episode scroll
                const seasonTabs = seasons.map((s, si) =>
                    `<button class="season-tab ${si === 0 ? 'active' : ''}" 
                        onclick="App.switchSeason('${series.seriesId}', ${si})" 
                        data-season="${si}">${escapeHtml(s.name)}</button>`
                ).join('');

                episodesHtml = `
                    <div class="detail-section">
                        <div class="detail-section-title">选集 <span>共 ${episodes.length} 集</span></div>
                        <div class="season-tabs" id="seasonTabs_${series.seriesId}">${seasonTabs}</div>
                        <div class="ep-scroll" id="epScroll_${series.seriesId}">${renderEpCards(seasons[0].episodes, 0)}</div>
                    </div>`;
            } else {
                // Single season
                const epCards = renderEpCards(episodes, 0);
                episodesHtml = `
                    <div class="detail-section">
                        <div class="detail-section-title">选集 <span>共 ${episodes.length} 集</span></div>
                        <div class="ep-scroll">${epCards}</div>
                    </div>`;
            }
        }

        // Cast
        let castHtml = '';
        if (cast && cast.length > 0) {
            const castCards = cast.slice(0, 14).map(c => {
                const name = c.name || '';
                const char = c.character || '';
                const photo = App.proxyImageUrl(c.profilePath || c.profile_path || '');
                return `
                    <div class="cast-item">
                        <div class="cast-avatar">
                            ${photo ? `<img src="${photo}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'cast-avatar-fallback\\'><i class=\\'fas fa-user\\'></i></div>'">` : `<div class="cast-avatar-fallback"><i class="fas fa-user"></i></div>`}
                        </div>
                        <div class="cast-name">${escapeHtml(name)}</div>
                        ${char ? `<div class="cast-char">饰 ${escapeHtml(char)}</div>` : ''}
                    </div>`;
            }).join('');
            castHtml = `
                <div class="detail-section">
                    <div class="detail-section-title">相关演员</div>
                    <div class="cast-scroll">${castCards}</div>
                </div>`;
        }

        // Meta badges (no duplicate episode count here)
        const metaParts = [];
        if (rating) metaParts.push(`<span class="meta-badge star"><i class="fas fa-star"></i> ${rating}</span>`);
        if (year) metaParts.push(`<span class="meta-badge"><i class="far fa-calendar"></i> ${year}</span>`);
        if (genre) metaParts.push(`<span class="meta-badge">${escapeHtml(genre)}</span>`);
        const metaRow = metaParts.length > 0 ? `<div class="detail-meta">${metaParts.join('')}</div>` : '';

        // Play action
        const playBtnAction = isSeries
            ? `App.playEpisode('${series.seriesId}', 0)`
            : `App.playMovie('${series.seriesId}')`;

        container.innerHTML = `
            <div class="detail-backdrop">
                <div class="detail-backdrop-img" style="background-image:url('${backdrop}')"></div>
                <div class="detail-backdrop-gradient"></div>
                <button class="detail-play-overlay" onclick="${playBtnAction}">
                    <i class="fas fa-play"></i>
                    <span>${isSeries ? '播放' : '立即播放'}</span>
                </button>
            </div>
            <div class="detail-body">
                <h1 class="detail-title">${escapeHtml(series.title)}</h1>
                ${originalTitle ? `<div class="detail-subtitle">${escapeHtml(originalTitle)}</div>` : ''}
                ${metaRow}
                ${desc ? `<div class="detail-desc">${escapeHtml(desc)}</div>` : ''}
                ${episodesHtml}
                ${castHtml}
            </div>
        `;
    }

    // ===== Smart Import Summary =====

    function renderSmartImportSummary(container, groups, totalFiles) {
        const movieGroups = groups.filter(g => g.mediaType === 'movie');
        const tvGroups = groups.filter(g => g.mediaType === 'tv');

        container.innerHTML = `
            <div class="smart-summary-card">
                <div class="smart-summary-header">
                    <i class="fas fa-check-circle" style="color:var(--success);font-size:1.5rem"></i>
                    <h3>分析完成</h3>
                </div>
                <p class="smart-summary-total">共 ${totalFiles} 个视频文件，分为 ${groups.length} 组</p>

                ${movieGroups.length > 0 ? `
                <div class="smart-summary-section">
                    <h4><i class="fas fa-film"></i> 电影 (${movieGroups.length} 部)</h4>
                    <div class="smart-summary-list">
                        ${movieGroups.map(g => `
                            <div class="smart-summary-item">
                                <span class="ssi-title">${escapeHtml(g.title)}</span>
                                <span class="ssi-count">${g.fileCount} 个文件</span>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}

                ${tvGroups.length > 0 ? `
                <div class="smart-summary-section">
                    <h4><i class="fas fa-tv"></i> 电视剧 (${tvGroups.length} 部)</h4>
                    <div class="smart-summary-list">
                        ${tvGroups.slice(0, 15).map(g => {
                            const seasonInfo = g.seasons.length > 1
                                ? g.seasons.map(s => 'S' + s.num + '(' + s.episodes.length + '集)').join(', ')
                                : g.fileCount + ' 集';
                            const hint = g._needAI ? ' <span class="ssi-hint" title="需要AI辅助识别">⚠️</span>' : '';
                            return `
                            <div class="smart-summary-item">
                                <span class="ssi-title">${escapeHtml(g.title)}${hint}</span>
                                <span class="ssi-count">${seasonInfo}</span>
                            </div>`;
                        }).join('')}
                        ${tvGroups.length > 15 ? '<div class="smart-summary-more">...还有 ' + (tvGroups.length - 15) + ' 部</div>' : ''}
                    </div>
                </div>` : ''}

                <div class="smart-summary-actions">
                    <button class="btn-smart-confirm" onclick="App.confirmSmartImport()">
                        <i class="fas fa-download"></i> 确认导入并刮削
                    </button>
                    <button class="btn-smart-cancel" onclick="App.cancelSmartImport()">
                        <i class="fas fa-xmark"></i> 取消
                    </button>
                </div>
            </div>`;
    }

    // ===== Utility =====

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    return {
        movieGrid,
        genreButtons,
        historyList,
        categoryRows,
        renderFileTree,
        renderImportToolbar,
        renderDetail,
        renderSmartImportSummary,
        getCheckboxState,
        countLeafFiles,
        countCheckedFiles,
        FALLBACK_POSTER,
    };
})();
