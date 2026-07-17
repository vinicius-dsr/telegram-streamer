class VideoPlayer {
    constructor() {
        this.video = document.getElementById('video-player');
        this.titleEl = document.getElementById('player-title');
        this.tagEl = document.getElementById('player-tag');
        this.durationEl = document.getElementById('player-duration');
        this.sizeEl = document.getElementById('player-size');
        this.dateEl = document.getElementById('player-date');
        this.captionEl = document.getElementById('player-caption');
        this.watchedBtn = document.getElementById('player-watched-btn');
        this.watchedLabel = document.getElementById('player-watched-label');
        this.currentData = null;
        this._saveInterval = null;
        this._watchedMarked = false;
        this._isWatched = false;
        this._RESUME_THRESHOLD = 0.9;
        this._WATCHED_THRESHOLD = 0.9;

        this.video.addEventListener('error', () => {
            if (this.currentData) {
                app.toast('Erro ao reproduzir video. Tente novamente em alguns segundos.', 'error');
                app.goBack();
            }
        });

        this.video.addEventListener('timeupdate', () => {
            if (!this.currentData || this._watchedMarked) return;
            const duration = this.video.duration;
            if (duration > 0 && this.video.currentTime / duration >= this._WATCHED_THRESHOLD) {
                this._watchedMarked = true;
                this._isWatched = true;
                api.toggleWatched(this.currentData.msg_id).then(() => {
                    app.markWatched(this.currentData.msg_id, true);
                    this._updateWatchedBtn();
                }).catch(() => {});
            }
        });

        this.video.addEventListener('ended', () => {
            if (!this.currentData) return;
            if (!this._watchedMarked) {
                this._watchedMarked = true;
                this._isWatched = true;
                api.toggleWatched(this.currentData.msg_id).then(() => {
                    app.markWatched(this.currentData.msg_id, true);
                    this._updateWatchedBtn();
                }).catch(() => {});
            }
        });
    }

    _updateWatchedBtn() {
        if (!this.watchedBtn) return;
        this.watchedBtn.style.display = '';
        this.watchedBtn.classList.toggle('active', this._isWatched);
        this.watchedLabel.textContent = this._isWatched ? 'Assistido' : 'Marcar como assistido';
    }

    toggleWatched() {
        if (!this.currentData) return;
        this._isWatched = !this._isWatched;
        this._watchedMarked = this._isWatched;
        api.toggleWatched(this.currentData.msg_id).then(() => {
            app.markWatched(this.currentData.msg_id, this._isWatched);
            this._updateWatchedBtn();
        }).catch(() => {
            this._isWatched = !this._isWatched;
        });
    }

    play(videoData, channel) {
        this.currentData = videoData;
        this._watchedMarked = false;
        this._isWatched = app.watchedSet.has(videoData.msg_id);
        this._stopAutoSave();

        const url = api.streamUrl(videoData.msg_id, channel);
        this.video.src = url;
        this.video.load();

        this.titleEl.textContent = videoData.title || 'Sem titulo';
        if (videoData.tags && videoData.tags.length > 0) {
            this.tagEl.textContent = '#' + videoData.tags[0];
            this.tagEl.style.display = '';
        } else {
            this.tagEl.style.display = 'none';
        }
        this.durationEl.textContent = videoData.duration || '';
        this.sizeEl.textContent = videoData.size || '';
        this.dateEl.textContent = videoData.date ? new Date(videoData.date).toLocaleDateString('pt-BR') : '';
        this.captionEl.textContent = videoData.caption || '';

        this._updateWatchedBtn();

        const onCanPlay = () => {
            this.video.removeEventListener('canplay', onCanPlay);
            this._startAutoSave(videoData.msg_id);
        };
        this.video.addEventListener('canplay', onCanPlay);

        api.getProgress(videoData.msg_id).then(result => {
            const savedTime = result.time;
            if (savedTime && savedTime > 5) {
                const seek = () => {
                    this.video.removeEventListener('canplay', seek);
                    const duration = this.video.duration;
                    if (duration > 0 && savedTime / duration < this._RESUME_THRESHOLD) {
                        this.video.currentTime = savedTime;
                        app.toast(`Retomando de ${formatTime(savedTime)}`, 'info');
                    }
                };
                this.video.addEventListener('canplay', seek);
            }
            this.video.play().catch(() => {});
        }).catch(() => {
            this.video.play().catch(() => {});
        });
    }

    _startAutoSave(msgId) {
        this._stopAutoSave();
        this._saveInterval = setInterval(() => {
            if (this.video.currentTime > 0 && !this.video.paused) {
                api.saveProgress(msgId, this.video.currentTime).catch(() => {});
            }
        }, 5000);
    }

    _stopAutoSave() {
        if (this._saveInterval) {
            clearInterval(this._saveInterval);
            this._saveInterval = null;
        }
    }

    stop() {
        this._stopAutoSave();
        if (this.currentData && this.video.currentTime > 5) {
            api.saveProgress(this.currentData.msg_id, this.video.currentTime).catch(() => {});
        }
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this.currentData = null;
        if (this.watchedBtn) this.watchedBtn.style.display = 'none';
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

window.player = new VideoPlayer();
