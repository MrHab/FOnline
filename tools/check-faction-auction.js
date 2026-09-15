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
assert.deepEqual(rules, {
  durationChoicesMs: [21600000, 43200000, 86400000, 172800000],
  listingLifetimeMs: 86400000,
  maxListingsPerSeller: 8,
  maxListingsPerFaction: 200,
  taxPct: 0.05,
  minBidStepPct: 0.05,
  antiSnipeMs: 120000,
  minPrice: 1,
  maxPrice: 200000,
  maxQtyPerListing: 200
});
// Прежнее имя сбора в авторских данных продолжает задавать налог на продажу.
assert.equal(auction.normalizeAuctionRules({ feePct: 0.12 }).taxPct, 0.12);
// Срок по умолчанию всегда один из предложенных продавцу.
assert(auction.normalizeAuctionRules({ listingLifetimeMs: 999 }).durationChoicesMs.includes(auction.normalizeAuctionRules({ listingLifetimeMs: 999 }).listingLifetimeMs));
const store = auction.normalizeAuctionStore({});
const t0 = 1700000000000;
const day = 86400000;
const seller = { factionId: 'uprava', sellerCharacterId: 'char-seller', sellerName: 'Продавец' };

// --- выставление -------------------------------------------------------------------
assert.equal(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 0, startPrice: 10 }, rules, t0).error, 'Выберите предмет и количество.');
assert(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 10, startPrice: 0 }, rules, t0).error.includes('Стартовая цена'));
assert(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 999, startPrice: 10 }, rules, t0).error.includes('Не больше'));
assert.equal(auction.createListing(store, { factionId: '', sellerCharacterId: 'x', itemId: 'ammo9', qty: 1, startPrice: 1 }, rules, t0).error, 'Аукцион доступен только членам фракции.');
assert.equal(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 10, startPrice: 100, buyoutPrice: 40 }, rules, t0).error, 'Выкуп не может быть дешевле стартовой цены.');
assert.equal(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 10, startPrice: 10, durationMs: 1234 }, rules, t0).error, 'Такого срока выставления нет.');
const artifactRecord = { id: 'rec-1', itemRuntimeId: 'rec-1', baseId: 'artifactSpring', artifact: { id: 'rec-1', typeId: 'spring', seed: 'secret', tier: 3 } };
const lot = auction.createListing(store, {
  ...seller, itemId: 'artifactSpring', category: 'artifacts', qty: 1, startPrice: 300, buyoutPrice: 300, durationMs: day, records: [artifactRecord]
}, rules, t0);
assert(lot.ok && lot.listing.id === 'lot_uprava_1' && lot.listing.expiresAt === t0 + day);
assert.equal(lot.listing.category, 'artifacts', 'The lot keeps the category the server derived from its item catalog.');
assert.equal(auction.createListing(auction.normalizeAuctionStore({}), { ...seller, itemId: 'ore', qty: 1, startPrice: 5, category: 'нет-такой' }, rules, t0).listing.category, 'misc',
  'An unknown category falls back to misc instead of reaching the store.');
for (let i = 0; i < rules.maxListingsPerSeller - 1; i += 1) assert(auction.createListing(store, { ...seller, itemId: 'ammo9', category: 'ammo', qty: 10, startPrice: 5 }, rules, t0 + i).ok);
assert(auction.createListing(store, { ...seller, itemId: 'ammo9', qty: 10, startPrice: 5 }, rules, t0 + 100).error.includes('лотов'), 'Per-seller limit holds.');
assert.equal(auction.activeListings(store, 'uprava', t0 + 100).length, rules.maxListingsPerSeller);
assert.equal(auction.activeListings(store, 'contour', t0 + 100).length, 0, 'Factions never see each other\'s lots.');

