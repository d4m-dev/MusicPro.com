const TRACKS_URL = 'src/tracks.js';

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
        // 1. Thử tải từ Remote (GitHub) trước
        const res = await fetch(TRACKS_URL + '?v=' + Date.now(), { cache: 'no-cache' });
        if (res.ok) {
            const text = await res.text();
            const sandbox = {};
            const getter = new Function('window', `${text}; return window.TRACKS || [];`);
            return getter(sandbox) || [];
        }
    } catch (e) { console.log('Remote tracks failed, trying local...'); }

    try {
        // 2. Nếu lỗi, thử tải từ Local (src/tracks.js)
        const res = await fetch('../../src/tracks.js');
        if (res.ok) {
            const text = await res.text();
            const sandbox = {};
            const getter = new Function('window', `${text}; return window.TRACKS || [];`);
            return getter(sandbox) || [];
        }
    } catch (e) { console.error('Failed to load tracks:', e); }
    return [];
};

class MusicPro {
    constructor() {
        const savedVol = localStorage.getItem('volume');
        this.state = {
            playlist: [], currentIndex: 0, isPlaying: false, isShuffle: false, repeatMode: 0,
            currentMode: 'audio', volume: savedVol !== null ? parseFloat(savedVol) : 0.8, isMuted: false, 
            // Check for 'auto' theme setting and determine system preference if needed
            theme: this.getInitialTheme(),
            favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
            history: JSON.parse(localStorage.getItem('history') || '[]'),
            currentFilter: 'all', searchQuery: '', sortBy: 'id', currentNav: 0, isBeatMode: false,
            currentUserPlaylistIndex: -1,
            isPreloading: false, nextTrackData: null,
            sleepTimer: null, sleepTimeLeft: parseInt(localStorage.getItem('sleepTimeLeft') || '0'), sleepInterval: null, downloadTargetIndex: 0,
            // Customization settings
            customPrimaryColor: localStorage.getItem('customPrimaryColor') || null,
            fontFamily: localStorage.getItem('fontFamily') || 'Urbanist',
            fontWeight: localStorage.getItem('fontWeight') || '400',
            layoutMode: localStorage.getItem('layoutMode') || 'standard',
            // User playlists
            userPlaylists: JSON.parse(localStorage.getItem('userPlaylists') || '[]'),
            // Pro features
            isProUnlocked: localStorage.getItem('isProUnlocked') === 'true',
            smartSleepEnabled: localStorage.getItem('smartSleepEnabled') === 'true',
            smartSleepFadeOutTime: parseInt(localStorage.getItem('smartSleepFadeOutTime')) || 30 // 30 seconds default
        };
        this.playlistSlideshows = [];

        // Initialize spatial audio state
        this.state.spatialAudioEnabled = false;

        // Initialize equalizer state - DISABLED to prevent conflicts
        this.state.equalizerEnabled = false;

        // Initialize audio context for volume control and spatial audio
        this.audioContext = null;
        this.sourceNodes = { audio: null, video: null, beat: null };
        this.effectNodes = { gain: null, panner: null }; // Add panner for spatial audio
        this.isQueueVisible = false; // Trạng thái hiển thị danh sách trong full player

        // Apply saved customization settings on initialization
        if (this.state.customPrimaryColor) {
            document.documentElement.style.setProperty('--primary', this.state.customPrimaryColor);
            document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${this.state.customPrimaryColor} 0%, ${this.darkenColor(this.state.customPrimaryColor, 30)} 100%)`);

            // Apply color to all UI elements that should match the primary color
            this.applyColorToUIElements(this.state.customPrimaryColor);
        }

        if (this.state.fontFamily) {
            document.documentElement.style.setProperty('font-family', `${this.state.fontFamily}, sans-serif`);
            document.documentElement.style.setProperty('font-weight', this.state.fontWeight);
            
            // Load the selected font if it's not the default
            if (this.state.fontFamily !== 'Urbanist') {
                // Use a simple timeout to avoid blocking the initialization
                setTimeout(() => {
                    this.loadLocalFont(this.state.fontFamily);
                    // Apply font to all elements after loading
                    this.applyFontToAllElements(this.state.fontFamily, this.state.fontWeight);
                }, 0);
            } else {
                // Even for Urbanist, make sure it's applied to all elements
                setTimeout(() => {
                    this.applyFontToAllElements(this.state.fontFamily, this.state.fontWeight);
                }, 0);
            }
        }

        if (this.state.layoutMode) {
            document.body.classList.add(`layout-${this.state.layoutMode}`);
        }
        // Cấu hình Virtual Scroll
        this.virtual = { displayList: [], rowHeight: 85, itemsPerRow: 1, buffer: 4, isTicking: false, lastStartRow: -1, lastEndRow: -1 };
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
        this.audio.preload = "metadata"; // Changed to metadata to reduce initial load
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
        // if (this.video) this.video.crossOrigin = "anonymous";
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
        
        // Initialize Audio Context logic
        this.initAudioEffects();
        this.init();
    }

    // --- CORE INITIALIZATION & DATA MANAGEMENT ---
    async init() {
        this.applyTheme();
        
        // Inject Transition CSS
        const style = document.createElement('style');
        style.innerHTML = `
            #track-list { transition: opacity 0.2s ease-out, transform 0.2s ease-out; opacity: 1; transform: translateY(0); }
            .modal-content { scrollbar-width: none; -ms-overflow-style: none; }
            .modal-content::-webkit-scrollbar { display: none; }
            @media (max-width: 480px) { .modal-content { padding: 20px !important; width: 95% !important; } }
            
            /* Swipe Up UI Styles */
            .full-player-artwork-container { position: relative; overflow: hidden; width: 100%; height: 100%; border-radius: 20px; }
            #full-artwork { transition: opacity 0.1s linear; z-index: 2; position: relative; width: 100%; height: 100%; object-fit: cover; border-radius: 20px; }
            
            .swipe-hint-container {
                position: absolute; bottom: 30px; left: 0; width: 100%; 
                display: flex; justify-content: center;
                z-index: 3; pointer-events: none;
            }
            .swipe-hint-content {
                display: flex; flex-direction: column; align-items: center;
                padding: 8px 20px;
                background: rgba(127, 127, 127, 0.1);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border-radius: 30px;
                border: 1px solid rgba(255, 255, 255, 0.05);
                animation: swipeHintCycle 20s infinite;
                position: relative;
                overflow: hidden;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            }
            .swipe-hint-content::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, 
                    transparent 0%, 
                    rgba(255,255,255,0.8) 50%, 
                    transparent 100%);
                animation: shimmer 1.5s infinite;
                z-index: 1;
            }
            .swipe-hint-icon { 
                color: white; 
                font-size: 18px; 
                margin-bottom: 2px; 
                text-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.3);
            }
            .swipe-hint-text {
                font-size: 13px; 
                font-weight: 700; 
                text-transform: uppercase; 
                letter-spacing: 1px;
                color: white;
                text-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 8px rgba(255,255,255,0.3);
            }
            
            .context-queue-container {
                position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                background: var(--bg-surface);
                z-index: 1; border-radius: 20px; opacity: 0;
                display: flex; flex-direction: column;
                transition: opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            .queue-header { padding: 15px; font-weight: 700; font-size: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: center; }
            .queue-list { flex: 1; overflow-y: auto; padding: 10px; scrollbar-width: none; }
            .queue-list::-webkit-scrollbar { display: none; }
            .queue-item { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; margin-bottom: 5px; cursor: pointer; }
            .queue-item.active { background: var(--primary); color: white; }
            .queue-item:not(.active):hover { background: rgba(255,255,255,0.1); }
            .queue-item-info { flex: 1; overflow: hidden; }
            .queue-item-title { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .queue-item-artist { font-size: 12px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

            @keyframes swipeHintCycle {
                0% { opacity: 0; transform: translateY(30px); }
                30% { opacity: 0; transform: translateY(30px); }
                50% { opacity: 1; transform: translateY(0); }
                55% { transform: translateY(-5px); }
                60% { transform: translateY(0); }
                65% { transform: translateY(-5px); }
                70% { transform: translateY(0); }
                75% { transform: translateY(-5px); }
                80% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(30px); }
            }
            
            @keyframes shimmer {
                0% { left: -100%; opacity: 0; }
                10% { opacity: 1; }
                90% { opacity: 1; }
                100% { left: 100%; opacity: 0; }
            }
        `;
        document.head.appendChild(style);

        const rawTracks = await loadRemoteTracks();
        this.state.playlist = normalizeTracks(rawTracks);
        this.renderPlaylist();
        this.renderContextQueue(); // Update queue when playlist changes

        // Set initial volume using the new centralized method
        this.setVolume(this.state.volume, this.state.volume === 0);
        const volBar = document.getElementById('vol-bar');
        if (volBar) {
            // Đảm bảo thanh âm lượng có thuộc tính đúng để tính toán phần trăm
            if (!volBar.hasAttribute('max')) volBar.max = 1;
            if (!volBar.hasAttribute('step')) volBar.step = 0.01;
            this.updateRangeInput(volBar);
        }

        // Removed automatic playback restoration on app start
        // Keeping history and other saved data functionality

        // Inject Settings Nav Item
        const navContainer = document.querySelector('.bottom-nav');
        if (navContainer && navContainer.children.length === 3) {
             const btn = document.createElement('div');
             btn.className = 'nav-link';
             btn.innerHTML = '<i class="fa-solid fa-gear"></i><span>Cài đặt</span>';
             navContainer.appendChild(btn);
        }

        this.updateTimerText();
        // Initial UI State: Hide chips on Playlist page (index 0)
        const chips = document.querySelector('.chips-wrapper');
        if (chips) chips.style.display = 'none';

        document.getElementById('sort-controls').style.display = 'flex';
        setTimeout(() => { this.elements.loader.style.opacity = '0'; setTimeout(() => this.elements.loader.style.display = 'none', 500); }, 800);
        this.setupEventListeners();
        this.setupMediaSession();
        this.setupPiP();
        this.setupVideoFullscreen();
        this.setupTabSwipeGestures();

        // Initialize toggle switches
        this.updateToggleStates();
        // Initialize theme color
        this.updateThemeColor();
        // Initialize header avatar
        this.initializeHeaderAvatar();
        
        // Update range inputs to match theme after a short delay
        setTimeout(() => { this.updateAllRangeInputs(); }, 100);

        // --- UI CUSTOMIZATION FOR FULL PLAYER ---
        // 1. Add "+" button to the right of btn-heart (replacing options button position)
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

        // 2. Organize Options Menu
        const btnDl = document.getElementById('btn-dl');
        if (btnDl) btnDl.style.display = 'none';
        
        this.reorderOptionsMenu();

        // Initialize Swipe UI
        this.setupSwipeUI();
    }

    /**
     * Initialize header avatar with saved profile image
     */
    initializeHeaderAvatar() {
        // Load user profile data
        const userProfile = {
            name: localStorage.getItem('user_name') || '',
            email: localStorage.getItem('user_email') || '',
            avatar: localStorage.getItem('user_avatar') || 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png'
        };

        // Check if profile data is expired (3 days for avatar, 30 days for name/email)
        const now = Date.now();
        const avatarTimestamp = localStorage.getItem('user_avatar_timestamp');

        // Clear expired avatar data
        if (avatarTimestamp && (now - parseInt(avatarTimestamp)) > 3 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem('user_avatar');
            localStorage.removeItem('user_avatar_timestamp');
            userProfile.avatar = 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png';
        }

        // Update the header avatar
        this.updateHeaderAvatar(userProfile.avatar);
        
        // If theme is auto, ensure we're listening to system changes
        if (this.state.theme === 'auto') {
            this.ensureSystemThemeListener();
        }
    }

    /**
     * Get the initial theme based on localStorage or system preference
     */
    getInitialTheme() {
        const savedTheme = localStorage.getItem('theme');
        
        // If theme is set to 'auto', return 'auto' to indicate auto mode is active
        if (savedTheme === 'auto') {
            return 'auto';
        }
        
        // If no theme is saved, check HTML attribute
        if (!savedTheme) {
            const htmlElement = document.documentElement;
            const htmlTheme = htmlElement.getAttribute('data-theme');
            
            if (htmlTheme === 'auto') {
                // Use system preference
                return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            } else {
                // Use the theme from HTML attribute if not 'auto'
                return htmlTheme || 'light';
            }
        }
        
        return savedTheme;
    }

    /**
     * Áp dụng chủ đề (sáng/tối) cho ứng dụng.
     */
    applyTheme() {
        // If theme is set to 'auto', determine the system theme to apply
        let themeToApply = this.state.theme;
        if (this.state.theme === 'auto') {
            themeToApply = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', themeToApply);
        
        // Update range inputs to reflect theme changes
        this.updateAllRangeInputs();
    }
    
    toggleTheme() {
        // Cycle through theme options: auto -> dark -> light -> auto
        if (this.state.theme === 'auto') {
            this.state.theme = 'dark';
        } else if (this.state.theme === 'dark') {
            this.state.theme = 'light';
        } else {
            this.state.theme = 'auto';
        }
        
        localStorage.setItem('theme', this.state.theme);
        this.applyTheme();
        this.updateThemeColor();
        this.updateToggleStates();
        this.updateAllRangeInputs();
    }
    
    /**
     * Set theme to auto mode (follow system preference)
     */
    setAutoTheme() {
        // Determine the current system theme preference
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        
        // Set theme to auto in localStorage
        localStorage.setItem('theme', 'auto');
        
        // Update state to reflect the system theme that will be used
        this.state.theme = systemTheme;
        
        // Apply the theme
        this.applyTheme();
        this.updateThemeColor();
        this.updateToggleStates();
        this.updateAllRangeInputs();
    }

    /**
     * Ensure system theme listener is active
     */
    ensureSystemThemeListener() {
        // This method ensures that the system theme listener is active
        // when the theme is set to auto
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        // Update theme based on current system preference
        const newTheme = mediaQuery.matches ? 'dark' : 'light';
        if (this.state.theme !== newTheme) {
            this.state.theme = newTheme;
            this.applyTheme();
            this.updateThemeColor();
            this.updateToggleStates();
            this.updateAllRangeInputs();
        }
    }

    /**
     * Cập nhật màu sắc theme cho thanh địa chỉ trình duyệt
     */
    updateThemeColor() {
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            if (this.state.theme === 'dark') {
                metaThemeColor.setAttribute('content', '#000000');
            } else {
                metaThemeColor.setAttribute('content', '#f0f2f5');
            }
        }
        
        // Update range inputs to reflect theme changes
        this.updateAllRangeInputs();
    }

    /**
     * Setup Swipe Up UI and Logic
     */
    setupSwipeUI() {
        const artwork = document.getElementById('full-artwork');
        if (!artwork || !artwork.parentElement) return;

        // Wrap artwork if not already wrapped correctly
        let container = artwork.parentElement;
        if (!container.classList.contains('full-player-artwork-container')) {
            container = document.createElement('div');
            container.className = 'full-player-artwork-container';
            artwork.parentNode.insertBefore(container, artwork);
            container.appendChild(artwork);
        }

        // Add Swipe Hint
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

        // Add Context Queue Container (Hidden behind artwork initially)
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

    /**
     * Handle Swipe Gestures
     */
    setupSwipeGestures(container, artwork, queue, hint) {
        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        const onTouchStart = (e) => {
            // Only allow swipe if not scrolling the queue list
            if (this.isQueueVisible && this.elements.queueList.scrollTop > 0) return;
            
            startY = e.touches[0].clientY;
            isDragging = true;
            artwork.style.transition = 'none';
            queue.style.transition = 'none';
            hint.style.transition = 'none';
        };

        const onTouchMove = (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;
            const height = container.offsetHeight;

            // Logic: Swipe Up (deltaY < 0) to show queue, Swipe Down (deltaY > 0) to hide queue
            let progress = 0;
            const sensitivity = 0.6; // Higher = Slower/More distance required (0.6 = 60% of height)

            if (!this.isQueueVisible) {
                // Dragging UP to show queue
                if (deltaY < 0) {
                    progress = Math.min(1, Math.abs(deltaY) / (height * sensitivity)); 
                    artwork.style.opacity = 1 - progress;
                    queue.style.opacity = progress;
                    hint.style.opacity = 1 - progress;
                }
            } else {
                // Dragging DOWN to hide queue
                if (deltaY > 0) {
                    progress = Math.min(1, deltaY / (height * sensitivity));
                    artwork.style.opacity = progress;
                    queue.style.opacity = 1 - progress;
                    hint.style.opacity = progress;
                }
            }
        };

        const onTouchEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            artwork.style.transition = 'opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
            queue.style.transition = 'opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
            hint.style.transition = 'opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1)';

            const deltaY = currentY - startY;
            const threshold = 80; // Increased threshold for "slower" feel

            if (!this.isQueueVisible) {
                if (deltaY < -threshold) {
                    // Swiped Up enough -> Show Queue
                    this.isQueueVisible = true;
                    artwork.style.opacity = 0;
                    queue.style.opacity = 1;
                    hint.style.opacity = 0;
                    artwork.style.pointerEvents = 'none'; // Let clicks pass to queue
                    queue.style.zIndex = 4; // Bring to front
                } else {
                    // Reset
                    artwork.style.opacity = 1;
                    queue.style.opacity = 0;
                    hint.style.opacity = 1;
                }
            } else {
                if (deltaY > threshold) {
                    // Swiped Down enough -> Hide Queue
                    this.isQueueVisible = false;
                    artwork.style.opacity = 1;
                    queue.style.opacity = 0;
                    hint.style.opacity = 1;
                    artwork.style.pointerEvents = 'auto';
                    queue.style.zIndex = 1; // Send to back
                } else {
                    // Keep Queue Open
                    artwork.style.opacity = 0;
                    queue.style.opacity = 1;
                    hint.style.opacity = 0;
                }
            }
        };

        container.addEventListener('touchstart', onTouchStart, { passive: true });
        container.addEventListener('touchmove', onTouchMove, { passive: true });
        container.addEventListener('touchend', onTouchEnd);
    }
    
    /**
     * Centralized function to set volume and mute state.
     * Controls Web Audio API GainNode if available, otherwise falls back to element volume.
     */
    setVolume(volume, isMuted = false) {
        this.state.volume = volume;
        this.state.isMuted = isMuted;
        const finalVolume = isMuted ? 0 : volume;

        // Direct volume control (Web Audio API disabled to prevent issues)
        this.audio.volume = finalVolume;
        if (this.video) this.video.volume = finalVolume;
        this.beatAudio.volume = finalVolume;

        // Update UI
        const volBar = document.getElementById('vol-bar');
        if (volBar) {
            volBar.value = finalVolume;
            this.updateRangeInput(volBar);
        }
        this.updateMuteUI();
        localStorage.setItem('volume', this.state.volume);
    }

    /**
     * Helper to consistently style a range input's track.
     */
    updateRangeInput(element) {
        if (!element) return;
        const min = parseFloat(element.min) || 0;
        const max = parseFloat(element.max) || 100;
        const val = parseFloat(element.value) || 0;
        const percentage = ((val - min) / (max - min)) * 100;
        
        // Use actual computed color value for consistency
        const color = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2962ff';
        
        // Reset background-size để gradient hiển thị đầy đủ (sửa lỗi xung đột với logic cũ)
        element.style.backgroundSize = '100% 100%';
        element.style.backgroundImage = `linear-gradient(to right, ${color} 0%, ${color} ${percentage}%, var(--range-bg) ${percentage}%, var(--range-bg) 100%)`;
    }

    updateAllRangeInputs() {
        const ranges = document.querySelectorAll('input[type="range"]');
        ranges.forEach(range => this.updateRangeInput(range));

        // Update mini player progress with current theme color
        const miniFill = document.getElementById('mini-fill');
        if (miniFill) {
            const currentColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#2962ff';
            miniFill.style.backgroundColor = currentColor;
        }
    }

    /**
     * Reorder items in the options menu
     */
    reorderOptionsMenu() {
        const menu = this.elements.optionsMenu;
        if (!menu) return;

        // 1. Sleep Timer
        if (this.elements.btnOpenTimer) menu.appendChild(this.elements.btnOpenTimer);
        
        // 2. Switch Beat
        if (this.elements.btnSwitchBeat) menu.appendChild(this.elements.btnSwitchBeat);
        
        // 3. PiP
        if (this.elements.pipBtn) menu.appendChild(this.elements.pipBtn);
        
        // 4. Download
        let dlItem = menu.querySelector('.menu-dl-item');
        if (!dlItem) {
            dlItem = document.createElement('div');
            dlItem.className = 'menu-item menu-dl-item';
            dlItem.innerHTML = '<i class="fa-solid fa-download"></i> <span>Tải xuống</span>';
            dlItem.onclick = () => { this.openDownloadModal(this.state.currentIndex); this.elements.optionsMenu.classList.remove('show'); };
        }
        menu.appendChild(dlItem);
    }

    /**
     * Show playlist manager modal
     */
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
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05);">Đóng</button>
                        <button id="btn-create-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Tạo mới</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Show the modal
        modal.classList.add('show');

        // Render playlists
        this.renderUserPlaylists();

        // Add event listeners
        const closeAndClear = () => {
            modal.classList.remove('show');
            if (this.playlistSlideshows) {
                this.playlistSlideshows.forEach(i => clearInterval(i));
                this.playlistSlideshows = [];
            }
        };

        modal.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.onclick = closeAndClear;
        });

        document.getElementById('btn-create-playlist').onclick = () => {
            closeAndClear();
            this.showCreatePlaylistModal();
        };

        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeAndClear();
            }
        };
    }

    /**
     * Render user playlists in the manager
     */
    renderUserPlaylists() {
        const playlistList = document.getElementById('playlist-list');
        if (!playlistList) return;

        // Clear existing intervals
        if (this.playlistSlideshows) {
            this.playlistSlideshows.forEach(i => clearInterval(i));
        }
        this.playlistSlideshows = [];

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

            playlistItem.onclick = () => {
                this.showPlaylistDetailModal(playlist, index);
            };

            playlistList.appendChild(playlistItem);
            
            if (playlist.tracks && playlist.tracks.length > 0) {
                this.startPlaylistSlideshow(`pl-thumb-${index}`, playlist.tracks);
            }
        });
    }

    /**
     * Start slideshow for playlist thumbnail
     */
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

    /**
     * Show create playlist modal
     */
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
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                        <button id="btn-save-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Tạo</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Show the modal
        modal.classList.add('show');

        // Add event listeners
        document.getElementById('btn-save-playlist').onclick = () => {
            const name = document.getElementById('playlist-name-input').value.trim();
            if (!name) {
                this.showToast('Vui lòng nhập tên danh sách phát');
                return;
            }

            this.createPlaylist(name, document.getElementById('playlist-desc-input').value.trim(), trackIndexToAdd);
            modal.classList.remove('show');
        };

        modal.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.onclick = () => modal.classList.remove('show');
        });

        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        };
    }

    /**
     * Create a new playlist
     */
    createPlaylist(name, description = '', trackIndexToAdd = null) {
        const newPlaylist = {
            id: Date.now(),
            name: name,
            description: description,
            tracks: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (trackIndexToAdd !== null && this.state.playlist[trackIndexToAdd]) {
            newPlaylist.tracks.push(String(this.state.playlist[trackIndexToAdd].id));
        }

        this.state.userPlaylists.push(newPlaylist);
        this.saveUserPlaylists();
        if (trackIndexToAdd !== null) {
            this.showToast(`Đã tạo "${name}" và thêm bài hát`);
        } else {
            this.showToast(`Đã tạo danh sách phát "${name}"`);
        }

        // Re-render if the playlist manager is open
        if (document.getElementById('playlist-manager-modal')?.classList.contains('show')) {
            this.renderUserPlaylists();
        }
    }

    /**
     * Save user playlists to localStorage
     */
    saveUserPlaylists() {
        localStorage.setItem('userPlaylists', JSON.stringify(this.state.userPlaylists));
    }

    /**
     * Show equalizer modal - DISABLED
     */
    showEqualizerModal() {
        // EQ feature is currently disabled
        this.showToast('Tính năng EQ đang phát triển...');
    }

    /**
     * Initialize equalizer values - REMOVED
     */
    initEqualizerValues() {
        // EQ feature removed
    }

    /**
     * Apply equalizer preset
     */
    applyEqPreset(preset) {
        // EQ feature removed
    }

    toggleEqualizer() {
        // EQ feature removed
        this.showToast('Tính năng EQ đang phát triển...');
    }

    /**
     * Initialize Audio Context and Graph
     */
    initAudioContext() {
        // Web Audio API disabled to prevent no-sound/CORS issues
        return;
    }

    /**
     * Get or create MediaElementSource for an element
     */
    getSourceNode(element) {
        if (!element) return null;
        const key = element === this.audio ? 'audio' : (element === this.video ? 'video' : 'beat');
        if (!this.sourceNodes[key]) {
            this.sourceNodes[key] = this.audioContext.createMediaElementSource(element);
        }
        return this.sourceNodes[key];
    }

    /**
     * Reconnect the audio graph for volume control
     */
    updateAudioGraph() {
        // Disabled
    }

    /**
     * Reset equalizer to default values - REMOVED
     */
    resetEqualizer() {
        // EQ feature removed
    }

    /**
     * Initialize audio context when needed
     */
    initializeAudioContext() {
        this.initAudioContext();
    }

    /**
     * Resume audio context to comply with autoplay policies
     */
    resumeAudioContext() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume()
                .then(() => {
                    console.log('Audio context resumed successfully');
                })
                .catch((err) => {
                    console.error('Failed to resume audio context:', err);
                });
        }
    }

    /**
     * Show playlist detail modal
     */
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
                            <button id="btn-play-playlist" style="width: 45px; height: 45px; border-radius: 50%; background: var(--primary); border: none; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
                                <i class="fa-solid fa-play"></i>
                            </button>
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
                        <button id="btn-edit-playlist" style="flex: 1; background: rgba(255,255,255,0.1); color: var(--text-main); padding: 12px; border-radius: 12px; font-weight: 600;">Chỉnh sửa</button>
                        <button id="btn-delete-playlist" style="flex: 1; background: #ff4757; color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Xóa</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelectorAll('.btn-close-modal').forEach(btn => {
                btn.onclick = () => modal.classList.remove('show');
            });
            
            modal.onclick = (e) => {
                if (e.target === modal) modal.classList.remove('show');
            };
        }

        // Update dynamic content
        document.getElementById('pl-detail-name').innerText = playlist.name;
        document.getElementById('pl-detail-count').innerText = `${playlist.tracks.length} bài hát`;

        // Show the modal
        modal.classList.add('show');

        // Render playlist tracks
        this.renderPlaylistTracks(playlist, index);

        // Add event listeners
        document.getElementById('btn-play-playlist').onclick = () => {
            this.playUserPlaylist(index);
            modal.classList.remove('show');
            document.getElementById('playlist-manager-modal')?.classList.remove('show');
        };

        document.getElementById('btn-edit-playlist').onclick = () => {
            this.showEditPlaylistModal(index);
        };

        document.getElementById('btn-delete-playlist').onclick = () => {
            if (confirm(`Bạn có chắc muốn xóa danh sách phát "${playlist.name}"?`)) {
                this.deletePlaylist(index);
                modal.classList.remove('show');
                document.getElementById('playlist-manager-modal')?.classList.remove('show');
            }
        };
    }

    /**
     * Show edit playlist modal
     */
    showEditPlaylistModal(index) {
        const playlist = this.state.userPlaylists[index];
        if (!playlist) return;

        let modal = document.getElementById('edit-playlist-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'edit-playlist-modal';
            modal.className = 'modal-overlay';
            modal.style.zIndex = '10001'; // Ensure it's above detail modal
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Chỉnh sửa danh sách</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 24px;">
                        <input type="text" id="edit-playlist-name" placeholder="Tên danh sách phát..." style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); margin-bottom: 15px;">
                        <textarea id="edit-playlist-desc" placeholder="Mô tả (không bắt buộc)..." style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); height: 80px; resize: none;"></textarea>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                        <button id="btn-update-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Lưu</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelectorAll('.btn-close-modal').forEach(btn => {
                btn.onclick = () => modal.classList.remove('show');
            });
            
            modal.onclick = (e) => {
                if (e.target === modal) modal.classList.remove('show');
            };
        }

        // Pre-fill data
        document.getElementById('edit-playlist-name').value = playlist.name;
        document.getElementById('edit-playlist-desc').value = playlist.description || '';

        // Show the modal
        modal.classList.add('show');

        // Add event listeners
        document.getElementById('btn-update-playlist').onclick = () => {
            const name = document.getElementById('edit-playlist-name').value.trim();
            const desc = document.getElementById('edit-playlist-desc').value.trim();
            
            if (!name) {
                this.showToast('Vui lòng nhập tên danh sách phát');
                return;
            }

            this.updatePlaylist(index, name, desc);
            modal.classList.remove('show');
        };
    }

    /**
     * Update existing playlist
     */
    updatePlaylist(index, name, description) {
        const playlist = this.state.userPlaylists[index];
        if (playlist) {
            playlist.name = name;
            playlist.description = description;
            playlist.updatedAt = new Date().toISOString();
            this.saveUserPlaylists();
            this.showToast('Đã cập nhật danh sách phát');
            
            // Update UI if detail modal is open
            const detailName = document.getElementById('pl-detail-name');
            if (detailName && document.getElementById('playlist-detail-modal')?.classList.contains('show')) {
                detailName.innerText = name;
            }
            
            // Update UI if manager is open
            if (document.getElementById('playlist-manager-modal')?.classList.contains('show')) {
                this.renderUserPlaylists();
            }
            
            // Update UI if playing this playlist
            if (this.state.currentFilter === 'user_playlist' && this.state.currentUserPlaylistIndex === index) {
                 document.querySelector('.list-header h2').innerText = name;
            }
        }
    }

    /**
     * Play all tracks in a user playlist
     */
    playUserPlaylist(index) {
        const playlist = this.state.userPlaylists[index];
        if (!playlist || !playlist.tracks.length) {
            this.showToast('Danh sách phát trống');
            return;
        }
        
        this.state.currentFilter = 'user_playlist';
        this.state.currentUserPlaylistIndex = index;
        
        // Switch to home tab
        this.switchNavigation(0);
        
        // Update UI
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        document.querySelector('.list-header h2').innerText = playlist.name;
        
        this.renderPlaylist();
        
        // Play first song
        const firstTrackId = playlist.tracks[0];
        const realIdx = this.state.playlist.findIndex(t => String(t.id) === String(firstTrackId));
        
        if (realIdx !== -1) {
            this.playIndex(realIdx);
            this.showToast(`Đang phát: ${playlist.name}`);
        }
    }

    /**
     * Render tracks in a playlist
     */
    renderPlaylistTracks(playlist, playlistIndex) {
        const tracksContainer = document.getElementById('playlist-tracks');
        if (!tracksContainer) return;

        if (playlist.tracks.length === 0) {
            tracksContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub);">Danh sách trống</div>';
            return;
        }

        tracksContainer.innerHTML = '';

        playlist.tracks.forEach((trackId, trackIndex) => {
            const track = this.state.playlist.find(t => t.id === parseInt(trackId));
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
                    <button class="btn-remove-track" data-playlist-index="${playlistIndex}" data-track-index="${trackIndex}" style="background: none; border: none; color: var(--text-sub); cursor: pointer;">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                `;

                trackItem.onclick = (e) => {
                    if (!e.target.closest('.btn-remove-track')) {
                        // Set context for user playlist
                        this.state.currentFilter = 'user_playlist';
                        this.state.currentUserPlaylistIndex = playlistIndex;
                        this.state.searchQuery = '';

                        // Play this track
                        const trackIndexInPlaylist = this.state.playlist.findIndex(t => t.id === track.id);
                        if (trackIndexInPlaylist !== -1) {
                            this.playIndex(trackIndexInPlaylist);
                        }
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

    /**
     * Add track to a playlist
     */
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

    /**
     * Remove track from a playlist
     */
    removeFromPlaylist(playlistIndex, trackIndex) {
        const playlist = this.state.userPlaylists[playlistIndex];
        playlist.tracks.splice(trackIndex, 1);
        playlist.updatedAt = new Date().toISOString();
        this.saveUserPlaylists();
        this.showToast('Đã xóa khỏi danh sách phát');

        // Re-render if the detail modal is open
        const detailModal = document.getElementById('playlist-detail-modal');
        if (detailModal?.classList.contains('show')) {
            this.renderPlaylistTracks(playlist, playlistIndex);
        }
    }

    /**
     * Delete a playlist
     */
    deletePlaylist(index) {
        this.state.userPlaylists.splice(index, 1);
        this.saveUserPlaylists();
        this.showToast('Đã xóa danh sách phát');

        // Re-render if the manager is open
        if (document.getElementById('playlist-manager-modal')?.classList.contains('show')) {
            this.renderUserPlaylists();
        }
    }

    /**
     * Show track context menu
     */
    showTrackContextMenu(trackIndex, event) {
        // Remove existing context menu if present
        const existingMenu = document.getElementById('track-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const track = this.state.playlist[trackIndex];
        const menu = document.createElement('div');
        menu.id = 'track-context-menu';
        menu.className = 'context-menu';
        menu.style.cssText = `
            position: fixed;
            background: var(--bg-surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: var(--shadow-lg);
            z-index: 1000;
            min-width: 200px;
            padding: 8px 0;
        `;

        // Position the menu near the click event
        const x = event.clientX || (event.touches && event.touches[0].clientX) || 0;
        const y = event.clientY || (event.touches && event.touches[0].clientY) || 0;

        // Check if menu would go off screen and adjust position
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const menuWidth = 200; // Approximate width
        const menuHeight = 200; // Approximate height

        let left = x;
        let top = y;

        if (x + menuWidth > screenWidth) left = screenWidth - menuWidth - 10;
        if (y + menuHeight > screenHeight) top = screenHeight - menuHeight - 10;

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        // Create menu items
        const menuItems = [
            {
                icon: 'fa-solid fa-list-music',
                label: 'Thêm vào danh sách phát',
                onClick: () => {
                    this.showAddToPlaylistModal(trackIndex);
                    menu.remove();
                }
            },
            {
                icon: 'fa-solid fa-heart',
                label: 'Yêu thích',
                onClick: () => {
                    this.toggleFavorite(trackIndex);
                    menu.remove();
                }
            },
            {
                icon: 'fa-solid fa-download',
                label: 'Tải về',
                onClick: () => {
                    this.openDownloadModal(trackIndex);
                    menu.remove();
                }
            }
        ];

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'menu-item';
            menuItem.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                cursor: pointer;
                transition: background 0.2s;
            `;
            menuItem.innerHTML = `<i class="${item.icon}"></i> <span>${item.label}</span>`;

            menuItem.onmouseenter = () => {
                menuItem.style.background = 'rgba(255,255,255,0.05)';
            };

            menuItem.onmouseleave = () => {
                menuItem.style.background = 'transparent';
            };

            menuItem.onclick = item.onClick;

            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);

        // Close menu when clicking elsewhere
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
                document.removeEventListener('touchstart', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
            document.addEventListener('touchstart', closeMenu);
        }, 10);
    }

    /**
     * Show add to playlist modal
     */
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
                    <div style="margin-bottom: 15px;">
                        <input type="text" id="playlist-search-input" placeholder="Tìm danh sách phát..." style="width: 100%; padding: 12px; border-radius: 12px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); font-size: 14px;">
                    </div>
                    <div id="playlist-options" style="flex: 1; overflow-y: auto; margin-bottom: 24px; min-height: 150px;"></div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                        <button id="btn-create-new-playlist" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Tạo mới</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Add search listener
            const searchInput = document.getElementById('playlist-search-input');
            if (searchInput) {
                searchInput.oninput = (e) => this.renderPlaylistOptions(trackIndex, e.target.value);
            }
        } else {
            // Update existing modal content with animation
            const container = document.getElementById('add-pl-track-container');
            if (container) {
                container.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                container.style.opacity = '0';
                container.style.transform = 'translateX(-10px)';
                
                setTimeout(() => {
                    document.getElementById('add-pl-track-img').src = track.artwork;
                    document.getElementById('add-pl-track-name').innerText = track.name;
                    document.getElementById('add-pl-track-artist').innerText = track.artist;
                    
                    container.style.opacity = '1';
                    container.style.transform = 'translateX(0)';
                }, 200);
            }
            
            // Reset search input
            const searchInput = document.getElementById('playlist-search-input');
            if (searchInput) {
                searchInput.value = '';
                searchInput.oninput = (e) => this.renderPlaylistOptions(trackIndex, e.target.value);
            }
        }

        // Show the modal
        modal.classList.add('show');

        // Clear slideshows when opening this modal to avoid conflicts/leaks
        if (this.playlistSlideshows) {
            this.playlistSlideshows.forEach(i => clearInterval(i));
            this.playlistSlideshows = [];
        }

        // Render playlist options
        this.renderPlaylistOptions(trackIndex);

        // Add event listeners
        document.getElementById('btn-create-new-playlist').onclick = () => {
            modal.classList.remove('show');
            this.showCreatePlaylistModal(trackIndex);
        };

        modal.querySelectorAll('.btn-close-modal').forEach(btn => btn.onclick = () => {
            modal.classList.remove('show');
            this.clearPlaylistSlideshows();
        });

        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
                this.clearPlaylistSlideshows();
            }
        };
    }

    clearPlaylistSlideshows() {
        if (this.playlistSlideshows) {
            this.playlistSlideshows.forEach(i => clearInterval(i));
            this.playlistSlideshows = [];
        }
    }

    /**
     * Render playlist options for adding a track
     */
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

            playlistItem.innerHTML = `
                ${iconHtml}
                <div class="settings-info">
                    <div class="settings-name">${playlist.name}</div>
                    <div class="settings-desc">${playlist.tracks.length} bài hát</div>
                </div>
                <div class="settings-action">
                    <span class="status-indicator status-info">${playlist.tracks.includes(String(this.state.playlist[trackIndex].id)) ? 'ĐÃ CÓ' : 'THÊM'}</span>
                </div>
            `;

            playlistItem.onclick = () => {
                this.addToPlaylist(this.state.playlist[trackIndex].id, index);
                // Update the status indicator
                const statusIndicator = playlistItem.querySelector('.status-indicator');
                if (statusIndicator) {
                    statusIndicator.textContent = 'ĐÃ THÊM';
                    statusIndicator.className = 'status-indicator status-success';
                }
            };

            container.appendChild(playlistItem);
            
            if (playlist.tracks && playlist.tracks.length > 0) {
                this.startPlaylistSlideshow(`pl-opt-thumb-${index}`, playlist.tracks);
            }
        });

        if (!hasResults) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-sub);">Không tìm thấy kết quả</div>';
        }
    }

    /**
     * Lọc và sắp xếp danh sách bài hát dựa trên trạng thái hiện tại (filter, search, sort).
     */
    getDisplayPlaylist() {
        let display = [...this.state.playlist];
        
        if (this.state.currentFilter === 'user_playlist') {
            const playlist = this.state.userPlaylists[this.state.currentUserPlaylistIndex];
            if (playlist) {
                // Map tracks in the order of the playlist
                const trackMap = new Map(display.map(t => [String(t.id), t]));
                display = playlist.tracks.map(id => trackMap.get(String(id))).filter(t => t);
            } else {
                display = [];
            }
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
             // For user playlist/history, allow name sort, but default to list order
             if (this.state.sortBy === 'name') display.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        }
        return display;
    }

    // --- UI RENDERING & UPDATES ---
    /**
     * Render (hoặc cập nhật) danh sách bài hát hiển thị trên giao diện chính. */
    // --- VIRTUAL SCROLLING IMPLEMENTATION ---
    renderPlaylist() {
        this.virtual.displayList = this.getDisplayPlaylist();
        if (this.state.currentNav === 1 || this.state.currentNav === 3) return; // Không render playlist ảo ở trang Khám phá & Cài đặt
        this.elements.clearSearchBtn.style.display = this.state.searchQuery ? 'flex' : 'none';
        
        // Reset scroll container style
        this.elements.list.style.height = 'auto';
        this.elements.list.style.paddingTop = '0px';
        this.elements.list.style.paddingBottom = '0px';
        
        // Reset virtual scroll state to force render
        this.virtual.lastStartRow = -1;
        this.virtual.lastEndRow = -1;

        if (!this.virtual.displayList.length) { 
            this.elements.list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sub)">Không tìm thấy bài hát</div>`; 
            return; 
        }

        // Tính toán kích thước và render chunk đầu tiên
        this.updateVirtualMetrics();
        this.renderVirtualChunk();
    }

    updateVirtualMetrics() {
        const width = window.innerWidth;
        const isDesktop = width >= 1024;
        // Desktop: Grid layout (~124px height + gap), Mobile: List layout (~85px height)
        this.virtual.rowHeight = isDesktop ? 124 : 85;
        
        if (isDesktop) {
            this.virtual.itemsPerRow = 3;
        } else {
            this.virtual.itemsPerRow = 1;
        }
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

    renderVirtualChunk() {
        const { displayList, rowHeight, itemsPerRow, buffer } = this.virtual;
        const totalItems = displayList.length;
        const scrollTop = this.elements.scrollContainer.scrollTop;
        const viewportHeight = this.elements.scrollContainer.clientHeight;

        const totalRows = Math.ceil(totalItems / itemsPerRow);
        const startRow = Math.floor(scrollTop / rowHeight);
        const visibleRows = Math.ceil(viewportHeight / rowHeight);
        
        // Xác định vùng render với buffer
        const renderStartRow = Math.max(0, startRow - buffer);
        const renderEndRow = Math.min(totalRows, startRow + visibleRows + buffer);

        // Optimization: Only render if range changed
        if (this.virtual.lastStartRow === renderStartRow && this.virtual.lastEndRow === renderEndRow) return;
        this.virtual.lastStartRow = renderStartRow;
        this.virtual.lastEndRow = renderEndRow;

        const startIndex = renderStartRow * itemsPerRow;
        const endIndex = Math.min(totalItems, renderEndRow * itemsPerRow);

        // Cập nhật padding để giả lập chiều cao scroll
        this.elements.list.style.paddingTop = `${renderStartRow * rowHeight}px`;
        this.elements.list.style.paddingBottom = `${(totalRows - renderEndRow) * rowHeight}px`;

        // Render các items trong vùng nhìn thấy
        this.elements.list.innerHTML = '';
        const frag = document.createDocumentFragment();
        let isLongPress = false;
        
        for (let i = startIndex; i < endIndex; i++) {
            const track = displayList[i];
            // Tìm index gốc trong playlist chính để xử lý sự kiện click
            const realIdx = this.state.playlist.findIndex(t => t.id === track.id);
            
            const item = document.createElement('div');
            item.className = 'track-item';
            if (realIdx === this.state.currentIndex) item.classList.add('active');
            
            const isFav = this.state.favorites.includes(String(track.id));
            item.innerHTML = `<div class="track-thumb"><img src="${track.artwork}" loading="lazy"><div class="wave-anim"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div><div class="track-info"><div class="track-title">${track.name}</div><div class="track-artist">${track.artist}</div></div><div style="display:flex;gap:5px"><button class="btn-icon btn-favorite-sm ${isFav?'active':''}" onclick="event.stopPropagation();app.toggleFavorite(${realIdx})"><i class="fa-${isFav?'solid':'regular'} fa-heart"></i></button><button class="btn-icon btn-download-sm" onclick="event.stopPropagation();app.openDownloadModal(${realIdx})"><i class="fa-solid fa-download"></i></button><button class="btn-icon btn-more-sm" onclick="event.stopPropagation();app.showTrackContextMenu(${realIdx}, event)"><i class="fa-solid fa-ellipsis"></i></button></div>`;
            item.onclick = (e) => { 
                if (isLongPress) { isLongPress = false; return; }
                if (!e.target.closest('.btn-download-sm') && !e.target.closest('.btn-favorite-sm') && !e.target.closest('.btn-more-sm')) this.playIndex(realIdx); 
            };

            // Add context menu for right-click or long press
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showTrackContextMenu(realIdx, e);
            });

            // Touch hold for mobile
            let touchStartTime;
            item.addEventListener('touchstart', (e) => {
                touchStartTime = new Date().getTime();
            });

            item.addEventListener('touchend', (e) => {
                const touchDuration = new Date().getTime() - touchStartTime;
                if (touchDuration > 500) { // Long press (>500ms)
                    e.preventDefault();
                    isLongPress = true;
                    this.showTrackContextMenu(realIdx, e);
                }
            });
            frag.appendChild(item);
        }
        this.elements.list.appendChild(frag);
    }

    /**
     * Render the Context Queue (Swipe Up List)
     */
    renderContextQueue() {
        if (!this.elements.queueList) return;
        
        const displayList = this.getDisplayPlaylist();
        this.elements.queueList.innerHTML = '';

        if (displayList.length === 0) {
            this.elements.queueList.innerHTML = '<div style="text-align:center; padding:20px; color:rgba(255,255,255,0.5)">Danh sách trống</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        displayList.forEach((track, index) => {
            // Find real index in main playlist
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

    /**
     * Render giao diện trang Khám phá (Lịch sử & Tính năng mới).
     */
    renderExplore() {
        this.elements.list.innerHTML = '';
        this.elements.list.style.height = 'auto';
        this.elements.list.style.paddingTop = '0px';
        this.elements.list.style.paddingBottom = '200px';

        // Nếu có truy vấn tìm kiếm, hiển thị kết quả tìm kiếm như trang chủ
        const q = this.state.searchQuery.toLowerCase().trim();
        if (q) {
            // Hiển thị kết quả tìm kiếm như trang chủ
            this.renderPlaylist();
            return;
        }

        const container = document.createElement('div');
        container.className = 'explore-container';

        const createSection = (title, ids, emptyMsg, filterType = null) => {
            const section = document.createElement('div');
            section.className = 'explore-section';

            // Header: Title + Xem tất cả
            const header = document.createElement('div');
            header.className = 'section-header';
            header.innerHTML = `<div class="explore-title">${title}</div>`;

            if (ids && ids.length > 0 && filterType) {
                const btn = document.createElement('div');
                btn.className = 'btn-see-all';
                btn.innerText = 'Xem tất cả';
                btn.onclick = () => {
                    // Chuyển tab về Trang chủ và filter
                    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));
                    document.querySelectorAll('.nav-link')[0].classList.add('active');
                    this.state.currentNav = 0;
                    this.state.currentFilter = filterType;

                    // Update UI Header & Chips thủ công vì switchNavigation reset filter
                    document.querySelector('.list-header h2').innerText = 'Danh sách phát';
                    document.getElementById('sort-controls').style.display = 'flex';
                    const chips = document.querySelector('.chips-wrapper');
                    if (chips) chips.style.display = 'flex';
                    document.querySelectorAll('.chip').forEach(c => {
                        c.classList.toggle('active', c.dataset.type === filterType);
                    });
                    this.renderPlaylist();
                };
                header.appendChild(btn);
            }
            section.appendChild(header);

            if (!ids || ids.length === 0) {
                if (emptyMsg) {
                    section.innerHTML += `<p style="color:var(--text-sub);font-size:14px;text-align:center;padding:20px">${emptyMsg}</p>`;
                    return section;
                }
                return null;
            }

            const grid = document.createElement('div');
            grid.className = 'explore-scroll-container'; // Sử dụng class scroll ngang
            ids.forEach(id => {
                const song = this.state.playlist.find(t => String(t.id) === String(id));
                if (song) {
                    const item = document.createElement('div');
                    item.className = 'history-item';
                    item.innerHTML = `<img src="${song.artwork}" class="history-img" loading="lazy"><div class="history-title">${song.name}</div><div class="history-artist">${song.artist}</div>`;
                    item.onclick = () => {
                        if (filterType) {
                            this.state.currentFilter = filterType;
                            this.state.searchQuery = '';
                        }
                        const idx = this.state.playlist.findIndex(t => t.id === song.id);
                        this.playIndex(idx);
                    };
                    grid.appendChild(item);
                }
            });
            section.appendChild(grid);
            return section;
        };

        container.appendChild(createSection('Nghe gần đây', this.state.history, 'Chưa có lịch sử nghe nhạc', 'history'));

        const remix = createSection('Nhạc Remix', window.PLAYLIST_REMIX || [], 'Danh sách đang cập nhật', 'remix');
        if (remix) container.appendChild(remix);

        const tet = createSection('Nhạc Tết', window.PLAYLIST_TET || [], 'Danh sách đang cập nhật', 'tet');
        if (tet) container.appendChild(tet);

        const lofi = createSection('Nhạc Lofi', window.PLAYLIST_LOFI || [], 'Danh sách đang cập nhật', 'lofi');
        if (lofi) container.appendChild(lofi);

        this.elements.list.appendChild(container);
    }

    /**
     * Render giao diện trang Cài đặt.
     */
    renderSettings() {
        this.elements.list.innerHTML = '';
        this.elements.list.style.height = 'auto';
        this.elements.list.style.paddingTop = '0px';
        this.elements.list.style.paddingBottom = '200px';
        this.elements.clearSearchBtn.style.display = this.state.searchQuery ? 'flex' : 'none';

        const container = document.createElement('div');
        container.className = 'settings-container';

        const createSection = (title, items) => {
            const section = document.createElement('div');
            section.className = 'settings-section';
            section.innerHTML = `<div class="settings-title">${title}</div>`;
            items.forEach(item => {
                const row = document.createElement('div');
                row.className = 'settings-item';
                if (item.onClick) row.onclick = item.onClick;
                row.innerHTML = `
                    <div class="settings-icon"><i class="${item.icon}"></i></div>
                    <div class="settings-info">
                        <div class="settings-name">${item.name}</div>
                        <div class="settings-desc">${item.desc || ''}</div>
                    </div>
                    ${item.action ? `<div class="settings-action">${item.action}</div>` : ''}
                `;
                section.appendChild(row);
            });
            return section;
        };

        // Load user profile data
        const userProfile = {
            name: localStorage.getItem('user_name') || '',
            email: localStorage.getItem('user_email') || '',
            avatar: localStorage.getItem('user_avatar') || 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png'
        };

        // Check if profile data is expired (3 days for avatar, 30 days for name/email)
        const now = Date.now();
        const nameTimestamp = localStorage.getItem('user_name_timestamp');
        const emailTimestamp = localStorage.getItem('user_email_timestamp');
        const avatarTimestamp = localStorage.getItem('user_avatar_timestamp');

        // Clear expired data
        if (nameTimestamp && (now - parseInt(nameTimestamp)) > 30 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem('user_name');
            localStorage.removeItem('user_name_timestamp');
            userProfile.name = '';
        }

        if (emailTimestamp && (now - parseInt(emailTimestamp)) > 30 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem('user_email');
            localStorage.removeItem('user_email_timestamp');
            userProfile.email = '';
        }

        if (avatarTimestamp && (now - parseInt(avatarTimestamp)) > 3 * 24 * 60 * 60 * 1000) {
            localStorage.removeItem('user_avatar');
            localStorage.removeItem('user_avatar_timestamp');
            userProfile.avatar = 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png';
        }

        const profileItems = [
            {
                name: userProfile.name || 'Chưa đặt tên',
                desc: userProfile.email || 'Chưa có email',
                icon: 'fa-solid fa-user',
                onClick: () => {
                    // Show profile edit modal
                    this.showProfileEditModal(userProfile);
                }
            }
        ];

        const appearanceItems = [
            {
                name: 'Chủ đề',
                desc: this.state.theme === 'auto' 
                    ? 'Tự động theo cài đặt hệ thống' 
                    : (this.state.theme === 'dark' ? 'Hiện đang dùng giao diện tối' : 'Hiện đang dùng giao diện sáng'),
                icon: this.state.theme === 'auto' 
                    ? 'fa-solid fa-laptop' 
                    : (this.state.theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun'),
                action: `<span class="status-indicator status-${this.state.theme === 'auto' ? 'info' : (this.state.theme === 'dark' ? 'active' : 'inactive')}">${this.state.theme === 'auto' ? 'TỰ ĐỘNG' : (this.state.theme === 'dark' ? 'TỐI' : 'SÁNG')}</span>`,
                onClick: () => {
                    // Cycle through theme options: auto -> dark -> light -> auto
                    if (this.state.theme === 'auto') {
                        this.state.theme = 'dark';
                    } else if (this.state.theme === 'dark') {
                        this.state.theme = 'light';
                    } else {
                        this.state.theme = 'auto';
                    }
                    
                    localStorage.setItem('theme', this.state.theme);
                    
                    this.applyTheme();
                    this.updateThemeColor();
                    this.updateToggleStates();
                    this.updateAllRangeInputs();
                    
                    // Re-render settings to update the theme item
                    this.renderSettings();
                }
            },
            {
                name: 'Màu chủ đạo',
                desc: 'Tùy chỉnh màu sắc chính của ứng dụng',
                icon: 'fa-solid fa-palette',
                action: `<span class="status-indicator status-${this.state.customPrimaryColor ? 'active' : 'inactive'}">${this.state.customPrimaryColor ? 'TÙY CHỈNH' : 'MẶC ĐỊNH'}</span>`,
                onClick: () => {
                    this.showColorPickerModal();
                }
            },
            {
                name: 'Phông chữ',
                desc: 'Chọn kiểu chữ cho giao diện',
                icon: 'fa-solid fa-font',
                action: `<span class="status-indicator status-info">${this.getFontDisplayName(this.state.fontFamily)}</span>`,
                onClick: () => {
                    this.showFontSelectorModal();
                }
            },
            {
                name: 'Bố cục',
                desc: 'Tùy chỉnh cách bố trí giao diện',
                icon: 'fa-solid fa-table-cells',
                action: `<span class="status-indicator status-info">${this.getLayoutDisplayName(this.state.layoutMode)}</span>`,
                onClick: () => {
                    this.showLayoutSelectorModal();
                }
            }
        ];

        const playlistItems = [
            {
                name: 'Danh sách phát cá nhân',
                desc: `Quản lý ${this.state.userPlaylists?.length || 0} danh sách`,
                icon: 'fa-solid fa-music',
                action: `<span class="status-indicator status-info">${this.state.userPlaylists?.length || 0}</span>`,
                onClick: () => {
                    this.showPlaylistManager();
                }
            },
            {
                name: 'Tạo danh sách mới',
                desc: 'Tạo playlist cá nhân mới',
                icon: 'fa-solid fa-plus',
                onClick: () => {
                    this.showCreatePlaylistModal();
                }
            }
        ];

        const featureItems = [
            {
                name: 'Hẹn giờ tắt nhạc',
                desc: 'Tự động dừng phát sau một khoảng thời gian',
                icon: 'fa-solid fa-clock',
                action: `<span id="settings-timer-status" class="status-indicator ${this.state.sleepTimeLeft > 0 ? 'status-warning' : 'status-inactive'}">${this.state.sleepTimeLeft > 0 ? `${Math.ceil(this.state.sleepTimeLeft / 60)} phút` : 'Tắt'}</span>`,
                onClick: () => { this.elements.timerModal.classList.add('show'); }
            },
            {
                name: 'Chế độ ngủ thông minh',
                desc: 'Tự động giảm âm lượng dần trước khi tắt',
                icon: 'fa-solid fa-moon',
                action: `<span class="status-indicator ${this.state.smartSleepEnabled ? 'status-active' : 'status-inactive'}">${this.state.smartSleepEnabled ? 'BẬT' : 'TẮT'}</span>`,
                onClick: () => {
                    this.toggleSmartSleep();
                    this.renderSettings();
                }
            },
            { name: 'Chất lượng âm thanh', desc: 'Tùy chỉnh chất lượng phát', icon: 'fa-solid fa-music', action: '<span class="status-indicator status-info">CAO CẤP</span>' },
            { name: 'Âm thanh 3D & EQ', desc: 'Điều chỉnh hiệu ứng âm thanh nâng cao', icon: 'fa-solid fa-sliders', onClick: () => {
                this.checkProAccess(() => {
                    // Show the audio controls modal directly if unlocked
                    document.getElementById('audio-controls-modal').classList.add('show');
                });
            }}
        ];

        const securityItems = [
            { name: 'Tài khoản', desc: 'Đồng bộ dữ liệu đám mây', icon: 'fa-solid fa-user', action: '<span class="status-indicator status-syncing">ĐÃ ĐN</span>' }
        ];

        const generalItems = [
            {
                name: 'Cài đặt gốc',
                desc: 'Xóa toàn bộ dữ liệu và đặt lại ứng dụng',
                icon: 'fa-solid fa-rotate-right',
                action: '<span class="status-indicator status-warning">CẢNH BÁO</span>',
                onClick: () => {
                    document.getElementById('reset-modal').classList.add('show');
                }
            }
        ];

        const q = this.state.searchQuery.toLowerCase().trim();
        const filter = (items) => !q ? items : items.filter(i => i.name.toLowerCase().includes(q) || (i.desc && i.desc.toLowerCase().includes(q)));

        const g = filter(generalItems);
        const a = filter(appearanceItems);
        const f = filter(featureItems);

        if (profileItems.length) container.appendChild(createSection('Thông tin cá nhân', profileItems));
        if (a.length) container.appendChild(createSection('Giao diện', a));
        if (playlistItems.length) container.appendChild(createSection('Danh sách phát', playlistItems));
        if (f.length) container.appendChild(createSection('Tính năng', f));
        if (securityItems.length) container.appendChild(createSection('Bảo mật', securityItems));
        if (g.length) container.appendChild(createSection('Chung', g));

        if (!profileItems.length && !a.length && !f.length && !securityItems.length && !g.length) {
             container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sub)">Không tìm thấy kết quả</div>`;
        }

        this.elements.list.appendChild(container);
    }

    /**
     * Hiển thị modal chỉnh sửa thông tin cá nhân
     */
    showProfileEditModal(profile) {
        // Create and show profile edit modal
        let modal = document.getElementById('profile-edit-modal');
        if (!modal) {
            // Create modal if it doesn't exist
            modal = document.createElement('div');
            modal.id = 'profile-edit-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Thông tin cá nhân</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 20px; text-align: center; color: var(--text-sub); font-size: 13px;">
                        <i class="fa-solid fa-circle-info"></i> Tên và email được lưu 30 ngày, ảnh đại diện 3 ngày
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 15px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 60px; height: 60px; border-radius: 50%; overflow: hidden; border: 2px solid var(--border);">
                                <img id="profile-avatar-preview" src="${profile.avatar}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.src='https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png'">
                            </div>
                            <div style="flex: 1;">
                                <input type="text" id="profile-name-input" placeholder="Tên của bạn" value="${profile.name}" style="width: 100%; padding: 10px; border-radius: 8px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid transparent; margin-bottom: 5px;">
                                <input type="email" id="profile-email-input" placeholder="Email của bạn" value="${profile.email}" style="width: 100%; padding: 10px; border-radius: 8px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid transparent;">
                            </div>
                        </div>
                        <div style="text-align: center;">
                            <input type="file" id="profile-avatar-upload" accept="image/*" style="display: none;">
                            <button id="btn-upload-avatar" style="background: var(--bg-secondary); color: var(--text-main); padding: 10px 15px; border-radius: 8px; border: 1px dashed var(--border); width: 100%; cursor: pointer;">
                                <i class="fa-solid fa-cloud-arrow-up"></i> Chọn ảnh đại diện
                            </button>
                        </div>
                        <div style="display: flex; gap: 12px; margin-top: 10px;">
                            <button class="btn-close-modal" id="btn-cancel-profile" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                            <button id="btn-save-profile" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Lưu</a>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            // Update existing modal with current profile data
            document.getElementById('profile-avatar-preview').src = profile.avatar;
            document.getElementById('profile-name-input').value = profile.name;
            document.getElementById('profile-email-input').value = profile.email;
        }

        // Show the modal
        modal.classList.add('show');

        // Add event listeners
        const btnCancel = document.getElementById('btn-cancel-profile');
        const btnSave = document.getElementById('btn-save-profile');
        const btnUpload = document.getElementById('btn-upload-avatar');
        const fileInput = document.getElementById('profile-avatar-upload');
        const avatarPreview = document.getElementById('profile-avatar-preview');

        modal.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.onclick = () => modal.classList.remove('show');
        });

        btnCancel.onclick = () => {
            modal.classList.remove('show');
        };

        btnUpload.onclick = () => {
            fileInput.click();
        };

        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    // Create a large cropping modal
                    this.showLargeCropModal(event.target.result);
                };
                reader.readAsDataURL(file);
            }
        };

        btnSave.onclick = () => {
            const newName = document.getElementById('profile-name-input').value.trim();
            const newEmail = document.getElementById('profile-email-input').value.trim();
            // Use the cropped image if available, otherwise use the original
            const newAvatar = this.croppedImageDataUrl || profile.avatar;

            // Validate inputs
            if (newEmail && !this.isValidEmail(newEmail)) {
                this.showToast('Email không hợp lệ');
                return;
            }

            // Save to localStorage with timestamps
            const now = Date.now();

            if (newName) {
                localStorage.setItem('user_name', newName);
                localStorage.setItem('user_name_timestamp', now.toString());
            } else {
                localStorage.removeItem('user_name');
                localStorage.removeItem('user_name_timestamp');
            }

            if (newEmail) {
                localStorage.setItem('user_email', newEmail);
                localStorage.setItem('user_email_timestamp', now.toString());
            } else {
                localStorage.removeItem('user_email');
                localStorage.removeItem('user_email_timestamp');
            }

            localStorage.setItem('user_avatar', newAvatar);
            localStorage.setItem('user_avatar_timestamp', now.toString());

            this.showToast('Lưu thông tin cá nhân thành công');
            modal.classList.remove('show');

            // Re-render settings to update the profile display
            this.renderSettings();

            // Update the header avatar
            this.updateHeaderAvatar(newAvatar);
        };

        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        };
    }

    /**
     * Kiểm tra tính hợp lệ của email
     */
    isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

    /**
     * Initialize image cropper functionality
     */
    initializeCropper(canvas, ctx, img) {
        const self = this;
        let isDragging = false;
        let dragType = null; // 'move' or 'resize'
        let startX, startY;
        let cropX = 0, cropY = 0;
        let cropSize = Math.min(canvas.width, canvas.height) * 0.8; // Start with 80% of smallest dimension

        // Ensure square crop
        if (cropSize > canvas.width) cropSize = canvas.width;
        if (cropSize > canvas.height) cropSize = canvas.height;

        // Center the crop area initially
        cropX = (canvas.width - cropSize) / 2;
        cropY = (canvas.height - cropSize) / 2;

        // Draw image with crop overlay
        function drawOverlay() {
            // Redraw the image
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Draw overlay (darkened area outside crop)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Clear the crop area
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillRect(cropX, cropY, cropSize, cropSize);
            ctx.globalCompositeOperation = 'source-over';

            // Draw crop border
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(cropX, cropY, cropSize, cropSize);

            // Draw resize handle
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(cropX + cropSize, cropY + cropSize, 8, 0, Math.PI * 2);
            ctx.fill();
        }

        // Mouse event handlers
        canvas.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Check if clicking on resize handle
            const handleX = cropX + cropSize;
            const handleY = cropY + cropSize;
            const distance = Math.sqrt(Math.pow(x - handleX, 2) + Math.pow(y - handleY, 2));

            if (distance <= 10) {
                isDragging = true;
                dragType = 'resize';
            } else if (x >= cropX && x <= cropX + cropSize && y >= cropY && y <= cropY + cropSize) {
                isDragging = true;
                dragType = 'move';
                startX = x - cropX;
                startY = y - cropY;
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (dragType === 'move') {
                cropX = x - startX;
                cropY = y - startY;

                // Keep crop within bounds
                cropX = Math.max(0, Math.min(canvas.width - cropSize, cropX));
                cropY = Math.max(0, Math.min(canvas.height - cropSize, cropY));
            } else if (dragType === 'resize') {
                let newSize = Math.max(30, x - cropX, y - cropY); // Minimum size of 30px

                // Keep crop within bounds
                if (cropX + newSize > canvas.width) newSize = canvas.width - cropX;
                if (cropY + newSize > canvas.height) newSize = canvas.height - cropY;

                cropSize = newSize;
            }

            // Update cropParams with current values
            self.cropParams.cropX = cropX;
            self.cropParams.cropY = cropY;
            self.cropParams.cropSize = cropSize;

            drawOverlay();
        });

        canvas.addEventListener('mouseup', () => {
            isDragging = false;
            dragType = null;
        });

        canvas.addEventListener('mouseleave', () => {
            isDragging = false;
            dragType = null;
        });

        // Touch events for mobile devices
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            // Check if clicking on resize handle
            const handleX = cropX + cropSize;
            const handleY = cropY + cropSize;
            const distance = Math.sqrt(Math.pow(x - handleX, 2) + Math.pow(y - handleY, 2));

            if (distance <= 10) {
                isDragging = true;
                dragType = 'resize';
            } else if (x >= cropX && x <= cropX + cropSize && y >= cropY && y <= cropY + cropSize) {
                isDragging = true;
                dragType = 'move';
                startX = x - cropX;
                startY = y - cropY;
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            if (dragType === 'move') {
                cropX = x - startX;
                cropY = y - startY;

                // Keep crop within bounds
                cropX = Math.max(0, Math.min(canvas.width - cropSize, cropX));
                cropY = Math.max(0, Math.min(canvas.height - cropSize, cropY));
            } else if (dragType === 'resize') {
                let newSize = Math.max(30, x - cropX, y - cropY); // Minimum size of 30px

                // Keep crop within bounds
                if (cropX + newSize > canvas.width) newSize = canvas.width - cropX;
                if (cropY + newSize > canvas.height) newSize = canvas.height - cropY;

                cropSize = newSize;
            }

            // Update cropParams with current values
            self.cropParams.cropX = cropX;
            self.cropParams.cropY = cropY;
            self.cropParams.cropSize = cropSize;

            drawOverlay();
        });

        canvas.addEventListener('touchend', () => {
            isDragging = false;
            dragType = null;
        });

        // Initial draw
        drawOverlay();

        // Store references for later use
        self.cropParams = { canvas, ctx, img, cropX, cropY, cropSize, drawOverlay };
    }

    /**
     * Get the cropped image as data URL
     */
    getCroppedImage() {
        if (!this.cropParams) return null;

        const { canvas, img, cropX, cropY, cropSize } = this.cropParams;

        // Create a new canvas for the cropped image
        const cropCanvas = document.createElement('canvas');
        const cropCtx = cropCanvas.getContext('2d');

        cropCanvas.width = cropSize;
        cropCanvas.height = cropSize;

        // Calculate the scale factor between original image and canvas
        const scaleX = img.naturalWidth / canvas.width;
        const scaleY = img.naturalHeight / canvas.height;

        // Draw the cropped portion
        cropCtx.drawImage(
            img,
            cropX * scaleX, // sx
            cropY * scaleY, // sy
            cropSize * scaleX, // sWidth
            cropSize * scaleY, // sHeight
            0, // dx
            0, // dy
            cropSize, // dWidth
            cropSize // dHeight
        );

        return cropCanvas.toDataURL('image/jpeg', 0.85);
    }

    /**
     * Show large cropping modal for image editing
     */
    showLargeCropModal(imageSrc) {
        let cropModal = document.getElementById('large-crop-modal');
        if (!cropModal) {
            cropModal = document.createElement('div');
            cropModal.id = 'large-crop-modal';
            cropModal.className = 'modal-overlay';
            cropModal.innerHTML = `
                <div class="modal-content" style="max-width: 90%; width: 90%; height: 80vh; display: flex; flex-direction: column; padding: 24px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Cắt ảnh đại diện</h3>
                        <button id="btn-close-crop" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <div id="crop-container-large" style="flex: 1; display: flex; align-items: center; justify-content: center; background: var(--bg-secondary); border-radius: 12px; overflow: hidden; position: relative;">
                            <img id="crop-image-large" src="${imageSrc}" style="display: none;">
                            <canvas id="crop-canvas-large" style="max-width: 100%; max-height: 100%; display: block; cursor: grab;"></canvas>
                            <div id="crop-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"></div>
                        </div>
                        <div style="display: flex; gap: 12px; margin-top: 15px;">
                            <button class="btn-close-modal" id="btn-cancel-crop" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                            <button id="btn-confirm-crop" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Xác nhận</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(cropModal);
        } else {
            document.getElementById('crop-image-large').src = imageSrc;
        }

        // Show the modal
        cropModal.classList.add('show');

        // Initialize the cropping functionality
        this.initializeLargeCropper(imageSrc);

        // Add event listeners
        document.getElementById('btn-close-crop').onclick = () => {
            cropModal.classList.remove('show');
        };

        document.getElementById('btn-cancel-crop').onclick = () => {
            cropModal.classList.remove('show');
        };

        document.getElementById('btn-confirm-crop').onclick = () => {
            const croppedImage = this.getCroppedImageLarge();
            if (croppedImage) {
                // Set the cropped image directly to the profile preview
                const profilePreview = document.getElementById('profile-avatar-preview');
                if (profilePreview) {
                    profilePreview.src = croppedImage;
                }

                // Store the cropped image
                this.croppedImageDataUrl = croppedImage;

                // Close the crop modal
                cropModal.classList.remove('show');

                // Show success message
                this.showToast('Đã cắt ảnh thành công');
            }
        };

        // Close modal when clicking outside
        cropModal.onclick = (e) => {
            if (e.target === cropModal) {
                cropModal.classList.remove('show');
            }
        };
    }

    /**
     * Initialize large cropper functionality using React-inspired approach
     */
    initializeLargeCropper(imageSrc) {
        const img = document.getElementById('crop-image-large');
        const self = this;

        // Initialize crop parameters
        self.zoom = 1;
        self.offset = { x: 0, y: 0 };
        self.dragging = false;
        self.dragStart = { x: 0, y: 0, ox: 0, oy: 0 };
        self.canvasSize = { w: 520, h: 520 };

        // Wait for image to load if needed
        if (img.complete) {
            setupCropper();
        } else {
            img.onload = setupCropper;
        }

        function setupCropper() {
            // Get container
            const container = document.getElementById('crop-container-large');
            const canvas = document.getElementById('crop-canvas-large');
            const overlay = document.getElementById('crop-overlay');

            // Set canvas size
            const containerRect = container.getBoundingClientRect();
            self.canvasSize = {
                w: Math.max(260, Math.round(containerRect.width * 0.9)),
                h: Math.max(260, Math.round(containerRect.height * 0.7))
            };
            canvas.width = self.canvasSize.w;
            canvas.height = self.canvasSize.h;

            // Add zoom controls to the modal
            const controlsDiv = document.createElement('div');
            controlsDiv.id = 'crop-controls';
            controlsDiv.style.cssText = `
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 15px;
                margin: 15px 0;
            `;

            const zoomLabel = document.createElement('label');
            zoomLabel.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                color: var(--text-main);
                font-size: 14px;
            `;
            zoomLabel.innerHTML = `
                <span>Phóng to:</span>
                <input type="range" min="1" max="3" step="0.05" value="${self.zoom}"
                       style="width: 150px; height: 5px; -webkit-appearance: none; background: var(--bg-secondary); border-radius: 10px; outline: none;">
            `;

            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Đặt lại';
            resetBtn.style.cssText = `
                background: var(--bg-secondary);
                color: var(--text-main);
                border: 1px solid var(--border);
                border-radius: 8px;
                padding: 8px 15px;
                cursor: pointer;
                font-size: 14px;
            `;

            controlsDiv.appendChild(zoomLabel);
            controlsDiv.appendChild(resetBtn);
            container.parentNode.insertBefore(controlsDiv, container.nextSibling);

            const zoomInput = zoomLabel.querySelector('input');
            zoomInput.oninput = (e) => {
                self.zoom = Number(e.target.value);
                drawCropOverlay();
            };

            resetBtn.onclick = () => {
                self.zoom = 1;
                self.offset = { x: 0, y: 0 };
                zoomInput.value = 1;
                drawCropOverlay();
            };

            // Draw the crop overlay
            function drawCropOverlay() {
                if (!img) return;

                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Calculate scale and offsets
                const baseScale = Math.max(canvas.width / img.width, canvas.height / img.height);
                const scale = baseScale * self.zoom;
                const maxOffsetX = Math.max(0, (img.width * scale - canvas.width) / 2);
                const maxOffsetY = Math.max(0, (img.height * scale - canvas.height) / 2);
                const offsetX = self.offset.x * maxOffsetX;
                const offsetY = self.offset.y * maxOffsetY;

                // Draw image
                const drawWidth = img.width * scale;
                const drawHeight = img.height * scale;
                const cx = canvas.width / 2 + offsetX;
                const cy = canvas.height / 2 + offsetY;

                ctx.drawImage(img, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);

                // Draw grid overlay
                ctx.strokeStyle = "rgba(255,255,255,0.4)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(canvas.width / 3, 0);
                ctx.lineTo(canvas.width / 3, canvas.height);
                ctx.moveTo((canvas.width / 3) * 2, 0);
                ctx.lineTo((canvas.width / 3) * 2, canvas.height);
                ctx.moveTo(0, canvas.height / 3);
                ctx.lineTo(canvas.width, canvas.height / 3);
                ctx.moveTo(0, (canvas.height / 3) * 2);
                ctx.lineTo(canvas.width, (canvas.height / 3) * 2);
                ctx.stroke();

                // Draw crop border
                ctx.strokeStyle = "rgba(0,0,0,0.25)";
                ctx.lineWidth = 1;
                ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
            }

            // Initial draw
            drawCropOverlay();

            // Helper function to clamp values
            function clamp(value, min, max) {
                return Math.min(max, Math.max(min, value));
            }

            // Get scale helper
            function getScale(canvasWidth, canvasHeight) {
                if (!img) return { scale: 1, maxOffsetX: 0, maxOffsetY: 0 };
                const baseScale = Math.max(canvasWidth / img.width, canvasHeight / img.height);
                const scale = baseScale * self.zoom;
                return {
                    scale,
                    maxOffsetX: Math.max(0, (img.width * scale - canvasWidth) / 2),
                    maxOffsetY: Math.max(0, (img.height * scale - canvasHeight) / 2)
                };
            }

            // Event handlers
            function handlePointerDown(e) {
                if (!img) return;
                const { maxOffsetX, maxOffsetY } = getScale(self.canvasSize.w, self.canvasSize.h);
                self.dragging = true;
                self.dragStart = {
                    x: e.clientX,
                    y: e.clientY,
                    ox: self.offset.x,
                    oy: self.offset.y,
                    maxX: maxOffsetX,
                    maxY: maxOffsetY
                };
            }

            function handlePointerMove(e) {
                if (!self.dragging || !img) return;
                const dx = e.clientX - self.dragStart.x;
                const dy = e.clientY - self.dragStart.y;
                const { maxOffsetX, maxOffsetY } = getScale(self.canvasSize.w, self.canvasSize.h);

                const nextX = maxOffsetX > 0 ? clamp(self.dragStart.ox + dx / maxOffsetX, -1, 1) : 0;
                const nextY = maxOffsetY > 0 ? clamp(self.dragStart.oy + dy / maxOffsetY, -1, 1) : 0;

                self.offset = { x: nextX, y: nextY };
                drawCropOverlay();
            }

            function handlePointerUp() {
                self.dragging = false;
            }

            // Add event listeners to canvas
            canvas.onmousedown = handlePointerDown;
            document.addEventListener('mousemove', handlePointerMove);
            document.addEventListener('mouseup', handlePointerUp);

            // Touch events
            canvas.addEventListener('touchstart', (e) => {
                if (!img) return;
                e.preventDefault();
                const touch = e.touches[0];
                const { maxOffsetX, maxOffsetY } = getScale(self.canvasSize.w, self.canvasSize.h);
                self.dragging = true;
                self.dragStart = {
                    x: touch.clientX,
                    y: touch.clientY,
                    ox: self.offset.x,
                    oy: self.offset.y,
                    maxX: maxOffsetX,
                    maxY: maxOffsetY
                };
            });

            document.addEventListener('touchmove', (e) => {
                if (!self.dragging || !img) return;
                e.preventDefault();
                const touch = e.touches[0];
                const dx = touch.clientX - self.dragStart.x;
                const dy = touch.clientY - self.dragStart.y;
                const { maxOffsetX, maxOffsetY } = getScale(self.canvasSize.w, self.canvasSize.h);

                const nextX = maxOffsetX > 0 ? clamp(self.dragStart.ox + dx / maxOffsetX, -1, 1) : 0;
                const nextY = maxOffsetY > 0 ? clamp(self.dragStart.oy + dy / maxOffsetY, -1, 1) : 0;

                self.offset = { x: nextX, y: nextY };
                drawCropOverlay();
            });

            document.addEventListener('touchend', () => {
                self.dragging = false;
            });
        }
    }

    /**
     * Zoom the image
     */
    zoomImage(factor) {
        if (this.cropScale) {
            this.cropScale = Math.max(0.1, Math.min(this.cropScale * factor, 5));
            this.drawCropOverlay && this.drawCropOverlay();
        }
    }

    /**
     * Set move mode
     */
    setMoveMode() {
        // This is handled by the mouse events already
        if (this.drawCropOverlay) {
            const canvas = document.getElementById('crop-canvas-large');
            if (canvas) {
                canvas.style.cursor = 'grab';
            }
        }
    }

    /**
     * Get the cropped image
     */
    getCroppedImageLarge() {
        const img = document.getElementById('crop-image-large');
        if (!img) return null;

        // Create a temporary canvas to draw the cropped image
        const cropCanvas = document.createElement('canvas');
        const cropCtx = cropCanvas.getContext('2d');

        // Set the output size (square for avatar)
        const outputWidth = 400;
        const outputHeight = 400;
        cropCanvas.width = outputWidth;
        cropCanvas.height = outputHeight;

        // Calculate the scale and offset for the output
        const baseScale = Math.max(outputWidth / img.width, outputHeight / img.height);
        const scale = baseScale * this.zoom;
        const maxOffsetX = Math.max(0, (img.width * scale - outputWidth) / 2);
        const maxOffsetY = Math.max(0, (img.height * scale - outputHeight) / 2);
        const offsetX = this.offset.x * maxOffsetX;
        const offsetY = this.offset.y * maxOffsetY;

        // Calculate the draw position to center the image
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const cx = outputWidth / 2 + offsetX;
        const cy = outputHeight / 2 + offsetY;

        // Draw the image onto the crop canvas
        cropCtx.drawImage(img, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);

        return cropCanvas.toDataURL('image/jpeg', 0.85);
    }

    /**
     * Update the header avatar with the new image
     */
    updateHeaderAvatar(imageUrl) {
        const headerAvatar = document.querySelector('.top-bar .avatar img');
        if (headerAvatar) {
            headerAvatar.src = imageUrl;
            headerAvatar.onerror = () => {
                // Fallback to default avatar if the custom one fails
                headerAvatar.src = 'https://github.com/d4m-dev/media/raw/main/ThuVienChinh/favicon/favicon-32x32.png';
            };
        }
    }

    /**
     * Show color picker modal for customizing primary color
     */
    showColorPickerModal() {
        let modal = document.getElementById('color-picker-modal');
        
        const colors = [
            '#2962ff', '#e91e63', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4', // Basic
            '#FF512F', '#DD2476', '#1CB5E0', '#8E2DE2', '#00c6ff', '#fc4a1a'  // Vibrant/Gradient
        ];

        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'color-picker-modal';
            modal.className = 'modal-overlay';
            
            const currentColor = this.state.customPrimaryColor || '#2962ff';
            const colorOptionsHtml = colors.map(c => 
                `<div class="color-option" data-color="${c}" style="width: 40px; height: 40px; border-radius: 50%; background: ${c}; cursor: pointer; border: 2px solid ${currentColor === c ? 'white' : 'transparent'};"></div>`
            ).join('');

            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Tùy chỉnh màu sắc</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 24px;">
                        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                            <label for="color-picker" style="flex: 1; color: var(--text-main);">Chọn màu chủ đạo:</label>
                            <input type="color" id="color-picker" value="${this.state.customPrimaryColor || '#2962ff'}"
                                   style="width: 50px; height: 40px; border: none; border-radius: 8px; cursor: pointer;">
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px;">
                            ${colorOptionsHtml}
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" id="btn-cancel-color" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                        <button id="btn-save-color" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Lưu</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            const currentColor = this.state.customPrimaryColor || '#2962ff';
            document.getElementById('color-picker').value = currentColor;
            // Update color option selections
            document.querySelectorAll('.color-option').forEach(option => {
                option.style.border = option.dataset.color === currentColor ? '2px solid white' : '2px solid transparent';
            });
        }

        // Show the modal
        modal.classList.add('show');

        // Add event listeners
        const colorPicker = document.getElementById('color-picker');
        const colorOptions = document.querySelectorAll('.color-option');
        const btnCancel = document.getElementById('btn-cancel-color');
        const btnSave = document.getElementById('btn-save-color');

        // Update color picker when color option is clicked
        colorOptions.forEach(option => {
            option.onclick = () => {
                colorPicker.value = option.dataset.color;
                // Update selection indicators
                colorOptions.forEach(opt => {
                    opt.style.border = opt.dataset.color === option.dataset.color ? '2px solid white' : '2px solid transparent';
                });
            };
        });

        // Update color option selection when color picker changes
        colorPicker.oninput = () => {
            colorOptions.forEach(opt => {
                opt.style.border = opt.dataset.color === colorPicker.value ? '2px solid white' : '2px solid transparent';
            });
        };

        modal.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.onclick = () => modal.classList.remove('show');
        });

        btnCancel.onclick = () => {
            modal.classList.remove('show');
        };

        btnSave.onclick = () => {
            const selectedColor = colorPicker.value;
            this.setCustomPrimaryColor(selectedColor);
            modal.classList.remove('show');
            this.showToast('Đã cập nhật màu sắc');
        };

        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        };
    }

    /**
     * Set custom primary color
     */
    setCustomPrimaryColor(color) {
        this.state.customPrimaryColor = color;
        localStorage.setItem('customPrimaryColor', color);

        // Update CSS variables
        document.documentElement.style.setProperty('--primary', color);
        document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${color} 0%, ${this.darkenColor(color, 30)} 100%)`);

        // Update theme if light theme is active
        if (this.state.theme === 'light') {
            document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${this.lightenColor(color, 20)} 0%, ${color} 100%)`);
        }

        // Apply color to progress bar, volume bar, and other UI elements
        this.applyColorToUIElements(color);
        this.updateMuteUI();
        this.updateHeartButton();

        // Re-render settings to update status indicators
        if (this.state.currentNav === 3) { // Assuming 3 is the settings page
            this.renderSettings();
        }

        // Update range inputs to reflect the new color
        this.updateAllRangeInputs();
    }

    /**
     * Apply primary color to all UI elements that should match
     */
    applyColorToUIElements(color) {
        // Update CSS variable for primary color
        document.documentElement.style.setProperty('--primary', color);

        // Update the range input styles to use the new primary color
        this.updateAllRangeInputs();
        this.updateHeartButton();

        // Apply to mini player progress fill
        const miniFill = document.getElementById('mini-fill');
        if (miniFill) {
            miniFill.style.background = color;
        }

        // Apply to other progress indicators
        const progressFills = document.querySelectorAll('.progress-fill');
        progressFills.forEach(fill => {
            fill.style.background = color;
        });

        // Apply to active elements like active buttons, etc.
        const activeElements = document.querySelectorAll('.active, .btn.active, .tab-btn.active');
        activeElements.forEach(el => {
            if (el.style) {
                el.style.setProperty('--primary', color, 'important');
            }
        });

        // Update any other elements that use the primary color
        this.updatePrimaryColorElements(color);

        // Update range inputs to reflect the new color
        this.updateAllRangeInputs();
    }

    /**
     * Update elements that use primary color
     */
    updatePrimaryColorElements(color) {
        // Update any elements that might be using primary color directly
        const elementsWithPrimary = document.querySelectorAll('[style*="--primary"], [style*="var(--primary)"]');
        elementsWithPrimary.forEach(el => {
            let style = el.getAttribute('style') || '';
            if (style.includes('var(--primary)') || style.includes(color)) {
                // Re-apply the style to ensure it updates
                el.style.setProperty('--primary', color);
            }
        });
    }

    /**
     * Lighten a color
     */
    lightenColor(color, percent) {
        const num = parseInt(color.replace("#",""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) + amt;
        const G = (num >> 8 & 0x00FF) + amt;
        const B = (num & 0x0000FF) + amt;
        return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 +
                (G<255?G<1?0:G:255)*0x100 +
                (B<255?B<1?0:B:255)).toString(16).slice(1);
    }

    /**
     * Darken a color
     */
    darkenColor(color, percent) {
        const num = parseInt(color.replace("#",""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return "#" + (0x1000000 + (R>255?255:R<0?0:R)*0x10000 +
                (G>255?255:G<0?0:G)*0x100 +
                (B>255?255:B<0?0:B)).toString(16).slice(1);
    }

    /**
     * Get display name for font
     */
    getFontDisplayName(fontFamily) {
        const fontNames = {
            'Urbanist': 'Mặc định',
            'Roboto': 'Roboto',
            'Inter': 'Inter',
            'Poppins': 'Poppins',
            'Montserrat': 'Montserrat',
            'Open Sans': 'Open Sans',
            'Nunito': 'Nunito',
            'Lato': 'Lato',
            'Source Sans Pro': 'Source Sans Pro',
            'Noto Sans': 'Noto Sans',
            'Be Vietnam Pro': 'Be Vietnam',
            'LXGW WenKai Mono TC': 'LXGW WenKai Mono TC',
            'Roboto Slab': 'Roboto Slab',
            'Playpen Sans': 'Playpen Sans',
            'Dancing Script': 'Dancing Script',
            'Jura': 'Jura',
            'Protest Revolution': 'Protest Revolution',
            'Cormorant SC': 'Cormorant SC'
        };
        return fontNames[fontFamily] || fontFamily || 'MẶC ĐỊNH';
    }

    /**
     * Get display name for layout
     */
    getLayoutDisplayName(layoutMode) {
        const layoutNames = {
            'standard': 'Tiêu chuẩn',
            'compact': 'Gọn nhẹ',
            'spacious': 'Rộng rãi',
            'minimal': 'Tối giản'
        };
        return layoutNames[layoutMode] || layoutMode || 'TIÊU CHUẨN';
    }

    /**
     * Show font selector modal
     */
    showFontSelectorModal() {
        let modal = document.getElementById('font-selector-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'font-selector-modal';
            modal.className = 'modal-overlay';
            // Create the modal content with proper template literal handling
            const fontFamily = this.state.fontFamily;
            const fontWeight = this.state.fontWeight || '400';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Tùy chỉnh phông chữ</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 24px;">
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; margin-bottom: 10px; color: var(--text-main);">Phông chữ:</label>
                            <select id="font-selector" style="width: 100%; padding: 12px; border-radius: 8px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); font-size: 16px;">
                                <option value="Urbanist" ` + (fontFamily === 'Urbanist' ? 'selected' : '') + `>Urbanist (Mặc định)</option>
                                <option value="LXGW WenKai Mono TC" ` + (fontFamily === 'LXGW WenKai Mono TC' ? 'selected' : '') + `>LXGW WenKai Mono TC (Đẹp & Hiện đại)</option>
                                <option value="Roboto Slab" ` + (fontFamily === 'Roboto Slab' ? 'selected' : '') + `>Roboto Slab (Chữ in đậm & Rõ ràng)</option>
                                <option value="Playpen Sans" ` + (fontFamily === 'Playpen Sans' ? 'selected' : '') + `>Playpen Sans (Thư pháp & Trẻ trung)</option>
                                <option value="Dancing Script" ` + (fontFamily === 'Dancing Script' ? 'selected' : '') + `>Dancing Script (Thư pháp & Nghệ thuật)</option>
                                <option value="Jura" ` + (fontFamily === 'Jura' ? 'selected' : '') + `>Jura (Hiện đại & Sạch sẽ)</option>
                                <option value="Protest Revolution" ` + (fontFamily === 'Protest Revolution' ? 'selected' : '') + `>Protest Revolution (Cách mạng & Độc đáo)</option>
                                <option value="Cormorant SC" ` + (fontFamily === 'Cormorant SC' ? 'selected' : '') + `>Cormorant SC (Trang nhã & Cổ điển)</option>
                            </select>
                        </div>
                        
                        <div style="margin-bottom: 20px;">
                            <label style="display: block; margin-bottom: 10px; color: var(--text-main);">Độ đậm:</label>
                            <select id="font-weight-selector" style="width: 100%; padding: 12px; border-radius: 8px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); font-size: 16px;">
                                <option value="300" ` + (fontWeight === '300' ? 'selected' : '') + `>300 - Nhạt</option>
                                <option value="400" ` + (fontWeight === '400' ? 'selected' : '') + `>400 - Thường</option>
                                <option value="500" ` + (fontWeight === '500' ? 'selected' : '') + `>500 - Trung bình</option>
                                <option value="600" ` + (fontWeight === '600' ? 'selected' : '') + `>600 - Đậm vừa</option>
                                <option value="700" ` + (fontWeight === '700' ? 'selected' : '') + `>700 - ��ậm</option>
                                <option value="800" ` + (fontWeight === '800' ? 'selected' : '') + `>800 - Rất đ���m</option>
                                <option value="900" ` + (fontWeight === '900' ? 'selected' : '') + `>900 - Cực đậm</option>
                            </select>
                        </div>
                        
                        <div style="padding: 15px; background: var(--bg-secondary); border-radius: 8px; margin-top: 15px;">
                            <p style="margin: 0; font-size: 18px;" id="font-preview">Việt Nam Vinh Quang, bản quyền thuộc về d4m-dev</p>
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" id="btn-cancel-font" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                        <button id="btn-save-font" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Lưu</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            const fontFamily = this.state.fontFamily || 'Urbanist';
            const fontWeight = this.state.fontWeight || '400';
            document.getElementById('font-selector').value = fontFamily;
            document.getElementById('font-weight-selector').value = fontWeight;
            document.getElementById('font-preview').style.fontFamily = fontFamily;
            document.getElementById('font-preview').style.fontWeight = fontWeight;
            document.getElementById('font-preview').textContent = 'Việt Nam Vinh Quang, bản quyền thuộc về d4m-dev';
        }

        // Show the modal
        modal.classList.add('show');

        // Add event listeners
        const fontSelector = document.getElementById('font-selector');
        const fontWeightSelector = document.getElementById('font-weight-selector');
        const fontPreview = document.getElementById('font-preview');
        const btnCancel = document.getElementById('btn-cancel-font');
        const btnSave = document.getElementById('btn-save-font');

        // Update preview when font changes
        fontSelector.onchange = () => {
            const selectedFont = fontSelector.value;
            fontPreview.style.fontFamily = selectedFont;
            fontPreview.textContent = 'Việt Nam Vinh Quang, bản quyền thuộc về d4m-dev';
            
            // Temporarily load the font for preview if not already loaded
            if (selectedFont !== 'Urbanist') {
                const fontRuleId = `preview-${selectedFont.replace(/\s+/g, '-').toLowerCase()}`;
                if (!document.getElementById(fontRuleId)) {
                    // Create a temporary font rule for preview
                    const style = document.createElement('style');
                    style.id = fontRuleId;
                    
                    // Determine the correct path based on font family
                    let fontStylePath = '';
                    switch(selectedFont) {
                        case 'LXGW WenKai Mono TC':
                            fontStylePath = 'font-style/LXGW_WenKai_Mono_TC/LXGWWenKaiMonoTC-Regular.ttf';
                            break;
                        case 'Roboto Slab':
                            fontStylePath = 'font-style/Roboto_Slab/RobotoSlab-VariableFont_wght.ttf';
                            break;
                        case 'Playpen Sans':
                            fontStylePath = 'font-style/Playpen_Sans/PlaypenSans-VariableFont_wght.ttf';
                            break;
                        case 'Dancing Script':
                            fontStylePath = 'font-style/Dancing_Script/DancingScript-VariableFont_wght.ttf';
                            break;
                        case 'Jura':
                            fontStylePath = 'font-style/Jura/Jura-VariableFont_wght.ttf';
                            break;
                        case 'Protest Revolution':
                            fontStylePath = 'font-style/Protest_Revolution/ProtestRevolution-Regular.ttf';
                            break;
                        case 'Cormorant SC':
                            fontStylePath = 'font-style/Cormorant_SC/CormorantSC-Regular.ttf';
                            break;
                        default:
                            const dirName = selectedFont.replace(/\s+/g, '_');
                            fontStylePath = `font-style/${dirName}/${dirName}-Regular.ttf`;
                    }
                    
                    style.textContent = `
                        @font-face {
                            font-family: '${selectedFont}';
                            src: url('src/${fontStylePath}') format('truetype');
                            font-weight: normal;
                            font-style: normal;
                        }
                    `;
                    document.head.appendChild(style);
                }
            }
        };

        // Update preview when font weight changes
        fontWeightSelector.onchange = () => {
            fontPreview.style.fontWeight = fontWeightSelector.value;
        };

        modal.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.onclick = () => modal.classList.remove('show');
        });

        btnCancel.onclick = () => {
            modal.classList.remove('show');
        };

        btnSave.onclick = () => {
            const selectedFont = fontSelector.value;
            const selectedWeight = fontWeightSelector.value;
            
            this.setFontFamily(selectedFont, selectedWeight);
            modal.classList.remove('show');
            this.showToast('Đã cập nhật phông chữ');
        };

        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        };
    }

    /**
     * Load local font using @font-face
     */
    loadLocalFont(fontFamily) {
        // Define font file paths based on font family
        let fontStylePath = '';
        let fontFiles = [];
        
        switch(fontFamily) {
            case 'LXGW WenKai Mono TC':
                fontFiles = [
                    { weight: '300', file: 'LXGWWenKaiMonoTC-Light.ttf' },
                    { weight: '400', file: 'LXGWWenKaiMonoTC-Regular.ttf' },
                    { weight: '700', file: 'LXGWWenKaiMonoTC-Bold.ttf' }
                ];
                fontStylePath = 'font-style/LXGW_WenKai_Mono_TC/';
                break;
            case 'Roboto Slab':
                // Use variable font
                fontFiles = [
                    { weight: '100 900', file: 'RobotoSlab-VariableFont_wght.ttf' }
                ];
                fontStylePath = 'font-style/Roboto_Slab/';
                break;
            case 'Playpen Sans':
                // Use variable font
                fontFiles = [
                    { weight: '400', file: 'PlaypenSans-VariableFont_wght.ttf' }
                ];
                fontStylePath = 'font-style/Playpen_Sans/';
                break;
            case 'Dancing Script':
                // Use variable font
                fontFiles = [
                    { weight: '400', file: 'DancingScript-VariableFont_wght.ttf' }
                ];
                fontStylePath = 'font-style/Dancing_Script/';
                break;
            case 'Jura':
                // Use variable font
                fontFiles = [
                    { weight: '100 700', file: 'Jura-VariableFont_wght.ttf' }
                ];
                fontStylePath = 'font-style/Jura/';
                break;
            case 'Protest Revolution':
                fontFiles = [
                    { weight: '400', file: 'ProtestRevolution-Regular.ttf' }
                ];
                fontStylePath = 'font-style/Protest_Revolution/';
                break;
            case 'Cormorant SC':
                fontFiles = [
                    { weight: '300', file: 'CormorantSC-Light.ttf' },
                    { weight: '400', file: 'CormorantSC-Regular.ttf' },
                    { weight: '500', file: 'CormorantSC-Medium.ttf' },
                    { weight: '600', file: 'CormorantSC-SemiBold.ttf' },
                    { weight: '700', file: 'CormorantSC-Bold.ttf' }
                ];
                fontStylePath = 'font-style/Cormorant_SC/';
                break;
            default:
                // For other fonts, try to map them to similar directory structure
                const dirName = fontFamily.replace(/\s+/g, '_');
                fontFiles = [
                    { weight: '400', file: `${dirName}-Regular.ttf` }
                ];
                fontStylePath = `font-style/${dirName}/`;
        }
        
        // Create @font-face rules for each font file using CSS injection
        fontFiles.forEach(font => {
            // Check if this specific font face rule already exists to prevent duplicates
            const existingStyle = Array.from(document.head.querySelectorAll('style')).find(style => 
                style.textContent.includes(`font-family: '${fontFamily}'`) && 
                style.textContent.includes(`url('src/${fontStylePath}${font.file}')`)
            );
            
            if (!existingStyle) {
                const style = document.createElement('style');
                style.textContent = `
                    @font-face {
                        font-family: '${fontFamily}';
                        src: url('src/${fontStylePath}${font.file}') format('truetype');
                        font-weight: ${font.weight};
                        font-style: normal;
                    }
                `;
                document.head.appendChild(style);
                
                // Preload the font by creating a temporary element
                const preloadSpan = document.createElement('span');
                preloadSpan.style.fontFamily = fontFamily;
                preloadSpan.style.visibility = 'hidden';
                preloadSpan.style.position = 'absolute';
                preloadSpan.textContent = 'preload';
                document.body.appendChild(preloadSpan);
                
                // Remove the preload element after a short delay
                setTimeout(() => {
                    if (preloadSpan.parentNode) {
                        preloadSpan.parentNode.removeChild(preloadSpan);
                    }
                }, 100);
            }
        });
    }

    /**
     * Set font family and weight
     */
    setFontFamily(fontFamily, fontWeight = '400') {
        this.state.fontFamily = fontFamily;
        this.state.fontWeight = fontWeight;
        
        localStorage.setItem('fontFamily', fontFamily);
        localStorage.setItem('fontWeight', fontWeight);

        // Update CSS
        document.documentElement.style.setProperty('font-family', `${fontFamily}, sans-serif`);
        document.documentElement.style.setProperty('font-weight', fontWeight);

        // Load the font if it's not the default
        if (fontFamily !== 'Urbanist') {
            this.loadLocalFont(fontFamily);
        }

        // Apply font to all elements that might not inherit it properly
        this.applyFontToAllElements(fontFamily, fontWeight);

        // Re-render settings to update status indicators
        if (this.state.currentNav === 3) { // Assuming 3 is the settings page
            this.renderSettings();
        }
    }
    
    /**
     * Apply font to all elements that might not inherit it properly
     */
    applyFontToAllElements(fontFamily, fontWeight = '400') {
        // Apply font to common text elements that might not inherit from root
        const elements = document.querySelectorAll(`
            body, div, p, span, h1, h2, h3, h4, h5, h6, 
            button, input, textarea, select, label, 
            a, li, td, th, caption, figcaption,
            .text-h1, .text-h2, .track-title, .track-artist, 
            .mini-title, .mini-status, .settings-name, .settings-desc,
            #full-title, #full-artist, #mini-title, #mini-artist,
            .lyric-row, .history-title, .history-artist,
            .list-header h2, .list-header p,
            .modal-content, .settings-item, .chip,
            .tab-btn, .vol-wrapper, .controls-row,
            .progress-container, .slider-group,
            .bottom-nav, .nav-link, .nav-link span,
            .top-bar, .logo, .avatar,
            .search-box input, .search-box,
            .chips-row, .chips-wrapper,
            .player-controls, .meta-info,
            .marquee-content, .marquee-wrapper,
            .options-menu, .menu-item,
            .toast, .toast-msg,
            .context-menu, .context-queue-container,
            .queue-item, .queue-header, .queue-list,
            .swipe-hint-text, .swipe-hint-icon,
            .status-indicator, .toggle-switch,
            .btn-icon, .btn-close-modal,
            .timer-btn, .dl-btn, .preset-btn,
            .eq-slider, .presets-section,
            .keypad-container, .keypad-btn,
            .audio-controls, .eq-controls,
            .reset-warning, .warning,
            .explore-title, .section-header,
            .btn-see-all, .history-item,
            .settings-section, .settings-title
        `);
        
        elements.forEach(element => {
            element.style.fontFamily = `${fontFamily}, sans-serif`;
            element.style.fontWeight = fontWeight;
        });
        
        // Specifically target bottom navigation elements to ensure proper font application
        const navLinks = document.querySelectorAll('.nav-link, .nav-link span');
        navLinks.forEach(element => {
            element.style.fontFamily = `${fontFamily}, sans-serif`;
            element.style.fontWeight = fontWeight;
        });
        
        // Also update the root element to ensure inheritance
        document.documentElement.style.setProperty('font-family', `${fontFamily}, sans-serif`);
        document.documentElement.style.setProperty('font-weight', fontWeight);
        
        // Refresh the lyrics canvas if it exists to apply the new font
        if (this.lyricsCanvas && this.isLyricsCanvasActive) {
            const activeId = this.getCurrentLyricId(); // Get current active lyric ID
            this.updateLyricsCanvas(activeId);
        }
    }
    
    /**
     * Get current active lyric ID based on current time
     */
    getCurrentLyricId() {
        if (!this.lyricsData || !this.lyricsData.length) return null;
        
        let currentTime = 0;
        if (this.currentSongHasVideo) {
            currentTime = this.video.currentTime;
        } else if (this.state.isBeatMode) {
            currentTime = this.beatAudio.currentTime;
        } else {
            currentTime = this.audio.currentTime;
        }
        
        let activeId = null;
        for (let i = 0; i < this.lyricsData.length; i++) {
            if (this.lyricsData[i].time <= currentTime) activeId = this.lyricsData[i].id;
            else break;
        }
        
        return activeId;
    }

    /**
     * Check if Pro features are unlocked, if not show keypad
     */
    checkProAccess(callback) {
        if (this.state.isProUnlocked) {
            callback();
        } else {
            this.showUnlockModal(callback);
        }
    }

    /**
     * Show Unlock Modal with Keypad
     */
    showUnlockModal(callback) {
        let modal = document.getElementById('unlock-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'unlock-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 300px; width: 90%; border-radius: 24px; padding: 24px;">
                    <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 700; text-align: center;">Nhập mã mở khóa</h3>
                    <div style="margin-bottom: 20px;">
                        <input type="password" id="unlock-code-input" placeholder="PIN" readonly style="width: 100%; padding: 15px; border-radius: 16px; background: var(--bg-secondary); color: var(--text-main); border: 1px solid var(--border); text-align: center; font-size: 24px; letter-spacing: 5px; margin-bottom: 20px; outline: none;">
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                            ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="unlock-key" data-key="${n}" style="padding: 15px; border-radius: 14px; background: var(--bg-secondary); color: var(--text-main); font-size: 20px; font-weight: 600; border: 1px solid var(--border);">${n}</button>`).join('')}
                            <button class="unlock-key" data-key="C" style="padding: 15px; border-radius: 14px; background: rgba(255, 71, 87, 0.1); color: #ff4757; font-size: 18px; font-weight: 700; border: 1px solid rgba(255, 71, 87, 0.2);">C</button>
                            <button class="unlock-key" data-key="0" style="padding: 15px; border-radius: 14px; background: var(--bg-secondary); color: var(--text-main); font-size: 20px; font-weight: 600; border: 1px solid var(--border);">0</button>
                            <button class="unlock-key" data-key="OK" style="padding: 15px; border-radius: 14px; background: var(--primary); color: white; font-size: 18px; font-weight: 700; border: none;">OK</button>
                        </div>
                    </div>
                    <button class="btn-close-modal" style="width: 100%; padding: 12px; background: transparent; color: var(--text-sub); font-weight: 600; border: none;">Hủy bỏ</button>
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
                            this.state.isProUnlocked = true;
                            localStorage.setItem('isProUnlocked', 'true');
                            this.showToast('Đã mở khóa tính năng Pro');
                            modal.classList.remove('show');
                            if (this.pendingUnlockCallback) this.pendingUnlockCallback();
                        } else {
                            this.showToast('Mã không đúng');
                            input.value = '';
                            modal.classList.add('shake');
                            setTimeout(() => modal.classList.remove('shake'), 500);
                        }
                    } else {
                        if (input.value.length < 4) input.value += key;
                    }
                };
            });
            
            modal.querySelector('.btn-close-modal').onclick = () => modal.classList.remove('show');
            modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };
        }
        
        this.pendingUnlockCallback = callback;
        document.getElementById('unlock-code-input').value = '';
        modal.classList.add('show');
    }

    // --- AUDIO EFFECTS INTEGRATION ---
    initAudioEffects() {
        // Initialize audio context for spatial audio and other effects
        this.initAudioContext();
        
        // Create audio controls modal with spatial audio controls
        let audioControlsModal = document.getElementById('audio-controls-modal');
        if (!audioControlsModal) {
            audioControlsModal = document.createElement('div');
            audioControlsModal.id = 'audio-controls-modal';
            audioControlsModal.className = 'modal-overlay';
            document.body.appendChild(audioControlsModal);
        }

        // Display audio controls with spatial audio option
        audioControlsModal.innerHTML = `
            <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 700; text-align: center;">Cài đặt âm thanh</h3>
                <div class="settings-section">
                    <div class="settings-title">ÂM THANH KHÔNG GIAN</div>
                    <div class="settings-item">
                        <div class="settings-icon"><i class="fa-solid fa-headphones"></i></div>
                        <div class="settings-info">
                            <div class="settings-name">Âm thanh 3D</div>
                            <div class="settings-desc">Tạo hiệu ứng âm thanh không gian sống động</div>
                        </div>
                        <div class="toggle-switch" id="spatial-audio-toggle"></div>
                    </div>
                </div>
                <div class="settings-section">
                    <div class="settings-title">CÂN BẰNG ÂM THANH</div>
                    <div class="eq-controls">
                        <div class="eq-slider">
                            <label>Trầm (60Hz)</label>
                            <input type="range" id="eq-low" min="-12" max="12" value="0">
                            <span id="eq-low-value">0dB</span>
                        </div>
                        <div class="eq-slider">
                            <label>Trung-Trầm (230Hz)</label>
                            <input type="range" id="eq-mid-low" min="-12" max="12" value="0">
                            <span id="eq-mid-low-value">0dB</span>
                        </div>
                        <div class="eq-slider">
                            <label>Trung (910Hz)</label>
                            <input type="range" id="eq-mid" min="-12" max="12" value="0">
                            <span id="eq-mid-value">0dB</span>
                        </div>
                        <div class="eq-slider">
                            <label>Trung-Cao (3.5kHz)</label>
                            <input type="range" id="eq-mid-high" min="-12" max="12" value="0">
                            <span id="eq-mid-high-value">0dB</span>
                        </div>
                        <div class="eq-slider">
                            <label>Caо (14kHz)</label>
                            <input type="range" id="eq-high" min="-12" max="12" value="0">
                            <span id="eq-high-value">0dB</span>
                        </div>
                    </div>
                </div>
                <button class="btn-close-modal" id="btn-close-audio-controls">Đóng</button>
            </div>
        `;

        // Setup spatial audio toggle
        const spatialToggle = document.getElementById('spatial-audio-toggle');
        if (spatialToggle) {
            spatialToggle.onclick = () => {
                this.toggleSpatialAudio();
            };
        }

        // Setup EQ controls
        const eqControls = ['eq-low', 'eq-mid-low', 'eq-mid', 'eq-mid-high', 'eq-high'];
        eqControls.forEach(controlId => {
            const control = document.getElementById(controlId);
            const valueDisplay = document.getElementById(`${controlId}-value`);
            if (control && valueDisplay) {
                control.oninput = () => {
                    valueDisplay.textContent = `${control.value}dB`;
                    this.updateEqualizer();
                };
            }
        });

        const btnCloseAudioControls = document.getElementById('btn-close-audio-controls');
        if (btnCloseAudioControls && audioControlsModal) {
            btnCloseAudioControls.onclick = () => audioControlsModal.classList.remove('show');
            audioControlsModal.onclick = (e) => { if (e.target === audioControlsModal) audioControlsModal.classList.remove('show'); };
        }
    }

    /**
     * Show layout selector modal
     */
    showLayoutSelectorModal() {
        let modal = document.getElementById('layout-selector-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'layout-selector-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px; width: 90%; max-height: 85vh; overflow-y: auto; border-radius: 16px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                        <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Chọn bố cục</h3>
                        <button class="btn-close-modal" style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-secondary); border: none; color: var(--text-main); display: flex; align-items: center; justify-content: center; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div style="margin-bottom: 24px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div class="layout-option ${this.state.layoutMode === 'standard' ? 'selected' : ''}" data-layout="standard" style="padding: 15px; border-radius: 12px; background: var(--bg-secondary); cursor: pointer; border: 2px solid ${this.state.layoutMode === 'standard' ? 'var(--primary)' : 'transparent'};">
                                <div style="display: flex; justify-content: center; align-items: center; height: 80px; background: var(--bg-surface); border-radius: 8px; margin-bottom: 10px;">
                                    <div style="width: 60%; height: 10px; background: var(--primary); border-radius: 5px;"></div>
                                </div>
                                <div style="text-align: center; font-weight: 600; color: var(--text-main);">Tiêu chuẩn</div>
                            </div>
                            <div class="layout-option ${this.state.layoutMode === 'compact' ? 'selected' : ''}" data-layout="compact" style="padding: 15px; border-radius: 12px; background: var(--bg-secondary); cursor: pointer; border: 2px solid ${this.state.layoutMode === 'compact' ? 'var(--primary)' : 'transparent'};">
                                <div style="display: flex; justify-content: center; align-items: center; height: 80px; background: var(--bg-surface); border-radius: 8px; margin-bottom: 10px;">
                                    <div style="width: 80%; height: 8px; background: var(--primary); border-radius: 4px; margin-bottom: 5px;"></div>
                                    <div style="width: 70%; height: 8px; background: var(--primary); border-radius: 4px;"></div>
                                </div>
                                <div style="text-align: center; font-weight: 600; color: var(--text-main);">Gọn nhẹ</div>
                            </div>
                            <div class="layout-option ${this.state.layoutMode === 'spacious' ? 'selected' : ''}" data-layout="spacious" style="padding: 15px; border-radius: 12px; background: var(--bg-secondary); cursor: pointer; border: 2px solid ${this.state.layoutMode === 'spacious' ? 'var(--primary)' : 'transparent'};">
                                <div style="display: flex; justify-content: center; align-items: center; height: 80px; background: var(--bg-surface); border-radius: 8px; margin-bottom: 10px; flex-direction: column;">
                                    <div style="width: 50%; height: 12px; background: var(--primary); border-radius: 6px; margin-bottom: 8px;"></div>
                                    <div style="width: 40%; height: 12px; background: var(--primary); border-radius: 6px;"></div>
                                </div>
                                <div style="text-align: center; font-weight: 600; color: var(--text-main);">Rộng rãi</div>
                            </div>
                            <div class="layout-option ${this.state.layoutMode === 'minimal' ? 'selected' : ''}" data-layout="minimal" style="padding: 15px; border-radius: 12px; background: var(--bg-secondary); cursor: pointer; border: 2px solid ${this.state.layoutMode === 'minimal' ? 'var(--primary)' : 'transparent'};">
                                <div style="display: flex; justify-content: center; align-items: center; height: 80px; background: var(--bg-surface); border-radius: 8px; margin-bottom: 10px;">
                                    <div style="width: 70%; height: 6px; background: var(--primary); border-radius: 3px;"></div>
                                </div>
                                <div style="text-align: center; font-weight: 600; color: var(--text-main);">Tối giản</div>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button class="btn-close-modal" id="btn-cancel-layout" style="flex: 1; background: rgba(255,255,255,0.05);">Hủy</button>
                        <button id="btn-save-layout" style="flex: 1; background: var(--primary); color: white; padding: 12px; border-radius: 12px; font-weight: 600;">Lưu</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Show the modal
        modal.classList.add('show');

        // Add event listeners
        const layoutOptions = document.querySelectorAll('.layout-option');
        const btnCancel = document.getElementById('btn-cancel-layout');
        const btnSave = document.getElementById('btn-save-layout');

        // Update selection when clicking an option
        layoutOptions.forEach(option => {
            option.onclick = () => {
                // Remove selection from all options
                layoutOptions.forEach(opt => {
                    opt.classList.remove('selected');
                    opt.style.border = '2px solid transparent';
                });

                // Add selection to clicked option
                option.classList.add('selected');
                option.style.border = '2px solid var(--primary)';
            };
        });

        modal.querySelectorAll('.btn-close-modal').forEach(btn => {
            btn.onclick = () => modal.classList.remove('show');
        });

        btnCancel.onclick = () => {
            modal.classList.remove('show');
        };

        btnSave.onclick = () => {
            const selectedLayout = document.querySelector('.layout-option.selected')?.dataset.layout || 'standard';
            this.setLayoutMode(selectedLayout);
            modal.classList.remove('show');
            this.showToast('Đã cập nhật bố cục');
        };

        // Close modal when clicking outside
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        };
    }

    /**
     * Set layout mode
     */
    setLayoutMode(layoutMode) {
        this.state.layoutMode = layoutMode;
        localStorage.setItem('layoutMode', layoutMode);

        // Apply layout-specific styles
        const body = document.body;
        body.classList.remove('layout-standard', 'layout-compact', 'layout-spacious', 'layout-minimal');
        body.classList.add(`layout-${layoutMode}`);

        // Update CSS variables based on layout
        switch(layoutMode) {
            case 'compact':
                document.documentElement.style.setProperty('--spacing-multiplier', '0.8');
                break;
            case 'spacious':
                document.documentElement.style.setProperty('--spacing-multiplier', '1.2');
                break;
            case 'minimal':
                document.documentElement.style.setProperty('--spacing-multiplier', '0.9');
                break;
            default:
                document.documentElement.style.setProperty('--spacing-multiplier', '1');
        }

        // Re-render settings to update status indicators
        if (this.state.currentNav === 3) { // Assuming 3 is the settings page
            this.renderSettings();
        }
    }

    /**
     * Thêm/xóa bài hát khỏi danh sách yêu thích.
     */
    toggleFavorite(idx) {
        const id = String(this.state.playlist[idx].id);
        if (this.state.favorites.includes(id)) {
            this.state.favorites = this.state.favorites.filter(x => x !== id);
            this.showToast('Đã xóa khỏi yêu thích');
        } else {
            this.state.favorites.push(id);
            this.showToast('Đã thêm vào yêu thích');
        }
        localStorage.setItem('favorites', JSON.stringify(this.state.favorites));
        this.updateHeartButton();
        this.renderPlaylist();
    } 
    /**
     * Cập nhật trạng thái nút trái tim (yêu thích) trên giao diện.
     */
    updateHeartButton() {
        if (!this.state.playlist[this.state.currentIndex]) return;
        const isFav = this.state.favorites.includes(String(this.state.playlist[this.state.currentIndex].id));
        const btn = document.getElementById('btn-heart');
        if (!btn) return;

        btn.className = `btn-icon ${isFav ? 'active' : ''}`;
        btn.innerHTML = `<i class="fa-${isFav ? 'solid' : 'regular'} fa-heart"></i>`;
        
        if (isFav) {
            btn.style.color = 'var(--primary)';
        } else {
            btn.style.color = '';
        }
    }

    // --- PLAYBACK CONTROLS ---
    /**
     * Tải một bài hát vào trình phát.
     * @param {number} idx - Chỉ số của bài hát trong playlist.
     * @param {boolean} autoPlay - Tự động phát sau khi tải xong.
     */
    loadSong(idx, autoPlay = true) {
        // Store PiP state to restore after loading new song
        const wasLyricsPiPOpen = this.lyricsPiPWindow !== null || this.isLyricsCanvasActive;
        const wasCanvasPiP = this.isLyricsCanvasActive;

        // Close lyrics PiP temporarily to prevent crashes during song change
        if (this.lyricsPiPWindow) {
            this.lyricsPiPWindow.close();
            this.lyricsPiPWindow = null;
        }

        if (this.lyricsPipVideo && document.pictureInPictureElement === this.lyricsPipVideo) {
            this.lyricsPipVideo.exitPictureInPicture().catch(() => {});
            this.isLyricsCanvasActive = false;
        }

        this.pause(); // Dừng mọi thứ trước khi tải bài hát mới
        this.state.currentIndex = idx;
        this.state.isPreloading = false;
        this.state.nextTrackData = null;
        this.isBackgroundFallback = false;

        const song = this.state.playlist[idx];
        this.updateUI(song);
        this.updateHeartButton();
        this.updateBeatBtnUI();
        this.renderPlaylist();
        this.loadLyrics(song.lyric);
        this.renderContextQueue(); // Update active state in queue
        this.addToHistory(song.id);

        this.currentSongHasVideo = !!(song.vid && !song.vid.includes('..4.mp4') && !song.vid.includes('ERROR'));
        this.updatePiPButtonUI();

        // Tải trước tất cả các nguồn có thể có
        this.video.src = this.currentSongHasVideo ? song.vid : '';
        this.audio.src = song.path;
        this.beatAudio.src = (song.instrumental && song.instrumental !== 'Tạm thời chưa có!') ? song.instrumental : '';

        if (!this.currentSongHasVideo) {
            this.elements.videoMsg.style.display = 'none';
            if (this.state.currentMode === 'video') {
                this.showToast('Video không khả dụng');
                this.switchTab('song');
            }
        }

        if (autoPlay) {
            this.resumeAudioContext(); // Ensure audio context is ready before playing
            this.play();
        }
        this.checkMarquee();
        localStorage.setItem('lastIndex', idx);
        localStorage.setItem('lastTime', 0);

        // Restore PiP if it was open before
        if (wasLyricsPiPOpen) {
            setTimeout(() => {
                if (wasCanvasPiP) {
                    // Try to reopen canvas PiP
                    if (this.lyricsPipVideo && !document.pictureInPictureElement) {
                        this.lyricsPipVideo.play().then(() => {
                            this.lyricsPipVideo.requestPictureInPicture();
                            this.isLyricsCanvasActive = true;
                            this.updatePiPButtonUI();
                        }).catch(() => {});
                    }
                } else {
                    // For document PiP, we can't automatically restore it due to browser policies
                    // Just update the UI to show it's available
                    this.updatePiPButtonUI();
                }
            }, 500); // Wait a bit for the new song to load
        }
    }

    /**
     * Thêm bài hát vào lịch sử nghe.
     */
    addToHistory(id) {
        this.state.history = [String(id), ...this.state.history.filter(x => x !== String(id))].slice(0, 20);
        localStorage.setItem('history', JSON.stringify(this.state.history));
    }

    /**
     * Cập nhật các thông tin hiển thị trên giao diện người dùng (tiêu đề, nghệ sĩ, ảnh bìa).
     */
    updateUI(song) {
        const t = document.getElementById('full-title');
        t.innerText = song.name;
        t.removeAttribute('d');
        t.parentElement.classList.remove('animate');
        document.getElementById('full-artist').innerText = song.artist;
        document.getElementById('mini-title').innerText = song.name;
        document.getElementById('mini-artist').innerText = song.artist;
        document.getElementById('full-artwork').src = song.artwork;
        document.getElementById('mini-img').src = song.artwork;

        // Apply dynamic UI colors based on album artwork
        this.applyDynamicUIColors(song.artwork).then(() => {
            // Fallback to hue if color extraction fails
            if (!this.state.customPrimaryColor) {
                this.extractColor(song.artwork).then(color => {
                    if (!color) {
                        const hue = (this.state.currentIndex * 50) % 360;
                        this.elements.ambient.style.background = `radial-gradient(circle, hsl(${hue},70%,50%), transparent 70%)`;
                    }
                });
            }
        });

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.name,
                artist: song.artist,
                artwork: [{ src: song.artwork, sizes: '512x512', type: 'image/jpeg' }]
            });
        }
    }

    /**
     * Trích xuất màu chủ đạo từ ảnh (sử dụng Canvas).
     */
    extractColor(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.src = url;
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 1; canvas.height = 1;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, 1, 1);
                    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                    const rgbColor = `rgb(${r}, ${g}, ${b})`;
                    const hexColor = this.rgbToHex(r, g, b);
                    resolve({rgb: rgbColor, hex: hexColor});
                } catch (e) { resolve(null); }
            };
            img.onerror = () => resolve(null);
        });
    }
    
    /**
     * Convert RGB to Hex
     */
    rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    
    /**
     * Apply dynamic UI colors based on album artwork
     */
    async applyDynamicUIColors(albumArtwork) {
        const colors = await this.extractColor(albumArtwork);
        if (colors) {
            // Update primary color based on album artwork
            document.documentElement.style.setProperty('--primary', colors.rgb);
            document.documentElement.style.setProperty('--primary-gradient', `linear-gradient(135deg, ${colors.hex} 0%, ${this.darkenColor(colors.hex, 30)} 100%)`);
            
            // Update ambient light to match album color
            if (this.elements.ambient) {
                this.elements.ambient.style.background = `radial-gradient(circle, ${colors.hex}, transparent 70%)`;
            }
            
            // Update all range inputs to reflect new color
            this.updateAllRangeInputs();
        }
    }

    // --- PRELOADING LOGIC ---
    /**
     * Kiểm tra và kích hoạt preload bài hát tiếp theo nếu thời gian còn lại ít. */
    checkPreload(currentTime, duration) {
        let threshold = 10; // Mặc định 10s cho mạng nhanh
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.downlink) {
            // Mạng chậm (< 2Mbps): Preload trước 30s
            if (conn.downlink < 2) threshold = 30;
            // Mạng trung bình (< 5Mbps): Preload trước 20s
            else if (conn.downlink < 5) threshold = 20;
        }

        const timeLeft = duration - currentTime;
        if (timeLeft <= threshold && !this.state.isPreloading) {
            this.state.isPreloading = true;
            this.executePreload();
        }
    }

    /**
     * Thực hiện preload bài hát ti��p theo vào các đối tượng Audio/Video ẩn.
     */
    executePreload() {
        const nextIdx = this.getNextIndex();
        if (nextIdx === -1) return;
        const nextSong = this.state.playlist[nextIdx];
        this.state.nextTrackData = nextSong;
        const nextAudioSrc = this.state.isBeatMode ? nextSong.instrumental : nextSong.path;
        this.preloadAudioAgent.src = nextAudioSrc;
        this.preloadAudioAgent.load(); 
        if (this.state.currentMode === 'video' && nextSong.vid && !nextSong.vid.includes('ERROR')) {
            this.preloadVideoAgent.src = nextSong.vid;
            this.preloadVideoAgent.load();
        }
        console.log(`[Preload] ${nextSong.name}`);
    }

    /**
     * Lấy chỉ số của bài hát tiếp theo trong danh sách phát (có tính đến shuffle).
     */
    getNextIndex() {
        const display = this.getDisplayPlaylist(); if (!display.length) return -1;
        const curr = this.state.playlist[this.state.currentIndex];
        let idx = display.findIndex(t => t.id === curr.id);
        let nextIdx = 0;
        if (this.state.isShuffle) {
            if (display.length > 1) do { nextIdx = Math.floor(Math.random() * display.length); } while (nextIdx === idx);
        } else { if (idx !== -1) nextIdx = idx + 1 >= display.length ? 0 : idx + 1; }
        return this.state.playlist.findIndex(t => t.id === display[nextIdx].id);
    }

    // --- FEATURE SPECIFIC LOGIC ---
    /**
     * Bật/tắt chế độ Beat (Karaoke).
     */
    toggleBeatMode() {
        if (!this.beatAudio.src) {
            this.showToast('Chưa có Beat!');
            return;
        }

        this.state.isBeatMode = !this.state.isBeatMode;
        this.updateBeatBtnUI();
        this.showToast(this.state.isBeatMode ? 'Chế độ Beat' : 'Tắt Beat');

        if (this.state.isPlaying) {
            // Nếu đang phát, hoán đổi nguồn phát ngay lập tức
            this.play();
        } else {
            // Nếu đang dừng, chỉ cập nhật trạng thái mute của video. Nguồn phát đúng sẽ được dùng khi nhấn play.
            if (this.currentSongHasVideo) {
                this.video.muted = this.state.isBeatMode;
            }
        }
    }
    /**
     * Cập nhật trạng thái nút chuyển Beat trên giao diện.
     */
    updateBeatBtnUI() { this.elements.btnSwitchBeat.classList.toggle('active', this.state.isBeatMode); }

    /**
     * Phát bài hát tại một chỉ số cụ thể.
     * @param {number} idx - Chỉ số bài hát.
     */
    playIndex(idx) { this.loadSong(idx, true); }

    play() {
        // Initialize Audio Context for basic playback
        this.initAudioContext();

        // Resume Audio Context if suspended (browser policy)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume()
                .then(() => {
                    console.log('Audio context resumed successfully');
                })
                .catch((err) => {
                    console.error('Failed to resume audio context:', err);
                });
        }

        this.state.isPlaying = true;
        this.updatePlayState();
        if (this.state.sleepTimeLeft > 0) this.runSleepTimer();

        if (this.isLyricsCanvasActive && this.lyricsPipVideo) this.lyricsPipVideo.play().catch(() => {});

        if (document.hidden && this.currentSongHasVideo && !this.state.isBeatMode && !document.pictureInPictureElement) {
            this.isBackgroundFallback = true;
            this.audio.play().catch(e => {
                console.error("Failed to play audio in background:", e);
                // Try to resume audio context and play again
                this.resumeAudioContext();
                setTimeout(() => {
                    this.audio.play().catch(e => {
                        console.error("Second attempt to play audio failed:", e);
                    });
                }, 100);
            });
            this.video.pause();
            return;
        }

        if (this.currentSongHasVideo) {
            this.video.muted = this.state.isMuted || this.state.isBeatMode;
            const videoPromise = this.video.play();
            if (videoPromise !== undefined) {
                videoPromise.catch(e => {
                    console.error("Lỗi phát video, đang chuyển sang âm thanh:", e);
                    this.showToast('Video lỗi, đang phát âm thanh');
                    this.currentSongHasVideo = false; // Chuyển về chế độ chỉ audio
                    this.play(); // Thử phát lại ở chế độ chỉ audio
                });
            }

            if (this.state.isBeatMode && this.beatAudio.src) {
                this.beatAudio.play().catch(e => {
                    console.error("Failed to play beat audio:", e);
                });
            } else {
                this.beatAudio.pause();
            }
            this.audio.pause(); // Audio gốc không bao giờ dùng khi có video
        } else {
            // Chế độ chỉ audio
            this.video.pause();
            if (this.state.isBeatMode && this.beatAudio.src) {
                this.audio.pause();
                this.beatAudio.play().catch(e => {
                    console.error("Failed to play beat audio:", e);
                    // Try to resume audio context and play again
                    this.resumeAudioContext();
                    setTimeout(() => {
                        this.beatAudio.play().catch(e => {
                            console.error("Second attempt to play beat audio failed:", e);
                        });
                    }, 100);
                });
            } else {
                this.beatAudio.pause();
                this.audio.play().catch(e => {
                    console.error("Failed to play audio:", e);
                    // Try to resume audio context and play again
                    this.resumeAudioContext();
                    setTimeout(() => {
                        this.audio.play().catch(e => {
                            console.error("Second attempt to play audio failed:", e);
                        });
                    }, 100);
                });
            }
        }

        // Skip advanced audio effects since they are disabled
    }
    /**
     * Tạm dừng phát nhạc/video.
     */
    pause() { 
        this.state.isPlaying = false;
        if (this.state.sleepInterval) { clearInterval(this.state.sleepInterval); this.state.sleepInterval = null; }
        this.video.pause(); this.audio.pause(); this.beatAudio.pause(); 
        if (this.isLyricsCanvasActive && this.lyricsPipVideo) this.lyricsPipVideo.pause();
        this.updatePlayState(); 
        
        const t = this.currentSongHasVideo ? this.video.currentTime : (this.state.isBeatMode ? this.beatAudio.currentTime : this.audio.currentTime);
        localStorage.setItem('lastIndex', this.state.currentIndex);
        localStorage.setItem('lastTime', t);
    }
    /**
     * Chuyển đổi trạng thái phát/tạm dừng.
     */
    togglePlay() {
        this.state.isPlaying ? this.pause() : this.play();
    }
    /**
     * Cập nhật trạng thái nút Play/Pause và hiệu ứng sóng nhạc.
     */
    updatePlayState() {
        const icon = this.state.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        this.elements.playBtnMain.innerHTML = icon; this.elements.playBtnMini.innerHTML = icon;
        document.querySelectorAll('.wave-anim .bar').forEach(b => b.style.animationPlayState = this.state.isPlaying ? 'running' : 'paused');
        if (this.state.isPlaying) {
            this.elements.mini.classList.remove('hide');
            this.elements.mini.classList.add('playing');
        } else {
            this.elements.mini.classList.remove('playing');
        }
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = this.state.isPlaying ? 'playing' : 'paused';
        }
    }
    next() { const nextIdx = this.getNextIndex(); if (nextIdx !== -1) this.loadSong(nextIdx, true); }
    prev() {
        const display = this.getDisplayPlaylist(); if (!display.length) return;
        const curr = this.state.playlist[this.state.currentIndex];
        let idx = display.findIndex(t => t.id === curr.id);
        let prevIdx = 0;
        if (idx !== -1) prevIdx = idx - 1 < 0 ? display.length - 1 : idx - 1;
        const masterIdx = this.state.playlist.findIndex(t => t.id === display[prevIdx].id);
        this.loadSong(masterIdx, true);
    }

    /**
     * Bắt đầu hẹn giờ tắt nhạc.
     */
    startSleepTimer(minutes) {
        if (this.state.sleepInterval) clearInterval(this.state.sleepInterval);
        this.state.sleepInterval = null;

        if (minutes === 0) {
            this.state.sleepTimeLeft = 0;
            localStorage.setItem('sleepTimeLeft', 0);
            this.updateTimerText();
            this.showToast("Đã hủy hẹn giờ"); 
            return;
        }
        this.state.sleepTimeLeft = minutes * 60;
        localStorage.setItem('sleepTimeLeft', this.state.sleepTimeLeft);
        this.showToast(`Nhạc sẽ tắt sau ${minutes} phút`);
        this.updateTimerText();
        if (this.state.isPlaying) this.runSleepTimer();
    }

    runSleepTimer() {
        if (this.state.sleepInterval) clearInterval(this.state.sleepInterval);
        this.state.sleepInterval = setInterval(() => {
            if (this.state.sleepTimeLeft > 0) {
                this.state.sleepTimeLeft--;
                localStorage.setItem('sleepTimeLeft', this.state.sleepTimeLeft);
                this.updateTimerText();
            } else {
                clearInterval(this.state.sleepInterval);
                this.state.sleepInterval = null;

                // Use smart sleep fade-out if enabled, otherwise regular pause
                if (this.state.smartSleepEnabled) {
                    this.startSmartSleepFadeOut();
                } else {
                    this.pause();
                    this.showToast("Đã tắt nhạc");
                    this.state.sleepTimeLeft = 0;
                    localStorage.setItem('sleepTimeLeft', 0);
                    this.updateTimerText();
                }
            }
        }, 1000);
    }
    /**
     * Cập nhật văn bản hiển thị thời gian hẹn giờ còn lại.
     */
    updateTimerText() {
        const settingsStatus = document.getElementById('settings-timer-status');
        if (this.state.sleepTimeLeft > 0) {
            const m = Math.ceil(this.state.sleepTimeLeft / 60);
            this.elements.timerMenuText.innerText = `Còn ${m} phút`; this.elements.timerMenuText.style.color = "var(--primary)";
            if (settingsStatus) {
                settingsStatus.innerText = `${m} phút`;
                settingsStatus.className = "status-indicator status-warning";
            }
        } else {
            this.elements.timerMenuText.innerText = "Hẹn giờ tắt"; this.elements.timerMenuText.style.color = "var(--text-main)";
            if (settingsStatus) {
                settingsStatus.innerText = "Tắt";
                settingsStatus.className = "status-indicator status-inactive";
            }
        }
    }

    /**
     * Toggle smart sleep mode
     */
    toggleSmartSleep() {
        this.state.smartSleepEnabled = !this.state.smartSleepEnabled;
        localStorage.setItem('smartSleepEnabled', this.state.smartSleepEnabled);
        this.showToast(this.state.smartSleepEnabled ? 'Chế độ ngủ thông minh đã bật' : 'Chế độ ngủ thông minh đã tắt');
    }

    /**
     * Start smart sleep fade-out
     */
    startSmartSleepFadeOut() {
        if (!this.state.smartSleepEnabled) {
            // If smart sleep is disabled, just pause
            this.pause();
            this.showToast("Đã tắt nhạc");
            this.state.sleepTimeLeft = 0;
            localStorage.setItem('sleepTimeLeft', 0);
            this.updateTimerText();
            return;
        }

        const fadeDuration = this.state.smartSleepFadeOutTime; // Duration in seconds
        const startVolume = this.state.volume;
        const fadeSteps = fadeDuration;
        let currentStep = 0;

        const fadeInterval = setInterval(() => {
            currentStep++;
            const volumeReductionFactor = currentStep / fadeSteps;
            const newVolume = Math.max(0, startVolume * (1 - volumeReductionFactor));

            // Update volume
            this.setVolume(newVolume, newVolume <= 0);

            // Stop when volume reaches 0 or when fade duration is complete
            if (currentStep >= fadeSteps || newVolume <= 0) {
                clearInterval(fadeInterval);
                this.pause();
                this.showToast("Đã tắt nhạc");
                this.state.sleepTimeLeft = 0;
                localStorage.setItem('sleepTimeLeft', 0);
                this.updateTimerText();
            }
        }, 1000); // Fade out every second
    }

    /**
     * Initialize audio context for spatial audio
     */
    initAudioContext() {
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Create spatial audio nodes if supported
                if (this.audioContext.listener && typeof this.audioContext.createPanner === 'function') {
                    this.effectNodes.panner = this.audioContext.createPanner();
                    this.effectNodes.panner.panningModel = 'HRTF';
                    this.effectNodes.panner.distanceModel = 'inverse';
                    this.effectNodes.panner.refDistance = 1;
                    this.effectNodes.panner.maxDistance = 10000;
                    this.effectNodes.panner.rolloffFactor = 1;
                    this.effectNodes.panner.coneInnerAngle = 360;
                    this.effectNodes.panner.coneOuterAngle = 0;
                    this.effectNodes.panner.coneOuterGain = 0;
                }
            } catch (e) {
                console.warn('Web Audio API không được hỗ trợ:', e);
            }
        }
    }

    /**
     * Toggle spatial audio (3D sound effect)
     */
    toggleSpatialAudio() {
        if (!this.audioContext) {
            this.showToast('Không thể kích hoạt âm thanh 3D');
            return;
        }

        this.state.spatialAudioEnabled = !this.state.spatialAudioEnabled;
        
        // Update spatial audio settings
        if (this.state.spatialAudioEnabled && this.effectNodes.panner) {
            // Connect spatial audio nodes
            this.setupSpatialAudioConnections();
            this.showToast('Âm thanh 3D đã bật');
        } else {
            // Disconnect spatial audio nodes
            this.disconnectSpatialAudio();
            this.showToast('Âm thanh 3D đã tắt');
        }
        
        // Update toggle UI
        const spatialToggle = document.getElementById('spatial-audio-toggle');
        if (spatialToggle) {
            spatialToggle.classList.toggle('active', this.state.spatialAudioEnabled);
        }
    }

    /**
     * Setup spatial audio connections
     */
    setupSpatialAudioConnections() {
        if (!this.effectNodes.panner) return;
        
        // This would connect the audio sources through the spatial audio nodes
        // For now, just enable the feature flag
        console.log('Spatial audio connections established');
    }

    /**
     * Disconnect spatial audio
     */
    disconnectSpatialAudio() {
        if (!this.effectNodes.panner) return;
        
        // Disconnect spatial audio nodes
        console.log('Spatial audio disconnected');
    }

    /**
     * Update equalizer settings
     */
    updateEqualizer() {
        // Extract EQ values from the sliders
        const low = document.getElementById('eq-low')?.value || 0;
        const midLow = document.getElementById('eq-mid-low')?.value || 0;
        const mid = document.getElementById('eq-mid')?.value || 0;
        const midHigh = document.getElementById('eq-mid-high')?.value || 0;
        const high = document.getElementById('eq-high')?.value || 0;
        
        console.log(`EQ: Low=${low}, Mid-Low=${midLow}, Mid=${mid}, Mid-High=${midHigh}, High=${high}`);
        // In a real implementation, this would apply the EQ settings to the audio
    }

    /**
     * Cập nhật trạng thái các nút toggle trong cài đặt.
     */
    updateToggleStates() {
        const themeToggleSwitch = document.getElementById('theme-toggle-switch');
        const soundEffectSwitch = document.getElementById('sound-effect-switch');
        const autoUpdateSwitch = document.getElementById('auto-update-switch');

        if (themeToggleSwitch) {
            // Set the theme toggle to active if current theme is dark (not light and not auto)
            // For auto theme, we'll show the current effective theme state
            const effectiveTheme = this.state.theme === 'auto' 
                ? window.matchMedia('(prefers-color-scheme: dark)').matches 
                : this.state.theme !== 'light';
            themeToggleSwitch.classList.toggle('active', effectiveTheme);
        }

        // For demo purposes, setting default states
        if (soundEffectSwitch) {
            soundEffectSwitch.classList.remove('active'); // Default to off
        }

        if (autoUpdateSwitch) {
            autoUpdateSwitch.classList.remove('active'); // Default to off
        }
        
        // Update spatial audio toggle if it exists
        const spatialToggle = document.getElementById('spatial-audio-toggle');
        if (spatialToggle) {
            spatialToggle.classList.toggle('active', this.state.spatialAudioEnabled);
        }

        // Update the settings page if it's currently displayed
        if (this.state.currentNav === 3) {
            this.renderSettings();
        }
    }

    /**
     * Mở modal tải xuống cho một bài hát cụ thể.
     * @param {number} idx - Chỉ số bài hát.
     */
    openDownloadModal(idx) {
        this.state.downloadTargetIndex = idx;
        const song = this.state.playlist[idx];
        this.elements.dlTitle.innerText = song.name;
        this.elements.dlModal.classList.add('show');
    }

    /**
     * Kích hoạt tải xuống file (audio, beat, video, lyric) của bài hát.
     */
    triggerDownload(type) {
        const song = this.state.playlist[this.state.downloadTargetIndex];
        let link = '';
        let fileName = `${song.name}`;

        switch(type) {
            case 'audio': link = song.path; fileName += '.mp3'; break;
            case 'beat': 
                if (!song.instrumental || song.instrumental.includes('chưa có')) { this.showToast('Không có Beat'); return; }
                link = song.instrumental; fileName += ' (Beat).mp3'; break;
            case 'video': 
                if (!song.vid || song.vid.includes('ERROR')) { this.showToast('Không có Video'); return; }
                link = song.vid; fileName += '.mp4'; break;
            case 'lyric': 
                if (!song.lyric || song.lyric.includes('chưa có')) { this.showToast('Không có Lời'); return; }
                link = song.lyric; fileName += '.lrc'; break;
        }

        const a = document.createElement('a'); a.href = link; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        this.showToast(`Đang tải: ${fileName}`);
        this.elements.dlModal.classList.remove('show');
    }

    seek(time) {
        if (isNaN(time)) return;
        this.video.currentTime = time;
        this.audio.currentTime = time;
        this.beatAudio.currentTime = time;
    }

    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
            navigator.mediaSession.setActionHandler('seekto', (details) => this.seek(details.seekTime));
        }
    }

    /**
     * Thiết lập tính năng Picture-in-Picture (PiP).
     */
    setupPiP() {
        if (!('pictureInPictureEnabled' in document) && !('documentPictureInPicture' in window)) return;

        const btn = document.createElement('div');
        btn.className = 'menu-item';
        btn.style.display = 'none';
        btn.innerHTML = `<i class="fa-solid fa-clone"></i> <span>Picture-in-Picture</span> <div class="toggle-switch"></div>`;
        
        btn.onclick = async (e) => {
            e.stopPropagation();
            if (this.state.currentMode === 'lyrics') {
                this.toggleLyricsPiP();
                return;
            }
            try {
                if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture();
                } else {
                    if (!this.currentSongHasVideo) { this.showToast('Bài hát không có video'); return; }
                    if (this.video.readyState === 0) { this.showToast('Video đang tải...'); return; }
                    await this.video.requestPictureInPicture();
                }
            } catch (err) {
                console.error(err);
                this.showToast('Không thể mở PiP');
            }
        };

        if (this.elements.optionsMenu) this.elements.optionsMenu.appendChild(btn);
        this.elements.pipBtn = btn;
        this.video.addEventListener('enterpictureinpicture', () => this.updatePiPButtonUI());
        this.video.addEventListener('leavepictureinpicture', () => this.updatePiPButtonUI());
    }

    setupVideoFullscreen() {
        const container = document.querySelector('.video-container');
        if (!container) return;
        
        const btn = document.createElement('div');
        btn.className = 'btn-icon btn-fullscreen';
        btn.innerHTML = '<i class="fa-solid fa-expand"></i>';
        
        btn.onclick = (e) => {
            e.stopPropagation();
            if (!document.fullscreenElement) {
                if (container.requestFullscreen) container.requestFullscreen();
                else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
            }
        };
        container.appendChild(btn);
        document.addEventListener('fullscreenchange', () => {
            const isFull = !!document.fullscreenElement;
            btn.innerHTML = isFull ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
            this.video.controls = isFull;
        });
    }

    updatePiPButtonUI() {
        if (!this.elements.pipBtn) return;
        const mode = this.state.currentMode;
        const span = this.elements.pipBtn.querySelector('span');
        
        if (mode === 'lyrics') {
            this.elements.pipBtn.style.display = 'flex';
            span.innerText = this.lyricsPiPWindow ? 'Đóng Lyrics PiP' : 'Lyrics PiP';
            this.elements.pipBtn.classList.toggle('active', !!this.lyricsPiPWindow || (!!document.pictureInPictureElement && document.pictureInPictureElement === this.lyricsPipVideo));
        } else {
            this.elements.pipBtn.style.display = this.currentSongHasVideo ? 'flex' : 'none';
            span.innerText = 'Video PiP';
            this.elements.pipBtn.classList.toggle('active', !!document.pictureInPictureElement);
        }
    }

    async toggleLyricsPiP() {
        // Fallback: Canvas PiP cho Mobile/Browsers không hỗ trợ Document PiP
        if (!('documentPictureInPicture' in window)) {
            if (document.pictureInPictureElement && document.pictureInPictureElement === this.lyricsPipVideo) {
                await document.exitPictureInPicture();
                return;
            }
            if (!this.lyricsCanvas) {
                this.lyricsCanvas = document.createElement('canvas');
                this.lyricsCanvas.width = 600; this.lyricsCanvas.height = 300;
                this.lyricsPipVideo = document.createElement('video');
                this.lyricsPipVideo.muted = true; this.lyricsPipVideo.playsInline = true;

                this.lyricsPipVideo.addEventListener('play', () => { if (!this.state.isPlaying) this.play(); });
                this.lyricsPipVideo.addEventListener('pause', () => { if (this.state.isPlaying && this.isLyricsCanvasActive) this.pause(); });

                this.lyricsPipVideo.onleavepictureinpicture = () => {
                    this.isLyricsCanvasActive = false;
                    this.updatePiPButtonUI();
                    this.lyricsPipVideo.pause();
                    // Clean up the video element
                    this.lyricsPipVideo.src = '';
                    this.lyricsPipVideo.srcObject = null;
                };
            }

            // Update canvas with current lyrics before showing PiP
            this.updateLyricsCanvasForPiP();

            if (!this.lyricsPipVideo.srcObject) this.lyricsPipVideo.srcObject = this.lyricsCanvas.captureStream();
            try {
                await this.lyricsPipVideo.play();
                await this.lyricsPipVideo.requestPictureInPicture();
                this.isLyricsCanvasActive = true;
                this.updatePiPButtonUI();
            } catch (e) {
                console.error(e);
                this.showToast('Không thể mở Lyrics PiP');
                this.isLyricsCanvasActive = false;
            }
            return;
        }

        if (this.lyricsPiPWindow) {
            // Close existing PiP window
            this.lyricsPiPWindow.close();
            return;
        }

        try {
            const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 400, height: 600 });
            this.lyricsPiPWindow = pipWindow;

            // Copy styles
            [...document.styleSheets].forEach((styleSheet) => {
                try {
                    const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                    const style = document.createElement('style');
                    style.textContent = cssRules;
                    pipWindow.document.head.appendChild(style);
                } catch (e) {
                    if (styleSheet.href) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = styleSheet.href;
                        pipWindow.document.head.appendChild(link);
                    }
                }
            });
            pipWindow.document.body.style.background = '#121212';
            pipWindow.document.body.style.color = '#fff';
            pipWindow.document.body.style.overflowY = 'auto';

            const container = this.elements.lyricsContainer.cloneNode(true); // Clone instead of moving
            pipWindow.document.body.appendChild(container);

            pipWindow.addEventListener('pagehide', () => {
                this.lyricsPiPWindow = null;
                this.updatePiPButtonUI();
            });
            this.updatePiPButtonUI();
        } catch (err) {
            console.error("Lyrics PiP Error:", err);
            this.showToast('Lỗi mở Lyrics PiP');
        }
    }

    updateLyricsCanvasForPiP() {
        if (!this.lyricsCanvas) return;
        const currentTime = (this.currentSongHasVideo ? this.video.currentTime : this.audio.currentTime) || 0;
        let activeId = null;
        for (let i = 0; i < this.lyricsData.length; i++) {
            if (this.lyricsData[i].time <= currentTime) activeId = this.lyricsData[i].id;
            else break;
        }
        this.updateLyricsCanvas(activeId);
    }

    updateLyricsCanvas(activeId) {
        if (!this.lyricsCanvas) return;
        const ctx = this.lyricsCanvas.getContext('2d');
        ctx.fillStyle = '#121212';
        ctx.fillRect(0, 0, this.lyricsCanvas.width, this.lyricsCanvas.height);

        const activeIndex = this.lyricsData.findIndex(x => x.id === activeId);
        const activeItem = this.lyricsData[activeIndex];
        const nextItem = this.lyricsData[activeIndex + 1];

        const text = activeItem ? activeItem.text : '...';
        const nextText = nextItem ? nextItem.text : '';

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Get the actual primary color value
        const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#ffffff';
        
        // Vẽ dòng hiện tại với màu chủ đạo
        ctx.fillStyle = primaryColor;
        ctx.font = 'bold 32px Arial';
        ctx.fillText(text, this.lyricsCanvas.width / 2, this.lyricsCanvas.height / 2 - 20);

        // Vẽ dòng tiếp theo với màu mờ
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '24px Arial';
        ctx.fillText(nextText, this.lyricsCanvas.width / 2, this.lyricsCanvas.height / 2 + 30);

        // Vẽ tên bài hát nhỏ ��� dưới
        ctx.font = '20px Arial'; ctx.fillStyle = '#888';
        ctx.fillText(this.state.playlist[this.state.currentIndex]?.name || '', this.lyricsCanvas.width / 2, this.lyricsCanvas.height - 40);
    }

    // --- EVENT HANDLERS ---
    setupEventListeners() {
        // Virtual Scroll & Auto Hide Search Bar
        let lastScrollTop = 0;
        const searchWrapper = this.elements.searchInput.closest('.search-wrapper') || this.elements.searchInput.parentElement;

        this.elements.scrollContainer.addEventListener('scroll', () => {
            this.onScroll();

            const scrollTop = this.elements.scrollContainer.scrollTop;
            if (searchWrapper && Math.abs(scrollTop - lastScrollTop) > 5) {
                if (scrollTop > lastScrollTop && scrollTop > 60) {
                    searchWrapper.classList.add('hidden');
                } else if (scrollTop < lastScrollTop) {
                    searchWrapper.classList.remove('hidden');
                }
            }
            lastScrollTop = Math.max(0, scrollTop);
        }, { passive: true });

        window.addEventListener('resize', () => { clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => this.renderPlaylist(), 200); });

        window.addEventListener('beforeunload', () => {
            // Only save position if currently playing
            if (this.state.isPlaying) {
                const t = this.currentSongHasVideo ? this.video.currentTime : (this.state.isBeatMode ? this.beatAudio.currentTime : this.audio.currentTime);
                localStorage.setItem('lastIndex', this.state.currentIndex);
                localStorage.setItem('lastTime', t);
            } else {
                // Clear the saved position if not playing
                localStorage.removeItem('lastIndex');
                localStorage.removeItem('lastTime');
            }

            // Close spatial audio context if active
            if (this.state.spatialAudioEnabled && this.audioContext) {
                this.audioContext.close();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (this.elements.overlay.classList.contains('open')) {
                if (e.key === 'Escape') {
                    this.elements.overlay.classList.remove('open');
                    return;
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    const tabs = ['song', 'video', 'lyrics'];
                    const idx = tabs.indexOf(this.state.currentMode);
                    this.switchTab(tabs[(idx + 1) % tabs.length]);
                    return;
                }
            }

            if (e.code === 'Space') {
                e.preventDefault(); this.togglePlay();
            } else if (e.code === 'ArrowRight') {
                const t = this.currentSongHasVideo ? this.video.currentTime : (this.state.isBeatMode ? this.beatAudio.currentTime : this.audio.currentTime);
                this.seek(t + 5);
            } else if (e.code === 'ArrowLeft') {
                const t = this.currentSongHasVideo ? this.video.currentTime : (this.state.isBeatMode ? this.beatAudio.currentTime : this.audio.currentTime);
                this.seek(t - 5);
            } else if (e.code === 'KeyM') {
                this.state.isMuted = !this.state.isMuted;
                const v = this.state.isMuted ? 0 : this.state.volume;
                this.setVolume(this.state.volume, this.state.isMuted);
                this.showToast(this.state.isMuted ? 'Đã tắt tiếng' : 'Đã bật tiếng');
            } else if (e.code === 'ArrowUp') {
                e.preventDefault();
                this.state.isMuted = false;
                let v = parseFloat(this.state.volume);
                v = Math.min(1, v + 0.1);
                this.setVolume(v, false);
                this.showToast(`Âm lượng: ${Math.round(v * 100)}%`);
            } else if (e.code === 'ArrowDown') {
                e.preventDefault();
                this.state.isMuted = false;
                let v = parseFloat(this.state.volume);
                v = Math.max(0, v - 0.1);
                this.setVolume(v, v === 0);
                this.showToast(`Âm lượng: ${Math.round(v * 100)}%`);
            } else if (e.code === 'KeyA') {
                // Open audio controls modal with keyboard shortcut
                e.preventDefault();
                document.getElementById('audio-controls-modal').classList.add('show');
                // Initially show the keypad
                document.getElementById('keypad-container').style.display = 'block';
                document.getElementById('audio-controls').style.display = 'none';
            }
        });

        // Xử lý khi tab trình duyệt bị ẩn/hiện
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                if (this.state.isPlaying && this.currentSongHasVideo && !this.state.isBeatMode && !document.pictureInPictureElement) {
                    this.isBackgroundFallback = true;
                    const t = this.video.currentTime;
                    this.video.pause();
                    this.audio.currentTime = t;
                    this.audio.play();
                }
            } else {
                if (this.isBackgroundFallback) {
                    this.isBackgroundFallback = false;
                    const t = this.audio.currentTime;
                    this.audio.pause();
                    this.video.currentTime = t;
                    this.video.play();
                }
                if (this.state.isPlaying && this.currentSongHasVideo && this.state.isBeatMode) {
                    const masterTime = this.video.currentTime;
                    if (Math.abs(this.beatAudio.currentTime - masterTime) > 0.5) {
                        this.beatAudio.currentTime = masterTime;
                    }
                }
            }
        });

        // Cập nhật thời gian phát nhạc/video
        const updateTime = (src) => {
            const d = src.duration || 0, c = src.currentTime || 0;
            if (d > 0) this.checkPreload(c, d);
            if (document.hidden) return; 
            if (d > 0) {
                const p = (c / d) * 100;
                this.elements.seekBar.value = p; this.elements.miniFill.style.width = p + '%';
                this.updateRangeInput(this.elements.seekBar);
                document.getElementById('curr-time').innerText = this.formatTime(c);
                document.getElementById('total-time').innerText = this.formatTime(d);
                this.syncLyrics(c);
            }
        };
        // Đồng bộ Master-Slave
        this.video.ontimeupdate = () => {
            if (this.currentSongHasVideo) { // Video là Master
                const masterTime = this.video.currentTime;
                // Luôn đồng bộ audio gốc (đang bị pause) một cách âm thầm
                if (this.audio.currentTime !== masterTime) this.audio.currentTime = masterTime;

                // Nếu ở chế độ beat, beatAudio đang phát. Chỉ đồng bộ khi có độ trễ lớn để tránh giật.
                if (this.state.isBeatMode && !this.beatAudio.paused) {
                    if (Math.abs(this.beatAudio.currentTime - masterTime) > 0.3) {
                        this.beatAudio.currentTime = masterTime;
                    }
                } else if (this.beatAudio.currentTime !== masterTime) { // Nếu không, đồng bộ beatAudio (đang bị pause)
                    this.beatAudio.currentTime = masterTime;
                }
                updateTime(this.video);
            }
        };
        this.audio.ontimeupdate = () => {
            if ((!this.currentSongHasVideo && !this.state.isBeatMode) || this.isBackgroundFallback) { // Audio là Master
                const t = this.audio.currentTime;
                if (this.beatAudio.currentTime !== t && !this.isBackgroundFallback) this.beatAudio.currentTime = t;
                updateTime(this.audio);
            }
        };
        this.beatAudio.ontimeupdate = () => {
            if (!this.currentSongHasVideo && this.state.isBeatMode) { // BeatAudio là Master
                const t = this.beatAudio.currentTime;
                if (this.audio.currentTime !== t) this.audio.currentTime = t;
                updateTime(this.beatAudio);
            }
        };
        
        const onEnd = () => {
            if (this.state.repeatMode === 1) {
                this.seek(0);
                this.play();
            } else {
                this.next();
            }
        };
        // Chỉ trình phát master mới kích hoạt onEnd
        this.video.onended = () => { if (this.currentSongHasVideo) onEnd(); };
        this.audio.onended = () => { if ((!this.currentSongHasVideo && !this.state.isBeatMode) || this.isBackgroundFallback) onEnd(); };
        this.beatAudio.onended = () => { if ((!this.currentSongHasVideo && this.state.isBeatMode) || (document.hidden && this.state.isBeatMode)) onEnd(); };

        this.elements.seekBar.oninput = (e) => {
            const masterPlayer = this.currentSongHasVideo ? this.video : (this.state.isBeatMode ? this.beatAudio : this.audio);
            const duration = masterPlayer.duration;
            if (!duration || isNaN(duration)) return;
            const t = (e.target.value / 100) * duration;
            this.seek(t);
            this.updateRangeInput(e.target);
        };

        // Điều khiển âm lượng
        const volBar = document.getElementById('vol-bar');
        if (volBar) {
            volBar.value = this.state.volume;
            this.updateRangeInput(volBar);
        }
        volBar.oninput = (e) => { 
            this.setVolume(parseFloat(e.target.value), parseFloat(e.target.value) === 0);
        };
        // Nút tắt/bật tiếng
        document.getElementById('btn-mute').onclick = () => { 
            this.setVolume(this.state.volume, !this.state.isMuted);
        };
        this.elements.playBtnMain.onclick = () => { this.resumeAudioContext(); this.togglePlay(); };
        this.elements.playBtnMini.onclick = (e) => { e.stopPropagation(); this.resumeAudioContext(); this.togglePlay(); };
        document.getElementById('btn-next').onclick = () => { this.resumeAudioContext(); this.next(); };
        document.getElementById('btn-mini-next').onclick = (e) => { e.stopPropagation(); this.resumeAudioContext(); this.next(); };
        document.getElementById('btn-prev').onclick = () => { this.resumeAudioContext(); this.prev(); };
        document.getElementById('btn-heart').onclick = () => this.toggleFavorite(this.state.currentIndex);
        document.getElementById('btn-shuffle').onclick = (e) => { this.state.isShuffle = !this.state.isShuffle; e.currentTarget.classList.toggle('active'); this.showToast(this.state.isShuffle ? 'Bật trộn bài' : 'Tắt trộn bài'); };
        document.getElementById('btn-repeat').onclick = (e) => { this.state.repeatMode = this.state.repeatMode === 0 ? 1 : 0; e.currentTarget.classList.toggle('active', this.state.repeatMode === 1); this.showToast(this.state.repeatMode ? 'Lặp 1 bài' : 'Lặp danh sách'); };
        document.getElementById('mini-click-area').onclick = () => this.elements.overlay.classList.add('open');
        // Đóng overlay player
        document.getElementById('btn-close').onclick = () => this.elements.overlay.classList.remove('open');
        document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = () => this.switchTab(btn.dataset.tab));
        // Nút tải xuống trên full player
        document.getElementById('btn-dl').onclick = () => this.openDownloadModal(this.state.currentIndex);
        // Chuyển đổi navigation (Trang ch���, Khám phá, Yêu thích)
        
        document.querySelectorAll('.nav-link').forEach((nav, i) => nav.onclick = () => this.switchNavigation(i));
        document.querySelectorAll('.btn-sort').forEach(btn => btn.onclick = () => this.changeSortOrder(btn.dataset.sort));
        
        document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
            document.querySelectorAll('.chip').forEach(ch => ch.classList.remove('active')); c.classList.add('active');
            this.state.currentFilter = c.dataset.type; this.renderPlaylist();
        });
        this.elements.searchInput.oninput = (e) => {
            this.state.searchQuery = e.target.value;
            // Lưu vị trí scroll hiện tại để khôi phục sau khi render
            const currentScrollTop = this.elements.scrollContainer.scrollTop;
            
            if (this.state.currentNav === 1) { // Trang khám phá
                this.renderExplore();
            } else if (this.state.currentNav === 3) { // Trang cài đặt
                this.renderSettings();
            } else { // Trang chủ và các trang khác
                this.renderPlaylist();
            }
            
            // Khôi phục vị trí scroll sau khi render xong
            setTimeout(() => {
                this.elements.scrollContainer.scrollTop = currentScrollTop;
            }, 0);
        };
        // N��t xóa tìm kiếm
        this.elements.clearSearchBtn.onclick = () => { 
            this.state.searchQuery = ''; 
            this.elements.searchInput.value = ''; 
            if (this.state.currentNav === 3) this.renderSettings();
            else this.renderPlaylist(); 
        };

        // Menu tùy chọn (3 chấm)
        this.elements.btnOptions.onclick = (e) => { e.stopPropagation(); this.elements.optionsMenu.classList.toggle('show'); };
        document.addEventListener('click', (e) => { if (!this.elements.optionsMenu.contains(e.target) && !this.elements.btnOptions.contains(e.target)) this.elements.optionsMenu.classList.remove('show'); });
        this.elements.btnSwitchBeat.onclick = (e) => { e.stopPropagation(); this.toggleBeatMode(); };
        // Hẹn giờ t���t nhạc

        this.elements.btnOpenTimer.onclick = (e) => { e.stopPropagation(); this.elements.timerModal.classList.add('show'); this.elements.optionsMenu.classList.remove('show'); };
        this.elements.btnCloseTimer.onclick = () => this.elements.timerModal.classList.remove('show');
        this.elements.timerModal.onclick = (e) => { if (e.target === this.elements.timerModal) this.elements.timerModal.classList.remove('show'); };
        document.querySelectorAll('.timer-btn').forEach(btn => {
            btn.onclick = () => {
                const min = parseInt(btn.dataset.time); this.startSleepTimer(min);
                document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
                if (min > 0) btn.classList.add('active'); this.elements.timerModal.classList.remove('show');
            };
        });

        // Modal Download
        this.elements.btnCloseDl.onclick = () => this.elements.dlModal.classList.remove('show');
        this.elements.dlModal.onclick = (e) => { if (e.target === this.elements.dlModal) this.elements.dlModal.classList.remove('show'); };
        document.querySelectorAll('.dl-btn').forEach(btn => {
            btn.onclick = () => this.triggerDownload(btn.dataset.type);
        });

        // Share to social media
        const shareButtons = document.querySelectorAll('.btn-share');
        shareButtons.forEach(btn => {
            btn.onclick = () => {
                this.shareCurrentSong();
            };
        });

        // Settings Modal
        const settingsModal = document.getElementById('settings-modal');
        const btnCloseSettings = document.getElementById('btn-close-settings');
        const themeToggleSwitch = document.getElementById('theme-toggle-switch');
        const soundEffectSwitch = document.getElementById('sound-effect-switch');
        const autoUpdateSwitch = document.getElementById('auto-update-switch');

        if (btnCloseSettings && settingsModal) {
            btnCloseSettings.onclick = () => settingsModal.classList.remove('show');
            settingsModal.onclick = (e) => { if (e.target === settingsModal) settingsModal.classList.remove('show'); };
        }

        // Toggle switches in settings modal
        if (themeToggleSwitch) {
            // Update the toggle switch state based on current theme
            const effectiveTheme = this.state.theme === 'auto' 
                ? window.matchMedia('(prefers-color-scheme: dark)').matches 
                : this.state.theme !== 'light';
            themeToggleSwitch.classList.toggle('active', effectiveTheme);

            themeToggleSwitch.onclick = () => {
                // Cycle through theme options: auto -> dark -> light -> auto
                if (this.state.theme === 'auto') {
                    this.state.theme = 'dark';
                } else if (this.state.theme === 'dark') {
                    this.state.theme = 'light';
                } else {
                    this.state.theme = 'auto';
                }

                localStorage.setItem('theme', this.state.theme);
                this.applyTheme();
                this.updateThemeColor();
                this.updateToggleStates();
                this.updateAllRangeInputs();

                // Update the toggle switch state after change
                const newEffectiveTheme = this.state.theme === 'auto' 
                    ? window.matchMedia('(prefers-color-scheme: dark)').matches 
                    : this.state.theme !== 'light';
                themeToggleSwitch.classList.toggle('active', newEffectiveTheme);
            };
        }

        if (soundEffectSwitch) {
            soundEffectSwitch.onclick = () => {
                soundEffectSwitch.classList.toggle('active');
                // Add sound effect toggle functionality here
                this.showToast(soundEffectSwitch.classList.contains('active') ? 'Hiệu ứng âm thanh đã bật' : 'Hiệu ứng âm thanh đã tắt');
            };
        }

        if (autoUpdateSwitch) {
            autoUpdateSwitch.onclick = () => {
                autoUpdateSwitch.classList.toggle('active');
                this.showToast(autoUpdateSwitch.classList.contains('active') ? 'Tự động cập nhật đã bật' : 'Tự động cập nhật đã tắt');
            };
        }

        // Reset Confirmation Modal
        const resetModal = document.getElementById('reset-modal');
        const btnCancelReset = document.getElementById('btn-cancel-reset');
        const btnConfirmReset = document.getElementById('btn-confirm-reset');

        if (btnCancelReset && resetModal) {
            btnCancelReset.onclick = () => resetModal.classList.remove('show');
        }

        if (btnConfirmReset) {
            btnConfirmReset.onclick = () => {
                this.resetApp();
                resetModal.classList.remove('show');
            };
        }

        if (resetModal) {
            resetModal.onclick = (e) => {
                if (e.target === resetModal) resetModal.classList.remove('show');
            };
        }

        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            // Check if theme is set to 'auto' in localStorage or if no theme is set (fallback to auto)
            const storedTheme = localStorage.getItem('theme');
            if (storedTheme === 'auto' || (!storedTheme && document.documentElement.getAttribute('data-theme') === 'auto')) {
                // Update theme based on system preference
                this.state.theme = e.matches ? 'dark' : 'light';
                this.applyTheme();
                this.updateThemeColor();
                this.updateToggleStates();
                this.updateAllRangeInputs();
            }
        });

        // Global click handler to resume audio context if suspended
        document.addEventListener('click', () => {
            this.resumeAudioContext();
        }, { once: false, passive: true });
    }
    /**
     * Cập nhật biểu tượng nút tắt tiếng.
     */
    updateMuteUI() { 
        const btn = document.getElementById('btn-mute');
        if (!btn) return;
        btn.innerHTML = `<i class="fa-solid fa-volume-${this.state.isMuted ? 'xmark' : 'high'}"></i>`;
        btn.style.color = this.state.isMuted ? 'var(--text-sub)' : 'var(--primary)';
    }
    
    // --- NAVIGATION & FILTERING ---
    /**
     * Chuyển đổi giữa các tab (Song, Video, Lyrics) trong full player.
     * @param {string} tab - Tên tab ('song', 'video', 'lyrics').
     */
    // --- FIX LỖI RESET NHẠC KHI CHUYỂN TAB LYRICS ---
    // --- REFACTORED FOR HOT-SWAPPING ---
    switchTab(tab) {
        // Close lyrics PiP when switching away from lyrics tab
        if (this.state.currentMode === 'lyrics' && tab !== 'lyrics') {
            if (this.lyricsPiPWindow) {
                this.lyricsPiPWindow.close();
                this.lyricsPiPWindow = null;
            }

            if (this.lyricsPipVideo && document.pictureInPictureElement === this.lyricsPipVideo) {
                this.lyricsPipVideo.exitPictureInPicture().catch(() => {});
            }
        }

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        document.querySelectorAll('.stage-view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${tab}`).classList.add('active');

        this.state.currentMode = tab;
        this.updatePiPButtonUI();

        // Logic mới: Chỉ thay đổi UI, không can thiệp vào trình phát đang chạy.
        // Trình phát (video hoặc audio) sẽ tiếp tục chạy nền, đảm bảo âm thanh liền mạch.
        if (tab === 'video') {
            if (!this.currentSongHasVideo) {
                // Nếu đang phát nhạc (chỉ audio) và người dùng chuyển sang tab video, hãy dừng phát.
                if (this.state.isPlaying) {
                    this.pause();
                    this.showToast('Video không khả dụng');
                }
                this.elements.videoMsg.style.display = 'flex';
                this.elements.videoMsg.innerHTML = '<span>Không có Video</span>';
            } else {
                // Nếu có video, đảm bảo thông báo được ẩn đi.
                this.elements.videoMsg.style.display = 'none';
            }
        }
    }

    /**
     * Setup swipe gestures for full player tabs
     */
    setupTabSwipeGestures() {
        const views = document.querySelectorAll('.stage-view');
        if (!views || views.length === 0) return;

        const tabs = ['song', 'video', 'lyrics'];
        
        views.forEach(view => {
            let startX = 0;
            let startY = 0;
            let isSwiping = false;
            const SWIPE_THRESHOLD = 30; // Minimum distance to trigger swipe
            
            view.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                isSwiping = true;
            }, { passive: true });

            view.addEventListener('touchmove', (e) => {
                if (!isSwiping) return;
                
                const moveX = e.touches[0].clientX;
                const moveY = e.touches[0].clientY;
                
                // Check if vertical movement is greater than horizontal (to avoid conflicts with scroll)
                const diffX = Math.abs(moveX - startX);
                const diffY = Math.abs(moveY - startY);
                
                if (diffY > diffX) {
                    // Vertical movement, don't interfere
                    return;
                }
                
                // Prevent horizontal scroll if swiping horizontally
                if (diffX > 10) {
                    e.preventDefault();
                }
            }, { passive: false });

            view.addEventListener('touchend', (e) => {
                if (!isSwiping) return;
                
                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                
                const diffX = startX - endX; // Negative = swipe right, Positive = swipe left
                const diffY = startY - endY;
                
                // Check if horizontal movement is significant and greater than vertical
                if (Math.abs(diffX) > SWIPE_THRESHOLD && Math.abs(diffX) > Math.abs(diffY)) {
                    // Determine current tab index
                    const currentIndex = tabs.indexOf(this.state.currentMode);
                    
                    if (diffX > 0) {
                        // Swipe left - go to next tab
                        const nextIndex = (currentIndex + 1) % tabs.length;
                        this.switchTab(tabs[nextIndex]);
                    } else {
                        // Swipe right - go to previous tab
                        const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                        this.switchTab(tabs[prevIndex]);
                    }
                }
                
                isSwiping = false;
            }, { passive: true });
        });
    }

    // --- LYRICS MANAGEMENT ---
    /**
     * Tải lời bài hát từ URL và hiển thị lên giao diện. */
    async loadLyrics(url) {
        const c = this.elements.lyricsContainer; c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Đang tải...</p>'; this.lyricsData = [];
        if (!url) { c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Không có lời bài hát</p>'; return; }
        try {
            const txt = await (await fetch(url)).text();
            c.innerHTML = '<div style="height:40vh"></div>';
            txt.split('\n').forEach((line, i) => {
                const m = line.match(/^\[(\d{2}):(\d{2})(\.\d+)?\](.*)/);
                if (m) {
                    const t = parseInt(m[1])*60 + parseInt(m[2]) + (m[3]?parseFloat(m[3]):0);
                    if (m[4].trim()) {
                        this.lyricsData.push({ time: t, id: `l-${i}`, text: m[4].trim() });
                        const p = document.createElement('p'); p.className = 'lyric-row'; p.id = `l-${i}`; p.innerText = m[4].trim();
                        p.onclick = () => { this.seek(t); };
                        c.appendChild(p);
                    }
                }
            });
            c.innerHTML += '<div style="height:40vh"></div>';
        } catch { c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Lỗi tải lời</p>'; }
    }

    /**
     * Đồng bộ lời bài hát với thời gian phát nhạc.
     */
    syncLyrics(t) {
        if (!this.lyricsData.length) return;
        let id = null;
        for (let i = 0; i < this.lyricsData.length; i++) { if (this.lyricsData[i].time <= t) id = this.lyricsData[i].id; else break; }
        if (id) {
            const curr = this.elements.lyricsContainer.querySelector('.lyric-row.active'); 
            if (curr && curr.id !== id) {
                curr.classList.remove('active');
                // Reset color to default for previous active line
                curr.style.color = '';
                curr.style.opacity = '';
            }
            const next = this.elements.lyricsContainer.querySelector('#' + id); 
            if (next && !next.classList.contains('active')) { 
                next.classList.add('active'); 
                // Apply primary color to active line
                next.style.color = 'var(--primary)';
                next.style.opacity = '1';
                next.scrollIntoView({ behavior: 'smooth', block: 'center' }); 
            }
            // Update canvas PiP lyrics if active
            if (this.isLyricsCanvasActive && this.lyricsCanvas) {
                this.updateLyricsCanvas(id);
            }
        }
    }

    // --- UI RENDERING & UPDATES (tiếp theo) ---
    /**
     * Kiểm tra và kích hoạt hiệu ứng marquee cho tiêu đề bài hát nếu quá dài.
     */
    checkMarquee() {
        const t = document.getElementById('full-title');
        const b = t ? t.closest('.marquee-wrapper') : null;
        if (!t || !b) return;

        t.parentElement.classList.remove('animate'); void t.offsetWidth;
        
        if (t.scrollWidth > b.clientWidth) { 
            t.parentElement.classList.add('animate'); 
            if (!t.getAttribute('d')) { t.innerHTML += ` &nbsp; • &nbsp; ${t.innerHTML}`; t.setAttribute('d', '1'); } 
        }
    }
    /**
     * Hiển thị thông báo toast.
     * @param {string} msg - Nội dung thông báo.
     */
    showToast(msg) { this.elements.toastMsg.innerText = msg; this.elements.toast.classList.add('show'); setTimeout(() => this.elements.toast.classList.remove('show'), 3000); }
    /**
     * Chuyển đổi giữa các mục điều hướng chính (Trang chủ, Khám phá, Yêu thích).
     * @param {number} i - Chỉ số của mục điều hướng.
     */
    switchNavigation(i) {
        if (this.state.currentNav === i) return;

        this.elements.list.style.opacity = '0';
        this.elements.list.style.transform = 'translateY(10px)';

        setTimeout(() => {
            document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active')); document.querySelectorAll('.nav-link')[i].classList.add('active');
            
            this.state.currentNav = i; this.state.currentFilter = 'all'; this.state.searchQuery = ''; 
            const titles = ['Danh sách phát', 'Khám phá', 'Bài hát yêu thích', 'Cài đặt'];
            const subtitles = [
                'Cập nhật hôm nay • Dành riêng cho bạn',
                'Khám phá các thể loại nhạc mới',
                'Danh sách bài hát bạn yêu thích',
                'Tùy chỉnh cài đặt ứng dụng'
            ];

            document.querySelector('.list-header h2').innerText = titles[i];
            const subtitleEl = document.querySelector('.list-header p');
            if (subtitleEl) subtitleEl.innerText = subtitles[i];

            document.getElementById('sort-controls').style.display = (i===0) ? 'flex' : 'none';
            this.elements.searchInput.placeholder = i === 3 ? 'Tìm kiếm cài đặt...' : 'Tìm kiếm bài hát, nghệ sĩ...';
            
            const chips = document.querySelector('.chips-wrapper');
            if (chips) chips.style.display = 'none';

            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); 
            const chip = document.querySelector('.chip');
            if (chip) chip.classList.add('active');
            
            if (i===2) this.state.currentFilter = 'favorites';
            
            if (i === 1) this.renderExplore();
            else if (i === 3) this.renderSettings();
            else this.renderPlaylist();

            if (this.elements.scrollContainer) this.elements.scrollContainer.scrollTop = 0;

            this.elements.list.style.opacity = '1';
            this.elements.list.style.transform = 'translateY(0)';
            
            // Ensure search bar visibility is handled correctly after navigation
            setTimeout(() => {
                const searchWrapper = this.elements.searchInput.closest('.search-wrapper') || this.elements.searchInput.parentElement;
                if (this.elements.scrollContainer.scrollTop > 60) {
                    searchWrapper.classList.add('hidden');
                } else {
                    searchWrapper.classList.remove('hidden');
                }
            }, 250); // Slightly after the animation completes
        }, 200);
    }
    changeSortOrder(s) { this.state.sortBy = s; document.querySelectorAll('.btn-sort').forEach(b => b.classList.remove('active')); document.querySelector(`[data-sort="${s}"]`).classList.add('active'); this.renderPlaylist(); }
    
    /**
     * Share current song to social media
     */
    async shareCurrentSong() {
        const currentSong = this.state.playlist[this.state.currentIndex];
        if (!currentSong) return;

        const shareData = {
            title: currentSong.name,
            text: `Nghe bài "${currentSong.name}" bởi ${currentSong.artist} trên Music Pro Ultimate`,
            url: window.location.href
        };

        // Check if Web Share API is supported
        if (navigator.share) {
            try {
                await navigator.share(shareData);
                this.showToast('Đã chia sẻ bài hát!');
            } catch (err) {
                console.error('Error sharing:', err);
                this.copyShareLink(); // Fallback to copying link
            }
        } else {
            // Fallback: copy link to clipboard
            this.copyShareLink();
        }
    }

    /**
     * Copy share link to clipboard
     */
    copyShareLink() {
        const currentSong = this.state.playlist[this.state.currentIndex];
        if (!currentSong) return;

        const shareText = `Nghe bài "${currentSong.name}" bởi ${currentSong.artist} trên Music Pro Ultimate\n${window.location.href}`;
        
        if (navigator.clipboard) {
            navigator.clipboard.writeText(shareText).then(() => {
                this.showToast('Liên kết đã được sao chép!');
            }).catch(() => {
                this.fallbackCopyText(shareText);
            });
        } else {
            this.fallbackCopyText(shareText);
        }
    }

    /**
     * Fallback method to copy text to clipboard
     */
    fallbackCopyText(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        this.showToast('Liên kết đã được sao chép!');
    }

    /**
     * Reset toàn bộ ứng dụng về cài đặt gốc.
     */
    resetApp() {
        // Clear all localStorage data
        localStorage.clear();

        // Show confirmation message
        this.showToast('Đã khôi phục cài đặt gốc thành công!');

        // Reload the page after a short delay
        setTimeout(() => {
            location.reload();
        }, 1500);
    }

    // --- UTILITIES ---
    /**
     * Định dạng thời gian từ giây sang định dạng "phút:giây".
     * @param {number} s - Thời gian tính bằng giây.
     */
    formatTime(s) { if (isNaN(s)) return "0:00"; const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec<10?'0':''}${sec}`; }
}

window.app = new MusicPro();
