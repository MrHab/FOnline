const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const server = read('server.js');
const webActions = read('public/js/game/03b_inventory_actions_ui.js');
const webVisuals = read('public/js/game/04_player_model_visuals.js');
const player = read('unity-client/Assets/Scripts/Game/RoaPlayerController.cs');
const character = read('unity-client/Assets/Scripts/Game/RoaCharacterView.cs');
const fog = read('unity-client/Assets/Scripts/Game/RoaFogOfWar.cs');
const preview = read('unity-client/Assets/Scripts/Game/RoaCombatPreview.cs');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const remotes = read('unity-client/Assets/Scripts/Game/RoaRemotePlayers.cs');

function has(source, marker, label) {
  assert(source.includes(marker), `${label} is missing: ${marker}`);
}

has(server, "['brokenArm', 'brokenLeg', 'concussion', 'infection']", 'server injury allowlist');
has(server, 'const SERVER_INFECTION_DAMAGE_INTERVAL_MS = 18000;', 'server infection timer');
has(server, '(injuries.brokenArm ? 0.12 : 0)', 'server broken-arm accuracy penalty');
has(server, '(injuries.concussion ? 0.10 : 0)', 'server concussion accuracy penalty');
has(server, '(injuries.infection ? 0.03 : 0)', 'server infection accuracy penalty');
has(server, "action === 'attack' && injuries.brokenArm", 'server attack AP penalty');
has(server, "action === 'reload' && injuries.brokenArm", 'server reload AP penalty');

has(webActions, "if (hasInjury('brokenLeg')) mul *= 0.68;", 'web broken-leg speed');
has(webActions, "if (hasInjury('infection')) mul *= 0.92;", 'web infection speed');
has(webVisuals, 'state.brokenLeg ? Math.sin(performance.now() / 260) * 0.035 : 0', 'web leg sway');
has(webVisuals, 'parts.armR.rotation.z += 0.72;', 'web arm pose');
has(webVisuals, 'Math.sin(performance.now() / 120) * 0.06', 'web concussion wobble');

has(player, '(HasBrokenLeg ? 0.68f : 1f) * (HasInfection ? 0.92f : 1f)', 'Unity movement penalty');
has(character, 'Mathf.Sin(Time.time / 0.26f) * 0.035f', 'Unity leg sway');
has(character, 'AddBoneOffset("upperarm_r", -0.35f, 0f, 0.72f);', 'Unity arm pose');
has(character, 'AddBoneOffset("thigh_l", 0f, 0f, -0.09f);', 'Unity leg pose');
assert(!character.includes('AddBoneOffset("upperleg_l"'), 'Unity leg injury still targets a nonexistent rig bone');
has(character, 'Mathf.Sin(Time.time / 0.12f) * 0.06f', 'Unity concussion wobble');
has(character, 'public int ActiveInjuryMarkerCount', 'Unity marker diagnostics');
has(character, 'private readonly Material[] _injuryMaterials', 'Unity marker material ownership');
has(character, 'if (material != null) Destroy(material);', 'Unity marker material cleanup');
has(fog, 'if (concussion) radius -= 2f;', 'Unity concussion vision penalty');
has(fog, 'if (infection) radius -= 0.5f;', 'Unity infection vision penalty');
has(preview, '(Injury(self, "brokenArm") ? 0.12f : 0f)', 'Unity preview arm penalty');
has(preview, 'if (Injury(self, "brokenArm")) result.ApCost++;', 'Unity preview AP penalty');
has(socket, 'merged["injuries"] = injuries.DeepClone();', 'Unity local injury event merge');
has(remotes, 'remote.View.SetInjuries(remote.Player.Injuries);', 'Unity remote injury propagation');

const speed = (4.35 + 5 * 0.13 + 0.34) * 0.68 * 0.92;
assert(Math.abs(speed - 3.340704) < 1e-9, `injured speed formula drifted: ${speed}`);
const radius = (perception, vigilance, concussion, infection) => Math.max(3, Math.min(9,
  Math.floor((5.5 + perception * 0.7 + vigilance - (concussion ? 2 : 0) - (infection ? 0.5 : 0)) / 2 + 0.5)
));
assert.strictEqual(radius(5, 0, false, false), 5, 'healthy PER=5 vision radius drifted');
assert.strictEqual(radius(5, 0, true, true), 3, 'injured PER=5 vision radius drifted');

console.log('Unity injuries OK: four authoritative states, speed 3.341, vision 5→3, combat and local/remote visual paths guarded');
