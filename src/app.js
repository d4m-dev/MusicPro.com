/**
 * MUSIC PRO ULTIMATE CORE SCRIPT
 * Sửa lỗi đồng bộ, tối ưu hóa Virtual Scroll và xử lý luồng bất đồng bộ GitHub Raw.
 */

const TRACKS_URL = 'https://raw.githubusercontent.com/d4m-dev/MusicPro.com/main/src/tracks.js';

const normalizeTracks = (items = []) => items.map((item) => ({
    id: item.id,
    name: item.title || item.name || '',
    artist: item.artist || '',
    artwork: item.cover || item.artwork || '',
    path: item.audioSrc || item.path || '',
    instrumental: item.instrumentalSrc || item.instrumental || '',
    vid: item.videoSrc || item.vid || '',
    lyric: item.lyricSrc || item.lyric || ''
}));

const loadRemoteTracks = async () => {
    if (Array.isArray(window.TRACKS) && window.TRACKS.length) return window.TRACKS;
    try {
        // Tải từ Remote thông qua githubusercontent raw data
        const res = await fetch(TRACKS_URL + '?v=' + Date.now(), { cache: 'no-cache' });
        if (res.ok) {
            const text = await res.text();
            const sandbox = {};
            const getter = new Function('window', `${text}; return window.TRACKS || [];`);
            return getter(sandbox) || [];
        }
    } catch (e) { 
        console.log('Lấy dữ liệu từ xa không thành công, thử cục bộ...'); 
    }

    try {
        // Dự phòng tải từ local file
        const res = await fetch('src/tracks.js');
        if (res.ok) {
            const text = await res.text();
            const sandbox = {};
            const getter = new Function('window', `${text}; return window.TRACKS || [];`);
            return getter(sandbox) || [];
        }
    } catch (e) { 
        console.error('Lỗi khi lấy dữ liệu track cục bộ:', e); 
    }
    return [];
};

class MusicPro {
    constructor() {
        const savedVol = localStorage.getItem('volume');
        this.state = {
            playlist: [], currentIndex: 0, isPlaying: false, isShuffle: false, repeatMode: 0,
            currentMode: 'audio', volume: savedVol !== null ? parseFloat(savedVol) : 0.8, isMuted: false, 
            theme: this.getInitialTheme(),
            favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
            history: JSON.parse(localStorage.getItem('history') || '[]'),
            currentFilter: 'all', searchQuery: '', sortBy: 'id', currentNav: 0, isBeatMode: false,
            currentUserPlaylistIndex: -1,
            isPreloading: false, nextTrackData: null,
            sleepTimer: null, sleepTimeLeft: parseInt(localStorage.getItem('sleepTimeLeft') || '0'), sleepInterval: null, downloadTargetIndex: 0,
            customPrimaryColor: localStorage.getItem('customPrimaryColor') || null,
            fontFamily: localStorage.getItem('fontFamily') || 'Urbanist',
            fontWeight: localStorage.getItem('fontWeight') || '400',
            layoutMode: localStorage.getItem('layoutMode') || 'standard',
            autoThemeByCover: localStorage.getItem('autoThemeByCover') === 'true',
            userPlaylists: JSON.parse(localStorage.getItem('userPlaylists') || '[]'),
            isProUnlocked: localStorage.getItem('isProUnlocked') === 'true',
            smartSleepEnabled: localStorage.getItem('smartSleepEnabled') === 'true',
            smartSleepFadeOutTime: parseInt(localStorage.getItem('smartSleepFadeOutTime')) || 30 
        };
        this.playlistSlideshows = [];
        this.state.spatialAudioEnabled = false;
        this.state.equalizerEnabled = false;

        this.audioContext = null;
        this.sourceNodes = { audio: null, video: null, beat: null };
        this.effectNodes = { gain: null, panner: null }; 
        this.isQueueVisible = false; 

        // Cấu hình Virtual Scroll siêu mượt
        this.virtual = { displayList: [], rowHeight: 75, itemsPerRow: 1, buffer: 4, isTicking: false, lastStartRow: -1, lastEndRow: -1 };
        this.lyricsPiPWindow = null;
        this.isLyricsCanvasActive = false;
        this.lyricsCanvas = null;
        this.lyricsPipVideo = null;
        this.croppedImageDataUrl = null;

        this.isBackgroundFallback = false;
        this.currentSongHasVideo = false;
        
        this.beatAudio = new Audio();
        this.beatAudio.preload = "auto";
        this.beatAudio.setAttribute('playsinline', '');
        this.beatAudio.setAttribute('webkit-playsinline', '');

        this.audio = new Audio();
        this.audio.preload = "metadata"; 
        this.audio.setAttribute('playsinline', '');
        this.audio.setAttribute('webkit-playsinline', '');

        this.preloadAudioAgent = new Audio();
        this.preloadAudioAgent.setAttribute('playsinline', '');
        this.preloadAudioAgent.setAttribute('webkit-playsinline', '');

        this.preloadVideoAgent = document.createElement('video');
        this.preloadVideoAgent.preload = "auto";
        this.preloadVideoAgent.muted = true;
        this.preloadVideoAgent.setAttribute('playsinline', '');
        this.preloadVideoAgent.setAttribute('webkit-playsinline', '');

        this.video = document.getElementById('video-element');
        this.lyricsData = [];
        this.elements = {
            loader: document.getElementById('loader'), list: document.getElementById('track-list'), scrollContainer: document.getElementById('main-scroll'),
            overlay: document.getElementById('player-overlay'), mini: document.getElementById('mini-player'),
            toast: document.getElementById('toast'), toastMsg: document.getElementById('toast-msg'),
            playBtnMain: document.getElementById('btn-main-play'), playBtnMini: document.getElementById('btn-mini-play'),
            seekBar: document.getElementById('seek-bar'), miniFill: document.getElementById('mini-fill'),
            ambient: document.getElementById('ambient-light'), videoMsg: document.getElementById('video-msg'),
            searchInput: document.getElementById('search-input'), clearSearchBtn: document.getElementById('btn-clear-search'),
            btnOptions: document.getElementById('btn-options'), optionsMenu: document.getElementById('options-menu'),
            btnSwitchBeat: document.getElementById('btn-switch-beat'),
            btnOpenTimer: document.getElementById('btn-open-timer'),
            timerModal: document.getElementById('timer-modal'), btnCloseTimer: document.getElementById('btn-close-timer'),
            timerMenuText: document.getElementById('timer-menu-text'),
            dlModal: document.getElementById('download-modal'),
            btnCloseDl: document.getElementById('btn-close-dl'),
            dlTitle: document.getElementById('dl-song-title'),
            lyricsContainer: document.getElementById('lyrics-content')
        };
        
        this.initAudioEffects();
        this.init();
    }

