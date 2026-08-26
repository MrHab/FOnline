'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const presentation = [
  'RoaCombatPresentationFx.cs',
  'RoaCombatPresentationFx.Motion.cs',
  'RoaCombatPresentationFx.Explosion.cs',
  'RoaCombatPresentationFx.Factory.cs',
  'RoaCombatPresentationFx.Damage.cs'
].map(file => read(game, file)).join('\n');
const fallback = read(game, 'RoaCombatFx.cs');
const worldOverlay = read(game, 'RoaWorldOverlayCanvas.cs');
const groundItems = read(game, 'RoaGroundItems.cs');
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
const characterPreviewProbe = read('unity-client', 'Assets', 'Editor', 'RoaCharacterPreviewProbe.cs');

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
  && presentation.includes('public void PlayMiss(')
  && presentation.includes('Vector3.down * (t * t * 0.18f)'),
  'Authoritative miss/hit impacts no longer have six animated sparks');
assert(presentation.includes('public const float Life = 0.96f')
  && presentation.includes('Shockwave') && presentation.includes('HeatRing')
  && presentation.includes('ExplosionSmokeCount = 6')
  && presentation.includes('ExplosionEmberCount = 10')
  && presentation.includes('MaxExplosions = 8'),
  'Layered bounded explosion lost shock, heat, smoke or ember coverage');
assert(presentation.includes('Mathf.InverseLerp(0.35f, 1f, t)')
  && presentation.includes('Mathf.InverseLerp(0.52f, 1f, t)')
  && presentation.includes('Mathf.InverseLerp(0f, 0.55f, t)')
  && !presentation.includes('Mathf.SmoothStep(0.35f, 1f, t)'),
  'Impact sparks, explosion core, embers or light can pop instead of fading to zero');
assert(presentation.includes('CreateDamageVignette()')
  && presentation.includes('PlayDamagePulse(int damage, Vector3 targetWorld, Vector3 sourceWorld)')
  && presentation.includes('CombatDamageFeedback')
  && presentation.includes('RawImage')
  && presentation.includes('TryDamageScreenDirection')
  && !presentation.includes('GUI.DrawTexture'),
  'Directional Canvas damage feedback is incomplete or returned to IMGUI');

assert(worldOverlay.includes('private const int InitialGroundPool = 8;')
  && worldOverlay.includes('private const int InitialSpeechPool = 6;')
  && worldOverlay.includes('RoaUiScale.Apply(root.GetComponent<CanvasScaler>())')
  && worldOverlay.includes('TryResolveLocalRect(')
  && worldOverlay.includes('RoaItemData.Name(row.ItemId)')
  && worldOverlay.includes('"[E] ПОДНЯТЬ · "')
  && worldOverlay.includes('raycastTarget = false')
  && !worldOverlay.includes('AddComponent<GraphicRaycaster>'),
  'Pooled input-transparent world overlay lost localization, collision layout or fixed bounds');
assert(fallback.includes('public bool CanvasDriven { get; set; }')
  && fallback.includes('private void OnGUI()\n        {\n            if (CanvasDriven) return;')
  && groundItems.includes('public bool CanvasDriven { get; set; }')
  && groundItems.includes('public void CollectOverlayLabels(')
  && groundItems.includes('public bool TryGetOverlayStatus(')
  && groundItems.includes('private void OnGUI()\n        {\n            if (CanvasDriven) return;'),
  'Active loot or speech IMGUI path is not gated behind the shared Canvas');
assert(bootstrap.includes('gameObject.AddComponent<RoaWorldOverlayCanvas>()')
  && bootstrap.includes('worldOverlay.Configure(GroundItems, Enemies, movementFxCamera);')
  && bootstrap.includes('GroundItems.CanvasDriven = true;')
  && bootstrap.includes('CombatFx.CanvasDriven = true;'),
  'Bootstrap does not replace active ground labels and NPC speech with the world Canvas');
assert(fallback.includes('public RoaCombatPresentationFx Polish;')
  && fallback.includes('Polish.PlayShot(start, end, weaponId, profile);')
  && fallback.includes('Polish.PlayMiss(point, source, weaponId, profile);')
  && fallback.includes('Polish.PlayExplosion(center, radius);')
  && fallback.includes('if (Polish == null) EnsurePools();'),
  'Legacy effects no longer safely delegate with a fallback path');
