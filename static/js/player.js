class VideoPlayer {
    constructor() {
        this.video = document.getElementById('video-player');
        this.titleEl = document.getElementById('player-title');
        this.tagEl = document.getElementById('player-tag');
        this.durationEl = document.getElementById('player-duration');
        this.sizeEl = document.getElementById('player-size');
        this.dateEl = document.getElementById('player-date');
        this.captionEl = document.getElementById('player-caption');
        this.currentData = null;
        this._saveInterval = null;
        this._RESUME_THRESHOLD = 0.9;

        this.video.addEventListener('error', () => {
            if (this.currentData) {
                app.toast('Erro ao reproduzir video. Tente novamente em alguns segundos.', 'error');
                app.goBack();
            }
        });
    }

    play(videoData, channel) {
        this.currentData = videoData;
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

        api.getProgress(videoData.msg_id).then(result => {
            const savedTime = result.time;
            if (savedTime && savedTime > 5) {
                this.video.addEventListener('loadedmetadata', function onMeta() {
                    this.removeEventListener('loadedmetadata', onMeta);
                    const duration = this.duration;
                    if (duration > 0 && savedTime / duration < this._RESUME_THRESHOLD) {
                        this.currentTime = savedTime;
                        app.toast(`Retomando de ${formatTime(savedTime)}`, 'info');
                    }
                }.bind(this.video));
            }
            this.video.play().catch(() => {});
            this._startAutoSave(videoData.msg_id);
        }).catch(() => {
            this.video.play().catch(() => {});
            this._startAutoSave(videoData.msg_id);
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
    }
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

window.player = new VideoPlayer();
