class App {
    constructor() {
        this.currentChannel = null;
        this.allVideos = [];
        this.filteredVideos = [];
        this.channels = [];
        this.currentPage = 'login';
        this.loginPhone = '';
        this.watchedSet = new Set();
        this.summary = null;
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
        document.getElementById('search-input').value = '';
        if (channelId) {
            await this.loadVideos();
        } else {
            document.getElementById('video-grid').innerHTML = '<div class="empty-state"><p>Selecione um canal para comecar</p></div>';
        }
    }

    async loadVideos() {
        if (!this.currentChannel) return;
        this.showLoading(true);
        try {
            const [videos, summary] = await Promise.all([
                api.getVideos(this.currentChannel, 1000, 0),
                api.getSummary(this.currentChannel).catch(() => ({ has_summary: false, modules: [] })),
            ]);
            this.allVideos = videos;
            this.summary = summary;
            this.filteredVideos = [...this.allVideos];
            await this.loadWatched();
            this.applyFilters();
        } catch (e) {
            this.toast('Erro ao carregar videos: ' + e.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadWatched() {
        try {
            const result = await api.getWatched();
            this.watchedSet = new Set(result.watched || []);
        } catch (e) {
            this.watchedSet = new Set();
        }
    }

    markWatched(msgId, watched) {
        if (watched) {
            this.watchedSet.add(msgId);
        } else {
            this.watchedSet.delete(msgId);
        }
        const card = document.querySelector(`.video-card[onclick*="playVideo(${msgId})"]`);
        if (card) {
            card.classList.toggle('watched', watched);
            const badge = card.querySelector('.watch-badge');
            if (badge) badge.style.display = watched ? '' : 'none';
        }
    }

    async toggleWatched(msgId) {
        try {
            const result = await api.toggleWatched(msgId);
            this.markWatched(msgId, result.watched);
            this.toast(result.watched ? 'Marcado como assistido' : 'Marcado como nao assistido', 'info');
        } catch (e) {
            this.toast('Erro ao atualizar status', 'error');
        }
    }

    search(query) {
        const q = query.toLowerCase().trim();
        if (!q) {
            this.filteredVideos = [...this.allVideos];
            this.renderGrid(this.filteredVideos);
            return;
        }
        this.filteredVideos = this.allVideos.filter(v =>
            (v.title || '').toLowerCase().includes(q) ||
            (v.caption || '').toLowerCase().includes(q)
        );
        this.renderGrid(this.filteredVideos);
    }

    applyFilters() {
        this.filteredVideos = [...this.allVideos];
        this.renderGrid(this.filteredVideos);
    }

    renderGrid(videos) {
        const container = document.getElementById('video-grid');

        if (!videos || videos.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nenhum video encontrado</p></div>';
            return;
        }

        const hasSummary = this.summary &&
            this.summary.has_summary &&
            Array.isArray(this.summary.modules) &&
            this.summary.modules.length > 0;

        if (!hasSummary) {
            container.innerHTML = '<div class="video-grid">' + videos.map(v => this.renderCard(v)).join('') + '</div>';
            return;
        }

        const byKey = new Map();
        const others = [];
        for (const v of videos) {
            if (typeof v.module_idx === 'number' && v.module_idx >= 0 &&
                typeof v.subtopic_idx === 'number' && v.subtopic_idx >= 0) {
                const key = v.module_idx + ':' + v.subtopic_idx;
                if (!byKey.has(key)) byKey.set(key, []);
                byKey.get(key).push(v);
            } else {
                others.push(v);
            }
        }

        let html = '';
        this.summary.modules.forEach((mod, mi) => {
            const sections = [];
            mod.subtopics.forEach((sub, si) => {
                const subVideos = byKey.get(mi + ':' + si);
                if (subVideos && subVideos.length > 0) {
                    sections.push({ sub, videos: subVideos });
                }
            });
            if (sections.length === 0) return;
            const modCount = sections.reduce((acc, s) => acc + s.videos.length, 0);
            html += `<details class="group-dropdown">
                <summary class="group-summary">
                    <span class="group-chevron"></span>
                    <span>${this.esc(mod.name)}</span>
                    <span class="group-count">${modCount}</span>
                </summary>
                <div class="group-content">`;
            sections.forEach(({ sub, videos: subVideos }) => {
                if (sub.flat) {
                    html += `<div class="video-grid">${subVideos.map(v => this.renderCard(v)).join('')}</div>`;
                } else {
                    html += `<details class="group-dropdown subtopic-block">
                        <summary class="group-summary">
                            <span class="group-chevron"></span>
                            <span>${this.esc(sub.name)}</span>
                            <span class="group-count">${subVideos.length}</span>
                        </summary>
                        <div class="group-content">
                            <div class="video-grid">${subVideos.map(v => this.renderCard(v)).join('')}</div>
                        </div>
                    </details>`;
                }
            });
            html += `</div></details>`;
        });

        if (others.length > 0) {
            html += `<details class="group-dropdown">
                <summary class="group-summary">
                    <span class="group-chevron"></span>
                    <span>Outros</span>
                    <span class="group-count">${others.length}</span>
                </summary>
                <div class="group-content">
                    <div class="video-grid">${others.map(v => this.renderCard(v)).join('')}</div>
                </div>
            </details>`;
        }

        container.innerHTML = html || '<div class="empty-state"><p>Nenhum video encontrado</p></div>';
    }

    esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    renderCard(video) {
        const thumbUrl = api.thumbnailUrl(video.msg_id, this.currentChannel);
        const isWatched = this.watchedSet.has(video.msg_id);
        const watchedClass = isWatched ? ' watched' : '';
        return `
            <div class="video-card${watchedClass}" onclick="app.playVideo(${video.msg_id})">
                <div class="watch-badge" style="display:${isWatched ? '' : 'none'}" onclick="event.stopPropagation(); app.toggleWatched(${video.msg_id})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
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
                        <span>${video.size || ''}</span>
                    </div>
                </div>
            </div>
        `;
    }

    prefetchVideo(msgId) {
        if (!this.currentChannel) return;
        api.prefetch(msgId, this.currentChannel).catch(() => {});
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
        container.innerHTML = this.channels.map(ch => {
            return `
            <div class="channel-item">
                <div class="channel-info">
                    <div class="channel-name">${ch.name || ch.id}</div>
                    <div class="channel-id">${ch.id}</div>
                </div>
                <div class="channel-actions">
                    <button class="btn btn-secondary btn-sm" onclick="app.openEditModal('${ch.id}')">Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="app.removeChannel('${ch.id}')">Remover</button>
                </div>
            </div>`;
        }).join('');
    }

    async addChannel() {
        const id = document.getElementById('new-channel-id').value.trim();
        const name = document.getElementById('new-channel-name').value.trim();
        const nameLine = document.getElementById('new-channel-name-line').value;
        if (!id) {
            this.toast('Informe o link ou @usuario do canal', 'error');
            return;
        }
        try {
            await api.addChannel({ id, name: name || id, name_line: nameLine });
            document.getElementById('new-channel-id').value = '';
            document.getElementById('new-channel-name').value = '';
            this.toast('Canal adicionado!', 'success');
            await this.loadChannels();
        } catch (e) {
            this.toast('Erro ao adicionar canal: ' + e.message, 'error');
        }
    }

    openEditModal(channelId) {
        const ch = this.channels.find(c => c.id === channelId);
        if (!ch) return;
        document.getElementById('edit-channel-id').value = ch.id;
        document.getElementById('edit-channel-name').value = ch.name || '';
        document.getElementById('edit-channel-name-line').value = ch.name_line || 'ultima';
        document.getElementById('edit-modal').classList.add('active');
    }

    closeEditModal() {
        document.getElementById('edit-modal').classList.remove('active');
    }

    async saveEditChannel() {
        const channelId = document.getElementById('edit-channel-id').value;
        const name = document.getElementById('edit-channel-name').value.trim();
        const nameLine = document.getElementById('edit-channel-name-line').value;
        try {
            await api.updateChannel(channelId, {
                name: name || channelId,
                name_line: nameLine,
            });
            this.closeEditModal();
            this.toast('Canal atualizado!', 'success');
            await this.loadChannels();
        } catch (e) {
            this.toast('Erro ao salvar: ' + e.message, 'error');
        }
    }

    async removeChannel(channelId) {
        if (!confirm('Remover este canal?')) return;
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