assert(fallback.includes('PayloadHasMuzzleStart(payload)')
  && fallback.includes('payload[\"enemyShooter\"]?.ToObject<bool>() == true')
  && probe.includes('RoaCombatFx.PayloadHasMuzzleStart(exact)')
  && probe.includes('RoaCombatFx.PayloadHasMuzzleStart(enemyExact)')
  && probe.includes('RoaCombatFx.PayloadHasMuzzleStart(directional)'),
  'Remote player shots no longer distinguish an exact muzzle from NPC or legacy origins');

const polishedShotStart = presentation.indexOf('public void PlayShot(');
const polishedShotEnd = presentation.indexOf('public void PlayMiss(', polishedShotStart);
const fallbackShotStart = fallback.indexOf('public void PlayShot(');
const fallbackShotEnd = fallback.indexOf('public void PlayMiss(', fallbackShotStart);
const polishedShot = presentation.slice(polishedShotStart, polishedShotEnd);
const fallbackShot = fallback.slice(fallbackShotStart, fallbackShotEnd);
assert(polishedShotStart >= 0 && polishedShotEnd > polishedShotStart
  && fallbackShotStart >= 0 && fallbackShotEnd > fallbackShotStart
  && !polishedShot.includes('AcquireImpact()')
  && !fallbackShot.includes('AcquireImpact()')
  && fallback.includes('public static Vector3 ResolveMissPoint(')
  && fallback.includes('uint hash = StableHash(attackToken);')
  && combat.includes('RoaCombatFx.ResolveMissPoint(')
  && combat.includes('Fx?.PlayMiss(missPoint, sourcePosition, missWeapon);'),
  'Speculative fire still creates false contacts or misses are not server-confirmed');
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
  && collisionProbe.includes('RoaWeaponView.ContactBumpEnvelope(0.09f)')
  && collisionProbe.includes('RoaWeaponView.RecoilEnvelope(RoaWeaponView.RecoilPeakSeconds)'),
  'Weapon collision probe does not verify the fire interlock, contact and recoil envelopes');
assert(character.includes('_weapon != null && _weapon.Ready')
  && character.includes('_weapon.PlayAttack();')
  && character.includes('_attackUntil = 0f;')
  && weapon.includes('public static float RecoilEnvelope(float elapsed)')
  && weapon.includes('private void ApplyFirearmRecoil()')
  && weapon.includes('_recoilStartedAt = Time.time;'),
  'Armed attack no longer preserves gait through procedural firearm recoil');
assert(characterPreviewProbe.includes('loaded.CurrentClip == "run"')
  && characterPreviewProbe.includes('weapon.RecoilWeight > 0.85f')
  && characterPreviewProbe.includes('weapon.SupportHandSolved')
  && characterPreviewProbe.includes('отдача не дошла до позвоночника настоящего GLB'),
  'Real-GLB preview does not verify gait-preserving recoil and support-hand IK');
assert(probe.includes('moving tapered tracer geometry')
  && probe.includes('directional muzzle burst geometry')
  && probe.includes('speculative shots created a false impact before server confirmation')
  && probe.includes('miss endpoint is not deterministic or remains inside the target silhouette')
  && probe.includes('shock, heat, fireball, smoke or ember layer')
  && probe.includes('damage Canvas, direction marker or input transparency')
  && probe.includes('ground overlay exposes raw ids or marks more than the nearest item as actionable')
  && probe.includes('world overlay labels overlap at a shared world position')
  && probe.includes('world overlay grew beyond its fixed runtime pools'),
  'Unity editor probe does not inspect the new VFX structure');

for (const file of [
  'RoaCombatPresentationFx.cs.meta',
  'RoaCombatPresentationFx.Motion.cs.meta',
  'RoaCombatPresentationFx.Explosion.cs.meta',
  'RoaCombatPresentationFx.Factory.cs.meta',
  'RoaCombatPresentationFx.Damage.cs.meta',
  'RoaOffhandWeaponView.cs.meta',
  'RoaWorldOverlayCanvas.cs.meta'
]) {
  assert(/guid:\s*[0-9a-f]{32}/i.test(read(game, file)), `${file} has no valid GUID`);
}

assert(/guid:\s*[0-9a-f]{32}/i.test(read('unity-client', 'Assets', 'Editor', 'RoaDualWieldProbe.cs.meta')),
  'RoaDualWieldProbe.cs.meta has no valid GUID');

console.log('Unity combat VFX OK: gait-preserving recoil, collision-gated fire, contact animation, dual IK, authoritative impacts, explosions, directional damage and pooled world overlays');
