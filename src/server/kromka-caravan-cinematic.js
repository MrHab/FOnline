'use strict';

const CINEMATIC_ID = 'caravan_departure_ambush';
const HOLD_MS = 125000; // 60 s location + 30 s cast load + 25 s film, with a bounded margin.

function isPrivateCaravanRoom(room) {
  return room?.encounterId === 'kromka_caravan_twelve_ambush'
    && String(room.id || '').startsWith('randomRuinedRoad#intro_');
}

function beginCaravanCinematic(room, player, cinematicId, now = Date.now()) {
  if (!isPrivateCaravanRoom(room) || cinematicId !== CINEMATIC_ID) return false;
  room.caravanCinematicOwner = String(player.characterId || player.id || '');
  room.caravanCinematicUntil = now + HOLD_MS;
  return true;
}

function caravanCinematicHeld(room, now = Date.now()) {
  return isPrivateCaravanRoom(room) && Number(room.caravanCinematicUntil || 0) > now;
}

function finishCaravanCinematic(room, player, cinematicId) {
  if (!isPrivateCaravanRoom(room) || cinematicId !== CINEMATIC_ID
      || String(player.characterId || player.id || '') !== room.caravanCinematicOwner) return false;
  room.caravanCinematicUntil = 0;
  return true;
}

module.exports = { CINEMATIC_ID, HOLD_MS, beginCaravanCinematic, caravanCinematicHeld, finishCaravanCinematic };
