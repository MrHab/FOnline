'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const map = read(game, 'RoaGlobalMap.cs');
const mapCanvas = read(game, 'RoaGlobalMapCanvas.cs');
const hud = read(game, 'RoaHudCanvas.cs');
const uiScale = read(game, 'RoaUiScale.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaVisualCohesionProbe.cs');
const probeMeta = read('unity-client', 'Assets', 'Editor', 'RoaVisualCohesionProbe.cs.meta');
const runner = read('unity-client', 'Assets', 'Editor', 'RoaClientAuditRunner.cs');
const docs = read('docs', 'UNITY_PORT.md');
const packageJson = JSON.parse(read('package.json'));

assert(map.includes('public struct StrategicVisualProfile')
  && map.includes('public static StrategicVisualProfile StrategicProfile(float mapSpan)')
  && map.includes('RenderSettings.fogMode = FogMode.Linear;')
  && map.includes('RenderSettings.fogStartDistance = profile.FogStart;')
  && map.includes('mapCamera.backgroundColor = profile.CameraBackground;')
  && map.includes('RenderSettings.fogMode = _savedFogMode;')
  && map.includes('RenderSettings.fogEndDistance = _savedFogEndDistance;'),
'Strategic map no longer merges its authored edge into a restorable visual field');

assert(map.includes('public static float PresentationVisibility(')
  && map.includes('public static float PresentationVisibilityScale(')
  && map.includes('state.TargetVisible = visible;')
  && map.includes('UpdateDynamicPresentationTransitions(Time.unscaledDeltaTime);')
  && map.includes('if (!state.TargetVisible && next <= 0.001f'),
'Map zoom hierarchy again hard-pops dynamic world layers');

assert(hud.includes('public enum HudVisualLayer')
  && hud.includes('public static float FocusLayerAlpha(')
  && hud.includes('_mapGroup = panel.gameObject.AddComponent<CanvasGroup>();')
  && hud.includes('_quickGroup = panel.gameObject.AddComponent<CanvasGroup>();')
  && hud.includes('FocusLayerAlpha(resolved, HudVisualLayer.Minimap)')
  && hud.includes('compactAlpha * weaponAlpha'),
'HUD no longer changes visual emphasis with exploration, activity and combat context');

assert(uiScale.includes('canvas.pixelPerfect = true;')
  && hud.includes('shadow.effectDistance = new Vector2(1f, -1f);')
  && mapCanvas.includes('shadow.effectDistance = new Vector2(1f, -1f);')
  && hud.includes('shadow.useGraphicAlpha = true;')
  && mapCanvas.includes('shadow.useGraphicAlpha = true;'),
'Small HUD or map typography lost pixel-perfect one-pixel contrast protection');

assert(probe.includes('RoaGlobalMap.StrategicProfile(160f)')
  && probe.includes('RoaGlobalMap.PresentationVisibility(0f, true, 0.09f)')
  && probe.includes('RoaHudCanvas.FocusLayerAlpha(')
  && probe.includes('hudTexts.All(text => text.GetComponent<Shadow>() != null)')
  && probe.includes('[VISUAL COHESION 4.9] готово:')
  && probeMeta.includes('guid: 03ba91c9e16e42b08c06f693d82f4f49'),
'Unity Visual Cohesion 4.9 probe no longer covers map, HUD and typography');
assert(runner.includes('typeof(RoaVisualCohesionProbe)'),
'Visual Cohesion 4.9 probe is missing from the Unity audit runner');
assert(docs.includes('## Visual Cohesion 4.9'),
'Unity port documentation does not describe the Visual Cohesion 4.9 contract');
assert(packageJson.scripts['check:unity-visual-cohesion'],
'package.json has no narrow Visual Cohesion 4.9 check');

console.log('Unity Visual Cohesion 4.9 OK: soft map hierarchy, edge-integrated lighting, contextual HUD emphasis and crisp protected text');
