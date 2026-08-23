'use strict';

const crypto = require('crypto');

const GUEST_LOGIN_PREFIX = 'guest_';

function guestDeviceHash(deviceId = '') {
  const normalized = String(deviceId || '').trim();
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function guestLoginForDevice(deviceId = '') {
  const hash = guestDeviceHash(deviceId);
  return hash ? `${GUEST_LOGIN_PREFIX}${hash.slice(0, 24)}` : '';
}

function guestDisplayNameForDevice(deviceId = '') {
  const hash = guestDeviceHash(deviceId);
  return hash ? `Странник-${hash.slice(24, 28).toUpperCase()}` : 'Странник';
}

function guestUserMatchesDevice(user = null, deviceId = '') {
  const expected = guestDeviceHash(deviceId);
  const stored = String(user?.guestDeviceHash || '');
  if (!user?.isGuest || expected.length !== 64 || stored.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(stored, 'utf8'), Buffer.from(expected, 'utf8'));
}

module.exports = {
  GUEST_LOGIN_PREFIX,
  guestDeviceHash,
  guestDisplayNameForDevice,
  guestLoginForDevice,
  guestUserMatchesDevice
};
