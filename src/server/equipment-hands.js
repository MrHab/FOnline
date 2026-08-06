'use strict';

const PRIMARY_HAND_SLOT = 'weapon';
const OFFHAND_SLOT = 'offhand';
const HAND_EQUIPMENT_SLOTS = Object.freeze([PRIMARY_HAND_SLOT, OFFHAND_SLOT]);

function equipmentBaseId(value = '') {
  return String(value || '').trim();
}

function weaponHands(weaponOrId = '', weaponDefs = {}) {
  const weapon = weaponOrId && typeof weaponOrId === 'object'
    ? weaponOrId
    : weaponDefs[equipmentBaseId(weaponOrId)];
  return Number(weapon?.hands) === 2 ? 2 : 1;
}

function isTwoHandedWeapon(weaponOrId = '', weaponDefs = {}) {
  const id = weaponOrId && typeof weaponOrId === 'object'
    ? equipmentBaseId(weaponOrId.id)
    : equipmentBaseId(weaponOrId);
  return Boolean(id && id !== 'fists' && weaponDefs[id] && weaponHands(weaponDefs[id], weaponDefs) === 2);
}

function normalizeHandEquipment(equipment = {}, weaponDefs = {}) {
  const out = equipment && typeof equipment === 'object' ? { ...equipment } : {};
  const primary = equipmentBaseId(out[PRIMARY_HAND_SLOT] || 'fists') || 'fists';
  const offhand = equipmentBaseId(out[OFFHAND_SLOT] || '');
  out[PRIMARY_HAND_SLOT] = primary;
  out[OFFHAND_SLOT] = offhand;

  if (isTwoHandedWeapon(primary, weaponDefs)) {
    out[OFFHAND_SLOT] = '';
  } else if (isTwoHandedWeapon(offhand, weaponDefs)) {
    out[PRIMARY_HAND_SLOT] = offhand;
    out[OFFHAND_SLOT] = '';
  }
  return out;
}

function activeWeaponSlot(equipment = {}, weaponDefs = {}) {
  const primary = equipmentBaseId(equipment?.[PRIMARY_HAND_SLOT] || '');
  if (primary && primary !== 'fists' && weaponDefs[primary]) return PRIMARY_HAND_SLOT;
  const offhand = equipmentBaseId(equipment?.[OFFHAND_SLOT] || '');
  if (offhand && offhand !== 'fists' && weaponDefs[offhand]) return OFFHAND_SLOT;
  return PRIMARY_HAND_SLOT;
}

function activeWeaponId(equipment = {}, weaponDefs = {}) {
  const slot = activeWeaponSlot(equipment, weaponDefs);
  const id = equipmentBaseId(equipment?.[slot] || '');
  return id && weaponDefs[id] ? id : 'fists';
}

module.exports = {
  PRIMARY_HAND_SLOT,
  OFFHAND_SLOT,
  HAND_EQUIPMENT_SLOTS,
  weaponHands,
  isTwoHandedWeapon,
  normalizeHandEquipment,
  activeWeaponSlot,
  activeWeaponId
};
