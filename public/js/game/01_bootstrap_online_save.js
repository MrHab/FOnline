// Realm of Ashes v7.76.0 client bootstrap
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

  // ===== YANDEX GAMES / ONLINE SAVE =====
  const SAVE_KEY = 'realm_of_ashes_save_v1';
  const LEADERBOARD_NAME = 'wasteland_xp';
  let ysdk = null;
  let yandexPlayer = null;
  let yandexPlayerName = '';
  let onlineSaveAvailable = false;
  let gameStarted = false;
  let characterProfile = null;
  let saveDirty = false;
  let saveTimer = 0;
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
  const SERVER_URL_KEY = 'realm_of_ashes_server_url_v1';
  const SERVER_DEVICE_KEY = 'realm_of_ashes_device_id_v1';
  const SERVER_CLIENT_INSTANCE_KEY = 'realm_of_ashes_client_instance_v1';
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

  function sameHostServerApiBase() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return '';
    }
    return 'http://localhost:3000';
  }

  function defaultPortServerApiBase() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      if (location.port === '3000') return '';
      return `${location.protocol}//${location.hostname || 'localhost'}:3000`;
    }
    return 'http://localhost:3000';
  }

  function defaultServerApiBase() {
    const sameHost = sameHostServerApiBase();
    const configured = (localStorage.getItem(SERVER_URL_KEY) || '').replace(/\/+$/, '');
    // Если игра открыта прямо с Node-сервера на :3000, всегда используем текущий адрес.
    // Это защищает от старого сохранённого IP/порта в localStorage после смены Wi‑Fi/IP.
    if (location.port === '3000') {
      if (configured) localStorage.removeItem(SERVER_URL_KEY);
      return '';
    }
    if (configured) return configured;
    return sameHost;
  }

  function requiresExplicitServerApiBase() {
    return /(^|\.)github\.io$/i.test(String(location.hostname || ''));
  }

  function applyServerApiBaseFromAuthInput() {
    const input = document.getElementById('server-url-input');
    const raw = String(input?.value || '').trim();
    if (!raw) {
      if (requiresExplicitServerApiBase()) {
        throw new Error('Укажите публичный HTTPS-адрес игрового сервера. GitHub Pages запускает только клиент игры.');
      }
      SERVER_API_BASE = defaultServerApiBase();
      localStorage.removeItem(SERVER_URL_KEY);
      return SERVER_API_BASE;
    }

    let parsed = null;
    try { parsed = new URL(raw); } catch (_) {
      throw new Error('Некорректный адрес игрового сервера. Используйте полный URL вида https://game.example.com.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Адрес игрового сервера должен использовать HTTP или HTTPS и не содержать логин/пароль.');
    }
    if (location.protocol === 'https:' && parsed.protocol !== 'https:') {
      throw new Error('Страница открыта по HTTPS, поэтому игровой сервер тоже должен использовать HTTPS.');
    }
    const normalized = parsed.origin.replace(/\/+$/, '');
    if (requiresExplicitServerApiBase() && normalized === location.origin) {
      throw new Error('Укажите адрес Node-сервера, а не адрес GitHub Pages.');
    }
    SERVER_API_BASE = normalized;
    localStorage.setItem(SERVER_URL_KEY, normalized);
    if (input) input.value = normalized;
    return normalized;
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
      // На локальном/LAN сервере SDK Яндекса не нужен. Иначе браузер пытается загрузить /sdk.js,
      // получает 404/text/html и пишет ошибку MIME. Для нашей серверной авторизации сразу работаем локально.
      if (isLocal && !isYandexRuntime) throw new Error('LAN launch: use server/local save fallback');
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
        onlineSaveAvailable = true;
        yandexPlayerName = yandexPlayer.isAuthorized && yandexPlayer.isAuthorized() ? (yandexPlayer.getName() || '') : '';
        setOnlineStatus(yandexPlayerName ? `Профиль: облако · ${yandexPlayerName}` : 'Профиль: облако · без входа');
      } catch (e) {
        onlineSaveAvailable = false;
        setOnlineStatus('Профиль: локально');
      }
    } catch (err) {
      ysdk = null;
      yandexPlayer = null;
      onlineSaveAvailable = false;
      setOnlineStatus('Профиль: локально');
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
      onlineSaveAvailable = true;
      yandexPlayerName = yandexPlayer.getName ? (yandexPlayer.getName() || '') : '';
      setOnlineStatus(yandexPlayerName ? `Профиль: облако · ${yandexPlayerName}` : 'Профиль: облако');
      const nameInput = document.getElementById('char-name-input');
      if (nameInput && !nameInput.value.trim() && yandexPlayerName) {
        nameInput.value = yandexPlayerName.slice(0, 18);
      }
    } catch (e) {
      setReadout('Вход отменён. Можно играть с локальным профилем.');
    }
  }



  const SERVER_CHARACTER_KEY = 'realm_of_ashes_server_character_v1';
  let selectedServerCharacterId = localStorage.getItem(SERVER_CHARACTER_KEY) || '';
  let activeCharacterLeaseId = '';
  let serverCharacters = [];
  let authScreenStep = 'login';

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
    ['login-panel', 'register-panel', 'character-select-panel', 'character-creator-panel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', id === `${step}-panel` || (step === 'select' && id === 'character-select-panel') || (step === 'create' && id === 'character-creator-panel'));
    });
    if (step === 'login') {
      setCharacterScreenTitle('Вход в игру', 'Войдите в серверный аккаунт, чтобы выбрать уже созданного персонажа или создать нового.');
    } else if (step === 'register') {
      setCharacterScreenTitle('Регистрация', 'Создайте аккаунт. После регистрации откроется выбор персонажа.');
    } else if (step === 'select') {
      setCharacterScreenTitle('Выбор персонажа', 'Выберите существующего персонажа или создайте нового.');
    } else if (step === 'create') {
      setCharacterScreenTitle('Создание персонажа', 'Введите имя, распределите SPECIAL и выберите до двух стартовых черт. После повышения уровня очки распределяются в отдельные навыки.');
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
    const serverUrlInput = document.getElementById('server-url-input');
    const loginInput = document.getElementById('server-login-input');
    const passInput = document.getElementById('server-password-input');
    if (loginText) loginText.textContent = serverSession.token ? `вход: ${serverSession.login}` : 'не выполнен вход';
    if (selectLogin) selectLogin.textContent = serverSession.token ? `аккаунт: ${serverSession.login}` : 'аккаунт';
    if (serverUrlInput && !serverUrlInput.value) serverUrlInput.value = SERVER_API_BASE || '';
    if (loginInput && serverSession.login && !loginInput.value) loginInput.value = serverSession.login;
    if (passInput && serverSession.token) passInput.value = '';
  }

  function setServerSession(token, login) {
    serverSession.token = token || '';
    serverSession.login = login || '';
    serverSaveAvailable = !!serverSession.token;
    if (serverSession.token) {
      localStorage.setItem(SERVER_TOKEN_KEY, serverSession.token);
      localStorage.setItem(SERVER_LOGIN_KEY, serverSession.login);
    } else {
      localStorage.removeItem(SERVER_TOKEN_KEY);
      localStorage.removeItem(SERVER_LOGIN_KEY);
      localStorage.removeItem(SERVER_CHARACTER_KEY);
      selectedServerCharacterId = '';
      serverCharacters = [];
    }
    updateServerAuthUI();
  }

  function serverApiBaseCandidates() {
    const list = [SERVER_API_BASE, sameHostServerApiBase(), defaultPortServerApiBase()];
    if (location.port === '3000') list.unshift('');
    return Array.from(new Set(list.map(v => String(v || '').replace(/\/+$/, ''))));
  }

  async function serverApi(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    headers['X-Device-Id'] = getDeviceId();
    headers['X-Client-Instance-Id'] = getClientInstanceId();
    if (activeCharacterLeaseId) headers['X-Character-Lease-Id'] = activeCharacterLeaseId;
    headers['X-Device-Type'] = getDeviceType();
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (serverSession.token) headers.Authorization = `Bearer ${serverSession.token}`;

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
        setServerSession('', '');
        setOnlineStatus('Сервер: нужен вход');
        setAuthStep('login');
      }
      if (!response.ok || !data.ok) throw new Error(data.error || `Ошибка сервера ${response.status}`);
      if (base !== SERVER_API_BASE) {
        SERVER_API_BASE = base;
        if (base) localStorage.setItem(SERVER_URL_KEY, base);
        else localStorage.removeItem(SERVER_URL_KEY);
      }
      return data;
    }

    const host = SERVER_API_BASE || defaultPortServerApiBase() || location.origin || 'текущий адрес';
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
      row.innerHTML = `
        <div>
          <div class="character-card-name">☢ ${escapeHtml(ch.name || 'Без имени')}</div>
          <div class="character-card-meta">Уровень ${Number(ch.level || 1)} · Локация: ${escapeHtml(serverCharacterLocationLabel(ch.locationId))} · обновлён: ${escapeHtml(updated)}</div>
        </div>
        <button class="char-action-btn">Играть</button>
      `;
      row.querySelector('button').addEventListener('click', () => selectServerCharacter(ch.id));
      list.appendChild(row);
    });
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
    if (!serverSession.token) {
      setAuthStep('login');
      setServerAuthStatus('Сначала войдите в аккаунт.', 'err');
      return;
    }
    try {
      setCharacterSelectStatus('Загружаю персонажа...', '');
      const data = await serverApi(`/api/characters/${encodeURIComponent(characterId)}`, { method: 'GET' });
      if (!data.save) throw new Error('Данные персонажа повреждены или пустые.');
      const targetLocation = LOCATIONS[data.save.currentLocationId] || LOCATIONS.settlement;
      const loadWorld = () => {
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
            selectedServerCharacterId = characterId;
            if (characterProfile) characterProfile.serverCharacterId = characterId;
            localStorage.setItem(SERVER_CHARACTER_KEY, selectedServerCharacterId);
            const networkReady = await connectMultiplayer({ waitForJoin: true, timeoutMs: 4500 });
            if (networkReady === false) {
              gameStarted = false;
              activeCharacterLeaseId = '';
              if (multiplayer.socket) { try { multiplayer.socket.disconnect(); } catch (_) {} multiplayer.socket = null; }
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
          selectedServerCharacterId = characterId;
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
      setCharacterSelectStatus(`Не удалось загрузить персонажа: ${err.message}`, 'err');
    }
  }

  function makeNewCharacterId() {
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function resetCharacterCreationForm() {
    creatorStats = Object.fromEntries(specialStatDefs().map(s => [s.key, 5]));
    creatorTraits = [];
    const nameInput = document.getElementById('char-name-input');
    if (nameInput) nameInput.value = '';
    setCharacterNotice('');
  }

  function startNewCharacterCreation() {
    if (!serverSession.token) {
      setAuthStep('login');
      setServerAuthStatus('Сначала войдите или зарегистрируйтесь.', 'err');
      return;
    }
    selectedServerCharacterId = makeNewCharacterId();
    localStorage.setItem(SERVER_CHARACTER_KEY, selectedServerCharacterId);
    resetCharacterCreationForm();
    setAuthStep('create');
  }

  async function serverLogout() {
    try { saveGame(true); } catch (_) {}
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
    selectedServerCharacterId = '';
    activeCharacterLeaseId = '';
    const screen = document.getElementById('character-screen');
    if (screen) screen.classList.add('visible');
    setAuthStep('login');
    setOnlineStatus('Сервер: войдите или зарегистрируйтесь');
    setServerAuthStatus('Вы вышли из аккаунта.', 'ok');
    updateMobilePanelState();
  }

  async function handleServerAuth() {
    const login = (document.getElementById('server-login-input')?.value || '').trim();
    const password = document.getElementById('server-password-input')?.value || '';
    if (login.length < 3 || password.length < 4) {
      setServerAuthStatus('Введите логин от 3 символов и пароль от 4 символов.', 'err');
      return;
    }
    try { applyServerApiBaseFromAuthInput(); } catch (err) {
      setServerAuthStatus(err.message || 'Проверьте адрес игрового сервера.', 'err');
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
    const password = document.getElementById('register-password-input')?.value || '';
    const password2 = document.getElementById('register-password2-input')?.value || '';
    if (login.length < 3 || password.length < 4) {
      setServerRegisterStatus('Логин от 3 символов, пароль от 4 символов.', 'err');
      return;
    }
    if (password !== password2) {
      setServerRegisterStatus('Пароли не совпадают.', 'err');
      return;
    }
    try { applyServerApiBaseFromAuthInput(); } catch (err) {
      setServerRegisterStatus(err.message || 'Проверьте адрес игрового сервера.', 'err');
      return;
    }
    setServerRegisterStatus('Регистрация...');
    try {
      const data = await serverApi('/api/auth/register', { method: 'POST', body: JSON.stringify({ login, password, deviceId: getDeviceId(), clientInstanceId: getClientInstanceId(), deviceType: getDeviceType(), controlType: getDeviceControlType() }) });
      setServerSession(data.token, data.user?.login || login);
      setServerRegisterStatus('Аккаунт создан.', 'ok');
      await showCharacterSelect('Аккаунт создан. Создайте первого персонажа.');
    } catch (err) {
      setServerRegisterStatus(err.message || 'Ошибка регистрации.', 'err');
    }
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

  async function saveServerState(state) {
    if (!serverSession.token || !state) return false;
    if (!activeCharacterLeaseId) {
      // v7.74.67: a tab that has not received the server character lease must
      // never write an online character. This blocks duplicate/background tabs
      // even if they still have local UI state or copied localStorage.
      return false;
    }
    try {
      let characterId = characterIdForState(state);
      if (!characterId) characterId = makeNewCharacterId();
      selectedServerCharacterId = characterId;
      if (!state.characterProfile) state.characterProfile = {};
      state.characterProfile.serverCharacterId = characterId;
      localStorage.setItem(SERVER_CHARACTER_KEY, characterId);
      const data = await serverApi(`/api/characters/${encodeURIComponent(characterId)}/save`, { method: 'POST', body: JSON.stringify({ state, characterLeaseId: activeCharacterLeaseId, clientInstanceId: getClientInstanceId() }) });
      if (data.characterId && characterProfile) {
        selectedServerCharacterId = data.characterId;
        characterProfile.serverCharacterId = data.characterId;
        localStorage.setItem(SERVER_CHARACTER_KEY, data.characterId);
      }
      setOnlineStatus(`Сервер: ${serverSession.login} · данные синхронизированы`);
      setCharacterSelectStatus(`Данные синхронизированы: ${new Date().toLocaleTimeString()}.`, 'ok');
      return true;
    } catch (err) {
      console.warn('Server save failed:', err);
      setOnlineStatus('Сервер: ошибка синхронизации');
      setCharacterSelectStatus(`Ошибка синхронизации с сервером: ${err.message}`, 'err');
      if (/открыт|сессии|lease|Синхронизация отклонена/i.test(String(err.message || ''))) {
        activeCharacterLeaseId = '';
        if (multiplayer) multiplayer.characterLeaseId = '';
        setReadout('Сессия персонажа недействительна. Откройте персонажа заново.');
      }
      return false;
    }
  }

  async function continueAfterServerAuth() {
    return showCharacterSelect('Выберите персонажа или создайте нового.');
  }
