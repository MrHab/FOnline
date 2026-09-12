'use strict';

const DAY = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const clean = (value = '', max = 96) => String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, max);

function sanitizeSiegeStore(input = {}) {
  const store = input && typeof input === 'object' ? input : {};
  if (!store.events || typeof store.events !== 'object') store.events = {};
  store.version = 1;
  return store;
}

function parseWindow(value = '') {
  const match = /^([A-Z]{3})\s+(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match || DAY[match[1]] === undefined) return null;
  const hour = Number(match[2]); const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;
  return { day: DAY[match[1]], dayName: match[1], hour, minute, label: `${match[1]} ${match[2]}:${match[3]}` };
}

function occurrenceAtOrAfter(windowText, after = Date.now()) {
  const parsed = parseWindow(windowText);
  if (!parsed) return 0;
  const date = new Date(Number(after));
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let deltaDays = (parsed.day - date.getUTCDay() + 7) % 7;
  let candidate = startOfDay + deltaDays * 86400000 + parsed.hour * 3600000 + parsed.minute * 60000;
  if (candidate < Number(after)) candidate += 7 * 86400000;
  return candidate;
}

function upcomingWindows(catalog = {}, now = Date.now(), horizonMs = 15 * 86400000) {
  const end = Number(now) + Math.max(86400000, Number(horizonMs || 0));
  const rows = [];
  for (const base of catalog.bases || []) {
    for (const label of base.siegeWindowsUtc || []) {
      let startAt = occurrenceAtOrAfter(label, now);
      while (startAt && startAt <= end) {
        rows.push({
          id: siegeEventId(base.id, startAt), baseId: base.id, locationId: base.locationId,
          displayName: base.displayName, windowUtc: label, startAt
        });
        startAt += 7 * 86400000;
      }
    }
  }
  return rows.sort((a, b) => a.startAt - b.startAt || a.baseId.localeCompare(b.baseId));
}

function nextChallengeWindow(base = {}, now = Date.now(), config = {}) {
  const earliest = Number(now) + Number(config.announceLeadMs || 86400000);
  return (base.siegeWindowsUtc || []).map(label => ({ label, startAt: occurrenceAtOrAfter(label, earliest) }))
    .filter(row => row.startAt).sort((a, b) => a.startAt - b.startAt)[0] || null;
}

function siegeEventId(baseId = '', startAt = 0) {
  return `siege_${clean(baseId, 48)}_${Math.floor(Number(startAt || 0))}`;
}

function fixedRoomId(baseId = '', eventId = '') {
  return `clanSiege#${clean(baseId, 48)}#${clean(eventId, 96)}`.slice(0, 190);
}

module.exports = { fixedRoomId, nextChallengeWindow, occurrenceAtOrAfter, parseWindow, sanitizeSiegeStore, siegeEventId, upcomingWindows };
