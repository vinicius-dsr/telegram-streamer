class App {
    constructor() {
        this.currentChannel = null;
        this.currentTag = '';
        this.allVideos = [];
        this.filteredVideos = [];
        this.channels = [];
        this.currentPage = 'login';
        this.loginPhone = '';
    }

    async init() {
        try {
            const status = await api.loginStatus();
            if (status.authorized) {
                await this.enterApp();
            } else {
                this.showLogin(status);
            }
        } catch (e) {
            this.showLogin({ connected: false });
        }
    }

    showLogin(status) {
        this.showScreen('login');
        const reuse = document.getElementById('login-reuse');
        if (status.downloader_session && !status.authorized) {
            reuse.style.display = '';
        } else {
            reuse.style.display = 'none';
        }
        this.resetLoginSteps();
    }

    resetLoginSteps() {
        document.getElementById('login-step-api').style.display = '';
        document.getElementById('login-step-code').style.display = 'none';
        document.getElementById('login-step-2fa').style.display = 'none';
        document.getElementById('login-error').style.display = 'none';
    }

    showLoginError(msg) {
        const el = document.getElementById('login-error');
        el.textContent = msg;
        el.style.display = '';
    }

    async startLogin() {
        const apiId = document.getElementById('login-api-id').value.trim();
        const apiHash = document.getElementById('login-api-hash').value.trim();
        const phone = document.getElementById('login-phone').value.trim();
        if (!apiId || !apiHash || !phone) {
            this.showLoginError('Preencha todos os campos.');
            return;
        }
        try {
            const result = await api.login({ api_id: apiId, api_hash: apiHash, phone });
            if (result.status === 'authorized') {
                await this.enterApp();
            } else if (result.status === 'code_sent') {
                this.loginPhone = phone;
                document.getElementById('login-step-api').style.display = 'none';
                document.getElementById('login-step-code').style.display = '';
            }
        } catch (e) {
            this.showLoginError(e.message);
        }
    }

    async sendCode() {
        const code = document.getElementById('login-code').value.trim();
        if (!code) {
            this.showLoginError('Digite o codigo.');
            return;
        }
        try {
            const result = await api.sendCode(code, this.loginPhone);
            if (result.status === 'authorized') {
                await this.enterApp();
            }
        } catch (e) {
            if (e.message && e.message.includes('2FA')) {
                document.getElementById('login-step-code').style.display = 'none';
                document.getElementById('login-step-2fa').style.display = '';
            } else {
                this.showLoginError(e.message);
            }
        }
    }

    async send2FA() {
        const password = document.getElementById('login-2fa').value;
        if (!password) {
            this.showLoginError('Digite a senha.');
            return;
        }
        try {
            const result = await api.send2FA(password);
            if (result.status === 'authorized') {
                await this.enterApp();
            }
        } catch (e) {
            this.showLoginError(e.message);
        }
    }

    async reuseSession() {
        try {
            const result = await api.reuseSession();
            if (result.status === 'authorized') {
                this.toast('Sessao reusada com sucesso!', 'success');
                await this.enterApp();
            }
        } catch (e) {
            this.showLoginError(e.message);
        }
    }

    async enterApp() {
        this.showScreen('app');
        this.currentPage = 'browse';
        await this.loadChannels();
        this.updateConnectionStatus();
    }

    async loadChannels() {
        try {
            this.channels = await api.getChannels();
            const select = document.getElementById('channel-select');
            select.innerHTML = '<option value="">Selecionar canal</option>';
            this.channels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.id;
                opt.textContent = ch.name || ch.id;
                select.appendChild(opt);
            });
            if (this.channels.length > 0) {
                const defaultCh = this.channels.find(c => c.id === this.currentChannel) || this.channels[0];
                select.value = defaultCh.id;
                this.currentChannel = defaultCh.id;
                await this.loadVideos();
            }
            this.renderChannelsList();
        } catch (e) {
            console.error('Failed to load channels:', e);
        }
    }

    async switchChannel(channelId) {
        this.currentChannel = channelId;
        this.currentTag = '';
        if (channelId) {
            await this.loadVideos();
            await this.loadTags();
        } else {
            document.getElementById('video-grid').innerHTML = '<div class="empty-state"><p>Selecione um canal para comecar</p></div>';
        }
    }

    async loadVideos() {
        if (!this.currentChannel) return;
        this.showLoading(true);
        try {
            this.allVideos = await api.getVideos(this.currentChannel, '', 200, 0);
            this.filteredVideos = [...this.allVideos];
            this.renderGrid(this.filteredVideos);
            await this.loadTags();
        } catch (e) {
            this.toast('Erro ao carregar videos: ' + e.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadTags() {
        if (!this.currentChannel) return;
        try {
            const tags = await api.getTags(this.currentChannel);
            const bar = document.querySelector('.tags-bar');
            bar.innerHTML = '<button class="tag-btn active" data-tag="" onclick="app.filterTag(\'\')">Todos</button>';
            tags.forEach(t => {
                const btn = document.createElement('button');
                btn.className = 'tag-btn';
                btn.dataset.tag = t.tag;
                btn.textContent = `#${t.tag} (${t.count})`;
                btn.onclick = () => this.filterTag(t.tag);
                bar.appendChild(btn);
            });
        } catch (e) {
            console.error('Failed to load tags:', e);
        }
    }

    filterTag(tag) {
        this.currentTag = tag;
        document.querySelectorAll('.tag-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tag === tag);
        });
        if (!tag) {
            this.filteredVideos = [...this.allVideos];
        } else {
            this.filteredVideos = this.allVideos.filter(v =>
                v.tags && v.tags.includes(tag)
            );
        }
        this.renderGrid(this.filteredVideos);
    }

    search(query) {
        const q = query.toLowerCase().trim();
        if (!q) {
            this.filteredVideos = this.currentTag
                ? this.allVideos.filter(v => v.tags && v.tags.includes(this.currentTag))
                : [...this.allVideos];
        } else {
            const base = this.currentTag
                ? this.allVideos.filter(v => v.tags && v.tags.includes(this.currentTag))
                : this.allVideos;
            this.filteredVideos = base.filter(v =>
                (v.title || '').toLowerCase().includes(q) ||
                (v.caption || '').toLowerCase().includes(q)
            );
        }
        this.renderGrid(this.filteredVideos);
    }

    renderGrid(videos) {
        const grid = document.getElementById('video-grid');
        const empty = document.getElementById('empty-state');
        if (!videos || videos.length === 0) {
            grid.innerHTML = '';
            if (empty) {
                empty.style.display = '';
                grid.appendChild(empty);
            } else {
                grid.innerHTML = '<div class="empty-state"><p>Nenhum video encontrado</p></div>';
            }
            return;
        }
        grid.innerHTML = videos.map(v => this.renderCard(v)).join('');
    }

    renderCard(video) {
        const thumbUrl = api.thumbnailUrl(video.msg_id, this.currentChannel);
        const tagHtml = video.tags && video.tags.length > 0
            ? `<span class="tag-badge">#${video.tags[0]}</span>`
            : '';
        return `
            <div class="video-card" onclick="app.playVideo(${video.msg_id})">
                <div class="thumb">
                    <img src="${thumbUrl}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="thumb-placeholder" style="display:none">&#9654;</div>
                    <div class="play-overlay">
                        <div class="play-btn">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                <polygon points="5,3 19,12 5,21"/>
                            </svg>
                        </div>
                    </div>
                </div>
                <span class="card-duration">${video.duration || ''}</span>
                <div class="card-info">
                    <div class="card-title" title="${(video.title || '').replace(/"/g, '&quot;')}">${video.title || 'Sem titulo'}</div>
                    <div class="card-meta">
                        ${tagHtml}
                        <span>${video.size || ''}</span>
                    </div>
                </div>
            </div>
        `;
    }

    async playVideo(msgId) {
        try {
            const video = await api.getVideo(msgId, this.currentChannel);
            this.showPage('player');
            player.play(video, this.currentChannel);
        } catch (e) {
            this.toast('Erro ao carregar video: ' + e.message, 'error');
        }
    }

    goBack() {
        player.stop();
        this.showPage('browse');
    }

    showSettings() {
        this.showPage('settings');
        this.renderChannelsList();
        this.updateConnectionStatus();
    }

    showBrowse() {
        this.showPage('browse');
    }

    async updateConnectionStatus() {
        try {
            const status = await api.loginStatus();
            const badge = document.getElementById('connection-status');
            const user = document.getElementById('connection-user');
            if (status.authorized) {
                badge.className = 'status-badge status-connected';
                badge.textContent = 'Conectado';
                user.textContent = status.username ? `@${status.username}` : '';
            } else {
                badge.className = 'status-badge status-disconnected';
                badge.textContent = 'Desconectado';
                user.textContent = '';
            }
        } catch (e) {
            console.error('Failed to get status:', e);
        }
    }

    renderChannelsList() {
        const container = document.getElementById('channels-list');
        if (!this.channels || this.channels.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Nenhum canal configurado</p>';
            return;
        }
        container.innerHTML = this.channels.map(ch => `
            <div class="channel-item">
                <div class="channel-info">
                    <div class="channel-name">${ch.name || ch.id}</div>
                    <div class="channel-id">${ch.id} &middot; Tags: ${(ch.tags || []).join(', ') || 'nenhuma'}</div>
                </div>
                <div class="channel-actions">
                    <button class="btn btn-danger" onclick="app.removeChannel('${ch.id}')">Remover</button>
                </div>
            </div>
        `).join('');
    }

    async addChannel() {
        const id = document.getElementById('new-channel-id').value.trim();
        const name = document.getElementById('new-channel-name').value.trim();
        const tagsStr = document.getElementById('new-channel-tags').value.trim();
        const nameLine = document.getElementById('new-channel-name-line').value;
        if (!id) {
            this.toast('Informe o link ou @usuario do canal', 'error');
            return;
        }
        const tags = tagsStr ? tagsStr.split(',').map(t => t.replace('#', '').trim()).filter(Boolean) : [];
        try {
            await api.addChannel({ id, name: name || id, tags, name_line: nameLine });
            document.getElementById('new-channel-id').value = '';
            document.getElementById('new-channel-name').value = '';
            document.getElementById('new-channel-tags').value = '';
            this.toast('Canal adicionado!', 'success');
            await this.loadChannels();
        } catch (e) {
            this.toast('Erro ao adicionar canal: ' + e.message, 'error');
        }
    }

    async removeChannel(channelId) {
        try {
            await api.removeChannel(channelId);
            this.toast('Canal removido', 'info');
            await this.loadChannels();
        } catch (e) {
            this.toast('Erro ao remover canal: ' + e.message, 'error');
        }
    }

    showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const el = document.getElementById(name + '-screen');
        if (el) el.classList.add('active');
    }

    showPage(name) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const el = document.getElementById(name + '-page');
        if (el) el.classList.add('active');
        this.currentPage = name;
    }

    showLoading(show) {
        document.getElementById('loading').style.display = show ? '' : 'none';
    }

    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(() => el.remove(), 300);
        }, 3500);
    }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());
