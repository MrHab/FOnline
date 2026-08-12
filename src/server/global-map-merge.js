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

function mergeAuthoredGlobalMap(stored, bundled) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return bundled;
  if (!bundled || typeof bundled !== 'object' || Array.isArray(bundled)) return stored;
  const merged = { ...stored };
  for (const key of MERGED_COLLECTIONS) {
    merged[key] = mergeRows(stored[key], bundled[key]);
  }
  return merged;
}

module.exports = {
  MERGED_COLLECTIONS,
  mergeAuthoredGlobalMap
};
