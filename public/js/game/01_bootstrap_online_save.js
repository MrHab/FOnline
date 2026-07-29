// Realm of Ashes v7.76.6 client bootstrap
(() => {
  'use strict';

  if (!window.THREE) {
    const note = document.getElementById('character-online-note');
    if (note) note.textContent = 'Не загрузился Three.js с локального сервера. Выполните: npm install, затем node server.js';
    const err = document.getElementById('char-error');
    if (err) {
      err.textContent = 'Игра не запустится, потому что сервер не отдал локальную библиотеку Three.js. В папке проекта выполните: npm install, затем снова запустите node server.js';
      err.classList.add('visible');
    }
    return;
  }

  // ===== PLATFORM SERVICES / SERVER CHARACTER SAVE =====
  const LEADERBOARD_NAME = 'wasteland_xp';
  let ysdk = null;
  let yandexPlayer = null;
  let yandexPlayerName = '';
  let gameStarted = false;
  let characterProfile = null;
  let saveDirty = false;
  let saveTimer = 0;
  let clientContextTransitionInFlight = false;
  let gameplayMarked = false;

  // v7.74.92: gameplay visibility state must exist before world/roof creation.
  // The roof can ask isPointVisibleForGameplay() while the ordered client
  // parts are still executing, before the update/fog module reaches its own
  // initialization lines. Keep this shared state as var to avoid TDZ crashes
  // while still using the same object for the whole game.
  var rtsFog = {
    visibleTiles: new Set(),
    exploredTiles: new Set(),
    radius: 0
  };
  var rtsFogVisibilityVersion = 0;

  const SERVER_TOKEN_KEY = 'realm_of_ashes_server_token_v1';
  const SERVER_LOGIN_KEY = 'realm_of_ashes_server_login_v1';
  const SERVER_DEVICE_KEY = 'realm_of_ashes_device_id_v1';
  const SERVER_CLIENT_INSTANCE_KEY = 'realm_of_ashes_client_instance_v1';
  try { localStorage.removeItem('realm_of_ashes_save_v1'); } catch (_) {}
  const PAGE_CLIENT_INSTANCE_ID = (() => {
    const rnd = (window.crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `tab_${rnd}`.slice(0, 64);
  })();

  function getClientInstanceId() {
    // v7.74.67: sessionStorage can be copied by browser tab duplication.
    // A copied id makes two tabs look like one client to the server and lets the
    // second tab save the same character. Use a fresh per-page instance instead.
    return PAGE_CLIENT_INSTANCE_ID;
  }

  function getDeviceId() {
    let id = localStorage.getItem(SERVER_DEVICE_KEY) || '';
    if (!/^[a-zA-Z0-9_-]{16,96}$/.test(id)) {
      const rnd = (window.crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(36).slice(2) + Date.now().toString(36);
      id = `d_${rnd}`.slice(0, 64);
      localStorage.setItem(SERVER_DEVICE_KEY, id);
    }
    return id;
  }


  function detectDeviceInfo() {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const small = Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= 820;
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Opera Mini|IEMobile/i.test(ua);
    const tabletUa = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);
    const mobile = mobileUa || tabletUa || (touch && coarse && small);
    return {
      type: mobile ? 'mobile' : 'desktop',
      control: mobile ? 'touch' : 'keyboard_mouse',
      label: mobile ? 'Мобильное' : 'ПК',
      controlLabel: mobile ? 'сенсорное' : 'клавиатура + мышь',
      touch,
      coarse,
      platform: platform.slice(0, 40),
      userAgent: ua.slice(0, 120)
    };
  }

  const deviceInfo = detectDeviceInfo();
  document.body.classList.add(deviceInfo.type === 'mobile' ? 'device-mobile' : 'device-desktop');

  function getDeviceType() { return deviceInfo.type; }
  function getDeviceControlType() { return deviceInfo.control; }

  function setDeviceStatus(extra = '') {
    const el = document.getElementById('device-status');
    if (!el) return;
    const suffix = extra ? ` · ${extra}` : '';
    el.innerHTML = `Устройство: <b>${deviceInfo.label}</b> · управление: ${deviceInfo.controlLabel}${suffix}`;
  }

  const PRODUCTION_SERVER_API_BASE = 'https://rangir.ru';
  function defaultServerApiBase() {
    const host = String(location.hostname || '').toLowerCase();
    if (/(^|\.)github\.io$/.test(host)) return PRODUCTION_SERVER_API_BASE;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return 'http://localhost:3000';
    return '';
  }

  let SERVER_API_BASE = defaultServerApiBase();
  const serverSession = {
    token: localStorage.getItem(SERVER_TOKEN_KEY) || '',
    login: localStorage.getItem(SERVER_LOGIN_KEY) || ''
  };
  let serverSaveAvailable = !!serverSession.token;

  function setOnlineStatus(text) {
    const el = document.getElementById('online-status');
    if (el) el.textContent = text;
    const note = document.getElementById('character-online-note');
    if (note) note.textContent = text;
  }

  setDeviceStatus();

  function loadScriptSafe(src) {
    return new Promise(resolve => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve(true);
      const script = document.createElement('script');
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 1800);
      script.async = true;
      script.src = src;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    });
  }

  async function initYandexGames() {
    try {
      setOnlineStatus('Профиль: подключение...');
      const host = location.hostname || '';
      const isLanHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$)/.test(host);
      const isLocal = !host || isLanHost;
      const isYandexRuntime = host.includes('yandex') || host.includes('ya.') || location.pathname.includes('/games/');
      const isStandaloneProduction = host === 'rangir.ru' || host === 'www.rangir.ru' || /(^|\.)github\.io$/i.test(host);
      // На локальном/LAN сервере SDK Яндекса не нужен. Иначе браузер пытается загрузить /sdk.js,
      // получает 404/text/html и пишет ошибку MIME. Для нашей серверной авторизации сразу работаем локально.
      if ((isLocal || isStandaloneProduction) && !isYandexRuntime) throw new Error('Standalone launch: use game server profile');
      const sources = isYandexRuntime
        ? ['/sdk.js', 'https://sdk.games.s3.yandex.net/sdk.js']
        : ['https://sdk.games.s3.yandex.net/sdk.js'];
      for (const src of sources) {
        if (window.YaGames) break;
        await loadScriptSafe(src);
      }
      if (!window.YaGames) throw new Error('Yandex SDK unavailable');
      ysdk = await window.YaGames.init();
      try { ysdk.features?.LoadingAPI?.ready(); } catch (_) {}
      try {
        yandexPlayer = await ysdk.getPlayer();
        yandexPlayerName = yandexPlayer.isAuthorized && yandexPlayer.isAuthorized() ? (yandexPlayer.getName() || '') : '';
        setOnlineStatus(yandexPlayerName ? `Платформа: Яндекс · ${yandexPlayerName}` : 'Платформа: Яндекс · без входа');
      } catch (e) {
        setOnlineStatus('Сохранение: игровой сервер');
      }
    } catch (err) {
      ysdk = null;
      yandexPlayer = null;
      setOnlineStatus('Сохранение: игровой сервер');
    }
  }

  async function requestYandexAuth() {
    if (!ysdk || !ysdk.auth) {
      setReadout('Авторизация Яндекса доступна только на платформе или при подключенном SDK.');
      return;
    }
    try {
      await ysdk.auth.openAuthDialog();
      yandexPlayer = await ysdk.getPlayer();
      yandexPlayerName = yandexPlayer.getName ? (yandexPlayer.getName() || '') : '';
      setOnlineStatus(yandexPlayerName ? `Платформа: Яндекс · ${yandexPlayerName}` : 'Платформа: Яндекс');
      const nameInput = document.getElementById('char-name-input');
      if (nameInput && !nameInput.value.trim() && yandexPlayerName) {
        nameInput.value = yandexPlayerName.slice(0, 18);
      }
    } catch (e) {
      setReadout('Вход в Яндекс отменён. Сохранение персонажа остаётся на игровом сервере.');
    }
  }



  const SERVER_CHARACTER_KEY = 'realm_of_ashes_server_character_v1';
  let selectedServerCharacterId = localStorage.getItem(SERVER_CHARACTER_KEY) || '';
  let activeCharacterLeaseId = '';
  let serverCharacters = [];
  let characterDeletePendingId = '';
  let characterSelectionInFlight = false;
  let characterSelectionEpoch = 0;
  let authScreenStep = 'login';
  let clientSaveContextEpoch = 0;

  function advanceClientSaveContextEpoch() {
    clientSaveContextEpoch += 1;
    return clientSaveContextEpoch;
  }

  function setSelectedServerCharacterForSaveContext(characterId = '', options = {}) {
    const nextId = String(characterId || '');
    const changed = nextId !== selectedServerCharacterId;
    if (changed) advanceClientSaveContextEpoch();
    selectedServerCharacterId = nextId;
    if (changed
      && typeof multiplayer === 'object'
      && multiplayer
      && (multiplayer.joined || multiplayer.joinInFlight)
      && options.preserveMultiplayerJoin !== true
      && typeof invalidateMultiplayerSessionContext === 'function') {
      invalidateMultiplayerSessionContext('character-context-changed', {
        disconnect: true,
        clearWorld: !!gameStarted
      });
    }
    return selectedServerCharacterId;
  }

  function currentClientSaveContext(characterId = selectedServerCharacterId) {
    return {
      epoch: clientSaveContextEpoch,
      token: String(serverSession.token || ''),
      characterId: String(characterId || ''),
      leaseId: String(activeCharacterLeaseId || ''),
      clientInstanceId: getClientInstanceId()
    };
  }

  function clientSaveContextMatches(context = {}) {
    return Number(context.epoch) === clientSaveContextEpoch
      && String(context.token || '') === String(serverSession.token || '')
      && String(context.characterId || '') === String(selectedServerCharacterId || '')
      && String(context.characterId || '') === String(characterProfile?.serverCharacterId || '')
      && String(context.leaseId || '') === String(activeCharacterLeaseId || '')
      && String(context.clientInstanceId || '') === getClientInstanceId();
  }

  const saveDrainFactory = window.RealmSaveGenerationDrain?.createSaveGenerationDrain;
  if (typeof saveDrainFactory !== 'function') throw new Error('Не загрузился координатор сохранений.');
  const clientSaveDrain = saveDrainFactory({
    capture: generation => captureClientSaveJob(generation),
    persist: job => persistClientSaveJob(job),
    onCommit: ({ generation, result }) => {
      const state = clientSaveDrain.snapshot();
      if (result?.contextCurrent !== false && state.requestedGeneration === generation) {
        saveDirty = false;
        saveTimer = 0;
      }
    },
    onFailure: () => {
      saveDirty = true;
      saveTimer = 0;
    }
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function setCharacterScreenTitle(title, subtitle) {
    const h = document.getElementById('character-screen-title');
    const p = document.getElementById('character-screen-subtitle');
    if (h) h.textContent = title;
    if (p) p.textContent = subtitle;
  }

  function setAuthStep(step) {
    authScreenStep = step;
    if (step !== 'create' && typeof releaseCharacterCreationPreview === 'function') {
      releaseCharacterCreationPreview();
    }
    ['login-panel', 'register-panel', 'password-reset-panel', 'password-reset-confirm-panel', 'character-select-panel', 'character-creator-panel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', id === `${step}-panel` || (step === 'select' && id === 'character-select-panel') || (step === 'create' && id === 'character-creator-panel'));
    });
    if (step === 'login') {
      setCharacterScreenTitle('Вход в игру', 'Войдите в серверный аккаунт, чтобы выбрать уже созданного персонажа или создать нового.');
    } else if (step === 'register') {
      setCharacterScreenTitle('Регистрация', 'Создайте аккаунт. После регистрации откроется выбор персонажа.');
    } else if (step === 'password-reset') {
      setCharacterScreenTitle('Восстановление пароля', 'Мы отправим одноразовую ссылку на email, указанный при регистрации.');
    } else if (step === 'password-reset-confirm') {
      setCharacterScreenTitle('Новый пароль', 'Установите новый пароль для серверного аккаунта.');
    } else if (step === 'select') {
      setCharacterScreenTitle('Выбор персонажа', 'Выберите существующего персонажа или создайте нового.');
    } else if (step === 'create') {
      setCharacterScreenTitle('Создание персонажа', 'Введите имя, распределите SPECIAL и обязательно выберите 1–2 профильных навыка и 1–2 стартовых перка.');
      renderCharacterCreator();
    }
  }

  function setServerAuthStatus(text, type = '') {
    const el = document.getElementById('server-auth-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', type === 'ok');
    el.classList.toggle('err', type === 'err');
  }

  function setServerRegisterStatus(text, type = '') {
    const el = document.getElementById('server-register-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', type === 'ok');
    el.classList.toggle('err', type === 'err');
  }

  function setPasswordResetStatus(id, text, type = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', type === 'ok');
    el.classList.toggle('err', type === 'err');
  }

  function setCharacterSelectStatus(text, type = '') {
    const el = document.getElementById('character-select-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('ok', type === 'ok');
    el.classList.toggle('err', type === 'err');
  }

  function updateServerAuthUI() {
    const loginText = document.getElementById('server-current-login');
    const selectLogin = document.getElementById('character-select-login');
    const loginInput = document.getElementById('server-login-input');
    const passInput = document.getElementById('server-password-input');
    if (loginText) loginText.textContent = serverSession.token ? `вход: ${serverSession.login}` : 'не выполнен вход';
    if (selectLogin) selectLogin.textContent = serverSession.token ? `аккаунт: ${serverSession.login}` : 'аккаунт';
    if (loginInput && serverSession.login && !loginInput.value) loginInput.value = serverSession.login;
    if (passInput && serverSession.token) passInput.value = '';
  }

  function setServerSession(token, login) {
    const previousToken = String(serverSession.token || '');
    serverSession.token = token || '';
    serverSession.login = login || '';
    const sessionChanged = previousToken !== String(serverSession.token || '');
    if (sessionChanged) {
      advanceClientSaveContextEpoch();
      characterSelectionEpoch += 1;
      characterSelectionInFlight = false;
      if (typeof multiplayer === 'object' && multiplayer) {
        if (serverSession.token) multiplayer.onlineSessionRequired = true;
        else if (!gameStarted) multiplayer.onlineSessionRequired = false;
      }
      if (typeof invalidateMultiplayerSessionContext === 'function') {
        invalidateMultiplayerSessionContext('session-context-changed', {
          disconnect: true,
          clearWorld: !!gameStarted
        });
      }
    }
    serverSaveAvailable = !!serverSession.token;
    if (serverSession.token) {
      localStorage.setItem(SERVER_TOKEN_KEY, serverSession.token);
      localStorage.setItem(SERVER_LOGIN_KEY, serverSession.login);
    } else {
      localStorage.removeItem(SERVER_TOKEN_KEY);
      localStorage.removeItem(SERVER_LOGIN_KEY);
      localStorage.removeItem(SERVER_CHARACTER_KEY);
      setSelectedServerCharacterForSaveContext('');
      serverCharacters = [];
    }
    updateServerAuthUI();
    if (typeof setClientAuthorityMode === 'function') {
      const requiresServerWorld = typeof clientWorldRequiresServer === 'function'
        ? clientWorldRequiresServer()
        : !!serverSession.token;
      setClientAuthorityMode(requiresServerWorld ? 'blocked' : 'offline-local', serverSession.token ? 'sessionAuthenticated' : 'sessionCleared', {
        force: true,
        clearWorld: !!gameStarted
      });
    }
  }

  function serverApiBaseCandidates() {
    const list = [SERVER_API_BASE];
    const host = String(location.hostname || '').toLowerCase();
    const localNetworkHost = host === 'localhost'
      || host === '127.0.0.1'
      || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if ((location.protocol === 'http:' || location.protocol === 'https:')
      && localNetworkHost
      && location.port !== '3000') {
      // npm start serves the API on the page's current origin even when PORT
      // is customized. A separate local static server can still fall back to
      // the conventional backend port after a same-origin 404/non-JSON reply.
      list.push('');
      list.push(`${location.protocol}//${host}:3000`);
    }
    return Array.from(new Set(list.map(v => String(v || '').replace(/\/+$/, ''))));
  }

  async function serverApi(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const requestSessionToken = String(serverSession.token || '');
    headers['X-Device-Id'] = getDeviceId();
    headers['X-Client-Instance-Id'] = getClientInstanceId();
    if (activeCharacterLeaseId) headers['X-Character-Lease-Id'] = activeCharacterLeaseId;
    headers['X-Device-Type'] = getDeviceType();
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (requestSessionToken) headers.Authorization = `Bearer ${requestSessionToken}`;

    let lastNetworkError = null;
    const candidates = serverApiBaseCandidates();
    for (let index = 0; index < candidates.length; index++) {
      const base = candidates[index];
      let response = null;
      try {
        response = await fetch(`${base}${path}`, { ...options, headers });
      } catch (err) {
        lastNetworkError = err;
        continue;
      }
      let data = null;
      let validJson = true;
      try { data = await response.json(); } catch (_) {
        validJson = false;
        data = { ok: false, error: response.statusText || 'Ошибка сервера' };
      }
      const canTryDefaultPort = index < candidates.length - 1 && base === ''
        && (!validJson || response.status === 404 || response.status === 405);
      if (canTryDefaultPort) continue;
      if (response.status === 401) {
        // A response from an obsolete save/auth context must not clear a newer
        // login that was established while the request was in flight.
        if (requestSessionToken === String(serverSession.token || '')) {
          setServerSession('', '');
          setOnlineStatus('Сервер: нужен вход');
          setAuthStep('login');
          const characterScreen = document.getElementById('character-screen');
          if (characterScreen) characterScreen.classList.add('visible');
          setServerAuthStatus('Сессия истекла. Войдите снова и откройте персонажа заново.', 'err');
        }
      }
      if (!response.ok || !data.ok) throw new Error(data.error || `Ошибка сервера ${response.status}`);
      if (base !== SERVER_API_BASE) {
        SERVER_API_BASE = base;
      }
      return data;
    }

    const host = SERVER_API_BASE || location.origin || 'текущий адрес';
    const errText = lastNetworkError?.message || 'Failed to fetch';
    throw new Error(`Нет соединения с сервером (${host}). Проверьте, что запущен node server.js и открыта правильная ссылка. ${errText}`);
  }

  function characterIdForState(state) {
    return state?.characterProfile?.serverCharacterId || selectedServerCharacterId || '';
  }

  async function loadServerCharacters() {
    if (!serverSession.token) return [];
    const data = await serverApi('/api/characters', { method: 'GET' });
    serverCharacters = Array.isArray(data.characters) ? data.characters : [];
    return serverCharacters;
  }

  function serverCharacterLocationLabel(locationId = '') {
    const id = String(locationId || 'settlement').trim();
    try {
      const authored = typeof LOCATIONS === 'object' ? LOCATIONS[id] : null;
      if (authored?.name) return String(authored.name);
      if (typeof globalMapLocationName === 'function') {
        const name = String(globalMapLocationName(id) || '').trim();
        if (name && name !== id) return name;
      }
    } catch (_) {}
    const labels = {
      settlement: 'Караванный двор Старого Клима',
      scrapTown: 'Свалочный союз',
      relayStation: 'Орден ретранслятора',
      oldDepot: 'Старый военный склад',
      roadOutpost: 'Дорожный аванпост',
      dryWaterPump: 'Старая водяная помпа'
    };
    if (labels[id]) return labels[id];
    if (id.startsWith('random') || id.includes('#')) return 'Пустошь';
    return 'Неизвестная локация';
  }

  function renderCharacterSelect() {
    const list = document.getElementById('character-list');
    if (!list) return;
    const controlsLocked = !!characterDeletePendingId || characterSelectionInFlight;
    const createButton = document.getElementById('create-new-character-btn');
    const logoutButton = document.getElementById('server-logout-btn');
    if (createButton) createButton.disabled = controlsLocked;
    if (logoutButton) logoutButton.disabled = controlsLocked;
    list.setAttribute('aria-busy', controlsLocked ? 'true' : 'false');
    list.innerHTML = '';
    if (!serverCharacters.length) {
      const empty = document.createElement('div');
      empty.className = 'character-empty';
      empty.textContent = 'На этом аккаунте пока нет персонажей. Создайте нового персонажа.';
      list.appendChild(empty);
      return;
    }
    serverCharacters.forEach(ch => {
      const row = document.createElement('div');
      row.className = 'character-card-row';
      const updated = ch.updatedAt ? new Date(ch.updatedAt).toLocaleString() : 'нет даты';
      const appearance = typeof characterAppearanceLabel === 'function'
        ? characterAppearanceLabel(ch.appearance || {})
        : '';
      const deletingThisCharacter = characterDeletePendingId === ch.id;
      row.innerHTML = `
        <div>
          <div class="character-card-name">☢ ${escapeHtml(ch.name || 'Без имени')}</div>
          <div class="character-card-meta">${appearance ? `${escapeHtml(appearance)} · ` : ''}Уровень ${Number(ch.level || 1)} · Локация: ${escapeHtml(serverCharacterLocationLabel(ch.locationId))} · обновлён: ${escapeHtml(updated)}</div>
        </div>
        <div class="character-card-actions">
          <button type="button" class="char-action-btn" data-character-play data-character-id="${escapeHtml(ch.id)}" ${controlsLocked ? 'disabled' : ''}>Играть</button>
          <button type="button" class="char-action-btn character-delete-btn" data-character-delete data-character-id="${escapeHtml(ch.id)}" aria-label="Удалить персонажа ${escapeHtml(ch.name || 'Без имени')}" ${controlsLocked ? 'disabled' : ''}>${deletingThisCharacter ? 'Удаление…' : 'Удалить'}</button>
        </div>
      `;
      row.querySelector('[data-character-play]')?.addEventListener('click', () => selectServerCharacter(ch.id));
      row.querySelector('[data-character-delete]')?.addEventListener('click', () => requestDeleteServerCharacter(ch));
      list.appendChild(row);
    });
  }

  async function clearDeletedCharacterClientState(characterId) {
    const id = String(characterId || '');
    const deletingSelected = selectedServerCharacterId === id || characterProfile?.serverCharacterId === id;
    if (!deletingSelected) return;
    setSelectedServerCharacterForSaveContext('');
    activeCharacterLeaseId = '';
    characterProfile = null;
    saveDirty = false;
    saveTimer = 0;
    localStorage.removeItem(SERVER_CHARACTER_KEY);
    if (typeof multiplayer === 'object' && multiplayer) {
      multiplayer.characterLeaseId = '';
      multiplayer.joined = false;
    }
  }

  async function deleteServerCharacter(character = {}) {
    const characterId = String(character.id || '');
    if (!characterId || characterDeletePendingId) return;
    let deleted = false;
    characterDeletePendingId = characterId;
    renderCharacterSelect();
    setCharacterSelectStatus(`Удаляю персонажа «${character.name || 'Без имени'}»...`);
    try {
      const data = await serverApi(`/api/characters/${encodeURIComponent(characterId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmCharacterId: characterId })
      });
      await clearDeletedCharacterClientState(characterId);
      serverCharacters = Array.isArray(data.characters) ? data.characters : [];
      deleted = true;
      setCharacterSelectStatus(
        serverCharacters.length
          ? `Персонаж «${character.name || 'Без имени'}» удалён.`
          : 'Персонаж удалён. На аккаунте больше нет персонажей.',
        'ok'
      );
    } catch (err) {
      setCharacterSelectStatus(`Не удалось удалить персонажа: ${err.message}`, 'err');
    } finally {
      characterDeletePendingId = '';
      renderCharacterSelect();
      const retryDelete = !deleted
        ? [...document.querySelectorAll('#character-list [data-character-delete]')]
          .find(button => button.dataset.characterId === characterId)
        : null;
      const nextAction = retryDelete
        || document.querySelector('#character-list [data-character-play]')
        || document.getElementById('create-new-character-btn');
      setTimeout(() => nextAction?.focus(), 0);
    }
  }

  function requestDeleteServerCharacter(character = {}) {
    if (!character.id || characterDeletePendingId) return;
    const opened = openGameConfirmPanel({
      kicker: 'Удаление персонажа',
      title: 'Удалить персонажа навсегда?',
      itemName: character.name || 'Без имени',
      body: `Уровень ${Number(character.level || 1)}. Всё серверное сохранение этого персонажа будет удалено.`,
      note: 'Действие необратимо. Инвентарь, прогресс, карта и задания восстановить нельзя.',
      iconText: '☠',
      confirmLabel: 'Удалить',
      cancelLabel: 'Оставить',
      onConfirm: () => deleteServerCharacter(character)
    });
    if (!opened) setCharacterSelectStatus('Не удалось открыть подтверждение удаления.', 'err');
  }

  async function showCharacterSelect(message = '') {
    setAuthStep('select');
    updateServerAuthUI();
    try {
      await loadServerCharacters();
      renderCharacterSelect();
      setOnlineStatus(`Сервер: ${serverSession.login}`);
      setCharacterSelectStatus(message || (serverCharacters.length ? 'Выберите персонажа для продолжения.' : 'Персонажей пока нет. Создайте нового.'), serverCharacters.length ? 'ok' : '');
    } catch (err) {
      console.warn('Character list load failed:', err);
      renderCharacterSelect();
      setCharacterSelectStatus(`Не удалось загрузить список персонажей: ${err.message}`, 'err');
    }
  }

  async function selectServerCharacter(characterId) {
    if (characterDeletePendingId) {
      setCharacterSelectStatus('Дождитесь завершения удаления персонажа.', '');
      return;
    }
    if (!serverSession.token) {
      setAuthStep('login');
      setServerAuthStatus('Сначала войдите в аккаунт.', 'err');
      return;
    }
    if (characterSelectionInFlight) {
      setCharacterSelectStatus('Дождитесь завершения загрузки выбранного персонажа.', '');
      return;
    }
    const selectionEpoch = characterSelectionEpoch + 1;
    const selectionToken = String(serverSession.token || '');
    characterSelectionEpoch = selectionEpoch;
    characterSelectionInFlight = true;
    const selectionIsCurrent = () => characterSelectionInFlight
      && characterSelectionEpoch === selectionEpoch
      && String(serverSession.token || '') === selectionToken;
    renderCharacterSelect();
    try {
      setCharacterSelectStatus('Загружаю персонажа...', '');
      const data = await serverApi(`/api/characters/${encodeURIComponent(characterId)}`, { method: 'GET' });
      if (!selectionIsCurrent()) return;
      if (!data.save) throw new Error('Данные персонажа повреждены или пустые.');
      await ensureWorldDataReady();
      if (!selectionIsCurrent()) return;
      const targetLocation = LOCATIONS[data.save.currentLocationId] || LOCATIONS.settlement;
      const loadWorld = () => {
        if (!selectionIsCurrent()) throw new Error('Загрузка персонажа была отменена.');
        if (!applySavedState(data.save)) throw new Error('Данные персонажа повреждены или пустые.');
        return true;
      };
      let loaded = false;
      if (typeof runGameStartupLoading === 'function') {
        const profileName = data.save?.characterProfile?.name || 'персонаж';
        loaded = await runGameStartupLoading(`Персонаж: ${profileName}`, loadWorld, {
          location: targetLocation,
          subtitle: 'Загружаю персонажа и подготавливаю мир...',
          errorMessage: 'Не удалось загрузить данные персонажа.',
          beforeRevealStep: 'Синхронизирую локацию с сервером...',
          beforeRevealProgress: 90,
          beforeReveal: async () => {
            if (!selectionIsCurrent()) throw new Error('Загрузка персонажа была отменена.');
            setSelectedServerCharacterForSaveContext(characterId);
            if (characterProfile) characterProfile.serverCharacterId = characterId;
            localStorage.setItem(SERVER_CHARACTER_KEY, selectedServerCharacterId);
            const networkReady = await connectMultiplayer({ waitForJoin: true, timeoutMs: 4500 });
            if (!selectionIsCurrent()) throw new Error('Загрузка персонажа была отменена.');
            if (networkReady === false) {
              gameStarted = false;
              activeCharacterLeaseId = '';
              if (typeof invalidateMultiplayerSessionContext === 'function') {
                invalidateMultiplayerSessionContext('character-join-failed', {
                  disconnect: true,
                  clearWorld: true
                });
              } else if (multiplayer.socket) {
                try { multiplayer.socket.disconnect(); } catch (_) {}
                multiplayer.socket = null;
              }
              throw new Error('Сервер не разрешил открыть этого персонажа. Возможно, он уже открыт в другой вкладке.');
            }
            // v7.74.67: do not reveal/start the world until the server has
            // granted the active character lease. A rejected duplicate tab must
            // stay on the character screen and must not be able to save state.
            hideCharacterCreatorAndStart();
            return true;
          }
        });
      } else {
        loaded = loadWorld();
        if (loaded) {
          if (!selectionIsCurrent()) return;
          setSelectedServerCharacterForSaveContext(characterId);
          if (characterProfile) characterProfile.serverCharacterId = characterId;
          localStorage.setItem(SERVER_CHARACTER_KEY, selectedServerCharacterId);
          hideCharacterCreatorAndStart();
          connectMultiplayer();
        }
      }
      if (!loaded) throw new Error('Не удалось подготовить мир персонажа.');
      addLog(`Серверный персонаж загружен: ${characterProfile.name}.`, null, 'system');
      renderUI();
    } catch (err) {
      console.warn('Character load failed:', err);
      if (selectionIsCurrent()) {
        setCharacterSelectStatus(`Не удалось загрузить персонажа: ${err.message}`, 'err');
      }
    } finally {
      if (characterSelectionEpoch === selectionEpoch) {
        characterSelectionInFlight = false;
        renderCharacterSelect();
      }
    }
  }

  function makeNewCharacterId() {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function resetCharacterCreationForm() {
    creatorStats = Object.fromEntries(specialStatDefs().map(s => [s.key, 5]));
    creatorSkills = [];
    creatorTraits = [];
    creatorAppearance = typeof defaultCharacterAppearance === 'function'
      ? defaultCharacterAppearance('male')
      : {
        schema: 'realm.character-appearance.v1',
        sex: 'male',
        bodyType: 'medium'
      };
    const nameInput = document.getElementById('char-name-input');
    if (nameInput) nameInput.value = '';
    setCharacterNotice('');
  }

  function startNewCharacterCreation() {
    if (characterDeletePendingId) {
      setCharacterSelectStatus('Дождитесь завершения удаления персонажа.', '');
      return;
    }
    if (!serverSession.token) {
      setAuthStep('login');
      setServerAuthStatus('Сначала войдите или зарегистрируйтесь.', 'err');
      return;
    }
    setSelectedServerCharacterForSaveContext(makeNewCharacterId());
    localStorage.setItem(SERVER_CHARACTER_KEY, selectedServerCharacterId);
    resetCharacterCreationForm();
    setAuthStep('create');
  }

  async function confirmClientSaveBeforeContextTransition(kind = 'switch') {
    if (!characterProfile) return true;
    if (clientContextTransitionInFlight) {
      setReadout('Переход уже ожидает подтверждения сохранения.');
      return false;
    }
    clientContextTransitionInFlight = true;
    try {
      if (typeof clearAllGameplayInput === 'function') {
        clearAllGameplayInput(`save-${kind}`, { sendIdle: true });
      }
    } catch (_) {}
    let saveConfirmed = false;
    try { saveConfirmed = (await saveGame(true)) !== false; } catch (_) {}
    if (!saveConfirmed) {
      clientContextTransitionInFlight = false;
      const logout = kind === 'logout';
      const message = logout
        ? 'Выход отменён: сервер не подтвердил последнее сохранение. Проверьте соединение и повторите попытку.'
        : 'Смена персонажа отменена: сервер не подтвердил последнее сохранение. Проверьте соединение и повторите попытку.';
      setReadout(message);
      setOnlineStatus(logout
        ? 'Сервер: выход отложен до подтверждения сохранения'
        : 'Сервер: смена персонажа отложена до подтверждения сохранения');
      if (logout) setServerAuthStatus(message, 'err');
      else setCharacterSelectStatus(message, 'err');
      return false;
    }
    return true;
  }

  async function serverLogout() {
    if (characterDeletePendingId) {
      setCharacterSelectStatus('Дождитесь завершения удаления персонажа.', '');
      return;
    }
    if (!await confirmClientSaveBeforeContextTransition('logout')) return false;
    try {
      if (serverSession.token) await serverApi('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    if (multiplayer.socket) { try { multiplayer.socket.disconnect(); } catch (_) {} multiplayer.socket = null; }
    clearRemotePlayers();
    closeAllWindows(false);
    closeLootWindow();
    closeTraderWindow();
    closeStorageWindow();
    closeGameMenu(false);
    closeTutorialWindow(false);
    setServerSession('', '');
    gameStarted = false;
    characterProfile = null;
    clientContextTransitionInFlight = false;
    if (typeof multiplayer === 'object' && multiplayer) multiplayer.onlineSessionRequired = false;
    setSelectedServerCharacterForSaveContext('');
    activeCharacterLeaseId = '';
    characterDeletePendingId = '';
    const screen = document.getElementById('character-screen');
    if (screen) screen.classList.add('visible');
    setAuthStep('login');
    setOnlineStatus('Сервер: войдите или зарегистрируйтесь');
    setServerAuthStatus(
      'Вы вышли из аккаунта.',
      'ok'
    );
    updateMobilePanelState();
    return true;
  }

  async function handleServerAuth() {
    const login = (document.getElementById('server-login-input')?.value || '').trim();
    const password = document.getElementById('server-password-input')?.value || '';
    if (login.length < 3 || password.length < 4) {
      setServerAuthStatus('Введите логин от 3 символов и пароль от 4 символов.', 'err');
      return;
    }
    setServerAuthStatus('Вход...');
    try {
      const data = await serverApi('/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password, deviceId: getDeviceId(), clientInstanceId: getClientInstanceId(), deviceType: getDeviceType(), controlType: getDeviceControlType() }) });
      setServerSession(data.token, data.user?.login || login);
      setServerAuthStatus('Вход выполнен.', 'ok');
      await showCharacterSelect('Вход выполнен. Выберите персонажа или создайте нового.');
    } catch (err) {
      setServerAuthStatus(err.message || 'Ошибка входа.', 'err');
    }
  }

  async function handleServerRegistration() {
    const login = (document.getElementById('register-login-input')?.value || '').trim();
    const email = (document.getElementById('register-email-input')?.value || '').trim();
    const password = document.getElementById('register-password-input')?.value || '';
    const password2 = document.getElementById('register-password2-input')?.value || '';
    if (login.length < 3 || !email || password.length < 8) {
      setServerRegisterStatus('Введите логин, корректный email и пароль от 8 символов.', 'err');
      return;
    }
    if (password !== password2) {
      setServerRegisterStatus('Пароли не совпадают.', 'err');
      return;
    }
    setServerRegisterStatus('Регистрация...');
    try {
      const data = await serverApi('/api/auth/register', { method: 'POST', body: JSON.stringify({ login, email, password, deviceId: getDeviceId(), clientInstanceId: getClientInstanceId(), deviceType: getDeviceType(), controlType: getDeviceControlType() }) });
      setServerSession(data.token, data.user?.login || login);
      setServerRegisterStatus('Аккаунт создан.', 'ok');
      await showCharacterSelect('Аккаунт создан. Создайте первого персонажа.');
    } catch (err) {
      setServerRegisterStatus(err.message || 'Ошибка регистрации.', 'err');
    }
  }

  async function handlePasswordResetRequest() {
    const email = (document.getElementById('password-reset-email-input')?.value || '').trim();
    if (!email || !email.includes('@')) {
      setPasswordResetStatus('password-reset-status', 'Введите корректный email.', 'err');
      return;
    }
    setPasswordResetStatus('password-reset-status', 'Отправка ссылки...');
    try {
      const data = await serverApi('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email })
      });
      setPasswordResetStatus('password-reset-status', data.message || 'Если email зарегистрирован, ссылка отправлена.', 'ok');
    } catch (err) {
      setPasswordResetStatus('password-reset-status', err.message || 'Не удалось отправить ссылку.', 'err');
    }
  }

  async function handlePasswordResetConfirm() {
    const query = new URLSearchParams(location.search);
    const token = query.get('resetToken') || '';
    const login = (document.getElementById('password-reset-login-input')?.value || query.get('login') || '').trim();
    const password = document.getElementById('password-reset-new-input')?.value || '';
    const password2 = document.getElementById('password-reset-new2-input')?.value || '';
    if (!token || login.length < 3) {
      setPasswordResetStatus('password-reset-confirm-status', 'Ссылка восстановления неполная или повреждена.', 'err');
      return;
    }
    if (password.length < 8) {
      setPasswordResetStatus('password-reset-confirm-status', 'Пароль должен содержать не менее 8 символов.', 'err');
      return;
    }
    if (password !== password2) {
      setPasswordResetStatus('password-reset-confirm-status', 'Пароли не совпадают.', 'err');
      return;
    }
    setPasswordResetStatus('password-reset-confirm-status', 'Сохранение нового пароля...');
    try {
      const data = await serverApi('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ login, token, password })
      });
      history.replaceState(null, '', `${location.pathname}${location.hash}`);
      setAuthStep('login');
      const loginInput = document.getElementById('server-login-input');
      if (loginInput) loginInput.value = login;
      setServerAuthStatus(data.message || 'Пароль изменён. Теперь можно войти.', 'ok');
    } catch (err) {
      setPasswordResetStatus('password-reset-confirm-status', err.message || 'Не удалось изменить пароль.', 'err');
    }
  }

  function openPasswordResetFromUrl() {
    const query = new URLSearchParams(location.search);
    const token = query.get('resetToken') || '';
    const login = query.get('login') || '';
    if (!token) return false;
    const input = document.getElementById('password-reset-login-input');
    if (input) input.value = login;
    setAuthStep('password-reset-confirm');
    return true;
  }

  async function loadServerState() {
    if (!serverSession.token || !selectedServerCharacterId) return null;
    try {
      const data = await serverApi(`/api/characters/${encodeURIComponent(selectedServerCharacterId)}`, { method: 'GET' });
      setOnlineStatus(`Сервер: ${serverSession.login}`);
      return data.save || null;
    } catch (err) {
      console.warn('Server save load failed:', err);
      return null;
    }
  }

  function captureClientSaveJob(generation) {
    if (!serverSession.token || !selectedServerCharacterId || !activeCharacterLeaseId || !characterProfile) return null;
    const state = serializeGameState();
    if (!state) return null;
    const characterId = String(characterIdForState(state) || '');
    if (!characterId || characterId !== selectedServerCharacterId) return null;
    const context = currentClientSaveContext(characterId);
    const body = JSON.stringify({
      state,
      saveGeneration: generation,
      characterLeaseId: context.leaseId,
      clientInstanceId: context.clientInstanceId
    });
    return {
      generation,
      characterId,
      context,
      body,
      leaderboardEligible: Number(player.level || 1) > 1,
      leaderboardScore: Math.max(0, Number(player.xp || 0) + (Math.max(1, Number(player.level || 1)) - 1) * 1000),
      leaderboardName: String(characterProfile.name || '')
    };
  }

  async function saveServerState(job) {
    if (!job?.body || !job.characterId || !job.context?.token) {
      return { ok: false, error: new Error('Контекст сохранения неполный.'), contextCurrent: false };
    }
    if (!clientSaveContextMatches(job.context)) {
      return { ok: false, error: new Error('Контекст персонажа изменился до сохранения.'), contextCurrent: false };
    }
    if (!job.context.leaseId) {
      // v7.74.67: a tab that has not received the server character lease must
      // never write an online character. This blocks duplicate/background tabs
      // even if they still have local UI state or copied localStorage.
      return { ok: false, error: new Error('Нет активной сессии персонажа.'), contextCurrent: true };
    }
    try {
      const data = await serverApi(`/api/characters/${encodeURIComponent(job.characterId)}/save`, {
        method: 'POST',
        body: job.body
      });
      const contextCurrent = clientSaveContextMatches(job.context);
      if (contextCurrent && data.characterId && characterProfile) {
        setSelectedServerCharacterForSaveContext(data.characterId);
        characterProfile.serverCharacterId = data.characterId;
        localStorage.setItem(SERVER_CHARACTER_KEY, data.characterId);
      }
      if (contextCurrent) {
        setOnlineStatus(`Сервер: ${serverSession.login} · данные синхронизированы`);
        setCharacterSelectStatus(`Данные синхронизированы: ${new Date().toLocaleTimeString()}.`, 'ok');
      }
      return { ok: true, data, contextCurrent };
    } catch (err) {
      console.warn('Server save failed:', err);
      const contextCurrent = clientSaveContextMatches(job.context);
      if (contextCurrent) {
        setOnlineStatus('Сервер: ошибка синхронизации');
        setCharacterSelectStatus(`Ошибка синхронизации с сервером: ${err.message}`, 'err');
        if (/открыт|сессии|lease|Синхронизация отклонена/i.test(String(err.message || ''))) {
          advanceClientSaveContextEpoch();
          activeCharacterLeaseId = '';
          if (multiplayer) multiplayer.characterLeaseId = '';
          setReadout('Сессия персонажа недействительна. Откройте персонажа заново.');
        }
      }
      return { ok: false, error: err, contextCurrent };
    }
  }

  async function persistClientSaveJob(job) {
    const saved = await saveServerState(job);
    if (!saved.ok) return saved;
    // The old HTTP write may have reached the server, but it cannot satisfy the
    // current character/session. Keep this generation dirty so a later bounded
    // drain captures the new context instead of clearing or mutating its UI.
    if (!saved.contextCurrent) return { ...saved, ok: false, staleContext: true };
    // Leaderboards are best-effort metadata, not part of the authoritative
    // character commit. Run them detached so a stalled platform SDK cannot
    // block logout, character switching or the save generation drain.
    if (ysdk && ysdk.leaderboards && job.leaderboardEligible) {
      Promise.resolve().then(async () => {
        if (!clientSaveContextMatches(job.context)) return;
        try {
          const ok = ysdk.isAvailableMethod ? await ysdk.isAvailableMethod('leaderboards.setScore') : true;
          if (ok && clientSaveContextMatches(job.context)) {
            await ysdk.leaderboards.setScore(LEADERBOARD_NAME, job.leaderboardScore, job.leaderboardName);
          }
        } catch (_) {}
      });
    }
    const contextCurrent = clientSaveContextMatches(job.context);
    return {
      ...saved,
      ok: contextCurrent,
      contextCurrent,
      staleContext: !contextCurrent
    };
  }

  async function continueAfterServerAuth() {
    return showCharacterSelect('Выберите персонажа или создайте нового.');
  }
