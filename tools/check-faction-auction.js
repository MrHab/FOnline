#!/usr/bin/env node
'use strict';

// Фракционный аукцион под управляемым временем: лимиты и цены, покупка со
// сбором и полкой продавца, запрет покупки своего лота, снятие и истечение с
// возвратом на полку, частичный забор полки, публичная проекция без чужих
// идентификаторов, серверные крючки и Unity-запросы.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const auction = require('../src/server/faction-auction');

const rules = auction.normalizeAuctionRules({});
assert.deepEqual(rules, { listingLifetimeMs: 86400000, maxListingsPerSeller: 8, maxListingsPerFaction: 200, feePct: 0.05, minPrice: 1, maxPrice: 200000, maxQtyPerListing: 200 });
const store = auction.normalizeAuctionStore({});
const t0 = 1700000000000;
const seller = { factionId: 'uprava', sellerCharacterId: 'char-seller', sellerName: 'Продавец' };

// --- выставление -------------------------------------------------------------------
assert.equal(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 0, price: 10 }, rules, t0).error, 'Выберите предмет и количество.');
assert(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 10, price: 0 }, rules, t0).error.includes('Цена'));
assert(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 999, price: 10 }, rules, t0).error.includes('Не больше'));
assert.equal(auction.createListing(store, { factionId: '', sellerCharacterId: 'x', itemId: 'ammo9', qty: 1, price: 1 }, rules, t0).error, 'Аукцион доступен только членам фракции.');
const artifactRecord = { id: 'rec-1', itemRuntimeId: 'rec-1', baseId: 'artifactSpring', artifact: { id: 'rec-1', typeId: 'spring', seed: 'secret', tier: 3 } };
const lot = auction.createListing(store, { ...seller, itemId: 'artifactSpring', qty: 1, price: 300, records: [artifactRecord] }, rules, t0);
assert(lot.ok && lot.listing.id === 'lot_uprava_1' && lot.listing.expiresAt === t0 + rules.listingLifetimeMs);
for (let i = 0; i < rules.maxListingsPerSeller - 1; i += 1) assert(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 10, price: 5 }, rules, t0 + i).ok);
assert(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 10, price: 5 }, rules, t0 + 100).error.includes('лотов'), 'Per-seller limit holds.');
assert.equal(auction.activeListings(store, 'uprava', t0 + 100).length, rules.maxListingsPerSeller);
assert.equal(auction.activeListings(store, 'contour', t0 + 100).length, 0, 'Factions never see each other\'s lots.');

// --- покупка -----------------------------------------------------------------------
assert.equal(auction.buyListing(store, 'uprava', 'lot_uprava_1', 'char-seller', rules, t0 + 200).error, 'Свой лот можно только снять.');
assert.equal(auction.buyListing(store, 'contour', 'lot_uprava_1', 'char-buyer', rules, t0 + 200).error, 'Лот уже снят.');
const bought = auction.buyListing(store, 'uprava', 'lot_uprava_1', 'char-buyer', rules, t0 + 200);
assert(bought.ok && bought.fee === 15 && bought.payout === 285, 'The buyer pays the price, the seller receives it minus the five percent fee.');
assert.deepEqual(bought.listing.records[0].artifact, artifactRecord.artifact, 'The artifact instance travels with the lot.');
assert.equal(auction.buyListing(store, 'uprava', 'lot_uprava_1', 'char-buyer', rules, t0 + 201).error, 'Лот уже снят.');
let shelf = auction.shelfFor(store, 'uprava', 'char-seller');
assert.equal(shelf.silver, 285);
assert.equal(shelf.sales, 1);

