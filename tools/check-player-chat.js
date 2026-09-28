'use strict';

const assert = require('node:assert/strict');
const { cleanChatText, chatChannel, chatScope, chatRecipients,
  MAX_MESSAGE_LENGTH, LOCAL_RADIUS } = require('../src/server/player-chat');

const player = (id, extra = {}) => ({
  id, roomId: 'settlement:1', x: 0, z: 0,
  territoryFaction: { factionId: 'wardens' }, attachedPartyId: 'caravan-7',
  chatClanId: 'clan-4', ...extra
});
const sender = player('sender');
const same = player('same', { x: 10 });
const far = player('far', { x: LOCAL_RADIUS + 1 });
const otherRoom = player('other-room', { roomId: 'ruins:2' });
const otherFaction = player('other-faction', {
  territoryFaction: { factionId: 'free' }
});
const otherGroup = player('other-group', { attachedPartyId: 'caravan-8' });
const otherClan = player('other-clan', { chatClanId: 'clan-5' });
const players = [sender, same, far, otherRoom, otherFaction, otherGroup, otherClan];
const ids = channel => chatRecipients(sender, players, channel).map(row => row.id);

assert.equal(chatChannel(' World '), 'world');
assert.equal(chatChannel('private'), '');
assert.equal(cleanChatText('  Привет\n<мир>   '), 'Привет мир');
assert.equal(cleanChatText('x'.repeat(MAX_MESSAGE_LENGTH + 30)).length, MAX_MESSAGE_LENGTH);
assert.deepEqual(ids('world'), players.map(row => row.id));
assert.deepEqual(ids('local'), ['sender', 'same', 'other-faction', 'other-group', 'other-clan']);
assert.deepEqual(ids('faction'), ['sender', 'same', 'far', 'other-room', 'other-group', 'other-clan']);
assert.deepEqual(ids('group'), ['sender', 'same', 'far', 'other-room', 'other-faction', 'other-clan']);
assert.deepEqual(ids('clan'), ['sender', 'same', 'far', 'other-room', 'other-faction', 'other-group']);
assert.equal(chatScope(player('solo', { attachedPartyId: '' }), 'group'), '');
assert.deepEqual(chatRecipients(player('solo', { chatClanId: '' }), players, 'clan'), []);

console.log('Player chat: all five channels route to the right players.');
