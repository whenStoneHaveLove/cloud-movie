/**
 * Player - 专业级视频播放器
 * 自定义控件：全屏、音量、画质切换、播放速度、进度条、键盘快捷键
 */
const Player = (() => {
    let hlsInstance = null;
    let currentMovie = null;
    let animFrameId = null;
    let hideTimer = null;
    let volumeBeforeMute = 1;
    let qualityLevels = [];

    // Named handler references for cleanup
    let _onWrapperMouseMove = null;
    let _onWrapperMouseLeave = null;
    let _onWrapperClick = null;
    let _onWrapperTouchStart = null;
    let _onKeyDown = null;
    let _onFullscreenChange = null;
    let _onProgressMouseDown = null;
    let _onProgressMouseMove = null;
    let _onProgressMouseUp = null;
    let _onProgressMouseLeave = null;
    let _onProgressTouchStart = null;
    let _onProgressTouchMove = null;
    let _onProgressTouchEnd = null;

    // ===== Lifecycle =====

    function destroy() {
        cancelAnimationFrame(animFrameId);
        clearTimeout(hideTimer);
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
        const video = document.getElementById('videoPlayer');
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('volumechange', onVolumeChange);
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('waiting', onWaiting);
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('error', onError);
        }

        // Clean up wrapper/container/document listeners
        const wrapper = document.querySelector('.player-wrapper');
        if (wrapper) {
            if (_onWrapperMouseMove) wrapper.removeEventListener('mousemove', _onWrapperMouseMove);
            if (_onWrapperMouseLeave) wrapper.removeEventListener('mouseleave', _onWrapperMouseLeave);
            if (_onWrapperClick) wrapper.removeEventListener('click', _onWrapperClick);
            if (_onWrapperTouchStart) wrapper.removeEventListener('touchstart', _onWrapperTouchStart);
        }
        if (_onKeyDown) document.removeEventListener('keydown', _onKeyDown);
        if (_onFullscreenChange) document.removeEventListener('fullscreenchange', _onFullscreenChange);
        if (_onProgressMouseDown) {
            const container = document.getElementById('progressContainer');
            if (container) {
                container.removeEventListener('mousedown', _onProgressMouseDown);
                container.removeEventListener('mouseleave', _onProgressMouseLeave);
                container.removeEventListener('touchstart', _onProgressTouchStart);
                container.removeEventListener('touchmove', _onProgressTouchMove);
                container.removeEventListener('touchend', _onProgressTouchEnd);
            }
            document.removeEventListener('mousemove', _onProgressMouseMove);
            document.removeEventListener('mouseup', _onProgressMouseUp);
        }

        // Reset handler references
        _onWrapperMouseMove = null;
        _onWrapperMouseLeave = null;
        _onWrapperClick = null;
        _onWrapperTouchStart = null;
        _onKeyDown = null;
        _onFullscreenChange = null;
        _onProgressMouseDown = null;
        _onProgressMouseMove = null;
        _onProgressMouseUp = null;
        _onProgressMouseLeave = null;
        _onProgressTouchStart = null;
        _onProgressTouchMove = null;
        _onProgressTouchEnd = null;

        qualityLevels = [];
    }

    function play(movie) {
        currentMovie = movie;
        const video = document.getElementById('videoPlayer');
        destroy();

        // Build custom controls if they don't exist
        buildControls();

        // Attach events
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('volumechange', onVolumeChange);
        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('waiting', onWaiting);
        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('ended', onEnded);
        video.addEventListener('error', onError);

        const url = movie.videoUrl;

        if (url.includes('.m3u8')) {
            if (window.Hls && Hls.isSupported()) {
                hlsInstance = new Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                });
                hlsInstance.loadSource(url);
                hlsInstance.attachMedia(video);

                hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                    // Extract quality levels
                    qualityLevels = data.levels.map((level, idx) => ({
                        index: idx,
                        height: level.height,
                        label: level.height ? `${level.height}p` : `Level ${idx}`,
                        bitrate: level.bitrate,
                    }));
                    updateQualityMenu();
                    video.play().catch(() => {});
                });

                hlsInstance.on(Hls.Events.ERROR, (_, data) => {
                    if (data.fatal) {
                        console.error('HLS fatal error:', data);
                        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hlsInstance.startLoad();
                        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hlsInstance.recoverMediaError();
                        else destroy();
                    }
                });

                hlsInstance.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
                    updateQualityLabel(data.level);
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                video.addEventListener('loadedmetadata', () => video.play(), { once: true });
            }
        } else {
            video.src = url;
            video.play().catch(() => {});
        }

        // Set initial volume
        const savedVol = parseFloat(localStorage.getItem('cm_volume') || '0.8');
        video.volume = savedVol;
        video.muted = savedVol === 0;

        // Save to history
        Store.addHistory({
            id: movie.id,
            title: movie.title,
            poster: movie.poster,
            year: movie.year,
            genre: movie.genre,
            videoUrl: movie.videoUrl,
        });

        // Show controls briefly then auto-hide
        showControls();
    }

    // ===== Build Controls UI =====

    function buildControls() {
        const wrapper = document.querySelector('.player-wrapper');
        if (!wrapper) return;

        // Remove old controls if exist (rebuilt on every play)
        const oldControls = document.getElementById('playerControls');
        if (oldControls) oldControls.remove();

        const controlsHtml = `
            <div id="playerControls" class="player-controls">
                <!-- Loading spinner -->
                <div id="playerLoading" class="player-loading">
                    <div class="player-spinner"></div>
                </div>

                <!-- Big play button (center) -->
                <div id="playerBigPlay" class="player-big-play" onclick="Player.togglePlay()">
                    <i class="fas fa-play"></i>
                </div>

                <!-- Top gradient bar -->
                <div class="player-top-bar">
                    <button class="player-btn player-btn-back" onclick="App.closePlayer()" title="返回">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                    <span id="playerTopTitle" class="player-top-title"></span>
                </div>

                <!-- Bottom controls -->
                <div class="player-bottom">
                    <!-- Progress bar -->
                    <div class="player-progress-container" id="progressContainer">
                        <div class="player-progress-buffered" id="progressBuffered"></div>
                        <div class="player-progress-played" id="progressPlayed">
                            <div class="player-progress-thumb" id="progressThumb"></div>
                        </div>
                        <div class="player-progress-hover-time" id="hoverTime"></div>
                    </div>

                    <div class="player-controls-row">
                        <!-- Left controls -->
                        <div class="player-controls-left">
                            <button class="player-btn" id="btnPlayPause" onclick="Player.togglePlay()" title="播放/暂停 (Space)">
                                <i class="fas fa-play"></i>
                            </button>

                            <div class="player-volume-group">
                                <button class="player-btn" id="btnMute" onclick="Player.toggleMute()" title="静音 (M)">
                                    <i class="fas fa-volume-high"></i>
                                </button>
                                <div class="player-volume-slider">
                                    <input type="range" id="volumeSlider" min="0" max="1" step="0.05" value="0.8"
                                           oninput="Player.setVolume(this.value)" title="音量">
                                </div>
                            </div>

                            <span class="player-time" id="playerTime">0:00 / 0:00</span>
                        </div>

                        <!-- Right controls -->
                        <div class="player-controls-right">
                            <!-- Quality -->
                            <div class="player-menu-wrapper" id="qualityMenuWrapper">
                                <button class="player-btn" id="btnQuality" onclick="Player.toggleQualityMenu()" title="画质">
                                    <i class="fas fa-gear"></i>
                                    <span class="player-quality-label" id="qualityLabel">Auto</span>
                                </button>
                                <div class="player-menu" id="qualityMenu"></div>
                            </div>

                            <!-- Speed -->
                            <div class="player-menu-wrapper" id="speedMenuWrapper">
                                <button class="player-btn" id="btnSpeed" onclick="Player.toggleSpeedMenu()" title="播放速度">
                                    <span class="player-speed-label" id="speedLabel">1x</span>
                                </button>
                                <div class="player-menu" id="speedMenu">
                                    <div class="player-menu-item" onclick="Player.setSpeed(0.25)">0.25x</div>
                                    <div class="player-menu-item" onclick="Player.setSpeed(0.5)">0.5x</div>
                                    <div class="player-menu-item" onclick="Player.setSpeed(0.75)">0.75x</div>
                                    <div class="player-menu-item active" onclick="Player.setSpeed(1)">1x</div>
                                    <div class="player-menu-item" onclick="Player.setSpeed(1.25)">1.25x</div>
                                    <div class="player-menu-item" onclick="Player.setSpeed(1.5)">1.5x</div>
                                    <div class="player-menu-item" onclick="Player.setSpeed(2)">2x</div>
                                </div>
                            </div>

                            <!-- Next episode (series only) -->
                            <button class="player-btn" id="btnNextEpisode" onclick="Player.playNextEpisode()" title="下一集 (N)">
                                <i class="fas fa-forward-step"></i>
                            </button>

                            <!-- PiP -->
                            <button class="player-btn" onclick="Player.togglePiP()" title="画中画 (P)">
                                <i class="fas fa-compress"></i>
                            </button>

                            <!-- Fullscreen -->
                            <button class="player-btn" id="btnFullscreen" onclick="Player.toggleFullscreen()" title="全屏 (F)">
                                <i class="fas fa-expand"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;

        wrapper.insertAdjacentHTML('beforeend', controlsHtml);

        // Set title
        const titleEl = document.getElementById('playerTopTitle');
        if (titleEl && currentMovie) titleEl.textContent = currentMovie.title;

        // Show/hide next episode button
        const btnNext = document.getElementById('btnNextEpisode');
        if (btnNext) {
            const hasNext = currentMovie && currentMovie._nextEpisodeId;
            btnNext.style.display = hasNext ? 'flex' : 'none';
            if (hasNext && currentMovie._nextEpisodeTitle) {
                btnNext.title = `下一集: ${currentMovie._nextEpisodeTitle} (N)`;
            }
        }

        // Progress bar interaction
        setupProgressInteraction();

        // Mouse move to show controls
        _onWrapperMouseMove = onWrapperMouseMove;
        _onWrapperMouseLeave = () => scheduleHideControls();
        wrapper.addEventListener('mousemove', _onWrapperMouseMove);
        wrapper.addEventListener('mouseleave', _onWrapperMouseLeave);

        // Click/tap handling
        let tapCount = 0;
        let tapTimer = null;
        let lastTapX = 0;

        _onWrapperClick = (e) => {
            // Ignore clicks on controls
            if (e.target.closest('.player-controls')) return;

            const rect = wrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const relX = x / rect.width;

            tapCount++;
            lastTapX = relX;

            if (tapCount === 1) {
                tapTimer = setTimeout(() => {
                    if (tapCount === 1) {
                        // Single tap: toggle play/pause
                        togglePlay();
                    }
                    tapCount = 0;
                }, 280);
            } else if (tapCount === 2) {
                clearTimeout(tapTimer);
                tapCount = 0;
                // Double tap: seek
                const video = document.getElementById('videoPlayer');
                if (!video) return;

                if (lastTapX < 0.35) {
                    // Left side: seek back 10s
                    video.currentTime = Math.max(0, video.currentTime - 10);
                    showSeekFeedback('-10s');
                } else if (lastTapX > 0.65) {
                    // Right side: seek forward 10s
                    video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
                    showSeekFeedback('+10s');
                } else {
                    // Center: toggle fullscreen on mobile
                    const isMobile = window.innerWidth <= 768;
                    if (isMobile) toggleFullscreen();
                }
                showControls();
            }
        };
        wrapper.addEventListener('click', _onWrapperClick);

        // Touch to show controls on mobile
        _onWrapperTouchStart = (e) => {
            if (!e.target.closest('.player-controls')) {
                showControls();
                scheduleHideControls();
            }
        };
        wrapper.addEventListener('touchstart', _onWrapperTouchStart, { passive: true });

        // Keyboard shortcuts
        _onKeyDown = onKeyDown;
        document.addEventListener('keydown', _onKeyDown);

        // Fullscreen change
        _onFullscreenChange = onFullscreenChange;
        document.addEventListener('fullscreenchange', _onFullscreenChange);
    }

    // ===== Progress Bar =====

    function setupProgressInteraction() {
        const container = document.getElementById('progressContainer');
        if (!container) return;

        let isDragging = false;

        function seek(e) {
            const video = document.getElementById('videoPlayer');
            if (!video || !video.duration) return;
            const rect = container.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            video.currentTime = ratio * video.duration;
        }

        // Mouse events
        _onProgressMouseDown = (e) => {
            isDragging = true;
            seek(e);
            e.preventDefault();
        };
        container.addEventListener('mousedown', _onProgressMouseDown);

        _onProgressMouseMove = (e) => {
            if (isDragging) seek(e);
            // Hover time
            const hoverTime = document.getElementById('hoverTime');
            const video = document.getElementById('videoPlayer');
            if (hoverTime && video && video.duration && container.contains(e.target)) {
                const rect = container.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                hoverTime.textContent = formatTime(ratio * video.duration);
                hoverTime.style.left = (ratio * 100) + '%';
                hoverTime.style.opacity = '1';
            }
        };
        document.addEventListener('mousemove', _onProgressMouseMove);

        _onProgressMouseUp = () => { isDragging = false; };
        document.addEventListener('mouseup', _onProgressMouseUp);

        _onProgressMouseLeave = () => {
            const hoverTime = document.getElementById('hoverTime');
            if (hoverTime) hoverTime.style.opacity = '0';
        };
        container.addEventListener('mouseleave', _onProgressMouseLeave);

        // Touch events for mobile
        _onProgressTouchStart = (e) => {
            isDragging = true;
            seek(e);
            e.preventDefault();
        };
        container.addEventListener('touchstart', _onProgressTouchStart, { passive: false });

        _onProgressTouchMove = (e) => {
            if (isDragging) {
                seek(e);
                e.preventDefault();
            }
        };
        container.addEventListener('touchmove', _onProgressTouchMove, { passive: false });

        _onProgressTouchEnd = () => { isDragging = false; };
        container.addEventListener('touchend', _onProgressTouchEnd);
    }

    // ===== Event Handlers =====

    function onTimeUpdate() {
        const video = document.getElementById('videoPlayer');
        if (!video || !video.duration) return;

        const played = document.getElementById('progressPlayed');
        const timeEl = document.getElementById('playerTime');

        const ratio = video.currentTime / video.duration;
        if (played) played.style.width = (ratio * 100) + '%';
        if (timeEl) timeEl.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;

        // Update buffered
        const buffered = document.getElementById('progressBuffered');
        if (buffered && video.buffered.length > 0) {
            const bufEnd = video.buffered.end(video.buffered.length - 1);
            buffered.style.width = (bufEnd / video.duration * 100) + '%';
        }
    }

    function onVolumeChange() {
        const video = document.getElementById('videoPlayer');
        if (!video) return;

        const slider = document.getElementById('volumeSlider');
        const btn = document.getElementById('btnMute');
        if (slider) slider.value = video.muted ? 0 : video.volume;

        let icon = 'fa-volume-high';
        const vol = video.muted ? 0 : video.volume;
        if (vol === 0) icon = 'fa-volume-xmark';
        else if (vol < 0.3) icon = 'fa-volume-off';
        else if (vol < 0.7) icon = 'fa-volume-low';
        if (btn) btn.innerHTML = `<i class="fas ${icon}"></i>`;
    }

    function onPlay() {
        const btn = document.getElementById('btnPlayPause');
        if (btn) btn.innerHTML = '<i class="fas fa-pause"></i>';
        const bigPlay = document.getElementById('playerBigPlay');
        if (bigPlay) bigPlay.style.display = 'none';
    }

    function onPause() {
        const btn = document.getElementById('btnPlayPause');
        if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
        const bigPlay = document.getElementById('playerBigPlay');
        if (bigPlay) bigPlay.style.display = 'flex';
        showControls();
    }

    function onWaiting() {
        const loading = document.getElementById('playerLoading');
        if (loading) loading.style.display = 'flex';
    }

    function onCanPlay() {
        const loading = document.getElementById('playerLoading');
        if (loading) loading.style.display = 'none';
    }

    function onEnded() {
        // Auto-play next episode if available
        if (currentMovie && currentMovie._nextEpisodeId && typeof App !== 'undefined' && App.playMovie) {
            // Brief delay so user sees the end, then auto-play next
            setTimeout(() => {
                if (currentMovie && currentMovie._nextEpisodeId) {
                    App.playMovie(currentMovie._nextEpisodeId);
                }
            }, 1500);
            return;
        }

        // No next episode: show replay overlay
        const bigPlay = document.getElementById('playerBigPlay');
        if (bigPlay) {
            bigPlay.innerHTML = '<i class="fas fa-rotate-right"></i>';
            bigPlay.style.display = 'flex';
        }
    }

    function onError() {
        const loading = document.getElementById('playerLoading');
        if (loading) loading.style.display = 'none';
        console.error('Video playback error');
    }

    function onWrapperMouseMove() {
        showControls();
        scheduleHideControls();
    }

    function onFullscreenChange() {
        const btn = document.getElementById('btnFullscreen');
        if (!btn) return;
        const isFs = !!document.fullscreenElement;
        btn.innerHTML = `<i class="fas ${isFs ? 'fa-compress' : 'fa-expand'}"></i>`;
    }

    // ===== Keyboard Shortcuts =====

    function onKeyDown(e) {
        const modal = document.getElementById('playerModal');
        if (!modal || !modal.classList.contains('open')) return;

        // Don't trigger if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const video = document.getElementById('videoPlayer');
        if (!video) return;

        switch (e.key) {
            case ' ':
            case 'k':
                e.preventDefault();
                togglePlay();
                break;
            case 'f':
            case 'F':
                e.preventDefault();
                toggleFullscreen();
                break;
            case 'm':
            case 'M':
                e.preventDefault();
                toggleMute();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 30 : 10));
                showControls();
                break;
            case 'ArrowRight':
                e.preventDefault();
                video.currentTime = Math.min(video.duration, video.currentTime + (e.shiftKey ? 30 : 10));
                showControls();
                break;
            case 'ArrowUp':
                e.preventDefault();
                setVolume(Math.min(1, video.volume + 0.1));
                break;
            case 'ArrowDown':
                e.preventDefault();
                setVolume(Math.max(0, video.volume - 0.1));
                break;
            case 'j':
                e.preventDefault();
                video.currentTime = Math.max(0, video.currentTime - 10);
                break;
            case 'l':
                e.preventDefault();
                video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
                break;
            case '0': case 'Home':
                e.preventDefault();
                video.currentTime = 0;
                break;
            case 'n':
            case 'N':
                e.preventDefault();
                playNextEpisode();
                break;
            case 'Escape':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    App.closePlayer();
                }
                e.preventDefault();
                break;
            case 'p':
            case 'P':
                e.preventDefault();
                togglePiP();
                break;
        }

        showControls();
        scheduleHideControls();
    }

    // ===== Public Controls =====

    function togglePlay() {
        const video = document.getElementById('videoPlayer');
        if (!video) return;
        if (video.paused || video.ended) {
            video.play().catch(() => {});
        } else {
            video.pause();
        }
    }

    function setVolume(val) {
        const video = document.getElementById('videoPlayer');
        if (!video) return;
        const v = Math.max(0, Math.min(1, parseFloat(val)));
        video.volume = v;
        video.muted = v === 0;
        localStorage.setItem('cm_volume', v.toString());
        const slider = document.getElementById('volumeSlider');
        if (slider) slider.value = v;
        onVolumeChange();
    }

    function toggleMute() {
        const video = document.getElementById('videoPlayer');
        if (!video) return;
        if (video.muted || video.volume === 0) {
            video.muted = false;
            video.volume = volumeBeforeMute || 0.5;
        } else {
            volumeBeforeMute = video.volume;
            video.muted = true;
        }
        localStorage.setItem('cm_volume', video.muted ? '0' : video.volume.toString());
        onVolumeChange();
    }

    function setSpeed(speed) {
        const video = document.getElementById('videoPlayer');
        if (!video) return;
        video.playbackRate = speed;
        const label = document.getElementById('speedLabel');
        if (label) label.textContent = speed + 'x';

        // Update active state
        document.querySelectorAll('#speedMenu .player-menu-item').forEach(item => {
            item.classList.toggle('active', item.textContent.trim() === speed + 'x');
        });

        // Close menu
        const menu = document.getElementById('speedMenu');
        if (menu) menu.classList.remove('open');
    }

    function toggleSpeedMenu() {
        const menu = document.getElementById('speedMenu');
        if (menu) menu.classList.toggle('open');
        // Close quality menu
        const qMenu = document.getElementById('qualityMenu');
        if (qMenu) qMenu.classList.remove('open');
    }

    function toggleQualityMenu() {
        const menu = document.getElementById('qualityMenu');
        if (menu) menu.classList.toggle('open');
        // Close speed menu
        const sMenu = document.getElementById('speedMenu');
        if (sMenu) sMenu.classList.remove('open');
    }

    function updateQualityMenu() {
        const menu = document.getElementById('qualityMenu');
        if (!menu || qualityLevels.length === 0) return;

        let html = '<div class="player-menu-item active" onclick="Player.setQuality(-1)">自动</div>';
        for (const level of qualityLevels) {
            html += `<div class="player-menu-item" onclick="Player.setQuality(${level.index})">${level.label}</div>`;
        }
        menu.innerHTML = html;
    }

    function setQuality(index) {
        if (!hlsInstance) return;
        hlsInstance.currentLevel = index; // -1 = auto

        const label = document.getElementById('qualityLabel');
        if (index === -1) {
            if (label) label.textContent = 'Auto';
        } else {
            const level = qualityLevels.find(l => l.index === index);
            if (label) label.textContent = level ? level.label : 'Auto';
        }

        // Update active state
        document.querySelectorAll('#qualityMenu .player-menu-item').forEach((item, i) => {
            item.classList.toggle('active', i === (index + 1));
        });

        const menu = document.getElementById('qualityMenu');
        if (menu) menu.classList.remove('open');
    }

    function updateQualityLabel(levelIndex) {
        const label = document.getElementById('qualityLabel');
        if (!label || !hlsInstance || hlsInstance.currentLevel !== -1) return;
        // In auto mode, show current actual level
        const level = qualityLevels.find(l => l.index === levelIndex);
        if (level && label) label.textContent = level.label;
    }

    function toggleFullscreen() {
        const modal = document.getElementById('playerModal');
        if (!modal) return;

        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            modal.requestFullscreen().catch(() => {});
        }
    }

    async function togglePiP() {
        const video = document.getElementById('videoPlayer');
        if (!video) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await video.requestPictureInPicture();
            }
        } catch (e) {
            console.warn('PiP not supported:', e);
        }
    }

    // ===== UI Helpers =====

    function showSeekFeedback(text) {
        const wrapper = document.querySelector('.player-wrapper');
        if (!wrapper) return;
        const fb = document.createElement('div');
        fb.className = 'player-seek-feedback';
        fb.textContent = text;
        wrapper.appendChild(fb);
        requestAnimationFrame(() => fb.classList.add('show'));
        setTimeout(() => {
            fb.classList.remove('show');
            setTimeout(() => fb.remove(), 300);
        }, 600);
    }

    function showControls() {
        const controls = document.getElementById('playerControls');
        if (controls) {
            controls.classList.add('visible');
            controls.classList.remove('hidden');
        }
    }

    function scheduleHideControls() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            const video = document.getElementById('videoPlayer');
            if (video && !video.paused) {
                const controls = document.getElementById('playerControls');
                if (controls) {
                    controls.classList.remove('visible');
                    controls.classList.add('hidden');
                }
            }
        }, 3000);
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function getCurrentMovie() {
        return currentMovie;
    }

    /** Play next episode (series mode) */
    function playNextEpisode() {
        if (currentMovie && currentMovie._nextEpisodeId && typeof App !== 'undefined' && App.playMovie) {
            App.playMovie(currentMovie._nextEpisodeId);
        }
    }

    return {
        play, destroy, getCurrentMovie,
        togglePlay, setVolume, toggleMute,
        setSpeed, toggleSpeedMenu,
        setQuality, toggleQualityMenu,
        toggleFullscreen, togglePiP,
        playNextEpisode,
    };
})();
