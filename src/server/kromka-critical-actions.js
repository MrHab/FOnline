'use strict';

const DEFAULT_LIMIT = 128;

function cleanToken(value = '', limit = 96) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
}

function criticalActionFingerprint(data = {}, fields = []) {
  const source = data && typeof data === 'object' ? data : {};
  return JSON.stringify(fields.reduce((out, field) => {
    out[field] = stableValue(source[field]);
    return out;
  }, {})).slice(0, 640);
}

function compactCriticalActionResult(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of ['action', 'targetId', 'tradeId', 'message', 'completed', 'transferred']) {
    const value = source[key];
    if (typeof value === 'string') out[key] = value.slice(0, 180);
    else if (typeof value === 'boolean') out[key] = value;
    else if (Number.isFinite(Number(value))) out[key] = Number(value);
  }
  return out;
}

function sanitizeCriticalActionLedger(input = [], limit = DEFAULT_LIMIT) {
  const max = Math.max(16, Math.min(256, Math.floor(Number(limit || DEFAULT_LIMIT))));
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map(row => {
      const kind = cleanToken(row?.kind, 48);
      const requestId = cleanToken(row?.requestId);
      if (!kind || !requestId) return null;
      const key = `${kind}:${requestId}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        kind,
        requestId,
        fingerprint: String(row?.fingerprint || '').slice(0, 640),
        result: compactCriticalActionResult(row?.result),
        t: Math.max(0, Math.floor(Number(row?.t || 0)))
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
    .slice(0, max);
}

function beginCriticalAction(player = {}, kind = '', data = {}, fields = [], now = Date.now()) {
  const requestId = cleanToken(data?.requestId || data?.transactionId || '');
  const normalizedKind = cleanToken(kind, 48);
  if (!normalizedKind) return { ok: false, error: 'Сервер: не указан тип критического действия.' };
  // Старые сборки клиента остаются совместимыми, но актуальная Unity-сборка
  // всегда присылает requestId и получает replay-safe семантику после reconnect.
  if (!requestId) return { ok: true, replay: false, untracked: true };
  player.criticalActionLedger = sanitizeCriticalActionLedger(player.criticalActionLedger);
  const fingerprint = criticalActionFingerprint(data, fields);
  const existing = player.criticalActionLedger.find(row => row.kind === normalizedKind && row.requestId === requestId);
  if (!existing) return { ok: true, replay: false, requestId, kind: normalizedKind, fingerprint, now };
  if (existing.fingerprint !== fingerprint) {
    return { ok: false, error: 'Сервер: id критического действия уже использован с другими данными.' };
  }
  return { ok: true, replay: true, result: { ok: true, reused: true, ...(existing.result || {}) } };
}

function commitCriticalAction(player = {}, transaction = {}, result = {}) {
  if (!transaction?.ok || transaction.replay || transaction.untracked || !transaction.requestId || !transaction.kind) return result;
  const row = {
    kind: transaction.kind,
    requestId: transaction.requestId,
    fingerprint: transaction.fingerprint || '',
    result: compactCriticalActionResult(result),
    t: Math.max(0, Math.floor(Number(transaction.now || Date.now())))
  };
  player.criticalActionLedger = sanitizeCriticalActionLedger([row, ...(player.criticalActionLedger || [])]);
  return result;
}

module.exports = {
  beginCriticalAction,
  commitCriticalAction,
  criticalActionFingerprint,
  sanitizeCriticalActionLedger
};
