'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const lighting = read('unity-client', 'Assets', 'Scripts', 'Game', 'RoaWorldLighting.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaLightingProbe.cs');

for (const marker of [
  'private Tonemapping _tonemapping;',
  '_runtimeVolumeProfile.Add<Tonemapping>(true)',
  '_tonemapping.mode.Override(TonemappingMode.ACES);',
  'Color profileDay = ProfileColor(_effectiveProfile, "groundDay", _groundDayColor);',
  'ProfileNumber(_effectiveProfile, "groundDayMix", 0f, 0f, 0.65f)',
  'mobile ? 1.16f : 1.10f',
  'mobile ? 1.07f : 1.04f'
]) {
  assert(lighting.includes(marker), 'Unity lighting pipeline is missing: ' + marker);
}

for (const marker of [
  '["id"] = "settlement_warm"',
  '["groundDayMix"] = 0.10f',
  '["id"] = "resource_dust"',
  '["groundDayMix"] = 0.22f',
  '["id"] = "hostile_cold"',
  '["groundDayMix"] = 0.36f',
  '["sunDay"] = "#cedee5"',
  '["id"] = "wasteland_neutral"',
  '["groundDayMix"] = 0.65f',
  '["sunDay"] = "#90cff7"',
  '["postSaturation"] = -28f'
]) {
  assert(lighting.includes(marker), 'Distinct location lighting profile is missing: ' + marker);
}

for (const marker of [
  'ROA_LIGHTING_CAPTURE_DIR',
  'string[] profileIds = { "wasteland_neutral", "resource_dust", "hostile_cold" };',
  'metrics.AverageChroma < 0.55f',
  'metrics.AverageLuminance < 0.66f',
  'ColorDistance(profileMetrics[1].MeanColor, profileMetrics[2].MeanColor) > 0.075f',
  'mobileWeb.Exposure < 1.10f',
  'ground=" + ColorUtility.ToHtmlStringRGB(groundColor)'
]) {
  assert(probe.includes(marker), 'Unity lighting visual regression probe is missing: ' + marker);
}

// --- авторское окружение локации обязано доезжать до игрока -------------------
// Локации грузятся аддитивно, а Unity при аддитивной загрузке берёт окружение
// АКТИВНОЙ сцены. Поэтому туман и ambient, прописанные в каждой локации, молча
// выбрасывались: весь мир освещался холодным градиентом сцены-бутстрапа, из-за
// чего земля уходила в синеву — градиент светит цветом неба вверх-смотрящим
// поверхностям, а вертикальные брали тёплый цвет экватора.
const loader = read(path.join('unity-client', 'Assets', 'Scripts', 'World', 'RoaLocationLoader.cs'));
const environment = read(path.join('unity-client', 'Assets', 'Scripts', 'World', 'RoaSceneEnvironment.cs'));

assert(loader.includes('AdoptAuthoredEnvironment(_unityLocationScene);'),
  'загрузчик не переносит окружение авторской сцены — туман и ambient локации снова выброшены');
assert(loader.includes('RestoreBootstrapEnvironment();'),
  'окружение бутстрапа не восстанавливается при выгрузке локации');
assert(/SetActiveScene\(authored\)[\s\S]{0,400}SetActiveScene\(active\)/.test(loader),
  'авторская сцена должна становиться активной лишь на время снятия настроек и возвращать активной прежнюю');

for (const field of ['ambientMode', 'ambientSkyColor', 'ambientEquatorColor', 'ambientGroundColor',
  'ambientIntensity', 'fog', 'fogColor', 'fogMode', 'fogDensity']) {
  assert(environment.includes('RenderSettings.' + field),
    `снимок окружения не переносит RenderSettings.${field}`);
}

// Данные: локации действительно авторизуют собственное окружение, иначе перенос
// был бы бессмыслен, а бутстрап действительно отличается от них.
const locationScenes = fs.readdirSync(path.join(root, 'unity-client/Assets/Scenes/Kromka/Locations'))
  .filter(name => name.endsWith('.unity'));
let authoredFog = 0;
for (const name of locationScenes) {
  const head = read(path.join('unity-client/Assets/Scenes/Kromka/Locations', name)).slice(0, 4000);
  if (/m_Fog: 1/.test(head)) authoredFog += 1;
}
assert(authoredFog >= locationScenes.length,
  `туман авторизован лишь в ${authoredFog} из ${locationScenes.length} локаций`);
const bootstrapHead = read(path.join('unity-client', 'Assets', 'Scenes', 'Wasteland.unity')).slice(0, 4000);
assert(/m_Fog: 0/.test(bootstrapHead),
  'бутстрап больше не отличается туманом от локаций — проверка перестала что-либо значить');

console.log('Unity lighting OK: ACES, bounded desktop/mobile exposure, three visually distinct local-world profiles '
  + `and the authored environment of all ${locationScenes.length} locations now reaches the player instead of the bootstrap gradient`);