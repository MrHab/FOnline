'use strict';

function createCoalescedWriter(write, options = {}) {
  if (typeof write !== 'function') throw new TypeError('write must be a function');
  const delayMs = Math.max(0, Math.floor(Number(options.delayMs) || 0));
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const onDeferredError = typeof options.onDeferredError === 'function'
    ? options.onDeferredError
    : () => {};
  let timer = null;

  function clearPending() {
    if (timer === null) return false;
    clearTimer(timer);
    timer = null;
    return true;
  }

  function runDeferred() {
    timer = null;
    try {
      write();
    } catch (error) {
      onDeferredError(error);
    }
  }

  function schedule() {
    if (timer !== null) return false;
    timer = setTimer(runDeferred, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return true;
  }

  function flush() {
    clearPending();
    return write();
  }

  return {
    cancel: clearPending,
    flush,
    pending: () => timer !== null,
    schedule
  };
}

module.exports = {
  createCoalescedWriter
};
