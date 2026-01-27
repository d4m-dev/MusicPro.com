const TRACKS_URL = 'https://raw.githubusercontent.com/d4m-dev/media/refs/heads/main/load-track/tracks.js';

const normalizeTracks = (items = []) => items.map((item) => ({
    id: item.id,
    name: item.title || item.name || 'Tạm thời chưa có!',
    artist: item.artist || 'Tạm thời chưa có!',
    artwork: item.cover || item.artwork || 'Tạm thời chưa có!',
    path: item.audioSrc || item.path || 'Tạm thời chưa có!',
    instrumental: item.instrumentalSrc || item.instrumental || 'Tạm thời chưa có!',
    vid: item.videoSrc || item.vid || 'Tạm thời chưa có!',
    lyric: item.lyricSrc || item.lyric || 'Tạm thời chưa có!'
}));

const loadRemoteTracks = async () => {
    if (Array.isArray(window.TRACKS) && window.TRACKS.length) return window.TRACKS;
    try {
        const res = await fetch(TRACKS_URL, { cache: 'no-store' });
        const text = await res.text();
        const sandbox = {};
        const getter = new Function('window', `${text}; return window.TRACKS || [];`);
        const data = getter(sandbox);
        return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
};

class MusicPro {
    constructor() {
        this.state = {
            playlist: [], currentIndex: 0, isPlaying: false, isShuffle: false, repeatMode: 0, 
            currentMode: 'audio', volume: 0.8, isMuted: false, theme: localStorage.getItem('theme') || 'dark',
            favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
            currentFilter: 'all', searchQuery: '', sortBy: 'id', currentNav: 0, isBeatMode: false,
            
            // State để kiểm soát preload, tránh tải đi tải lại nhiều lần
            hasPreloaded: false 
        };

        this.audio = new Audio();
        // Tạo thêm 1 Audio object để tải ngầm (Preloader)
        this.preloadAudio = new Audio(); 
        
        this.video = document.getElementById('video-element');
        this.lyricsData = [];
        this.elements = {
            loader: document.getElementById('loader'), list: document.getElementById('track-list'),
            overlay: document.getElementById('player-overlay'), mini: document.getElementById('mini-player'),
            toast: document.getElementById('toast'), toastMsg: document.getElementById('toast-msg'),
            playBtnMain: document.getElementById('btn-main-play'), playBtnMini: document.getElementById('btn-mini-play'),
            seekBar: document.getElementById('seek-bar'), miniFill: document.getElementById('mini-fill'),
            ambient: document.getElementById('ambient-light'), videoMsg: document.getElementById('video-msg'),
            searchInput: document.getElementById('search-input'), clearSearchBtn: document.getElementById('btn-clear-search'),
            btnOptions: document.getElementById('btn-options'), optionsMenu: document.getElementById('options-menu'),
            btnSwitchBeat: document.getElementById('btn-switch-beat')
        };
        this.init();
    }

    async init() {
        this.applyTheme();
        const rawTracks = await loadRemoteTracks();
        this.state.playlist = normalizeTracks(rawTracks);
        this.renderPlaylist();
        if (this.state.playlist.length > 0) this.loadSong(0, false);
        document.getElementById('sort-controls').style.display = 'flex';
        setTimeout(() => { this.elements.loader.style.opacity = '0'; setTimeout(() => this.elements.loader.style.display = 'none', 500); }, 800);
        this.setupEventListeners();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.state.theme);
        const icon = document.querySelector('#theme-btn i');
        icon.className = this.state.theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
    toggleTheme() {
        this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', this.state.theme);
        this.applyTheme();
    }

    getDisplayPlaylist() {
        let display = [...this.state.playlist];
        if (this.state.currentFilter === 'favorites') display = display.filter(t => this.state.favorites.includes(String(t.id)));
        else if (this.state.currentFilter === 'remix') display = display.filter(t => (window.PLAYLIST_REMIX || []).includes(String(t.id)));
        else if (this.state.currentFilter === 'tet') display = display.filter(t => (window.PLAYLIST_TET || []).includes(String(t.id)));
        else if (this.state.currentFilter === 'lofi') display = display.filter(t => (window.PLAYLIST_LOFI || []).includes(String(t.id)));
        
        const q = this.state.searchQuery.toLowerCase().trim();
        if (q) display = display.filter(t => t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));
        
        if (this.state.sortBy === 'name') display.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
        else display.sort((a, b) => b.id - a.id);
        return display;
    }

    renderPlaylist() {
        this.elements.list.innerHTML = '';
        const display = this.getDisplayPlaylist();
        this.elements.clearSearchBtn.style.display = this.state.searchQuery ? 'flex' : 'none';
        if (!display.length) { this.elements.list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sub)">Không tìm thấy bài hát</div>`; return; }
        const frag = document.createDocumentFragment();
        display.forEach(track => {
            const idx = this.state.playlist.findIndex(t => t.id === track.id);
            const item = document.createElement('div');
            item.className = 'track-item';
            if (idx === this.state.currentIndex) item.classList.add('active');
            const isFav = this.state.favorites.includes(String(track.id));
            item.innerHTML = `<div class="track-thumb"><img src="${track.artwork}" loading="lazy"><div class="wave-anim"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div><div class="track-info"><div class="track-title">${track.name}</div><div class="track-artist">${track.artist}</div></div><div style="display:flex;gap:5px"><button class="btn-icon btn-favorite-sm ${isFav?'active':''}" onclick="event.stopPropagation();app.toggleFavorite(${idx})"><i class="fa-${isFav?'solid':'regular'} fa-heart"></i></button><button class="btn-icon btn-download-sm" onclick="event.stopPropagation();app.downloadSong(${idx})"><i class="fa-solid fa-download"></i></button></div>`;
            item.onclick = (e) => { if (!e.target.closest('.btn-download-sm') && !e.target.closest('.btn-favorite-sm')) this.playIndex(idx); };
            frag.appendChild(item);
        });
        this.elements.list.appendChild(frag);
    }

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
    updateHeartButton() {
        const isFav = this.state.favorites.includes(String(this.state.playlist[this.state.currentIndex].id));
        document.getElementById('btn-heart').className = `btn-icon ${isFav ? 'active' : ''}`;
        document.getElementById('btn-heart').innerHTML = `<i class="fa-${isFav ? 'solid' : 'regular'} fa-heart"></i>`;
    }

    loadSong(idx, autoPlay = true) {
        this.state.currentIndex = idx;
        this.state.hasPreloaded = false; // Reset trạng thái preload cho bài mới
        
        const song = this.state.playlist[idx];
        document.getElementById('full-title').innerText = song.name;
        document.getElementById('full-artist').innerText = song.artist;
        document.getElementById('mini-title').innerText = song.name;
        document.getElementById('mini-artist').innerText = song.artist;
        document.getElementById('full-artwork').src = song.artwork;
        document.getElementById('mini-img').src = song.artwork;
        this.updateBeatBtnUI();

        const src = this.state.isBeatMode && song.instrumental !== 'Tạm thời chưa có!' ? song.instrumental : song.path;
        this.audio.src = src;
        
        const hasVideo = song.vid && !song.vid.includes('..4.mp4') && !song.vid.includes('ERROR');
        this.video.src = hasVideo ? song.vid : '';
        this.video.muted = this.state.currentMode === 'video' ? this.state.isBeatMode : false;
        
        this.loadLyrics(song.lyric);
        this.renderPlaylist();
        this.updateHeartButton();
        
        const hue = (idx * 50) % 360;
        this.elements.ambient.style.background = `radial-gradient(circle, hsl(${hue},70%,50%), transparent 70%)`;

        if (autoPlay) {
            if (this.state.currentMode === 'video' && this.video.src) this.playVideo();
            else {
                if (this.state.currentMode === 'video') { this.showToast('Không có Video'); this.switchTab('song'); }
                this.playAudio();
            }
        }
        this.checkMarquee();
    }

    toggleBeatMode() {
        const song = this.state.playlist[this.state.currentIndex];
        if (!song.instrumental || song.instrumental === 'Tạm thời chưa có!') { this.showToast('Chưa có Beat!'); return; }
        
        const t = this.state.currentMode === 'video' ? this.video.currentTime : this.audio.currentTime;
        this.state.isBeatMode = !this.state.isBeatMode;
        this.updateBeatBtnUI();

        if (this.state.currentMode === 'video' && this.video.src) {
            if (this.state.isBeatMode) {
                this.video.muted = true; this.audio.src = song.instrumental; this.audio.currentTime = t;
                if (this.state.isPlaying) { this.audio.play(); this.video.play(); }
                this.showToast('Chế độ Beat (Video Mute)');
            } else {
                this.video.muted = false; this.audio.pause(); this.audio.src = song.path;
                this.showToast('Tắt Beat');
            }
        } else {
            this.audio.src = this.state.isBeatMode ? song.instrumental : song.path;
            this.audio.currentTime = t;
            if (this.state.isPlaying) this.audio.play();
            this.showToast(this.state.isBeatMode ? 'Chế độ Beat' : 'Tắt Beat');
        }
    }
    updateBeatBtnUI() { this.elements.btnSwitchBeat.classList.toggle('active', this.state.isBeatMode); }

    playIndex(idx) { this.loadSong(idx, true); }
    
    playAudio() {
        this.video.pause(); this.state.currentMode = 'audio';
        const src = this.state.isBeatMode ? this.state.playlist[this.state.currentIndex].instrumental : this.state.playlist[this.state.currentIndex].path;
        if (this.audio.src !== src) this.audio.src = src;
        this.audio.play().then(() => { this.state.isPlaying = true; this.updatePlayState(); });
    }
    
    playVideo() {
        this.state.currentMode = 'video';
        this.elements.videoMsg.style.display = 'flex';
        this.elements.videoMsg.innerHTML = '<div class="loader-ring" style="width:30px;height:30px;border-width:3px;"></div>';
        if (this.state.isBeatMode) { this.video.muted = true; this.audio.play(); } else { this.video.muted = false; this.audio.pause(); }
        this.video.play().then(() => {
            this.state.isPlaying = true; this.updatePlayState(); this.elements.videoMsg.style.display = 'none';
        }).catch(() => {
            this.state.isPlaying = false; this.updatePlayState();
            this.elements.videoMsg.innerHTML = '<span>Video lỗi</span>';
        });
    }
    
    pause() { this.audio.pause(); this.video.pause(); this.state.isPlaying = false; this.updatePlayState(); }
    togglePlay() { this.state.isPlaying ? this.pause() : (this.state.currentMode === 'video' && this.video.src ? this.playVideo() : this.playAudio()); }
    updatePlayState() {
        const icon = this.state.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        this.elements.playBtnMain.innerHTML = icon; this.elements.playBtnMini.innerHTML = icon;
        document.querySelectorAll('.wave-anim .bar').forEach(b => b.style.animationPlayState = this.state.isPlaying ? 'running' : 'paused');
        if (this.state.isPlaying) this.elements.mini.classList.remove('hide');
    }

    // --- LOGIC TÌM BÀI TIẾP THEO (TÁCH RIÊNG) ---
    getNextIndex() {
        const display = this.getDisplayPlaylist(); 
        if (!display.length) return -1;
        const curr = this.state.playlist[this.state.currentIndex];
        let idx = display.findIndex(t => t.id === curr.id);
        let nextIdx = 0;
        
        if (this.state.isShuffle) {
            if (display.length > 1) {
                // Logic shuffle đơn giản (có thể cải thiện để không lặp)
                do { nextIdx = Math.floor(Math.random() * display.length); } while (nextIdx === idx);
            }
        } else { 
            if (idx !== -1) nextIdx = idx + 1 >= display.length ? 0 : idx + 1; 
        }
        
        // Trả về index gốc trong playlist tổng
        return this.state.playlist.findIndex(t => t.id === display[nextIdx].id);
    }

    // --- HÀM PRELOAD THÔNG MINH ---
    preloadNextTrack() {
        if (this.state.hasPreloaded) return; // Nếu đã tải rồi thì thôi
        
        const nextIdx = this.getNextIndex();
        if (nextIdx !== -1) {
            const nextSong = this.state.playlist[nextIdx];
            const src = this.state.isBeatMode ? nextSong.instrumental : nextSong.path;
            
            // Dùng audio ẩn để fetch dữ liệu vào cache trình duyệt
            this.preloadAudio.src = src;
            this.preloadAudio.load(); // Kích hoạt tải ngay lập tức
            
            console.log(`Đang tải trước: ${nextSong.name}`);
            this.state.hasPreloaded = true;
        }
    }

    next() {
        const nextIdx = this.getNextIndex();
        if (nextIdx !== -1) this.loadSong(nextIdx, true);
    }

    prev() {
        const display = this.getDisplayPlaylist(); if (!display.length) return;
        const curr = this.state.playlist[this.state.currentIndex];
        let idx = display.findIndex(t => t.id === curr.id);
        let prevIdx = 0;
        if (idx !== -1) prevIdx = idx - 1 < 0 ? display.length - 1 : idx - 1;
        const masterIdx = this.state.playlist.findIndex(t => t.id === display[prevIdx].id);
        this.loadSong(masterIdx, true);
    }

    setupEventListeners() {
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && this.state.currentMode === 'video' && this.state.isBeatMode) {
                this.video.currentTime = this.audio.currentTime;
                if (this.state.isPlaying) this.video.play();
            }
        });

        const updateTime = (src) => {
            if (document.hidden) return; 

            const d = src.duration || 0, c = src.currentTime || 0;
            
            // 1. Sync Beat Mode
            if (this.state.currentMode === 'video' && this.state.isBeatMode && !document.hidden) {
                if (Math.abs(this.audio.currentTime - this.video.currentTime) > 0.3) {
                    this.audio.currentTime = this.video.currentTime;
                }
                if (!this.video.paused && this.audio.paused) this.audio.play();
            }

            // 2. TRIGGER PRELOAD KHI CÒN 15s
            if (d > 0 && (d - c) < 15) {
                this.preloadNextTrack();
            }

            if (d > 0) {
                const p = (c / d) * 100;
                this.elements.seekBar.value = p; this.elements.miniFill.style.width = p + '%';
                document.getElementById('curr-time').innerText = this.formatTime(c);
                document.getElementById('total-time').innerText = this.formatTime(d);
                this.syncLyrics(c);
            }
        };
        
        this.audio.ontimeupdate = () => { 
            if (this.state.currentMode === 'audio' || (this.state.currentMode === 'video' && this.state.isBeatMode)) updateTime(this.audio); 
        };
        this.video.ontimeupdate = () => { if (this.state.currentMode === 'video') updateTime(this.video); };
        
        const onEnd = () => {
            if (this.state.repeatMode === 1) {
                if (this.state.currentMode === 'video') { 
                    this.video.currentTime = 0; this.video.play(); 
                    if (this.state.isBeatMode) { this.audio.currentTime = 0; this.audio.play(); } 
                }
                else { this.audio.currentTime = 0; this.audio.play(); }
            } else this.next();
        };
        this.audio.onended = onEnd;
        this.video.onended = () => { if (this.state.currentMode === 'video') onEnd(); };

        this.elements.seekBar.oninput = (e) => {
            const t = (e.target.value / 100) * (this.state.currentMode === 'video' ? this.video.duration : this.audio.duration);
            if (this.state.currentMode === 'video') { this.video.currentTime = t; if (this.state.isBeatMode) this.audio.currentTime = t; }
            else this.audio.currentTime = t;
        };

        // UI Events
        document.getElementById('vol-bar').oninput = (e) => { this.audio.volume = this.video.volume = e.target.value; this.state.isMuted = e.target.value == 0; this.updateMuteUI(); };
        document.getElementById('btn-mute').onclick = () => { this.state.isMuted = !this.state.isMuted; const v = this.state.isMuted ? 0 : 0.8; this.audio.volume = this.video.volume = v; document.getElementById('vol-bar').value = v; this.updateMuteUI(); };
        this.elements.playBtnMain.onclick = () => this.togglePlay();
        this.elements.playBtnMini.onclick = (e) => { e.stopPropagation(); this.togglePlay(); };
        document.getElementById('btn-next').onclick = () => this.next();
        document.getElementById('btn-mini-next').onclick = (e) => { e.stopPropagation(); this.next(); };
        document.getElementById('btn-prev').onclick = () => this.prev();
        document.getElementById('btn-heart').onclick = () => this.toggleFavorite(this.state.currentIndex);
        document.getElementById('btn-shuffle').onclick = (e) => { this.state.isShuffle = !this.state.isShuffle; e.currentTarget.classList.toggle('active'); this.showToast(this.state.isShuffle ? 'Bật trộn bài' : 'Tắt trộn bài'); };
        document.getElementById('btn-repeat').onclick = (e) => { this.state.repeatMode = this.state.repeatMode === 0 ? 1 : 0; e.currentTarget.classList.toggle('active', this.state.repeatMode === 1); this.showToast(this.state.repeatMode ? 'Lặp 1 bài' : 'Lặp danh sách'); };
        document.getElementById('theme-btn').onclick = () => this.toggleTheme();
        document.getElementById('mini-click-area').onclick = () => this.elements.overlay.classList.add('open');
        document.getElementById('btn-close').onclick = () => this.elements.overlay.classList.remove('open');
        document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = () => this.switchTab(btn.dataset.tab));
        document.getElementById('btn-dl').onclick = () => this.downloadSong(this.state.currentIndex);
        document.querySelectorAll('.nav-link').forEach((nav, i) => nav.onclick = () => this.switchNavigation(i));
        document.querySelectorAll('.btn-sort').forEach(btn => btn.onclick = () => this.changeSortOrder(btn.dataset.sort));
        
        // Search & Chips
        document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
            document.querySelectorAll('.chip').forEach(ch => ch.classList.remove('active')); c.classList.add('active');
            this.state.currentFilter = c.dataset.type; this.renderPlaylist();
        });
        this.elements.searchInput.oninput = (e) => { this.state.searchQuery = e.target.value; this.renderPlaylist(); };
        this.elements.clearSearchBtn.onclick = () => { this.state.searchQuery = ''; this.elements.searchInput.value = ''; this.renderPlaylist(); };

        // Options Menu
        this.elements.btnOptions.onclick = (e) => { e.stopPropagation(); this.elements.optionsMenu.classList.toggle('show'); };
        document.addEventListener('click', (e) => { if (!this.elements.optionsMenu.contains(e.target) && !this.elements.btnOptions.contains(e.target)) this.elements.optionsMenu.classList.remove('show'); });
        this.elements.btnSwitchBeat.onclick = (e) => { e.stopPropagation(); this.toggleBeatMode(); };
    }

    updateMuteUI() { document.getElementById('btn-mute').innerHTML = `<i class="fa-solid fa-volume-${this.state.isMuted ? 'xmark' : 'high'}"></i>`; }
    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        document.querySelectorAll('.stage-view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${tab}`).classList.add('active');
        if (tab === 'video') {
            if (this.state.currentMode !== 'video') {
                this.state.currentMode = 'video';
                const t = this.audio.currentTime;
                if (this.video.src && !this.video.src.endsWith(window.location.href)) { this.video.currentTime = t; if (this.state.isPlaying) this.playVideo(); }
                else { this.audio.pause(); this.state.isPlaying = false; this.updatePlayState(); this.elements.videoMsg.style.display = 'flex'; this.elements.videoMsg.innerHTML = '<span>Không có Video</span>'; }
            }
        } else if (this.state.currentMode === 'video') {
            this.state.currentMode = 'audio'; const t = this.video.currentTime;
            this.video.pause(); this.audio.currentTime = t;
            if (this.state.isPlaying) this.playAudio();
        }
    }

    async loadLyrics(url) {
        const c = document.getElementById('lyrics-content'); c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Đang tải...</p>'; this.lyricsData = [];
        if (!url) { c.innerHTML = '<p style="text-align:center;color:var(--text-sub)">Không có lời bài hát</p>'; return; }
        try {
            const txt = await (await fetch(url)).text();
            c.innerHTML = '<div style="height:40vh"></div>';
            txt.split('\n').forEach((line, i) => {
                const m = line.match(/^\[(\d{2}):(\d{2})(\.\d+)?\](.*)/);
                if (m) {
                    const t = parseInt(m[1])*60 + parseInt(m[2]) + (m[3]?parseFloat(m[3]):0);
                    if (m[4].trim()) {
                        this.lyricsData.push({ time: t, id: `l-${i}` });
                        const p = document.createElement('p'); p.className = 'lyric-row'; p.id = `l-${i}`; p.innerText = m[4].trim();
                        p.onclick = () => { if (this.state.currentMode === 'video') this.video.currentTime = t; else this.audio.currentTime = t; };
                        c.appendChild(p);
                    }
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
            const curr = document.querySelector('.lyric-row.active'); if (curr && curr.id !== id) curr.classList.remove('active');
            const next = document.getElementById(id); if (next && !next.classList.contains('active')) { next.classList.add('active'); next.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }
    }

    checkMarquee() {
        const t = document.getElementById('full-title'), b = document.getElementById('marquee-box-title');
        t.parentElement.classList.remove('animate'); void t.offsetWidth;
        if (t.offsetWidth > b.offsetWidth) { t.parentElement.classList.add('animate'); if (!t.getAttribute('d')) { t.innerHTML += ` &nbsp; • &nbsp; ${t.innerHTML}`; t.setAttribute('d', '1'); } }
    }
    downloadSong(idx) {
        const s = this.state.playlist[idx], a = document.createElement('a'); a.href = s.path; a.download = `${s.name}.mp3`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); this.showToast(`Đang tải: ${s.name}`);
    }
    showToast(msg) { this.elements.toastMsg.innerText = msg; this.elements.toast.classList.add('show'); setTimeout(() => this.elements.toast.classList.remove('show'), 3000); }
    switchNavigation(i) {
        document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active')); document.querySelectorAll('.nav-link')[i].classList.add('active');
        this.state.currentNav = i; this.state.currentFilter = 'all'; this.state.searchQuery = ''; document.querySelector('.list-header h2').innerText = i===2?'Bài hát yêu thích':(i===1?'Khám phá':'Danh sách phát');
        document.getElementById('sort-controls').style.display = i===2?'none':'flex';
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); document.querySelector('.chip').classList.add('active');
        if (i===2) this.state.currentFilter = 'favorites';
        this.renderPlaylist();
    }
    changeSortOrder(s) { this.state.sortBy = s; document.querySelectorAll('.btn-sort').forEach(b => b.classList.remove('active')); document.querySelector(`[data-sort="${s}"]`).classList.add('active'); this.renderPlaylist(); }
    formatTime(s) { if (isNaN(s)) return "0:00"; const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec<10?'0':''}${sec}`; }
}

window.app = new MusicPro();
