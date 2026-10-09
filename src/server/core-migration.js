'use strict';

// Старые мирные базы и Рынок Ядра выведены из маршрута. На входе в игру
// возвращаем персонажа в зону перед единственным порталом Сердцевины. Вещи,
// опыт, квесты, членство и фракционные хранилища сохраняются без изменений.
const RETIRED_CORE_LOCATIONS = Object.freeze(new Set([
  'coreBaseUprava', 'coreBaseArtels', 'coreBaseContour', 'coreBaseLeague', 'coreMarket'
]));

function migrateRetiredCoreLocation(state = {}) {
  if (!state || typeof state !== 'object' || !RETIRED_CORE_LOCATIONS.has(String(state.currentLocationId || ''))) {
    return false;
  }
  state.currentLocationId = 'z_09_07';
  state.player = state.player && typeof state.player === 'object' ? state.player : {};
  // Authored safe approach to place_coreZone, outside its physical doorway.
  // The previous (20, 0) migration point was separated from the portal by
  // the new exterior infrastructure on the full terrain scene.
  state.player.x = 29;
  state.player.z = -1;
  state.serverLocationContext = null;
  return true;
}

module.exports = { RETIRED_CORE_LOCATIONS, migrateRetiredCoreLocation };
