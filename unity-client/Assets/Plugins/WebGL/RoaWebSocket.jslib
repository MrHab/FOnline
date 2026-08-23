// Мост к браузерному WebSocket для RoaWebGlWebSocket (RoaWebSocketTransport.cs).
// Текстовые кадры только: Socket.IO-протокол проекта бинарных вложений не шлёт.
var RoaWebSocketPlugin = {
  $RoaWs: {
    sockets: {},
    nextId: 1,
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
    callString: function (cb, id, text) {
      var length = lengthBytesUTF8(text) + 1;
      var ptr = _malloc(length);
      stringToUTF8(text, ptr, length);
      try { {{{ makeDynCall('vii', 'cb') }}}(id, ptr); } finally { _free(ptr); }
    },
    callClose: function (cb, id, code, reason) {
      var length = lengthBytesUTF8(reason) + 1;
      var ptr = _malloc(length);
      stringToUTF8(reason, ptr, length);
      try { {{{ makeDynCall('viii', 'cb') }}}(id, code, ptr); } finally { _free(ptr); }
    }
  },

  RoaWs_Init: function (onOpen, onMessage, onClose, onError) {
    RoaWs.onOpen = onOpen;
    RoaWs.onMessage = onMessage;
    RoaWs.onClose = onClose;
    RoaWs.onError = onError;
  },

  RoaWs_Connect: function (urlPtr) {
    var url = UTF8ToString(urlPtr);
    var id = RoaWs.nextId++;
    var socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      return -1;
    }
    RoaWs.sockets[id] = socket;
    socket.onopen = function () {
      if (RoaWs.onOpen) {{{ makeDynCall('vi', 'RoaWs.onOpen') }}}(id);
    };
    socket.onmessage = function (event) {
      if (typeof event.data !== 'string') return; // бинарные кадры протокол не использует
      if (RoaWs.onMessage) RoaWs.callString(RoaWs.onMessage, id, event.data);
    };
    socket.onerror = function () {
      if (RoaWs.onError) RoaWs.callString(RoaWs.onError, id, 'WebSocket error');
    };
    socket.onclose = function (event) {
      if (RoaWs.onClose) RoaWs.callClose(RoaWs.onClose, id, event.code || 0, event.reason || '');
      delete RoaWs.sockets[id];
    };
    return id;
  },

  RoaWs_Send: function (id, textPtr) {
    var socket = RoaWs.sockets[id];
    if (!socket || socket.readyState !== 1) return;
    socket.send(UTF8ToString(textPtr));
  },

  RoaWs_Close: function (id) {
    var socket = RoaWs.sockets[id];
    if (!socket) return;
    try { socket.close(1000, 'client shutdown'); } catch (e) {}
    delete RoaWs.sockets[id];
  },

  // 0 — connecting, 1 — open, 2 — closing, 3 — closed/нет
  RoaWs_State: function (id) {
    var socket = RoaWs.sockets[id];
    return socket ? socket.readyState : 3;
  }
};

autoAddDeps(RoaWebSocketPlugin, '$RoaWs');
mergeInto(LibraryManager.library, RoaWebSocketPlugin);
