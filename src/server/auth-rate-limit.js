'use strict';

const net = require('net');

const DEFAULT_AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_AUTH_RATE_IDENTITY_MAX_ATTEMPTS = 20;
const DEFAULT_AUTH_RATE_IP_MAX_ATTEMPTS = 60;
const DEFAULT_AUTH_RATE_MAX_BUCKETS = 10000;

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizeAuthRateLimitConfig(source = {}) {
  const windowMs = boundedInteger(
    source.windowMs ?? source.AUTH_RATE_WINDOW_MS,
    DEFAULT_AUTH_RATE_WINDOW_MS,
    60 * 1000,
    24 * 60 * 60 * 1000
  );
  const identityMaxAttempts = boundedInteger(
    source.identityMaxAttempts ?? source.AUTH_RATE_MAX_ATTEMPTS,
    DEFAULT_AUTH_RATE_IDENTITY_MAX_ATTEMPTS,
    5,
    10000
  );
  const defaultIpMaximum = Math.max(
    DEFAULT_AUTH_RATE_IP_MAX_ATTEMPTS,
    identityMaxAttempts * 3
  );
  const ipMaxAttempts = boundedInteger(
    source.ipMaxAttempts ?? source.AUTH_RATE_IP_MAX_ATTEMPTS,
    defaultIpMaximum,
    identityMaxAttempts,
    100000
  );
  const maxBuckets = boundedInteger(
    source.maxBuckets ?? source.AUTH_RATE_MAX_BUCKETS,
    DEFAULT_AUTH_RATE_MAX_BUCKETS,
    100,
    1000000
  );
  return Object.freeze({
    windowMs,
    identityMaxAttempts,
    ipMaxAttempts,
    maxBuckets
  });
}

function normalizeClientAddress(value) {
  let address = String(value || '').trim().toLowerCase();
  if (address.startsWith('::ffff:') && net.isIP(address.slice(7)) === 4) {
    address = address.slice(7);
  }
  const zoneIndex = address.indexOf('%');
  if (zoneIndex > 0 && net.isIP(address.slice(0, zoneIndex)) === 6) {
    address = address.slice(0, zoneIndex);
  }
  return address.slice(0, 128) || 'unknown';
}

function isTrustedProxyAddress(value) {
  const address = normalizeClientAddress(value);
  if (address === '::1') return true;
  if (net.isIP(address) !== 4) return false;
  const firstOctet = Number(address.split('.')[0]);
  return firstOctet === 127;
}

function clientAddressFromRequest(req = {}) {
  return normalizeClientAddress(req.ip || req.socket?.remoteAddress || '');
}

function normalizeAuthIdentity(value) {
  return String(value || '').trim().toLowerCase().slice(0, 256) || '-';
}

function createAuthRateLimiter(options = {}) {
  const config = normalizeAuthRateLimitConfig(options);
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const buckets = new Map();
  let nextSweepAt = 0;

  function pruneExpired(now = clock(), force = false) {
    if (!force && now < nextSweepAt) return 0;
    let removed = 0;
    for (const [key, bucket] of buckets) {
      if (!bucket || bucket.resetAt <= now) {
        buckets.delete(key);
        removed += 1;
      }
    }
    nextSweepAt = now + Math.min(config.windowMs, 60 * 1000);
    return removed;
  }

  function consumeBucket(key, limit, now) {
    let bucket = buckets.get(key);
    if (bucket && bucket.resetAt <= now) {
      buckets.delete(key);
      bucket = null;
    }
    if (!bucket) {
      if (buckets.size >= config.maxBuckets) pruneExpired(now, true);
      if (buckets.size >= config.maxBuckets) {
        return {
          allowed: false,
          capacityLimited: true,
          attempts: 0,
          resetAt: now + config.windowMs
        };
      }
      bucket = { attempts: 0, resetAt: now + config.windowMs };
      buckets.set(key, bucket);
    }
    bucket.attempts += 1;
    return {
      allowed: bucket.attempts <= limit,
      capacityLimited: false,
      attempts: bucket.attempts,
      resetAt: bucket.resetAt
    };
  }

  function consume(addressValue, identityValue) {
    const now = clock();
    pruneExpired(now);
    const address = normalizeClientAddress(addressValue);
    const identity = normalizeAuthIdentity(identityValue);
    const ipResult = consumeBucket(`ip:${address}`, config.ipMaxAttempts, now);
    if (!ipResult.allowed) {
      return {
        allowed: false,
        limitedBy: ipResult.capacityLimited ? 'capacity' : 'ip',
        retryAfterSec: Math.max(1, Math.ceil((ipResult.resetAt - now) / 1000))
      };
    }
    const identityResult = consumeBucket(
      `identity:${address}:${identity}`,
      config.identityMaxAttempts,
      now
    );
    if (!identityResult.allowed) {
      return {
        allowed: false,
        limitedBy: identityResult.capacityLimited ? 'capacity' : 'identity',
        retryAfterSec: Math.max(1, Math.ceil((identityResult.resetAt - now) / 1000))
      };
    }
    return {
      allowed: true,
      limitedBy: '',
      retryAfterSec: 0
    };
  }

  function clearIdentity(addressValue, identityValue) {
    const address = normalizeClientAddress(addressValue);
    const identity = normalizeAuthIdentity(identityValue);
    return buckets.delete(`identity:${address}:${identity}`);
  }

  function snapshot() {
    return {
      config,
      size: buckets.size,
      buckets: Array.from(buckets.entries())
        .map(([key, value]) => ({ key, attempts: value.attempts, resetAt: value.resetAt }))
        .sort((a, b) => a.key.localeCompare(b.key))
    };
  }

  return Object.freeze({
    clearIdentity,
    consume,
    pruneExpired,
    snapshot
  });
}

module.exports = {
  DEFAULT_AUTH_RATE_IDENTITY_MAX_ATTEMPTS,
  DEFAULT_AUTH_RATE_IP_MAX_ATTEMPTS,
  DEFAULT_AUTH_RATE_MAX_BUCKETS,
  DEFAULT_AUTH_RATE_WINDOW_MS,
  clientAddressFromRequest,
  createAuthRateLimiter,
  isTrustedProxyAddress,
  normalizeAuthIdentity,
  normalizeAuthRateLimitConfig,
  normalizeClientAddress
};
