(function attachRealmSaveGenerationDrain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.RealmSaveGenerationDrain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRealmSaveGenerationDrainApi() {
  'use strict';

  function createSaveGenerationDrain(options = {}) {
    if (typeof options.capture !== 'function') throw new TypeError('capture must be a function');
    if (typeof options.persist !== 'function') throw new TypeError('persist must be a function');

    let requestedGeneration = 0;
    let committedGeneration = 0;
    let runner = null;
    let lastError = null;
    const maxPassesPerDrain = Math.max(1, Math.floor(Number(options.maxPassesPerDrain || 2)));

    function notify(name, payload) {
      const callback = options[name];
      if (typeof callback !== 'function') return;
      try { callback(payload); } catch (_) {}
    }

    function markDirty() {
      requestedGeneration += 1;
      return requestedGeneration;
    }

    async function runDrain() {
      let passes = 0;
      while (committedGeneration < requestedGeneration && passes < maxPassesPerDrain) {
        passes += 1;
        // Coalesce every queued mutation into the newest generation. Capturing
        // here, rather than in markDirty(), keeps the pending snapshot fresh and
        // makes the request body immutable immediately before it is sent.
        const generation = requestedGeneration;
        let job;
        try {
          job = options.capture(generation);
        } catch (error) {
          lastError = error;
          notify('onFailure', { generation, error });
          return false;
        }
        if (!job) {
          const error = new Error('Save capture returned no job.');
          lastError = error;
          notify('onFailure', { generation, error });
          return false;
        }

        let result;
        try {
          result = await options.persist(job, generation);
        } catch (error) {
          lastError = error;
          notify('onFailure', { generation, error, job });
          return false;
        }
        const ok = result === true || !!(result && result.ok === true);
        if (!ok) {
          const error = result?.error instanceof Error
            ? result.error
            : new Error(String(result?.error || 'Save persistence failed.'));
          lastError = error;
          notify('onFailure', { generation, error, job, result });
          // Do not retry in this drain. The caller keeps the state dirty and a
          // later autosave/user flush starts one bounded retry.
          return false;
        }

        committedGeneration = generation;
        lastError = null;
        notify('onCommit', { generation, job, result });
      }
      // A continuous producer (for example world-map travel) must not keep one
      // drain alive forever and turn it into a back-to-back HTTP save loop.
      // Leave later generations dirty; the bounded autosave scheduler or an
      // explicit frozen context transition will start the next drain.
      return committedGeneration >= requestedGeneration;
    }

    function drain() {
      if (runner) return runner;
      if (committedGeneration >= requestedGeneration) return Promise.resolve(true);
      runner = Promise.resolve()
        .then(runDrain)
        .finally(() => {
          runner = null;
        });
      return runner;
    }

    function snapshot() {
      return {
        requestedGeneration,
        committedGeneration,
        running: !!runner,
        dirty: committedGeneration < requestedGeneration,
        lastError
      };
    }

    return {
      markDirty,
      drain,
      snapshot,
      isRunning: () => !!runner
    };
  }

  return { createSaveGenerationDrain };
});
