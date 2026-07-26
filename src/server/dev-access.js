'use strict';

const crypto = require('crypto');

const DEV_API_MODES = new Set(['disabled', 'local', 'token']);
const DEV_LOCAL_HEADER = 'x-dev-local';
const DEV_LOCAL_HEADER_VALUE = '1';
const MIN_DEV_TOKEN_BYTES = 32;
const PROXY_HEADERS = [
  'forwarded',
  'x-forwarded-*',
  'x-real-ip'
];

function normalizeDevApiMode(value = '') {
  const mode = String(value || 'disabled').trim().toLowerCase() || 'disabled';
  if (!DEV_API_MODES.has(mode)) {
    throw new Error(`Invalid DEV_API_MODE "${mode}". Expected disabled, local, or token.`);
  }
  return mode;
}

function isLoopbackAddress(address = '') {
  const value = String(address || '').trim().toLowerCase();
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1';
}

function requestAddress(req = {}) {
  return String(req.socket?.remoteAddress || req.ip || '').trim().toLowerCase();
}

function requestHeader(req = {}, name = '') {
  return String(req.headers?.[String(name || '').toLowerCase()] || '').trim();
}

function requestHost(req = {}) {
  return requestHeader(req, 'host').toLowerCase();
}

function isLoopbackHostname(hostname = '') {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]';
}

function requestHostIsLoopback(req = {}) {
  const host = requestHost(req);
  if (!host) return false;
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch (_) {
    return false;
  }
}

function requestOriginMatchesHost(req = {}) {
  const rawOrigin = requestHeader(req, 'origin');
  if (!rawOrigin) return true;
  try {
    const origin = new URL(rawOrigin);
    return (origin.protocol === 'http:' || origin.protocol === 'https:')
      && isLoopbackHostname(origin.hostname)
      && origin.host.toLowerCase() === requestHost(req);
  } catch (_) {
    return false;
  }
}

function requestHasLocalProof(req = {}) {
  return requestHeader(req, DEV_LOCAL_HEADER) === DEV_LOCAL_HEADER_VALUE;
}

function requestHasSameOriginBrowserContext(req = {}) {
  const fetchSite = requestHeader(req, 'sec-fetch-site').toLowerCase();
  return requestOriginMatchesHost(req) && (!fetchSite || fetchSite === 'same-origin');
}

function requestHasProxyHeaders(req = {}) {
  const headers = req.headers && typeof req.headers === 'object' ? req.headers : {};
  return Object.keys(headers).some(rawName => {
    const name = String(rawName || '').trim().toLowerCase();
    return name === 'forwarded' || name === 'x-real-ip' || name.startsWith('x-forwarded-');
  });
}

function requestIsMutation(req = {}) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').trim().toUpperCase());
}

function requestHasJsonContentType(req = {}) {
  return requestHeader(req, 'content-type').split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function tokenMatches(expected = '', supplied = '') {
  const wanted = String(expected || '');
  const received = String(supplied || '');
  const wantedBytes = Buffer.from(wanted);
  const receivedBytes = Buffer.from(received);
  if (!wantedBytes.length || !receivedBytes.length || wantedBytes.length !== receivedBytes.length) return false;
  return crypto.timingSafeEqual(receivedBytes, wantedBytes);
}

function createDevAccessPolicy(options = {}) {
  const mode = normalizeDevApiMode(options.mode);
  const nodeEnv = String(options.nodeEnv || '').trim().toLowerCase();
  const token = String(options.token || '').trim();
  if (mode === 'local' && nodeEnv === 'production') {
    throw new Error('DEV_API_MODE=local is forbidden when NODE_ENV=production.');
  }
  if (mode === 'token' && Buffer.byteLength(token, 'utf8') < MIN_DEV_TOKEN_BYTES) {
    throw new Error(`DEV_API_MODE=token requires DEV_ADMIN_TOKEN with at least ${MIN_DEV_TOKEN_BYTES} UTF-8 bytes.`);
  }
  return Object.freeze({
    mode,
    nodeEnv,
    token
  });
}

function authorizeDevRequest(policy = {}, req = {}) {
  if (policy.mode === 'disabled') {
    return { allowed: false, status: 404, error: 'Маршрут не найден.' };
  }
  if (policy.mode === 'local') {
    if (requestHasProxyHeaders(req)
      || !isLoopbackAddress(requestAddress(req))
      || !requestHostIsLoopback(req)
      || !requestHasLocalProof(req)
      || !requestHasSameOriginBrowserContext(req)) {
      return { allowed: false, status: 403, error: 'Локальные инструменты мира недоступны через proxy, сеть или стороннюю страницу.' };
    }
    return { allowed: true, status: 200, error: '' };
  }
  const supplied = String(req.headers?.['x-dev-token'] || '').trim();
  if (policy.mode === 'token' && tokenMatches(policy.token, supplied)) {
    return { allowed: true, status: 200, error: '' };
  }
  return { allowed: false, status: 403, error: 'Доступ к инструментам мира запрещён.' };
}

function createDevAccessMiddleware(policy = {}) {
  return function requireDevAccess(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    const result = authorizeDevRequest(policy, req);
    if (result.allowed && requestIsMutation(req) && !requestHasJsonContentType(req)) {
      return res.status(415).json({ ok: false, error: 'Изменения dev API принимаются только как application/json.' });
    }
    if (result.allowed) return next();
    return res.status(result.status).json({ ok: false, error: result.error });
  };
}

function devEditorIsAvailable(policy = {}) {
  return policy.mode !== 'disabled' && policy.nodeEnv !== 'production';
}

module.exports = {
  DEV_LOCAL_HEADER,
  DEV_LOCAL_HEADER_VALUE,
  DEV_API_MODES,
  MIN_DEV_TOKEN_BYTES,
  PROXY_HEADERS,
  authorizeDevRequest,
  createDevAccessMiddleware,
  createDevAccessPolicy,
  devEditorIsAvailable,
  isLoopbackHostname,
  isLoopbackAddress,
  normalizeDevApiMode,
  requestHasJsonContentType,
  requestHasLocalProof,
  requestHasProxyHeaders,
  requestHasSameOriginBrowserContext,
  requestHostIsLoopback,
  requestIsMutation,
  requestOriginMatchesHost,
  tokenMatches
};