    // FIX LỖI 1: Thêm async để xử lý luồng đồng bộ load dữ liệu từ GitHub
    async init() {
        this.applyTheme();
        
        // Chèn Styles cấu hình hiệu ứng vuốt và giao diện danh sách
        const style = document.createElement('style');
        style.innerHTML = `
            #track-list { transition: opacity 0.2s ease-out, transform 0.2s ease-out; opacity: 1; transform: translateY(0); }
            .modal-content { scrollbar-width: none; -ms-overflow-style: none; }
            .modal-content::-webkit-scrollbar { display: none; }
            @media (max-width: 480px) { .modal-content { padding: 20px !important; width: 95% !important; } }
            .full-player-artwork-container { position: relative; overflow: hidden; width: 100%; height: 100%; border-radius: 20px; }
            #full-artwork { transition: opacity 0.1s linear; z-index: 2; position: relative; width: 100%; height: 100%; object-fit: cover; border-radius: 20px; }
            .swipe-hint-container { position: absolute; bottom: 30px; left: 0; width: 100%; display: flex; justify-content: center; z-index: 3; pointer-events: none; }
            .swipe-hint-content { display: flex; flex-direction: column; align-items: center; padding: 8px 20px; background: rgba(127, 127, 127, 0.1); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 30px; border: 1px solid rgba(255, 255, 255, 0.05); animation: swipeHintCycle 20s infinite; position: relative; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            .swipe-hint-content::before { content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.8) 50%, transparent 100%); animation: shimmer 1.5s infinite; z-index: 1; }
            .swipe-hint-icon { color: white; font-size: 18px; margin-bottom: 2px; text-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.3); }
            .swipe-hint-text { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.3); }
            .context-queue-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-surface); z-index: 1; border-radius: 20px; opacity: 0; display: flex; flex-direction: column; transition: opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
            .queue-header { padding: 15px; font-weight: 700; font-size: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: center; }
            .queue-list { flex: 1; overflow-y: auto; padding: 10px; scrollbar-width: none; }
            .queue-list::-webkit-scrollbar { display: none; }
            .queue-item { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; margin-bottom: 5px; cursor: pointer; }
            .queue-item.active { background: var(--primary); color: white; }
            .queue-item:not(.active):hover { background: rgba(255,255,255,0.1); }
            .queue-item-info { flex: 1; overflow: hidden; }
            .queue-item-title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .queue-item-artist { font-size: 12px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            @keyframes swipeHintCycle { 0%, 30%, 100% { opacity: 0; transform: translateY(30px); } 50%, 80% { opacity: 1; transform: translateY(0); } 55%, 65%, 75% { transform: translateY(-5px); } 60%, 70% { transform: translateY(0); } }
            @keyframes shimmer { 0% { left: -100%; opacity: 0; } 10%, 90% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
        `;
        document.head.appendChild(style);

        const rawTracks = await loadRemoteTracks();
        this.state.playlist = normalizeTracks(rawTracks);
        this.renderPlaylist();
        this.renderContextQueue(); 

        if (this.state.customPrimaryColor) {
            document.documentElement.style.setProperty('--primary', this.state.customPrimaryColor);
            document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${this.state.customPrimaryColor} 0%, ${this.darkenColor(this.state.customPrimaryColor, 30)} 100%)`);
            this.applyColorToUIElements(this.state.customPrimaryColor);
        }

        if (this.state.fontFamily) {
            document.documentElement.style.setProperty('font-family', `${this.state.fontFamily}, sans-serif`);
            document.documentElement.style.setProperty('font-weight', this.state.fontWeight);
            setTimeout(() => {
                if (this.state.fontFamily !== 'Urbanist') this.loadLocalFont(this.state.fontFamily);
                this.applyFontToAllElements(this.state.fontFamily, this.state.fontWeight);
            }, 0);
        }

        if (this.state.layoutMode) document.body.classList.add(`layout-${this.state.layoutMode}`);

        this.setVolume(this.state.volume, this.state.volume === 0);
        const volBar = document.getElementById('vol-bar');
        if (volBar) {
            if (!volBar.hasAttribute('max')) volBar.max = 1;
            if (!volBar.hasAttribute('step')) volBar.step = 0.01;
            this.updateRangeInput(volBar);
        }

        const navContainer = document.querySelector('.bottom-nav');
        if (navContainer && navContainer.children.length === 3) {
             const btn = document.createElement('div');
             btn.className = 'nav-link';
             btn.innerHTML = '<i class="fa-solid fa-gear"></i><span>Cài đặt</span>';
             navContainer.appendChild(btn);
        }

        this.updateTimerText();
        const chips = document.querySelector('.chips-wrapper');
        if (chips) chips.style.display = 'none';

        const sortControls = document.getElementById('sort-controls');
        if (sortControls) sortControls.style.display = 'flex';
        
        if (this.elements.loader) {
            setTimeout(() => { 
                this.elements.loader.style.opacity = '0'; 
                setTimeout(() => this.elements.loader.style.display = 'none', 500); 
            }, 800);
        }

        this.setupEventListeners();
        this.setupMediaSession();
        this.setupPiP();
        this.setupVideoFullscreen();
        this.setupTabSwipeGestures();
        this.updateToggleStates();
        this.updateThemeColor();
        this.initializeHeaderAvatar();
        
        setTimeout(() => { this.updateAllRangeInputs(); }, 100);

        const btnHeart = document.getElementById('btn-heart');
        if (btnHeart && btnHeart.parentNode && !document.getElementById('btn-add-quick')) {
            const btnAdd = document.createElement('button');
            btnAdd.id = 'btn-add-quick';
            btnAdd.className = 'btn-icon';
            btnAdd.innerHTML = '<i class="fa-solid fa-plus"></i>';
            btnAdd.onclick = (e) => {
                e.stopPropagation();
                this.showAddToPlaylistModal(this.state.currentIndex);
            };
            btnHeart.parentNode.insertBefore(btnAdd, btnHeart.nextSibling);
        }

        const btnDl = document.getElementById('btn-dl');
        if (btnDl) btnDl.style.display = 'none';
        
        this.reorderOptionsMenu();
        this.setupSwipeUI();
    }

    initializeHeaderAvatar() {
        const userProfile = {
            name: localStorage.getItem('user_name') || '',
            email: localStorage.getItem('user_email') || '',
            avatar: localStorage.getItem('user_avatar') || 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png'
        };

        const now = Date.now();
        const avatarTimestamp = localStorage.getItem('user_avatar_timestamp');

        if (avatarTimestamp && (now - parseInt(avatarTimestamp)) > 3 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem('user_avatar');
            localStorage.removeItem('user_avatar_timestamp');
            userProfile.avatar = 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png';
        }

        this.updateHeaderAvatar(userProfile.avatar);
        if (this.state.theme === 'auto') this.ensureSystemThemeListener();
    }

    getInitialTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'auto') return 'auto';
        if (!savedTheme) {
            const htmlTheme = document.documentElement.getAttribute('data-theme');
            if (htmlTheme === 'auto') {
                return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            }
            return htmlTheme || 'light';
        }
        return savedTheme;
    }

    applyTheme() {
        let themeToApply = this.state.theme;
        if (this.state.theme === 'auto') {
            themeToApply = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', themeToApply);
        this.updateAllRangeInputs();
    }
    
    toggleTheme() {
        if (this.state.theme === 'auto') this.state.theme = 'dark';
        else if (this.state.theme === 'dark') this.state.theme = 'light';
        else this.state.theme = 'auto';
        
        localStorage.setItem('theme', this.state.theme);
        this.applyTheme();
        this.updateThemeColor();
        this.updateToggleStates();
    }
    
    setAutoTheme() {
        localStorage.setItem('theme', 'auto');
        this.state.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        this.applyTheme();
        this.updateThemeColor();
        this.updateToggleStates();
    }

    ensureSystemThemeListener() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const newTheme = mediaQuery.matches ? 'dark' : 'light';
        if (this.state.theme !== newTheme) {
            this.state.theme = newTheme;
            this.applyTheme();
            this.updateThemeColor();
            this.updateToggleStates();
        }
    }

    updateThemeColor() {
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', this.state.theme === 'dark' ? '#000000' : '#f0f2f5');
        }
        this.updateAllRangeInputs();
    }

    setupSwipeUI() {
        const artwork = document.getElementById('full-artwork');
        if (!artwork || !artwork.parentElement) return;

        let container = artwork.parentElement;
        if (!container.classList.contains('full-player-artwork-container')) {
            container = document.createElement('div');
            container.className = 'full-player-artwork-container';
            artwork.parentNode.insertBefore(container, artwork);
            container.appendChild(artwork);
        }

        const hint = document.createElement('div');
        hint.className = 'swipe-hint-container';
        hint.innerHTML = `
            <div class="swipe-hint-content">
                <div class="swipe-hint-icon"><i class="fa-solid fa-chevron-up"></i></div>
                <div class="swipe-hint-text">Vuốt để xem thêm</div>
            </div>
        `;
        container.appendChild(hint);
        this.elements.swipeHint = hint;

        const queue = document.createElement('div');
        queue.className = 'context-queue-container';
        queue.innerHTML = `
            <div class="queue-header">Danh sách phát</div>
            <div class="queue-list" id="context-queue-list"></div>
        `;
        container.appendChild(queue);
        this.elements.queueContainer = queue;
        this.elements.queueList = document.getElementById('context-queue-list');

        this.setupSwipeGestures(container, artwork, queue, hint);
    }

    setupSwipeGestures(container, artwork, queue, hint) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        container.addEventListener('touchstart', (e) => {
            if (this.isQueueVisible && this.elements.queueList.scrollTop > 0) return;
            startY = e.touches[0].clientY;
            isDragging = true;
            artwork.style.transition = 'none';
            queue.style.transition = 'none';
            hint.style.transition = 'none';
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;
            const height = container.offsetHeight;
            let progress = 0;
            const sensitivity = 0.6;

            if (!this.isQueueVisible) {
                if (deltaY < 0) {
                    progress = Math.min(1, Math.abs(deltaY) / (height * sensitivity)); 
                    artwork.style.opacity = 1 - progress;
                    queue.style.opacity = progress;
                    hint.style.opacity = 1 - progress;
                }
            } else {
                if (deltaY > 0) {
                    progress = Math.min(1, deltaY / (height * sensitivity));
                    artwork.style.opacity = progress;
                    queue.style.opacity = 1 - progress;
                    hint.style.opacity = progress;
                }
            }
        }, { passive: true });

        container.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            artwork.style.transition = 'opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
            queue.style.transition = 'opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
            hint.style.transition = 'opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';

            const deltaY = currentY - startY;
            const threshold = 80;

            if (!this.isQueueVisible) {
                if (deltaY < -threshold) {
                    this.isQueueVisible = true;
                    artwork.style.opacity = 0;
                    queue.style.opacity = 1;
                    hint.style.opacity = 0;
                    artwork.style.pointerEvents = 'none';
                    queue.style.zIndex = 4;
                } else {
                    artwork.style.opacity = 1;
                    queue.style.opacity = 0;
                    hint.style.opacity = 1;
                }
            } else {
                if (deltaY > threshold) {
                    this.isQueueVisible = false;
                    artwork.style.opacity = 1;
                    queue.style.opacity = 0;
                    hint.style.opacity = 1;
                    artwork.style.pointerEvents = 'auto';
                    queue.style.zIndex = 1;
                } else {
                    artwork.style.opacity = 0;
                    queue.style.opacity = 1;
                    hint.style.opacity = 0;
                }
            }
        });
    }
    
    setVolume(volume, isMuted = false) {
        this.state.volume = volume;
        this.state.isMuted = isMuted;
        const finalVolume = isMuted ? 0 : volume;

        this.audio.volume = finalVolume;
        if (this.video) this.video.volume = finalVolume;
        this.beatAudio.volume = finalVolume;

        const volBar = document.getElementById('vol-bar');
        if (volBar) {
            volBar.value = finalVolume;
            this.updateRangeInput(volBar);
        }
        this.updateMuteUI();
        localStorage.setItem('volume', this.state.volume);
    }

    updateRangeInput(element) {
        if (!element) return;
        const min = parseFloat(element.min) || 0;
        const max = parseFloat(element.max) || 100;
        const val = parseFloat(element.value) || 0;
        const percentage = ((val - min) / (max - min)) * 100;
        const color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2962ff';
        
        element.style.backgroundSize = '100% 100%';
        element.style.backgroundImage = `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, var(--range-bg) ${percentage}%, var(--range-bg) 100%)`;
    }

    updateAllRangeInputs() {
        const ranges = document.querySelectorAll('input[type="range"]');
        ranges.forEach(range => this.updateRangeInput(range));

        const miniFill = document.getElementById('mini-fill');
        if (miniFill) {
            miniFill.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2962ff';
        }
    }

    reorderOptionsMenu() {
        const menu = this.elements.optionsMenu;
        if (!menu) return;

        if (this.elements.btnOpenTimer) menu.appendChild(this.elements.btnOpenTimer);
        if (this.elements.btnSwitchBeat) menu.appendChild(this.elements.btnSwitchBeat);
        if (this.elements.pipBtn) menu.appendChild(this.elements.pipBtn);
        
        let dlItem = menu.querySelector('.menu-dl-item');
        if (!dlItem) {
            dlItem = document.createElement('div');
            dlItem.className = 'menu-item menu-dl-item';
            dlItem.innerHTML = '<i class="fa-solid fa-download"></i> <span>Tải xuống</span>';
            dlItem.onclick = () => { this.openDownloadModal(this.state.currentIndex); this.elements.optionsMenu.classList.remove('show'); };
        }
        menu.appendChild(dlItem);
    }

    showPlaylistManager() {
        let modal = document.getElementById('playlist-manager-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'playlist-manager-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; border-radius: 16px; padding: 24px; display: flex; flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Danh sách phát cá nhân</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div id="playlist-list-container" style="flex: 1; overflow-y: auto; margin-bottom: 24px; min-height: 200px;">
                        <div id="playlist-list" style="display: flex; flex-direction: column; gap: 12px;"></div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05); border: none; border-radius:12px; color: var(--text-main); cursor:pointer;">Đóng</button>
                        <button id="btn-create-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600; border:none; cursor:pointer;">Tạo mới</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.classList.add('show');
        this.renderUserPlaylists();

        const closeAndClear = () => {
            modal.classList.remove('show');
            this.clearPlaylistSlideshows();
        };

        modal.querySelectorAll('.btn-close-modal').forEach(btn => btn.onclick = closeAndClear);
        document.getElementById('btn-create-playlist').onclick = () => {
            closeAndClear();
            this.showCreatePlaylistModal();
        };
        modal.onclick = (e) => { if (e.target === modal) closeAndClear(); };
    }

    renderUserPlaylists() {
        const playlistList = document.getElementById('playlist-list');
        if (!playlistList) return;

        this.clearPlaylistSlideshows();

        if (this.state.userPlaylists.length === 0) {
            playlistList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub);">Chưa có danh sách phát nào</div>';
            return;
        }

        playlistList.innerHTML = '';
        this.state.userPlaylists.forEach((playlist, index) => {
            const playlistItem = document.createElement('div');
            playlistItem.className = 'settings-item';
            playlistItem.style.cursor = 'pointer';
            
            let iconHtml = `<div class="settings-icon"><i class="fa-solid fa-list-music"></i></div>`;
            if (playlist.tracks && playlist.tracks.length > 0) {
                iconHtml = `
                    <div class="settings-icon" id="pl-thumb-${index}" style="position: relative; overflow: hidden; padding: 0;">
                        <i class="fa-solid fa-list-music" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1;"></i>
                        <img class="pl-img-a" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 1s ease; z-index: 2;">
                        <img class="pl-img-b" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 1s ease; z-index: 2;">
                    </div>
                `;
            }

            playlistItem.innerHTML = `
                ${iconHtml}
                <div class="settings-info">
                    <div class="settings-name">${playlist.name}</div>
                    <div class="settings-desc">${playlist.tracks.length} bài hát • ${playlist.createdAt ? new Date(playlist.createdAt).toLocaleDateString('vi-VN') : ''}</div>
                </div>
                <div class="settings-action">
                    <span class="status-indicator status-info">${playlist.tracks.length}</span>
                </div>
            `;
            playlistItem.onclick = () => this.showPlaylistDetailModal(playlist, index);
            playlistList.appendChild(playlistItem);
            
            if (playlist.tracks && playlist.tracks.length > 0) {
                this.startPlaylistSlideshow(`pl-thumb-${index}`, playlist.tracks);
            }
        });
    }

    startPlaylistSlideshow(elementId, trackIds) {
        const container = document.getElementById(elementId);
        if (!container) return;

        const imgA = container.querySelector('.pl-img-a');
        const imgB = container.querySelector('.pl-img-b');
        let active = 'a';

        const update = () => {
            if (!document.body.contains(container)) return;
            const randomId = trackIds[Math.floor(Math.random() * trackIds.length)];
            const track = this.state.playlist.find(t => String(t.id) === String(randomId));
            
            if (track && track.artwork) {
                const nextImg = active === 'a' ? imgB : imgA;
                const currImg = active === 'a' ? imgA : imgB;
                const tempImg = new Image();
                tempImg.src = track.artwork;
                tempImg.onload = () => {
                    nextImg.src = track.artwork;
                    nextImg.style.opacity = '1';
                    nextImg.style.zIndex = '3';
                    currImg.style.zIndex = '2';
                    setTimeout(() => { currImg.style.opacity = '0'; }, 1000);
                    active = active === 'a' ? 'b' : 'a';
                };
            }
        };

        update();
        const interval = setInterval(update, 3000);
        this.playlistSlideshows.push(interval);
    }

    showCreatePlaylistModal(trackIndexToAdd = null) {
        let modal = document.getElementById('create-playlist-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'create-playlist-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Tạo danh sách phát</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 24px;">
                        <input type="text" id="playlist-name-input" placeholder="Tên danh sách phát..." style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); margin-bottom: 15px;">
                        <textarea id="playlist-desc-input" placeholder="Mô tả (không bắt buộc)..." style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); height: 80px; resize: none;"></textarea>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05); border: none; border-radius:12px; color: var(--text-main); cursor:pointer;">Hủy</button>
                        <button id="btn-save-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600; border: none; cursor:pointer;">Tạo</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.classList.add('show');

        document.getElementById('btn-save-playlist').onclick = () => {
            const name = document.getElementById('playlist-name-input').value.trim();
            if (!name) { this.showToast('Vui lòng nhập tên danh sách phát'); return; }
            this.createPlaylist(name, document.getElementById('playlist-desc-input').value.trim(), trackIndexToAdd);
            modal.classList.remove('show');
        };

        modal.querySelectorAll('.btn-close-modal').forEach(btn => btn.onclick = () => modal.classList.remove('show'));
        modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
    }

    createPlaylist(name, description = '', trackIndexToAdd = null) {
        const newPlaylist = {
            id: Date.now(), name: name, description: description, tracks: [],
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };

        if (trackIndexToAdd !== null && this.state.playlist[trackIndexToAdd]) {
            newPlaylist.tracks.push(String(this.state.playlist[trackIndexToAdd].id));
        }

        this.state.userPlaylists.push(newPlaylist);
        this.saveUserPlaylists();
        this.showToast(trackIndexToAdd !== null ? `Đã tạo "${name}" và thêm bài hát` : `Đã tạo danh sách phát "${name}"`);

        if (document.getElementById('playlist-manager-modal')?.classList.contains('show')) {
            this.renderUserPlaylists();
        }
    }

    saveUserPlaylists() { localStorage.setItem('userPlaylists', JSON.stringify(this.state.userPlaylists)); }
    showEqualizerModal() { this.showToast('Tính năng EQ đang phát triển...'); }
    initEqualizerValues() {}
    applyEqPreset(preset) {}
    toggleEqualizer() { this.showToast('Tính năng EQ đang phát triển...'); }
    initAudioContext() {}
    getSourceNode(element) { return null; }
    updateAudioGraph() {}
    resetEqualizer() {}
    initializeAudioContext() { this.initAudioContext(); }
    
    resumeAudioContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch((err) => console.error('Lỗi khởi động Audio Context:', err));
        }
    }

    showPlaylistDetailModal(playlist, index) {
        let modal = document.getElementById('playlist-detail-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'playlist-detail-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; border-radius: 16px; padding: 24px; display: flex; flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <button id="btn-play-playlist" style="width: 45px; height: 45px; border-radius: 50%; background: var(--primary); border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);"><i class="fa-solid fa-play"></i></button>
                            <div>
                                <h3 id="pl-detail-name" style="margin: 0; font-size: 20px; font-weight: 700;"></h3>
                                <p id="pl-detail-count" style="color: var(--text-sub); font-size: 14px; margin: 0;"></p>
                            </div>
                        </div>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div id="playlist-tracks-container" style="flex: 1; overflow-y: auto; margin-bottom: 24px;">
                        <div id="playlist-tracks" style="display: flex; flex-direction: column; gap: 10px;"></div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button id="btn-edit-playlist" style="flex: 1; background: rgba(255,255,255,0.1); border:none; border-radius:12px; color: var(--text-main); padding:12px; font-weight:600; cursor:pointer;">Chỉnh sửa</button>
                        <button id="btn-delete-playlist" style="flex: 1; background: #ff4757; border:none; border-radius:12px; color: white; padding: 12px; font-weight: 600; cursor:pointer;">Xóa</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.querySelectorAll('.btn-close-modal').forEach(btn => btn.onclick = () => modal.classList.remove('show'));
            modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
        }

        document.getElementById('pl-detail-name').innerText = playlist.name;
        document.getElementById('pl-detail-count').innerText = `${playlist.tracks.length} bài hát`;
        modal.classList.add('show');
        this.renderPlaylistTracks(playlist, index);

        document.getElementById('btn-play-playlist').onclick = () => {
            this.playUserPlaylist(index);
            modal.classList.remove('show');
            document.getElementById('playlist-manager-modal')?.classList.remove('show');
        };
        document.getElementById('btn-edit-playlist').onclick = () => this.showEditPlaylistModal(index);
        document.getElementById('btn-delete-playlist').onclick = () => {
            if (confirm(`Bạn có chắc muốn xóa danh sách phát "${playlist.name}"?`)) {
                this.deletePlaylist(index);
                modal.classList.remove('show');
                document.getElementById('playlist-manager-modal')?.classList.remove('show');
            }
        };
    }

    showEditPlaylistModal(index) {
        const playlist = this.state.userPlaylists[index];
        if (!playlist) return;

        let modal = document.getElementById('edit-playlist-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'edit-playlist-modal';
            modal.className = 'modal-overlay';
            modal.style.zIndex = '10001';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Chỉnh sửa danh sách</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 24px;">
                        <input type="text" id="edit-playlist-name" style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); margin-bottom: 15px;">
                        <textarea id="edit-playlist-desc" style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); height: 80px; resize: none;"></textarea>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05); border:none; border-radius:12px; color:var(--text-main); cursor:pointer;">Hủy</button>
                        <button id="btn-update-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600; border:none; cursor:pointer;">Lưu</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.querySelectorAll('.btn-close-modal').forEach(btn => btn.onclick = () => modal.classList.remove('show'));
            modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
        }

        document.getElementById('edit-playlist-name').value = playlist.name;
        document.getElementById('edit-playlist-desc').value = playlist.description || '';
        modal.classList.add('show');

        document.getElementById('btn-update-playlist').onclick = () => {
            const name = document.getElementById('edit-playlist-name').value.trim();
            if (!name) { this.showToast('Vui lòng nhập tên danh sách phát'); return; }
            this.updatePlaylist(index, name, document.getElementById('edit-playlist-desc').value.trim());
            modal.classList.remove('show');
        };
    }

    updatePlaylist(index, name, description) {
        const playlist = this.state.userPlaylists[index];
        if (playlist) {
            playlist.name = name;
            playlist.description = description;
            playlist.updatedAt = new Date().toISOString();
            this.saveUserPlaylists();
            this.showToast('Đã cập nhật danh sách phát');
            
            const detailName = document.getElementById('pl-detail-name');
            if (detailName && document.getElementById('playlist-detail-modal')?.classList.contains('show')) {
                detailName.innerText = name;
            }
            if (document.getElementById('playlist-manager-modal')?.classList.contains('show')) this.renderUserPlaylists();
            if (this.state.currentFilter === 'user_playlist' && this.state.currentUserPlaylistIndex === index) {
                 document.querySelector('.list-header h2').innerText = name;
            }
        }
    }

    playUserPlaylist(index) {
        const playlist = this.state.userPlaylists[index];
        if (!playlist || !playlist.tracks.length) { this.showToast('Danh sách phát trống'); return; }
        
        this.state.currentFilter = 'user_playlist';
        this.state.currentUserPlaylistIndex = index;
        this.switchNavigation(0);
        
        const chips = document.querySelectorAll('.chip');
        if (chips.length) chips.forEach(c => c.classList.remove('active'));
        document.querySelector('.list-header h2').innerText = playlist.name;
        this.renderPlaylist();
        
        const realIdx = this.state.playlist.findIndex(t => String(t.id) === String(playlist.tracks[0]));
        if (realIdx !== -1) {
            this.playIndex(realIdx);
            this.showToast(`Đang phát: ${playlist.name}`);
        }
    }

    renderPlaylistTracks(playlist, playlistIndex) {
        const tracksContainer = document.getElementById('playlist-tracks');
        if (!tracksContainer) return;
        if (playlist.tracks.length === 0) {
            tracksContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub);">Danh sách trống</div>';
            return;
        }

        tracksContainer.innerHTML = '';
        playlist.tracks.forEach((trackId, trackIndex) => {
            const track = this.state.playlist.find(t => String(t.id) === String(trackId));
            if (track) {
                const trackItem = document.createElement('div');
                trackItem.className = 'track-item';
                trackItem.style.cursor = 'pointer';
                trackItem.innerHTML = `
                    <div class="track-thumb" style="width: 40px; height: 40px; border-radius: 8px; overflow: hidden;">
                        <img src="${track.artwork}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png'">
                    </div>
                    <div class="track-info" style="flex: 1;">
                        <div class="track-title">${track.name}</div>
                        <div class="track-artist">${track.artist}</div>
                    </div>
                    <button class="btn-remove-track" style="background: none; border: none; color: var(--text-sub); cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                `;

