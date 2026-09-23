'use strict';

const CHANNELS = new Set(['world', 'local', 'faction', 'group', 'clan']);
const MAX_MESSAGE_LENGTH = 240;
const LOCAL_RADIUS = 45;

function cleanChatText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function chatChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  return CHANNELS.has(channel) ? channel : '';
}

function chatScope(player, channel) {
  if (!player) return '';
  switch (channel) {
    case 'world': return 'world';
    case 'local': return String(player.roomId || '');
    case 'faction': return String(player.worldFactionId || player.factionId ||
      player.territoryFaction?.factionId || '');
    case 'group': return String(player.attachedPartyId || '');
    case 'clan': return String(player.chatClanId || player.socialState?.clan?.id || '');
    default: return '';
  }
}

function chatRecipients(sender, players, channel) {
  const scope = chatScope(sender, channel);
  if (!scope || !CHANNELS.has(channel)) return [];
  return [...players].filter(receiver => {
    if (!receiver || !receiver.id || chatScope(receiver, channel) !== scope) return false;
    if (channel !== 'local') return true;
    const dx = Number(receiver.x) - Number(sender.x);
    const dz = Number(receiver.z) - Number(sender.z);
    return Number.isFinite(dx) && Number.isFinite(dz)
      && dx * dx + dz * dz <= LOCAL_RADIUS * LOCAL_RADIUS;
  });
}

module.exports = { cleanChatText, chatChannel, chatScope, chatRecipients,
  MAX_MESSAGE_LENGTH, LOCAL_RADIUS };
