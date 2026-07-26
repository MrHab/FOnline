'use strict';

const crypto = require('crypto');

const MIN_PASSWORD_RESET_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function normalizePasswordResetTtlMs(value, fallback = DEFAULT_PASSWORD_RESET_TTL_MS) {
  const parsed = Number(value);
  const parsedFallback = Number(fallback);
  const ttlMs = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : (Number.isFinite(parsedFallback) && parsedFallback > 0
      ? parsedFallback
      : DEFAULT_PASSWORD_RESET_TTL_MS);
  return Math.max(MIN_PASSWORD_RESET_TTL_MS, Math.floor(ttlMs));
}

function russianCount(value, one, few, many) {
  const integer = Math.abs(Math.trunc(Number(value) || 0));
  const lastTwo = integer % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return `${integer} ${many}`;
  const last = integer % 10;
  if (last === 1) return `${integer} ${one}`;
  if (last >= 2 && last <= 4) return `${integer} ${few}`;
  return `${integer} ${many}`;
}

function formatPasswordResetTtl(ttlMs) {
  const totalMinutes = Math.max(1, Math.floor(normalizePasswordResetTtlMs(ttlMs) / (60 * 1000)));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(russianCount(days, 'день', 'дня', 'дней'));
  if (hours) parts.push(russianCount(hours, 'час', 'часа', 'часов'));
  if (minutes) parts.push(russianCount(minutes, 'минуту', 'минуты', 'минут'));
  return parts.join(' ');
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function passwordResetTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function buildPasswordResetEmail({ publicGameUrl, login, token, ttlMs }) {
  const resetUrl = new URL(String(publicGameUrl || ''));
  resetUrl.searchParams.set('resetToken', String(token || ''));
  resetUrl.searchParams.set('login', String(login || ''));
  const resetUrlText = resetUrl.toString();
  const duration = formatPasswordResetTtl(ttlMs);
  const expiryText = `Ссылка действует ${duration}.`;
  return {
    subject: 'Realm of Ashes — восстановление пароля',
    text: `Для установки нового пароля откройте ссылку:\n${resetUrlText}\n\n${expiryText} Если вы не запрашивали восстановление, проигнорируйте письмо.`,
    html: `<p>Для установки нового пароля откройте ссылку:</p><p><a href="${escapeHtmlAttribute(resetUrlText)}">Восстановить пароль</a></p><p>${expiryText} Если вы не запрашивали восстановление, проигнорируйте письмо.</p>`
  };
}

module.exports = {
  DEFAULT_PASSWORD_RESET_TTL_MS,
  MIN_PASSWORD_RESET_TTL_MS,
  buildPasswordResetEmail,
  formatPasswordResetTtl,
  normalizePasswordResetTtlMs,
  passwordResetTokenHash
};
