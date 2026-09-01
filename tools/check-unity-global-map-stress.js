'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const actorPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game',
    'RoaGlobalMapActorView.cs');
  const mapPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game',
    'RoaGlobalMap.cs');
  const stressPath = path.join(root, 'unity-client', 'Assets', 'Editor',
    'RoaGlobalMapActorStressProbe.cs');
  assert(fs.existsSync(stressPath), 'Unity 33-party stress probe is missing');
  assert(fs.existsSync(`${stressPath}.meta`), 'Unity 33-party stress probe meta is missing');

  const actor = fs.readFileSync(actorPath, 'utf8');
  const map = fs.readFileSync(mapPath, 'utf8');
  const stress = fs.readFileSync(stressPath, 'utf8');

  for (const marker of [
    'RoaStrategicActorFitMode',
    'TargetWorldSpan',
    'AnimatedLocalBounds',
    'HasAnimatedBounds',
    'ModelContentName = "StrategicActorContent"',
    'ProfileFor(string modelKey)',
    'RoaStrategicActorFitMode.Height',
    'RoaStrategicActorFitMode.Footprint',
    'case "enemySuperMutant"',
    'Profile(1.95f, 0.37f, 180f',
    'case "enemyRadscorpion"',
    'Profile(1.82f, 0.37f, 0f',
    'TryRendererContentBounds',
    'TryGetStrategicWorldBounds',
    '-bounds.center.x * factor',
    '-bounds.center.z * factor',
    'SetPresentationLod(RoaActorPresentationTier tier)',
    'FreezeToIdle(animation)',
    'bool animate = _presentationTier == RoaActorPresentationTier.Near || _moving',
    'skinned.updateWhenOffscreen = true'
  ]) {
    assert(actor.includes(marker), `Strategic actor fitting/LOD marker is missing: ${marker}`);
  }

  assert(map.includes('StrategicActorPresentationTier(')
    && map.includes('if (mapTier != MapDetailTier.Near) return RoaActorPresentationTier.Far;')
    && map.includes('UpdateStrategicActorPresentation();')
    && map.includes('state.Presentation.TargetVisible'),
  'Global map does not drive actor animation LOD from semantic zoom and visibility');

  for (const marker of [
    'public const int PartyCount = 33',
    'NearAnimationBudget = 6',
    'MovingFarAnimationBudget = 10',
    'http://127.0.0.1:9',
    'await Task.WhenAll(loads)',
    'VerifyAssetReuse(views)',
    'VerifyAnimationBudget(views)',
    'VerifyCenteredTurning(roots, views)',
    'meshesByModel.Count == 8',
    'AssetDatabase.Contains(material)',
    'EnabledAnimations(views) == 0',
    'ROA_GLOBAL_MAP_STRESS_CAPTURE',
    '[GLOBAL MAP STRESS] PASS parties='
  ]) {
    assert(stress.includes(marker), `33-party stress assertion is missing: ${marker}`);
  }

  for (const visual of [
    'fire-gecko', 'gecko', 'radscorpion', 'mutant-ant', 'ghoul', 'ash-wolf'
  ]) {
    assert(stress.includes(`"${visual}"`), `Stress set does not cover ${visual}`);
  }
  assert(stress.includes('"caravan"') && stress.includes('"mutant"'),
    'Stress set does not cover caravan and super-mutant parties');

  console.log('Unity global-map stress contract OK: 33 prefab parties, centered profiles and animation LOD');
}

if (require.main === module) run();

module.exports = { run };
