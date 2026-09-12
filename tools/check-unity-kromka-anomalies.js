#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const game = 'unity-client/Assets/Scripts/Game';
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const renderer = read(`${game}/RoaAnomalyFieldRenderer.cs`);
const presentation = read(`${game}/RoaAnomalyFieldRenderer.Presentation.cs`);
const bolt = read(`${game}/RoaBoltThrower.cs`);
const character = read(`${game}/RoaCharacterView.cs`);
const remotePlayers = read(`${game}/RoaRemotePlayers.cs`);
const bootstrap = read(`${game}/RoaGameBootstrap.cs`);
const mobile = read(`${game}/RoaMobileControlsCanvas.cs`);
const builder = read('unity-client/Assets/Editor/KromkaWorldSceneBuilder.cs');
const probe = read('unity-client/Assets/Editor/RoaBoltThrowProbe.cs');
const authoring = read('unity-client/Assets/Scripts/Kromka/Authoring/KromkaAnomalyAuthoring.cs');
const shader = read('unity-client/Assets/Resources/RealmOfAshes/AnomalyField.shader');
const volumeShader = read('unity-client/Assets/Resources/RealmOfAshes/AnomalyVolume.shader');
const mistTemplate = read('unity-client/Assets/Resources/RealmOfAshes/AnomalyMistTemplate.mat');
const pipelineRenderer = read('unity-client/Assets/Settings/RoaUniversalRenderer.asset');
const vfxProbe = read('unity-client/Assets/Editor/RoaAnomalyVfxProbe.cs');

assert(renderer.includes('v.Root.position = RoaCoords.ToUnity('), 'VFX must use the same mirrored Z as collisions');
assert(renderer.includes('revision < v.Revision') && renderer.includes('serverNow < _lastServerNow')
  && renderer.includes('revision > v.Revision'), 'VFX must reject stale snapshots and deduplicate bursts');
assert(renderer.includes('new ParticleSystem.Particle[v.Low ? 24 : 64]')
  && renderer.includes('new ParticleSystem.Particle[v.Low ? 14 : 36]')
  && renderer.includes('new ParticleSystem.Particle[v.Low ? 5 : 10]'), 'Particle budgets must stay bounded');
assert(renderer.includes('Resources.Load<Shader>("RealmOfAshes/AnomalyField")')
  && shader.includes('RenderPipeline"="UniversalPipeline') && shader.includes('ZWrite Off')
  && !shader.includes('_CameraOpaqueTexture') && !shader.includes('_CameraDepthTexture'),
  'Anomaly shader must ship with the client and not depend on optional scene texture passes');
assert(presentation.includes('new Texture3D(size,size,size') && presentation.includes('const int size=32')
  && volumeShader.includes('const int steps=24;') && volumeShader.includes('SampleSceneDepth')
  && volumeShader.includes('SampleSceneColor') && volumeShader.includes('leave=min(leave,sceneT)'),
  'High quality needs bounded volume integration, real refraction and opaque occlusion');
assert(/m_CopyDepthMode:\s*0/.test(pipelineRenderer),
  'Requested scene depth must be copied after opaque geometry, BEFORE transparent anomaly volumes');
assert(presentation.includes('bool detailed=!v.Low && RefractionBuffersRequested')
  && presentation.includes('MaximumSpillLights = 2') && presentation.includes('LowQuality ? 1 : MaximumSpillLights')
  && presentation.includes('requiresColorOption=_previousColorOption')
  && presentation.includes('requiresDepthOption=_previousDepthOption')
  && presentation.includes('v.FlowSegments=v.Low ? 24 : 48'),
  'Mobile fallback must bound geometry/light work and release optional camera passes');
assert((bootstrap.match(/Anomalies\??\.SetLocalWorldActive\(false\)/g) || []).length >= 2
  && bootstrap.includes('Anomalies?.SetLocalWorldActive(true)')
  && /if\s*\(\s*!_localWorldActive\s*\)\s*return;/.test(renderer),
  'Local anomaly effects must not leak into the global map');
// The licensed MEP pack is installed locally, not redistributed in Git. Keep
// checking the authored binding in clean/CI checkouts and verify the installed
// pack's identity as well whenever its metadata is available.
const smokeGuid = '46431ee48f9e612429a0a74b04c0b9c8';
const smokeMetaPath = 'unity-client/Assets/MEP/MEP_Environment/MEP_FX/MEP_Clouds/Textures/AEP_Smoke_02.png.meta';
if (fs.existsSync(path.join(root, smokeMetaPath))) {
  assert.strictEqual(read(smokeMetaPath).match(/guid:\s*([0-9a-f]{32})/)?.[1], smokeGuid,
    'Installed MEP smoke metadata no longer matches the authored Resources binding');
} else {
  console.log('MEP is not installed: checking the pinned smoke binding only; native VFX validation still requires the licensed pack.');
}
assert(mistTemplate.includes(smokeGuid) && mistTemplate.includes('_UseSmoke: 1')
  && renderer.includes('Resources.Load<Material>("RealmOfAshes/AnomalyMistTemplate")'),
  'Authored smoke must be included by a Resources material, not an editor-only texture lookup');
