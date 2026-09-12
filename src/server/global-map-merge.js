'use strict';
// Подмешивание глобальной карты из поставки в карту сервера.
//
// Локации сервер собирает как «поставка + правки оператора», а карта раньше
// читалась по принципу «файл из DATA_DIR побеждает целиком». На развёрнутом
// сервере со своим DATA_DIR новое авторское содержимое не появлялось никогда:
// добавленная столица не имела узла, а значит на карте не было ни круга
// локации, ни подписи, и войти в неё было нельзя.
//
// Правило слияния: сохранённая карта — основа, из поставки добавляются только
// строки с новыми идентификаторами. Позиции и правки оператора не трогаются.

const MERGED_COLLECTIONS = Object.freeze([
  'nodes',
  'infrastructure',
  'objects',
  'encounters',
  'randomLocations'
]);

function mergeRows(storedRows, bundledRows) {
  const stored = Array.isArray(storedRows) ? storedRows : [];
  const bundled = Array.isArray(bundledRows) ? bundledRows : [];
  if (!bundled.length) return stored;
  const known = new Set(stored.map(row => String(row?.id || '')).filter(Boolean));
  const added = bundled.filter(row => {
    const id = String(row?.id || '');
    return id && !known.has(id);
  });
  return added.length ? [...stored, ...added] : stored;
}

function authoredVersion(value) {
  const version = Number(value?.version);
  return Number.isInteger(version) && version >= 0 ? version : 0;
}

function mergeAuthoredGlobalMap(stored, bundled) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return bundled;
  if (!bundled || typeof bundled !== 'object' || Array.isArray(bundled)) return stored;
  // A higher authored-map version denotes a deliberate world replacement, not
  // an incremental content addition. Keeping the old grid/nodes in that case
  // mixes coordinates from two worlds (for example legacy 900x900 with Kromka
  // 380x300) and scatters live parties outside the Unity scene. Same-version
  // files still preserve operator edits and receive newly bundled rows.
  if (authoredVersion(bundled) > authoredVersion(stored)) return bundled;

  const merged = { ...bundled, ...stored };
  for (const key of MERGED_COLLECTIONS) {
    merged[key] = mergeRows(stored[key], bundled[key]);
  }
  return merged;
}

module.exports = {
  MERGED_COLLECTIONS,
  authoredVersion,
  mergeAuthoredGlobalMap
};
