'use strict';

const fs = require('fs');
const path = require('path');

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function safeId(value, fallback = 'id') {
  const id = String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return id || fallback;
}

function safeTransferIdentity(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 180);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seededRandom(seed = '') {
  let h = 2166136261;
  const text = String(seed || 'seed');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function rand() {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function backupUnreadableJson(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.corrupt-${stamp}`;
    fs.copyFileSync(file, backup);
    return backup;
  } catch (error) {
    console.error('Failed to backup unreadable wasteland simulation JSON:', file, error);
    return '';
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return clone(fallback);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const backup = backupUnreadableJson(file);
    console.error(
      'Failed to read wasteland simulation JSON:',
      file,
      backup ? `backup: ${backup}` : 'backup failed',
      error
    );
    return clone(fallback);
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

module.exports = {
  clamp,
  clone,
  readJson,
  safeId,
  safeTransferIdentity,
  seededRandom,
  writeJsonAtomic
};