// --- ставки ------------------------------------------------------------------------
const bidder = { characterId: 'char-buyer', name: 'Покупатель' };
const rival = { characterId: 'char-rival', name: 'Соперник' };
assert.equal(auction.minimumBid(lot.listing, rules), 300, 'Without bids the minimum is the start price.');
assert.equal(auction.placeBid(store, 'uprava', 'lot_uprava_1', { characterId: 'char-seller' }, 400, rules, t0 + 150).error, 'На свой лот ставку не сделать.');
assert.equal(auction.placeBid(store, 'uprava', 'lot_uprava_1', bidder, 299, rules, t0 + 150).error, 'Ставка от 300 марок.');
assert(auction.placeBid(store, 'uprava', 'lot_uprava_1', bidder, 300, rules, t0 + 150).error.includes('выкуп'), 'A bid at the buyout price is refused in favour of the buyout.');

const bidStore = auction.normalizeAuctionStore({});
const bidLot = auction.createListing(bidStore, { ...seller, itemId: 'rifle', category: 'weapons', qty: 1, startPrice: 100, buyoutPrice: 1000, durationMs: day }, rules, t0).listing;
const firstBid = auction.placeBid(bidStore, 'uprava', bidLot.id, bidder, 100, rules, t0 + 10);
assert(firstBid.ok && firstBid.nextBid === 105, 'The next bid must clear the five percent step.');
assert.equal(auction.placeBid(bidStore, 'uprava', bidLot.id, bidder, 200, rules, t0 + 11).error, 'Ваша ставка уже ведёт.');
assert.equal(auction.placeBid(bidStore, 'uprava', bidLot.id, rival, 104, rules, t0 + 12).error, 'Ставка от 105 марок.');
const secondBid = auction.placeBid(bidStore, 'uprava', bidLot.id, rival, 105, rules, t0 + 13);
assert(secondBid.ok && secondBid.refund.characterId === 'char-buyer' && secondBid.refund.amount === 100, 'An outbid claimant gets every mark back.');
assert.equal(auction.shelfFor(bidStore, 'uprava', 'char-buyer').silver, 100, 'The refund waits on the shelf at the auctioneer.');
assert.equal(auction.cancelListing(bidStore, 'uprava', bidLot.id, 'char-seller', t0 + 14).error, 'На лот уже сделана ставка — торги идут до конца срока.');

// Ставка в последние минуты продлевает торги, а не проигрывает по секундомеру.
const lateAt = t0 + day - 30000;
const lateBid = auction.placeBid(bidStore, 'uprava', bidLot.id, bidder, 200, rules, lateAt);
assert(lateBid.ok && lateBid.extended && lateBid.listing.expiresAt === lateAt + rules.antiSnipeMs, 'Anti-snipe extends the lot to the full window.');
assert.equal(auction.expireListings(bidStore, rules, t0 + day + 10).length, 0, 'The extended lot survives its original deadline.');
const wonAt = lateBid.listing.expiresAt + 1;
const [won] = auction.expireListings(bidStore, rules, wonAt);
assert.equal(won.resolution, 'sold');
assert.equal(won.price, 200);
assert.equal(won.tax, 10, 'The sales tax is five percent of the winning bid.');
assert.equal(won.payout, 190, 'The seller receives the bid minus the tax.');
assert.deepEqual(auction.shelfFor(bidStore, 'uprava', 'char-buyer').items.map(row => [row.itemId, row.qty, row.reason]), [['rifle', 1, 'won']],
  'The winner picks the lot up from their own shelf.');
assert.equal(auction.shelfFor(bidStore, 'uprava', 'char-seller').silver, 190);
assert.equal(auction.shelfFor(bidStore, 'uprava', 'char-rival').silver, 105, 'The losing bid came back when it was outbid.');

