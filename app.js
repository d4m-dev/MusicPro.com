const TRACKS_URL = 'https://raw.githubusercontent.com/d4m-dev/media/refs/heads/main/load-track/tracks.js';
const normalizeTracks = (items = []) => items.map((item) => ({
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
    } catch (e) {
        return [];
    }
};

class MusicPro {
    constructor() {
        this.state = {
            playlist: [],
            currentIndex: 0,
            isPlaying: false,
            isShuffle: false,
            repeatMode: 0, // 0: All, 1: One
            currentMode: 'audio', // 'audio' | 'video'
            volume: 0.8,
            isMuted: false,
            theme: localStorage.getItem('theme') || 'dark',
            favorites: JSON.parse(localStorage.getItem('favorites') || '[]'),
            showOnlyFavorites: false
        };

        this.audio = new Audio();
        this.video = document.getElementById('video-element');
        this.lyricsData = [];

        this.elements = {
            loader: document.getElementById('loader'),
            list: document.getElementById('track-list'),
            overlay: document.getElementById('player-overlay'),
            mini: document.getElementById('mini-player'),
            toast: document.getElementById('toast'),
            toastMsg: document.getElementById('toast-msg'),
            playBtnMain: document.getElementById('btn-main-play'),
            playBtnMini: document.getElementById('btn-mini-play'),
            seekBar: document.getElementById('seek-bar'),
            miniFill: document.getElementById('mini-fill'),
            ambient: document.getElementById('ambient-light'),
            videoMsg: document.getElementById('video-msg')
        };

        this.init();
    }

    async init() {
        this.applyTheme();
        const rawTracks = await loadRemoteTracks();
        this.state.playlist = normalizeTracks(rawTracks);
        this.renderPlaylist();
        if (!this.state.playlist.length) {
            this.showToast('Không tải được danh sách phát');
        }
        
        // Load first song but don't play
        if (this.state.playlist.length > 0) {
            this.loadSong(0, false);
        }

        // Simulate loading
        setTimeout(() => {
            this.elements.loader.style.opacity = '0';
            setTimeout(() => this.elements.loader.style.display = 'none', 500);
        }, 800);

        this.setupEventListeners();
    }

    // --- THEME ENGINE ---
    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.state.theme);
        const icon = document.querySelector('#theme-btn i');
        icon.className = this.state.theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }

    toggleTheme() {
        this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', this.state.theme);
        this.applyTheme();
        this.showToast(`Đã chuyển sang ${this.state.theme === 'dark' ? 'Giao diện tối' : 'Giao diện sáng'}`);
    }

    // --- RENDER ---
    renderPlaylist() {
        this.elements.list.innerHTML = '';
        
        let displayPlaylist = this.state.playlist;
        if (this.state.showOnlyFavorites) {
            displayPlaylist = this.state.playlist.filter((_, index) => 
                this.state.favorites.includes(this.getTrackId(index)));
        }
        
        if (!displayPlaylist.length) {
            const message = this.state.showOnlyFavorites ? 
                'Chưa có bài hát yêu thích nào' : 
                'Không tải được danh sách phát';
            this.elements.list.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-sub);">${message}</div>`;
            return;
        }
        
        displayPlaylist.forEach((track, displayIndex) => {
            const originalIndex = this.state.showOnlyFavorites ? 
                this.state.playlist.findIndex(t => t.name === track.name && t.artist === track.artist) : 
                displayIndex;
                
            const item = document.createElement('div');
            item.className = 'track-item';
            const isFavorite = this.state.favorites.includes(this.getTrackId(originalIndex));
            item.innerHTML = `
                <div class="track-thumb">
                    <img src="${track.artwork}" loading="lazy">
                    <div class="wave-anim">
                        <div class="bar"></div><div class="bar"></div><div class="bar"></div>
                    </div>
                </div>
                <div class="track-info">
                    <div class="track-title">${track.name}</div>
                    <div class="track-artist">${track.artist}</div>
                </div>
                <div style="display:flex; gap:5px;">
                    <button class="btn-icon btn-favorite-sm ${isFavorite ? 'active' : ''}" onclick="event.stopPropagation(); app.toggleFavorite(${originalIndex})">
                        <i class="fa-${isFavorite ? 'solid' : 'regular'} fa-heart"></i>
                    </button>
                    <button class="btn-icon btn-download-sm" onclick="event.stopPropagation(); app.downloadSong(${originalIndex})">
                        <i class="fa-solid fa-download"></i>
                    </button>
                </div>
            `;
            item.onclick = (e) => {
                if (!e.target.closest('.btn-download-sm') && !e.target.closest('.btn-favorite-sm')) {
                    this.playIndex(originalIndex);
                }
            };
            this.elements.list.appendChild(item);
        });
    }

    // --- PLAYER LOGIC ---
    loadSong(index, autoPlay = true) {
        this.state.currentIndex = index;
        const song = this.state.playlist[index];

        // Update UI Texts
        document.getElementById('full-title').innerText = song.name;
        document.getElementById('full-artist').innerText = song.artist;
        document.getElementById('mini-title').innerText = song.name;
        document.getElementById('mini-artist').innerText = song.artist;
        
        // Update Images
        document.getElementById('full-artwork').src = song.artwork;
        document.getElementById('mini-img').src = song.artwork;

        // Reset Media
        this.audio.src = song.path;
        
        // Video Logic Check
        const hasVideo = song.vid && !song.vid.includes('..4.mp4') && !song.vid.includes('ERROR');
        this.video.src = hasVideo ? song.vid : '';
        this.elements.videoMsg.style.display = 'none'; // Hide error initially

        // Load Lyrics
        this.loadLyrics(song.lyric);

        // Update Active State List
        document.querySelectorAll('.track-item').forEach((el, i) => {
            el.classList.toggle('active', i === index);
        });
        
        // Update heart button state
        this.updateHeartButton();

        // Ambient Color (Fake logic - random hue based on index)
        const hue = (index * 50) % 360;
        this.elements.ambient.style.background = `radial-gradient(circle, hsl(${hue}, 70%, 50%) 0%, transparent 70%)`;

        // Auto Play Logic
        if (autoPlay) {
            if (this.state.currentMode === 'video' && this.video.src) {
                this.playVideo();
            } else {
                // If in video mode but no video, switch back to audio view
                if (this.state.currentMode === 'video' && !this.video.src) {
                    this.showToast('Video không khả dụng');
                    this.switchTab('song'); // This sets mode to audio
                }
                this.playAudio();
            }
        }

        this.checkMarquee();
    }

    playIndex(index) {
        this.loadSong(index, true);
    }

    // --- MEDIA CONTROL ---
    playAudio() {
        this.video.pause();
        this.state.currentMode = 'audio';
        this.audio.play().then(() => {
            this.state.isPlaying = true;
            this.updatePlayState();
        }).catch(e => console.warn('Audio play block', e));
    }

    playVideo() {
        this.audio.pause();
        this.state.currentMode = 'video';
        
        // Show loader
        this.elements.videoMsg.style.display = 'flex';
        this.elements.videoMsg.innerHTML = '<div class="loader-ring" style="width:30px;height:30px;border-width:3px;"></div><span>Đang tải Video...</span>';

        const playPromise = this.video.play();
        if (playPromise) {
            playPromise.then(() => {
                this.state.isPlaying = true;
                this.updatePlayState();
                this.elements.videoMsg.style.display = 'none';
            }).catch(() => {
                this.state.isPlaying = false;
                this.updatePlayState();
                this.elements.videoMsg.style.display = 'flex';
                this.elements.videoMsg.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="font-size:24px;margin-bottom:8px;"></i><span>Video lỗi</span>';
            });
        }
    }

    pause() {
        this.audio.pause();
        this.video.pause();
        this.state.isPlaying = false;
        this.updatePlayState();
    }

    togglePlay() {
        if (this.state.isPlaying) {
            this.pause();
        } else {
            if (this.state.currentMode === 'video' && this.video.src) this.playVideo();
            else this.playAudio();
        }
    }

    updatePlayState() {
        const icon = this.state.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
        this.elements.playBtnMain.innerHTML = icon;
        this.elements.playBtnMini.innerHTML = icon;
        
        // Animation controls
        const anims = document.querySelectorAll('.wave-anim .bar');
        anims.forEach(bar => bar.style.animationPlayState = this.state.isPlaying ? 'running' : 'paused');
        
        if (this.state.isPlaying) this.elements.mini.classList.remove('hide');
    }

    next() {
        let idx;
        if (this.state.isShuffle) {
            do {
                idx = Math.floor(Math.random() * this.state.playlist.length);
            } while (idx === this.state.currentIndex && this.state.playlist.length > 1);
        } else {
            idx = this.state.currentIndex + 1;
            if (idx >= this.state.playlist.length) idx = 0;
        }
        this.loadSong(idx, true);
    }

    prev() {
        let idx = this.state.currentIndex - 1;
        if (idx < 0) idx = this.state.playlist.length - 1;
        this.loadSong(idx, true);
    }

    // --- SYNC & EVENTS ---
    setupEventListeners() {
        // Audio & Video Time Update
        const onTimeUpdate = (src) => {
            const duration = src.duration || 0;
            const current = src.currentTime || 0;
            if (duration > 0) {
                const percent = (current / duration) * 100;
                this.elements.seekBar.value = percent;
                this.elements.miniFill.style.width = percent + '%';
                
                document.getElementById('curr-time').innerText = this.formatTime(current);
                document.getElementById('total-time').innerText = this.formatTime(duration);
                
                this.syncLyrics(current);
            }
        };
        
        this.audio.ontimeupdate = () => onTimeUpdate(this.audio);
        this.video.ontimeupdate = () => onTimeUpdate(this.video);

        // Ended
        const onEnd = () => {
            if (this.state.repeatMode === 1) { // Repeat One
                this.state.currentMode === 'video' ? (this.video.currentTime = 0, this.video.play()) : (this.audio.currentTime = 0, this.audio.play());
            } else {
                this.next();
            }
        };
        this.audio.onended = onEnd;
        this.video.onended = onEnd;

        // Seek Bar
        this.elements.seekBar.oninput = (e) => {
            const percent = e.target.value;
            const duration = this.state.currentMode === 'video' ? this.video.duration : this.audio.duration;
            if (duration) {
                const time = (percent / 100) * duration;
                if (this.state.currentMode === 'video') this.video.currentTime = time;
                else this.audio.currentTime = time;
            }
        };

        // Volume
        const volBar = document.getElementById('vol-bar');
        volBar.oninput = (e) => {
            const val = e.target.value;
            this.state.volume = val;
            this.audio.volume = val;
            this.video.volume = val;
            this.state.isMuted = val == 0;
            this.updateMuteUI();
        };

        document.getElementById('btn-mute').onclick = () => {
            if (this.state.isMuted) {
                this.state.volume = 0.8;
                this.state.isMuted = false;
            } else {
                this.state.volume = 0;
                this.state.isMuted = true;
            }
            this.audio.volume = this.state.volume;
            this.video.volume = this.state.volume;
            volBar.value = this.state.volume;
            this.updateMuteUI();
        };

        // Main Buttons
        this.elements.playBtnMain.onclick = () => this.togglePlay();
        this.elements.playBtnMini.onclick = (e) => { e.stopPropagation(); this.togglePlay(); };
        document.getElementById('btn-next').onclick = () => this.next();
        document.getElementById('btn-mini-next').onclick = (e) => { e.stopPropagation(); this.next(); };
        document.getElementById('btn-prev').onclick = () => this.prev();

        // Heart/Favorite Button
        document.getElementById('btn-heart').onclick = () => this.toggleFavorite(this.state.currentIndex);

        // Shuffle
        document.getElementById('btn-shuffle').onclick = (e) => {
            this.state.isShuffle = !this.state.isShuffle;
            e.currentTarget.classList.toggle('active', this.state.isShuffle);
            this.showToast(this.state.isShuffle ? 'Đã bật trộn bài' : 'Đã tắt trộn bài');
        };

        // Repeat
        document.getElementById('btn-repeat').onclick = (e) => {
            const btn = e.currentTarget;
            if (this.state.repeatMode === 0) {
                this.state.repeatMode = 1; // Repeat One
                btn.classList.add('active', 'repeat-one');
                this.showToast('Lặp lại 1 bài');
            } else {
                this.state.repeatMode = 0; // Repeat All
                btn.classList.remove('active', 'repeat-one');
                this.showToast('Lặp lại danh sách');
            }
        };

        // Theme
        document.getElementById('theme-btn').onclick = () => this.toggleTheme();

        // Overlay & Tabs
        document.getElementById('mini-click-area').onclick = () => this.elements.overlay.classList.add('open');
        document.getElementById('btn-close').onclick = () => this.elements.overlay.classList.remove('open');

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.onclick = () => this.switchTab(btn.dataset.tab);
        });

        // Download
        document.getElementById('btn-dl').onclick = () => this.downloadSong(this.state.currentIndex);
        
        // Favorites Navigation
        document.getElementById('nav-favorites').onclick = () => this.toggleFavoritesView();
    }

    updateMuteUI() {
        const btn = document.getElementById('btn-mute');
        if (this.state.isMuted) {
            btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            btn.style.color = 'var(--text-sub)';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            btn.style.color = 'var(--text-main)';
        }
    }

    switchTab(tabName) {
        // UI
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        document.querySelectorAll('.stage-view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${tabName}`).classList.add('active');

        // Logic Handover
        if (tabName === 'video') {
            if (this.state.currentMode !== 'video') {
                this.state.currentMode = 'video';
                const t = this.audio.currentTime;
                this.audio.pause();
                
                // Check if video exists
                if (this.video.src && !this.video.src.endsWith(window.location.href)) {
                    this.video.currentTime = t;
                    if (this.state.isPlaying) this.playVideo();
                } else {
                    this.elements.videoMsg.style.display = 'flex';
                    this.elements.videoMsg.innerHTML = '<span>Không có Video</span>';
                    this.state.isPlaying = false;
                    this.updatePlayState();
                }
            }
        } else {
            // Switching to Audio views (Song/Lyrics)
            if (this.state.currentMode === 'video') {
                this.state.currentMode = 'audio';
                const t = this.video.currentTime;
                this.video.pause();
                this.audio.currentTime = t;
                if (this.state.isPlaying) this.playAudio();
            }
        }
    }

    // --- LYRICS ---
    async loadLyrics(url) {
        const container = document.getElementById('lyrics-content');
        container.innerHTML = '<p style="text-align:center; color:var(--text-sub); margin-top:50px;">Đang tải...</p>';
        this.lyricsData = [];

        if (!url) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-sub); margin-top:50px;">Không có lời bài hát</p>';
            return;
        }

        try {
            const res = await fetch(url);
            const text = await res.text();
            const lines = text.split('\n');
            const regex = /^\[(\d{2}):(\d{2})(\.\d+)?\](.*)/;
            
            container.innerHTML = '<div style="height: 40vh;"></div>'; // Spacer top
            
            lines.forEach((line, i) => {
                const match = line.match(regex);
                if (match) {
                    const min = parseInt(match[1]);
                    const sec = parseInt(match[2]);
                    const ms = match[3] ? parseFloat(match[3]) : 0;
                    const time = min * 60 + sec + ms;
                    const content = match[4].trim();
                    
                    if (content) {
                        this.lyricsData.push({ time, id: `line-${i}` });
                        const p = document.createElement('p');
                        p.className = 'lyric-row';
                        p.id = `line-${i}`;
                        p.innerText = content;
                        p.onclick = () => {
                            if (this.state.currentMode === 'video') this.video.currentTime = time;
                            else this.audio.currentTime = time;
                        };
                        container.appendChild(p);
                    }
                }
            });
            container.innerHTML += '<div style="height: 40vh;"></div>'; // Spacer bottom
        } catch (e) {
            container.innerHTML = '<p style="text-align:center; color:var(--text-sub); margin-top:50px;">Lỗi tải lời bài hát</p>';
        }
    }

    syncLyrics(time) {
        if (this.lyricsData.length === 0) return;
        
        let activeId = null;
        for (let i = 0; i < this.lyricsData.length; i++) {
            if (this.lyricsData[i].time <= time) {
                activeId = this.lyricsData[i].id;
            } else {
                break;
            }
        }

        if (activeId) {
            const current = document.querySelector('.lyric-row.active');
            if (current && current.id !== activeId) {
                current.classList.remove('active');
            }
            
            const next = document.getElementById(activeId);
            if (next && !next.classList.contains('active')) {
                next.classList.add('active');
                next.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // --- UTILS ---
    checkMarquee() {
        const title = document.getElementById('full-title');
        const box = document.getElementById('marquee-box-title');
        const content = title.parentElement;
        
        content.classList.remove('animate');
        void title.offsetWidth; // Trigger reflow
        
        if (title.offsetWidth > box.offsetWidth) {
            content.classList.add('animate');
            // Duplicate text for smooth loop
            if (!title.getAttribute('data-doubled')) {
                title.innerHTML += ` &nbsp; • &nbsp; ${title.innerHTML}`;
                title.setAttribute('data-doubled', 'true');
            }
        }
    }

    downloadSong(index) {
        const song = this.state.playlist[index];
        const link = document.createElement('a');
        link.href = song.path;
        link.download = `${song.name}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        this.showToast(`Đang tải: ${song.name}`);
    }

    showToast(msg) {
        this.elements.toastMsg.innerText = msg;
        this.elements.toast.classList.add('show');
        setTimeout(() => this.elements.toast.classList.remove('show'), 3000);
    }
    
    // --- FAVORITES FUNCTIONALITY ---
    getTrackId(index) {
        const track = this.state.playlist[index];
        return `${track.name}_${track.artist}`.replace(/\s+/g, '_');
    }
    
    toggleFavorite(index) {
        const trackId = this.getTrackId(index);
        const isFavorite = this.state.favorites.includes(trackId);
        
        if (isFavorite) {
            this.state.favorites = this.state.favorites.filter(id => id !== trackId);
            this.showToast('Đã xóa khỏi yêu thích');
        } else {
            this.state.favorites.push(trackId);
            this.showToast('Đã thêm vào yêu thích');
        }
        
        localStorage.setItem('favorites', JSON.stringify(this.state.favorites));
        this.updateHeartButton();
        this.renderPlaylist(); // Re-render to update heart icons
    }
    
    updateHeartButton() {
        const heartBtn = document.getElementById('btn-heart');
        const isFavorite = this.state.favorites.includes(this.getTrackId(this.state.currentIndex));
        
        heartBtn.classList.toggle('active', isFavorite);
        heartBtn.innerHTML = `<i class="fa-${isFavorite ? 'solid' : 'regular'} fa-heart"></i>`;
    }
    
    toggleFavoritesView() {
        this.state.showOnlyFavorites = !this.state.showOnlyFavorites;
        
        // Update navigation active state
        document.querySelectorAll('.nav-link').forEach(nav => nav.classList.remove('active'));
        if (this.state.showOnlyFavorites) {
            document.getElementById('nav-favorites').classList.add('active');
        } else {
            document.querySelector('.nav-link').classList.add('active'); // First nav (Home)
        }
        
        // Update header
        const listHeader = document.querySelector('.list-header h2');
        const listSubtext = document.querySelector('.list-header p');
        
        if (this.state.showOnlyFavorites) {
            listHeader.innerText = 'Bài hát yêu thích';
            listSubtext.innerText = `${this.state.favorites.length} bài hát • Danh sách của bạn`;
        } else {
            listHeader.innerText = 'Danh sách phát';
            listSubtext.innerText = 'Cập nhật hôm nay • Dành riêng cho bạn';
        }
        
        this.renderPlaylist();
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }
}

// Initialize App
window.app = new MusicPro();
