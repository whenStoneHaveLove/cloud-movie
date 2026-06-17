const Store = (() => {
    const KEYS = {
        favorites: 'cm_favorites',
        history: 'cm_history',
        theme: 'cm_theme',
    };

    function get(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; }
        catch { return []; }
    }

    function set(key, val) {
        localStorage.setItem(key, JSON.stringify(val));
    }

    return {
        // ===== Favorites =====
        getFavorites() {
            return get(KEYS.favorites);
        },

        isFavorite(id) {
            return get(KEYS.favorites).includes(id);
        },

        toggleFavorite(id) {
            const favs = get(KEYS.favorites);
            const idx = favs.indexOf(id);
            if (idx > -1) favs.splice(idx, 1);
            else favs.push(id);
            set(KEYS.favorites, favs);
            return idx === -1;
        },

        // ===== History =====
        getHistory() {
            return get(KEYS.history);
        },

        addHistory(movie) {
            let hist = get(KEYS.history);
            hist = hist.filter(h => h.id !== movie.id);
            hist.unshift({ ...movie, watchedAt: Date.now() });
            if (hist.length > 50) hist = hist.slice(0, 50);
            set(KEYS.history, hist);
        },

        clearHistory() {
            set(KEYS.history, []);
        },

        // ===== Theme =====
        getTheme() {
            return localStorage.getItem(KEYS.theme) || 'dark';
        },

        setTheme(theme) {
            localStorage.setItem(KEYS.theme, theme);
        },
    };
})();
