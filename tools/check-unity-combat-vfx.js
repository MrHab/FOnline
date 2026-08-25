'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const presentation = [
  'RoaCombatPresentationFx.cs',
  'RoaCombatPresentationFx.Motion.cs',
  'RoaCombatPresentationFx.Explosion.cs',
  'RoaCombatPresentationFx.Factory.cs'
].map(file => read(game, file)).join('\n');
const fallback = read(game, 'RoaCombatFx.cs');
const combat = read(game, 'RoaCombat.cs');
const character = read(game, 'RoaCharacterView.cs');
const weapon = read(game, 'RoaWeaponView.cs');
const bootstrap = read(game, 'RoaGameBootstrap.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaCombatFxProbe.cs');

assert(presentation.includes('public sealed partial class RoaCombatPresentationFx'),
  'Polished combat presentation component is missing');
assert(presentation.includes('Vector3.LerpUnclamped(fx.Start, fx.End, tail)')
  && presentation.includes('visibleFraction')
  && presentation.includes('TracerGradient(profile.Tracer)'),
  'Tracers are no longer moving tapered streaks');
assert(presentation.includes('ProceduralMuzzleBurst')
  && presentation.includes('Quaternion.LookRotation(direction, Vector3.up)')
  && presentation.includes('points = 12'),
  'Directional procedural muzzle burst is incomplete');assert(presentation.includes('TracerFx oldest = _tracers[0]')
  && presentation.includes('FlashFx oldest = _flashes[0]')
  && presentation.includes('ImpactFx oldest = _impacts[0]')
  && !presentation.includes('_tracers.Add(created)')
  && presentation.includes('collider.enabled = false'),
  'Combat VFX pools must stay bounded and decorative geometry must not collide');
assert(presentation.includes('ImpactSparkCount = 6')
  && presentation.includes('impact.Visible = false')
  && presentation.includes('Vector3.down * (t * t * 0.18f)'),
  'Delayed ballistic impact no longer has six animated sparks');
assert(presentation.includes('public const float Life = 0.96f')
  && presentation.includes('Shockwave') && presentation.includes('HeatRing')
  && presentation.includes('ExplosionSmokeCount = 6')
  && presentation.includes('ExplosionEmberCount = 10')
  && presentation.includes('MaxExplosions = 8'),
  'Layered bounded explosion lost shock, heat, smoke or ember coverage');
assert(presentation.includes('CreateDamageVignette()')
  && presentation.includes('PlayDamagePulse(int damage)')
  && presentation.includes('GUI.DrawTexture'),
  'Player damage feedback vignette is incomplete');

assert(fallback.includes('public RoaCombatPresentationFx Polish;')
  && fallback.includes('Polish.PlayShot(start, end, weaponId, profile);')
  && fallback.includes('Polish.PlayExplosion(center, radius);')
  && fallback.includes('if (Polish == null) EnsurePools();'),
  'Legacy effects no longer safely delegate with a fallback path');
assert(bootstrap.includes('gameObject.AddComponent<RoaCombatPresentationFx>()')
  && bootstrap.includes('CombatPresentation.CameraRig = CameraRig;')
  && bootstrap.includes('CombatFx.Polish = CombatPresentation;'),
  'Bootstrap does not wire the polished VFX component');
assert(combat.includes('Fx?.PlayDamagePulse(damage);')
  && combat.includes('Player.View.TryGetMuzzle(out start)')
  && combat.includes('Fx.PlayShot(start, end, weapon, exactMuzzle);')
  && character.includes('_weapon.TryGetMuzzle(out worldPosition)')
  && weapon.includes('_socketMuzzle.position'),
  'Damage pulse or exact socket_muzzle origin is not connected to combat');
assert(probe.includes('moving tapered tracer geometry')
  && probe.includes('directional muzzle burst geometry')
  && probe.includes('shock, heat, fireball, smoke or ember layer'),
  'Unity editor probe does not inspect the new VFX structure');

for (const file of [
  'RoaCombatPresentationFx.cs.meta',
  'RoaCombatPresentationFx.Motion.cs.meta',
  'RoaCombatPresentationFx.Explosion.cs.meta',
  'RoaCombatPresentationFx.Factory.cs.meta'
]) {
  assert(/guid:\s*[0-9a-f]{32}/i.test(read(game, file)), `${file} has no valid GUID`);
}

console.log('Unity combat VFX OK: moving tracers, socket muzzle, spark impacts, layered explosions and damage pulse');