// --- снятие и истечение ----------------------------------------------------------------
assert.equal(auction.cancelListing(store, 'uprava', 'lot_uprava_2', 'char-buyer', t0 + 300).error, 'Это не ваш лот.');
assert(auction.cancelListing(store, 'uprava', 'lot_uprava_2', 'char-seller', t0 + 300).ok);
shelf = auction.shelfFor(store, 'uprava', 'char-seller');
assert.deepEqual(shelf.items.map(row => [row.itemId, row.qty, row.reason]), [['ammo9', 10, 'cancelled']]);
assert.equal(auction.expireListings(store, t0 + rules.listingLifetimeMs - 1).length, 0, 'Nothing expires early.');
const expired = auction.expireListings(store, t0 + rules.listingLifetimeMs + 10);
assert.equal(expired.length, rules.maxListingsPerSeller - 2, 'Every remaining lot expires after 24 hours.');
assert.equal(auction.activeListings(store, 'uprava', t0 + rules.listingLifetimeMs + 10).length, 0);
shelf = auction.shelfFor(store, 'uprava', 'char-seller');
assert.equal(shelf.items.length, rules.maxListingsPerSeller - 1);
assert(shelf.items.every(row => ['cancelled', 'expired'].includes(row.reason)));

// --- забор полки частями ---------------------------------------------------------------------
const firstRow = shelf.items[0];
auction.commitShelfClaim(store, 'uprava', 'char-seller', { silver: 100, items: [{ itemId: firstRow.itemId, qty: 4, at: firstRow.at }] });
shelf = auction.shelfFor(store, 'uprava', 'char-seller');
assert.equal(shelf.silver, 185, 'Partial silver claims leave the rest on the shelf.');
assert.equal(shelf.items[0].qty, 6, 'Partial item claims leave the rest on the shelf.');
auction.commitShelfClaim(store, 'uprava', 'char-seller', { silver: 185, items: shelf.items.map(row => ({ itemId: row.itemId, qty: row.qty, at: row.at })) });
shelf = auction.shelfFor(store, 'uprava', 'char-seller');
assert.equal(shelf.silver, 0);
assert.equal(shelf.items.length, 0);

// --- сохранение и проекция -----------------------------------------------------------------
const again = auction.createListing(store, { ...seller, itemId: 'artifactVein', qty: 1, price: 50, records: [artifactRecord] }, rules, t0 + 1000);
assert(again.ok);
const restored = auction.normalizeAuctionStore(JSON.parse(JSON.stringify(store)));
assert.deepEqual(restored, store, 'The auction store survives a JSON round trip.');
const view = auction.publicAuction(store, 'uprava', 'char-buyer', rules, t0 + 2000);
assert.equal(view.listings.length, 1);
assert.equal(view.listings[0].sellerName, 'Продавец');
assert.equal(view.listings[0].mine, false);
assert.equal(view.listings[0].artifactCount, 1);
assert(!('sellerCharacterId' in view.listings[0]) && !('records' in view.listings[0]), 'Seller ids and artifact records stay private.');
assert(!JSON.stringify(view).includes('secret'), 'Artifact seeds never leave the server through the auction.');
assert.equal(auction.publicAuction(store, 'uprava', 'char-seller', rules, t0 + 2000).listings[0].mine, true);

// --- серверные крючки и Unity ----------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  'savesDb.factionAuctions = normalizeAuctionStore(savesDb.factionAuctions)',
  "socket.on('auctionAction'",
  "if (!serverNearbyServiceActor(p, 'auction')) return fail('Аукционер должен быть рядом.');",
  "beginCriticalAction(p, 'auctionAction', data, ['action', 'itemId', 'qty', 'price', 'listingId', 'itemRuntimeId'])",
  'serverCaptureWeaponRuntimeRecords(p, row, validation)',
  'serverRestoreWeaponRuntimeRecords(p, bought.listing.records || [])',
  'function serverClaimAuctionShelf(p, factionId, data = {}, now = Date.now())',
  'serverTickAuctions(Date.now())'
]) assert(server.includes(needle), `server.js is missing the auction contract: ${needle}`);
const unityNet = read('unity-client/Assets/Scripts/Game/RoaAuctionNet.cs');
for (const token of ['"state"', '"list"', '"buy"', '"cancel"', '"claim"', 'EmitWithAck("auctionAction"']) assert(unityNet.includes(token), `RoaAuctionNet is missing ${token}`);

console.log('Faction auction OK: faction-only lots, 5% fee to the seller shelf, cancel/expiry returns, partial shelf claims, private projection and server hooks.');
