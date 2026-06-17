/**
 * App - 云盘影院主控制器
 * 管理状态、导航、导入流程、刮削、数据管理
 */
const App = (() => {
    let movies = [];
    let metadataMap = {};
    let currentGenre = 'all';
    let searchQuery = '';
    let isScraping = false;
    let scrapeQueue = [];

    // Tree import state
    let shareData = null;       // { linkID, passwd, linkName, children, sharePath }
    let treeChildrenMap = new Map(); // path -> children array
    let checkedSet = new Set();     // set of checked node paths
    let isImporting = false;

    // Search page state
    const searchState = {
        query: '',
        minRating: 0,
        yearFrom: '',
        yearTo: '',
        mediaType: 'all',
        genreSet: new Set(),
        sortBy: 'relevance',
        filtersOpen: false,
    };

    // ===== Init =====

    async function init() {
        applyTheme();

        // Load metadata from server（IndexedDB → data/metadata.json）
        try {
            const allMeta = await DB.getAll();
            metadataMap = {};
            for (const m of allMeta) {
                if (m.movieId) metadataMap[m.movieId] = m;
            }
            console.log(`Loaded ${Object.keys(metadataMap).length} metadata records`);
        } catch (e) {
            console.error('Failed to load metadata:', e);
        }

        // Load movies from server（localStorage → data/movies.json）
        try {
            movies = await getImportedMovies();
        } catch (e) {
            console.error('Failed to load movies:', e);
            movies = [];
        }

        rebuildSeries();
        initGenres();
        renderHome();
        renderFavorites();
        renderHistory();
        renderScrapePanel();
        checkTmdbConfig();
    }

    async function checkTmdbConfig() {
        try {
            const res = await fetch('/api/config');
            const cfg = await res.json();
            if (!cfg.tmdbConfigured) {
                console.warn('TMDB API Key 未配置。请在 config.json 中添加 apiKey。');
            }
        } catch (e) { /* ignore */ }
    }

    async function getImportedMovies() {
        try {
            const res = await fetch('/api/movies');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } catch (e) {
            console.error('getImportedMovies failed:', e.message);
            return [];
        }
    }

    async function saveImportedMovies(list) {
        try {
            await fetch('/api/movies', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list),
            });
        } catch (e) {
            console.error('saveImportedMovies failed:', e.message);
        }
    }

    // ===== Metadata Enrichment =====

    function enrichMovie(movie) {
        const meta = metadataMap[movie.id];
        if (!meta) return movie;
        return {
            ...movie,
            title: meta.title || movie.title,
            originalTitle: meta.originalTitle || null,
            poster: meta.poster || movie.poster,
            backdrop: meta.backdrop || null,
            desc: meta.overview || movie.desc || '',
            genre: (meta.genres && meta.genres[0]) || movie.genre || '导入',
            genres: meta.genres || (movie.genre ? [movie.genre] : []),
            year: meta.year || movie.year,
            rating: meta.rating || movie.rating,
            runtime: meta.runtime || movie.duration,
            cast: meta.cast || [],
            director: meta.director || null,
            mediaType: meta.mediaType || 'movie',
            seasonCount: meta.seasonCount || null,
            episodeCount: meta.episodeCount || null,
            tagline: meta.tagline || null,
            tmdbId: meta.tmdbId || null,
            // Episode-level data (from TMDB season API)
            episodeName: meta.episodeName || null,
            episodeOverview: meta.episodeOverview || null,
            episodeStill: meta.episodeStill || null,
        };
    }

    /**
     * Check if a movie has been successfully scraped (has TMDB metadata)
     */
    function hasMetadata(movieId) {
        return !!metadataMap[movieId];
    }

    // ===== Series Builder =====

    /**
     * Check if a list of file names looks like a TV show episode group.
     * Returns true if most files have numeric-only base names (e.g., "01.mp4", "22.avi").
     */
    function looksLikeEpisodes(items) {
        if (items.length < 3) return false;

        // Check if at least 60% of files have numeric base names
        const numericCount = items.filter(f => {
            const base = (f.name || f.title || '').replace(/\.[^.]+$/, '').trim();
            return /^\d{1,4}$/.test(base);
        }).length;
        return numericCount / items.length >= 0.6;
    }

    /**
     * Extract season number from folder name.
     * e.g., "第一季" → 1, "Season 2" → 2, "S03" → 3
     */
    function extractSeason(folderName) {
        const cnMatch = folderName.match(/第\s*([一二三四五六七八九十\d]+)\s*季/);
        if (cnMatch) {
            const d = {一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
            const num = cnMatch[1];
            return d[num] || parseInt(num) || null;
        }
        const enMatch = folderName.match(/Season\s*(\d+)/i);
        if (enMatch) return parseInt(enMatch[1]);
        const sMatch = folderName.match(/^S0*(\d+)/i);
        if (sMatch) return parseInt(sMatch[1]);
        return null;
    }

    /**
     * Generate a short, unique ID from a string using a simple hash.
     * Avoids collisions from common path prefixes that dominate base64+slice.
     */
    function hashId(prefix, str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash; // 32-bit int
        }
        return prefix + Math.abs(hash).toString(36);
    }

    /**
     * Merge individual movie files into series when same folderPath has multiple files.
     * Only merges if files look like TV episodes (numeric naming pattern).
     * Standalone movies in the same folder are kept separate.
     * Supports multi-season: sub-folders like "第一季", "Season 2" become seasons.
     */
    function buildSeriesList(rawMovies) {
        const result = [];
        const folders = {};
        const enriched = rawMovies.map(m => ({ ...enrichMovie(m), _hasMeta: hasMetadata(m.id) }));

        // Group by folderPath
        for (const m of enriched) {
            const fp = m.folderPath || '';
            if (!fp) {
                folders['__single__' + m.id] = [m];
                continue;
            }
            if (!folders[fp]) folders[fp] = [];
            folders[fp].push(m);
        }

        // Detect multi-season: folders sharing a parent and named like seasons
        const parentGroups = {};
        for (const [fp, items] of Object.entries(folders)) {
            const parts = fp.split('/');
            const last = parts[parts.length - 1].trim();
            const seasonNum = extractSeason(last);
            if (seasonNum) {
                const parent = parts.slice(0, -1).join('/');
                if (!parentGroups[parent]) parentGroups[parent] = {};
                parentGroups[parent][seasonNum] = { fp, items, name: last, num: seasonNum };
            }
        }

        // Build multi-season series
        const mergedFolders = new Set(); // folders already consumed by a season group
        for (const [parent, seasons] of Object.entries(parentGroups)) {
            const seasonKeys = Object.keys(seasons).sort((a,b) => parseInt(a)-parseInt(b));
            if (seasonKeys.length < 2) continue; // only one season, treat as regular

            // Merge all episodes from all seasons
            const allEps = [];
            const seasonList = [];
            for (const key of seasonKeys) {
                const s = seasons[key];
                seasonList.push({ name: s.name, num: s.num, episodes: [...s.items] });
                allEps.push(...s.items);
                mergedFolders.add(s.fp);
            }

            const first = allEps[0];
            const seriesId = hashId('series-', parent);
            const series = {
                ...first,
                seriesId,
                id: first.id,
                isSeries: true,
                episodes: allEps.sort((a,b) => (a.name||'').localeCompare(b.name||'', undefined, {numeric: true})),
                seasons: seasonList.sort((a,b) => a.num - b.num),
                folderPath: parent,
            };
            result.push(series);
        }

        // Process remaining (non-season or single-season) folders
        for (const [fp, items] of Object.entries(folders)) {
            if (mergedFolders.has(fp) || fp.startsWith('__single__')) continue;

            const isTv = items.some(m => m.mediaType === 'tv') || looksLikeEpisodes(items);

            if (items.length <= 1 || !isTv) {
                result.push(...items);
            } else {
                const first = items[0];
                const series = {
                    ...first,
                    seriesId: hashId('series-', fp),
                    id: first.id,
                    isSeries: true,
                    episodes: items.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, {numeric: true})),
                    folderPath: fp,
                };
                result.push(series);
            }
        }

        // Sort: scraped first, then by import date
        result.sort((a, b) => {
            if (a._hasMeta && !b._hasMeta) return -1;
            if (!a._hasMeta && b._hasMeta) return 1;
            return (b.importedAt || 0) - (a.importedAt || 0);
        });

        return result;
    }

    // Current series list cache
    let seriesList = [];

    function getSeriesList() {
        // Auto-invalidate when movies array changes
        if (seriesList.length === 0) {
            seriesList = buildSeriesList(movies);
        }
        return seriesList;
    }

    // Rebuild series cache after data changes
    function rebuildSeries() {
        seriesList = buildSeriesList(movies);
    }

    function invalidateSeriesCache() {
        seriesList = [];
    }

    // ===== Genre & Filter =====

    function initGenres() {
        const genreSet = new Set();
        for (const m of movies) {
            const enriched = enrichMovie(m);
            if (enriched.genres) enriched.genres.forEach(g => genreSet.add(g));
            else if (enriched.genre && enriched.genre !== '导入') genreSet.add(enriched.genre);
        }
        Render.genreButtons([...genreSet], document.getElementById('genreButtons'));
    }

    function getFiltered() {
        // Use series-merged list
        let list = getSeriesList();
        // Sort: scraped first, then by import date
        list.sort((a, b) => {
            if (a._hasMeta && !b._hasMeta) return -1;
            if (!a._hasMeta && b._hasMeta) return 1;
            return (b.importedAt || 0) - (a.importedAt || 0);
        });
        if (currentGenre !== 'all') {
            // Special category names from sidebar: map to mediaType/genre logic
            // (TMDB doesn't use "电影"/"电视剧" as genre names)
            if (currentGenre === '电影') {
                list = list.filter(m => {
                    if (m._hasMeta && m.mediaType !== 'movie') return false;
                    if (m._hasMeta && (m.genres?.some(g =>
                        g.includes('动画') || g.toLowerCase().includes('animation') ||
                        g.includes('综艺')) ||
                        m.genre === '动画' || m.genre === '动漫' || m.genre === '综艺'
                    )) return false;
                    if (m._hasMeta && (m.genres?.some(g =>
                        g.includes('演唱') || g.includes('音乐') ||
                        g.toLowerCase().includes('concert') || g.toLowerCase().includes('music')
                    ) || m.genre === '演唱会' || m.genre === '音乐会')) return false;
                    return true;
                });
            } else if (currentGenre === '电视剧') {
                list = list.filter(m => m._hasMeta && m.mediaType === 'tv');
            } else if (currentGenre === '动画' || currentGenre === '动漫') {
                list = list.filter(m =>
                    m.genres?.some(g => g.includes('动画') || g.toLowerCase().includes('animation')) ||
                    m.genre === '动画' || m.genre === '动漫'
                );
            } else if (currentGenre === '综艺') {
                list = list.filter(m =>
                    m.genres?.some(g => g.includes('综艺')) ||
                    m.genre === '综艺'
                );
            } else if (currentGenre === '演唱会') {
                list = list.filter(m =>
                    m.genres?.some(g => g.includes('演唱') || g.includes('音乐') || g.toLowerCase().includes('concert') || g.toLowerCase().includes('music')) ||
                    m.genre === '演唱会' || m.genre === '音乐会'
                );
            } else if (currentGenre === '其他') {
                // Everything that doesn't fit into the main categories
                const excluded = new Set();
                // Collect IDs of movies that belong to other categories
                movies.forEach(m => {
                    const em = enrichMovie(m);
                    const hasMeta = hasMetadata(m.id);
                    if (!hasMeta) return; // unscraped goes to "其他"
                    if (em.mediaType === 'tv') { excluded.add(m.id); return; }
                    if (em.mediaType !== 'movie') { excluded.add(m.id); return; }
                    if (em.genres?.some(g => g.includes('动画') || g.toLowerCase().includes('animation')) ||
                        em.genre === '动画' || em.genre === '动漫') { excluded.add(m.id); return; }
                    if (em.genres?.some(g => g.includes('综艺')) || em.genre === '综艺') { excluded.add(m.id); return; }
                    if (em.genres?.some(g => g.includes('演唱') || g.includes('音乐') || g.toLowerCase().includes('concert') || g.toLowerCase().includes('music')) ||
                        em.genre === '演唱会' || em.genre === '音乐会') { excluded.add(m.id); return; }
                });
                list = list.filter(m => !excluded.has(m.id) || !m._hasMeta);
            } else if (currentGenre === '纪录片') {
                list = list.filter(m =>
                    m.genres?.some(g => g.includes('纪录片')) ||
                    m.genre === '纪录片'
                );
            } else {
                // Standard genre filter (TMDB genre names like 剧情, 动作, etc.)
                list = list.filter(m => {
                    if (m.genres && m.genres.includes(currentGenre)) return true;
                    return m.genre === currentGenre;
                });
            }
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(m =>
                (m.title && m.title.toLowerCase().includes(q)) ||
                (m.desc && m.desc.toLowerCase().includes(q)) ||
                (m.originalTitle && m.originalTitle.toLowerCase().includes(q)) ||
                (m.genre && m.genre.toLowerCase().includes(q)) ||
                (m.director && m.director.toLowerCase().includes(q)) ||
                (m.folderPath && m.folderPath.toLowerCase().includes(q))
            );
        }
        return list;
    }

    // ===== Smart Chinese Search Engine =====

    /**
     * Compute relevance score for a movie given a search query.
     *
     * Matching priority (strict → loose):
     *   1. Exact / prefix / containment in TITLE (must have)
     *   2. Match in director, cast, genres (secondary)
     *   3. Chinese char overlap ONLY for multi-char queries ≥ 2 chars
     *
     * Single-char queries: ONLY match via direct containment in searchable fields.
     * This eliminates noise like searching "让" returning unrelated movies.
     *
     * Returns a number 0..1000+ where higher = more relevant.
     */
    function computeRelevance(movie, queryLower) {
        if (!queryLower) return 0;

        let score = 0;
        const q = queryLower.trim();
        const qLen = q.length;

        // Fields to search
        const title = (movie.title || '').toLowerCase();
        const origTitle = (movie.originalTitle || '').toLowerCase();
        const desc = (movie.desc || '').toLowerCase();
        const director = (movie.director || '').toLowerCase();
        const genreStr = (movie.genre || '').toLowerCase();
        const genres = movie.genres || [];
        const castNames = (movie.cast || []).map(c => (c.name || '').toLowerCase()).join(' ');
        const folderPath = (movie.folderPath || '').toLowerCase();

        // --- Strategy A: Title exact / prefix match (highest weight) ---
        if (title === q) score += 1000;
        else if (title.startsWith(q)) score += 800;
        else if (origTitle === q) score += 900;
        else if (origTitle.startsWith(q)) score += 750;

        // --- Strategy B: Containment in primary fields ---
        // Title & original title (most important)
        if (title.includes(q)) score += 500;
        if (origTitle.includes(q)) score += 450;

        // --- Strategy C: Secondary fields (director, cast, genre) ---
        // Only give secondary field points IF there's already SOME title-level match,
        // OR the query is long enough (≥2 chars) that it's meaningful.
        const hasTitleMatch = title.includes(q) || origTitle.includes(q);
        if (director.includes(q)) score += (hasTitleMatch || qLen >= 2) ? 400 : 0;
        if (castNames.includes(q)) score += (hasTitleMatch || qLen >= 2) ? 380 : 0;
        if (genreStr.includes(q) || genres.some(g => g.toLowerCase().includes(q))) {
            score += (hasTitleMatch || qLen >= 2) ? 200 : 0;
        }

        // --- Strategy D: Chinese char overlap (ONLY for multi-char queries ≥ 2) ---
        // This is fuzzy matching: useful for "复仇者联盟" → "复仇者" but harmful
        // for single char like "让" which matches thousands of titles.
        const queryChars = [...q].filter(c => /[\u4e00-\u9fff]/.test(c));
        if (queryChars.length >= 2) {
            // Check title fields for char-level overlap
            for (const field of [title, origTitle]) {
                const fieldChars = [...field].filter(c => /[\u4e00-\u9fff]/.test(c));
                const overlap = queryChars.filter(c => fieldChars.includes(c));
                const ratio = overlap.length / queryChars.length;

                if (ratio >= 0.5) {
                    // At least half of query chars found in this field
                    score += Math.round(ratio * 300);

                    // Consecutive phrase bonus: check if query chars appear close together
                    if (ratio >= 0.8 && q.length <= field.length) {
                        for (let i = 0; i <= field.length - qLen; i++) {
                            const substr = field.substring(i, i + qLen);
                            let matchCount = 0;
                            for (const qc of queryChars) {
                                if (substr.includes(qc)) matchCount++;
                            }
                            if (matchCount >= queryChars.length * 0.8) {
                                score += 250;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // --- Strategy E: Word-level token split (words ≥ 2 chars) ---
        const queryWords = q.split(/\s+/).filter(w => w.length > 1);
        for (const word of queryWords) {
            if (title.includes(word)) score += 150;
            if (origTitle.includes(word)) score += 130;
            if (director.includes(word)) score += 120;
            if (castNames.includes(word)) score += 110;
            if (desc.includes(word)) score += 60;
            if (folderPath.includes(word)) score += 40;
        }

        // Penalty: unscraped items rank lower
        if (!movie._hasMeta) score *= 0.5;

        return Math.round(score);
    }

    /**
     * Get all unique years from scraped movies (for year filter dropdowns)
     */
    function getAvailableYears() {
        const years = new Set();
        for (const m of movies) {
            const em = enrichMovie(m);
            if (em.year && /^\d{4}$/.test(em.year.toString())) {
                years.add(parseInt(em.year));
            }
        }
        return [...years].sort((a, b) => b - a);
    }

    /**
     * Get all unique TMDB genres from scraped movies
     */
    function getAvailableGenres() {
        const genreSet = new Set();
        for (const m of movies) {
            const em = enrichMovie(m);
            if (em.genres) em.genres.forEach(g => genreSet.add(g));
        }
        return [...genreSet].sort();
    }

    /**
     * Classify a movie into a media type category for the filter
     */
    function classifyMediaType(m) {
        if (!m._hasMeta) return null;
        if (m.mediaType === 'tv') return 'tv';
        if (m.genres?.some(g => g.includes('动画') || g.toLowerCase().includes('animation')) ||
            m.genre === '动画' || m.genre === '动漫') return 'anime';
        if (m.genres?.some(g => g.includes('综艺')) || m.genre === '综艺') return 'variety';
        if (m.genres?.some(g => g.includes('演唱') || g.includes('音乐') || g.toLowerCase().includes('concert') || g.toLowerCase().includes('music')) ||
            m.genre === '演唱会' || m.genre === '音乐会') return 'concert';
        if (m.mediaType === 'movie') return 'movie';
        return null;
    }

    /**
     * Main search function: apply query + all filters, sort, return results
     */
    function executeSearch() {
        let results = getSeriesList();

        const q = searchState.query.trim().toLowerCase();

        // Text search (smart relevance)
        if (q) {
            results = results.map(m => ({
                ...m,
                _relevance: computeRelevance(m, q),
            })).filter(m => {
                // Dynamic threshold: stricter for short queries to avoid noise
                const minScore = searchState.query.trim().length <= 1 ? 100 : 50;
                return m._relevance >= minScore;
            });
        } else {
            results = results.map(m => ({ ...m, _relevance: 0 }));
        }

        // Rating filter
        if (searchState.minRating > 0) {
            results = results.filter(m => (m.rating || 0) >= searchState.minRating);
        }

        // Year range filter
        if (searchState.yearFrom) {
            results = results.filter(m => {
                const y = parseInt(m.year);
                return !isNaN(y) && y >= parseInt(searchState.yearFrom);
            });
        }
        if (searchState.yearTo) {
            results = results.filter(m => {
                const y = parseInt(m.year);
                return !isNaN(y) && y <= parseInt(searchState.yearTo);
            });
        }

        // Media type filter
        if (searchState.mediaType !== 'all') {
            results = results.filter(m => classifyMediaType(m) === searchState.mediaType);
        }

        // Genre tag filter
        if (searchState.genreSet.size > 0) {
            results = results.filter(m =>
                m.genres?.some(g => searchState.genreSet.has(g))
            );
        }

        // Sort
        switch (searchState.sortBy) {
            case 'rating':
                results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
                break;
            case 'year-desc':
                results.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
                break;
            case 'year-asc':
                results.sort((a, b) => (parseInt(a.year) || 9999) - (parseInt(b.year) || 9999));
                break;
            case 'title':
                results.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
                break;
            case 'relevance':
            default:
                results.sort((a, b) => (b._relevance || 0) - (a._relevance || 0));
                break;
        }

        return results;
    }

    /**
     * Render the search page
     */
    function renderSearchPage() {
        // Populate year selects (only once)
        populateYearSelects();
        // Populate genre chips (only once)
        populateGenreChips();

        // Run search
        const results = executeSearch();

        const grid = document.getElementById('searchResultsGrid');
        const empty = document.getElementById('searchEmptyState');
        const init = document.getElementById('searchInitState');
        const bar = document.getElementById('searchResultsBar');
        const info = document.getElementById('resultsInfo');

        const hasQuery = searchState.query.trim().length > 0 ||
            searchState.minRating > 0 || searchState.yearFrom || searchState.yearTo ||
            searchState.mediaType !== 'all' || searchState.genreSet.size > 0;

        if (!hasQuery) {
            // Initial state - no search yet
            grid.innerHTML = '';
            bar.style.display = 'none';
            empty.style.display = 'none';
            init.style.display = '';
            updateFilterCount();
            return;
        }

        init.style.display = 'none';

        if (results.length === 0) {
            grid.innerHTML = '';
            bar.style.display = 'none';
            empty.style.display = '';
        } else {
            empty.style.display = 'none';
            bar.style.display = 'flex';
            info.innerHTML = `找到 <strong>${results.length}</strong> 部影片`;
            Render.movieGrid(grid, results);
        }

        updateFilterCount();
    }

    function populateYearSelects() {
        const fromSel = document.getElementById('yearFrom');
        const toSel = document.getElementById('yearTo');
        if (!fromSel || !toSel) return;
        if (fromSel.options.length > 1) return; // already populated

        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= 1950; y--) {
            fromSel.add(new Option(y, y));
            toSel.add(new Option(y, y));
        }
    }

    function populateGenreChips() {
        const container = document.getElementById('searchGenreChips');
        if (!container || container.children.length > 0) return;

        const genres = getAvailableGenres();
        container.innerHTML = genres.map(g =>
            `<button class="genre-chip" data-genre="${g}" onclick="App.toggleSearchGenre('${g}')">${g}</button>`
        ).join('');
    }

    function updateFilterCount() {
        const el = document.getElementById('activeFilterCount');
        if (!el) return;

        let count = 0;
        if (searchState.minRating > 0) count++;
        if (searchState.yearFrom) count++;
        if (searchState.yearTo) count++;
        if (searchState.mediaType !== 'all') count++;
        if (searchState.genreSet.size > 0) count++;

        el.textContent = count > 0 ? `${count} 个筛选条件` : '';
    }

    function getCategorizedRows() {
        // Use series-merged list
        const enriched = getSeriesList();
        const rows = [];

        if (enriched.length === 0) return rows;

        // Recently watched - resolve series-aware, dedup TV episodes
        const history = Store.getHistory();
        if (history.length > 0) {
            const seenSeries = new Set();
            const histMovies = history
                .map(h => {
                    // Try exact match first
                    let found = enriched.find(em => em.id === h.id);
                    // If not found, check if it's an episode inside a series
                    if (!found) {
                        found = enriched.find(em =>
                            em.isSeries && em.episodes && em.episodes.some(ep => ep.id === h.id)
                        );
                    }
                    // Fallback: use raw history entry with enriched data
                    if (!found) {
                        const raw = movies.find(m => m.id === h.id);
                        found = raw ? enrichMovie(raw) : null;
                    }
                    return found || h;
                })
                .filter(m => {
                    if (!m) return false;
                    // Dedup: for series, use seriesId; for standalone, use id
                    const dedupKey = m.seriesId || m.id;
                    if (seenSeries.has(dedupKey)) return false;
                    seenSeries.add(dedupKey);
                    return true;
                })
                .slice(0, 20);
            if (histMovies.length > 0) {
                rows.push({ title: '最近观看', icon: 'fa-clock-rotate-left', movies: histMovies, id: 'recent' });
            }
        }

        // Separate scraped vs unscraped
        const scraped = enriched.filter(m => m._hasMeta);
        const unscraped = enriched.filter(m => !m._hasMeta);

        // TV Series (scraped)
        const tvItems = scraped.filter(m => m.mediaType === 'tv');

        // Animation / Anime (scraped)
        const animeItems = scraped.filter(m =>
            m.genres?.some(g => g.includes('动画') || g.toLowerCase().includes('animation')) ||
            m.genre === '动画' || m.genre === '动漫'
        );

        // Variety shows (综艺) - items with 综艺 genre
        const varietyItems = scraped.filter(m =>
            m.genres?.some(g => g.includes('综艺')) ||
            m.genre === '综艺'
        );

        // Concerts (演唱会)
        const concertItems = scraped.filter(m =>
            m.genres?.some(g => g.includes('演唱') || g.includes('音乐') || g.includes('concert') || g.includes('music')) ||
            m.genre === '演唱会' || m.genre === '音乐会'
        );

        // Movies = scraped items not TV, Anime, Variety, or Concert
        const excludeIds = new Set([...tvItems, ...animeItems, ...varietyItems, ...concertItems].map(m => m.id));
        const movieItems = scraped.filter(m => !excludeIds.has(m.id));

        if (movieItems.length > 0) {
            rows.push({ title: '电影', icon: 'fa-film', movies: movieItems, id: 'movies' });
        }
        if (tvItems.length > 0) {
            rows.push({ title: '电视剧', icon: 'fa-tv', movies: tvItems, id: 'tv' });
        }
        if (animeItems.length > 0) {
            rows.push({ title: '动漫', icon: 'fa-hat-wizard', movies: animeItems, id: 'anime' });
        }
        if (varietyItems.length > 0) {
            rows.push({ title: '综艺', icon: 'fa-masks-theater', movies: varietyItems, id: 'variety' });
        }
        if (concertItems.length > 0) {
            rows.push({ title: '演唱会', icon: 'fa-music', movies: concertItems, id: 'concert' });
        }

        return rows;
    }

    // ===== Renderers =====

    function renderHome() {
        const homeContent = document.getElementById('homeContent');
        const movieGrid = document.getElementById('movieGrid');
        const empty = document.getElementById('emptyState');

        if (currentGenre !== 'all' || searchQuery) {
            homeContent.style.display = 'none';
            movieGrid.style.display = 'grid';
            const filtered = getFiltered();
            const hasItems = Render.movieGrid(movieGrid, filtered);
            empty.style.display = hasItems ? 'none' : 'block';
        } else {
            homeContent.style.display = 'block';
            movieGrid.style.display = 'none';
            const rows = getCategorizedRows();
            Render.categoryRows(rows, homeContent);
            // Show standalone empty state only when no movies at all
            // (categoryRows already renders its own empty placeholder)
            empty.style.display = 'none';
        }
    }

    function renderFavorites() {
        const grid = document.getElementById('favGrid');
        const empty = document.getElementById('favEmpty');
        const favIds = Store.getFavorites();
        const favMovies = getSeriesList().filter(m => favIds.includes(m.id) || favIds.includes(m.seriesId));
        const hasItems = Render.movieGrid(grid, favMovies);
        empty.style.display = hasItems ? 'none' : 'block';
    }

    function renderHistory() {
        const list = document.getElementById('historyList');
        const empty = document.getElementById('historyEmpty');
        const items = Store.getHistory();
        // Dedup: keep only latest entry per series
        const seenSeries = new Set();
        const deduped = items.filter(item => {
            const series = getSeriesList().find(s =>
                s.isSeries && s.episodes && s.episodes.some(ep => ep.id === item.id)
            );
            const key = series ? series.seriesId : item.id;
            if (seenSeries.has(key)) return false;
            seenSeries.add(key);
            return true;
        });
        const hasItems = Render.historyList(list, deduped);
        empty.style.display = hasItems ? 'none' : 'block';
    }

    function getGenreMovies(genreTag) {
        const list = getSeriesList();
        return list.filter(m => {
            if (m.genres && m.genres.includes(genreTag)) return true;
            return m.genre === genreTag;
        });
    }

    // ===== Navigation =====

    function navigate(page) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + page)?.classList.add('active');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navItem) navItem.classList.add('active');

        // Track SPA page view
        fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page }),
        }).catch(() => {});

        if (page === 'home') {
            currentGenre = 'all';
            searchQuery = '';
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.genre === 'all');
            });
        }

        if (page === 'home') renderHome();
        if (page === 'favorites') renderFavorites();
        if (page === 'history') renderHistory();
        if (page === 'import') {
            if (Admin.isLoggedIn()) {
                renderScrapePanel();
            } else {
                showImportGuard();
            }
        }
        if (page === 'search') renderSearchPage();

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');
    }

    function filterGenre(genre) {
        // Show home page
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-home').classList.add('active');

        // Update sidebar navigation active state
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-page="home"]`);
        if (navItem) navItem.classList.add('active');

        currentGenre = genre;
        document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.genre === genre);
        });
        renderHome();
        document.getElementById('sidebar').classList.remove('open');
    }

    function handleSearch(val) {
        searchState.query = val.trim();
        // Navigate to search page
        if (!document.getElementById('page-search').classList.contains('active')) {
            navigate('search');
        } else {
            renderSearchPage();
        }
    }

    // ===== Search Page Public API =====

    function onSearchInput(val) {
        searchState.query = val;
        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
        // Debounced search: only run on Enter or after typing stops
        if (window._searchTimer) clearTimeout(window._searchTimer);
        window._searchTimer = setTimeout(() => { renderSearchPage(); }, 200);
    }

    function doGlobalSearch() {
        if (window._searchTimer) clearTimeout(window._searchTimer);
        renderSearchPage();
    }

    function clearSearch() {
        const input = document.getElementById('globalSearchInput');
        if (input) { input.value = ''; input.focus(); }
        searchState.query = '';
        document.getElementById('searchClearBtn').style.display = 'none';
        renderSearchPage();
    }

    function toggleSearchFilters() {
        searchState.filtersOpen = !searchState.filtersOpen;
        const panel = document.getElementById('searchFiltersPanel');
        const btn = document.getElementById('searchFilterToggleBtn');
        if (panel) panel.classList.toggle('open', searchState.filtersOpen);
        if (btn) btn.classList.toggle('active', searchState.filtersOpen);
    }

    function setFilter(key, value) {
        switch (key) {
            case 'minRating':
                searchState.minRating = parseFloat(value);
                document.querySelectorAll('.rating-range-group .rf-btn').forEach(b => {
                    b.classList.toggle('active', parseFloat(b.dataset.min) === searchState.minRating);
                });
                break;
            case 'yearFrom':
                searchState.yearFrom = value;
                break;
            case 'yearTo':
                searchState.yearTo = value;
                break;
            case 'mediaType':
                searchState.mediaType = value;
                document.querySelectorAll('.mt-chip').forEach(c => {
                    c.classList.toggle('active', c.dataset.type === value);
                });
                break;
            case 'sortBy':
                searchState.sortBy = value;
                document.querySelectorAll('.sort-opt').forEach(o => {
                    o.classList.toggle('active', o.dataset.sort === value);
                });
                break;
        }
        renderSearchPage();
    }

    function toggleSearchGenre(genre) {
        if (searchState.genreSet.has(genre)) {
            searchState.genreSet.delete(genre);
        } else {
            searchState.genreSet.add(genre);
        }
        // Update chip UI
        document.querySelectorAll('.genre-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.genre === genre ? !c.classList.contains('active') : c.classList.contains('active'));
        });
        // Actually re-query DOM for correct state
        document.querySelector(`.genre-chip[data-genre="${genre}"]`)?.classList.toggle('active', searchState.genreSet.has(genre));
        renderSearchPage();
    }

    function resetSearchFilters() {
        searchState.minRating = 0;
        searchState.yearFrom = '';
        searchState.yearTo = '';
        searchState.mediaType = 'all';
        searchState.genreSet.clear();
        searchState.sortBy = 'relevance';

        // Reset year selects
        const yf = document.getElementById('yearFrom'); if (yf) yf.value = '';
        const yt = document.getElementById('yearTo');   if (yt) yt.value = '';

        // Reset rating buttons
        document.querySelectorAll('.rf-btn').forEach(b => b.classList.toggle('active', b.dataset.min === '0'));

        // Reset media type chips
        document.querySelectorAll('.mt-chip').forEach(c => c.classList.toggle('active', c.dataset.type === 'all'));

        // Reset sort options
        document.querySelectorAll('.sort-opt').forEach(o => o.classList.toggle('active', o.dataset.sort === 'relevance'));

        // Reset genre chips
        document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));

        renderSearchPage();
    }

    // ===== Player =====

    function playMovie(id) {
        const movie = movies.find(m => m.id === id);
        if (!movie) return;

        const enriched = enrichMovie(movie);

        document.getElementById('playerTitle').textContent = enriched.title;

        const metaParts = [];
        if (enriched.year) metaParts.push(`<span><i class="fas fa-calendar"></i> ${enriched.year}</span>`);
        if (enriched.rating) metaParts.push(`<span><i class="fas fa-star" style="color:#f1c40f"></i> ${enriched.rating}</span>`);
        if (enriched.runtime) metaParts.push(`<span><i class="fas fa-clock"></i> ${enriched.runtime}分钟</span>`);
        if (enriched.director) metaParts.push(`<span><i class="fas fa-clapperboard"></i> ${enriched.director}</span>`);
        if (enriched.genres?.length > 0) {
            metaParts.push(`<span><i class="fas fa-tags"></i> ${enriched.genres.join(' / ')}</span>`);
        }
        document.getElementById('playerMeta').innerHTML = metaParts.join('');

        let descHtml = enriched.desc || '暂无简介';
        if (enriched.cast?.length > 0) {
            const castNames = enriched.cast.slice(0, 6).map(c => c.name).join('、');
            descHtml += `<br><br><span class="cast-label">主演：</span>${castNames}`;
        }
        document.getElementById('playerDesc').innerHTML = descHtml;

        document.getElementById('btnFav').classList.toggle('active', Store.isFavorite(movie.id));

        const modalContent = document.querySelector('.modal-content');
        if (enriched.backdrop) {
            modalContent.style.setProperty('--backdrop-img', `url(${enriched.backdrop})`);
            modalContent.classList.add('has-backdrop');
        } else {
            modalContent.classList.remove('has-backdrop');
        }

        // Inject next episode info for series
        const series = getSeriesList().find(s =>
            s.isSeries && s.episodes && s.episodes.some(ep => ep.id === movie.id)
        );
        if (series) {
            const currentIdx = series.episodes.findIndex(ep => ep.id === movie.id);
            if (currentIdx >= 0 && currentIdx < series.episodes.length - 1) {
                enriched._nextEpisodeId = series.episodes[currentIdx + 1].id;
                enriched._nextEpisodeTitle = series.episodes[currentIdx + 1].name || series.episodes[currentIdx + 1].title || `第${currentIdx + 2}集`;
                enriched._seriesId = series.seriesId;
                enriched._currentEpisodeIndex = currentIdx;
            }
        }

        Player.play(enriched);
        document.getElementById('playerModal').classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closePlayer() {
        document.getElementById('playerModal').classList.remove('open');
        document.body.style.overflow = '';
        document.querySelector('.modal-content')?.classList.remove('has-backdrop');
        Player.destroy();
        renderHistory();
        renderFavorites();
    }

    function closePlayerOutside(e) {
        if (e.target === document.getElementById('playerModal')) closePlayer();
    }

    // ===== Admin Guard =====

    function showImportGuard() {
        const importPage = document.getElementById('page-import');
        if (!importPage) return;
        // Hide normal import content, show guard message
        importPage.querySelector('.import-page-header').style.display = 'none';
        importPage.querySelector('.import-desc').style.display = 'none';
        importPage.querySelector('.import-form').style.display = 'none';
        importPage.querySelector('#importStatus').style.display = 'none';
        importPage.querySelector('#importLoading').style.display = 'none';
        importPage.querySelector('#importTreeSection').style.display = 'none';
        const panel = importPage.querySelector('#scrapePanel');
        if (panel) panel.style.display = 'none';

        // Show guard (create if not exists)
        let guard = document.getElementById('importAdminGuard');
        if (!guard) {
            guard = document.createElement('div');
            guard.id = 'importAdminGuard';
            guard.className = 'import-admin-guard';
            guard.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <p>导入与维护功能需要管理员权限</p>
                    <button class="btn-import-guard" onclick="Admin.showLogin()">
                        <i class="fas fa-shield-halved"></i> 管理员登录
                    </button>
                </div>`;
            importPage.appendChild(guard);
        }
        guard.style.display = '';
    }

    function hideImportGuard() {
        const importPage = document.getElementById('page-import');
        if (!importPage) return;
        const guard = document.getElementById('importAdminGuard');
        if (guard) guard.style.display = 'none';
        const header = importPage.querySelector('.import-page-header');
        if (header) header.style.display = '';
        importPage.querySelector('.import-desc').style.display = '';
        importPage.querySelector('.import-form').style.display = '';
        const panel = importPage.querySelector('#scrapePanel');
        if (panel) panel.style.display = '';
    }

    function requireAdmin() {
        if (!Admin.isLoggedIn()) {
            Admin.showLogin();
            return false;
        }
        return true;
    }

    // ===== Detail Page =====

    let previousPage = 'home';

    function showDetail(seriesId) {
        const series = getSeriesList().find(s => s.seriesId === seriesId || s.id === seriesId);
        if (!series) {
            // Fallback: try direct movie
            const movie = movies.find(m => m.id === seriesId);
            if (movie) {
                playMovie(seriesId);
                return;
            }
            return;
        }

        // Remember current page
        const activePage = document.querySelector('.page.active');
        if (activePage) {
            previousPage = activePage.id.replace('page-', '');
        }

        // Navigate to detail
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-detail').classList.add('active');

        // Render
        Render.renderDetail(document.getElementById('detailContent'), series);
    }

    function closeDetail() {
        navigate(previousPage || 'home');
    }

    function playEpisode(seriesId, idx) {
        const series = getSeriesList().find(s => s.seriesId === seriesId);
        if (!series || !series.episodes || !series.episodes[idx]) return;

        const ep = series.episodes[idx];
        playMovie(ep.id);
    }

    /**
     * Switch season in detail page
     */
    function switchSeason(seriesId, seasonIdx) {
        const series = getSeriesList().find(s => s.seriesId === seriesId);
        if (!series || !series.seasons || !series.seasons[seasonIdx]) return;

        // Update tabs
        document.querySelectorAll(`#seasonTabs_${seriesId} .season-tab`).forEach((btn, i) => {
            btn.classList.toggle('active', i === seasonIdx);
        });

        // Update episode scroll
        const epScroll = document.getElementById(`epScroll_${seriesId}`);
        if (!epScroll) return;

        const season = series.seasons[seasonIdx];
        const baseIdx = series.seasons.slice(0, seasonIdx).reduce((sum, s) => sum + s.episodes.length, 0);
        const FALLBACK_POSTER = Render.FALLBACK_POSTER;
        epScroll.innerHTML = season.episodes.map((ep, idx) => {
            const epName = ep.episodeName || ep.name || ep.title || (baseIdx + idx + 1);
            const epThumb = ep.episodeStill || ep.poster || series.poster || '';
            const epNum = ep.episodeNumber || (baseIdx + idx + 1);
            return `<div class="ep-item" onclick="App.playMovie('${ep.id}')">
                <div class="ep-thumb">
                    ${epThumb ? `<img src="${epThumb}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'ep-thumb-fallback\\'>${epNum}</div>'">` : `<div class="ep-thumb-fallback">${epNum}</div>`}
                    <div class="ep-overlay"><i class="fas fa-play-circle"></i></div>
                </div>
                <div class="ep-num">${epNum}. ${epName}</div>
            </div>`;
        }).join('');
    }

    function _escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function toggleFavFromPlayer() {
        const movie = Player.getCurrentMovie();
        if (!movie) return;
        Store.toggleFavorite(movie.id);
        document.getElementById('btnFav').classList.toggle('active', Store.isFavorite(movie.id));
        renderFavorites();
    }

    function clearHistory() {
        if (confirm('确定要清空所有观看历史吗？')) {
            Store.clearHistory();
            renderHistory();
        }
    }

    // ===== Theme =====

    function toggleTheme() {
        const current = Store.getTheme();
        const next = current === 'dark' ? 'light' : 'dark';
        Store.setTheme(next);
        applyTheme();
    }

    function applyTheme() {
        const theme = Store.getTheme();
        document.documentElement.setAttribute('data-theme', theme);
        const icon = document.getElementById('themeIcon');
        icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
        const iconMobile = document.getElementById('themeIconMobile');
        if (iconMobile) iconMobile.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    }

    // ===== Import: Status & UI =====

    function showImportStatus(message, type) {
        const el = document.getElementById('importStatus');
        el.style.display = 'flex';
        el.className = 'import-status ' + type;
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
        el.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    }

    function hideImportStatus() {
        document.getElementById('importStatus').style.display = 'none';
    }

    function showImportLoading(show) {
        document.getElementById('importLoading').style.display = show ? 'flex' : 'none';
    }

    // ===== Import: File Tree =====

    /**
     * Register tree nodes into the treeChildrenMap
     */
    function registerTreeNodes(nodes, parentPath) {
        if (!nodes) return;
        const arr = [];
        for (const node of nodes) {
            treeChildrenMap.set(node.path, node.children || []);
            arr.push(node);
            if (node.children) {
                registerTreeNodes(node.children, node.path);
            }
        }
        treeChildrenMap.set(parentPath, arr);
    }

    /**
     * Re-register all tree nodes (after updates)
     */
    function rebuildTreeMap() {
        treeChildrenMap = new Map();
        if (shareData && shareData.children) {
            registerTreeNodes(shareData.children, shareData.sharePath);
        }
    }

    /**
     * Main import handler: parse share link and show file tree
     */
    async function handleImport() {
        if (!requireAdmin()) return;

        const shareUrl = document.getElementById('shareLink').value.trim();
        const password = document.getElementById('sharePwd').value.trim();

        if (!shareUrl) { showImportStatus('请输入分享链接', 'error'); return; }

        hideImportStatus();
        showImportLoading(true);
        document.getElementById('btnParseShare').disabled = true;

        // Reset tree state
        shareData = null;
        treeChildrenMap = new Map();
        checkedSet = new Set();

        try {
            shareData = await ShareParser.parseShareLink(shareUrl, password);

            // Build tree map
            rebuildTreeMap();

            if (shareData.children.length === 0) {
                showImportStatus('此分享链接中没有找到文件', 'error');
                showImportLoading(false);
                document.getElementById('btnParseShare').disabled = false;
                return;
            }

            // Count total video files at root level (not recursive)
            const rootFileCount = shareData.children.filter(c => c.type === 'file').length;
            const rootFolderCount = shareData.children.filter(c => c.type === 'folder').length;
            showImportStatus(
                `已连接：${shareData.linkName}（${rootFolderCount} 个文件夹，${rootFileCount} 个视频文件）`,
                'success'
            );

            // Render file tree
            renderFileTreeUI();

        } catch (e) {
            showImportStatus(e.message || '解析失败，请稍后重试', 'error');
        } finally {
            showImportLoading(false);
            document.getElementById('btnParseShare').disabled = false;
        }
    }

    /**
     * Render the file tree and toolbar
     */
    function renderFileTreeUI() {
        const treeContainer = document.getElementById('importFileTree');
        const toolbarContainer = document.getElementById('importToolbar');
        const treeSection = document.getElementById('importTreeSection');

        if (!treeContainer || !toolbarContainer) return;

        treeSection.style.display = 'block';

        Render.renderFileTree(treeContainer, shareData, treeChildrenMap, checkedSet);

        // Count totals for toolbar
        let totalFiles = 0;
        let selectedFiles = 0;
        let hasCheckedFolder = false;
        for (const child of shareData.children) {
            totalFiles += Render.countLeafFiles(child, treeChildrenMap);
            selectedFiles += Render.countCheckedFiles(child.path, treeChildrenMap, checkedSet);
            if (child.type === 'folder' && checkedSet.has(child.path)) {
                hasCheckedFolder = true;
            }
        }

        Render.renderImportToolbar(toolbarContainer, selectedFiles, totalFiles, isImporting, hasCheckedFolder || checkedSet.size > 0);
    }

    /**
     * Toggle folder expand/collapse
     */
    async function toggleTreeNode(path) {
        if (!shareData) return;

        // Find the node
        const node = findNodeByPath(path);
        if (!node || node.type !== 'folder') return;

        if (node.expanded) {
            // Collapse
            node.expanded = false;
            renderFileTreeUI();
            return;
        }

        // Expand - load children if needed
        if (!node.childrenLoaded) {
            node.loading = true;
            renderFileTreeUI();

            try {
                const children = await ShareParser.getFolderContents(
                    shareData.linkID, shareData.passwd, node.id, node.path
                );
                node.children = children;
                node.childrenLoaded = true;
            } catch (e) {
                console.error('Failed to load folder:', e);
                showImportStatus('加载文件夹失败：' + e.message, 'error');
            } finally {
                node.loading = false;
            }
        }

        node.expanded = true;
        rebuildTreeMap();
        renderFileTreeUI();
    }

    /**
     * Toggle checkbox for a tree node.
     */
    function toggleTreeCheck(path) {
        if (!shareData) return;

        if (checkedSet.has(path)) {
            checkedSet.delete(path);
            removeDescendantsFromChecked(path);
        } else {
            checkedSet.add(path);
            addDescendantsToChecked(path);
        }

        renderFileTreeUI();
    }

    function addDescendantsToChecked(path) {
        const node = findNodeByPath(path);
        if (!node || !node.childrenLoaded || !node.children) return;
        for (const child of node.children) {
            checkedSet.add(child.path);
            addDescendantsToChecked(child.path);
        }
    }

    function removeDescendantsFromChecked(path) {
        const node = findNodeByPath(path);
        if (!node || !node.childrenLoaded || !node.children) return;
        for (const child of node.children) {
            checkedSet.delete(child.path);
            removeDescendantsFromChecked(child.path);
        }
    }

    /**
     * Find a tree node by its path
     */
    function findNodeByPath(targetPath) {
        if (!shareData) return null;

        // Check root
        if (targetPath === shareData.sharePath) return shareData;

        function search(nodes) {
            for (const node of nodes) {
                if (node.path === targetPath) return node;
                if (node.children && node.childrenLoaded) {
                    const found = search(node.children);
                    if (found) return found;
                }
            }
            return null;
        }

        return search(shareData.children || []);
    }

    /**
     * Select all tree nodes
     */
    function selectAllTree() {
        if (!shareData) return;
        checkedSet.add(shareData.sharePath);
        addDescendantsToChecked(shareData.sharePath);
        renderFileTreeUI();
    }

    /**
     * Unselect all tree nodes
     */
    function unselectAllTree() {
        checkedSet.clear();
        renderFileTreeUI();
    }

    /**
     * Add selected files to library
     */
    // ===== Smart Import (folder-level batch) =====

    let smartImportState = null;

    async function smartImport() {
        console.log('[Import] ===== 智能导入启动 =====');
        if (!requireAdmin()) { console.log('[Import] 未登录, 中止'); return; }
        if (!shareData || isImporting) { console.log('[Import] shareData=' + !!shareData + ' isImporting=' + isImporting + ', 中止'); return; }
        if (checkedSet.size === 0) {
            console.log('[Import] checkedSet 为空, 中止');
            showImportStatus('请先在文件树中勾选要导入的文件夹或文件', 'error');
            return;
        }
        console.log('[Import] checkedSet 大小: ' + checkedSet.size);

        isImporting = true;
        hideImportStatus();
        document.getElementById('importTreeSection').style.display = 'none';

        // Progress UI
        let progEl = document.getElementById('smartImportProgress');
        if (!progEl) {
            progEl = document.createElement('div');
            progEl.id = 'smartImportProgress';
            progEl.className = 'smart-import-progress';
            document.getElementById('page-import').appendChild(progEl);
        }
        progEl.style.display = '';
        progEl.innerHTML = `
            <div class="smart-progress-card">
                <div class="smart-progress-icon"><i class="fas fa-folder-tree"></i></div>
                <h3>正在收集文件...</h3>
                <p class="smart-progress-info" id="smartScanInfo">已扫描 0 个文件夹</p>
                <div class="smart-progress-track"><div class="smart-progress-bar" style="width:0%"></div></div>
            </div>`;

        try {
            let allFiles;

            // 统一用 API 重新加载，不走旧树缓存
            const rootsToScan = [];
            for (const child of shareData.children) {
                // 勾选了文件夹 → 整棵递归收集
                if (checkedSet.has(child.path)) rootsToScan.push(child);
            }

            if (rootsToScan.length > 0) {
                console.log('[Import] 文件夹模式, 根节点数: ' + rootsToScan.length);
                allFiles = await ShareParser.recursiveCollectFiles(
                    shareData.linkID, shareData.passwd, rootsToScan,
                    (prog) => {
                        const info = document.getElementById('smartScanInfo');
                        if (info) info.textContent = '已扫描 ' + prog.scanned + ' 个节点，发现 ' + prog.found + ' 个视频';
                    }
                );
            } else {
                // 仅勾选具体文件 → 也要用 API 重载，不走旧缓存
                console.log('[Import] 无文件夹勾选，从选中的文件路径重新收集');
                // 从树中提取所有被勾选的文件路径，重新调用 API 加载
                const checkedFolders = [];
                function findChecked(node, path) {
                    const fullPath = path ? path + ' / ' + node.name : node.name;
                    if (checkedSet.has(node.path)) {
                        if (node.type === 'folder') checkedFolders.push(node);
                    }
                    if (node.children) {
                        for (const child of node.children) findChecked(child, fullPath);
                    }
                }
                for (const child of shareData.children) findChecked(child, '');
                
                if (checkedFolders.length > 0) {
                    allFiles = await ShareParser.recursiveCollectFiles(
                        shareData.linkID, shareData.passwd, checkedFolders,
                        (prog) => {
                            const info = document.getElementById('smartScanInfo');
                            if (info) info.textContent = '已扫描 ' + prog.scanned + ' 个节点，发现 ' + prog.found + ' 个视频';
                        }
                    );
                } else {
                    allFiles = await ShareParser.collectSelectedFiles(
                        shareData.children, checkedSet, shareData.linkID, shareData.passwd
                    );
                }
            }

            console.log('[Import] 收集完成, 共 ' + allFiles.length + ' 个视频文件');
            if (allFiles.length === 0) {
                console.warn('[Import] 没有找到视频文件!');
                showImportStatus('所选文件夹中没有找到视频文件', 'error');
                isImporting = false;
                progEl.style.display = 'none';
                document.getElementById('importTreeSection').style.display = '';
                return;
            }

            console.log('[Import] 文件样例: ' + allFiles.slice(0,5).map(f => f.folderPath + '/' + f.name).join(' | '));
            progEl.innerHTML = `
                <div class="smart-progress-card">
                    <div class="smart-progress-icon"><i class="fas fa-magnifying-glass"></i></div>
                    <h3>正在分析文件结构...</h3>
                    <p class="smart-progress-info">发现 ${allFiles.length} 个视频文件，正在分组...</p>
                </div>`;

            await new Promise(r => setTimeout(r, 100)); // let UI update

            let groups;
            try {
                if (typeof Scraper === 'undefined' || !Scraper.analyzeImportGroups) {
                    throw new Error('刮削模块未正确加载，请刷新页面后重试');
                }
                groups = Scraper.analyzeImportGroups(allFiles);
                console.log('[Import] 分析完成: ' + groups.length + ' 组');
                const tvCount = groups.filter(g => g.mediaType === 'tv').length;
                const movieCount = groups.filter(g => g.mediaType === 'movie').length;
                console.log('[Import] 类型分布: TV=' + tvCount + ' Movie=' + movieCount);
                groups.slice(0,10).forEach((g, i) => console.log('[Import]  ' + (i+1) + '. ' + g.title + ' (' + g.mediaType + ', ' + g.fileCount + ' 文件, ' + g.seasons.length + ' 分季)'));
            } catch (analyzeErr) {
                console.error('[Import] analyzeImportGroups 异常:', analyzeErr);
                progEl.innerHTML = `
                    <div class="smart-progress-card">
                        <div class="smart-progress-icon" style="color:var(--danger)"><i class="fas fa-exclamation-triangle"></i></div>
                        <h3>分析失败</h3>
                        <p class="smart-progress-info">${analyzeErr.message || '分析文件结构时出错，请缩小选择范围重试'}</p>
                    </div>`;
                isImporting = false;
                setTimeout(() => {
                    progEl.style.display = 'none';
                    document.getElementById('importTreeSection').style.display = '';
                }, 3000);
                return;
            }

            Render.renderSmartImportSummary(progEl, groups, allFiles.length);
            smartImportState = { groups, files: allFiles };
            isImporting = false;

        } catch (e) {
            showImportStatus('扫描失败: ' + e.message, 'error');
            isImporting = false;
            progEl.style.display = 'none';
            document.getElementById('importTreeSection').style.display = '';
        }
    }

    async function confirmSmartImport() {
        if (!smartImportState || isImporting) {
            console.log('[Import] confirmSmartImport 跳过: state=' + !!smartImportState + ' importing=' + isImporting);
            return;
        }
        const { groups } = smartImportState;
        console.log('[Import] ===== 确认导入, 共 ' + groups.length + ' 组 =====');

        isImporting = true;
        const progEl = document.getElementById('smartImportProgress');
        console.log('[Import] 读取现有影片...');
        const existing = await getImportedMovies();
        console.log('[Import] 现有影片: ' + existing.length + ' 部');
        const existingIds = new Set(existing.map(m => m.id));

        progEl.innerHTML = `
            <div class="smart-progress-card">
                <h3>正在导入并刮削...</h3>
                <p class="smart-progress-info" id="smartScrapeInfo">准备中...</p>
                <div class="smart-progress-track"><div class="smart-progress-bar" id="smartScrapeBar" style="width:0%"></div></div>
                <p class="smart-progress-detail" id="smartScrapeDetail"></p>
            </div>`;

        let totalScraped = 0;
        let totalImported = 0;
        const failedGroups = [];
        const pendingMeta = []; // 批量收集元数据，最后一次性写入

        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const info = document.getElementById('smartScrapeInfo');
            const bar = document.getElementById('smartScrapeBar');
            const detail = document.getElementById('smartScrapeDetail');

            if (info) info.textContent = '[' + (i + 1) + '/' + groups.length + '] ' + group.title;
            if (bar) bar.style.width = Math.round((i / groups.length) * 100) + '%';

            let newImports = 0;
            let metaRecords = [];
            try {
                console.log('  [' + (i+1) + '/' + groups.length + '] 刮削: ' + group.title + ' (' + group.mediaType + ')');
                metaRecords = await Scraper.scrapeGroup(group);
                console.log('  [' + (i+1) + '/' + groups.length + '] 完成: ' + group.title + ', 获取 ' + (metaRecords?.length||0) + ' 条');

                for (let j = 0; j < group.seasons.length; j++) {
                    const season = group.seasons[j];
                    for (let k = 0; k < season.episodes.length; k++) {
                        const ep = season.episodes[k];
                        const file = ep.file;
                        // 优先用云盘fileId（coID），保证每集唯一
                        const idSrc = (file.fileId ? 'fid-' + file.fileId : file.name + '|' + (file.folderPath||'') + '|s' + season.num + 'e' + k);
                        const id = 'import-' + btoa(encodeURIComponent(idSrc))
                            .replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);

                        if (existingIds.has(id)) continue;

                        const importTitle = group.title + (group.mediaType === 'tv'
                            ? ' S' + season.num + 'E' + String(ep.epNum).padStart(2, '0')
                            : '');

                        const movie = {
                            id, title: importTitle,
                            name: file.name || importTitle,
                            poster: file.thumbUrl || '',
                            desc: '', genre: '导入',
                            year: new Date().getFullYear(),
                            rating: null, duration: null,
                            videoUrl: file.downloadUrl || file.fileId,
                            fileSize: file.size,
                            fileSizeText: file.sizeText,
                            folderPath: file.folderPath || '',
                            source: '139share',
                            importedAt: Date.now(),
                        };

                        existing.push(movie);
                        existingIds.add(id);
                        newImports++;
                        totalImported++;

                        const metaIdx = j * (season.episodes.length || 1) + k;
                        if (metaRecords && metaRecords[metaIdx]) {
                            const meta = metaRecords[metaIdx];
                            const record = {
                                ...meta, id: 'meta-' + id, movieId: id, updatedAt: Date.now(),
                            };
                            pendingMeta.push(record);
                            metadataMap[id] = record;
                            totalScraped++;
                        }
                    }
                }

            if (detail) {
                detail.textContent = group.title + ': 导入 ' + newImports + ' 个文件，刮削 ' +
                    Math.min(newImports, metaRecords ? metaRecords.length : 0) + ' 个';
            }
            console.log('[SmartImport] 组完成: ' + group.title + ', 导入 ' + newImports + ', 刮削 ' + Math.min(newImports, metaRecords ? metaRecords.length : 0));
            } catch (groupErr) {
                console.error('[SmartImport] 刮削组 "' + group.title + '" 失败:', groupErr);
                failedGroups.push({ title: group.title, error: groupErr.message });
            }
            if (group._scrapeError && !failedGroups.find(g => g.title === group.title)) {
                failedGroups.push({ title: group.title, error: group._scrapeError });
            }

            // Rate limit: TV groups need more time, movies are fast
            if (i < groups.length - 1) {
                const delay = group.mediaType === 'tv' ? 300 : 50;
                await new Promise(r => setTimeout(r, delay));
            }
        }

        console.log('[Import] 循环结束: 导入=' + totalImported + ' 刮削=' + totalScraped + ' 失败=' + failedGroups.length);
        if (failedGroups.length > 0) failedGroups.forEach(g => console.warn('[Import] 失败组: ' + g.title + ' - ' + g.error));
        console.log('[Import] 批量写元数据 ' + pendingMeta.length + ' 条...');

        if (pendingMeta.length > 0) {
            try {
                await DB.batchMerge(pendingMeta);
                console.log('[导入] 元数据写入完成');
            } catch (e) {
                console.error('[导入] 写元数据失败: ' + e.message);
            }
        }

        console.log('[导入] 保存影片列表 ' + existing.length + ' 部...');
        await saveImportedMovies(existing);
        movies = existing;
        console.log('[导入] 刷新首页...');
        rebuildSeries();
        initGenres();
        renderHome();
        renderFavorites();
        renderHistory();
        renderScrapePanel();
        console.log('[导入] 完成');

        const finalBar = document.getElementById('smartScrapeBar');
        const finalInfo = document.getElementById('smartScrapeInfo');
        const finalDetail = document.getElementById('smartScrapeDetail');
        if (finalBar) finalBar.style.width = '100%';
        if (finalInfo) finalInfo.textContent = '完成!';
        let msg = '导入 ' + totalImported + ' 部，刮削成功 ' + totalScraped + ' 部';
        if (failedGroups.length > 0) {
            msg += '，' + failedGroups.length + ' 个文件夹未匹配: ' + failedGroups.map(g => g.title).join('、');
        }
        if (finalDetail) finalDetail.textContent = msg;
        showImportStatus(msg, totalScraped > 0 ? 'success' : 'error');

        isImporting = false;
        smartImportState = null;

        setTimeout(() => {
            progEl.style.display = 'none';
            document.getElementById('importTreeSection').style.display = '';
        }, 3000);
    }

    function cancelSmartImport() {
        smartImportState = null;
        const progEl = document.getElementById('smartImportProgress');
        if (progEl) progEl.style.display = 'none';
        document.getElementById('importTreeSection').style.display = '';
    }

    // ===== Legacy File Import =====

    async function addToLibrary() {
        if (!shareData || isImporting) return;

        isImporting = true;
        renderFileTreeUI(); // Update toolbar to show loading

        showImportStatus('正在收集选中的视频文件...', 'success');

        try {
            // Collect files from selection
            const files = await ShareParser.collectSelectedFiles(
                shareData.children, checkedSet, shareData.linkID, shareData.passwd
            );

            if (files.length === 0) {
                showImportStatus('未选择任何视频文件，请在文件树中勾选要导入的内容', 'error');
                isImporting = false;
                renderFileTreeUI();
                return;
            }

            // Add to library
            const existing = await getImportedMovies();
            const existingIds = new Set(existing.map(m => m.id));
            let addedCount = 0;
            const newMovies = [];

            for (const file of files) {
                const id = 'import-' + btoa(encodeURIComponent(file.name + (file.folderPath || '')))
                    .replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
                if (existingIds.has(id)) continue;

                const title = Scraper.getTitleFromFile(file) || file.name.replace(/\.[^.]+$/, '');

                const movie = {
                    id, title,
                    name: file.name || title,
                    poster: file.thumbUrl || '',
                    desc: '', genre: '导入',
                    year: new Date().getFullYear(),
                    rating: null, duration: null,
                    videoUrl: file.downloadUrl || file.fileId,
                    fileSize: file.size,
                    fileSizeText: file.sizeText,
                    folderPath: file.folderPath || '',
                    source: '139share',
                    importedAt: Date.now(),
                };

                existing.push(movie);
                existingIds.add(id);
                newMovies.push(movie);
                addedCount++;
            }

            if (addedCount === 0) {
                showImportStatus('所选文件已全部存在于影院中', 'error');
                isImporting = false;
                renderFileTreeUI();
                return;
            }

            await saveImportedMovies(existing);
            movies = existing;
            rebuildSeries();
            initGenres();
            renderHome();

            showImportStatus(`成功添加 ${addedCount} 部影片到影院，正在刮削元数据...`, 'success');
            isImporting = false;
            renderFileTreeUI();

            // Scrape in background (queue if already scraping)
            if (!isScraping) {
                scrapeInBackground(newMovies);
            } else {
                scrapeQueue.push(...newMovies);
                showImportStatus(`已添加影片，${newMovies.length} 部排队等待刮削...`, 'success');
            }

        } catch (e) {
            showImportStatus('导入失败：' + e.message, 'error');
            isImporting = false;
            renderFileTreeUI();
        }
    }

    // ===== Background Scraping =====

    async function scrapeInBackground(newMovies) {
        isScraping = true;

        // Show progress UI
        let progressEl = document.getElementById('scrapeProgress');
        if (!progressEl) {
            progressEl = document.createElement('div');
            progressEl.id = 'scrapeProgress';
            progressEl.className = 'scrape-progress';
            progressEl.innerHTML = `
                <div class="scrape-progress-track">
                    <div class="scrape-progress-bar" style="width:0%"></div>
                </div>
                <span class="scrape-progress-text">正在刮削元数据...</span>`;
            document.querySelector('.main-content').prepend(progressEl);
        }
        progressEl.style.display = 'flex';

        let foundCount = 0;

        for (let i = 0; i < newMovies.length; i++) {
            const movie = newMovies[i];
            try {
                const meta = await Scraper.scrapeFile(movie);
                if (meta) {
                    foundCount++;
                    const record = {
                        ...meta,
                        id: 'meta-' + movie.id,
                        movieId: movie.id,
                        updatedAt: Date.now(),
                    };
                    await DB.put(record);
                    metadataMap[movie.id] = record;
                }
            } catch (e) {
                console.warn(`Scrape failed for "${movie.title}":`, e.message);
            }

            // Update progress
            const percent = Math.round((i + 1) / newMovies.length * 100);
            const bar = progressEl.querySelector('.scrape-progress-bar');
            const text = progressEl.querySelector('.scrape-progress-text');
            if (bar) bar.style.width = percent + '%';
            if (text) text.textContent = `正在刮削元数据... ${i + 1}/${newMovies.length} (${percent}%)`;

            // Re-render every 3 items
            if ((i + 1) % 3 === 0 || i === newMovies.length - 1) {
                initGenres();
                renderHome();
                renderFavorites();
                renderHistory();
            }

            // Rate limit
            if (i < newMovies.length - 1) {
                await new Promise(r => setTimeout(r, 250));
            }
        }

        isScraping = false;
        showImportStatus(`刮削完成！获取 ${foundCount}/${newMovies.length} 部影片元数据`, 'success');
        renderScrapePanel();
        renderHistory();
        setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 3000);

        // Process queued movies
        if (scrapeQueue.length > 0) {
            const queued = scrapeQueue.splice(0);
            setTimeout(() => scrapeInBackground(queued), 1000);
        }
    }

    // ===== Data Management =====

    async function clearAllData() {
        if (!requireAdmin()) return;
        if (!confirm('确定要清空所有导入的数据吗？\n这将删除所有已导入的影片和刮削的元数据。')) return;

        try {
            // Clear server metadata
            await DB.clear();
            metadataMap = {};

            // Clear server movie list
            await saveImportedMovies([]);
            movies = [];
            rebuildSeries();

            // Clear history and favorites (client-side)
            Store.clearHistory();
            localStorage.removeItem('cm_favorites');

            // Also clean up legacy localStorage data
            try { localStorage.removeItem('cm_imported_movies'); } catch (e) { /* ignore */ }

            // Re-render
            initGenres();
            renderHome();
            renderFavorites();
            renderHistory();
            renderScrapePanel();

            showImportStatus('已清空所有数据', 'success');
        } catch (e) {
            showImportStatus('清空数据失败：' + e.message, 'error');
        }
    }

    /**
     * Render the scrape management panel
     */
    function renderScrapePanel() {
        const panel = document.getElementById('scrapePanel');
        const body = document.getElementById('scrapePanelBody');
        const countEl = document.getElementById('scrapePanelCount');
        if (!panel || !body) return;

        const failed = getFailedMovies();

        if (countEl) {
            countEl.textContent = failed.length > 0 ? `${failed.length} 部未匹配` : '';
        }

        if (failed.length === 0) {
            if (movies.length > 0) {
                body.innerHTML = `
                    <div class="scrape-panel-empty">
                        <i class="fas fa-check-circle" style="color:var(--success)"></i>
                        <span>所有 ${movies.length} 部影片都已成功刮削元数据</span>
                    </div>`;
            } else {
                body.innerHTML = `
                    <div class="scrape-panel-empty">
                        <i class="fas fa-film"></i>
                        <span>暂无影片，请先导入</span>
                    </div>`;
            }
            return;
        }

        body.innerHTML = failed.slice(0, 30).map(m => `
            <div class="scrape-failed-item">
                <div class="scrape-failed-info">
                    <span class="scrape-failed-title" title="${m.title}">${m.title}${m.name && m.name !== m.title ? ' · ' + m.name : ''}</span>
                    <span class="scrape-failed-path">${m.folderPath || ''}</span>
                </div>
                <div class="scrape-failed-actions">
                    <button class="btn-scrape-action btn-rescrape" onclick="App.rescrapeMovie('${m.id}')" title="自动重试">
                        <i class="fas fa-rotate"></i> 重试
                    </button>
                    <button class="btn-scrape-action btn-search" onclick="App.showSearchDialogFor('${m.id}')" title="手动搜索匹配">
                        <i class="fas fa-magnifying-glass"></i> 搜索
                    </button>
                </div>
            </div>
        `).join('') + (failed.length > 30 ? `<div class="scrape-panel-more">还有 ${failed.length - 30} 部未显示...</div>` : '');
    }

    // ===== Scrape Management =====

    /**
     * Get list of movies that failed to scrape (no metadata, or TV episodes missing episode data)
     */
    function getFailedMovies() {
        return movies.filter(m => {
            if (!hasMetadata(m.id)) return true;
            // TV episodes need episode-level data for the detail page
            const meta = metadataMap[m.id];
            const isTvEpisode = m.folderPath && (
                (meta && meta.mediaType === 'tv') ||
                (/(\d{1,3}\.mp4|第\d+集|E\d+)/i.test(m.name || ''))
            );
            // Re-scrape if TV episode but no episode data was fetched
            if (isTvEpisode && meta && (!meta.episodeNumber || !meta.episodeName)) {
                return true;
            }
            return false;
        });
    }

    /**
     * Re-scrape a single movie by ID
     * @param {string} movieId
     * @param {string} [customTitle] - Optional custom search title
     */
    async function rescrapeMovie(movieId, customTitle) {
        const movie = movies.find(m => m.id === movieId);
        if (!movie) return false;

        const searchTitle = customTitle || movie.title;

        showImportStatus(`正在重新刮削: ${searchTitle}...`, 'success');

        try {
            let meta;
            if (customTitle) {
                meta = await Scraper.scrapeByQuery(customTitle, null);
            } else {
                meta = await Scraper.scrapeFile(movie);
            }

            if (meta) {
                const record = {
                    ...meta,
                    id: 'meta-' + movie.id,
                    movieId: movie.id,
                    updatedAt: Date.now(),
                };
                await DB.put(record);
                metadataMap[movie.id] = record;

                initGenres();
                renderHome();
                renderFavorites();
                renderHistory();
                renderScrapePanel();
                showImportStatus(`刮削成功: ${meta.title} (${meta.year || ''})`, 'success');
                return true;
            } else {
                showImportStatus(`刮削失败: 未找到 "${searchTitle}" 的匹配结果`, 'error');
                return false;
            }
        } catch (e) {
            showImportStatus(`刮削出错: ${e.message}`, 'error');
            return false;
        }
    }

    /**
     * Re-scrape all movies that have no metadata
     */
    async function rescrapeAllFailed() {
        const failed = getFailedMovies();
        if (failed.length === 0) {
            showImportStatus('所有影片都已成功刮削元数据', 'success');
            return;
        }

        if (!confirm(`有 ${failed.length} 部影片未刮削成功，是否重新尝试？`)) return;

        isScraping = true;
        showImportStatus(`正在重新刮削 ${failed.length} 部影片...`, 'success');

        let foundCount = 0;
        for (let i = 0; i < failed.length; i++) {
            const movie = failed[i];
            try {
                const meta = await Scraper.scrapeFile(movie);
                if (meta) {
                    foundCount++;
                    const record = {
                        ...meta,
                        id: 'meta-' + movie.id,
                        movieId: movie.id,
                        updatedAt: Date.now(),
                    };
                    await DB.put(record);
                    metadataMap[movie.id] = record;
                }
            } catch (e) {
                console.warn(`Re-scrape failed for "${movie.title}":`, e.message);
            }

            // Progress update
            showImportStatus(`正在重新刮削... ${i + 1}/${failed.length} (找到 ${foundCount})`, 'success');

            // Re-render every 5 items
            if ((i + 1) % 5 === 0 || i === failed.length - 1) {
                initGenres();
                renderHome();
            }

            if (i < failed.length - 1) {
                await new Promise(r => setTimeout(r, 250));
            }
        }

        isScraping = false;
        const stillFailed = getFailedMovies().length;
        renderScrapePanel();
        showImportStatus(
            `刮削完成！成功 ${foundCount}/${failed.length} 部` +
            (stillFailed > 0 ? `，仍有 ${stillFailed} 部未匹配` : ''),
            foundCount > 0 ? 'success' : 'error'
        );
    }

    /**
     * Show a TMDB search dialog for manual binding
     * @param {string} movieId - The movie to bind
     */
    function showSearchDialog(movieId) {
        const movie = movies.find(m => m.id === movieId);
        if (!movie) return;

        // Remove existing dialog if any
        const existing = document.getElementById('searchDialog');
        if (existing) existing.remove();

        const dialog = document.createElement('div');
        dialog.id = 'searchDialog';
        dialog.className = 'search-dialog-overlay';
        dialog.innerHTML = `
            <div class="search-dialog">
                <div class="search-dialog-header">
                    <h3>搜索匹配: <span class="search-target-title">${escapeHtmlInline(movie.title)}</span></h3>
                    <button class="search-dialog-close" onclick="App.closeSearchDialog()">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>
                <div class="search-dialog-input-row">
                    <div class="search-dialog-input-wrap">
                        <i class="fas fa-search"></i>
                        <input type="text" id="searchDialogInput" 
                               placeholder="输入电影名称搜索 TMDB..."
                               value="${escapeHtmlInline(movie.title)}"
                               onkeydown="if(event.key==='Enter')App.doSearchDialog()">
                    </div>
                    <button class="btn-search-dialog" onclick="App.doSearchDialog()">
                        <i class="fas fa-magnifying-glass"></i> 搜索
                    </button>
                </div>
                <div id="searchDialogResults" class="search-dialog-results">
                    <div class="search-dialog-hint">
                        <i class="fas fa-lightbulb"></i>
                        输入电影名称进行搜索，选择正确的结果完成刮削
                    </div>
                </div>
            </div>`;

        document.body.appendChild(dialog);

        // Auto-focus and search
        setTimeout(() => {
            const input = document.getElementById('searchDialogInput');
            if (input) {
                input.focus();
                input.select();
            }
            // Auto-trigger search
            doSearchDialog();
        }, 100);
    }

    /**
     * Execute search in the dialog
     */
    async function doSearchDialog() {
        const input = document.getElementById('searchDialogInput');
        const resultsContainer = document.getElementById('searchDialogResults');
        if (!input || !resultsContainer) return;

        const query = input.value.trim();
        if (!query) return;

        resultsContainer.innerHTML = `
            <div class="search-dialog-loading">
                <div class="loading-spinner-sm"></div>
                <span>搜索中...</span>
            </div>`;

        try {
            const results = await Scraper.searchSuggestions(query, null);

            if (results.length === 0) {
                resultsContainer.innerHTML = `
                    <div class="search-dialog-empty">
                        <i class="fas fa-search"></i>
                        <p>未找到匹配结果，请尝试其他关键词</p>
                    </div>`;
                return;
            }

            resultsContainer.innerHTML = results.map(r => `
                <div class="search-result-card" onclick="App.bindAndClose('${getCurrentSearchMovieId()}', ${r.tmdbId}, '${r.mediaType}')">
                    <div class="search-result-poster">
                        ${r.poster
                            ? `<img src="${r.poster}" alt="${escapeHtmlInline(r.title)}">`
                            : `<div class="search-result-no-poster"><i class="fas fa-film"></i></div>`
                        }
                    </div>
                    <div class="search-result-info">
                        <div class="search-result-title">${escapeHtmlInline(r.title)}</div>
                        <div class="search-result-original">${r.originalTitle !== r.title ? escapeHtmlInline(r.originalTitle) : ''}</div>
                        <div class="search-result-meta">
                            ${r.year ? `<span><i class="fas fa-calendar"></i> ${r.year}</span>` : ''}
                            <span><i class="fas fa-${r.mediaType === 'tv' ? 'tv' : 'film'}"></i> ${r.mediaType === 'tv' ? '电视剧' : '电影'}</span>
                        </div>
                        <div class="search-result-overview">${escapeHtmlInline(r.overview)}</div>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            resultsContainer.innerHTML = `
                <div class="search-dialog-empty error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>搜索出错: ${escapeHtmlInline(e.message)}</p>
                </div>`;
        }
    }

    // Track current search dialog movie ID
    let _searchDialogMovieId = null;

    function showSearchDialogFor(movieId) {
        _searchDialogMovieId = movieId;
        showSearchDialog(movieId);
    }

    function getCurrentSearchMovieId() {
        return _searchDialogMovieId;
    }

    /**
     * Bind a TMDB result to a movie and close dialog
     */
    async function bindAndClose(movieId, tmdbId, mediaType) {
        const movie = movies.find(m => m.id === movieId);
        if (!movie) return;

        showImportStatus(`正在获取 "${movie.title}" 的元数据...`, 'success');

        try {
            const meta = await Scraper.scrapeByTmdbId(tmdbId, mediaType);
            if (meta) {
                const record = {
                    ...meta,
                    id: 'meta-' + movie.id,
                    movieId: movie.id,
                    updatedAt: Date.now(),
                };
                await DB.put(record);
                metadataMap[movie.id] = record;

                initGenres();
                renderHome();
                renderFavorites();
                renderScrapePanel();
                showImportStatus(`成功匹配: ${meta.title} (${meta.year || ''})`, 'success');
            }
        } catch (e) {
            showImportStatus(`获取元数据失败: ${e.message}`, 'error');
        }

        closeSearchDialog();
    }

    function closeSearchDialog() {
        const dialog = document.getElementById('searchDialog');
        if (dialog) dialog.remove();
        _searchDialogMovieId = null;
    }

    // ===== Keyboard shortcuts =====

    function escapeHtmlInline(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    document.addEventListener('keydown', e => {
        // Only handle Escape when player is NOT open (player has its own handler)
        if (e.key === 'Escape') {
            const playerOpen = document.getElementById('playerModal').classList.contains('open');
            if (!playerOpen) {
                if (document.getElementById('searchDialog')) {
                    closeSearchDialog();
                }
            }
        }
    });

    document.addEventListener('DOMContentLoaded', init);

    return {
        navigate, filterGenre, handleSearch, playMovie,
        closePlayer, closePlayerOutside, toggleFavFromPlayer,
        clearHistory, toggleTheme,
        handleImport, toggleTreeNode, toggleTreeCheck,
        selectAllTree, unselectAllTree, addToLibrary,
        clearAllData,
        // Detail page
        showDetail, closeDetail, playEpisode, switchSeason,
        // Scrape management
        rescrapeMovie, rescrapeAllFailed,
        showSearchDialogFor, doSearchDialog,
        bindAndClose, closeSearchDialog,
        getFailedMovies,
        // Search page API
        onSearchInput, doGlobalSearch, clearSearch,
        toggleSearchFilters, setFilter, toggleSearchGenre, resetSearchFilters,
        // Admin guard
        showImportGuard, hideImportGuard, renderScrapePanel, requireAdmin,
        // Smart import
        smartImport, confirmSmartImport, cancelSmartImport,
    };
})();
