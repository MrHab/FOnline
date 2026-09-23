#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('./check-combat-runtime');

const accounts = [];

async function register(role) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const login = `chat_${role}_${suffix}`;
  const password = `chat-pass-${suffix}`;
  const deviceId = `chat-device-${role}-${suffix}`;
  const response = await fetch(h.baseUrl() + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, email: `${login}@example.test`, password,
      deviceId, deviceType: 'desktop', controlType: 'keyboard_mouse' })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true, JSON.stringify(body));
  const account = {
    role, login, password, deviceId,
    clientInstanceId: `chat-client-${role}-${suffix}`,
    characterId: `c_chat_${role}_${suffix}`,
    name: `Chat ${role}`, token: body.token
  };
  accounts.push(account);
  await h.connectAndJoin(account);
  return account;
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chat delivery timed out')), 3000);
    socket.once('playerChatMessage', message => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

(async () => {
  try {
    await h.startServer();
    const sender = await register('sender');
    const receiver = await register('receiver');
    const senderMessage = nextMessage(sender.socket);
    const receiverMessage = nextMessage(receiver.socket);
    const ack = await h.socketAck(sender.socket, 'playerChatSend',
      { channel: 'world', text: '  Привет <мир>  ' });
    assert.equal(ack.ok, true, JSON.stringify(ack));
    for (const message of await Promise.all([senderMessage, receiverMessage])) {
      assert.equal(message.channel, 'world');
      assert.equal(message.text, 'Привет мир');
      assert.equal(message.senderId, sender.characterId);
    }
    const cooldown = await h.socketAck(sender.socket, 'playerChatSend',
      { channel: 'world', text: 'too soon' });
    assert.equal(cooldown.ok, false);
    const invalid = await h.socketAck(sender.socket, 'playerChatSend',
      { channel: 'private', text: 'not a channel' });
    assert.equal(invalid.ok, false);
    console.log('Player chat network: world delivery, sanitation and rejection passed.');
  } finally {
    for (const account of accounts) h.closeSocket(account);
    await h.stopServer();
    h.cleanupSync();
  }
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs().slice(-4000));
  process.exitCode = 1;
});
