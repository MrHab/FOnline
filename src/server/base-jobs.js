'use strict';

const { randomUUID } = require('node:crypto');

function profile(catalog = {}, typeId = '') {
  return (catalog.jobs || []).find(row => row.id === String(typeId || '')) || null;
}

function startBaseJob(base = {}, typeId = '', catalog = {}, inventoryQty = () => 0, now = Date.now()) {
  const job = profile(catalog, typeId);
  if (!job) return { ok: false, error: 'Неизвестное производство.' };
  if (!(base.objects || []).some(row => row.typeId === job.stationTypeId)) return { ok: false, error: 'На базе нет подходящего станка.' };
  if ((base.jobs || []).filter(row => !row.claimed).length >= 4) return { ok: false, error: 'Очередь производства заполнена.' };
  if (!Object.entries(job.input || {}).every(([id, qty]) => inventoryQty(id) >= Number(qty || 0))) return { ok: false, error: 'Не хватает сырья.' };
  const record = { id: `base_job_${randomUUID()}`, typeId: job.id, startedAt: Number(now), completesAt: Number(now) + Number(job.durationMs || 0), claimed: false };
  base.jobs = [...(base.jobs || []), record];
  base.updatedAt = Number(now);
  return { ok: true, record, input: { ...(job.input || {}) } };
}

function claimBaseJob(base = {}, jobId = '', catalog = {}, now = Date.now()) {
  const record = (base.jobs || []).find(row => row.id === String(jobId || ''));
  if (!record || record.claimed) return { ok: false, error: 'Производство уже получено или не найдено.' };
  if (Number(record.completesAt || 0) > Number(now)) return { ok: false, error: 'Производство ещё не завершено.' };
  const job = profile(catalog, record.typeId);
  if (!job) return { ok: false, error: 'Профиль производства удалён.' };
  record.claimed = true;
  base.updatedAt = Number(now);
  return { ok: true, output: { ...(job.output || {}) }, record };
}

module.exports = { claimBaseJob, startBaseJob };
