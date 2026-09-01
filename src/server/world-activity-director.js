'use strict';

const WORLD_ACTIVITY_DIRECTOR_SCHEMA = 'realm.worldActivityDirector.v1';
const WORLD_ACTIVITY_STALL_MS = 20000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function objective(activity, id) {
  return (Array.isArray(activity?.objectives) ? activity.objectives : [])
    .find(row => String(row?.id || '') === id) || null;
}

function combatObjective(activity) {
  const kind = String(activity?.kind || '');
  if (kind === 'outpost_defense') return objective(activity, 'attackers');
  if (kind === 'distress_signal' && Number(objective(activity, 'distress_signal')?.current || 0) >= 1) {
    return objective(activity, 'attackers');
  }
  if (kind === 'assault_diversion' && String(activity?.approach || '') === 'assault') {
    return objective(activity, 'attackers');
  }
  return null;
}

function directorCue(activity) {
  const kind = String(activity?.kind || '');
  const phase = String(activity?.phase || '');
  if (phase === 'extraction') return kind === 'outpost_defense'
    ? 'defense_complete'
    : kind === 'distress_signal' ? 'rescue_complete' : 'evacuate';
  if (kind === 'outpost_defense') return 'hold_outpost';
  if (kind === 'distress_signal') return phase === 'searching' ? 'find_signal' : 'clear_ambush';
  if (kind === 'assault_diversion') return phase === 'assaulting' ? 'break_defenders'
    : phase === 'sabotaging' ? 'sabotage_targets' : 'choose_approach';
  if (kind === 'recon_expedition') return 'survey_points';
  if (kind === 'resource_expedition') return 'collect_resources';
  return 'complete_objective';
}

/**
 * Produces a deterministic pacing decision without mutating room or activity
 * state. The server owns spawning; tests can still prove that every combat
 * branch always has enough live targets to reach its authored maximum.
 */
function planWorldActivityDirector(activity, context = {}, now = Date.now()) {
  const status = String(activity?.status || '');
  const running = status === 'active' || status === 'extracting';
  const currentObjective = combatObjective(activity);
  const current = Math.max(0, Math.floor(Number(currentObjective?.current || 0)));
  const target = Math.max(0, Math.floor(Number(currentObjective?.target || 0)));
  const maximum = Math.max(target, Math.floor(Number(currentObjective?.maxTarget || target)));
  const remainingRequired = Math.max(0, target - current);
  const remainingTotal = Math.max(0, maximum - current);
  const liveHostiles = Math.max(0, Math.floor(Number(context.liveHostiles || 0)));
  const participants = Math.max(1, Math.floor(Number(context.participantCount
    || activity?.participants?.length || 1)));
  const desiredHostiles = !running || !currentObjective || remainingTotal <= 0
    ? 0
    : Math.min(remainingTotal, remainingRequired > 0
      ? clamp(participants + 1, 2, 4)
      : 1);
  const spawnCount = Math.max(0, desiredHostiles - liveHostiles);
  const lastProgressAt = Math.max(Number(activity?.startedAt || now),
    Number(activity?.lastProgressAt || activity?.startedAt || now));
  const stalled = running && !activity?.extractionOpen
    && context.objectiveUnavailable === true
    && Number(now || Date.now()) - lastProgressAt >= WORLD_ACTIVITY_STALL_MS;
  const secondsRemaining = Math.max(0, Math.ceil((Number(activity?.endsAt || now) - Number(now || Date.now())) / 1000));
  const warning = secondsRemaining <= 15 ? 'final_seconds'
    : secondsRemaining <= 60 ? 'one_minute'
      : stalled ? 'stalled' : '';

  return {
    schema: WORLD_ACTIVITY_DIRECTOR_SCHEMA,
    cue: directorCue(activity),
    warning,
    stalled,
    combatReady: !!currentObjective,
    remainingRequired,
    remainingTotal,
    desiredHostiles,
    liveHostiles,
    spawnCount,
    recoveryNeeded: stalled && !!currentObjective && spawnCount > 0
      && context.combatStarted === true
  };
}

module.exports = {
  WORLD_ACTIVITY_DIRECTOR_SCHEMA,
  WORLD_ACTIVITY_STALL_MS,
  combatObjective,
  directorCue,
  planWorldActivityDirector
};