assert(bolt.includes('payload["anomaly"]?["contact"]') && bolt.includes('if (!hit) StartCoroutine(ImpactPulse'),
  'Bolt must stop at authoritative contact and leave typed bursts to the field renderer');
assert(bolt.includes('ClampToRange(playerPosition, rawTarget, ThrowRangeMeters)')
  && bolt.includes('"boltRangeMeters"') && bolt.includes('"permanentlyDischarged"'),
  'Magnetic aiming range and permanent-discharge hints must reflect the server');
assert(vfxProbe.includes('Mobile capture must show active fields') && vfxProbe.includes('renderPostProcessing = !mobile')
  && vfxProbe.includes('Stale revision must not reactivate'), 'VFX probe must cover real mobile states without bloom');

for (const type of ['pull', 'seam', 'carousel', 'glass', 'dew', 'sink', 'chime', 'mute'])
  assert(renderer.includes(`case "${type}"`), `Unity lacks a distinct persistent cue for ${type}`);
assert(renderer.includes('HazardBoundary') && renderer.includes('PermanentCue_')
  && renderer.includes('AudioSource') && renderer.includes('VisibleFieldCount'),
  'Anomalies no longer have geometry-first low-quality readability and spatial sound');
assert(renderer.includes('PermanentlyDischarged') && renderer.includes('float.PositiveInfinity')
  && renderer.includes('row["permanentlyDischarged"]'),
  'Unity can visually reactivate a permanently discharged story anomaly');
assert(renderer.includes('The detector is') && renderer.includes('intentionally irrelevant here')
  && !renderer.includes('DetectorUnlocked') && !renderer.includes('HasDetector'),
  'Visible anomaly rendering must remain independent from the artefact detector');
assert(socket.includes('OnAnomalyState') && socket.includes('_connection.On("anomalyState"')
  && socket.includes('OnBoltThrown') && socket.includes('_connection.On("boltThrown"'),
  'Unity socket bridge does not receive authoritative anomaly and bolt events');
assert(bolt.includes('KeyCode.B') && bolt.includes('RegularRangeMeters = 10f')
  && bolt.includes('RoaCoords.ToServer(target, out float serverX, out float serverZ)')
  && bolt.includes('EmitWithAck("throwBolt"') && bolt.includes('["x"] = serverX')
  && bolt.includes('["z"] = serverZ') && !bolt.includes('["hit"] ='),
  'Bolt input must submit only a target point while the server owns the hit');
assert(bolt.includes('TrailRenderer') && bolt.includes('AnomalyDischargePulse'),
  'Bolt needs visible throw and discharge feedback');
assert(!bolt.includes('new GameObject("BoltThrowReticle")') && !bolt.includes('TenMeterRange')
  && !bolt.includes('ServerProposedTrajectory') && !bolt.includes('TargetCross')
  && !bolt.includes('PresentReticle(') && bolt.includes('RemoveRetiredAimIndicator()'),
  'Bolt aiming must not render a range circle, target cross or trajectory preview');
assert(character.includes('TryGetRightHand(out Vector3 worldPosition)')
  && character.includes('_bones.TryGetValue("hand_r"')
  && remotePlayers.includes('TryGetCharacterView(string id, out RoaCharacterView view)')
  && bolt.includes('FindThrowerView(playerId)')
  && bolt.includes('Vector3 serverFrom = RoaCoords.ToUnity(')
  && bolt.includes('Vector3 to = RoaCoords.ToUnity(')
  && bolt.includes('thrower.TryGetRightHand(out Vector3 hand)')
  && bolt.includes('projectile.transform.position = from;')
  && probe.includes('Vector3.Distance(origin, hand.position) < 0.0001f')
  && !bolt.includes('Value(payload["from"] as JObject, "x"), 0.85f'),
  'Every local and remote bolt must start at the thrower animated right hand');
assert(mobile.includes('CreateButton("Bolt"') && mobile.includes('BoltThrower?.ToggleAim()')
  && mobile.includes('state.BoltAiming ? "ОТМЕНА" : "БОЛТ"'),
  'Touch players need a dedicated stateful bolt button');
assert(bootstrap.includes('gameObject.AddComponent<RoaAnomalyFieldRenderer>()')
  && bootstrap.includes('gameObject.AddComponent<RoaBoltThrower>()')
  && bootstrap.includes('Anomalies?.ApplyWorldState(ack.WorldState)'),
  'Bootstrap does not activate anomaly visuals for the joined Unity location');
assert(authoring.includes('class KromkaAnomalyAuthoring')
  && builder.includes('BuildAnomalyFields(dynamicAnchors, location)')
  && builder.includes('"AnomalyFields_EDITABLE"'),
  'Unity scenes lack editable anomaly transforms for spatial authoring');
for (const file of ['RoaAnomalyFieldRenderer.cs.meta', 'RoaAnomalyFieldRenderer.Presentation.cs.meta', 'RoaBoltThrower.cs.meta'])
  assert(/guid:\s*[0-9a-f]{32}/i.test(read(`${game}/${file}`)), `${file} has no valid GUID`);

console.log('Unity Kromka anomalies OK: eight readable fields, server bolt authority, touch action and scene authoring');
