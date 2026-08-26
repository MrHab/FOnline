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
  'RoaCombatPresentationFx.Factory.cs',
  'RoaCombatPresentationFx.Damage.cs'
].map(file => read(game, file)).join('\n');
const fallback = read(game, 'RoaCombatFx.cs');
const combat = read(game, 'RoaCombat.cs');
const character = read(game, 'RoaCharacterView.cs');
const weapon = read(game, 'RoaWeaponView.cs');
const offhand = read(game, 'RoaOffhandWeaponView.cs');
const bootstrap = read(game, 'RoaGameBootstrap.cs');
const socket = read('unity-client', 'Assets', 'Scripts', 'Net', 'RoaSocketClient.cs');
const protocol = read('unity-client', 'Assets', 'Scripts', 'Net', 'RoaProtocol.cs');
const server = read('server.js');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaCombatFxProbe.cs');
const dualProbe = read('unity-client', 'Assets', 'Editor', 'RoaDualWieldProbe.cs');
const collisionProbe = read('unity-client', 'Assets', 'Editor', 'RoaWeaponCollisionProbe.cs');

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
  && presentation.includes('PlayDamagePulse(int damage, Vector3 targetWorld, Vector3 sourceWorld)')
  && presentation.includes('CombatDamageFeedback')
  && presentation.includes('RawImage')
  && presentation.includes('TryDamageScreenDirection')
  && !presentation.includes('GUI.DrawTexture'),
  'Directional Canvas damage feedback is incomplete or returned to IMGUI');

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
  && combat.includes('Socket.OnPlayerDamaged += HandlePlayerDamaged;')
  && combat.includes('TryDamageSource(payload, attackerId, out Vector3 source)')
  && server.includes('sourceX: Number(origin.x.toFixed(2))')
  && server.includes('sourceX: Number(impactX.toFixed(2))')
  && combat.includes('Player.View.TryGetMuzzle(handSlot, out start)')
  && combat.includes('Fx.PlayShot(start, end, weaponId, exactMuzzle);')
  && combat.includes('["startX"] = startX')
  && combat.includes('["startY"] = start.y')
  && combat.includes('new WaitForSecondsRealtime(0.09f)')
  && combat.includes('new[] { "weapon", "offhand" }')
  && combat.includes('LoadedRoundsForHand(handSlot) == 0')
  && character.includes('TryGetMuzzle(string handSlot, out Vector3 worldPosition)')
  && character.includes('_offhandWeapon.TryGetMuzzle(out worldPosition)')
  && weapon.includes('_socketMuzzle.position')
  && offhand.includes('_socketMuzzle.position'),
  'Damage pulse, hand-specific muzzles or staggered dual-shot visuals are not connected');
assert(protocol.includes('[JsonProperty("combats")] public JArray Combats;')
  && socket.includes('Session.Combats = (JArray)combats.DeepClone()')
  && server.includes('combats: serverCombatAcksForPlayer(p)')
  && server.includes('function serverCombatAcksForPlayer('),
  'Per-hand loaded state is no longer synchronized through join and gameplay acknowledgements');
assert(offhand.includes('MirrorRigid(rightLocal)')
  && offhand.includes('_leftArm.Solve')
  && offhand.includes('RoaWeaponView.ObstructionAmount')
  && offhand.includes('RoaWeaponView.SmoothObstruction')
  && character.includes('_offhandWeapon.Apply(_aimPoint, _hasAim)')
  && weapon.includes('if (DualWield) SupportHandSolved = false;'),
  'Offhand model lost mirrored arm IK, obstruction or one-handed primary grip');
assert(dualProbe.includes('RoaOffhandWeaponView.MirrorRigid')
  && dualProbe.includes('left.determinant - 1f'),
  'Dual-wield editor probe no longer verifies a rigid mirrored hand pose');

const attackAtStart = combat.indexOf('private void AttackAt(Vector3 cursor)');
const attackAtEnd = combat.indexOf('private bool TryScreenPointToWorld', attackAtStart);
const attackAt = combat.slice(attackAtStart, attackAtEnd);
assert(attackAtStart >= 0 && attackAtEnd > attackAtStart
  && attackAt.includes('Player.View.FireObstructed')
  && attackAt.includes('Player.View.PlayBlockedFireContact()')
  && attackAt.includes('Audio?.PlayWeaponBlocked()')
  && attackAt.indexOf('Player.View.FireObstructed') < attackAt.indexOf('Player.View.PlayAttack()')
  && attackAt.indexOf('Player.View.FireObstructed') < attackAt.indexOf('SendAttackVisual('),
  'Obstructed fire is not stopped before animation, network emission and AP/ammo use');
assert(weapon.includes('public const float FireBlockThreshold = 0.34f;')
  && weapon.includes('public static bool BlocksFire')
  && weapon.includes('ContactBumpEnvelope')
  && weapon.includes('contactBump * ContactBumpAngle')
  && offhand.includes('PlayBlockedContact()')
  && offhand.includes('RoaWeaponView.ContactBumpEnvelope')
  && character.includes('public bool FireObstructed')
  && character.includes('public void PlayBlockedFireContact()'),
  'Weapon collision, IK high-ready and contact animation are no longer mechanically coupled');
assert(collisionProbe.includes('RoaWeaponView.FireBlockThreshold')
  && collisionProbe.includes('RoaWeaponView.BlocksFire("pistol"')
  && collisionProbe.includes('RoaWeaponView.ContactBumpEnvelope(0.09f)'),
  'Weapon collision probe does not verify the fire interlock and contact envelope');
assert(probe.includes('moving tapered tracer geometry')
  && probe.includes('directional muzzle burst geometry')
  && probe.includes('shock, heat, fireball, smoke or ember layer')
  && probe.includes('damage Canvas, direction marker or input transparency'),
  'Unity editor probe does not inspect the new VFX structure');

for (const file of [
  'RoaCombatPresentationFx.cs.meta',
  'RoaCombatPresentationFx.Motion.cs.meta',
  'RoaCombatPresentationFx.Explosion.cs.meta',
  'RoaCombatPresentationFx.Factory.cs.meta',
  'RoaCombatPresentationFx.Damage.cs.meta',
  'RoaOffhandWeaponView.cs.meta'
]) {
  assert(/guid:\s*[0-9a-f]{32}/i.test(read(game, file)), `${file} has no valid GUID`);
}

assert(/guid:\s*[0-9a-f]{32}/i.test(read('unity-client', 'Assets', 'Editor', 'RoaDualWieldProbe.cs.meta')),
  'RoaDualWieldProbe.cs.meta has no valid GUID');

console.log('Unity combat VFX OK: collision-gated fire, contact animation, dual IK, moving tracers, impacts, explosions and directional damage Canvas');
