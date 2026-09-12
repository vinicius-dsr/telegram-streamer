class VideoPlayer {
    constructor() {
        this.video = document.getElementById('video-player');
        this.titleEl = document.getElementById('player-title');
        this.durationEl = document.getElementById('player-duration');
        this.sizeEl = document.getElementById('player-size');
        this.dateEl = document.getElementById('player-date');
        this.captionEl = document.getElementById('player-caption');
        this.watchedBtn = document.getElementById('player-watched-btn');
        this.watchedLabel = document.getElementById('player-watched-label');
        this.prevBtn = document.getElementById('player-prev-btn');
        this.nextBtn = document.getElementById('player-next-btn');
        this.prevTitleEl = document.getElementById('player-prev-title');
        this.prevSectionEl = document.getElementById('player-prev-section');
        this.nextTitleEl = document.getElementById('player-next-title');
        this.nextSectionEl = document.getElementById('player-next-section');
        this.countdownEl = document.getElementById('player-next-countdown');
        this.countdownBarEl = document.getElementById('countdown-bar');
        this.countdownNumberEl = document.getElementById('player-countdown-number');
        this.sectionBannerEl = document.getElementById('player-section-banner');

        this.currentData = null;
        this._prevEntry = null;
        this._nextEntry = null;
        this._saveInterval = null;
        this._watchedMarked = false;
        this._isWatched = false;
        this._countdownRemaining = 0;
        this._COUNTDOWN_TOTAL = 10;
        this._countdownTimer = null;
        this._bannerTimer = null;
        this._RESUME_THRESHOLD = 0.9;
        this._WATCHED_THRESHOLD = 0.9;
        this._COUNTDOWN_CIRC = 2 * Math.PI * 15.5;

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

        this.video.addEventListener('play', () => {
            this._cancelCountdown();
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
            if (this._nextEntry) {
                this._startCountdown();
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

    startPlayback(entry, prevEntry, nextEntry, channel) {
        this._cancelCountdown();
        this.currentData = entry.video;
        this._prevEntry = prevEntry;
        this._nextEntry = nextEntry;
        this._watchedMarked = false;
        this._isWatched = app.watchedSet.has(entry.video.msg_id);
        this._stopAutoSave();

        const url = api.streamUrl(entry.video.msg_id, channel);
        this.video.src = url;
        this.video.load();

        this.titleEl.textContent = entry.video.title || 'Sem titulo';
        this.durationEl.textContent = entry.video.duration || '';
        this.sizeEl.textContent = entry.video.size || '';
        this.dateEl.textContent = entry.video.date ? new Date(entry.video.date).toLocaleDateString('pt-BR') : '';
        this.captionEl.textContent = entry.video.caption || '';

        this._updateWatchedBtn();
        this._updateNav();
        this._showSectionBanner(entry.section, prevEntry ? prevEntry.section : '');

        const onCanPlay = () => {
            this.video.removeEventListener('canplay', onCanPlay);
            this._startAutoSave(entry.video.msg_id);
        };
        this.video.addEventListener('canplay', onCanPlay);

        api.getProgress(entry.video.msg_id).then(result => {
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

    _updateNav() {
        if (!this.prevBtn || !this.nextBtn) return;

        this.prevBtn.disabled = !this._prevEntry;
        this.nextBtn.disabled = !this._nextEntry;

        if (this._prevEntry) {
            this.prevTitleEl.textContent = this._prevEntry.video.title || 'Sem titulo';
            this.prevSectionEl.textContent = this._prevEntry.section ? `Secao: ${this._prevEntry.section}` : '';
        } else {
            this.prevTitleEl.textContent = '';
            this.prevSectionEl.textContent = '';
        }

        if (this._nextEntry) {
            this.nextTitleEl.textContent = this._nextEntry.video.title || 'Sem titulo';
            this.nextSectionEl.textContent = this._nextEntry.section ? `Secao: ${this._nextEntry.section}` : '';
        } else {
            this.nextTitleEl.textContent = '';
            this.nextSectionEl.textContent = '';
        }
    }

    _showSectionBanner(currentSection, prevSection) {
        if (!this.sectionBannerEl) return;
        if (this._bannerTimer) {
            clearTimeout(this._bannerTimer);
            this._bannerTimer = null;
        }
        this.sectionBannerEl.style.display = 'none';
        if (!currentSection || (prevSection && prevSection === currentSection)) return;
        this.sectionBannerEl.textContent = `Seção: ${currentSection}`;
        this.sectionBannerEl.style.display = '';
        this._bannerTimer = setTimeout(() => {
            this.sectionBannerEl.style.display = 'none';
        }, 4000);
    }

    _startCountdown() {
        if (!this._nextEntry) return;
        this._cancelCountdown();
        this._countdownRemaining = this._COUNTDOWN_TOTAL;
        this._updateCountdownUI();
        this.countdownEl.style.display = '';
        if (this.nextBtn) this.nextBtn.classList.add('countdown-active');
        this._countdownTimer = setInterval(() => {
            this._countdownRemaining -= 1;
            if (this._countdownRemaining <= 0) {
                this._cancelCountdown();
                this.playNext();
                return;
            }
            this._updateCountdownUI();
        }, 1000);
    }

    _cancelCountdown() {
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer);
            this._countdownTimer = null;
        }
        if (this.nextBtn) this.nextBtn.classList.remove('countdown-active');
        if (this.countdownEl) this.countdownEl.style.display = 'none';
        this._countdownRemaining = 0;
    }

    _updateCountdownUI() {
        if (!this.countdownNumberEl || !this.countdownBarEl) return;
        this.countdownNumberEl.textContent = String(this._countdownRemaining);
        const fraction = this._countdownRemaining / this._COUNTDOWN_TOTAL;
        this.countdownBarEl.style.strokeDashoffset = (this._COUNTDOWN_CIRC * (1 - fraction)).toFixed(2);
    }

    playNext() {
        this._cancelCountdown();
        app.playVideoAt(app.playlistIndex + 1);
    }

    playPrev() {
        this._cancelCountdown();
        app.playVideoAt(app.playlistIndex - 1);
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
        this._cancelCountdown();
        this._stopAutoSave();
        if (this.currentData && this.video.currentTime > 5) {
            api.saveProgress(this.currentData.msg_id, this.video.currentTime).catch(() => {});
        }
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this.currentData = null;
        this._prevEntry = null;
        this._nextEntry = null;
        if (this.watchedBtn) this.watchedBtn.style.display = 'none';
        if (this.sectionBannerEl) this.sectionBannerEl.style.display = 'none';
        this._updateNav();
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

window.player = new VideoPlayer();