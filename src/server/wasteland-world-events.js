'use strict';

const SETTLEMENT_CAUSE_HISTORY_LIMIT = 12;

const DEFAULT_CAUSES = {
  stable_supplies: {
    reason: 'основные склады обеспечивают жителей',
    forecast: 'при текущем расходе положение останется стабильным',
    actions: ['плановая торговля', 'сопровождение караванов']
  },
  low_water: {
    reason: 'запас питьевой воды подходит к аварийному уровню',
    forecast: 'без поставки начнутся очереди и остановка мастерских',
    actions: ['доставить воду', 'сопроводить водный караван']
  },
  low_food: {
    reason: 'продовольственный склад не покрывает текущий расход',
    forecast: 'достаток и здоровье продолжат снижаться',
    actions: ['доставить пищу', 'защитить фермерский маршрут']
  },
  low_medicine: {
    reason: 'медицинский резерв почти исчерпан',
    forecast: 'лечение подорожает, здоровье жителей ухудшится',
    actions: ['доставить лекарства', 'найти медицинский груз']
  },
  unsafe_roads: {
    reason: 'угрозы на дорогах сорвали снабжение',
    forecast: 'следующий караван потребует охрану или выберет обход',
    actions: ['разведать дорогу', 'защитить караван']
  },
  damaged_infrastructure: {
    reason: 'насосы и мастерские требуют ремонта',
    forecast: 'производство останется ограниченным до ремонта',
    actions: ['доставить лом', 'выполнить ремонт']
  },
  recovering: {
    reason: 'поставка пришла, но последствия кризиса ещё не устранены',
    forecast: 'здоровье и службы восстановятся постепенно',
    actions: ['поддержать ремонт', 'доставить медикаменты']
  }
};

function causeDefinition(code = '', configured = {}) {
  return configured?.[code] || DEFAULT_CAUSES[code] || DEFAULT_CAUSES.stable_supplies;
}

function appendSettlementConsequence(history = [], entry = {}, limit = SETTLEMENT_CAUSE_HISTORY_LIMIT) {
  const normalized = {
    worldHour: Number(Number(entry.worldHour || 0).toFixed(2)),
    causeCode: String(entry.causeCode || 'stable_supplies').slice(0, 48),
    state: String(entry.state || 'stable').slice(0, 24),
    text: String(entry.text || entry.reason || '').slice(0, 180)
  };
  const previous = Array.isArray(history) ? history : [];
  const head = previous[0];
  if (head && head.causeCode === normalized.causeCode && head.state === normalized.state) return previous.slice(0, limit);
  return [normalized, ...previous].slice(0, limit);
}

function publicCause(causeCode = '', configured = {}, context = {}) {
  const definition = causeDefinition(causeCode, configured);
  return {
    causeCode,
    reason: String(context.reason || definition.reason || '').slice(0, 180),
    forecast: String(context.forecast || definition.forecast || '').slice(0, 180),
    actions: (Array.isArray(context.actions) ? context.actions : definition.actions || [])
      .map(value => String(value || '').slice(0, 80))
      .filter(Boolean)
      .slice(0, 4)
  };
}

module.exports = {
  DEFAULT_CAUSES,
  SETTLEMENT_CAUSE_HISTORY_LIMIT,
  appendSettlementConsequence,
  causeDefinition,
  publicCause
};
