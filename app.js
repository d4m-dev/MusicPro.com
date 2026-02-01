import { TRACKS as LocalTracks } from './tracks.js';
import './styles.css'; // Import CSS để Vite xử lý

const TRACKS_URL = './tracks.js';

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
    // Ưu tiên sử dụng tracks import từ local nếu có
    if (Array.isArray(LocalTracks) && LocalTracks.length) return LocalTracks;
    
    // Fallback: Logic cũ nếu muốn load từ remote (giữ nguyên để tương thích)
    if (Array.isArray(window.TRACKS) && window.TRACKS.length) return window.TRACKS;
    try {
        const res = await fetch(TRACKS_URL, { cache: 'force-cache' });
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
            isPreloading: false, nextTrackData: null,
            sleepTimer: null, sleepTimeLeft: 0, sleepInterval: null,
            downloadTargetIndex: 0
        };

        this.currentSongHasVideo = false;
        this.beatAudio = new Audio();
        this.beatAudio.preload = "auto";

        this.audio = new Audio();
        this.preloadAudioAgent = new Audio();
        this.preloadVideoAgent = document.createElement('video');
        this.preloadVideoAgent.preload = "auto";
        this.preloadVideoAgent.muted = true;

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
            btnSwitchBeat: document.getElementById('btn-switch-beat'),
            btnOpenTimer: document.getElementById('btn-open-timer'),
            timerModal: document.getElementById('timer-modal'), btnCloseTimer: document.getElementById('btn-close-timer'),
            timerMenuText: document.getElementById('timer-menu-text'),
            
            dlModal: document.getElementById('download-modal'),
            btnCloseDl: document.getElementById('btn-close-dl'),
            dlTitle: document.getElementById('dl-song-title')
        };
        this.init();
    }

    // --- CORE INITIALIZATION & DATA MANAGEMENT ---
    async init() {
        this.applyTheme();
        const rawTracks = await loadRemoteTracks();
        this.state.playlist = normalizeTracks(rawTracks);
        this.renderPlaylist();
        
        // Loại bỏ dòng này để không tự động tải bài hát đầu tiên khi khởi tạo
        // if (this.state.playlist.length > 0) this.loadSong(0, false);

        document.getElementById('sort-controls').style.display = 'flex';
        setTimeout(() => { this.elements.loader.style.opacity = '0'; setTimeout(() => this.elements.loader.style.display = 'none', 500); }, 800);
        this.setupEventListeners();
    }

    /**
     * Áp dụng chủ đề (sáng/tối) cho ứng dụng.
     */
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

    /**
     * Lọc và sắp xếp danh sách bài hát dựa trên trạng thái hiện tại (filter, search, sort).
     */
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

    // --- UI RENDERING & UPDATES ---
    /**
     * Render (hoặc cập nhật) danh sách bài hát hiển thị trên giao diện chính. */
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
            item.innerHTML = `<div class="track-thumb"><img src="${track.artwork}" loading="lazy"><div class="wave-anim"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div><div class="track-info"><div class="track-title">${track.name}</div><div class="track-artist">${track.artist}</div></div><div style="display:flex;gap:5px"><button class="btn-icon btn-favorite-sm ${isFav?'active':''}" onclick="event.stopPropagation();app.toggleFavorite(${idx})"><i class="fa-${isFav?'solid':'regular'} fa-heart"></i></button><button class="btn-icon btn-download-sm" onclick="event.stopPropagation();app.openDownloadModal(${idx})"><i class="fa-solid fa-download"></i></button></div>`;
            item.onclick = (e) => { if (!e.target.closest('.btn-download-sm') && !e.target.closest('.btn-favorite-sm')) this.playIndex(idx); };
            frag.appendChild(item);
        });
        this.elements.list.appendChild(frag);
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
        const isFav = this.state.favorites.includes(String(this.state.playlist[this.state.currentIndex].id));
        document.getElementById('btn-heart').className = `btn-icon ${isFav ? 'active' : ''}`;
        document.getElementById('btn-heart').innerHTML = `<i class="fa-${isFav ? 'solid' : 'regular'} fa-heart"></i>`;
    }

    // --- PLAYBACK CONTROLS ---
    /**
     * Tải một bài hát vào trình phát.
     * @param {number} idx - Chỉ số của bài hát trong playlist.
     * @param {boolean} autoPlay - Tự động phát sau khi tải xong.
     */
    loadSong(idx, autoPlay = true) {
        this.pause(); // Dừng mọi thứ trước khi tải bài hát mới
        this.state.currentIndex = idx;
        this.state.isPreloading = false;
        this.state.nextTrackData = null;

        const song = this.state.playlist[idx];
        this.updateUI(song);
        this.updateHeartButton();
        this.updateBeatBtnUI();
        this.renderPlaylist();
        this.loadLyrics(song.lyric);

        this.currentSongHasVideo = !!(song.vid && !song.vid.includes('..4.mp4') && !song.vid.includes('ERROR'));

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
            this.play();
        }
        this.checkMarquee();
    }

    /**
     * Cập nhật các thông tin hiển thị trên giao diện người dùng (tiêu đề, nghệ sĩ, ảnh bìa).
     */
    updateUI(song) {
        document.getElementById('full-title').innerText = song.name;
        document.getElementById('full-artist').innerText = song.artist;
        document.getElementById('mini-title').innerText = song.name;
        document.getElementById('mini-artist').innerText = song.artist;
        document.getElementById('full-artwork').src = song.artwork;
        document.getElementById('mini-img').src = song.artwork;
        const hue = (this.state.currentIndex * 50) % 360;
        this.elements.ambient.style.background = `radial-gradient(circle, hsl(${hue},70%,50%), transparent 70%)`;
    }

    // --- PRELOADING LOGIC ---
    /**
     * Kiểm tra và kích hoạt preload bài hát tiếp theo nếu thời gian còn lại ít. */
    checkPreload(currentTime, duration) {
        const timeLeft = duration - currentTime;
        if (timeLeft <= 5 && !this.state.isPreloading) {
            this.state.isPreloading = true;
            this.executePreload();
        }
    }

    /**
     * Thực hiện preload bài hát tiếp theo vào các đối tượng Audio/Video ẩn.
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
        this.state.isPlaying = true;
        this.updatePlayState();

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
                this.beatAudio.play();
            } else {
                this.beatAudio.pause();
            }
            this.audio.pause(); // Audio gốc không bao giờ dùng khi có video
        } else {
            // Chế độ chỉ audio
            this.video.pause();
            if (this.state.isBeatMode && this.beatAudio.src) {
                this.audio.pause();
                this.beatAudio.play();
            } else {
                this.beatAudio.pause();
                this.audio.play();
            }
        }
    }
    /**
     * Tạm dừng phát nhạc/video.
     */
    pause() { this.video.pause(); this.audio.pause(); this.beatAudio.pause(); this.state.isPlaying = false; this.updatePlayState(); }
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
        if (this.state.isPlaying) this.elements.mini.classList.remove('hide');
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
        if (this.state.sleepTimer) clearTimeout(this.state.sleepTimer);
        if (this.state.sleepInterval) clearInterval(this.state.sleepInterval);
        if (minutes === 0) {
            this.state.sleepTimer = null; this.state.sleepTimeLeft = 0;
            this.elements.timerMenuText.innerText = "Hẹn giờ tắt"; this.elements.timerMenuText.style.color = "var(--text-main)";
            this.showToast("Đã hủy hẹn giờ"); return;
        }
        this.state.sleepTimeLeft = minutes * 60;
        this.showToast(`Nhạc sẽ tắt sau ${minutes} phút`);
        this.updateTimerText();
        this.state.sleepInterval = setInterval(() => {
            this.state.sleepTimeLeft--; this.updateTimerText();
            if (this.state.sleepTimeLeft <= 0) clearInterval(this.state.sleepInterval);
        }, 1000);
        this.state.sleepTimer = setTimeout(() => { this.pause(); this.showToast("Đã tắt nhạc"); this.startSleepTimer(0); }, minutes * 60000);
    }
    /**
     * Cập nhật văn bản hiển thị thời gian hẹn giờ còn lại.
     */
    updateTimerText() {
        if (this.state.sleepTimeLeft > 0) {
            const m = Math.ceil(this.state.sleepTimeLeft / 60);
            this.elements.timerMenuText.innerText = `Còn ${m} phút`; this.elements.timerMenuText.style.color = "var(--primary)";
        } else { this.elements.timerMenuText.innerText = "Hẹn giờ tắt"; this.elements.timerMenuText.style.color = "var(--text-main)"; }
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

    // --- EVENT HANDLERS ---
    setupEventListeners() {
        // Xử lý khi tab trình duyệt bị ẩn/hiện
        document.addEventListener("visibilitychange", () => {
            // Khi tab hiển thị trở lại, kiểm tra và đồng bộ lại nếu có độ trễ lớn
            if (!document.hidden && this.state.isPlaying && this.currentSongHasVideo && this.state.isBeatMode) {
                const masterTime = this.video.currentTime;
                if (Math.abs(this.beatAudio.currentTime - masterTime) > 0.5) {
                    this.beatAudio.currentTime = masterTime;
                }
            }
        });

        // Cập nhật thời gian phát nhạc/video
        const updateTime = (src) => {
            if (document.hidden) return; 
            const d = src.duration || 0, c = src.currentTime || 0;
            if (d > 0) this.checkPreload(c, d);
            if (d > 0) {
                const p = (c / d) * 100;
                this.elements.seekBar.value = p; this.elements.miniFill.style.width = p + '%';
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
            if (!this.currentSongHasVideo && !this.state.isBeatMode) { // Audio là Master
                const t = this.audio.currentTime;
                if (this.beatAudio.currentTime !== t) this.beatAudio.currentTime = t;
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
        this.audio.onended = () => { if (!this.currentSongHasVideo && !this.state.isBeatMode) onEnd(); };
        this.beatAudio.onended = () => { if (!this.currentSongHasVideo && this.state.isBeatMode) onEnd(); };

        this.elements.seekBar.oninput = (e) => {
            const masterPlayer = this.currentSongHasVideo ? this.video : (this.state.isBeatMode ? this.beatAudio : this.audio);
            const duration = masterPlayer.duration;
            if (!duration || isNaN(duration)) return;
            const t = (e.target.value / 100) * duration;
            this.seek(t);
        };

        // Điều khiển âm lượng
        document.getElementById('vol-bar').oninput = (e) => { this.state.volume = e.target.value; this.audio.volume = this.video.volume = this.beatAudio.volume = this.state.volume; this.state.isMuted = this.state.volume == 0; this.updateMuteUI(); };
        // Nút tắt/bật tiếng
        document.getElementById('btn-mute').onclick = () => { this.state.isMuted = !this.state.isMuted; const v = this.state.isMuted ? 0 : this.state.volume; this.audio.volume = this.video.volume = this.beatAudio.volume = v; document.getElementById('vol-bar').value = v; this.updateMuteUI(); };
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
        // Đóng overlay player
        document.getElementById('btn-close').onclick = () => this.elements.overlay.classList.remove('open');
        document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = () => this.switchTab(btn.dataset.tab));
        // Nút tải xuống trên full player
        document.getElementById('btn-dl').onclick = () => this.openDownloadModal(this.state.currentIndex);
        // Chuyển đổi navigation (Trang chủ, Khám phá, Yêu thích)
        
        document.querySelectorAll('.nav-link').forEach((nav, i) => nav.onclick = () => this.switchNavigation(i));
        document.querySelectorAll('.btn-sort').forEach(btn => btn.onclick = () => this.changeSortOrder(btn.dataset.sort));
        
        document.querySelectorAll('.chip').forEach(c => c.onclick = () => {
            document.querySelectorAll('.chip').forEach(ch => ch.classList.remove('active')); c.classList.add('active');
            this.state.currentFilter = c.dataset.type; this.renderPlaylist();
        });
        this.elements.searchInput.oninput = (e) => { this.state.searchQuery = e.target.value; this.renderPlaylist(); };
        // Nút xóa tìm kiếm
        this.elements.clearSearchBtn.onclick = () => { this.state.searchQuery = ''; this.elements.searchInput.value = ''; this.renderPlaylist(); };

        // Menu tùy chọn (3 chấm)
        this.elements.btnOptions.onclick = (e) => { e.stopPropagation(); this.elements.optionsMenu.classList.toggle('show'); };
        document.addEventListener('click', (e) => { if (!this.elements.optionsMenu.contains(e.target) && !this.elements.btnOptions.contains(e.target)) this.elements.optionsMenu.classList.remove('show'); });
        this.elements.btnSwitchBeat.onclick = (e) => { e.stopPropagation(); this.toggleBeatMode(); };
        // Hẹn giờ tắt nhạc

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
    }
    /**
     * Cập nhật biểu tượng nút tắt tiếng.
     */
    updateMuteUI() { document.getElementById('btn-mute').innerHTML = `<i class="fa-solid fa-volume-${this.state.isMuted ? 'xmark' : 'high'}"></i>`; }
    
    // --- NAVIGATION & FILTERING ---
    /**
     * Chuyển đổi giữa các tab (Song, Video, Lyrics) trong full player.
     * @param {string} tab - Tên tab ('song', 'video', 'lyrics').
     */
    // --- FIX LỖI RESET NHẠC KHI CHUYỂN TAB LYRICS ---
    // --- REFACTORED FOR HOT-SWAPPING ---
    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        document.querySelectorAll('.stage-view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${tab}`).classList.add('active');

        this.state.currentMode = tab;

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

    // --- LYRICS MANAGEMENT ---
    /**
     * Tải lời bài hát từ URL và hiển thị lên giao diện. */
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
            const curr = document.querySelector('.lyric-row.active'); if (curr && curr.id !== id) curr.classList.remove('active');
            const next = document.getElementById(id); if (next && !next.classList.contains('active')) { next.classList.add('active'); next.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }
    }

    // --- UI RENDERING & UPDATES (tiếp theo) ---
    /**
     * Kiểm tra và kích hoạt hiệu ứng marquee cho tiêu đề bài hát nếu quá dài.
     */
    checkMarquee() {
        const t = document.getElementById('full-title'), b = document.getElementById('marquee-box-title');
        t.parentElement.classList.remove('animate'); void t.offsetWidth;
        if (t.offsetWidth > b.offsetWidth) { t.parentElement.classList.add('animate'); if (!t.getAttribute('d')) { t.innerHTML += ` &nbsp; • &nbsp; ${t.innerHTML}`; t.setAttribute('d', '1'); } }
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
        document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active')); document.querySelectorAll('.nav-link')[i].classList.add('active');
        // Cập nhật trạng thái lọc và hiển thị danh sách
        this.state.currentNav = i; this.state.currentFilter = 'all'; this.state.searchQuery = ''; document.querySelector('.list-header h2').innerText = i===2?'Bài hát yêu thích':(i===1?'Khám phá':'Danh sách phát');
        document.getElementById('sort-controls').style.display = i===2?'none':'flex';
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active')); document.querySelector('.chip').classList.add('active');
        if (i===2) this.state.currentFilter = 'favorites';
        this.renderPlaylist();
    }
    changeSortOrder(s) { this.state.sortBy = s; document.querySelectorAll('.btn-sort').forEach(b => b.classList.remove('active')); document.querySelector(`[data-sort="${s}"]`).classList.add('active'); this.renderPlaylist(); }
    
    // --- UTILITIES ---
    /**
     * Định dạng thời gian từ giây sang định dạng "phút:giây".
     * @param {number} s - Thời gian tính bằng giây.
     */
    formatTime(s) { if (isNaN(s)) return "0:00"; const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec<10?'0':''}${sec}`; }
}

window.app = new MusicPro();