// --- выкуп -------------------------------------------------------------------------
assert.equal(auction.buyoutListing(store, 'uprava', 'lot_uprava_1', 'char-seller', rules, t0 + 200).error, 'Свой лот можно только снять.');
assert.equal(auction.buyoutListing(store, 'contour', 'lot_uprava_1', 'char-buyer', rules, t0 + 200).error, 'Лот уже снят.');
const bought = auction.buyoutListing(store, 'uprava', 'lot_uprava_1', 'char-buyer', rules, t0 + 200);
assert(bought.ok && bought.tax === 15 && bought.payout === 285, 'The buyer pays the buyout price, the seller receives it minus the five percent tax.');
assert.deepEqual(bought.listing.records[0].artifact, artifactRecord.artifact, 'The artifact instance travels with the lot.');
assert.equal(auction.buyoutListing(store, 'uprava', 'lot_uprava_1', 'char-buyer', rules, t0 + 201).error, 'Лот уже снят.');
const noBuyout = auction.createListing(bidStore, { ...seller, itemId: 'ore', category: 'materials', qty: 3, startPrice: 20, buyoutPrice: 0 }, rules, t0 + 300);
assert.equal(auction.buyoutListing(bidStore, 'uprava', noBuyout.listing.id, 'char-buyer', rules, t0 + 310).error, 'У этого лота нет цены выкупа.',
  'A lot listed without a buyout can only be won by bidding.');
let shelf = auction.shelfFor(store, 'uprava', 'char-seller');
assert.equal(shelf.silver, 285);
assert.equal(shelf.sales, 1);

// --- снятие и истечение ----------------------------------------------------------------
assert.equal(auction.cancelListing(store, 'uprava', 'lot_uprava_2', 'char-buyer', t0 + 300).error, 'Это не ваш лот.');
assert(auction.cancelListing(store, 'uprava', 'lot_uprava_2', 'char-seller', t0 + 300).ok);
shelf = auction.shelfFor(store, 'uprava', 'char-seller');
assert.deepEqual(shelf.items.map(row => [row.itemId, row.qty, row.reason]), [['ammo9', 10, 'cancelled']]);
assert.equal(auction.expireListings(store, rules, t0 + rules.listingLifetimeMs - 1).length, 0, 'Nothing expires early.');
const expired = auction.expireListings(store, rules, t0 + rules.listingLifetimeMs + 10);
assert.equal(expired.length, rules.maxListingsPerSeller - 2, 'Every remaining lot expires after its own deadline.');
assert(expired.every(row => row.resolution === 'expired'), 'Lots nobody bid on simply come back.');
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
const again = auction.createListing(store, {
  ...seller, itemId: 'artifactVein', category: 'artifacts', qty: 1, startPrice: 50, buyoutPrice: 400, durationMs: day, records: [artifactRecord]
}, rules, t0 + 1000);
assert(again.ok);
const restored = auction.normalizeAuctionStore(JSON.parse(JSON.stringify(store)));
assert.deepEqual(restored, store, 'The auction store survives a JSON round trip.');
const view = auction.publicAuction(store, 'uprava', 'char-buyer', rules, t0 + 2000);
assert.equal(view.listings.length, 1);
assert.equal(view.listings[0].sellerName, 'Продавец');
assert.equal(view.listings[0].mine, false);
assert.equal(view.listings[0].artifactCount, 1);
assert.equal(view.listings[0].startPrice, 50);
assert.equal(view.listings[0].buyoutPrice, 400);
assert.equal(view.listings[0].nextBid, 50, 'Until somebody bids, the next bid is the start price.');
assert.equal(view.listings[0].durationHours, 24);
assert.equal(view.taxPct, rules.taxPct);
assert.deepEqual(view.durationChoicesHours, [6, 12, 24, 48], 'The seller form gets its terms from the server.');
assert.deepEqual(view.categories.filter(row => row.count).map(row => [row.id, row.count]), [['artifacts', 1]],
  'Categories carry their own counts, so the interface can filter without guessing.');
assert(view.categories.every(row => row.label), 'Every category comes with its Russian label.');
assert.equal(view.limits.maxQtyPerListing, rules.maxQtyPerListing);
assert(!('sellerCharacterId' in view.listings[0]) && !('bidderCharacterId' in view.listings[0]) && !('records' in view.listings[0]),
  'Seller and bidder ids and artifact records stay private.');
