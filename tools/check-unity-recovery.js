'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = path.join('unity-client', 'Assets', 'Scripts', 'Game');
const server = read('server.js');
const bootstrap = read(game, 'RoaGameBootstrap.cs');
const recovery = read(game, 'RoaRecoveryCanvas.cs');
const activity = read(game, 'RoaWorldActivityCanvas.cs');
const probe = read('unity-client', 'Assets', 'Editor', 'RoaRecoveryCanvasProbe.cs');
const { planFailedPlayerActivities } = require(path.join(root, 'src', 'server', 'player-activity-recovery'));

const deathPlan = planFailedPlayerActivities({
  acceptedIds: ['activity_active', 'delivery_active', 'activity_finished'],
  trackedId: 'activity_active',
  playableTypes: new Set(['resource_expedition', 'recon_expedition']),
  tasks: [
    { id: 'activity_active', type: 'resource_expedition', status: 'active' },
    { id: 'delivery_active', type: 'deliver_supplies', status: 'active' },
    { id: 'activity_finished', type: 'recon_expedition', status: 'completed' },
    { id: 'not_accepted', type: 'recon_expedition', status: 'active' }
  ]
});
assert.deepStrictEqual(deathPlan.failedIds, ['activity_active'],
  'Death plan failed unrelated, finished or unaccepted tasks');
assert.deepStrictEqual(deathPlan.remainingAcceptedIds, ['delivery_active', 'activity_finished'],
  'Death plan removed unrelated accepted work');
assert.strictEqual(deathPlan.trackedId, '', 'Failed activity stayed tracked');

assert(server.includes("require('./src/server/player-activity-recovery')")
  && server.includes('function failServerPlayerActiveWorldActivities')
  && server.includes("failServerPlayerActiveWorldActivities(p, 'player_died')")
  && server.includes("status: 'failed'")
  && server.includes("reason\n    });"),
  'Death does not close the player participation as a failed activity');
assert(server.includes('failedWorldActivityIds,')
  && server.includes('activityResult: sanitizeServerWorldActivityResult(p.lastWorldActivityResult)'),
  'Respawn payload does not explain the failed activity');
assert(bootstrap.includes('gameObject.AddComponent<RoaRecoveryCanvas>()')
  && bootstrap.includes('RecoveryCanvas.Configure(Socket, this);'),
  'Recovery UI is not connected to the Unity bootstrap');
assert(recovery.includes('Socket.OnServerRespawn += HandleRespawn;')
  && recovery.includes('Bootstrap.InGame')
  && recovery.includes('CauseText')
  && recovery.includes('StateText')
  && recovery.includes('NextText'),
  'Recovery UI does not wait for the loaded world or explain the outcome');
assert(recovery.includes('background.raycastTarget = false;')
  && recovery.includes('RoaGameBootstrap.BlocksWorldHud')
  && recovery.includes('ПРОДОЛЖИТЬ'),
  'Recovery UI can trap input or has no explicit continuation');
assert(activity.includes('private bool _resultPending;')
  && activity.includes('Bootstrap.InGame && !Bootstrap.FrontendVisible')
  && activity.includes('bool running = status == "active" || status == "extracting";')
  && activity.includes('_resultRoot.GetComponent<Image>().raycastTarget = false;'),
  'Activity result can expire during loading, expose dead actions or block input');
assert(activity.includes('FailureSummary')
  && activity.includes('Дойдите до края локации'),
  'Failed activity does not explain the reason and exit');
assert(probe.includes('public static void RunBatch()')
  && probe.includes('raycastGraphics == 1')
  && probe.includes('[ВОССТАНОВЛЕНИЕ] готово'),
  'Unity recovery probe does not cover copy and input transparency');

for (const file of ['RoaRecoveryCanvas.cs.meta']) {
  assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(read(game, file)),
    file + ' has invalid metadata');
}
assert(/^fileFormatVersion: 2\r?\nguid: [0-9a-f]{32}\r?\n?$/.test(
  read('unity-client', 'Assets', 'Editor', 'RoaRecoveryCanvasProbe.cs.meta')),
  'RoaRecoveryCanvasProbe.cs.meta has invalid metadata');

console.log('Unity recovery OK: death fails personal activity, respawn explains losses and failure exits stay usable');
