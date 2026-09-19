'use strict';

// Каналы зон мира. Зона — общая комната на всех, но не больше мягкого предела
// игроков: следующие попадают в копию той же зоны — канал `z_CC_RR#ch2`,
// `#ch3`… Первый канал — сама зона без суффикса, поэтому сохранения, билеты и
// id комнаты у одиночек не меняются. Модуль чистый: сколько людей в канале,
// ему говорит вызывающий.

const ZONE_CHANNEL_SOFT_CAP = 40;
const ZONE_CHANNEL_MAX = 24;
// Пустая зона засыпает через 10 минут: комната уходит из памяти, а то, что
// игроки в ней изменили (вскрытые тайники, выработанные ресурсы), ждёт её
// пробуждения в «сонном» снимке до конца игрового дня.
const ZONE_SLEEP_AFTER_MS = 10 * 60 * 1000;

function channelRoomId(zoneId, channel = 1) {
  const n = Math.max(1, Math.floor(Number(channel) || 1));
  return n === 1 ? String(zoneId) : `${zoneId}#ch${n}`;
}

/** Номер канала комнаты зоны или 0, если id не канал этой зоны. */
function channelOf(roomId, zoneId) {
  const id = String(roomId || '');
  const zone = String(zoneId || '');
  if (!zone) return 0;
  if (id === zone) return 1;
  if (!id.startsWith(`${zone}#ch`)) return 0;
  const tail = id.slice(zone.length + 3);
  if (!/^[1-9]\d{0,2}$/.test(tail)) return 0;
  const n = Number(tail);
  return n >= 2 && n <= ZONE_CHANNEL_MAX ? n : 0;
}

/**
 * Канал для входящего: предпочтительный (канал лидера группы или сохранённый),
 * если в нём есть место, иначе самый младший неполный, иначе новый.
 * occupancy(roomId) — сколько живых игроков сейчас в комнате.
 */
function pickChannel({ zoneId, occupancy, prefer = '', cap = ZONE_CHANNEL_SOFT_CAP, max = ZONE_CHANNEL_MAX } = {}) {
  const count = roomId => Math.max(0, Math.floor(Number(occupancy(roomId)) || 0));
  const preferred = channelOf(prefer, zoneId);
  if (preferred && count(channelRoomId(zoneId, preferred)) < cap) return channelRoomId(zoneId, preferred);
  let least = 1;
  let leastCount = Infinity;
  for (let n = 1; n <= max; n++) {
    const people = count(channelRoomId(zoneId, n));
    if (people < cap) return channelRoomId(zoneId, n);
    if (people < leastCount) { least = n; leastCount = people; }
  }
  // Все каналы полны: мягкий предел уступает — в наименее людный.
  return channelRoomId(zoneId, least);
}

module.exports = {
  ZONE_CHANNEL_MAX,
  ZONE_CHANNEL_SOFT_CAP,
  ZONE_SLEEP_AFTER_MS,
  channelOf,
  channelRoomId,
  pickChannel
};
