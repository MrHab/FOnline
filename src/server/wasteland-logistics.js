'use strict';

const CARGO_LEDGER_VERSION = 1;
const CARGO_LEDGER_LIMIT = 240;

function compactCargo(cargo = {}) {
  return Object.fromEntries(Object.entries(cargo || {})
    .map(([id, qty]) => [String(id || '').slice(0, 64), Math.max(0, Math.floor(Number(qty || 0)))])
    .filter(([id, qty]) => id && qty > 0));
}

function cargoTransactionId(party = {}, worldHour = 0) {
  const existing = String(party.cargoTransactionId || '').trim();
  if (existing) return existing.slice(0, 96);
  const sequence = Math.max(0, Math.floor(Number(party.cargoTransactionSequence || 0)));
  return `cargo:${String(party.id || 'party').slice(0, 64)}:${Math.floor(Number(party.createdHour ?? worldHour) * 100)}:${sequence}`;
}

function registerCargoDeparture(ledger = {}, party = {}, sourceSiteId = '', destinationSiteId = '', worldHour = 0) {
  const activeId = String(party.cargoTransactionId || '').trim();
  if (activeId && ledger[activeId]) return { ledger, transaction: ledger[activeId], created: false };
  let sequence = Math.max(0, Math.floor(Number(party.cargoTransactionSequence || 0)));
  let id = cargoTransactionId({ ...party, cargoTransactionSequence: sequence }, worldHour);
  while (ledger[id]) {
    sequence += 1;
    id = cargoTransactionId({ ...party, cargoTransactionSequence: sequence }, worldHour);
  }
  const transaction = {
    version: CARGO_LEDGER_VERSION,
    id,
    partyId: String(party.id || '').slice(0, 64),
    sourceSiteId: String(sourceSiteId || party.homeSiteId || '').slice(0, 64),
    destinationSiteId: String(destinationSiteId || party.destinationSiteId || '').slice(0, 64),
    cargo: compactCargo(party.cargo),
    status: 'in_transit',
    departedHour: Number(Number(worldHour || 0).toFixed(2)),
    settledHour: 0
  };
  ledger[id] = transaction;
  party.cargoTransactionId = id;
  party.cargoTransactionSequence = sequence + 1;
  return { ledger, transaction, created: true };
}

function settleCargoArrival(ledger = {}, party = {}, siteId = '', cargo = {}, worldHour = 0) {
  const id = cargoTransactionId(party, worldHour);
  const previous = ledger[id];
  if (previous?.status === 'delivered') return { duplicate: true, transaction: previous };
  const transaction = previous || registerCargoDeparture(
    ledger, party, party.homeSiteId, party.destinationSiteId || siteId, worldHour
  ).transaction;
  transaction.status = 'delivered';
  transaction.destinationSiteId = String(siteId || transaction.destinationSiteId || '').slice(0, 64);
  transaction.deliveredCargo = compactCargo(cargo);
  transaction.settledHour = Number(Number(worldHour || 0).toFixed(2));
  return { duplicate: false, transaction };
}

function settleCargoLoss(ledger = {}, party = {}, reason = 'caravan_destroyed', worldHour = 0) {
  const id = cargoTransactionId(party, worldHour);
  const previous = ledger[id];
  if (previous?.status === 'lost') return { duplicate: true, transaction: previous };
  if (previous?.status === 'delivered') return { duplicate: true, transaction: previous };
  const transaction = previous || registerCargoDeparture(
    ledger, party, party.homeSiteId, party.destinationSiteId, worldHour
  ).transaction;
  transaction.status = 'lost';
  transaction.lostCargo = compactCargo(party.cargo);
  transaction.lossReason = String(reason || 'caravan_destroyed').slice(0, 64);
  transaction.settledHour = Number(Number(worldHour || 0).toFixed(2));
  return { duplicate: false, transaction };
}

function pruneCargoLedger(ledger = {}, limit = CARGO_LEDGER_LIMIT) {
  const rows = Object.values(ledger || {}).sort((a, b) => (
    Number(b.settledHour || b.departedHour || 0) - Number(a.settledHour || a.departedHour || 0)
  )).slice(0, Math.max(1, limit));
  return Object.fromEntries(rows.map(row => [row.id, row]));
}

module.exports = {
  CARGO_LEDGER_LIMIT,
  CARGO_LEDGER_VERSION,
  cargoTransactionId,
  pruneCargoLedger,
  registerCargoDeparture,
  settleCargoArrival,
  settleCargoLoss
};
