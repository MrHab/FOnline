#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const DEV_TOKEN = 'mobile-alife-network-check-0123456789abcdef';
process.env.DEV_API_MODE = 'token';
process.env.DEV_ADMIN_TOKEN = DEV_TOKEN;
const h = require('./check-combat-runtime');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kromka-mobile-alife-'));
const economy = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/economy.json'), 'utf8'));
economy.worldModel.dangerEcology = true;
fs.writeFileSync(path.join(scratch, 'economy.json'), JSON.stringify(economy));
process.env.KROMKA_ECONOMY_FILE = path.join(scratch, 'economy.json');
const routes = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/open-world-alife.json'), 'utf8')).anomalyRoutes;
fs.writeFileSync(path.join(scratch, 'open-world-alife.json'), JSON.stringify({ anomalyRoutes: routes, huntingGrounds: [], outposts: [] }));
process.env.KROMKA_OPEN_WORLD_ALIFE_FILE = path.join(scratch, 'open-world-alife.json');
const authored = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/danger-ecology.json'), 'utf8'));
authored.lairs.capacity = { pve: 0, pvp: 0, pvpFullDrop: 0, pvpBlack: 0 };
authored.species = authored.species.filter(row => ['marauder_rovers', 'wandering_gari', 'neutral_stalkers'].includes(row.id))
  .map(row => ({ ...row, stepSeconds: [1, 1], travel: { ...row.travel, count: 1, restMinutes: [0, 0] } }));
fs.writeFileSync(path.join(scratch, 'danger-ecology.json'), JSON.stringify(authored));
process.env.KROMKA_DANGER_ECOLOGY_FILE = path.join(scratch, 'danger-ecology.json');

const devGet = route => new Promise((resolve, reject) => {
  http.get(h.baseUrl() + route, { headers: { 'x-dev-token': DEV_TOKEN } }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await h.startServer();
  try {
    const read = async () => (await devGet('/api/dev/danger-ecology?sx=10&sy=10&radius=40')).near
      .filter(row => ['marauder_rovers', 'wandering_gari', 'neutral_stalkers'].includes(row.speciesId));
    let groups = [];
    for (let i = 0; i < 20 && groups.length < 3; i += 1) { groups = await read(); await delay(500); }
    assert.equal(groups.length, 3, `all authored mobile types spawn without players: ${groups.map(row => row.speciesId).join(',')}`);
    assert(groups.every(row => !row.lairId && row.actors.length === 0), 'mobile groups have no lair or client actors offscreen');
    const initial = new Map(groups.map(row => [row.id, `${row.sx}:${row.sy}`]));
    let moved = false;
    for (let i = 0; i < 30 && !moved; i += 1) {
      await delay(1000);
      groups = await read();
      moved = groups.some(row => initial.has(row.id) && initial.get(row.id) !== `${row.sx}:${row.sy}`);
    }
    assert(moved, 'a mobile group advances to another zone without players');
    const health = await devGet('/health');
    assert(health.ok);
    console.log('PASS marauders, wandering pack and stalkers spawn separately from lairs and move offscreen; /health responds');
  } finally {
    await h.stopServer();
    h.cleanupSync();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(async error => {
  console.error(error);
  console.error(h.serverLogs().slice(-3000));
  await h.stopServer();
  h.cleanupSync();
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exitCode = 1;
});
