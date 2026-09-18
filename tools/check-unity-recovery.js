'use strict';

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
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

console.log('Player activity recovery OK: death fails only the active personal activity');
