'use strict';

function contractToken(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_:-]/g, '').slice(0, 96);
}

function contractNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return String(Math.round(number * 1000) / 1000);
}

function contractList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(contractToken)
    .filter(Boolean))]
    .sort()
    .join(',') || 'none';
}

function contractStockpile(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'none';
  return Object.entries(value)
    .map(([id, amount]) => [contractToken(id), contractNumber(amount)])
    .filter(([id, amount]) => id && amount && Number(amount) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, amount]) => `${id}:${amount}`)
    .join(',') || 'none';
}

function contractMechanicNumbers(details = {}) {
  const fields = [
    'targetUnits', 'bonusUnits', 'maxUnits',
    'targetPoints', 'bonusPoints', 'maxPoints',
    'targetKills', 'bonusKills', 'maxKills',
    'targetSabotage', 'bonusSabotage', 'sabotagePoints',
    'durationSeconds'
  ];
  return fields
    .map(field => [field, contractNumber(details[field])])
    .filter(([, value]) => value)
    .map(([field, value]) => `${field}:${value}`)
    .join(',') || 'none';
}

function worldContractSemanticKey(task = {}, context = {}) {
  const type = contractToken(task.type || 'contract');
  const details = task.details && typeof task.details === 'object' ? task.details : {};
  const operation = task.operation && typeof task.operation === 'object'
    ? task.operation
    : (details.operation && typeof details.operation === 'object' ? details.operation : {});
  const objective = contractToken(
    task.objective
    || details.objective
    || details.activityKind
    || operation.goal?.kind
    || operation.kind
    || type
  );
  if (!type) return `contract:${contractToken(task.id || task.key || 'unknown')}`;

  const partyId = contractToken(context.partyId || task.partyId || '');
  const partyKind = contractToken(context.partyKind || task.targetPartyKind || task.joinPartyKind || details.partyKind || '');
  const actionMode = contractToken(context.actionMode || task.actionMode || details.actionMode || 'contract');
  const issuerFactionId = contractToken(
    context.issuerFactionId
    || task.issuerFactionId
    || details.rewardFactionId
    || operation.issuerFactionId
    || ''
  );
  const requiredFactionId = contractToken(
    context.requiredFactionId
    || task.requiredFactionId
    || details.requiredFactionId
    || ''
  );
  const targetFaction = contractToken(task.targetFaction || details.targetFaction || operation.goal?.targetFaction || '');
  const access = [
    `issuer:${issuerFactionId || 'none'}`,
    `requires:${requiredFactionId || 'none'}`,
    `action:${actionMode || 'contract'}`,
    `party-kind:${partyKind || 'none'}`,
    `target-faction:${targetFaction || 'none'}`
  ].join('|');

  // A party contract points at one physical caravan or patrol. Hiding one
  // instance behind another can advertise a full, departed, or wrong-faction
  // group, so these rows deliberately keep their runtime identity.
  if (partyId) return `${type}:${objective || type}|party:${partyId}|${access}`;

  if (type === 'deliver_supplies') {
    const effect = details.resourceSupport
      ? `resource-support:${contractToken(details.supportReason || 'general')}`
      : details.procurement
        ? 'procurement'
        : contractToken(objective || 'delivery');
    const relief = details.relief && typeof details.relief === 'object'
      ? ['workforce', 'security', 'activityHours']
        .map(field => [field, contractNumber(details.relief[field])])
        .filter(([, value]) => value)
        .map(([field, value]) => `${field}:${value}`)
        .join(',') || 'none'
      : 'none';
    return `${type}:${objective || type}|effect:${effect}|demand:${contractStockpile(details.demand)}|relief:${relief}|${access}`;
  }

  const groupableActivities = new Set([
    'resource_expedition',
    'recon_expedition',
    'outpost_defense',
    'distress_signal',
    'assault_diversion'
  ]);
  if (groupableActivities.has(type)) {
    const resources = type === 'resource_expedition' ? contractList(details.resourceTypes) : 'none';
    return `${type}:${objective || type}|resources:${resources}|mechanics:${contractMechanicNumbers(details)}|${access}`;
  }

  // Unknown, urgent, and conflict contracts stay distinct until their
  // completion rules have an explicit semantic signature above.
  return `${type}:${objective || type}|instance:${contractToken(task.id || task.key || 'unknown')}|${access}`;
}

function dedupeActiveWorldContracts(tasks = [], options = {}) {
  const keyForTask = typeof options.keyForTask === 'function'
    ? options.keyForTask
    : worldContractSemanticKey;
  const seen = new Set();
  const rows = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task !== 'object') continue;
    if (String(task.status || 'active').toLowerCase() !== 'active') {
      rows.push(task);
      continue;
    }
    const key = keyForTask(task);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(task);
  }
  return rows;
}

module.exports = {
  dedupeActiveWorldContracts,
  worldContractSemanticKey
};
