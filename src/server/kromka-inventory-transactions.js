'use strict';

const DEFAULT_LIMIT = 96;

function cleanToken(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
}

function cleanKind(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

function compactResult(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  for (const key of [
    'action', 'direction', 'itemId', 'itemRuntimeId', 'recipeId', 'machineId',
    'quantity', 'moved', 'crafted', 'spent', 'received', 'outputItemId', 'outputQuantity'
  ]) {
    const value = source[key];
    if (typeof value === 'string') result[key] = value.slice(0, 120);
    else if (Number.isFinite(Number(value))) result[key] = Number(value);
  }
  return result;
}

function sanitizeInventoryMutationLedger(input = [], options = {}) {
  const limit = Math.max(8, Math.min(256, Math.floor(Number(options.limit || DEFAULT_LIMIT))));
  const source = Array.isArray(input) ? input : [];
  const seen = new Set();
  return source
    .map(row => {
      const kind = cleanKind(row?.kind);
      const requestId = cleanToken(row?.requestId);
      if (!kind || !requestId) return null;
      const key = `${kind}:${requestId}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        kind,
        requestId,
        fingerprint: String(row?.fingerprint || '').slice(0, 320),
        result: compactResult(row?.result),
        t: Math.max(0, Math.floor(Number(row?.t || 0)))
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);
}

function inventoryMutationFingerprint(data = {}, fields = []) {
  const source = data && typeof data === 'object' ? data : {};
  return fields.map(field => {
    const value = source[field];
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '');
  }).join('\u001f').slice(0, 320);
}

function beginInventoryMutation(player = {}, kind = '', data = {}, fields = [], now = Date.now()) {
  const requestId = cleanToken(data?.requestId || data?.transactionId || '');
  const cleanMutationKind = cleanKind(kind);
  if (!requestId || !cleanMutationKind) {
    return { ok: false, error: 'Сервер: отсутствует id инвентарной операции.' };
  }
  player.inventoryMutationLedger = sanitizeInventoryMutationLedger(player.inventoryMutationLedger);
  const fingerprint = inventoryMutationFingerprint(data, fields);
  const existing = player.inventoryMutationLedger.find(row => (
    row.kind === cleanMutationKind && row.requestId === requestId
  ));
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return { ok: false, error: 'Сервер: id инвентарной операции уже использован с другими данными.' };
    }
    return {
      ok: true,
      replay: true,
      requestId,
      kind: cleanMutationKind,
      result: { ...(existing.result || {}), ok: true, reused: true }
    };
  }
  return { ok: true, replay: false, requestId, kind: cleanMutationKind, fingerprint, now };
}

function commitInventoryMutation(player = {}, transaction = {}, result = {}, options = {}) {
  if (!transaction?.ok || transaction.replay || !transaction.requestId || !transaction.kind) return result;
  const row = {
    kind: transaction.kind,
    requestId: transaction.requestId,
    fingerprint: transaction.fingerprint || '',
    result: compactResult(result),
    t: Math.max(0, Math.floor(Number(transaction.now || Date.now())))
  };
  player.inventoryMutationLedger = sanitizeInventoryMutationLedger(
    [row, ...(Array.isArray(player.inventoryMutationLedger) ? player.inventoryMutationLedger : [])],
    options
  );
  return result;
}

module.exports = {
  beginInventoryMutation,
  cleanToken,
  commitInventoryMutation,
  compactResult,
  inventoryMutationFingerprint,
  sanitizeInventoryMutationLedger
};