assert(!JSON.stringify(view).includes('secret'), 'Artifact seeds never leave the server through the auction.');
assert.equal(auction.publicAuction(store, 'uprava', 'char-seller', rules, t0 + 2000).listings[0].mine, true);
assert.deepEqual(view.listings[0].artifacts, [], 'Without a projection the lot exposes nothing but the counter.');

// Состояние артефакта видно до покупки: проекцию передаёт сервер, скрытый ролл
// в неё не попадает.
const { publicArtifactRecord } = require('../src/server/artifact-instances');
const artifactCatalog = JSON.parse(read('data/artifacts.json'));
const shown = auction.publicAuction(store, 'uprava', 'char-buyer', rules, t0 + 2000, {
  projectArtifact: record => publicArtifactRecord(record, artifactCatalog)
});
const lotArtifact = shown.listings[0].artifacts[0];
assert(lotArtifact, 'The lot carries the projected artifact: ' + JSON.stringify(shown.listings[0]));
assert(lotArtifact.tier >= 1 && lotArtifact.tierColor && typeof lotArtifact.stabilized === 'boolean',
  'A buyer sees the kind, the tier and whether the artifact is stabilized.');
assert(!('seed' in lotArtifact), 'The seed never reaches the buyer.');
assert(!JSON.stringify(shown).includes('secret'), 'Hidden rolls never leave the server through the auction projection.');

// --- серверные крючки и Unity ----------------------------------------------------------------
const server = read('server.js');
for (const needle of [
  'savesDb.factionAuctions = normalizeAuctionStore(savesDb.factionAuctions)',
  "socket.on('auctionAction'",
  "if (!serverNearbyServiceActor(p, 'auction')) return fail('Аукционер должен быть рядом.');",
  "['action', 'itemId', 'qty', 'startPrice', 'buyoutPrice', 'durationHours', 'amount', 'listingId', 'itemRuntimeId']",
  "if (!['list', 'bid', 'buyout', 'cancel', 'claim'].includes(action)) return fail('Неизвестное действие аукциона.');",
  'serverCaptureWeaponRuntimeRecords(p, row, validation)',
  'serverRestoreWeaponRuntimeRecords(p, bought.listing.records || [])',
  'category: KROMKA_ITEM_INDEXES.categories[itemId]',
  // Марки ставки снимаются сразу, иначе лот держал бы обещание, а не деньги.
  'serverInventoryRemove(p, \'silver\', amount);',
  'auctionExpireListings(serverAuctionStore(), KROMKA_AUCTION_RULES, now)',
  'function serverClaimAuctionShelf(p, factionId, data = {}, now = Date.now())',
  'serverTickAuctions(Date.now())'
]) assert(server.includes(needle), `server.js is missing the auction contract: ${needle}`);
const unityNet = read('unity-client/Assets/Scripts/Game/RoaAuctionNet.cs');
for (const token of ['"state"', '"list"', '"bid"', '"buyout"', '"cancel"', '"claim"', 'EmitWithAck("auctionAction"']) assert(unityNet.includes(token), `RoaAuctionNet is missing ${token}`);
// Отдельный экран аукционера: открывается взаимодействием, без вариантов диалога.
const unityCanvas = read('unity-client/Assets/Scripts/Game/RoaAuctionCanvas.cs');
for (const token of ['ТОРГИ', 'Ставка', 'Выкуп', 'durationChoicesHours', 'taxPct', 'categories']) {
  assert(unityCanvas.includes(token), `RoaAuctionCanvas is missing ${token}`);
}
const unityDialogue = read('unity-client/Assets/Scripts/Game/RoaDialogueCanvas.cs');
assert(!unityDialogue.includes('AddAuctionOptions'), 'The auctioneer opens its own screen, so the dialogue keeps no auction options.');

console.log('Faction auction OK: categories and terms, bids with anti-snipe and refunds, buyout, 5% sales tax to the seller shelf, cancel/expiry returns, partial shelf claims, private projection, server hooks and the standalone auction screen.');