                trackItem.onclick = (e) => {
                    if (!e.target.closest('.btn-remove-track')) {
                        this.state.currentFilter = 'user_playlist';
                        this.state.currentUserPlaylistIndex = playlistIndex;
                        this.state.searchQuery = '';
                        const realIndex = this.state.playlist.findIndex(t => t.id === track.id);
                        if (realIndex !== -1) this.playIndex(realIndex);
                    }
                };

                trackItem.querySelector('.btn-remove-track').onclick = (e) => {
                    e.stopPropagation();
                    this.removeFromPlaylist(playlistIndex, trackIndex);
                };
                tracksContainer.appendChild(trackItem);
            }
        });
    }

    addToPlaylist(trackId, playlistIndex) {
        const playlist = this.state.userPlaylists[playlistIndex];
        if (!playlist.tracks.includes(String(trackId))) {
            playlist.tracks.push(String(trackId));
            playlist.updatedAt = new Date().toISOString();
            this.saveUserPlaylists();
            this.showToast('Đã thêm vào danh sách phát');
        } else {
            this.showToast('Bài hát đã tồn tại trong danh sách');
        }
    }

    removeFromPlaylist(playlistIndex, trackIndex) {
        const playlist = this.state.userPlaylists[playlistIndex];
        playlist.tracks.splice(trackIndex, 1);
        playlist.updatedAt = new Date().toISOString();
        this.saveUserPlaylists();
        this.showToast('Đã xóa khỏi danh sách phát');

        if (document.getElementById('playlist-detail-modal')?.classList.contains('show')) {
            this.renderPlaylistTracks(playlist, playlistIndex);
        }
    }

    deletePlaylist(index) {
        this.state.userPlaylists.splice(index, 1);
        this.saveUserPlaylists();
        this.showToast('Đã xóa danh sách phát');
        if (document.getElementById('playlist-manager-modal')?.classList.contains('show')) this.renderUserPlaylists();
    }

    showTrackContextMenu(trackIndex, event) {
        const existingMenu = document.getElementById('track-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'track-context-menu';
        menu.style.cssText = `position: fixed; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-lg); z-index: 1000; min-width: 200px; padding: 8px 0;`;

        const x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
        const y = event.clientY || (event.touches && event.touches[0].clientY) || 0;
        let left = x, top = y;

        if (x + 200 > window.innerWidth) left = window.innerWidth - 210;
        if (y + 200 > window.innerHeight) top = window.innerHeight - 210;

        menu.style.left = left + 'px'; menu.style.top = top + 'px';

        const menuItems = [
            { icon: 'fa-solid fa-list-music', label: 'Thêm vào danh sách phát', onClick: () => { this.showAddToPlaylistModal(trackIndex); menu.remove(); } },
            { icon: 'fa-solid fa-heart', label: 'Yêu thích', onClick: () => { this.toggleFavorite(trackIndex); menu.remove(); } },
            { icon: 'fa-solid fa-download', label: 'Tải về', onClick: () => { this.openDownloadModal(trackIndex); menu.remove(); } }
        ];

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'menu-item';
            menuItem.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; transition: background 0.2s;`;
            menuItem.innerHTML = `<i class="${item.icon}"></i> <span>${item.label}</span>`;
            menuItem.onclick = item.onClick;
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 10);
    }

    showAddToPlaylistModal(trackIndex) {
        const track = this.state.playlist[trackIndex];
        let modal = document.getElementById('add-to-playlist-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'add-to-playlist-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; border-radius: 16px; padding: 24px; display: flex; flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Thêm vào danh sách</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 15px;" id="add-pl-track-container">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <img id="add-pl-track-img" src="${track.artwork}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;" onerror="this.src='https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png'">
                            <div style="flex: 1;">
                                <div id="add-pl-track-name" style="font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${track.name}</div>
                                <div id="add-pl-track-artist" style="font-size: 13px; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${track.artist}</div>
                            </div>
                        </div>
                    </div>
                    <div style="margin-bottom: 15px;"><input type="text" id="playlist-search-input" placeholder="Tìm danh sách phát..." style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); font-size: 14px;"></div>
                    <div id="playlist-options" style="flex: 1; overflow-y: auto; margin-bottom: 24px; min-height: 150px;"></div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05); border:none; border-radius:12px; color:var(--text-main); cursor:pointer;">Hủy</button>
                        <button id="btn-create-new-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600; border:none; cursor:pointer;">Tạo mới</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            document.getElementById('add-pl-track-img').src = track.artwork;
            document.getElementById('add-pl-track-name').innerText = track.name;
            document.getElementById('add-pl-track-artist').innerText = track.artist;
        }

        modal.classList.add('show');
        this.clearPlaylistSlideshows();
        this.renderPlaylistOptions(trackIndex);

        document.getElementById('playlist-search-input').oninput = (e) => this.renderPlaylistOptions(trackIndex, e.target.value);
        document.getElementById('btn-create-new-playlist').onclick = () => { modal.classList.remove('show'); this.showCreatePlaylistModal(trackIndex); };
        modal.querySelectorAll('.btn-close-modal').forEach(btn => btn.onclick = () => { modal.classList.remove('show'); this.clearPlaylistSlideshows(); });
        modal.onclick = (e) => { if (e.target === modal) { modal.classList.remove('show'); this.clearPlaylistSlideshows(); } };
    }

    clearPlaylistSlideshows() {
        if (this.playlistSlideshows.length) { this.playlistSlideshows.forEach(i => clearInterval(i)); this.playlistSlideshows = []; }
    }

    renderPlaylistOptions(trackIndex, searchQuery = '') {
        const container = document.getElementById('playlist-options');
        if (!container) return;
        if (this.state.userPlaylists.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-sub);">Chưa có danh sách phát nào</div>';
            return;
        }

        container.innerHTML = '';
        let hasResults = false;

        this.state.userPlaylists.forEach((playlist, index) => {
            if (searchQuery && !playlist.name.toLowerCase().includes(searchQuery.toLowerCase())) return;
            hasResults = true;

            const playlistItem = document.createElement('div');
            playlistItem.className = 'settings-item';
            playlistItem.style.marginBottom = '8px';
            
            let iconHtml = `<div class="settings-icon"><i class="fa-solid fa-list-music"></i></div>`;
            if (playlist.tracks && playlist.tracks.length > 0) {
                iconHtml = `
                    <div class="settings-icon" id="pl-opt-thumb-${index}" style="position: relative; overflow: hidden; padding: 0;">
                        <i class="fa-solid fa-list-music" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1;"></i>
                        <img class="pl-img-a" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 1s ease; z-index: 2;">
                        <img class="pl-img-b" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 1s ease; z-index: 2;">
                    </div>
                `;
            }

            const isAlreadyAdded = playlist.tracks.includes(String(this.state.playlist[trackIndex].id));
            playlistItem.innerHTML = `
                ${iconHtml}
                <div class="settings-info">
                    <div class="settings-name">${playlist.name}</div>
                    <div class="settings-desc">${playlist.tracks.length} bài hát</div>
                </div>
                <div class="settings-action">
                    <span class="status-indicator status-info">${isAlreadyAdded ? 'ĐÃ CÓ' : 'THÊM'}</span>
                </div>
            `;

            playlistItem.onclick = () => {
                this.addToPlaylist(this.state.playlist[trackIndex].id, index);
                const indicator = playlistItem.querySelector('.status-indicator');
                if (indicator) { indicator.textContent = 'ĐÃ THÊM'; indicator.className = 'status-indicator status-success'; }
            };
            container.appendChild(playlistItem);
            if (playlist.tracks && playlist.tracks.length > 0) this.startPlaylistSlideshow(`pl-opt-thumb-${index}`, playlist.tracks);
        });

        if (!hasResults) container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-sub);">Không tìm thấy kết quả</div>';
    }

    getDisplayPlaylist() {
        let display = [...this.state.playlist];
        if (this.state.currentFilter === 'user_playlist') {
            const playlist = this.state.userPlaylists[this.state.currentUserPlaylistIndex];
            if (playlist) {
                const trackMap = new Map(display.map(t => [String(t.id), t]));
                display = playlist.tracks.map(id => trackMap.get(String(id))).filter(t => t);
            } else { display = []; }
        }
        else if (this.state.currentFilter === 'history') {
             const trackMap = new Map(display.map(t => [String(t.id), t]));
             display = this.state.history.map(id => trackMap.get(String(id))).filter(t => t);
        }
        else if (this.state.currentFilter === 'favorites') display = display.filter(t => this.state.favorites.includes(String(t.id)));
        else if (this.state.currentFilter === 'remix') display = display.filter(t => (window.PLAYLIST_REMIX || []).includes(String(t.id)));
        else if (this.state.currentFilter === 'tet') display = display.filter(t => (window.PLAYLIST_TET || []).includes(String(t.id)));
        else if (this.state.currentFilter === 'lofi') display = display.filter(t => (window.PLAYLIST_LOFI || []).includes(String(t.id)));
        
        const q = this.state.searchQuery.toLowerCase().trim();
        if (q) display = display.filter(t => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));
        
        if (this.state.currentFilter !== 'user_playlist' && this.state.currentFilter !== 'history') {
             if (this.state.sortBy === 'name') display.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
             else display.sort((a, b) => b.id - a.id);
        } else {
             if (this.state.sortBy === 'name') display.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        }
        return display;
    }

    renderPlaylist() {
        this.virtual.displayList = this.getDisplayPlaylist();
        if (this.state.currentNav === 1 || this.state.currentNav === 3) return; 
        if (this.elements.clearSearchBtn) this.elements.clearSearchBtn.style.display = this.state.searchQuery ? 'flex' : 'none';
        
        this.elements.list.style.height = 'auto';
        this.elements.list.style.paddingTop = '0px';
        this.elements.list.style.paddingBottom = '0px';
        this.virtual.lastStartRow = -1; this.virtual.lastEndRow = -1;

        if (!this.virtual.displayList.length) { 
            this.elements.list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sub)">Không tìm thấy bài hát</div>`; 
            return; 
        }
        this.updateVirtualMetrics();
        this.renderVirtualChunk();
    }

    updateVirtualMetrics() {
        const isDesktop = window.innerWidth >= 1024;
        this.virtual.rowHeight = isDesktop ? 110 : 75;
        this.virtual.itemsPerRow = isDesktop ? 3 : 1;
    }

    onScroll() {
        if (this.state.currentNav === 1 || this.state.currentNav === 3) return;
        if (!this.virtual.isTicking) {
            window.requestAnimationFrame(() => {
                this.renderVirtualChunk();
                this.virtual.isTicking = false;
            });
            this.virtual.isTicking = true;
        }
    }

    // FIX LỖI 3: Thiết lập gán Listener động JavaScript thay vì HTML String Onclick cứng (Tránh lỗi undefined window.app)
    renderVirtualChunk() {
        const { displayList, rowHeight, itemsPerRow, buffer } = this.virtual;
        const totalItems = displayList.length;
        const scrollTop = this.elements.scrollContainer.scrollTop;
        const viewportHeight = this.elements.scrollContainer.clientHeight;

        const totalRows = Math.ceil(totalItems / itemsPerRow);
        const startRow = Math.floor(scrollTop / rowHeight);
        const visibleRows = Math.ceil(viewportHeight / rowHeight);
        
        const renderStartRow = Math.max(0, startRow - buffer);
        const renderEndRow = Math.min(totalRows, startRow + visibleRows + buffer);

        if (this.virtual.lastStartRow === renderStartRow && this.virtual.lastEndRow === renderEndRow) return;
        this.virtual.lastStartRow = renderStartRow;
        this.virtual.lastEndRow = renderEndRow;

        this.elements.list.style.paddingTop = `${renderStartRow * rowHeight}px`;
        this.elements.list.style.paddingBottom = `${(totalRows - renderEndRow) * rowHeight}px`;

        this.elements.list.innerHTML = '';
        const frag = document.createDocumentFragment();
        
        const startIndex = renderStartRow * itemsPerRow;
        const endIndex = Math.min(totalItems, renderEndRow * itemsPerRow);

        for (let i = startIndex; i < endIndex; i++) {
            const track = displayList[i];
            const realIdx = this.state.playlist.findIndex(t => t.id === track.id);
            
            const item = document.createElement('div');
            item.className = 'track-item';
            if (realIdx === this.state.currentIndex) item.classList.add('active');
            
            const isFav = this.state.favorites.includes(String(track.id));
            item.innerHTML = `
                <div class="track-thumb">
                    <img src="${track.artwork}" loading="lazy">
                    <div class="wave-anim"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>
                </div>
                <div class="track-info">
                    <div class="track-title">${track.name}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div style="display:flex;gap:5px">
                    <button class="btn-icon btn-favorite-sm ${isFav?'active':''}"><i class="fa-${isFav?'solid':'regular'} fa-heart"></i></button>
                    <button class="btn-icon btn-download-sm"><i class="fa-solid fa-download"></i></button>
                    <button class="btn-icon btn-more-sm"><i class="fa-solid fa-ellipsis"></i></button>
                </div>
            `;

            // Khởi tạo Event listener an toàn bằng JS Element
            item.querySelector('.btn-favorite-sm').onclick = (e) => { e.stopPropagation(); this.toggleFavorite(realIdx); };
            item.querySelector('.btn-download-sm').onclick = (e) => { e.stopPropagation(); this.openDownloadModal(realIdx); };
            item.querySelector('.btn-more-sm').onclick = (e) => { e.stopPropagation(); this.showTrackContextMenu(realIdx, e); };
            
            item.onclick = (e) => {
                if (!e.target.closest('.btn-icon')) this.playIndex(realIdx);
            };

            item.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showTrackContextMenu(realIdx, e); });
            frag.appendChild(item);
        }
        this.elements.list.appendChild(frag);
    }

    renderContextQueue() {
        if (!this.elements.queueList) return;
        const displayList = this.getDisplayPlaylist();
        this.elements.queueList.innerHTML = '';

        if (displayList.length === 0) {
            this.elements.queueList.innerHTML = '<div style="text-align:center; padding:20px; color:rgba(255,255,255,0.5)">Danh sách trống</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        displayList.forEach((track) => {
            const realIdx = this.state.playlist.findIndex(t => t.id === track.id);
            const item = document.createElement('div');
            item.className = `queue-item ${realIdx === this.state.currentIndex ? 'active' : ''}`;
            item.innerHTML = `
                <div class="queue-item-info">
                    <div class="queue-item-title">${track.name}</div>
                    <div class="queue-item-artist">${track.artist}</div>
                </div>
            `;
            item.onclick = () => this.playIndex(realIdx);
            frag.appendChild(item);
        });
        this.elements.queueList.appendChild(frag);
    }

    renderExplore() {
        this.elements.list.innerHTML = '';
        this.elements.list.style.paddingBottom = '200px';

        const q = this.state.searchQuery.toLowerCase().trim();
        if (q) { this.renderPlaylist(); return; }

        const container = document.createElement('div');
        container.className = 'explore-container';

        const createSection = (title, ids, emptyMsg, filterType = null) => {
            const section = document.createElement('div');
            section.className = 'explore-section';
            const header = document.createElement('div');
            header.className = 'section-header';
            header.innerHTML = `<div class="explore-title">${title}</div>`;

            if (ids && ids.length > 0 && filterType) {
                const btn = document.createElement('div'); btn.className = 'btn-see-all'; btn.innerText = 'Xem tất cả';
                btn.onclick = () => {
                    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                    document.querySelectorAll('.nav-link')[0].classList.add('active');
                    this.state.currentNav = 0; this.state.currentFilter = filterType;
                    this.renderPlaylist();
                };
                header.appendChild(btn);
            }
            section.appendChild(header);

            if (!ids || ids.length === 0) {
                if (emptyMsg) { section.innerHTML += `<p style="color:var(--text-sub);font-size:14px;text-align:center;padding:20px">${emptyMsg}</p>`; return section; }
                return null;
            }

            const grid = document.createElement('div'); grid.className = 'explore-scroll-container';
            ids.forEach(id => {
                const song = this.state.playlist.find(t => String(t.id) === String(id));
                if (song) {
                    const item = document.createElement('div'); item.className = 'history-item';
                    item.innerHTML = `<img src="${song.artwork}" class="history-img" loading="lazy"><div class="history-title">${song.name}</div><div class="history-artist">${song.artist}</div>`;
                    item.onclick = () => {
                        if (filterType) { this.state.currentFilter = filterType; this.state.searchQuery = ''; }
                        this.playIndex(this.state.playlist.findIndex(t => t.id === song.id));
                    };
                    grid.appendChild(item);
                }
            });
            section.appendChild(grid); return section;
        };

        container.appendChild(createSection('Nghe gần đây', this.state.history, 'Chưa có lịch sử nghe nhạc', 'history'));
        if (window.PLAYLIST_REMIX) container.appendChild(createSection('Nhạc Remix', window.PLAYLIST_REMIX, 'Đang tải...', 'remix'));
        if (window.PLAYLIST_TET) container.appendChild(createSection('Nhạc Tết', window.PLAYLIST_TET, 'Đang tải...', 'tet'));
        if (window.PLAYLIST_LOFI) container.appendChild(createSection('Nhạc Lofi', window.PLAYLIST_LOFI, 'Đang tải...', 'lofi'));
        this.elements.list.appendChild(container);
    }

    renderSettings() {
        this.elements.list.innerHTML = '';
        this.elements.list.style.paddingBottom = '200px';

        const container = document.createElement('div');
        container.className = 'settings-container';

        const createSection = (title, items) => {
            const section = document.createElement('div'); section.className = 'settings-section';
            section.innerHTML = `<div class="settings-title">${title}</div>`;
            items.forEach(item => {
                const row = document.createElement('div'); row.className = 'settings-item';
                if (item.onClick) row.onclick = item.onClick;
                row.innerHTML = `<div class="settings-icon"><i class="${item.icon}"></i></div><div class="settings-info"><div class="settings-name">${item.name}</div><div class="settings-desc">${item.desc || ''}</div></div>${item.action ? `<div class="settings-action">${item.action}</div>` : ''}`;
                section.appendChild(row);
            });
            return section;
        };

        const userProfile = {
            name: localStorage.getItem('user_name') || 'Chưa đặt tên',
            email: localStorage.getItem('user_email') || 'Chưa có email',
            avatar: localStorage.getItem('user_avatar') || 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png'
        };

        container.appendChild(createSection('Thông tin cá nhân', [{ name: userProfile.name, desc: userProfile.email, icon: 'fa-solid fa-user', onClick: () => this.showProfileEditModal(userProfile) }]));
        
        const appearance = [
            { name: 'Chủ đề', desc: this.state.theme === 'auto' ? 'Hệ thống' : this.state.theme, icon: 'fa-solid fa-palette', onClick: () => this.toggleTheme() },
            { name: 'Màu sắc chính', desc: 'Tùy chỉnh mã màu UI', icon: 'fa-solid fa-eye-dropper', onClick: () => this.showColorPickerModal() },
            { name: 'Phông chữ', desc: this.getFontDisplayName(this.state.fontFamily), icon: 'fa-solid fa-font', onClick: () => this.showFontSelectorModal() },
            { name: 'Bố cục', desc: this.getLayoutDisplayName(this.state.layoutMode), icon: 'fa-solid fa-table-cells', onClick: () => this.showLayoutSelectorModal() }
        ];
        container.appendChild(createSection('Giao diện', appearance));
        
        const features = [
            { name: 'Danh sách phát', desc: `Quản lý ${this.state.userPlaylists.length} playlist`, icon: 'fa-solid fa-music', onClick: () => this.showPlaylistManager() },
            { name: 'Hẹn giờ tắt nhạc', desc: this.state.sleepTimeLeft > 0 ? `${Math.ceil(this.state.sleepTimeLeft / 60)} phút còn lại` : 'Chưa bật', icon: 'fa-solid fa-clock', onClick: () => this.elements.timerModal.classList.add('show') },
            { name: 'Chế độ ngủ thông minh', desc: 'Giảm volume từ từ trước khi tắt', icon: 'fa-solid fa-moon', action: `<span class="status-indicator ${this.state.smartSleepEnabled?'status-active':'status-inactive'}">${this.state.smartSleepEnabled?'BẬT':'TẮT'}</span>`, onClick: () => { this.toggleSmartSleep(); this.renderSettings(); } },
            { name: 'Âm thanh 3D & EQ', desc: 'Mở bộ tùy chỉnh âm thanh nâng cao', icon: 'fa-solid fa-sliders', onClick: () => this.checkProAccess(() => document.getElementById('audio-controls-modal').classList.add('show')) }
        ];
        container.appendChild(createSection('Tính năng', features));
        container.appendChild(createSection('Chung', [{ name: 'Cài đặt gốc', desc: 'Xóa toàn bộ dữ liệu ứng dụng', icon: 'fa-solid fa-rotate-right', onClick: () => document.getElementById('reset-modal').classList.add('show') }]));

        this.elements.list.appendChild(container);
    }

    showProfileEditModal(profile) {
        let modal = document.getElementById('profile-edit-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'profile-edit-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;"><h3 style="margin:0;">Thông tin cá nhân</h3><button class="btn-close-modal" style="border:none; background:none; color:var(--text-main); font-size:20px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button></div>
                    <div style="display:flex; flex-direction:column; gap:15px;">
                        <div style="text-align:center;"><img id="profile-avatar-preview" src="${profile.avatar}" style="width:70px; height:70px; border-radius:50%; object-fit:cover;"></div>
                        <input type="text" id="profile-name-input" placeholder="Tên của bạn" value="${profile.name === 'Chưa đặt tên' ? '' : profile.name}" style="padding:12px; border-radius:8px; background:var(--bg-secondary); color:var(--text-main); border:1px solid var(--border);">
                        <input type="email" id="profile-email-input" placeholder="Email của bạn" value="${profile.email === 'Chưa có email' ? '' : profile.email}" style="padding:12px; border-radius:8px; background:var(--bg-secondary); color:var(--text-main); border:1px solid var(--border);">
                        <input type="file" id="profile-avatar-upload" accept="image/*" style="display:none;">
                        <button id="btn-upload-avatar" style="padding:10px; border:1px dashed var(--border); background:none; color:var(--text-main); border-radius:8px; cursor:pointer;">Chọn ảnh đại diện</button>
                        <div style="display:flex; gap:10px;"><button class="btn-close-modal" style="flex:1; padding:12px; border-radius:8px; background:rgba(255,255,255,0.05); border:none; color:var(--text-main); cursor:pointer;">Hủy</button><button id="btn-save-profile" style="flex:1; padding:12px; border-radius:8px; background:var(--primary); color:white; border:none; font-weight:600; cursor:pointer;">Lưu</button></div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.classList.add('show');

        document.getElementById('btn-upload-avatar').onclick = () => document.getElementById('profile-avatar-upload').click();
        document.getElementById('profile-avatar-upload').onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => this.showLargeCropModal(event.target.result);
                reader.readAsDataURL(file);
            }
        };

        document.getElementById('btn-save-profile').onclick = () => {
            const name = document.getElementById('profile-name-input').value.trim();
            const email = document.getElementById('profile-email-input').value.trim();
            if (email && !this.isValidEmail(email)) { this.showToast('Email không hợp lệ'); return; }

            const now = Date.now();
            if (name) { localStorage.setItem('user_name', name); localStorage.setItem('user_name_timestamp', now.toString()); }
            if (email) { localStorage.setItem('user_email', email); localStorage.setItem('user_email_timestamp', now.toString()); }
            if (this.croppedImageDataUrl) { localStorage.setItem('user_avatar', this.croppedImageDataUrl); localStorage.setItem('user_avatar_timestamp', now.toString()); }

            this.showToast('Lưu cấu hình thành công'); modal.classList.remove('show'); this.renderSettings(); this.initializeHeaderAvatar();
        };

        modal.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = () => modal.classList.remove('show'));
    }

    isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

    showLargeCropModal(imageSrc) {
        let cropModal = document.getElementById('large-crop-modal');
        if (!cropModal) {
            cropModal = document.createElement('div'); cropModal.id = 'large-crop-modal'; cropModal.className = 'modal-overlay';
            cropModal.innerHTML = `
                <div class="modal-content" style="max-width:90%; width:450px; height:75vh; display:flex; flex-direction:column; padding:24px; border-radius:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;"><h3 style="margin:0;">Cắt ảnh</h3><button id="btn-close-crop" style="border:none; background:none; color:var(--text-main); font-size:20px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button></div>
                    <div id="crop-container-large" style="flex:1; background:#000; border-radius:12px; overflow:hidden; position:relative; display:flex; align-items:center; justify-content:center;">
                        <img id="crop-image-large" src="${imageSrc}" style="display:none;">
                        <canvas id="crop-canvas-large" style="max-width:100%; max-height:100%; cursor:grab;"></canvas>
                        <div id="crop-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;"></div>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:15px;"><button id="btn-cancel-crop" style="flex:1; padding:12px; border-radius:8px; background:rgba(255,255,255,0.05); border:none; color:var(--text-main); cursor:pointer;">Hủy</button><button id="btn-confirm-crop" style="flex:1; padding:12px; border-radius:8px; background:var(--primary); color:white; border:none; font-weight:600; cursor:pointer;">Cắt ảnh</button></div>
                </div>
            `;
            document.body.appendChild(cropModal);
        } else {
            document.getElementById('crop-image-large').src = imageSrc;
        }
        cropModal.classList.add('show');
        this.initializeLargeCropper(imageSrc);

        document.getElementById('btn-close-crop').onclick = () => cropModal.classList.remove('show');
        document.getElementById('btn-cancel-crop').onclick = () => cropModal.classList.remove('show');
        document.getElementById('btn-confirm-crop').onclick = () => {
            const cropped = this.getCroppedImageLarge();
            if (cropped) {
                this.croppedImageDataUrl = cropped;
                const preview = document.getElementById('profile-avatar-preview');
                if (preview) preview.src = cropped;
                cropModal.classList.remove('show'); this.showToast('Đã cắt ảnh');
            }
        };
    }

    initializeLargeCropper(imageSrc) {
        const img = document.getElementById('crop-image-large');
        this.zoom = 1; this.offset = { x: 0, y: 0 }; this.dragging = false;

        const setup = () => {
            const canvas = document.getElementById('crop-canvas-large');
            if (!canvas) return;
            canvas.width = 300; canvas.height = 300;
            const ctx = canvas.getContext('2d');

            const draw = () => {
                ctx.clearRect(0, 0, 300, 300);
                const scale = Math.max(300 / img.width, 300 / img.height) * this.zoom;
                const w = img.width * scale, h = img.height * scale;
                ctx.drawImage(img, 150 + this.offset.x - w/2, 150 + this.offset.y - h/2, w, h);
                
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, 296, 296);
            };

            canvas.onmousedown = (e) => { this.dragging = true; this.startX = e.clientX - this.offset.x; this.startY = e.clientY - this.offset.y; };
            window.onmousemove = (e) => { if (this.dragging) { this.offset.x = e.clientX - this.startX; this.offset.y = e.clientY - this.startY; draw(); } };
            window.onmouseup = () => this.dragging = false;

            canvas.ontouchstart = (e) => { this.dragging = true; const t = e.touches[0]; this.startX = t.clientX - this.offset.x; this.startY = t.clientY - this.offset.y; };
            canvas.ontouchmove = (e) => { if (this.dragging) { const t = e.touches[0]; this.offset.x = t.clientX - this.startX; this.offset.y = t.clientY - this.startY; draw(); } };
            canvas.ontouchend = () => this.dragging = false;

            draw();
        };
        if (img.complete) setup(); else img.onload = setup;
    }

    getCroppedImageLarge() {
        const canvas = document.getElementById('crop-canvas-large');
        return canvas ? canvas.toDataURL('image/jpeg', 0.85) : null;
    }

    updateHeaderAvatar(imageUrl) {
        const headerAvatar = document.querySelector('.top-bar .avatar img');
        if (headerAvatar) {
            headerAvatar.src = imageUrl;
            headerAvatar.onerror = () => headerAvatar.src = 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png';
        }
    }

    showColorPickerModal() {
        let modal = document.getElementById('color-picker-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'color-picker-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:400px; width:90%; padding:24px; border-radius:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;"><h3>Màu sắc UI</h3><button class="btn-close-modal" style="border:none; background:none; color:var(--text-main); font-size:20px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button></div>
                    <div style="display:flex; flex-direction:column; gap:15px; margin-bottom:20px;">
                        <div style="display:flex; align-items:center; justify-content:space-between;"><label>Chọn màu chủ đạo:</label><input type="color" id="color-picker" value="${this.state.customPrimaryColor || '#2962ff'}" style="width:60px; height:35px; border:none; border-radius:4px; cursor:pointer;"></div>
                        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-secondary); padding:12px; border-radius:10px;"><div><div style="font-weight:600;">Giao diện đổi màu theo Cover</div><div style="font-size:12px; color:var(--text-sub);">Tự động đồng bộ màu theo bài hát</div></div><div class="toggle-switch ${this.state.autoThemeByCover?'active':''}" id="auto-theme-cover-toggle-modal"></div></div>
                    </div>
                    <div style="display:flex; gap:10px;"><button class="btn-close-modal" style="flex:1; padding:12px; background:rgba(255,255,255,0.05); border:none; color:var(--text-main); border-radius:8px; cursor:pointer;">Hủy</button><button id="btn-save-color" style="flex:1; padding:12px; background:var(--primary); color:white; border:none; font-weight:600; border-radius:8px; cursor:pointer;">Lưu</button></div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.classList.add('show');

        const toggle = document.getElementById('auto-theme-cover-toggle-modal');
        toggle.onclick = () => {
            this.state.autoThemeByCover = !this.state.autoThemeByCover;
            toggle.classList.toggle('active', this.state.autoThemeByCover);
            localStorage.setItem('autoThemeByCover', this.state.autoThemeByCover);
            if (this.state.autoThemeByCover && this.state.playlist[this.state.currentIndex]) {
                this.applyDynamicUIColors(this.state.playlist[this.state.currentIndex].artwork);
            } else {
                this.setCustomPrimaryColor(this.state.customPrimaryColor || '#2962ff');
            }
        };

        document.getElementById('btn-save-color').onclick = () => {
            this.setCustomPrimaryColor(document.getElementById('color-picker').value);
            modal.classList.remove('show'); this.showToast('Đã lưu cấu hình màu');
        };
        modal.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = () => modal.classList.remove('show'));
    }

    setCustomPrimaryColor(color) {
        this.state.customPrimaryColor = color; localStorage.setItem('customPrimaryColor', color);
        document.documentElement.style.setProperty('--primary', color);
        document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${color} 0%, ${this.darkenColor(color, 30)} 100%)`);
        this.applyColorToUIElements(color);
    }

    applyColorToUIElements(color) {
        document.documentElement.style.setProperty('--primary', color);
        this.updateAllRangeInputs(); this.updateMuteUI(); this.updateHeartButton();
        const navLinks = document.querySelectorAll('.nav-link');
        navLinks.forEach((nav, index) => {
            if (nav.classList.contains('active')) {
                const icon = nav.querySelector('i'), span = nav.querySelector('span');
                if (icon) icon.style.color = color; if (span) span.style.color = color;
            }
        });
    }

    lightenColor(color, percent) {
        const num = parseInt(color.replace("#",""), 16), amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt, G = (num >> 8 & 0x00FF) + amt, B = (num & 0x0000FF) + amt;
        return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (G<255?G<1?0:G:255)*0x100 + (B<255?B<1?0:B:255)).toString(16).slice(1);
    }

    darkenColor(color, percent) {
        const num = parseInt(color.replace("#",""), 16), amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt, G = (num >> 8 & 0x00FF) - amt, B = (num & 0x0000FF) - amt;
        return "#" + (0x1000000 + (R>255?255:R<0?0:R)*0x10000 + (G>255?255:G<0?0:G)*0x100 + (B>255?255:B<0?0:B)).toString(16).slice(1);
    }

    getFontDisplayName(fontFamily) {
        const names = { 'Urbanist': 'Mặc định', 'LXGW WenKai Mono TC': 'LXGW WenKai', 'Roboto Slab': 'Roboto Slab' };
        return names[fontFamily] || fontFamily;
    }

    getLayoutDisplayName(layoutMode) {
        const names = { 'standard': 'Tiêu chuẩn', 'compact': 'Gọn nhẹ', 'spacious': 'Rộng rãi' };
        return names[layoutMode] || layoutMode;
    }

    showFontSelectorModal() {
        let modal = document.getElementById('font-selector-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'font-selector-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:400px; width:90%; padding:24px; border-radius:16px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;"><h3>Tùy chỉnh Font</h3><button class="btn-close-modal" style="border:none; background:none; color:var(--text-main); font-size:20px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button></div>
                    <div style="display:flex; flex-direction:column; gap:15px; margin-bottom:20px;">
                        <select id="font-selector" style="padding:12px; border-radius:8px; background:var(--bg-secondary); color:var(--text-main); border:1px solid var(--border);">
                            <option value="Urbanist">Urbanist (Mặc định)</option>
                            <option value="LXGW WenKai Mono TC">LXGW WenKai Mono</option>
                            <option value="Roboto Slab">Roboto Slab</option>
                        </select>
                        <select id="font-weight-selector" style="padding:12px; border-radius:8px; background:var(--bg-secondary); color:var(--text-main); border:1px solid var(--border);">
                            <option value="300">Nhạt (300)</option><option value="400">Thường (400)</option><option value="700">Đậm (700)</option>
                        </select>
                    </div>
                    <div style="display:flex; gap:10px;"><button class="btn-close-modal" style="flex:1; padding:12px; background:rgba(255,255,255,0.05); border:none; color:var(--text-main); border-radius:8px; cursor:pointer;">Hủy</button><button id="btn-save-font" style="flex:1; padding:12px; background:var(--primary); color:white; border:none; font-weight:600; border-radius:8px; cursor:pointer;">Lưu</button></div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        modal.classList.add('show');
        document.getElementById('font-selector').value = this.state.fontFamily;
        document.getElementById('font-weight-selector').value = this.state.fontWeight;

        document.getElementById('btn-save-font').onclick = () => {
            this.setFontFamily(document.getElementById('font-selector').value, document.getElementById('font-weight-selector').value);
            modal.classList.remove('show'); this.showToast('Đã lưu cấu hình phông chữ');
        };
        modal.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = () => modal.classList.remove('show'));
    }

    loadLocalFont(fontFamily) {}

    setFontFamily(fontFamily, fontWeight = '400') {
        this.state.fontFamily = fontFamily; this.state.fontWeight = fontWeight;
        localStorage.setItem('fontFamily', fontFamily); localStorage.setItem('fontWeight', fontWeight);
        document.documentElement.style.setProperty('font-family', `${fontFamily}, sans-serif`);
        document.documentElement.style.setProperty('font-weight', fontWeight);
        this.applyFontToAllElements(fontFamily, fontWeight);
    }
    
    applyFontToAllElements(fontFamily, fontWeight = '400') {
        const els = document.querySelectorAll('body, div, p, span, button, input, h2, h3');
        els.forEach(el => { el.style.fontFamily = `${fontFamily}, sans-serif`; el.style.fontWeight = fontWeight; });
    }
    
    getCurrentLyricId() {
        if (!this.lyricsData.length) return null;
        const time = this.currentSongHasVideo ? this.video.currentTime : (this.state.isBeatMode ? this.beatAudio.currentTime : this.audio.currentTime);
        let activeId = null;
        for (let i = 0; i < this.lyricsData.length; i++) {
            if (this.lyricsData[i].time <= time) activeId = this.lyricsData[i].id; else break;
        }
        return activeId;
    }

    checkProAccess(callback) {
        if (this.state.isProUnlocked) callback(); else this.showUnlockModal(callback);
    }

    showUnlockModal(callback) {
        let modal = document.getElementById('unlock-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'unlock-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 300px; width: 90%; border-radius: 24px; padding: 24px;">
                    <h3 style="margin: 0 0 20px 0; text-align: center;">Nhập mã PIN Pro</h3>
                    <input type="password" id="unlock-code-input" readonly style="width: 100%; padding: 15px; border-radius: 16px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); text-align: center; font-size: 24px; letter-spacing: 5px; margin-bottom: 20px; outline: none;">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;" id="unlock-keypad">
                        ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="unlock-key" data-key="${n}" style="padding:15px; border-radius:14px; background:var(--bg-secondary); color:var(--text-main); border:1px solid var(--border); font-size:18px; font-weight:600; cursor:pointer;">${n}</button>`).join('')}
                        <button class="unlock-key" data-key="C" style="padding:15px; border-radius:14px; background:rgba(255,71,87,0.1); color:#ff4757; border:1px solid rgba(255,71,87,0.2); font-size:18px; font-weight:700; cursor:pointer;">C</button>
                        <button class="unlock-key" data-key="0" style="padding:15px; border-radius:14px; background:var(--bg-secondary); color:var(--text-main); border:1px solid var(--border); font-size:18px; font-weight:600; cursor:pointer;">0</button>
                        <button class="unlock-key" data-key="OK" style="padding:15px; border-radius:14px; background:var(--primary); color:white; border:none; font-size:16px; font-weight:700; cursor:pointer;">OK</button>
                    </div>
                    <button class="btn-close-modal" style="width: 100%; padding: 12px; background: transparent; color: var(--text-sub); border: none; font-weight:600; margin-top:10px; cursor:pointer;">Hủy bỏ</button>
                </div>
            `;
            document.body.appendChild(modal);

            const input = document.getElementById('unlock-code-input');
            modal.querySelectorAll('.unlock-key').forEach(btn => {
                btn.onclick = () => {
                    const key = btn.dataset.key;
                    if (key === 'C') input.value = '';
                    else if (key === 'OK') {
                        if (input.value === '5555') {
                            this.state.isProUnlocked = true; localStorage.setItem('isProUnlocked', 'true');
                            this.showToast('Đã mở khóa tính năng Pro'); modal.classList.remove('show');
                            if (this.pendingUnlockCallback) this.pendingUnlockCallback();
                        } else {
                            this.showToast('Mã PIN không đúng'); input.value = '';
                        }
                    } else { if (input.value.length < 4) input.value += key; }
                };
            });
            modal.querySelector('.btn-close-modal').onclick = () => modal.classList.remove('show');
        }
        this.pendingUnlockCallback = callback;
        document.getElementById('unlock-code-input').value = '';
        modal.classList.add('show');
    }

    initAudioEffects() {
        let audioControlsModal = document.getElementById('audio-controls-modal');
        if (!audioControlsModal) {
            audioControlsModal = document.createElement('div'); audioControlsModal.id = 'audio-controls-modal'; audioControlsModal.className = 'modal-overlay';
            audioControlsModal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <h3 style="text-align: center; margin-bottom:20px;">Cài đặt âm thanh nâng cao</h3>
                    <div class="settings-section">
                        <div class="settings-title">ÂM THANH KHÔNG GIAN</div>
                        <div class="settings-item">
                            <div class="settings-icon"><i class="fa-solid fa-headphones"></i></div>
                            <div class="settings-info"><div class="settings-name">Hiệu ứng Âm thanh 3D</div></div>
                            <div class="toggle-switch" id="spatial-audio-toggle"></div>
                        </div>
                    </div>
                    <button class="btn-close-modal" id="btn-close-audio-controls" style="width:100%; padding:12px; background:var(--bg-secondary); border:none; color:var(--text-main); border-radius:8px; font-weight:600; cursor:pointer; margin-top:20px;">Đóng</button>
                </div>
            `;
            document.body.appendChild(audioControlsModal);
            document.getElementById('spatial-audio-toggle').onclick = () => this.toggleSpatialAudio();
            document.getElementById('btn-close-audio-controls').onclick = () => audioControlsModal.classList.remove('show');
        }
    }

    showLayoutSelectorModal() {
        let modal = document.getElementById('layout-selector-modal');
        if (!modal) {
            modal = document.createElement('div'); modal.id = 'layout-selector-modal'; modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;"><h3>Chọn bố cục</h3><button class="btn-close-modal" style="border:none; background:none; color:var(--text-main); font-size:20px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button></div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:24px;">
                        <div class="layout-option" data-layout="standard" style="padding:15px; border-radius:12px; background:var(--bg-secondary); text-align:center; cursor:pointer;">Tiêu chuẩn</div>
                        <div class="layout-option" data-layout="compact" style="padding:15px; border-radius:12px; background:var(--bg-secondary); text-align:center; cursor:pointer;">Gọn nhẹ</div>
                    </div>
                    <div style="display: flex; gap: 12px;"><button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05); border:none; border-radius:8px; color:var(--text-main); cursor:pointer;">Hủy</button><button id="btn-save-layout" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 8px; font-weight: 600; border:none; cursor:pointer;">Lưu</button></div>
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelectorAll('.layout-option').forEach(opt => {
                opt.onclick = () => {
                    modal.querySelectorAll('.layout-option').forEach(o => o.style.border = 'none');
                    opt.style.border = '2px solid var(--primary)';
                    modal.dataset.selectedLayout = opt.dataset.layout;
                };
            });
        }
        modal.classList.add('show');

        document.getElementById('btn-save-layout').onclick = () => {
            const layout = modal.dataset.selectedLayout || 'standard';
            this.setLayoutMode(layout); modal.classList.remove('show'); this.showToast('Đã lưu bố cục');
        };
        modal.querySelectorAll('.btn-close-modal').forEach(b => b.onclick = () => modal.classList.remove('show'));
    }

    setLayoutMode(layoutMode) {
        this.state.layoutMode = layoutMode; localStorage.setItem('layoutMode', layoutMode);
        document.body.className = document.body.className.replace(/layout-\w+/g, '');
        document.body.classList.add(`layout-${layoutMode}`);
        this.renderPlaylist();
    }

    toggleFavorite(idx) {
        const id = String(this.state.playlist[idx].id);
        if (this.state.favorites.includes(id)) {
            this.state.favorites = this.state.favorites.filter(x => x !== id); this.showToast('Đã xóa khỏi yêu thích');
        } else {
            this.state.favorites.push(id); this.showToast('Đã thêm vào yêu thích');
        }
        localStorage.setItem('favorites', JSON.stringify(this.state.favorites));
        this.updateHeartButton(); this.renderPlaylist();
    } 

    updateHeartButton() {
        if (!this.state.playlist[this.state.currentIndex]) return;
        const isFav = this.state.favorites.includes(String(this.state.playlist[this.state.currentIndex].id));
        const btn = document.getElementById('btn-heart');
        if (!btn) return;
        btn.className = `btn-icon ${isFav ? 'active' : ''}`;
        btn.innerHTML = `<i class="fa-${isFav ? 'solid' : 'regular'} fa-heart"></i>`;
        btn.style.color = isFav ? 'var(--primary)' : '';
    }

    // FIX LỖI 2: Đảm bảo không gọi tự động requestPictureInPicture chặn Autoplay Policy
    loadSong(idx, autoPlay = true) {
        if (this.lyricsPiPWindow) { this.lyricsPiPWindow.close(); this.lyricsPiPWindow = null; }
        if (this.lyricsPipVideo && document.pictureInPictureElement === this.lyricsPipVideo) {
            document.exitPictureInPicture().catch(() => {}); this.isLyricsCanvasActive = false;
        }

        this.pause(); 
        this.state.currentIndex = idx; this.state.isPreloading = false; this.state.nextTrackData = null; this.isBackgroundFallback = false;

        const song = this.state.playlist[idx];
        this.updateUI(song); this.updateHeartButton(); this.updateBeatBtnUI(); this.renderPlaylist();
        this.loadLyrics(song.lyric); this.renderContextQueue(); this.addToHistory(song.id);

        this.currentSongHasVideo = !!(song.vid && !song.vid.includes('..4.mp4') && !song.vid.includes('ERROR'));
        this.updatePiPButtonUI();

        this.video.src = this.currentSongHasVideo ? song.vid : '';
        this.audio.src = song.path;
        this.beatAudio.src = (song.instrumental && song.instrumental !== 'Tạm thời chưa có!') ? song.instrumental : '';

        if (!this.currentSongHasVideo && this.state.currentMode === 'video') this.switchTab('song');
        if (autoPlay) { this.resumeAudioContext(); this.play(); }
        this.checkMarquee();
        localStorage.setItem('lastIndex', idx); localStorage.setItem('lastTime', 0);
    }

    addToHistory(id) {
        this.state.history = [String(id), ...this.state.history.filter(x => x !== String(id))].slice(0, 20);
        localStorage.setItem('history', JSON.stringify(this.state.history));
    }

    updateUI(song) {
        const t = document.getElementById('full-title');
        if (t) { t.innerText = song.name; t.removeAttribute('d'); t.parentElement.classList.remove('animate'); }
        
        const artist = document.getElementById('full-artist'); if (artist) artist.innerText = song.artist;
        const mTitle = document.getElementById('mini-title'); if (mTitle) mTitle.innerText = song.name;
        const mArtist = document.getElementById('mini-artist'); if (mArtist) mArtist.innerText = song.artist;
        
        const fArt = document.getElementById('full-artwork'); if (fArt) fArt.src = song.artwork;
        const mImg = document.getElementById('mini-img'); if (mImg) mImg.src = song.artwork;

        if (this.state.autoThemeByCover) this.applyDynamicUIColors(song.artwork);
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.name, artist: song.artist, artwork: [{ src: song.artwork, sizes: '512x512', type: 'image/jpeg' }]
            });
        }
    }

    extractColor(url) {
        return new Promise((resolve) => {
            const img = new Image(); img.crossOrigin = "Anonymous"; img.src = url;
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
                    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 1, 1);
                    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                    resolve({ rgb: `rgb(${r}, ${g}, ${b})`, hex: this.rgbToHex(r, g, b) });
                } catch (e) { resolve(null); }
            };
            img.onerror = () => resolve(null);
        });
    }
    
    rgbToHex(r, g, b) { return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); }
    
    async applyDynamicUIColors(albumArtwork) {
        const colors = await this.extractColor(albumArtwork);
        if (colors) {
            document.documentElement.style.setProperty('--primary', colors.rgb);
            document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${colors.hex} 0%, ${this.darkenColor(colors.hex, 30)} 100%)`);
            if (this.elements.ambient) this.elements.ambient.style.background = `radial-gradient(circle, ${colors.hex}, transparent 70%)`;
            this.applyColorToUIElements(colors.hex);
        }
    }

    checkPreload(currentTime, duration) {
        let threshold = 10;
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.downlink && conn.downlink < 2) threshold = 30;

        if (duration - currentTime <= threshold && !this.state.isPreloading) {
            this.state.isPreloading = true; this.executePreload();
        }
    }

    executePreload() {
        const nextIdx = this.getNextIndex(); if (nextIdx === -1) return;
        const nextSong = this.state.playlist[nextIdx]; this.state.nextTrackData = nextSong;
        this.preloadAudioAgent.src = this.state.isBeatMode ? nextSong.instrumental : nextSong.path;
        this.preloadAudioAgent.load();
        if (this.state.currentMode === 'video' && nextSong.vid && !nextSong.vid.includes('ERROR')) {
            this.preloadVideoAgent.src = nextSong.vid; this.preloadVideoAgent.load();
        }
    }

    getNextIndex() {
        const display = this.getDisplayPlaylist(); if (!display.length) return -1;
        const curr = this.state.playlist[this.state.currentIndex];
        let idx = display.findIndex(t => t.id === curr.id), nextIdx = 0;
        if (this.state.isShuffle) {
            if (display.length > 1) do { nextIdx = Math.floor(Math.random() * display.length); } while (nextIdx === idx);
        } else { if (idx !== -1) nextIdx = idx + 1 >= display.length ? 0 : idx + 1; }
        return this.state.playlist.findIndex(t => t.id === display[nextIdx].id);
    }

    toggleBeatMode() {
        if (!this.beatAudio.src) { this.showToast('Chưa có Beat!'); return; }
        this.state.isBeatMode = !this.state.isBeatMode; this.updateBeatBtnUI();
        this.showToast(this.state.isBeatMode ? 'Chế độ Beat' : 'Tắt Beat');
        if (this.state.isPlaying) this.play(); else if (this.currentSongHasVideo) this.video.muted = this.state.isBeatMode;
    }
    updateBeatBtnUI() { if(this.elements.btnSwitchBeat) this.elements.btnSwitchBeat.classList.toggle('active', this.state.isBeatMode); }
    playIndex(idx) { this.loadSong(idx, true); }

    play() {
        this.resumeAudioContext();
        this.state.isPlaying = true; this.updatePlayState();
        if (this.state.sleepTimeLeft > 0) this.runSleepTimer();

        if (document.hidden && this.currentSongHasVideo && !this.state.isBeatMode) {
            this.isBackgroundFallback = true; this.audio.play().catch(() => {}); this.video.pause(); return;
        }

        if (this.currentSongHasVideo) {
            this.video.muted = this.state.isMuted || this.state.isBeatMode;
            this.video.play().catch(() => {
                this.showToast('Video lỗi, phát chỉ âm thanh'); this.currentSongHasVideo = false; this.play();
            });
            if (this.state.isBeatMode && this.beatAudio.src) this.beatAudio.play().catch(() => {}); else this.beatAudio.pause();
            this.audio.pause();
        } else {
            this.video.pause();
            if (this.state.isBeatMode && this.beatAudio.src) { this.audio.pause(); this.beatAudio.play().catch(() => {}); }
            else { this.beatAudio.pause(); this.audio.play().catch(() => {}); }
        }
    }

    pause() { 
        this.state.isPlaying = false; if (this.state.sleepInterval) { clearInterval(this.state.sleepInterval); this.state.sleepInterval = null; }
        this.video.pause(); this.audio.pause(); this.beatAudio.pause(); this.updatePlayState(); 
    }
    togglePlay() { this.state.isPlaying ? this.pause() : this.play(); }

    updatePlayState() {
        const icon = this.state.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        if (this.elements.playBtnMain) this.elements.playBtnMain.innerHTML = icon;
        if (this.elements.playBtnMini) this.elements.playBtnMini.innerHTML = icon;
        document.querySelectorAll('.wave-anim .bar').forEach(b => b.style.animationPlayState = this.state.isPlaying ? 'running' : 'paused');
        if (this.elements.mini) this.elements.mini.classList.toggle('playing', this.state.isPlaying);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.state.isPlaying ? 'playing' : 'paused';
    }

    next() { const idx = this.getNextIndex(); if (idx !== -1) this.loadSong(idx, true); }
    prev() {
        const display = this.getDisplayPlaylist(); if (!display.length) return;
        const curr = this.state.playlist[this.state.currentIndex];
        let idx = display.findIndex(t => t.id === curr.id), prevIdx = idx - 1 < 0 ? display.length - 1 : idx - 1;
        this.loadSong(this.state.playlist.findIndex(t => t.id === display[prevIdx].id), true);
    }

    startSleepTimer(minutes) {
        if (this.state.sleepInterval) clearInterval(this.state.sleepInterval);
        if (minutes === 0) { this.state.sleepTimeLeft = 0; this.updateTimerText(); this.showToast("Đã hủy hẹn giờ"); return; }
        this.state.sleepTimeLeft = minutes * 60; this.showToast(`Nhạc sẽ tắt sau ${minutes} phút`); this.updateTimerText();
        if (this.state.isPlaying) this.runSleepTimer();
    }

    runSleepTimer() {
        if (this.state.sleepInterval) clearInterval(this.state.sleepInterval);
        this.state.sleepInterval = setInterval(() => {
            if (this.state.sleepTimeLeft > 0) { this.state.sleepTimeLeft--; this.updateTimerText(); }
            else {
                clearInterval(this.state.sleepInterval); this.state.sleepInterval = null;
                if (this.state.smartSleepEnabled) this.startSmartSleepFadeOut();
                else { this.pause(); this.showToast("Đã hết thời gian phát nhạc"); this.updateTimerText(); }
            }
        }, 1000);
    }

    updateTimerText() {
        const settingsStatus = document.getElementById('settings-timer-status');
        if (this.state.sleepTimeLeft > 0) {
            const m = Math.ceil(this.state.sleepTimeLeft / 60);
            if(this.elements.timerMenuText) this.elements.timerMenuText.innerText = `Còn ${m} phút`;
            if (settingsStatus) { settingsStatus.innerText = `${m} phút`; settingsStatus.className = "status-indicator status-warning"; }
        } else {
            if(this.elements.timerMenuText) this.elements.timerMenuText.innerText = "Hẹn giờ tắt";
            if (settingsStatus) { settingsStatus.innerText = "Tắt"; settingsStatus.className = "status-indicator status-inactive"; }
        }
    }

    toggleSmartSleep() { this.state.smartSleepEnabled = !this.state.smartSleepEnabled; localStorage.setItem('smartSleepEnabled', this.state.smartSleepEnabled); }

    startSmartSleepFadeOut() {
        let steps = this.state.smartSleepFadeOutTime, startVol = this.state.volume, current = 0;
        const interval = setInterval(() => {
            current++; const newVol = Math.max(0, startVol * (1 - current / steps));
            this.setVolume(newVol, newVol <= 0);
            if (current >= steps || newVol <= 0) { clearInterval(interval); this.pause(); this.setVolume(startVol, false); }
        }, 1000);
    }

    toggleSpatialAudio() { this.state.spatialAudioEnabled = !this.state.spatialAudioEnabled; this.showToast(this.state.spatialAudioEnabled?'Bật âm thanh 3D':'Tắt âm thanh 3D'); }
    updateEqualizer() {}

    updateToggleStates() {
        const themeToggle = document.getElementById('theme-toggle-switch');
        if (themeToggle) themeToggle.classList.toggle('active', this.state.theme === 'dark');
    }

    openDownloadModal(idx) {
        this.state.downloadTargetIndex = idx; const song = this.state.playlist[idx];
        if(this.elements.dlTitle) this.elements.dlTitle.innerText = song.name;
        if(this.elements.dlModal) this.elements.dlModal.classList.add('show');
    }

    triggerDownload(type) {
        const song = this.state.playlist[this.state.downloadTargetIndex];
        let link = '', ext = '.mp3';
        if (type === 'audio') link = song.path;
        else if (type === 'beat') { link = song.instrumental; ext = ' (Beat).mp3'; }
        else if (type === 'video') { link = song.vid; ext = '.mp4'; }
        else if (type === 'lyric') { link = song.lyric; ext = '.lrc'; }

        if (!link || link.includes('ERROR') || link.includes('chưa có')) { this.showToast('File không khả dụng'); return; }
        const a = document.createElement('a'); a.href = link; a.download = `${song.name}${ext}`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        if(this.elements.dlModal) this.elements.dlModal.classList.remove('show');
    }

    seek(time) { if (!isNaN(time)) { this.video.currentTime = time; this.audio.currentTime = time; this.beatAudio.currentTime = time; } }

    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        }
    }

    setupPiP() {
        if (!('pictureInPictureEnabled' in document)) return;
        const btn = document.createElement('div'); btn.className = 'menu-item'; btn.style.display = 'none';
        btn.innerHTML = `<i class="fa-solid fa-clone"></i> <span>Picture-in-Picture</span>`;
        btn.onclick = async () => {
            try {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                else if (this.currentSongHasVideo) await this.video.requestPictureInPicture();
            } catch { this.showToast('Không mở được PiP'); }
        };
        if (this.elements.optionsMenu) this.elements.optionsMenu.appendChild(btn); this.elements.pipBtn = btn;
    }

    setupVideoFullscreen() {
        const container = document.querySelector('.video-container'); if (!container) return;
        const btn = document.createElement('div'); btn.className = 'btn-icon btn-fullscreen'; btn.innerHTML = '<i class="fa-solid fa-expand"></i>';
        btn.onclick = () => {
            if (!document.fullscreenElement) container.requestFullscreen().catch(() => {});
            else document.exitFullscreen();
        };
        container.appendChild(btn);
    }

    updatePiPButtonUI() { if (this.elements.pipBtn) this.elements.pipBtn.style.display = this.currentSongHasVideo ? 'flex' : 'none'; }

    setupTabSwipeGestures() {
        const stage = document.querySelector('.stage-view'); if (!stage) return;
        let startX = 0, tabs = ['song', 'video', 'lyrics'];
        stage.addEventListener('touchstart', (e) => startX = e.touches[0].clientX, { passive: true });
        stage.addEventListener('touchend', (e) => {
            const diff = startX - e.changedTouches[0].clientX;
            let idx = tabs.indexOf(this.state.currentMode);
            if (diff > 50 && idx < 2) this.switchTab(tabs[idx + 1]);
            else if (diff < -50 && idx > 0) this.switchTab(tabs[idx - 1]);
        });
    }

    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        document.querySelectorAll('.stage-view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
        this.state.currentMode = tab;
    }

    async loadLyrics(url) {
        const c = this.elements.lyricsContainer; c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Đang tải...</p>'; this.lyricsData = [];
        if (!url) { c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Không có lời bài hát</p>'; return; }
        try {
            const txt = await (await fetch(url)).text(); c.innerHTML = '<div style="height:40vh"></div>';
            txt.split('\n').forEach((line, i) => {
                const m = line.match(/^\[(\d{2}):(\d{2})(\.\d+)?\](.*)/);
                if (m && m[4].trim()) {
                    const t = parseInt(m[1])*60 + parseInt(m[2]) + (m[3]?parseFloat(m[3]):0);
                    this.lyricsData.push({ time: t, id: `l-${i}`, text: m[4].trim() });
                    const p = document.createElement('p'); p.className = 'lyric-row'; p.id = `l-${i}`; p.innerText = m[4].trim();
                    p.onclick = () => this.seek(t); c.appendChild(p);
                }
            });
            c.innerHTML += '<div style="height:40vh"></div>';
        } catch { c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Lỗi tải lời</p>'; }
    }

    syncLyrics(t) {
        if (!this.lyricsData.length) return;
        let id = null;
        for (let i = 0; i < this.lyricsData.length; i++) { if (this.lyricsData[i].time <= t) id = this.lyricsData[i].id; else break; }
        if (id) {
            const curr = this.elements.lyricsContainer.querySelector('.lyric-row.active'); 
            if (curr && curr.id !== id) { curr.classList.remove('active'); curr.style.color = ''; }
            const next = this.elements.lyricsContainer.querySelector('#' + id); 
            if (next && !next.classList.contains('active')) { 
                next.classList.add('active'); next.style.color = 'var(--primary)';
                next.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
            }
        }
    }

    checkMarquee() {
        const t = document.getElementById('full-title'), b = t ? t.closest('.marquee-wrapper') : null;
        if (t && b && t.scrollWidth > b.clientWidth && !t.getAttribute('d')) {
            t.parentElement.classList.add('animate'); t.innerHTML += ` &nbsp; • &nbsp; ${t.innerHTML}`; t.setAttribute('d', '1');
        }
    }

    switchNavigation(i) {
        this.state.currentNav = i; this.state.searchQuery = '';
        if (this.elements.searchInput) this.elements.searchInput.value = '';
        document.querySelectorAll('.nav-link').forEach((n, idx) => n.classList.toggle('active', idx === i));
        
        if (i === 1) this.renderExplore();
        else if (i === 3) this.renderSettings();
        else { this.state.currentFilter = i === 2 ? 'favorites' : 'all'; this.renderPlaylist(); }
    }

    setupEventListeners() {
        if (this.elements.scrollContainer) this.elements.scrollContainer.onscroll = () => this.onScroll();
        
        // Đồng bộ Master - Slave
        this.video.ontimeupdate = () => {
            if (this.currentSongHasVideo) {
                if (this.audio.currentTime !== this.video.currentTime) this.audio.currentTime = this.video.currentTime;
                if (this.state.isBeatMode && Math.abs(this.beatAudio.currentTime - this.video.currentTime) > 0.3) {
                    this.beatAudio.currentTime = this.video.currentTime;
                }
                this.checkPreload(this.video.currentTime, this.video.duration);
            }
        };
        this.audio.ontimeupdate = () => {
            if (!this.currentSongHasVideo && !this.state.isBeatMode) {
                this.syncLyrics(this.audio.currentTime); this.checkPreload(this.audio.currentTime, this.audio.duration);
            }
        };
        this.beatAudio.ontimeupdate = () => {
            if (!this.currentSongHasVideo && this.state.isBeatMode) {
                this.syncLyrics(this.beatAudio.currentTime); this.checkPreload(this.beatAudio.currentTime, this.beatAudio.duration);
            }
        };

        this.video.onended = () => this.next(); this.audio.onended = () => this.next(); this.beatAudio.onended = () => this.next();

        if (this.elements.seekBar) {
            this.elements.seekBar.oninput = (e) => {
                const master = this.currentSongHasVideo ? this.video : (this.state.isBeatMode ? this.beatAudio : this.audio);
                this.seek((e.target.value / 100) * master.duration);
            };
        }

        if (this.elements.searchInput) {
            this.elements.searchInput.oninput = (e) => { this.state.searchQuery = e.target.value; this.renderPlaylist(); };
        }

        if (this.elements.playBtnMain) this.elements.playBtnMain.onclick = () => this.togglePlay();
        if (this.elements.playBtnMini) this.elements.playBtnMini.onclick = (e) => { e.stopPropagation(); this.togglePlay(); };
        
        const nextBtn = document.getElementById('btn-next'); if(nextBtn) nextBtn.onclick = () => this.next();
        const prevBtn = document.getElementById('btn-prev'); if(prevBtn) prevBtn.onclick = () => this.prev();
        
        if (this.elements.mini) this.elements.mini.onclick = () => this.elements.overlay.classList.add('open');
        const closeBtn = document.getElementById('btn-close'); if(closeBtn) closeBtn.onclick = () => this.elements.overlay.classList.remove('open');
    }

    resetApp() { localStorage.clear(); this.showToast('Đã khôi phục cài đặt gốc'); setTimeout(() => location.reload(), 1000); }
}

// FIX LỖI 4: Khởi chạy Core khi cây DOM đã dựng xong, bọc an toàn tránh biến window.app trả về undefined
document.addEventListener("DOMContentLoaded", () => {
    window.app = new MusicPro();
});
