'use strict';

const assert = require('assert');
const {
  beginCriticalAction,
  commitCriticalAction,
  sanitizeCriticalActionLedger
} = require('../src/server/kromka-critical-actions');

const player = { criticalActionLedger: [] };
const request = {
  requestId: 'req_friend_001',
  action: 'friend',
  targetId: 'char_target'
};
const first = beginCriticalAction(player, 'socialAction', request, ['action', 'targetId'], 1000);
assert(first.ok && !first.replay, 'the first critical action must execute');
commitCriticalAction(player, first, { ok: true, action: 'friend', targetId: 'char_target', message: 'sent' });
assert.strictEqual(player.criticalActionLedger.length, 1, 'the action must be journalled');

const repeated = beginCriticalAction(player, 'socialAction', request, ['action', 'targetId'], 2000);
assert(repeated.ok && repeated.replay && repeated.result.reused, 'a repeated request must replay');

const restored = { criticalActionLedger: sanitizeCriticalActionLedger(JSON.parse(JSON.stringify(player.criticalActionLedger))) };
const afterReconnect = beginCriticalAction(restored, 'socialAction', request, ['action', 'targetId'], 3000);
assert(afterReconnect.ok && afterReconnect.replay, 'the replay guard must survive reconnect/save restoration');

const collision = beginCriticalAction(restored, 'socialAction', { ...request, targetId: 'char_other' }, ['action', 'targetId'], 4000);
assert(!collision.ok, 'one request id must not be reused with different mutation data');

const legacy = beginCriticalAction({}, 'socialAction', { action: 'friend' }, ['action'], 5000);
assert(legacy.ok && legacy.untracked, 'an older client without requestId must remain compatible');

console.log('KRM-20 critical action ledger OK: replay, reconnect, collision and legacy compatibility');
