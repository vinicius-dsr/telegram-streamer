class App {
    constructor() {
        this.currentChannel = null;
        this.currentTag = '';
        this.currentGroup = '';
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
        this.currentGroup = '';
        document.getElementById('search-input').value = '';
        if (channelId) {
            await this.loadVideos();
            this.renderFilterBar();
        } else {
            document.getElementById('video-grid').innerHTML = '<div class="empty-state"><p>Selecione um canal para comecar</p></div>';
        }
    }

    async loadVideos() {
        if (!this.currentChannel) return;
        this.showLoading(true);
        try {
            this.allVideos = await api.getVideos(this.currentChannel, '', 500, 0);
            this.filteredVideos = [...this.allVideos];
            this.applyFilters();
        } catch (e) {
            this.toast('Erro ao carregar videos: ' + e.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    getCurrentChannelConfig() {
        if (!this.currentChannel) return null;
        return this.channels.find(c => c.id === this.currentChannel) || null;
    }

    getGroupTags() {
        const ch = this.getCurrentChannelConfig();
        if (!ch || !ch.tag_groups || ch.tag_groups.length === 0) return null;
        return ch.tag_groups;
    }

    renderFilterBar() {
        const bar = document.querySelector('.tags-bar');
        const groups = this.getGroupTags();
        let html = '<button class="tag-btn active" data-tag="" data-group="" onclick="app.filterAll()">Todos</button>';

        if (groups) {
            html += '<span class="tag-separator">|</span>';
            for (const g of groups) {
                html += `<button class="tag-btn group-btn" data-group="${g.name}" onclick="app.filterGroup('${g.name.replace(/'/g, "\\'")}')">${g.name}</button>`;
            }
        }

        const tagsToShow = this.currentGroup ? this.getGroupTagsForFilter() : this.getAllTags();
        if (tagsToShow.length > 0) {
            if (groups) html += '<span class="tag-separator">|</span>';
            for (const t of tagsToShow) {
                const active = this.currentTag === t.tag ? ' active' : '';
                html += `<button class="tag-btn${active}" data-tag="${t.tag}" onclick="app.filterTag('${t.tag}')">#${t.tag} (${t.count})</button>`;
            }
        }

        bar.innerHTML = html;

        if (this.currentGroup) {
            bar.querySelectorAll('.group-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.group === this.currentGroup);
            });
        }
    }

    getAllTags() {
        const tags = {};
        for (const v of this.allVideos) {
            if (v.tags) {
                for (const t of v.tags) {
                    tags[t] = (tags[t] || 0) + 1;
                }
            }
        }
        return Object.entries(tags)
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }

    getGroupTagsForFilter() {
        const ch = this.getCurrentChannelConfig();
        if (!ch || !ch.tag_groups) return [];
        const group = ch.tag_groups.find(g => g.name === this.currentGroup);
        if (!group) return [];

        const tags = {};
        for (const v of this.allVideos) {
            if (v.tags && v.tags.some(t => group.tags.includes(t))) {
                for (const t of v.tags) {
                    if (group.tags.includes(t)) {
                        tags[t] = (tags[t] || 0) + 1;
                    }
                }
            }
        }
        return Object.entries(tags)
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }

    filterAll() {
        this.currentTag = '';
        this.currentGroup = '';
        this.filteredVideos = [...this.allVideos];
        this.renderFilterBar();
        this.renderGrid(this.filteredVideos);
    }

    filterGroup(groupName) {
        this.currentGroup = groupName;
        this.currentTag = '';
        const ch = this.getCurrentChannelConfig();
        const group = ch && ch.tag_groups ? ch.tag_groups.find(g => g.name === groupName) : null;
        if (group) {
            this.filteredVideos = this.allVideos.filter(v =>
                v.tags && v.tags.some(t => group.tags.includes(t))
            );
        } else {
            this.filteredVideos = [...this.allVideos];
        }
        this.renderFilterBar();
        this.renderGrid(this.filteredVideos);
    }

    filterTag(tag) {
        this.currentTag = tag;
        if (!tag) {
            if (this.currentGroup) {
                this.filterGroup(this.currentGroup);
                return;
            }
            this.filteredVideos = [...this.allVideos];
        } else {
            let base = [...this.allVideos];
            if (this.currentGroup) {
                const ch = this.getCurrentChannelConfig();
                const group = ch && ch.tag_groups ? ch.tag_groups.find(g => g.name === this.currentGroup) : null;
                if (group) {
                    base = base.filter(v => v.tags && v.tags.some(t => group.tags.includes(t)));
                }
            }
            this.filteredVideos = base.filter(v => v.tags && v.tags.includes(tag));
        }
        this.renderFilterBar();
        this.renderGrid(this.filteredVideos);
    }

    search(query) {
        const q = query.toLowerCase().trim();
        if (!q) {
            this.applyFilters();
            return;
        }
        let base = [...this.allVideos];
        if (this.currentGroup) {
            const ch = this.getCurrentChannelConfig();
            const group = ch && ch.tag_groups ? ch.tag_groups.find(g => g.name === this.currentGroup) : null;
            if (group) {
                base = base.filter(v => v.tags && v.tags.some(t => group.tags.includes(t)));
            }
        }
        if (this.currentTag) {
            base = base.filter(v => v.tags && v.tags.includes(this.currentTag));
        }
        this.filteredVideos = base.filter(v =>
            (v.title || '').toLowerCase().includes(q) ||
            (v.caption || '').toLowerCase().includes(q)
        );
        this.renderGrid(this.filteredVideos);
    }

    applyFilters() {
        let result = [...this.allVideos];
        if (this.currentGroup) {
            const ch = this.getCurrentChannelConfig();
            const group = ch && ch.tag_groups ? ch.tag_groups.find(g => g.name === this.currentGroup) : null;
            if (group) {
                result = result.filter(v => v.tags && v.tags.some(t => group.tags.includes(t)));
            }
        }
        if (this.currentTag) {
            result = result.filter(v => v.tags && v.tags.includes(this.currentTag));
        }
        this.filteredVideos = result;
        this.renderGrid(this.filteredVideos);
    }

    renderGrid(videos) {
        const grid = document.getElementById('video-grid');
        const groups = this.getGroupTags();
        const showSections = groups && !this.currentGroup && !this.currentTag;

        if (!videos || videos.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>Nenhum video encontrado</p></div>';
            return;
        }

        if (!showSections) {
            grid.innerHTML = '<div class="video-grid">' + videos.map(v => this.renderCard(v)).join('') + '</div>';
            return;
        }

        const grouped = {};
        const ungrouped = [];
        const taggedVideos = new Set();

        for (const g of groups) {
            grouped[g.name] = [];
            for (const v of videos) {
                if (v.tags && v.tags.some(t => g.tags.includes(t))) {
                    grouped[g.name].push(v);
                    taggedVideos.add(v.msg_id);
                }
            }
        }

        for (const v of videos) {
            if (!taggedVideos.has(v.msg_id)) {
                ungrouped.push(v);
            }
        }

        let html = '';
        for (const g of groups) {
            const gVideos = grouped[g.name];
            if (gVideos.length === 0) continue;
            html += `<details class="group-dropdown" open>
                <summary class="group-summary">
                    <span class="group-chevron"></span>
                    ${g.name}
                    <span class="group-count">(${gVideos.length} videos)</span>
                </summary>
                <div class="video-grid">${gVideos.map(v => this.renderCard(v)).join('')}</div>
            </details>`;
        }
        if (ungrouped.length > 0) {
            html += `<details class="group-dropdown">
                <summary class="group-summary">
                    <span class="group-chevron"></span>
                    Outros
                    <span class="group-count">(${ungrouped.length} videos)</span>
                </summary>
                <div class="video-grid">${ungrouped.map(v => this.renderCard(v)).join('')}</div>
            </details>`;
        }
        grid.innerHTML = html;
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
        container.innerHTML = this.channels.map(ch => {
            const tags = (ch.tags || []).slice(0, 8);
            const extra = (ch.tags || []).length - 8;
            const tagsHtml = tags.map(t => `<span class="tag-badge">#${t}</span>`).join('') + (extra > 0 ? `<span class="tag-badge">+${extra}</span>` : '');
            const groups = (ch.tag_groups || []).map(g => g.name).join(', ');
            return `
            <div class="channel-item">
                <div class="channel-info">
                    <div class="channel-name">${ch.name || ch.id}</div>
                    <div class="channel-id">${ch.id}</div>
                    ${tagsHtml ? `<div class="channel-tags">${tagsHtml}</div>` : ''}
                    ${groups ? `<div class="channel-id" style="margin-top:2px">Grupos: ${groups}</div>` : ''}
                </div>
                <div class="channel-actions">
                    <button class="btn btn-secondary btn-sm" onclick="app.openEditModal('${ch.id}')">Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="app.removeChannel('${ch.id}')">Remover</button>
                </div>
            </div>`;
        }).join('');
    }

    parseTags(raw) {
        if (!raw) return [];
        return raw.split(/[\s,]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
    }

    collectGroups(containerId) {
        const container = document.getElementById(containerId);
        const rows = container.querySelectorAll('.tag-group-row');
        const groups = [];
        rows.forEach(row => {
            const name = row.querySelector('.group-name-input').value.trim();
            const tagsRaw = row.querySelector('.group-tags-input').value.trim();
            if (name && tagsRaw) {
                groups.push({ name, tags: this.parseTags(tagsRaw) });
            }
        });
        return groups;
    }

    renderExistingGroups(containerId, groups) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        if (!groups || groups.length === 0) return;
        groups.forEach((g, i) => {
            const row = document.createElement('div');
            row.className = 'tag-group-row';
            row.innerHTML = `
                <input type="text" class="group-name-input" value="${g.name}">
                <input type="text" class="group-tags-input" value="${(g.tags || []).map(t => '#' + t).join(' ')}">
                <button class="btn-remove-group" onclick="this.parentElement.remove()" title="Remover grupo">&times;</button>
            `;
            container.appendChild(row);
        });
    }

    addGroupRow(btn) {
        const builder = btn.closest('.tag-groups-builder');
        const list = builder.querySelector('.existing-groups-list');
        const newRow = document.createElement('div');
        newRow.className = 'tag-group-row';
        newRow.innerHTML = `
            <input type="text" class="group-name-input" placeholder="Nome do grupo">
            <input type="text" class="group-tags-input" placeholder="Tags: #F47 #F48">
            <button class="btn-remove-group" onclick="this.parentElement.remove()" title="Remover grupo">&times;</button>
        `;
        list.appendChild(newRow);
    }

    addEditGroupRow(btn) {
        const builder = btn.closest('.tag-groups-builder');
        const list = builder.querySelector('.existing-groups-list');
        const newRow = document.createElement('div');
        newRow.className = 'tag-group-row';
        newRow.innerHTML = `
            <input type="text" class="group-name-input" placeholder="Nome do grupo">
            <input type="text" class="group-tags-input" placeholder="Tags: #F47 #F48">
            <button class="btn-remove-group" onclick="this.parentElement.remove()" title="Remover grupo">&times;</button>
        `;
        list.appendChild(newRow);
    }

    async addChannel() {
        const id = document.getElementById('new-channel-id').value.trim();
        const name = document.getElementById('new-channel-name').value.trim();
        const tagsRaw = document.getElementById('new-channel-tags').value.trim();
        const nameLine = document.getElementById('new-channel-name-line').value;
        if (!id) {
            this.toast('Informe o link ou @usuario do canal', 'error');
            return;
        }
        const tags = this.parseTags(tagsRaw);
        const tagGroups = this.collectGroups('add-groups-builder');
        try {
            await api.addChannel({ id, name: name || id, tags_raw: tagsRaw, tags, name_line: nameLine, tag_groups: tagGroups });
            document.getElementById('new-channel-id').value = '';
            document.getElementById('new-channel-name').value = '';
            document.getElementById('new-channel-tags').value = '';
            document.getElementById('add-groups-list').innerHTML = '';
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
        const tagsStr = (ch.tags || []).map(t => '#' + t).join(' ');
        document.getElementById('edit-channel-tags').value = tagsStr;
        document.getElementById('edit-channel-name-line').value = ch.name_line || 'ultima';
        this.renderExistingGroups('edit-groups-list', ch.tag_groups || []);
        document.getElementById('edit-modal').classList.add('active');
    }

    closeEditModal() {
        document.getElementById('edit-modal').classList.remove('active');
    }

    async saveEditChannel() {
        const channelId = document.getElementById('edit-channel-id').value;
        const name = document.getElementById('edit-channel-name').value.trim();
        const tagsRaw = document.getElementById('edit-channel-tags').value.trim();
        const nameLine = document.getElementById('edit-channel-name-line').value;
        const tagGroups = this.collectGroups('edit-groups-list');
        try {
            await api.updateChannel(channelId, {
                name: name || channelId,
                tags_raw: tagsRaw,
                name_line: nameLine,
                tag_groups: tagGroups,
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
