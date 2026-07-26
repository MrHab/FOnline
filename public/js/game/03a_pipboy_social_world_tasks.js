
  let pipboyActiveTab = 'items';

  function pipboyLocalText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = String(value);
    if (el.textContent !== text) el.textContent = text;
  }

  let socialLocalState = normalizeSocialState();

  function normalizeSocialEntry(entry = {}) {
    const rawId = entry.id || entry.characterId || entry.playerId || entry.socketId || entry.name || '';
    const id = String(rawId || '').trim().slice(0, 96);
    const name = String(entry.name || entry.fromName || entry.login || id || 'Игрок').trim().slice(0, 42) || 'Игрок';
    if (!id && !name) return null;
    return {
      id: id || name,
      name,
      level: Math.max(1, Math.round(Number(entry.level || 1))),
      lastSeen: Math.max(0, Number(entry.lastSeen || Date.now())),
      clanName: String(entry.clanName || '').trim().slice(0, 42),
      clanId: String(entry.clanId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    };
  }

  function uniqueSocialEntries(entries = []) {
    const byId = new Map();
    entries.forEach(entry => {
      const normalized = normalizeSocialEntry(entry);
      if (!normalized) return;
      const key = normalized.id || normalized.name;
      const prev = byId.get(key);
      byId.set(key, prev ? { ...prev, ...normalized } : normalized);
    });
    return Array.from(byId.values());
  }

  function normalizeSocialState(input = {}) {
    const clan = input.clan && typeof input.clan === 'object' ? input.clan : {};
    return {
      friends: uniqueSocialEntries(input.friends || []),
      friendRequests: uniqueSocialEntries(input.friendRequests || []),
      clan: {
        id: String(clan.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
        name: String(clan.name || '').trim().slice(0, 42),
        role: String(clan.role || 'Основатель').trim().slice(0, 28) || 'Участник',
        members: uniqueSocialEntries(clan.members || [])
      },
      clanInvites: uniqueSocialEntries(input.clanInvites || [])
    };
  }

  function socialStateSnapshot() {
    return normalizeSocialState(socialLocalState);
  }

  function applySocialStateSnapshot(input = {}) {
    socialLocalState = normalizeSocialState(input || {});
  }

  function selfSocialEntry() {
    return normalizeSocialEntry({
      id: characterProfile?.serverCharacterId || selectedServerCharacterId || characterProfile?.name || player.name || 'self',
      name: characterProfile?.name || player.name || 'Странник',
      level: player.level || 1
    });
  }

  function remoteSocialEntries() {
    if (typeof multiplayer === 'undefined' || !multiplayer?.remotePlayers) return [];
    return Array.from(multiplayer.remotePlayers.values())
      .filter(row => row?.data?.id && (!row.group || row.group.visible !== false))
      .map(row => normalizeSocialEntry({
        id: row.data.characterId || row.data.id,
        socketId: row.data.id,
        name: row.data.name || 'Игрок',
        level: row.data.level || 1
      }))
      .filter(Boolean);
  }

  function findRemotePlayerBySocialId(id) {
    const key = String(id || '');
    if (!key || typeof multiplayer === 'undefined' || !multiplayer?.remotePlayers) return null;
    let found = null;
    multiplayer.remotePlayers.forEach(row => {
      if (found || !row?.data) return;
      const ids = [row.data.characterId, row.data.id, row.data.name].map(v => String(v || ''));
      if (ids.includes(key)) found = row;
    });
    return found;
  }

  function socialHasEntry(list = [], id = '') {
    const key = String(id || '');
    return list.some(entry => String(entry.id || entry.name || '') === key);
  }

  function submitServerSocialStateAction(action = '', payload = {}) {
    if (!multiplayer?.socket?.connected || !multiplayer.joined) {
      setReadout('Нет соединения с сервером: социальное действие не выполнено.');
      return false;
    }
    multiplayer.socket.emit('socialStateAction', { action, ...payload }, ack => {
      if (!ack || ack.ok === false) {
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        setReadout(ack?.error || 'Социальное действие не выполнено.');
        return;
      }
      if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      else if (ack.socialState) applySocialStateSnapshot(ack.socialState);
      if (ack.message) addLog(ack.message, null, 'system');
      renderPipboyInfoPanels();
    });
    return true;
  }

  function addSocialFriend(entry) {
    const normalized = normalizeSocialEntry(entry);
    if (!normalized || socialHasEntry(socialLocalState.friends, normalized.id)) return false;
    return submitServerSocialStateAction('acceptFriend', { targetId: normalized.id });
  }

  function removeSocialFriend(id) {
    const key = String(id || '');
    if (key) submitServerSocialStateAction('removeFriend', { targetId: key });
  }

  function registerIncomingSocialAction(data = {}) {
    if (data.socialState && typeof data.socialState === 'object') {
      applySocialStateSnapshot(data.socialState);
      renderPipboyInfoPanels();
      return;
    }
    const entry = normalizeSocialEntry({
      id: data.fromCharacterId || data.fromId || data.playerId || data.id || data.fromName,
      name: data.fromName || data.name || 'Игрок',
      level: data.level || 1,
      clanName: data.clanName || ''
    });
    if (!entry) return;
    if (data.action === 'friend') {
      if (!socialHasEntry(socialLocalState.friendRequests, entry.id) && !socialHasEntry(socialLocalState.friends, entry.id)) {
        socialLocalState.friendRequests = uniqueSocialEntries([...socialLocalState.friendRequests, entry]);
        queueSave();
      }
    } else if (data.action === 'clan') {
      if (!socialHasEntry(socialLocalState.clanInvites, entry.id)) {
        socialLocalState.clanInvites = uniqueSocialEntries([...socialLocalState.clanInvites, entry]);
        queueSave();
      }
    }
    renderPipboyInfoPanels();
  }

  function socialStatusText() {
    if (typeof multiplayer === 'undefined' || !multiplayer?.socket) return 'локально';
    if (multiplayer.socket.connected && multiplayer.joined) return 'в сети';
    if (multiplayer.socket.connected) return 'подключение';
    return 'нет связи';
  }

  function socialEmpty(text) {
    return `<div class="pipboy-social-empty">${escapeHtml(text)}</div>`;
  }

  function socialAvatar(name = 'Игрок') {
    const source = String(name || '?').trim();
    return escapeHtml(source.slice(0, 1).toUpperCase() || '?');
  }

  function socialRow(entry, opts = {}) {
    const online = opts.online ? '<span class="pipboy-social-dot online"></span>онлайн' : '<span class="pipboy-social-dot"></span>нет связи';
    const detail = opts.detail || `Уровень ${Math.max(1, Math.round(Number(entry.level || 1)))}`;
    const actions = (opts.actions || []).map(action => {
      const disabled = action.disabled ? ' disabled' : '';
      return `<button type="button" class="pipboy-social-btn" data-social-action="${escapeHtml(action.id)}" data-social-id="${escapeHtml(entry.id)}" data-social-name="${escapeHtml(entry.name)}"${disabled}>${escapeHtml(action.label)}</button>`;
    }).join('');
    return `
      <div class="pipboy-social-row" data-social-search="${escapeHtml(`${entry.name} ${detail}`.toLowerCase())}">
        <div class="pipboy-social-avatar">${socialAvatar(entry.name)}</div>
        <div class="pipboy-social-main">
          <b>${escapeHtml(entry.name)}</b>
          <span>${escapeHtml(detail)}</span>
          <small>${online}</small>
        </div>
        <div class="pipboy-social-actions">${actions}</div>
      </div>`;
  }

  function bindPipboySocialControls(root) {
    if (!root) return;
    root.querySelectorAll('[data-social-action]').forEach(btn => {
      if (btn.dataset.boundSocialAction === '1') return;
      btn.dataset.boundSocialAction = '1';
      btn.addEventListener('click', e => {
        e.preventDefault();
        const action = btn.dataset.socialAction || '';
        const entry = normalizeSocialEntry({ id: btn.dataset.socialId, name: btn.dataset.socialName });
        if (!entry) return;
        if (action === 'add-friend' || action === 'accept-friend') {
          addSocialFriend(entry);
        } else if (action === 'remove-friend') {
          removeSocialFriend(entry.id);
        } else if (action === 'decline-friend') {
          submitServerSocialStateAction('declineFriend', { targetId: entry.id });
        } else if (action === 'remote-friend') {
          const row = findRemotePlayerBySocialId(entry.id);
          if (row && typeof sendRemoteSocialAction === 'function') sendRemoteSocialAction(row, 'friend');
        } else if (action === 'invite-clan') {
          const row = findRemotePlayerBySocialId(entry.id);
          if (row && typeof sendRemoteSocialAction === 'function') sendRemoteSocialAction(row, 'clan');
          setReadout(`Приглашение в клан: ${entry.name}.`);
        } else if (action === 'accept-clan') {
          submitServerSocialStateAction('acceptClan', { targetId: entry.id });
        } else if (action === 'decline-clan') {
          submitServerSocialStateAction('declineClan', { targetId: entry.id });
        }
        renderPipboyInfoPanels();
      });
    });

    root.querySelectorAll('[data-social-filter]').forEach(input => {
      if (input.dataset.boundSocialFilter === '1') return;
      input.dataset.boundSocialFilter = '1';
      input.addEventListener('input', () => {
        const term = String(input.value || '').trim().toLowerCase();
        root.querySelectorAll('[data-social-search]').forEach(row => {
          row.classList.toggle('hidden', !!term && !String(row.dataset.socialSearch || '').includes(term));
        });
      });
    });

    const clanNameInput = root.querySelector('#pipboy-clan-name-input');
    const createClanBtn = root.querySelector('#pipboy-clan-create-btn');
    if (clanNameInput && createClanBtn && createClanBtn.dataset.boundClanCreate !== '1') {
      createClanBtn.dataset.boundClanCreate = '1';
      createClanBtn.addEventListener('click', e => {
        e.preventDefault();
        const name = String(clanNameInput.value || '').trim().slice(0, 42);
        if (!name) {
          setReadout('Введите название клана.');
          return;
        }
        submitServerSocialStateAction('createClan', { name });
      });
    }

    const leaveClanBtn = root.querySelector('#pipboy-clan-leave-btn');
    if (leaveClanBtn && leaveClanBtn.dataset.boundClanLeave !== '1') {
      leaveClanBtn.dataset.boundClanLeave = '1';
      leaveClanBtn.addEventListener('click', e => {
        e.preventDefault();
        submitServerSocialStateAction('leaveClan');
      });
    }
  }

  function renderPipboyFriendsPanel() {
    const grid = document.getElementById('pipboy-friends-grid');
    if (!grid) return;
    const remotes = remoteSocialEntries();
    const onlineFriendIds = new Set(remotes.map(row => row.id));
    const friendRows = socialLocalState.friends.length
      ? socialLocalState.friends.map(entry => socialRow(entry, {
        online: onlineFriendIds.has(entry.id),
        detail: onlineFriendIds.has(entry.id) ? 'В текущей локации' : 'Сохранённый контакт',
        actions: [{ id: 'remove-friend', label: 'Удалить' }]
      })).join('')
      : socialEmpty('Список друзей пуст. Добавьте игрока из текущей локации или примите заявку.');
    const roomRows = remotes.length
      ? remotes.map(entry => socialRow(entry, {
        online: true,
        detail: `Уровень ${entry.level} · текущая локация`,
        actions: [
          { id: 'remote-friend', label: socialHasEntry(socialLocalState.friends, entry.id) ? 'Друг' : 'Добавить', disabled: socialHasEntry(socialLocalState.friends, entry.id) }
        ]
      })).join('')
      : socialEmpty('В текущей локации нет других игроков.');
    const requestRows = socialLocalState.friendRequests.length
      ? socialLocalState.friendRequests.map(entry => socialRow(entry, {
        online: false,
        detail: 'Заявка в друзья',
        actions: [
          { id: 'accept-friend', label: 'Принять' },
          { id: 'decline-friend', label: 'Отклонить' }
        ]
      })).join('')
      : socialEmpty('Новых заявок нет.');
    const html = `
      <div class="pipboy-social-dashboard">
        <div><span>Сеть</span><b>${escapeHtml(socialStatusText())}</b></div>
        <div><span>В локации</span><b>${remotes.length}</b></div>
        <div><span>Друзья</span><b>${socialLocalState.friends.length}</b></div>
        <div><span>Заявки</span><b>${socialLocalState.friendRequests.length}</b></div>
      </div>
      <div class="pipboy-social-toolbar">
        <input class="pipboy-social-input" type="search" data-social-filter placeholder="поиск по друзьям и локации">
        <span>Друзья видят текущую локацию и входящие заявки.</span>
      </div>
      <div class="pipboy-social-columns">
        <section class="pipboy-social-panel wide">
          <div class="pipboy-social-title">Друзья</div>
          <div class="pipboy-social-list">${friendRows}</div>
        </section>
        <section class="pipboy-social-panel">
          <div class="pipboy-social-title">Игроки в локации</div>
          <div class="pipboy-social-list">${roomRows}</div>
        </section>
        <section class="pipboy-social-panel">
          <div class="pipboy-social-title">Заявки</div>
          <div class="pipboy-social-list">${requestRows}</div>
        </section>
      </div>`;
    if (grid.dataset.renderSignature !== html) {
      grid.innerHTML = html;
      grid.dataset.renderSignature = html;
    }
    bindPipboySocialControls(grid);
  }

  function renderPipboyClanPanel() {
    const grid = document.getElementById('pipboy-clan-grid');
    if (!grid) return;
    const hasClan = !!socialLocalState.clan.name;
    const self = selfSocialEntry();
    const clanMembers = hasClan ? uniqueSocialEntries([self, ...socialLocalState.clan.members]) : [];
    const remotes = remoteSocialEntries();
    const onlineIds = new Set(remotes.map(row => row.id));
    const memberRows = clanMembers.length
      ? clanMembers.map(entry => socialRow(entry, {
        online: entry.id === self.id || onlineIds.has(entry.id),
        detail: entry.id === self.id ? socialLocalState.clan.role : 'Участник',
        actions: []
      })).join('')
      : socialEmpty('Создайте клан, чтобы появился состав.');
    const inviteRows = socialLocalState.clanInvites.length
      ? socialLocalState.clanInvites.map(entry => socialRow(entry, {
        online: false,
        detail: entry.clanName ? `Приглашение: ${entry.clanName}` : 'Приглашение в клан',
        actions: [
          { id: 'accept-clan', label: 'Вступить' },
          { id: 'decline-clan', label: 'Отклонить' }
        ]
      })).join('')
      : socialEmpty('Приглашений нет.');
    const recruitRows = hasClan && remotes.length
      ? remotes.map(entry => socialRow(entry, {
        online: true,
        detail: `Уровень ${entry.level} · кандидат`,
        actions: [{ id: 'invite-clan', label: 'Пригласить' }]
      })).join('')
      : socialEmpty(hasClan ? 'В локации нет игроков для приглашения.' : 'Создайте клан, чтобы приглашать игроков.');
    const control = hasClan
      ? `<div class="pipboy-social-clan-card">
          <span>Ваш клан</span>
          <b>${escapeHtml(socialLocalState.clan.name)}</b>
          <small>${escapeHtml(socialLocalState.clan.role)} · участников ${clanMembers.length}</small>
          <button id="pipboy-clan-leave-btn" class="pipboy-social-btn danger" type="button">Покинуть</button>
        </div>`
      : `<div class="pipboy-social-clan-card">
          <span>Нет клана</span>
          <b>Создать отряд</b>
          <small>Название сохранится в персонаже. Серверные заявки будут отображаться здесь.</small>
          <div class="pipboy-social-create">
            <input id="pipboy-clan-name-input" class="pipboy-social-input" type="text" maxlength="42" placeholder="название клана">
            <button id="pipboy-clan-create-btn" class="pipboy-social-btn" type="button">Создать</button>
          </div>
        </div>`;
    const html = `
      <div class="pipboy-social-dashboard">
        <div><span>Клан</span><b>${hasClan ? escapeHtml(socialLocalState.clan.name) : 'нет'}</b></div>
        <div><span>Ранг</span><b>${hasClan ? escapeHtml(socialLocalState.clan.role) : '-'}</b></div>
        <div><span>Онлайн</span><b>${clanMembers.filter(entry => entry.id === self.id || onlineIds.has(entry.id)).length}</b></div>
        <div><span>Приглашения</span><b>${socialLocalState.clanInvites.length}</b></div>
      </div>
      ${control}
      <div class="pipboy-social-columns">
        <section class="pipboy-social-panel wide">
          <div class="pipboy-social-title">Состав</div>
          <div class="pipboy-social-list">${memberRows}</div>
        </section>
        <section class="pipboy-social-panel">
          <div class="pipboy-social-title">Пригласить</div>
          <div class="pipboy-social-list">${recruitRows}</div>
        </section>
        <section class="pipboy-social-panel">
          <div class="pipboy-social-title">Входящие</div>
          <div class="pipboy-social-list">${inviteRows}</div>
        </section>
      </div>`;
    if (grid.dataset.renderSignature !== html) {
      grid.innerHTML = html;
      grid.dataset.renderSignature = html;
    }
    bindPipboySocialControls(grid);
  }

  const serverWorldTaskRecords = new Map();

  function applyServerWorldTaskRecords(input = []) {
    serverWorldTaskRecords.clear();
    (Array.isArray(input) ? input : []).slice(0, 300).forEach(task => {
      const id = String(task?.id || '').trim();
      if (id) serverWorldTaskRecords.set(id, task);
    });
  }

  function pipboyWorldStateSnapshot() {
    try {
      const sim = typeof WASTELAND_SIM_STATE !== 'undefined' ? WASTELAND_SIM_STATE : null;
      if (!sim || !serverWorldTaskRecords.size) return sim;
      const personal = Array.from(serverWorldTaskRecords.values());
      const personalIds = new Set(personal.map(task => String(task?.id || '')).filter(Boolean));
      const publicTasks = (Array.isArray(sim.worldTasks) ? sim.worldTasks : [])
        .filter(task => !personalIds.has(String(task?.id || '')));
      return { ...sim, worldTasks: [...personal, ...publicTasks] };
    } catch (_) {
      return null;
    }
  }

  function worldTaskSimulationDayMs() {
    const sim = pipboyWorldStateSnapshot() || {};
    return Math.max(60000, Number(sim.gameDayRealMs || 60 * 60 * 1000));
  }

  function worldTaskEstimatedWorldHour() {
    const sim = pipboyWorldStateSnapshot() || {};
    const baseHour = Number(sim.worldHour || 0);
    const updatedAt = Number(sim.updatedAt || 0);
    if (!Number.isFinite(baseHour)) return 0;
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return baseHour;
    const elapsedMs = Math.max(0, Date.now() - updatedAt);
    return baseHour + elapsedMs / worldTaskSimulationDayMs() * 24;
  }

  function formatWorldTaskCountdown(seconds = 0) {
    const total = Math.max(0, Math.ceil(Number(seconds || 0)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function worldTaskCaravanDepartureSecondsLeft(task = {}) {
    const details = task?.details && typeof task.details === 'object' ? task.details : {};
    if (String(task?.type || '').toLowerCase() !== 'escort_caravan') return null;
    if (String(task?.status || 'active') !== 'active') return null;
    if (!details.staging || details.joinClosed) return null;
    const waitUntilHour = Number(details.waitUntilHour || 0);
    if (!Number.isFinite(waitUntilHour) || waitUntilHour <= 0) return null;
    const worldHoursLeft = Math.max(0, waitUntilHour - worldTaskEstimatedWorldHour());
    return Math.max(0, Math.ceil(worldHoursLeft / 24 * worldTaskSimulationDayMs() / 1000));
  }

  function worldTaskCaravanDepartureText(task = {}) {
    const secondsLeft = worldTaskCaravanDepartureSecondsLeft(task);
    if (secondsLeft === null) return '';
    return secondsLeft > 0
      ? `До выхода каравана: ${formatWorldTaskCountdown(secondsLeft)}`
      : 'Караван выходит';
  }

  function worldTaskCaravanDepartureHtml(task = {}, className = 'pipboy-world-task-supplies') {
    const text = worldTaskCaravanDepartureText(task);
    if (!text) return '';
    return `<small class="${escapeHtml(className)} caravan-departure-countdown" data-world-task-countdown="${escapeHtml(task.id || '')}">${escapeHtml(text)}</small>`;
  }

  function refreshWorldTaskCountdownLabels(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const sim = pipboyWorldStateSnapshot() || {};
    const tasks = Array.isArray(sim.worldTasks) ? sim.worldTasks : [];
    const byId = new Map(tasks.map(task => [String(task?.id || ''), task]));
    root.querySelectorAll('[data-world-task-countdown]').forEach(node => {
      const task = byId.get(String(node.dataset.worldTaskCountdown || ''));
      const text = task ? worldTaskCaravanDepartureText(task) : '';
      if (text) {
        node.textContent = text;
        node.style.display = '';
      } else {
        node.textContent = '';
        node.style.display = 'none';
      }
    });
  }

  setInterval(() => {
    refreshWorldTaskCountdownLabels(document);
  }, 1000);

  function pipboyWorldOwnerLabel(owner = '') {
    const key = String(owner || '').toLowerCase();
    const labels = {
      old_klim: 'Старый Клим',
      scrap_union: 'Свалочный союз',
      relay_order: 'Орден ретранслятора',
      caravans: 'Караваны',
      neutral: 'Нейтралы',
      raiders: 'Рейдеры',
      mutants: 'Мутанты',
      wild: 'Дикая фауна'
    };
    return labels[key] || owner || 'неизвестно';
  }

  function pipboyWorldSiteTypeLabel(type = '') {
    const key = String(type || '').toLowerCase();
    if (key === 'settlement') return 'Поселение';
    if (key === 'resource') return 'Ресурс';
    if (key === 'outpost') return 'Аванпост';
    if (key === 'production') return 'Производство';
    if (key === 'pointofinterest') return 'Точка интереса';
    return 'Точка мира';
  }

  function pipboyWorldPartyKindLabel(kind = '') {
    const key = String(kind || '').toLowerCase();
    if (key === 'caravan') return 'Караван';
    if (key === 'patrol') return 'Патруль';
    if (key === 'raider') return 'Рейдеры';
    if (key === 'monster') return 'Монстры';
    return 'Группа';
  }

  function pipboyWorldPartyStateLabel(state = '') {
    const labels = {
      idle: 'на стоянке',
      moving: 'в пути',
      staging: 'собирается в путь',
      returning: 'возвращается на базу',
      onsite: 'работает на точке',
      engaged: 'участвует во встрече',
      recovering: 'восстанавливается',
      waiting: 'ожидает',
      destroyed: 'уничтожен'
    };
    return labels[String(state || '').toLowerCase()] || 'следует своим маршрутом';
  }

  function pipboyWorldEventTypeLabel(type = '') {
    const key = String(type || '').toLowerCase();
    if (key.includes('task')) return 'Работа';
    if (key.includes('caravan')) return 'Караван';
    if (key.includes('party') || key.includes('battle')) return 'Отряд';
    if (key.includes('raid') || key.includes('ambush') || key.includes('threat')) return 'Опасность';
    if (key.includes('site') || key.includes('resource') || key.includes('control')) return 'Точка';
    if (key.includes('trade') || key.includes('production') || key.includes('supply')) return 'Экономика';
    if (key.includes('lair')) return 'Логово';
    return 'Событие';
  }

  function pipboyWorldSiteName(siteId = '', sites = []) {
    const id = String(siteId || '').trim();
    const site = (Array.isArray(sites) ? sites : []).find(row => String(row?.id || '') === id);
    return String(site?.name || '').trim() || 'отмеченной точке';
  }

  function pipboyWorldStockText(stock = {}) {
    const labels = {
      silver: 'крышки',
      water: 'вода',
      ore: 'руда',
      scrap: 'лом',
      oil: 'нефть',
      chemicals: 'хим.',
      medicine: 'мед.',
      electronics: 'электр.',
      ammoParts: 'детали',
      food: 'еда',
      ammo9: '9мм',
      ammo556: '5.56',
      shotgunShell: 'дробь',
      energyCell: 'энергоячейки',
      napalm: 'напалм',
      repairKit: 'ремкомплекты',
      wood: 'древесина',
      weaponParts: 'оруж. детали'
    };
    const rows = Object.entries(stock || {})
      .filter(([, value]) => Number(value || 0) > 0.01)
      .slice(0, 5)
      .map(([key, value]) => `${labels[key] || key} ${Math.round(Number(value || 0))}`);
    return rows.length ? rows.join(' · ') : 'запасов нет';
  }

  function pipboyWorldSiteStatus(site = {}, worldHour = 0) {
    if (Number(site.supplyDisruptedUntil || 0) > worldHour) return { key: 'danger', text: 'дефицит снабжения' };
    if (Number(site.threatSuppressedUntil || 0) > worldHour) return { key: 'safe', text: 'угроза подавлена' };
    if (Math.abs(Number(site.controlPressure || 0)) > 8) return { key: 'warning', text: 'идёт борьба за контроль' };
    if (Number(site.security || 100) < 35) return { key: 'warning', text: 'низкая безопасность' };
    return { key: 'stable', text: 'стабильно' };
  }

  function renderPipboyWorldPanel() {
    const grid = document.getElementById('pipboy-world-grid');
    if (!grid) return;
    if (typeof requestWastelandSimState === 'function') requestWastelandSimState(false);
    const sim = pipboyWorldStateSnapshot() || {};
    const sites = Array.isArray(sim.sites) ? sim.sites : [];
    const parties = Array.isArray(sim.parties) ? sim.parties.filter(row => row && !row.destroyed).slice(0, 8) : [];
    const events = Array.isArray(sim.events) ? sim.events.slice(0, 8) : [];
    const worldHour = Number(sim.worldHour || 0);
    if (!sites.length && !parties.length && !events.length) {
      const empty = '<div class="pipboy-world-empty">Нет данных симуляции мира. Откройте глобальную карту или обновите страницу.</div>';
      if (grid.dataset.renderSignature !== empty) {
        grid.innerHTML = empty;
        grid.dataset.renderSignature = empty;
      }
      return;
    }
    const settlementRows = sites
      .filter(site => String(site.type || '') === 'settlement')
      .slice(0, 6)
      .map(site => {
        const status = pipboyWorldSiteStatus(site, worldHour);
        return `<div class="pipboy-world-card ${status.key}">
          <div><span>${escapeHtml(pipboyWorldSiteTypeLabel(site.type))}</span><b>${escapeHtml(site.name || site.id)}</b></div>
          <small>${escapeHtml(status.text)} · ${escapeHtml(pipboyWorldOwnerLabel(site.owner))}</small>
          <em>Безопасность ${Math.round(Number(site.security || 0))} · Запасы: ${escapeHtml(pipboyWorldStockText(site.stockpile))}</em>
        </div>`;
      }).join('');
    const siteRows = sites
      .filter(site => String(site.type || '') !== 'settlement')
      .slice(0, 10)
      .map(site => {
        const status = pipboyWorldSiteStatus(site, worldHour);
        return `<div class="pipboy-world-card ${status.key}">
          <div><span>${escapeHtml(pipboyWorldSiteTypeLabel(site.type))}</span><b>${escapeHtml(site.name || site.id)}</b></div>
          <small>${escapeHtml(status.text)} · ${escapeHtml(pipboyWorldOwnerLabel(site.owner))}</small>
          <em>Контроль ${Number(site.controlPressure || 0).toFixed(1)} · Запасы: ${escapeHtml(pipboyWorldStockText(site.stockpile))}</em>
        </div>`;
      }).join('');
    const partyRows = parties.map(party => {
      const route = party.destinationSiteId
        ? `Путь к: ${pipboyWorldSiteName(party.destinationSiteId, sites)}`
        : pipboyWorldPartyStateLabel(party.state);
      return `<div class="pipboy-world-row">
        <b>${escapeHtml(pipboyWorldPartyKindLabel(party.kind))}: ${escapeHtml(party.name || party.id)}</b>
        <span>${escapeHtml(pipboyWorldOwnerLabel(party.faction))} · бойцов ${Math.round(Number(party.members || 0))} · сила ${Math.round(Number(party.strength || 0))}</span>
        <small>${escapeHtml(route)}</small>
      </div>`;
    }).join('');
    const eventRows = events.map(event => `<div class="pipboy-world-event">
      <span>${escapeHtml(pipboyWorldEventTypeLabel(event.type))}</span>
      <b>${escapeHtml(event.title || event.text || 'Событие мира')}</b>
    </div>`).join('');
    const html = `
      <div class="pipboy-world-dashboard">
        <div><span>Час мира</span><b>${Math.floor(worldHour)}</b></div>
        <div><span>Точки</span><b>${sites.length}</b></div>
        <div><span>Группы</span><b>${parties.length}</b></div>
        <div><span>Караваны</span><b>${Math.round(Number(sim.stats?.caravansArrived || 0))}/${Math.round(Number(sim.stats?.caravansLost || 0))}</b></div>
      </div>
      <div class="pipboy-world-layout">
        <section>
          <div class="pipboy-world-title">Поселения</div>
          ${settlementRows || '<div class="pipboy-world-empty">Поселений нет.</div>'}
          <div class="pipboy-world-title">Ресурсы и аванпосты</div>
          ${siteRows || '<div class="pipboy-world-empty">Точек мира нет.</div>'}
        </section>
        <section>
          <div class="pipboy-world-title">Группы на карте</div>
          ${partyRows || '<div class="pipboy-world-empty">Активных групп нет.</div>'}
          <div class="pipboy-world-title">Последние события</div>
          ${eventRows || '<div class="pipboy-world-empty">Событий пока нет.</div>'}
        </section>
      </div>`;
    if (grid.dataset.renderSignature !== html) {
      grid.innerHTML = html;
      grid.dataset.renderSignature = html;
    }
  }

  function normalizePipboyInventoryTab(tab = 'items') {
    return ['status', 'items', 'quests', 'world', 'factions', 'friends', 'clan', 'radio'].includes(tab) ? tab : 'items';
  }

  function updatePipboyTabButtons(activeTab = pipboyActiveTab) {
    document.querySelectorAll('[data-pipboy-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pipboyTab === activeTab);
    });
  }

  function setPipboyInventoryPage(tab = 'items', opts = {}) {
    pipboyActiveTab = normalizePipboyInventoryTab(tab);
    const win = document.getElementById('inventory-window');
    if (win) win.dataset.pipboyScreen = pipboyActiveTab;
    document.querySelectorAll('#inventory-window .pipboy-page').forEach(page => {
      page.classList.toggle('active', page.dataset.pipboyPage === pipboyActiveTab);
    });
    updatePipboyTabButtons(pipboyActiveTab);
    if (!opts.noRender) renderPipboyInfoPanels();
  }

  function pipboyQuestCard(status, title, text = '', reward = '') {
    return `<div class="pipboy-quest-card"><span>${escapeHtml(status)}</span><b>${escapeHtml(title)}</b>${text ? `<small>${escapeHtml(text)}</small>` : ''}${reward ? `<em>${escapeHtml(reward)}</em>` : ''}</div>`;
  }

  function pipboyQuestEmpty(text) {
    return `<div class="pipboy-quest-empty">${escapeHtml(text)}</div>`;
  }

  const worldTaskRewardClaims = new Set();
  const worldTaskAccepted = new Set();
  let worldTaskTrackedId = '';

  function worldTaskRewardClaimsSnapshot() {
    return Array.from(worldTaskRewardClaims).slice(-800);
  }

  function applyWorldTaskRewardClaims(input = []) {
    worldTaskRewardClaims.clear();
    (Array.isArray(input) ? input : []).slice(-800).forEach(id => {
      const key = String(id || '').trim();
      if (key) worldTaskRewardClaims.add(key);
    });
  }

  function worldTaskAcceptedSnapshot() {
    return Array.from(worldTaskAccepted).slice(0, 300);
  }

  function applyWorldTaskAccepted(input = []) {
    worldTaskAccepted.clear();
    (Array.isArray(input) ? input : []).slice(0, 300).forEach(id => {
      const key = String(id || '').trim();
      if (key) worldTaskAccepted.add(key);
    });
  }

  function worldTaskTrackedSnapshot() {
    return String(worldTaskTrackedId || '');
  }

  function applyWorldTaskTracked(input = '') {
    worldTaskTrackedId = String(input || '').trim().slice(0, 80);
  }

  function isWorldTaskAccepted(task = {}) {
    const id = String(task?.id || '').trim();
    return !!(id && worldTaskAccepted.has(id));
  }

  function submitWorldTaskServerAction(taskId = '', action = '') {
    const id = String(taskId || '').trim();
    const socket = typeof multiplayer === 'object' ? multiplayer.socket : null;
    if (!id || !socket?.connected || !multiplayer.joined) return Promise.resolve({ ok: false, error: 'Нет соединения с сервером мира.' });
    return new Promise(resolve => {
      let settled = false;
      const done = result => {
        if (settled) return;
        settled = true;
        resolve(result || { ok: false, error: 'Сервер не ответил.' });
      };
      socket.emit('worldTaskAction', { taskId: id, action }, ack => {
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        if (ack?.sim && typeof applyWastelandSimState === 'function') applyWastelandSimState(ack.sim);
        done(ack);
      });
      setTimeout(() => done({ ok: false, error: 'Сервер не ответил вовремя.' }), 5000);
    });
  }

  function currentTrackedWorldTask() {
    const id = String(worldTaskTrackedId || '').trim();
    if (!id) return null;
    const sim = pipboyWorldStateSnapshot() || {};
    const task = (Array.isArray(sim.worldTasks) ? sim.worldTasks : []).find(row => String(row?.id || '') === id);
    if (!task || task.status !== 'active' || !isWorldTaskAccepted(task)) return null;
    return task;
  }

  async function trackWorldTask(taskId = '') {
    const id = String(taskId || '').trim();
    const sim = pipboyWorldStateSnapshot() || {};
    const task = (Array.isArray(sim.worldTasks) ? sim.worldTasks : []).find(row => String(row?.id || '') === id);
    if (!task || task.status !== 'active') {
      addLog('Эта работа уже недоступна для отслеживания.', null, 'quest');
      worldTaskTrackedId = worldTaskTrackedId === id ? '' : worldTaskTrackedId;
      renderPipboyInfoPanels();
      return;
    }
    if (!isWorldTaskAccepted(task)) {
      addLog('Сначала возьмите работу.', null, 'quest');
      return;
    }
    const result = await submitWorldTaskServerAction(id, 'track');
    if (!result?.ok) {
      addLog(result?.error || 'Сервер не смог изменить метку.', null, 'quest');
      return;
    }
    addLog(result.trackedId ? `${task.title || 'Работа пустоши'}: отслеживается.` : `${task.title || 'Работа пустоши'}: метка снята.`, null, 'quest');
    renderPipboyInfoPanels();
    if (typeof renderGlobalMapPanel === 'function') renderGlobalMapPanel();
  }

  function worldTaskPartyId(task = {}) {
    return String(task.joinPartyId || task.partyId || task.details?.partyId || '').trim().slice(0, 80);
  }

  function worldTaskShouldLeavePartyOnCancel(task = {}) {
    const type = String(task?.type || '').toLowerCase();
    return !!(worldTaskPartyId(task) && (task.actionMode === 'join_party' || ['escort_caravan', 'join_patrol'].includes(type)));
  }

  async function acceptWorldTask(taskId = '') {
    const id = String(taskId || '').trim();
    const sim = pipboyWorldStateSnapshot() || {};
    const task = (Array.isArray(sim.worldTasks) ? sim.worldTasks : []).find(row => String(row?.id || '') === id);
    if (!task || task.status !== 'active') {
      addLog('Эта работа уже недоступна.', null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    const board = worldTaskAcceptancePlaceStatus(task);
    if (!board.ok) {
      addLog(board.text || 'Нужно подойти к доске работ.', null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    const access = worldTaskAccessStatus(task);
    if (!access.ok) {
      addLog(access.text || 'Эта работа пока недоступна.', null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    if (worldTaskAccepted.has(id)) {
      addLog(`${task.title || 'Работа пустоши'}: уже взято.`, null, 'quest');
      return;
    }
    const result = await submitWorldTaskServerAction(id, 'accept');
    if (!result?.ok) {
      addLog(result?.error || 'Сервер не подтвердил принятие работы.', null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    addLog(`${task.title || 'Работа пустоши'}: работа взята.`, null, 'quest');
    if (task.actionMode === 'join_party' && task.joinPartyId && typeof attachGlobalMapToWorldParty === 'function') {
      const authoritativeAttachmentApplied = typeof globalMapState === 'object'
        && String(globalMapState?.attachedPartyId || '') === String(task.joinPartyId || '')
        && String(globalMapState?.attachedPartyTaskId || '') === String(task.id || id);
      if (!authoritativeAttachmentApplied) attachGlobalMapToWorldParty(task.joinPartyId, task.id || id);
    }
    queueSave(true);
    renderPipboyInfoPanels();
  }

  async function cancelWorldTask(taskId = '') {
    const id = String(taskId || '').trim();
    if (!id) return;
    const sim = pipboyWorldStateSnapshot() || {};
    const task = (Array.isArray(sim.worldTasks) ? sim.worldTasks : []).find(row => String(row?.id || '') === id) || { id };
    const accepted = worldTaskAccepted.has(id);
    if (!accepted && worldTaskTrackedId !== id) return;
    const result = await submitWorldTaskServerAction(id, 'cancel');
    if (!result?.ok) {
      addLog(result?.error || 'Сервер не подтвердил отмену работы.', null, 'quest');
      return;
    }
    if (worldTaskShouldLeavePartyOnCancel(task) && typeof detachGlobalMapWorldParty === 'function') {
      detachGlobalMapWorldParty(
        `${task.title || 'Работа пустоши'}: вы покинули группу и отказались от работы.`,
        { skipServerCancel: true }
      );
    }
    addLog(`${task.title || 'Работа пустоши'}: работа отменена.`, null, 'quest');
    renderPipboyInfoPanels();
    if (typeof renderGlobalMapPanel === 'function') renderGlobalMapPanel();
    if (activeWorldTaskBoard) renderWorldTaskBoardWindow();
  }

  function pipboyWorldTaskReward(task = {}) {
    const reward = task.reward && typeof task.reward === 'object' ? task.reward : {};
    const parts = [];
    if (Number(reward.xp || 0) > 0) parts.push(`${Math.round(Number(reward.xp || 0))} XP`);
    if (Number(reward.caps || 0) > 0) parts.push(`${Math.round(Number(reward.caps || 0))} крышек`);
    if (Number(reward.reputation || 0) > 0) parts.push(`репутация +${Math.round(Number(reward.reputation || 0))}`);
    return parts.length ? `Награда: ${parts.join(', ')}.` : '';
  }

  const WORLD_TASK_SUPPLY_LABELS = {
    water: 'вода',
    ore: 'руда',
    scrap: 'лом',
    oil: 'нефть',
    chemicals: 'химикаты',
    medicine: 'медикаменты',
    electronics: 'электроника',
    ammoParts: 'детали патронов',
    weaponParts: 'оружейные детали',
    food: 'еда'
  };

  const WORLD_TASK_DELIVERY_OPTIONS = {
    medicine: [
      { id: 'medkit', qty: 1 },
      { id: 'stim', qty: 1 },
      { id: 'antibiotics', qty: 1 },
      { id: 'doctorBag', qty: 1 }
    ],
    ammoParts: [
      { id: 'ammo9', qty: 8 },
      { id: 'ammo556', qty: 5 },
      { id: 'shotgunShell', qty: 4 },
      { id: 'energyCell', qty: 8 },
      { id: 'napalm', qty: 6 },
      { id: 'rocketAmmo', qty: 1 }
    ],
    weaponParts: [
      { id: 'repairKit', qty: 1 },
      { id: 'scrap', qty: 2 },
      { id: 'ore', qty: 2 }
    ],
    chemicals: [
      { id: 'oil', qty: 1 },
      { id: 'antibiotics', qty: 1 }
    ],
    electronics: [
      { id: 'energyCell', qty: 8 },
      { id: 'repairKit', qty: 1 }
    ],
    food: [
      { id: 'water', qty: 1 }
    ]
  };

  function worldTaskSupplyLabel(id = '') {
    const key = String(id || '');
    return ITEMS[key]?.name || WORLD_TASK_SUPPLY_LABELS[key] || key;
  }

  function worldTaskDemand(task = {}) {
    const raw = task.details?.demand && typeof task.details.demand === 'object' ? task.details.demand : {};
    const out = {};
    Object.entries(raw).forEach(([id, qty]) => {
      const key = String(id || '').trim();
      const need = Math.max(0, Math.ceil(Number(qty || 0)));
      if (key && need > 0) out[key] = need;
    });
    return out;
  }

  function worldTaskDeliveryPlan(task = {}) {
    const demand = worldTaskDemand(task);
    const cost = {};
    const missing = {};
    Object.entries(demand).forEach(([resourceId, need]) => {
      let left = Math.max(0, Math.ceil(Number(need || 0)));
      const options = ITEMS[resourceId]
        ? [{ id: resourceId, qty: 1 }]
        : (WORLD_TASK_DELIVERY_OPTIONS[resourceId] || []);
      for (const option of options) {
        if (left <= 0) break;
        const itemId = String(option.id || '');
        const pack = Math.max(1, Math.ceil(Number(option.qty || 1)));
        if (!ITEMS[itemId]) continue;
        const alreadyReserved = Math.max(0, Number(cost[itemId] || 0));
        const available = Math.max(0, Math.floor(Number(inventory.get(itemId) || 0)) - alreadyReserved);
        const units = Math.min(left, Math.floor(available / pack));
        if (units <= 0) continue;
        cost[itemId] = alreadyReserved + units * pack;
        left -= units;
      }
      if (left > 0) missing[resourceId] = left;
    });
    return {
      demand,
      cost,
      missing,
      canDeliver: Object.keys(demand).length > 0 && Object.keys(missing).length === 0
    };
  }

  function worldTaskSupplyText(map = {}) {
    const rows = Object.entries(map || {})
      .filter(([, qty]) => Number(qty || 0) > 0)
      .map(([id, qty]) => `${worldTaskSupplyLabel(id)} x${Math.ceil(Number(qty || 0))}`);
    return rows.join(', ');
  }

  function worldTaskDeliveryHint(task = {}) {
    const plan = worldTaskDeliveryPlan(task);
    if (!Object.keys(plan.demand).length) return '';
    const site = worldTaskSite(task);
    const targetName = String(task.targetSiteName || site?.name || task.siteName || '').trim();
    const place = targetName ? `Куда сдавать: ${targetName}. ` : '';
    if (Object.keys(plan.missing).length) return `${place}Не хватает: ${worldTaskSupplyText(plan.missing)}.`;
    return `${place}Сдать: ${worldTaskSupplyText(plan.cost)}.`;
  }

  function worldTaskSite(task = {}) {
    const id = String(task.siteId || '').trim();
    if (!id) return null;
    const sim = pipboyWorldStateSnapshot() || {};
    return (Array.isArray(sim.sites) ? sim.sites : []).find(row => String(row?.id || '') === id) || null;
  }

  function worldTaskSiteById(siteId = '') {
    const id = String(siteId || '').trim();
    if (!id) return null;
    const sim = pipboyWorldStateSnapshot() || {};
    return (Array.isArray(sim.sites) ? sim.sites : []).find(row => String(row?.id || '') === id) || null;
  }

  function worldTaskBoardSite(task = {}) {
    return worldTaskSiteById(task.issuerSiteId || task.boardSiteId || task.siteId || '');
  }

  function worldTaskPlayerAtSite(siteId = '', site = null) {
    const id = String(siteId || site?.id || '').trim();
    if (!id) return false;
    try {
      if (typeof globalMapState !== 'undefined') {
        const onWorldMap = !!globalMapState.onWorldMap && !globalMapState.travel && !globalMapState.encounter;
        if (onWorldMap) {
          const px = Number(globalMapState.playerX || 0);
          const py = Number(globalMapState.playerY || 0);
          const worldSite = typeof globalMapWorldSiteAt === 'function' ? globalMapWorldSiteAt(px, py) : null;
          const settlement = typeof globalMapSettlementAt === 'function' ? globalMapSettlementAt(px, py) : null;
          if (String(worldSite?.id || settlement?.id || '').trim() === id) return true;
        }
        if (String(globalMapState.currentWorldSiteId || '').trim() === id) return true;
      }
    } catch (_) {}
    try {
      const locId = String(currentLocation?.id || '').trim();
      if (site?.locationId && locId === String(site.locationId || '').trim()) return true;
      if (!site?.locationId && locId === id) return true;
    } catch (_) {}
    return false;
  }

  function worldTaskAcceptancePlaceStatus(task = {}) {
    const site = worldTaskBoardSite(task);
    const siteId = String(task.issuerSiteId || task.boardSiteId || task.siteId || site?.id || '').trim();
    const siteName = task.issuerSiteName || site?.name || 'доска работ';
    if (!siteId) return { ok: false, site, text: 'Доска работ не найдена.' };
    if (worldTaskPlayerAtSite(siteId, site)) return { ok: true, site, text: `Вы у доски: ${siteName}.` };
    return { ok: false, site, text: `Взять можно у доски: ${siteName}.` };
  }

  function worldTaskDeliveryPlaceStatus(task = {}) {
    const site = worldTaskSite(task);
    const siteId = String(task.siteId || site?.id || '').trim();
    const siteName = site?.name || task.title || 'точка доставки';
    if (!siteId) return { ok: false, site, text: 'Точка доставки не найдена.' };
    if (worldTaskPlayerAtSite(siteId, site)) return { ok: true, site, text: `Вы у точки: ${siteName}.` };
    return { ok: false, site, text: `Нужно прибыть к точке: ${siteName}.` };
  }

  function worldTaskDeliveryUiState(task = {}) {
    const plan = worldTaskDeliveryPlan(task);
    const place = worldTaskDeliveryPlaceStatus(task);
    const demandText = worldTaskDeliveryHint(task);
    const accepted = isWorldTaskAccepted(task);
    const parts = [];
    if (!accepted) parts.push('Сначала возьмите работу.');
    if (!place.ok) parts.push(place.text);
    if (demandText) parts.push(demandText);
    return {
      plan,
      place,
      accepted,
      canDeliver: !!(accepted && place.ok && plan.canDeliver),
      hint: parts.join(' ')
    };
  }

  function removeWorldTaskDeliveryCost(cost = {}) {
    const removed = {};
    for (const [id, qtyRaw] of Object.entries(cost || {})) {
      const qty = Math.max(0, Math.ceil(Number(qtyRaw || 0)));
      if (qty <= 0) continue;
      if (!removeItem(id, qty)) {
        Object.entries(removed).forEach(([refundId, refundQty]) => addItem(refundId, refundQty, { force: true }));
        return false;
      }
      removed[id] = (removed[id] || 0) + qty;
    }
    return true;
  }

  async function deliverWorldTaskSupplies(taskId = '') {
    const id = String(taskId || '').trim();
    const sim = pipboyWorldStateSnapshot() || {};
    const task = (Array.isArray(sim.worldTasks) ? sim.worldTasks : []).find(row => String(row?.id || '') === id);
    if (!task || task.status !== 'active' || task.type !== 'deliver_supplies') {
      addLog('Это задание доставки уже недоступно.', null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    if (!isWorldTaskAccepted(task)) {
      addLog('Сначала возьмите эту работу в Пип-бое.', null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    const plan = worldTaskDeliveryPlan(task);
    const place = worldTaskDeliveryPlaceStatus(task);
    if (!place.ok) {
      addLog(place.text || 'Нужно прибыть к точке доставки.', null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    if (!plan.canDeliver) {
      addLog(worldTaskDeliveryHint(task) || 'Не хватает припасов для доставки.', null, 'quest');
      return;
    }
    const result = await submitWorldTaskServerAction(id, 'deliver');
    if (!result?.ok) {
      addLog(`Доставка не принята: ${result?.error || 'сервер недоступен'}.`, null, 'quest');
      renderPipboyInfoPanels();
      return;
    }
    addLog(`${task.title || 'Доставка'}: припасы переданы.`, null, 'quest');
    if (result?.task?.status === 'completed') claimWorldTaskReward(id);
    else renderPipboyInfoPanels();
  }

  function currentWorldTaskRewardIds() {
    const ids = new Set();
    [
      characterProfile?.serverCharacterId,
      selectedServerCharacterId,
      characterProfile?.characterId,
      characterProfile?.id,
      multiplayer?.socket?.id
    ].forEach(value => {
      const id = String(value || '').trim();
      if (id) ids.add(id);
    });
    return ids;
  }

  function taskRewardEligibilityIds(task = {}) {
    const details = task.details && typeof task.details === 'object' ? task.details : {};
    const ids = new Set();
    [
      details.rewardPlayerIds,
      details.rewardCharacterIds,
      details.eligibleRewardPlayerIds,
      details.eligibleRewardCharacterIds,
      details.joinedPlayers
    ].forEach(list => {
      if (!Array.isArray(list)) return;
      list.forEach(value => {
        const id = String(value || '').trim();
        if (id) ids.add(id);
      });
    });
    return ids;
  }

  function canClaimWorldTaskReward(task = {}) {
    if (!task || task.status !== 'completed' || worldTaskRewardClaims.has(task.id)) return false;
    if (typeof task.rewardEligible === 'boolean') return task.rewardEligible;
    const details = task.details && typeof task.details === 'object' ? task.details : {};
    const selfIds = currentWorldTaskRewardIds();
    const owner = String(details.playerId || '').trim();
    if (owner && selfIds.size && !selfIds.has(owner)) return false;
    const eligible = taskRewardEligibilityIds(task);
    if (eligible.size > 0) {
      if (!selfIds.size) return false;
      return Array.from(selfIds).some(id => eligible.has(id));
    }
    if (Number(details.rewardPlayerCount || 0) > 0) return false;
    if (typeof multiplayer === 'object' && multiplayer?.joined) return false;
    return !owner || !selfIds.size || selfIds.has(owner);
  }

  async function claimWorldTaskReward(taskId = '') {
    const id = String(taskId || '').trim();
    const sim = pipboyWorldStateSnapshot() || {};
    const task = (Array.isArray(sim.worldTasks) ? sim.worldTasks : []).find(row => String(row?.id || '') === id);
    if (!canClaimWorldTaskReward(task)) {
      addLog('Награда за это мировое задание уже недоступна.', null, 'quest');
      return;
    }
    const result = await submitWorldTaskServerAction(id, 'claim');
    if (!result?.ok) {
      addLog(result?.error || 'Сервер не выдал награду.', null, 'quest');
      return;
    }
    const caps = Math.max(0, Math.floor(Number(result.reward?.caps || 0)));
    const xp = Math.max(0, Math.floor(Number(result.reward?.xp || 0)));
    if (xp > 0) createFloatingText(player.x, player.z, '+' + xp + ' XP', '#e4c56b');
    addLog(`${task.title || 'Мировое задание'}: награда получена (+${xp} XP, +${caps} крышек).`, null, 'level');
    renderPipboyInfoPanels();
  }

  function worldTaskPointText(task = {}) {
    const x = Number(task.targetX ?? task.x ?? task.details?.x);
    const y = Number(task.targetY ?? task.y ?? task.details?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
    return `${Math.round(x)}:${Math.round(y)}`;
  }

  function pipboyWorldTaskRouteText(task = {}) {
    const type = String(task.type || '').toLowerCase();
    const issuer = String(task.issuerSiteName || '').trim();
    const target = String(task.targetSiteName || task.siteName || '').trim();
    const party = String(task.targetPartyName || task.joinPartyName || '').trim();
    const point = worldTaskPointText(task);
    const rows = [];
    if (issuer) rows.push(`Где взять: ${issuer}.`);
    if (type === 'deliver_supplies') {
      if (target) rows.push(`Куда сдать ресурсы: ${target}.`);
    } else if (type === 'clear_lair') {
      rows.push(`Цель: зачистить ${party || target || 'логово'}.`);
    } else if (type === 'escort_caravan') {
      rows.push(`Цель: сопроводить ${party || 'караван'}.`);
    } else if (type === 'join_patrol') {
      rows.push(`Цель: присоединиться к ${party || 'патрулю'}.`);
    } else if (target) {
      rows.push(`Место выполнения: ${target}.`);
    } else if (party) {
      rows.push(`Цель: ${party}.`);
    }
    if (point) rows.push(`Координаты: ${point}.`);
    return rows.join(' ');
  }

  function pipboyWorldTaskCard(task = {}) {
    const accepted = isWorldTaskAccepted(task);
    const tracked = worldTaskTrackedId && String(task.id || '') === String(worldTaskTrackedId);
    const label = task.status === 'completed'
      ? 'Выполнено'
      : task.status === 'resolved'
        ? 'Решено миром'
        : task.status === 'expired'
          ? 'Провалено'
          : accepted
            ? 'Взято'
            : 'Работа';
    const sim = pipboyWorldStateSnapshot() || {};
    const worldHour = Number(sim.worldHour || 0);
    const hoursLeft = task.status === 'active' ? Math.max(0, Math.ceil(Number(task.expiresHour || worldHour) - worldHour)) : 0;
    const text = [
      task.text || '',
      task.status === 'active' && hoursLeft > 0 ? `Осталось около ${hoursLeft} ч.` : ''
    ].filter(Boolean).join(' ');
    const reward = pipboyWorldTaskReward(task);
    const joinHint = task.actionMode === 'join_party' && task.joinPartyName
      ? `<small class="pipboy-world-task-supplies">После принятия: присоединиться к группе ${escapeHtml(task.joinPartyName)}.</small>`
      : String(task.type || '') === 'clear_lair'
        ? '<small class="pipboy-world-task-supplies">Зачистку можно выполнить одному или собрать группу игроков.</small>'
        : '';
    const claim = canClaimWorldTaskReward(task)
      ? `<button type="button" class="pipboy-quest-claim" data-world-task-claim="${escapeHtml(task.id)}">Забрать награду</button>`
      : '';
    const acceptState = task.status === 'active' && !accepted ? worldTaskAcceptancePlaceStatus(task) : null;
    const accessState = acceptState ? worldTaskAccessStatus(task) : null;
    const canAccept = !!(acceptState?.ok && accessState?.ok);
    const acceptLabel = !acceptState?.ok
      ? 'Нужна доска'
      : !accessState?.ok
        ? 'Недоступно'
        : 'Взять работу';
    const acceptHint = [acceptState?.text || '', accessState?.text || ''].filter(Boolean).join(' ');
    const accept = acceptState
      ? `<button type="button" class="pipboy-quest-claim pipboy-quest-accept" data-world-task-accept="${escapeHtml(task.id)}"${canAccept ? '' : ' disabled'}>${escapeHtml(acceptLabel)}</button><small class="pipboy-world-task-supplies">${escapeHtml(acceptHint)}</small>`
      : '';
    const track = task.status === 'active' && accepted
      ? `<button type="button" class="pipboy-quest-claim pipboy-quest-track" data-world-task-track="${escapeHtml(task.id)}">${tracked ? 'Снять метку' : 'Отслеживать'}</button>`
      : '';
    const cancel = task.status === 'active' && accepted
      ? `<button type="button" class="pipboy-quest-claim pipboy-quest-cancel" data-world-task-cancel="${escapeHtml(task.id)}">Отменить</button>`
      : '';
    const deliveryState = task.status === 'active' && task.type === 'deliver_supplies' ? worldTaskDeliveryUiState(task) : null;
    const deliveryLabel = deliveryState?.canDeliver
      ? 'Сдать припасы'
      : !deliveryState?.accepted
        ? 'Работа не взята'
        : deliveryState?.place?.ok
        ? 'Не хватает припасов'
        : 'Нужно прибыть';
    const delivery = deliveryState
      ? `<button type="button" class="pipboy-quest-claim pipboy-quest-deliver" data-world-task-deliver="${escapeHtml(task.id)}"${deliveryState.canDeliver ? '' : ' disabled'}>${deliveryLabel}</button><small class="pipboy-world-task-supplies">${escapeHtml(deliveryState.hint)}</small>`
      : '';
    const routeText = pipboyWorldTaskRouteText(task);
    const caravanDeparture = worldTaskCaravanDepartureHtml(task);
    return `<div class="pipboy-quest-card world-task ${escapeHtml(task.status || 'active')}${accepted ? ' accepted' : ''}${tracked ? ' tracked' : ''}"><span>${escapeHtml(tracked ? 'Метка' : label)}</span><b>${escapeHtml(task.title || 'Работа пустоши')}</b>${text ? `<small>${escapeHtml(text)}</small>` : ''}${routeText ? `<small class="pipboy-world-task-route">${escapeHtml(routeText)}</small>` : ''}${caravanDeparture}${reward ? `<em>${escapeHtml(reward)}</em>` : ''}${joinHint}${accept}${track}${cancel}${delivery}${claim}</div>`;
  }

  function pipboyWorldTaskCards(status = 'active') {
    const sim = pipboyWorldStateSnapshot() || {};
    return (Array.isArray(sim.worldTasks) ? sim.worldTasks : [])
      .filter(task => task && (status === 'active' ? task.status === 'active' : task.status !== 'active'))
      .slice(0, status === 'active' ? 8 : 6)
      .map(pipboyWorldTaskCard);
  }

  let activeWorldTaskBoard = null;

  const PIPBOY_FACTION_ORDER = ['old_klim', 'scrap_union', 'relay_order', 'caravans', 'neutral', 'raiders', 'mutants', 'wild'];
  const WORLD_JOINABLE_FACTIONS = new Set(['old_klim', 'scrap_union', 'relay_order', 'caravans']);

  function worldFactionKey(id = '') {
    return String(id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  }

  function worldFactionLabel(id = '') {
    const key = worldFactionKey(id);
    if (typeof globalMapFactionLabel === 'function') return globalMapFactionLabel(key);
    if (key === 'old_klim') return 'Старый Клим';
    if (key === 'scrap_union') return 'Свалочный союз';
    if (key === 'relay_order') return 'Ретранслятор';
    if (key === 'caravans') return 'Караванщики';
    if (key === 'raiders') return 'Рейдеры';
    if (key === 'mutants') return 'Супермутанты';
    if (key === 'wild') return 'Дикие твари';
    return key || 'Без фракции';
  }

  function worldFactionColor(id = '') {
    const key = worldFactionKey(id);
    if (typeof globalMapFactionColor === 'function') {
      const color = globalMapFactionColor(key);
      if (color) return color;
    }
    if (key === 'old_klim') return '#93d982';
    if (key === 'scrap_union') return '#d7a95e';
    if (key === 'relay_order') return '#7fcfff';
    if (key === 'caravans') return '#efd078';
    if (key === 'raiders') return '#ff7b53';
    if (key === 'mutants') return '#c681ff';
    if (key === 'wild') return '#b88cff';
    if (key === 'neutral') return '#9fd7ff';
    return '#9fdb7a';
  }

  function playerWorldFactionId() {
    const id = worldFactionKey(characterProfile?.factionId || characterProfile?.worldFactionId || '');
    return WORLD_JOINABLE_FACTIONS.has(id) ? id : '';
  }

  function pipboyFactionObjects() {
    const sim = pipboyWorldStateSnapshot() || {};
    const raw = sim.factions && typeof sim.factions === 'object' ? sim.factions : {};
    const byId = new Map();
    Object.entries(raw).forEach(([id, faction]) => {
      const key = worldFactionKey(faction?.id || id);
      if (!key) return;
      byId.set(key, {
        ...(faction && typeof faction === 'object' ? faction : {}),
        id: key,
        name: String(faction?.name || worldFactionLabel(key)),
        color: String(faction?.color || worldFactionColor(key)),
        relations: faction?.relations && typeof faction.relations === 'object' ? faction.relations : {}
      });
    });
    PIPBOY_FACTION_ORDER.forEach(id => {
      if (!byId.has(id)) {
        byId.set(id, { id, name: worldFactionLabel(id), color: worldFactionColor(id), relations: {} });
      }
    });
    return Array.from(byId.values()).sort((a, b) => {
      const ai = PIPBOY_FACTION_ORDER.indexOf(worldFactionKey(a.id));
      const bi = PIPBOY_FACTION_ORDER.indexOf(worldFactionKey(b.id));
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || worldFactionLabel(a.id).localeCompare(worldFactionLabel(b.id));
    });
  }

  function pipboyFactionRelationValue(faction = {}, factionsById = new Map()) {
    const factionId = worldFactionKey(faction.id);
    const playerFaction = playerWorldFactionId() || 'neutral';
    if (factionId === playerFaction) return 100;
    const own = factionsById.get(factionId) || faction || {};
    const playerFactionRow = factionsById.get(playerFaction) || {};
    const direct = Number(own.relations?.[playerFaction]);
    const reverse = Number(playerFactionRow.relations?.[factionId]);
    const values = [direct, reverse].filter(Number.isFinite);
    if (values.length) return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    if (['raiders', 'mutants', 'wild'].includes(factionId)) return -70;
    if (factionId === 'neutral') return playerFaction === 'neutral' ? 100 : 0;
    return playerFaction === 'neutral' ? 0 : 10;
  }

  function pipboyFactionRelationMeta(value = 0, factionId = '') {
    const key = worldFactionKey(factionId);
    const playerFaction = playerWorldFactionId() || 'neutral';
    if (key === playerFaction) return { key: 'self', label: playerFaction === 'neutral' ? 'Вы нейтральны' : 'Ваша фракция' };
    if (value >= 70) return { key: 'ally', label: 'Союзники' };
    if (value >= 25) return { key: 'friendly', label: 'Дружественно' };
    if (value > -25) return { key: 'neutral', label: 'Нейтрально' };
    if (value > -60) return { key: 'tense', label: 'Напряженно' };
    return { key: 'hostile', label: 'Враждебны' };
  }

  function pipboyFactionSiteStats(factionId = '') {
    const sim = pipboyWorldStateSnapshot() || {};
    const sites = Array.isArray(sim.sites) ? sim.sites : [];
    const parties = Array.isArray(sim.parties) ? sim.parties : [];
    const key = worldFactionKey(factionId);
    const ownedSites = sites.filter(site => worldFactionKey(site?.owner || '') === key);
    const settlements = ownedSites.filter(site => String(site?.type || '').toLowerCase() === 'settlement').length;
    const contested = ownedSites.filter(site => {
      const state = String(site?.controlState || '').toLowerCase();
      return ['critical', 'contested', 'threatened'].includes(state) || Math.abs(Number(site?.controlPressure || 0)) > 8 || !!site?.activeConflict;
    }).length;
    const activeParties = parties.filter(party => worldFactionKey(party?.faction || '') === key && !party?.destroyed && String(party?.state || '') !== 'destroyed').length;
    return { owned: ownedSites.length, settlements, contested, parties: activeParties };
  }

  function renderPipboyFactionsPanel() {
    const grid = document.getElementById('pipboy-factions-grid');
    if (!grid) return;
    if (pipboyActiveTab === 'factions' && typeof requestWastelandSimState === 'function') requestWastelandSimState(false);
    const factions = pipboyFactionObjects();
    const byId = new Map(factions.map(faction => [worldFactionKey(faction.id), faction]));
    const playerFaction = playerWorldFactionId();
    const currentLabel = playerFaction ? worldFactionLabel(playerFaction) : 'Независимый странник';
    const rows = factions.map(faction => {
      const id = worldFactionKey(faction.id);
      const value = pipboyFactionRelationValue(faction, byId);
      const meta = pipboyFactionRelationMeta(value, id);
      const stats = pipboyFactionSiteStats(id);
      const color = worldFactionColor(id);
      const reputation = Math.max(0, Math.floor(Number(characterProfile?.worldFactionReputation?.[id] || 0)));
      const relationText = `${meta.key === 'self' ? meta.label : `${meta.label} · ${value > 0 ? '+' : ''}${value}`}`
        + (canJoinWorldFaction(id) ? ` · репутация ${reputation}` : '');
      const role = canJoinWorldFaction(id) ? 'фракция' : id === 'neutral' ? 'нейтралы' : 'угроза';
      return `<article class="pipboy-faction-card ${escapeHtml(meta.key)}" style="--faction-color:${escapeHtml(color)}">
        <div class="pipboy-faction-mark" aria-hidden="true"></div>
        <div class="pipboy-faction-main">
          <span>${escapeHtml(role)}</span>
          <b>${escapeHtml(faction.name || worldFactionLabel(id))}</b>
          <small>${escapeHtml(relationText)}</small>
        </div>
        <div class="pipboy-faction-stats">
          <div><span>Точки</span><b>${stats.owned}</b></div>
          <div><span>Отряды</span><b>${stats.parties}</b></div>
          <div><span>Спорно</span><b>${stats.contested}</b></div>
        </div>
      </article>`;
    }).join('');
    const hostileCount = factions.filter(faction => pipboyFactionRelationMeta(pipboyFactionRelationValue(faction, byId), faction.id).key === 'hostile').length;
    const alliedCount = factions.filter(faction => ['self', 'ally', 'friendly'].includes(pipboyFactionRelationMeta(pipboyFactionRelationValue(faction, byId), faction.id).key)).length;
    const html = `
      <div class="pipboy-faction-dashboard">
        <div><span>Текущая сторона</span><b>${escapeHtml(currentLabel)}</b></div>
        <div><span>Союзные</span><b>${alliedCount}</b></div>
        <div><span>Враждебные</span><b>${hostileCount}</b></div>
        <div><span>Всего фракций</span><b>${factions.length}</b></div>
      </div>
      <div class="pipboy-faction-list">${rows}</div>`;
    if (grid.dataset.renderSignature !== html) {
      grid.innerHTML = html;
      grid.dataset.renderSignature = html;
    }
  }

  function canJoinWorldFaction(id = '') {
    return WORLD_JOINABLE_FACTIONS.has(worldFactionKey(id));
  }

  function worldTaskFactionId(task = {}) {
    const explicit = worldFactionKey(task.joinPartyFaction || task.faction || task.owner || '');
    if (canJoinWorldFaction(explicit)) return explicit;
    const site = worldTaskBoardSite(task) || worldTaskSite(task);
    return canJoinWorldFaction(site?.owner) ? worldFactionKey(site.owner) : '';
  }

  function worldTaskRequiresFaction(task = {}) {
    const type = String(task?.type || '').toLowerCase();
    return ['escort_caravan', 'join_patrol', 'defend_resource', 'retake_site'].includes(type);
  }

  function worldTaskAccessStatus(task = {}) {
    const type = String(task?.type || '').toLowerCase();
    if (['escort_caravan', 'join_patrol'].includes(type) && (!task.joinPartyId || task.actionMode !== 'join_party')) {
      return { ok: false, text: 'Отряд еще не готов. Дождитесь выхода каравана или патруля.' };
    }
    const factionId = worldTaskFactionId(task);
    if (worldTaskRequiresFaction(task) && factionId && playerWorldFactionId() !== factionId) {
      return { ok: false, text: `Нужно вступить во фракцию: ${worldFactionLabel(factionId)}.` };
    }
    return { ok: true, text: factionId && playerWorldFactionId() === factionId ? `Фракционная работа: ${worldFactionLabel(factionId)}.` : '' };
  }

  function joinWorldFaction(id = '') {
    const factionId = worldFactionKey(id);
    if (!canJoinWorldFaction(factionId)) {
      addLog('К этой фракции пока нельзя вступить.', null, 'quest');
      return false;
    }
    if (!characterProfile) {
      addLog('Сначала войдите персонажем, чтобы вступить во фракцию.', null, 'quest');
      return false;
    }
    if (!multiplayer?.socket?.connected || !multiplayer.joined) {
      addLog('Нет соединения с сервером: вступление во фракцию не выполнено.', null, 'quest');
      return false;
    }
    multiplayer.socket.emit('worldFactionJoin', { factionId }, ack => {
      if (!ack || ack.ok === false) {
        if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        addLog(ack?.error || 'Сервер отклонил вступление во фракцию.', null, 'quest');
        if (typeof setReadout === 'function') setReadout(ack?.error || 'Вступление не выполнено.');
        return;
      }
      if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
      const previous = worldFactionKey(ack.previousFactionId || '');
      const joinedFaction = worldFactionKey(ack.factionId || factionId);
      const label = worldFactionLabel(joinedFaction);
      characterProfile.factionName = label;
      characterProfile.factionJoinedAt = characterProfile.factionJoinedAt || Date.now();
      if (previous && previous !== joinedFaction) characterProfile.previousFactionId = previous;
      addLog(previous && previous !== joinedFaction ? `Вы перешли на сторону фракции: ${label}.` : `Вы вступили во фракцию: ${label}.`, null, 'quest');
      renderPipboyInfoPanels();
      if (activeWorldTaskBoard) renderWorldTaskBoardWindow();
      if (typeof renderGlobalMapPanel === 'function') renderGlobalMapPanel();
    });
    return true;
  }

  function worldFactionPanelHtml(site = null, className = 'world-task-board-faction-panel') {
    const factionId = worldFactionKey(site?.owner || site?.faction || '');
    if (!canJoinWorldFaction(factionId)) return '';
    const current = playerWorldFactionId();
    const same = current === factionId;
    const factionName = site?.ownerLabel || worldFactionLabel(factionId);
    const siteName = site?.name || 'эта точка';
    const color = worldFactionColor(factionId);
    const action = same
      ? '<span class="world-faction-badge joined">Вы состоите во фракции</span>'
      : `<button type="button" class="world-faction-join" data-world-faction-join="${escapeHtml(factionId)}">${current ? 'Сменить сторону' : 'Вступить'}</button>`;
    const note = same
      ? 'Задания этой стороны считаются фракционными: караваны и патрули берут вас прямо в группу.'
      : current
        ? `Сейчас вы связаны с фракцией ${worldFactionLabel(current)}. Смена стороны будет сохранена в профиле персонажа.`
        : 'Вступление сохранится в профиле персонажа и откроет основу для фракционных правил, патрулей и караванов.';
    return `<div class="${escapeHtml(className)}" style="--faction-color:${escapeHtml(color)}">
      <div>
        <span>Фракция точки</span>
        <b>${escapeHtml(factionName)}</b>
        <small>${escapeHtml(siteName)} контролируется этой стороной.</small>
      </div>
      <p>${escapeHtml(note)}</p>
      ${action}
    </div>`;
  }

  function bindWorldFactionJoinButtons(root) {
    if (!root) return;
    root.querySelectorAll('[data-world-faction-join]').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', e => {
        e.preventDefault();
        joinWorldFaction(btn.dataset.worldFactionJoin || '');
      });
    });
  }

  function worldTaskBoardSiteFromBoard(board = {}) {
    const sim = pipboyWorldStateSnapshot() || {};
    const sites = Array.isArray(sim.sites) ? sim.sites : [];
    const boardSiteId = String(board.siteId || board.boardSiteId || '').trim();
    let site = boardSiteId ? sites.find(row => String(row?.id || '') === boardSiteId) : null;
    if (!site) {
      const locId = String(currentLocation?.id || '').trim();
      site = sites.find(row => String(row?.locationId || '') === locId || String(row?.id || '') === locId) || null;
    }
    return {
      site,
      siteId: String(site?.id || boardSiteId || currentLocation?.id || '').trim(),
      name: String(site?.name || board.name || 'Доска заданий').trim()
    };
  }

  function worldTaskBoardRowsForSite(siteId = '') {
    const id = String(siteId || '').trim();
    if (!id) return [];
    const sim = pipboyWorldStateSnapshot() || {};
    return (Array.isArray(sim.worldTasks) ? sim.worldTasks : [])
      .filter(row => row && row.status === 'active' && String(row.issuerSiteId || row.boardSiteId || row.siteId || '') === id)
      .slice(0, 12);
  }

  function ensureWorldTaskBoardWindow() {
    let win = document.getElementById('world-task-board-window');
    if (win) return win;
    win = document.createElement('section');
    win.id = 'world-task-board-window';
    win.className = 'world-task-board-window ui-panel';
    win.style.display = 'none';
    win.innerHTML = `
      <button id="world-task-board-close" class="world-task-board-close" type="button" aria-label="Закрыть">x</button>
      <div class="world-task-board-head">
        <span>Доска заданий</span>
        <h2 id="world-task-board-title">Работа пустоши</h2>
        <small id="world-task-board-subtitle">Сводка заявок</small>
      </div>
      <div id="world-task-board-list" class="world-task-board-list"></div>`;
    document.body.appendChild(win);
    win.querySelector('#world-task-board-close')?.addEventListener('click', e => {
      e.preventDefault();
      closeWorldTaskBoardWindow();
    });
    return win;
  }

  function closeWorldTaskBoardWindow() {
    const win = document.getElementById('world-task-board-window');
    if (win) win.style.display = 'none';
    document.body.classList.remove('world-task-board-window-open');
    activeWorldTaskBoard = null;
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function renderWorldTaskBoardWindow() {
    const win = ensureWorldTaskBoardWindow();
    const list = win.querySelector('#world-task-board-list');
    const title = win.querySelector('#world-task-board-title');
    const subtitle = win.querySelector('#world-task-board-subtitle');
    const source = worldTaskBoardSiteFromBoard(activeWorldTaskBoard || {});
    const rows = worldTaskBoardRowsForSite(source.siteId);
    const factionPanel = worldFactionPanelHtml(source.site);
    if (title) title.textContent = source.name || 'Работа пустоши';
    if (subtitle) subtitle.textContent = source.site ? 'Заявки этого места' : 'Доска не привязана к поселению';
    if (!list) return;
    if (!source.siteId) {
      list.innerHTML = `${factionPanel}<div class="world-task-board-empty">Эта доска пока не подключена к заявкам пустоши.</div>`;
      bindWorldFactionJoinButtons(list);
      return;
    }
    if (!rows.length) {
      list.innerHTML = `${factionPanel}<div class="world-task-board-empty">Новых заявок нет. Загляните позже.</div>`;
      bindWorldFactionJoinButtons(list);
      return;
    }
    list.innerHTML = factionPanel + rows.map(task => {
      const rewardText = pipboyWorldTaskReward(task);
      const reward = rewardText.includes(':') ? rewardText.replace(/^[^:]+:\s*/, '') : rewardText;
      const accepted = isWorldTaskAccepted(task);
      const tracked = worldTaskTrackedId && String(task.id || '') === String(worldTaskTrackedId);
      const access = worldTaskAccessStatus(task);
      const routeText = pipboyWorldTaskRouteText(task);
      const hoursLeft = Math.max(0, Math.ceil(Number(task.expiresHour || 0) - Number((pipboyWorldStateSnapshot() || {}).worldHour || 0)));
      const caravanDeparture = worldTaskCaravanDepartureHtml(task, 'world-task-board-countdown');
      return `<article class="world-task-board-card${accepted ? ' accepted' : ''}${tracked ? ' tracked' : ''}">
        <div class="world-task-board-card-main">
          <span>${escapeHtml(accepted ? (tracked ? 'Отслеживается' : 'Взято') : 'Доступно')}</span>
          <b>${escapeHtml(task.title || 'Работа пустоши')}</b>
          <small>${escapeHtml(task.text || '')}</small>
          <em>${routeText ? `${escapeHtml(routeText)} ` : ''}${reward ? `Награда: ${escapeHtml(reward)}. ` : ''}${hoursLeft > 0 ? `Осталось около ${hoursLeft} ч.` : ''}</em>
          ${caravanDeparture}
          ${!accepted && !access.ok ? `<small>${escapeHtml(access.text)}</small>` : ''}
        </div>
        <div class="world-task-board-actions">
          ${accepted
            ? `<button type="button" data-board-task-track="${escapeHtml(task.id)}">${tracked ? 'Снять метку' : 'Отслеживать'}</button><button type="button" data-board-task-cancel="${escapeHtml(task.id)}">Отменить</button>`
            : `<button type="button" data-board-task-accept="${escapeHtml(task.id)}"${access.ok ? '' : ' disabled'}>${access.ok ? 'Взять' : 'Недоступно'}</button>`}
        </div>
      </article>`;
    }).join('');
    bindWorldFactionJoinButtons(list);
    list.querySelectorAll('[data-board-task-accept]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        acceptWorldTask(btn.dataset.boardTaskAccept || '');
        renderWorldTaskBoardWindow();
      });
    });
    list.querySelectorAll('[data-board-task-track]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        trackWorldTask(btn.dataset.boardTaskTrack || '');
        renderWorldTaskBoardWindow();
      });
    });
    list.querySelectorAll('[data-board-task-cancel]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        cancelWorldTask(btn.dataset.boardTaskCancel || '');
        renderWorldTaskBoardWindow();
      });
    });
  }

  function openWorldTaskBoardWindow(board = {}) {
    if (typeof requestWastelandSimState === 'function') requestWastelandSimState(false);
    if (typeof closeAllWindows === 'function') closeAllWindows(true, { preserveGlobalMap: true });
    activeWorldTaskBoard = board || {};
    const win = ensureWorldTaskBoardWindow();
    win.style.display = 'block';
    document.body.classList.add('world-task-board-window-open');
    renderWorldTaskBoardWindow();
    setTimeout(() => {
      if (document.body.classList.contains('world-task-board-window-open')) renderWorldTaskBoardWindow();
    }, 320);
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
    return true;
  }

  function currentNpcQuestGroups() {
    const active = [];
    const completed = [];
    let state = null;
    try {
      if (typeof normalizeNpcQuestState === 'function') normalizeNpcQuestState();
      if (typeof npcQuestState !== 'undefined') state = npcQuestState;
    } catch (_) {
      state = null;
    }
    if (state) {
      if (state.klimSupplies === 'active') {
        active.push({
          title: 'Припасы для поселения',
          text: `Соберите и сдайте Старому Климу в Караванной стоянке Старого Клима: руда ${inventory.get('ore') || 0}/3, древесина ${inventory.get('wood') || 0}/3, вода ${inventory.get('water') || 0}/1.`,
          reward: state.klimSuppliesNegotiated ? 'Награда повышена проверкой речи.' : 'Награда: крышки и опыт.'
        });
      } else if (state.klimSupplies === 'done') {
        completed.push({
          title: 'Припасы для поселения',
          text: 'Старый Клим получил ресурсы для поселения.',
          reward: 'Получена награда за доставку припасов.'
        });
      }
      if (state.klimTerminal === 'active') {
        active.push({
          title: 'Данные с ржавого терминала',
          text: state.klimTerminalHacked ? 'Данные получены. Вернитесь к Старому Климу в Караванную стоянку Старого Клима за наградой.' : 'Взломайте терминал редкого тайника в Пепельном лесу, затем вернитесь к Старому Климу.',
          reward: state.klimTerminalNegotiated ? 'Награда повышена проверкой науки.' : 'Награда: крышки и опыт.'
        });
      } else if (state.klimTerminal === 'done') {
        completed.push({
          title: 'Данные с ржавого терминала',
          text: 'Данные тайника переданы Старому Климу.',
          reward: 'Получена награда за терминал.'
        });
      }
      if (state.scrapParts === 'active') {
        active.push({
          title: 'Детали для свалочного пресса',
          text: `Соберите и сдайте Грачу-Жестянщику на Свалочном посту: руда ${inventory.get('ore') || 0}/6, древесина ${inventory.get('wood') || 0}/2, ремкомплект ${inventory.get('repairKit') || 0}/1.`,
          reward: state.scrapPartsNegotiated ? 'Награда повышена проверкой речи.' : 'Награда: крышки и опыт.'
        });
      } else if (state.scrapParts === 'done') {
        completed.push({
          title: 'Детали для свалочного пресса',
          text: 'Грач-Жестянщик получил детали на Свалочном посту, пресс снова работает.',
          reward: 'Получена награда за восстановление пресса.'
        });
      }
      if (state.relayCalibration === 'active') {
        active.push({
          title: 'Калибровка ретранслятора',
          text: `Соберите и сдайте Раде Искре на Станции Ретранслятор: энергозаряды ${inventory.get('energyCell') || 0}/20, ремкомплект ${inventory.get('repairKit') || 0}/1.`,
          reward: state.relayCalibrationNegotiated ? 'Награда повышена проверкой науки.' : 'Награда: крышки и опыт.'
        });
      } else if (state.relayCalibration === 'done') {
        completed.push({
          title: 'Калибровка ретранслятора',
          text: 'Рада Искра получила расходники на Станции Ретранслятор, сигнал стабилизирован.',
          reward: 'Получена награда за калибровку ретранслятора.'
        });
      }
    }
    const worldActive = pipboyWorldTaskCards('active');
    const worldDone = pipboyWorldTaskCards('done');
    active.push(...worldActive.map(html => ({ rawHtml: html })));
    completed.push(...worldDone.map(html => ({ rawHtml: html })));
    return { active, completed };
  }

  function renderPipboyInfoPanels() {
    const name = characterProfile?.name || player.name || 'Странник';
    const locationName = currentLocation?.name || 'Пустошь';
    const weaponName = ITEMS[equipment.weapon]?.name || 'без оружия';
    const carry = `${formatWeight(inventoryWeight())}/${formatWeight(carryCapacity())}`;
    const questInfo = typeof npcQuestPanelText === 'function'
      ? npcQuestPanelText()
      : { title: 'Поручения', text: 'Нет активных записей.' };

    pipboyLocalText('pipboy-location-line', locationName);
    pipboyLocalText('pipboy-top-weight', carry);
    pipboyLocalText('pipboy-top-hp', `${Math.ceil(player.hp)}/${player.maxHp}`);
    pipboyLocalText('pipboy-top-ap', `${Math.floor(Math.max(0, Number(player.ap || 0)))}/${Math.max(1, Math.round(Number(player.maxAp || 0)))}`);
    pipboyLocalText('pipboy-top-armor', armorValue());
    pipboyLocalText('pipboy-top-caps', inventory.get('silver') || 0);
    pipboyLocalText('pipboy-character-name', name);
    pipboyLocalText('pipboy-character-meta', `Уровень ${player.level} · ${weaponName}`);

    renderPipboyFactionsPanel();

    const questGrid = document.getElementById('pipboy-quest-grid');
    if (questGrid) {
      if (pipboyActiveTab === 'quests' && typeof requestWastelandSimState === 'function') requestWastelandSimState(false);
      const groups = currentNpcQuestGroups();
      const activeRows = groups.active.length
        ? groups.active.map(q => q.rawHtml || pipboyQuestCard('Активно', q.title, q.text, q.reward)).join('')
        : pipboyQuestEmpty(questInfo?.text || 'Нет активных заданий.');
      const completedRows = groups.completed.length
        ? groups.completed.map(q => q.rawHtml || pipboyQuestCard('Выполнено', q.title, q.text, q.reward)).join('')
        : pipboyQuestEmpty('Выполненных заданий пока нет.');
      const rows = `
        <div class="pipboy-quest-section">
          <div class="pipboy-quest-section-title">Активные</div>
          ${activeRows}
        </div>
        <div class="pipboy-quest-section">
          <div class="pipboy-quest-section-title">Выполненные</div>
          ${completedRows}
        </div>`;
      if (questGrid.dataset.renderSignature !== rows) {
        questGrid.innerHTML = rows;
        questGrid.dataset.renderSignature = rows;
      }
      questGrid.querySelectorAll('[data-world-task-claim]').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', e => {
          e.preventDefault();
          claimWorldTaskReward(btn.dataset.worldTaskClaim || '');
        });
      });
      questGrid.querySelectorAll('[data-world-task-accept]').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', e => {
          e.preventDefault();
          acceptWorldTask(btn.dataset.worldTaskAccept || '');
        });
      });
      questGrid.querySelectorAll('[data-world-task-track]').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', e => {
          e.preventDefault();
          trackWorldTask(btn.dataset.worldTaskTrack || '');
        });
      });
      questGrid.querySelectorAll('[data-world-task-cancel]').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', e => {
          e.preventDefault();
          cancelWorldTask(btn.dataset.worldTaskCancel || '');
        });
      });
      questGrid.querySelectorAll('[data-world-task-deliver]').forEach(btn => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', e => {
          e.preventDefault();
          if (btn.disabled) return;
          deliverWorldTaskSupplies(btn.dataset.worldTaskDeliver || '');
        });
      });
    }

    const radioGrid = document.getElementById('pipboy-radio-grid');
    if (radioGrid && radioGrid.dataset.rendered !== '1') {
      radioGrid.innerHTML = [
        ['Поселенческий маяк', 'Слабый сигнал караванов и местных объявлений.'],
        ['Пепельная частота', 'Фоновый шум, редкие пакеты данных из старых ретрансляторов.'],
        ['Канал безопасности', 'Автоматические предупреждения о рейдерах, ловушках и тайниках.'],
        ['Тишина', 'Отключить приёмник и оставить только системный журнал.']
      ].map(([title, text], index) => `<button type="button" class="pipboy-radio-row${index === 0 ? ' active' : ''}"><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></button>`).join('');
      radioGrid.dataset.rendered = '1';
    }

    renderPipboyFriendsPanel();
    renderPipboyClanPanel();
    renderPipboyWorldPanel();
