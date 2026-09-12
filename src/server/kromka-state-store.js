'use strict';

function createKromkaStateStore(options = {}) {
  const fs = options.fs;
  const writeJsonAtomic = options.writeJsonAtomic;
  const journalFile = String(options.journalFile || '');
  const usersFile = String(options.usersFile || '');
  const savesFile = String(options.savesFile || '');
  if (!fs || typeof writeJsonAtomic !== 'function' || !journalFile || !usersFile || !savesFile) {
    throw new TypeError('fs, writeJsonAtomic, journalFile, usersFile and savesFile are required');
  }

  let busy = false;
  const stats = { commits: 0, recoveries: 0, errors: 0, lastCommitMs: 0, lastRecoveredAt: 0 };

  function removeJournal() {
    if (fs.existsSync(journalFile)) fs.unlinkSync(journalFile);
  }

  function replay(entry) {
    if (Object.prototype.hasOwnProperty.call(entry, 'users')) writeJsonAtomic(usersFile, entry.users);
    if (Object.prototype.hasOwnProperty.call(entry, 'saves')) writeJsonAtomic(savesFile, entry.saves);
  }

  function recover() {
    if (!fs.existsSync(journalFile)) return false;
    const entry = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    if (!entry || entry.schema !== 'kromka-state-transaction-v1') {
      throw new Error('Unsupported Kromka state transaction journal');
    }
    replay(entry);
    removeJournal();
    stats.recoveries += 1;
    stats.lastRecoveredAt = Date.now();
    return true;
  }

  function commit(snapshot = {}, scope = 'runtime') {
    if (busy) throw new Error('Kromka state transaction is already in progress');
    const hasUsers = Object.prototype.hasOwnProperty.call(snapshot, 'users');
    const hasSaves = Object.prototype.hasOwnProperty.call(snapshot, 'saves');
    if (!hasUsers && !hasSaves) return false;
    const startedAt = Date.now();
    const entry = {
      schema: 'kromka-state-transaction-v1',
      transactionId: `${startedAt}-${stats.commits + 1}`,
      createdAt: startedAt,
      scope: String(scope || 'runtime').slice(0, 64)
    };
    if (hasUsers) entry.users = snapshot.users;
    if (hasSaves) entry.saves = snapshot.saves;
    busy = true;
    try {
      writeJsonAtomic(journalFile, entry);
      replay(entry);
      removeJournal();
      stats.commits += 1;
      stats.lastCommitMs = Math.max(0, Date.now() - startedAt);
      return true;
    } catch (error) {
      stats.errors += 1;
      throw error;
    } finally {
      busy = false;
    }
  }

  function metrics() {
    return {
      commits: stats.commits,
      recoveries: stats.recoveries,
      errors: stats.errors,
      lastCommitMs: stats.lastCommitMs,
      lastRecoveredAt: stats.lastRecoveredAt,
      pendingRecovery: fs.existsSync(journalFile),
      busy
    };
  }

  return { commit, metrics, recover };
}

module.exports = { createKromkaStateStore };
