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
    }

    play(videoData, channel) {
        this.currentData = videoData;
        const url = api.streamUrl(videoData.msg_id, channel);
        this.video.src = url;
        this.video.load();
        this.video.play().catch(() => {});
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
    }

    stop() {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this.currentData = null;
    }
}

window.player = new VideoPlayer();
