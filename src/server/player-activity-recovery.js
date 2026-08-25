'use strict';

function planFailedPlayerActivities(options = {}) {
  const acceptedIds = Array.isArray(options.acceptedIds)
    ? options.acceptedIds.map(value => String(value || '')).filter(Boolean)
    : [];
  const accepted = new Set(acceptedIds);
  const playableTypes = options.playableTypes instanceof Set
    ? options.playableTypes
    : new Set(Array.isArray(options.playableTypes) ? options.playableTypes.map(String) : []);
  const failedTasks = (Array.isArray(options.tasks) ? options.tasks : []).filter(task => (
    task
    && String(task.status || '') === 'active'
    && playableTypes.has(String(task.type || ''))
    && accepted.has(String(task.id || ''))
  ));
  const failedIds = [...new Set(failedTasks.map(task => String(task.id || '')).filter(Boolean))];
  const failed = new Set(failedIds);
  const trackedId = String(options.trackedId || '');
  return {
    failedTasks,
    failedIds,
    remainingAcceptedIds: acceptedIds.filter(id => !failed.has(id)),
    trackedId: failed.has(trackedId) ? '' : trackedId
  };
}

module.exports = { planFailedPlayerActivities };
