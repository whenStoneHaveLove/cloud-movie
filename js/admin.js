/**
 * Admin - 管理员模块
 * 访客统计、在线人数、影片导入维护（仅管理员可用）
 */
const Admin = (() => {
    const STORAGE_KEY = 'cm_admin_token';

    // ===== Auth =====

    function getToken() {
        return localStorage.getItem(STORAGE_KEY) || '';
    }

    function setToken(token) {
        localStorage.setItem(STORAGE_KEY, token);
    }

    function clearToken() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function isLoggedIn() {
        return !!getToken();
    }

    async function login(password) {
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                setToken(data.token);
                return { success: true };
            }
            return { success: false, error: data.error || '登录失败' };
        } catch (e) {
            return { success: false, error: '服务器连接失败' };
        }
    }

    async function logout() {
        try {
            const token = getToken();
            if (token) {
                await fetch('/api/admin/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                });
            }
        } catch (e) { /* ignore */ }
        clearToken();
    }

    async function verifyToken() {
        const token = getToken();
        if (!token) return false;
        try {
            const res = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                clearToken();
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // ===== Data =====

    async function getStats() {
        const token = getToken();
        if (!token) throw new Error('未登录');
        const res = await fetch(`/api/admin/stats`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('获取统计数据失败');
        return await res.json();
    }

    async function getVisitors() {
        const token = getToken();
        if (!token) throw new Error('未登录');
        const res = await fetch(`/api/admin/visitors`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('获取访客列表失败');
        return await res.json();
    }

    // ===== UI: Login Modal =====

    function ensureLoginModal() {
        if (document.getElementById('adminLoginModal')) return;

        const html = `
        <div id="adminLoginModal" class="admin-login-overlay" onclick="if(event.target===this)Admin.hideLogin()">
            <div class="admin-login-dialog">
                <div class="admin-login-header">
                    <h3><i class="fas fa-shield-halved"></i> 管理员登录</h3>
                    <button class="admin-login-close" onclick="Admin.hideLogin()">
                        <i class="fas fa-xmark"></i>
                    </button>
                </div>
                <div class="admin-login-body">
                    <div class="admin-login-input-wrap">
                        <i class="fas fa-lock"></i>
                        <input type="password" id="adminPasswordInput"
                               placeholder="请输入管理员密码"
                               onkeydown="if(event.key==='Enter')Admin.doLogin()">
                    </div>
                    <div id="adminLoginError" class="admin-login-error" style="display:none"></div>
                    <button class="admin-login-btn" onclick="Admin.doLogin()">
                        <i class="fas fa-right-to-bracket"></i> 确认登录
                    </button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    function showLogin() {
        ensureLoginModal();
        const modal = document.getElementById('adminLoginModal');
        modal.style.display = 'flex';
        setTimeout(() => {
            document.getElementById('adminPasswordInput')?.focus();
        }, 100);
    }

    function hideLogin() {
        const modal = document.getElementById('adminLoginModal');
        if (modal) modal.style.display = 'none';
        const input = document.getElementById('adminPasswordInput');
        if (input) input.value = '';
        const err = document.getElementById('adminLoginError');
        if (err) err.style.display = 'none';
    }

    async function doLogin() {
        const input = document.getElementById('adminPasswordInput');
        const errEl = document.getElementById('adminLoginError');
        if (!input) return;

        const password = input.value.trim();
        if (!password) {
            errEl.textContent = '请输入密码';
            errEl.style.display = 'block';
            return;
        }

        const result = await login(password);
        if (result.success) {
            hideLogin();
            updateUI();
            onLoginSuccess();
        } else {
            errEl.textContent = result.error;
            errEl.style.display = 'block';
            input.value = '';
            input.focus();
        }
    }

    async function doLogout() {
        await logout();
        updateUI();
    }

    // ===== UI: Panel =====

    function ensurePanel() {
        if (document.getElementById('adminPanelPage')) return;

        // Admin panel acts as a page
        const main = document.querySelector('.main-content');
        if (!main) return;

        const html = `
        <section id="page-admin" class="page">
            <div class="admin-panel">
                <div class="admin-panel-header">
                    <h2><i class="fas fa-shield-halved"></i> 管理面板</h2>
                    <button class="btn-logout" onclick="Admin.doLogout()">
                        <i class="fas fa-right-from-bracket"></i> 退出登录
                    </button>
                </div>

                <!-- Stats Cards -->
                <div class="admin-stats-grid" id="adminStatsGrid">
                    <div class="admin-stat-card">
                        <div class="admin-stat-icon"><i class="fas fa-users"></i></div>
                        <div class="admin-stat-value" id="statTotalVisitors">-</div>
                        <div class="admin-stat-label">总访客数</div>
                    </div>
                    <div class="admin-stat-card highlight-green">
                        <div class="admin-stat-icon"><i class="fas fa-circle"></i></div>
                        <div class="admin-stat-value" id="statOnline">-</div>
                        <div class="admin-stat-label">当前在线</div>
                    </div>
                    <div class="admin-stat-card highlight-blue">
                        <div class="admin-stat-icon"><i class="fas fa-calendar-day"></i></div>
                        <div class="admin-stat-value" id="statToday">-</div>
                        <div class="admin-stat-label">今日访客</div>
                    </div>
                    <div class="admin-stat-card">
                        <div class="admin-stat-icon"><i class="fas fa-eye"></i></div>
                        <div class="admin-stat-value" id="statTotalVisits">-</div>
                        <div class="admin-stat-label">总访问次数</div>
                    </div>
                </div>

                <!-- Data Management -->
                <div class="admin-section">
                    <h3><i class="fas fa-database"></i> 数据管理</h3>
                    <p class="admin-section-desc">导入前备份，出错了可一键恢复</p>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
                        <button class="btn btn-primary" id="btnAdminBackup" onclick="Admin.doBackup()">
                            <i class="fas fa-cloud-arrow-down"></i> 备份当前数据
                        </button>
                        <button class="btn btn-warning" id="btnAdminRestore" onclick="Admin.doRestoreLatest()" disabled>
                            <i class="fas fa-rotate-left"></i> 恢复到最新备份
                        </button>
                    </div>
                    <div id="adminBackupList" class="admin-backup-list">
                        <div class="admin-loading">暂无备份</div>
                    </div>
                </div>

                <!-- Top Pages -->
                <div class="admin-section">
                    <h3><i class="fas fa-chart-bar"></i> 热门页面</h3>
                    <div id="adminTopPages" class="admin-top-pages"></div>
                </div>

                <!-- Visitor List -->
                <div class="admin-section">
                    <h3><i class="fas fa-list-ol"></i> 访客列表</h3>
                    <div class="admin-visitor-list" id="adminVisitorList">
                        <div class="admin-loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>
                    </div>
                </div>
            </div>
        </section>`;
        main.insertAdjacentHTML('beforeend', html);
    }

    async function refreshPanel() {
        if (!isLoggedIn()) return;

        try {
            const [stats, visitors] = await Promise.all([getStats(), getVisitors()]);

            // Update stats
            document.getElementById('statTotalVisitors').textContent = stats.totalVisitors;
            document.getElementById('statOnline').textContent = stats.onlineCount;
            document.getElementById('statToday').textContent = stats.todayVisitors;
            document.getElementById('statTotalVisits').textContent = stats.totalVisits;

            // Top pages
            const pagesEl = document.getElementById('adminTopPages');
            if (pagesEl) {
                if (stats.topPages.length === 0) {
                    pagesEl.innerHTML = '<div class="admin-empty">暂无数据</div>';
                } else {
                    const max = stats.topPages[0].count;
                    pagesEl.innerHTML = stats.topPages.map(p => `
                        <div class="admin-top-page-item">
                            <span class="atp-path">${escapeHtml(pageDisplayName(p.path))}</span>
                            <span class="atp-bar-wrap">
                                <span class="atp-bar" style="width:${Math.max(2, (p.count / max) * 100)}%"></span>
                            </span>
                            <span class="atp-count">${p.count}</span>
                        </div>
                    `).join('');
                }
            }

            // Visitors
            const visitorEl = document.getElementById('adminVisitorList');
            if (visitorEl) {
                if (visitors.length === 0) {
                    visitorEl.innerHTML = '<div class="admin-empty">暂无访客数据</div>';
                } else {
                    visitorEl.innerHTML = visitors.slice(0, 50).map(v => {
                        const onlineDot = v.online ? '<span class="visitor-online" title="在线"></span>' : '';
                        const firstDate = new Date(v.firstVisit);
                        const lastDate = new Date(v.lastVisit);
                        // topPages is [[path, count], ...]
                        const topPagesHtml = v.topPages && v.topPages.length > 0
                            ? v.topPages.map(p => `<span class="visitor-page-tag">${escapeHtml(pageDisplayName(p[0]))} (${p[1]})</span>`).join('')
                            : '';
                        return `
                        <div class="admin-visitor-item">
                            <div class="visitor-status">${onlineDot}</div>
                            <div class="visitor-info">
                                <div class="visitor-id">${v.id.substring(0, 16)}... · ${v.ip}</div>
                                <div class="visitor-meta">
                                    访问 ${v.visitCount} 次 ·
                                    首次 ${fmtDate(firstDate)} ·
                                    最近 ${fmtDate(lastDate)}
                                </div>
                                ${topPagesHtml ? `<div class="visitor-pages">${topPagesHtml}</div>` : ''}
                            </div>
                        </div>`;
                    }).join('');
                }
            }
            // Load backup list
            loadBackups();

        } catch (e) {
            console.error('Admin refresh error:', e.message);
            // Token expired, logout
            if (e.message.includes('401') || e.message.includes('权限')) {
                clearToken();
                updateUI();
            }
        }
    }

    function fmtDate(date) {
        const d = date.getDate().toString().padStart(2, '0');
        const h = date.getHours().toString().padStart(2, '0');
        const m = date.getMinutes().toString().padStart(2, '0');
        return `${date.getMonth() + 1}/${d} ${h}:${m}`;
    }

    function pageDisplayName(path) {
        const map = {
            '/': '首页',
            '#home': '首页',
            '#history': '观看历史',
            '#favorites': '收藏',
            '#import': '导入',
            '#search': '搜索',
            '#detail': '详情',
            '#admin': '管理面板',
        };
        return map[path] || path;
    }

    // ===== UI State =====

    function updateUI() {
        const loggedIn = isLoggedIn();
        const importNav = document.querySelector('.nav-item[data-page="import"]');
        const adminNav = document.querySelector('.nav-item[data-page="admin"]');
        const loginBtn = document.getElementById('adminLoginBtn');
        const importPage = document.getElementById('page-import');

        if (importNav) importNav.style.display = loggedIn ? '' : 'none';
        if (loginBtn) loginBtn.style.display = loggedIn ? 'none' : '';
        if (adminNav) adminNav.style.display = loggedIn ? '' : 'none';

        // If import page is active but not logged in, redirect to home
        if (!loggedIn && importPage && importPage.classList.contains('active')) {
            if (typeof App !== 'undefined') App.navigate('home');
        }
    }

    function onLoginSuccess() {
        // Refresh panel data if visible
        refreshPanel();
        // Restore import UI if visible
        if (typeof App !== 'undefined') {
            if (typeof App.hideImportGuard === 'function') App.hideImportGuard();
            if (typeof App.renderScrapePanel === 'function') App.renderScrapePanel();
        }
    }

    function navigateToPanel() {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-admin').classList.add('active');
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector('.nav-item[data-page="admin"]');
        if (navItem) navItem.classList.add('active');
        refreshPanel();
    }

    function guardImport() {
        if (!isLoggedIn()) {
            showLogin();
            return false;
        }
        return true;
    }

    function init() {
        ensurePanel();

        // Add admin login button to sidebar footer
        const footer = document.querySelector('.sidebar-footer');
        if (footer && !document.getElementById('adminLoginBtn')) {
            const btn = document.createElement('button');
            btn.id = 'adminLoginBtn';
            btn.className = 'admin-login-nav-btn';
            btn.title = '管理员登录';
            btn.innerHTML = '<i class="fas fa-shield-halved"></i>';
            btn.onclick = showLogin;
            footer.appendChild(btn);
        }

        // Verify token on load
        if (isLoggedIn()) {
            verifyToken().then(valid => {
                if (!valid) clearToken();
                updateUI();
            });
        } else {
            updateUI();
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ===== Backup / Restore =====

    async function loadBackups() {
        try {
            const res = await fetch('/api/admin/backups', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            const data = await res.json();
            const listEl = document.getElementById('adminBackupList');
            const restoreBtn = document.getElementById('btnAdminRestore');
            if (!listEl) return;

            if (!data.backups || data.backups.length === 0) {
                listEl.innerHTML = '<div class="admin-empty">暂无备份，请先点击"备份当前数据"</div>';
                if (restoreBtn) restoreBtn.disabled = true;
                return;
            }

            listEl.innerHTML = data.backups.slice(0, 20).map(b => `
                <div class="backup-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-card);border-radius:8px;margin-bottom:4px">
                    <div>
                        <span style="color:var(--text-primary);font-weight:500">🕐 ${b.label}</span>
                        <span style="color:var(--text-secondary);margin-left:12px;font-size:13px">
                            🎬 ${b.movieCount} 影片 · 📋 ${b.metaCount} 元数据
                        </span>
                    </div>
                    <button class="btn btn-sm" onclick="Admin.doRestore('${b.timestamp}')" style="padding:4px 12px;font-size:12px">
                        <i class="fas fa-rotate-left"></i> 恢复
                    </button>
                </div>
            `).join('');

            if (restoreBtn && data.backups.length > 0) restoreBtn.disabled = false;
        } catch (e) {
            console.error('加载备份列表失败:', e);
        }
    }

    async function doBackup() {
        const btn = document.getElementById('btnAdminBackup');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 备份中...'; }
        try {
            const res = await fetch('/api/admin/backup', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            const data = await res.json();
            if (data.ok) {
                alert(`✅ 备份成功！\n${data.movies} 部影片 + ${data.metadata} 条元数据`);
                refreshPanel();
                loadBackups();
            } else {
                alert('❌ 备份失败: ' + (data.error || '未知错误'));
            }
        } catch (e) {
            alert('❌ 备份失败: ' + e.message);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-cloud-arrow-down"></i> 备份当前数据'; }
        }
    }

    async function doRestoreLatest() {
        const listEl = document.getElementById('adminBackupList');
        const firstBtn = listEl && listEl.querySelector('button');
        if (firstBtn) {
            firstBtn.click();
            return;
        }
        alert('没有可用的备份');
    }

    async function doRestore(timestamp) {
        if (!confirm(`⚠️ 确定要恢复到备份 ${timestamp} 吗？\n当前数据将被覆盖，此操作不可撤销！`)) return;
        try {
            const res = await fetch('/api/admin/restore', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify({ timestamp })
            });
            const data = await res.json();
            if (data.ok) {
                alert(`✅ 恢复成功！\n${data.movies} 部影片 + ${data.metadata} 条元数据`);
                // Refresh main app
                if (typeof App !== 'undefined' && typeof App.init === 'function') {
                    await App.init();
                }
                refreshPanel();
                loadBackups();
            } else {
                alert('❌ 恢复失败: ' + (data.error || '未知错误'));
            }
        } catch (e) {
            alert('❌ 恢复失败: ' + e.message);
        }
    }

    // Init on DOM ready
    document.addEventListener('DOMContentLoaded', init);

    return {
        isLoggedIn,
        login,
        logout: doLogout,
        showLogin,
        hideLogin,
        doLogin,
        navigateToPanel,
        refreshPanel,
        guardImport,
        updateUI,
        doBackup,
        doRestore,
        doRestoreLatest,
    };
})();
