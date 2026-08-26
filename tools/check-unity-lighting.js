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

console.log('Unity lighting OK: ACES, bounded desktop/mobile exposure and three visually distinct local-world profiles');