'use strict';

function objectProfile(catalog = {}, typeId = '') {
  return (catalog.objects || []).find(row => row.id === String(typeId || '')) || null;
}

function tierProfile(catalog = {}, level = 1) {
  return (catalog.tiers || []).find(row => Number(row.level) === Number(level)) || catalog.tiers?.[0] || null;
}

function rotatedHalfExtents(profile = {}, rotation = 0) {
  const size = Array.isArray(profile.size) ? profile.size : [1, 1];
  const swap = Math.abs(Math.sin(Number(rotation || 0) * Math.PI / 180)) > 0.707;
  return { x: Number(size[swap ? 1 : 0] || 1) / 2, z: Number(size[swap ? 0 : 1] || 1) / 2 };
}

function validatePlacement(base = {}, request = {}, catalog = {}) {
  const profile = objectProfile(catalog, request.typeId);
  if (!profile) return { ok: false, error: 'Неизвестный объект строительства.' };
  const tier = tierProfile(catalog, base.tier);
  if (!tier || (base.objects || []).length >= Number(tier.objectLimit || 0)) return { ok: false, error: 'Достигнут лимит объектов этой площадки.' };
  if (profile.category === 'station') {
    const stations = (base.objects || []).filter(row => objectProfile(catalog, row.typeId)?.category === 'station').length;
    if (stations >= Number(tier.stationLimit || 0)) return { ok: false, error: 'Достигнут лимит станков.' };
  }
  const step = Math.max(0.25, Number(catalog.gridStep || 1));
  const x = Math.round(Number(request.x || 0) / step) * step;
  const z = Math.round(Number(request.z || 0) / step) * step;
  const rotation = ((Math.round(Number(request.rotation || 0) / 90) * 90) % 360 + 360) % 360;
  const half = Number(tier.size || 20) / 2;
  const extent = rotatedHalfExtents(profile, rotation);
  if (Math.abs(x) + extent.x > half || Math.abs(z) + extent.z > half) return { ok: false, error: 'Предмет выходит за границу участка.' };
  for (const placed of base.objects || []) {
    const other = objectProfile(catalog, placed.typeId);
    if (!other) continue;
    const otherExtent = rotatedHalfExtents(other, placed.rotation);
    if (Math.abs(x - Number(placed.x || 0)) < extent.x + otherExtent.x + 0.15
      && Math.abs(z - Number(placed.z || 0)) < extent.z + otherExtent.z + 0.15) {
      return { ok: false, error: 'Здесь уже стоит другой объект.' };
    }
  }
  return { ok: true, profile, placement: { x, z, rotation } };
}

function canAfford(inventoryQty, cost = {}) {
  return Object.entries(cost).every(([id, qty]) => Number(inventoryQty(id) || 0) >= Number(qty || 0));
}

function placeObject(base = {}, request = {}, catalog = {}, inventoryQty = () => 0, now = Date.now()) {
  const validation = validatePlacement(base, request, catalog);
  if (!validation.ok) return validation;
  if (!canAfford(inventoryQty, validation.profile.cost)) return { ok: false, error: 'Не хватает материалов.' };
  const object = {
    id: `base_object_${Number(now).toString(36)}_${(base.objects || []).length.toString(36)}`,
    typeId: validation.profile.id, ...validation.placement, builtAt: Number(now)
  };
  base.objects = [...(base.objects || []), object];
  base.updatedAt = Number(now);
  return { ok: true, object, cost: { ...(validation.profile.cost || {}) } };
}

function removeObject(base = {}, objectId = '', catalog = {}, now = Date.now()) {
  const index = (base.objects || []).findIndex(row => row.id === String(objectId || ''));
  if (index < 0) return { ok: false, error: 'Объект не найден.' };
  const [object] = base.objects.splice(index, 1);
  const profile = objectProfile(catalog, object.typeId) || {};
  const refund = Object.fromEntries(Object.entries(profile.cost || {}).map(([id, qty]) => [id, Math.floor(Number(qty || 0) * 0.5)]).filter(([, qty]) => qty > 0));
  base.updatedAt = Number(now);
  return { ok: true, object, refund };
}

module.exports = { canAfford, objectProfile, placeObject, removeObject, tierProfile, validatePlacement };
