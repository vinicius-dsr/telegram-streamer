class TelegramAPI {
    constructor() {
        this.base = '';
    }

    async _request(url, options = {}) {
        try {
            const resp = await fetch(this.base + url, {
                headers: { 'Content-Type': 'application/json', ...options.headers },
                ...options,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            return resp;
        } catch (e) {
            throw e;
        }
    }

    async _json(url, options = {}) {
        const resp = await this._request(url, options);
        return resp.json();
    }

    getVideos(channel, tag = '', limit = 50, offset = 0) {
        let url = `/api/videos?limit=${limit}&offset=${offset}`;
        if (channel) url += `&channel=${encodeURIComponent(channel)}`;
        if (tag) url += `&tag=${encodeURIComponent(tag)}`;
        return this._json(url);
    }

    getVideo(msgId, channel) {
        let url = `/api/video/${msgId}`;
        if (channel) url += `?channel=${encodeURIComponent(channel)}`;
        return this._json(url);
    }

    streamUrl(msgId, channel) {
        let url = `/api/stream/${msgId}`;
        if (channel) url += `?channel=${encodeURIComponent(channel)}`;
        return url;
    }

    thumbnailUrl(msgId, channel) {
        let url = `/api/thumbnail/${msgId}`;
        if (channel) url += `?channel=${encodeURIComponent(channel)}`;
        return url;
    }

    getTags(channel) {
        let url = '/api/tags';
        if (channel) url += `?channel=${encodeURIComponent(channel)}`;
        return this._json(url);
    }

    getChannels() {
        return this._json('/api/channels');
    }

    addChannel(data) {
        return this._json('/api/channel', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    updateChannel(channelId, data) {
        return this._json(`/api/channel/${encodeURIComponent(channelId)}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    removeChannel(channelId) {
        return this._json(`/api/channel/${encodeURIComponent(channelId)}`, {
            method: 'DELETE',
        });
    }

    loginStatus() {
        return this._json('/api/auth/status');
    }

    login(data) {
        return this._json('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    sendCode(code, phone) {
        return this._json('/api/auth/code', {
            method: 'POST',
            body: JSON.stringify({ code, phone }),
        });
    }

    send2FA(password) {
        return this._json('/api/auth/2fa', {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
    }

    reuseSession() {
        return this._json('/api/auth/reuse', { method: 'POST' });
    }

    prefetch(msgId, channel) {
        let url = `/api/prefetch/${msgId}`;
        if (channel) url += `?channel=${encodeURIComponent(channel)}`;
        return this._request(url);
    }

    getProgress(msgId) {
        return this._json(`/api/progress/${msgId}`);
    }

    saveProgress(msgId, time) {
        return this._json(`/api/progress/${msgId}`, {
            method: 'POST',
            body: JSON.stringify({ time }),
        });
    }
}

window.api = new TelegramAPI();
