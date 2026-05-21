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
        const res = await fetch(TRACKS_URL + '?v=' + Date.now(), { cache: 'no-cache' });
        if (res.ok) {
            const text = await res.text();
            const sandbox = {};
            const getter = new Function('window', `${text}; return window.TRACKS || [];`);
            return getter(sandbox) || [];
        }
    } catch (e) { console.log('Lấy dữ liệu từ xa không thành công, thử cục bộ...'); }

    try {
        const res = await fetch('src/tracks.js');
        if (res.ok) {
            const text = await res.text();
            const sandbox = {};
            const getter = new Function('window', `${text}; return window.TRACKS || [];`);
            return getter(sandbox) || [];
        }
    } catch (e) { console.error('lỗi khi lấy dữ liệu track', e); }
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
        this.beatAudio.className = "musicpro-agent";

        this.audio = new Audio();
        this.audio.preload = "metadata";
        this.audio.className = "musicpro-agent";

        this.preloadAudioAgent = new Audio();
        this.preloadVideoAgent = document.createElement('video');
        this.preloadVideoAgent.preload = "auto";
        this.preloadVideoAgent.muted = true;

        this.video = document.getElementById('video-element');
        this.lyricsData = [];
        
        // Custom elements mapping gọn hơn
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
        this.init(); // Gọi hàm khởi tạo bất đồng bộ
    }

    // SỬA LỖI 1: Thêm async cho hàm init core
    async init() {
        this.applyTheme();
        this.injectStyles(); // Tách phần inject css ra ngoài cho sạch code

        // Tải dữ liệu từ xa
        const rawTracks = await loadRemoteTracks();
        this.state.playlist = normalizeTracks(rawTracks);
        
        this.renderPlaylist();
        this.renderContextQueue(); 

        this.setVolume(this.state.volume, this.state.volume === 0);
        this.initializeHeaderAvatar();
        this.setupCustomUIComponents();
        this.setupEventListeners();
        
        // Tắt hiệu ứng loader khi đã load xong dữ liệu
        if (this.elements.loader) {
            setTimeout(() => { 
                this.elements.loader.style.opacity = '0'; 
                setTimeout(() => this.elements.loader.style.display = 'none', 500); 
            }, 500);
        }
    }

    injectStyles() {
        if (document.getElementById('musicpro-dynamic-styles')) return;
        const style = document.createElement('style');
        style.id = 'musicpro-dynamic-styles';
        style.innerHTML = `
            #track-list { transition: opacity 0.2s ease-out, transform 0.2s ease-out; opacity: 1; transform: translateY(0); }
            .modal-content { scrollbar-width: none; -ms-overflow-style: none; }
            .modal-content::-webkit-scrollbar { display: none; }
            @media (max-width: 480px) { .modal-content { padding: 20px !important; width: 95% !important; } }
            .full-player-artwork-container { position: relative; overflow: hidden; width: 100%; height: 100%; border-radius: 20px; }
            #full-artwork { transition: opacity 0.1s linear; z-index: 2; position: relative; width: 100%; height: 100%; object-fit: cover; border-radius: 20px; }
            .swipe-hint-container { position: absolute; bottom: 30px; left: 0; width: 100%; display: flex; justify-content: center; z-index: 3; pointer-events: none; }
            .swipe-hint-content { display: flex; flex-direction: column; align-items: center; padding: 8px 20px; background: rgba(127, 127, 127, 0.1); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border-radius: 30px; border: 1px solid rgba(255, 255, 255, 0.05); animation: swipeHintCycle 20s infinite; position: relative; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            .context-queue-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-surface); z-index: 1; border-radius: 20px; opacity: 0; display: flex; flex-direction: column; transition: opacity 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
            .queue-header { padding: 15px; font-weight: 700; font-size: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); text-align: center; }
            .queue-list { flex: 1; overflow-y: auto; padding: 10px; scrollbar-width: none; }
            .queue-item { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; margin-bottom: 5px; cursor: pointer; }
            .queue-item.active { background: var(--primary); color: white; }
            @keyframes swipeHintCycle { 0%, 30%, 100% { opacity: 0; transform: translateY(30px); } 50%, 80% { opacity: 1; transform: translateY(0); } }
        `;
        document.head.appendChild(style);
    }

    setupCustomUIComponents() {
        const btnHeart = document.getElementById('btn-heart');
        if (btnHeart && btnHeart.parentNode && !document.getElementById('btn-add-quick')) {
            const btnAdd = document.createElement('button');
            btnAdd.id = 'btn-add-quick';
            btnAdd.className = 'btn-icon';
            btnAdd.innerHTML = '<i class="fa-solid fa-plus"></i>';
            btnAdd.onclick = (e) => { e.stopPropagation(); this.showAddToPlaylistModal(this.state.currentIndex); };
            btnHeart.parentNode.insertBefore(btnAdd, btnHeart.nextSibling);
        }
        const btnDl = document.getElementById('btn-dl');
        if (btnDl) btnDl.style.display = 'none';
        
        this.reorderOptionsMenu();
        this.setupSwipeUI();
    }

    // SỬA LỖI 3: Thay 'app.hàm()' bằng việc gán sự kiện trực tiếp bằng JS
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

        const startIndex = renderStartRow * itemsPerRow;
        const endIndex = Math.min(totalItems, renderEndRow * itemsPerRow);

        this.elements.list.style.paddingTop = `${renderStartRow * rowHeight}px`;
        this.elements.list.style.paddingBottom = `${(totalRows - renderEndRow) * rowHeight}px`;

        this.elements.list.innerHTML = '';
        const frag = document.createDocumentFragment();
        
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

            // Thay vì dùng onclick dạng text, gán trực tiếp qua Element Event Listener để tránh lỗi không tìm thấy biến "app"
            item.querySelector('.btn-favorite-sm').onclick = (e) => { e.stopPropagation(); this.toggleFavorite(realIdx); };
            item.querySelector('.btn-download-sm').onclick = (e) => { e.stopPropagation(); this.openDownloadModal(realIdx); };
            item.querySelector('.btn-more-sm').onclick = (e) => { e.stopPropagation(); this.showTrackContextMenu(realIdx, e); };
            
            item.onclick = (e) => { 
                if (!e.target.closest('.btn-icon')) this.playIndex(realIdx); 
            };

            frag.appendChild(item);
        }
        this.elements.list.appendChild(frag);
    }

    // SỬA LỖI 2: Loại bỏ hoặc bọc an toàn Pictures In Picture tự động đổi bài
    loadSong(idx, autoPlay = true) {
        // Tạm đóng PiP cũ một cách an toàn
        if (this.lyricsPiPWindow) {
            this.lyricsPiPWindow.close();
            this.lyricsPiPWindow = null;
        }

        this.pause(); 
        this.state.currentIndex = idx;
        this.state.isPreloading = false;
        this.state.nextTrackData = null;

        const song = this.state.playlist[idx];
        this.updateUI(song);
        this.updateHeartButton();
        this.updateBeatBtnUI();
        this.renderPlaylist();
        this.loadLyrics(song.lyric);
        this.renderContextQueue(); 
        this.addToHistory(song.id);

        this.currentSongHasVideo = !!(song.vid && !song.vid.includes('..4.mp4') && !song.vid.includes('ERROR'));
        this.updatePiPButtonUI();

        this.video.src = this.currentSongHasVideo ? song.vid : '';
        this.audio.src = song.path;
        this.beatAudio.src = (song.instrumental && song.instrumental !== 'Tạm thời chưa có!') ? song.instrumental : '';

        if (autoPlay) {
            this.resumeAudioContext();
            this.play();
        }
        this.checkMarquee();
    }

    /* Các hàm UI/Thẩm mỹ/Helper giữ nguyên giống cấu trúc cũ của bạn... */
    getInitialTheme() { const saved = localStorage.getItem('theme'); return saved || 'light'; }
    applyTheme() { document.documentElement.setAttribute('data-theme', this.state.theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light') : this.state.theme); }
    showToast(msg) { if(this.elements.toastMsg) { this.elements.toastMsg.innerText = msg; this.elements.toast.classList.add('show'); setTimeout(() => this.elements.toast.classList.remove('show'), 3000); } }
    formatTime(s) { if (isNaN(s)) return "0:00"; const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec<10?'0':''}${sec}`; }
    // .... Toàn bộ code xử lý logic phụ tải nhạc/bố cục/equalizer giả lập giữ nguyên bên dưới ....
}

// Khởi tạo app an toàn
document.addEventListener("DOMContentLoaded", () => {
    window.app = new MusicPro();
});
