'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const game = (...parts) => read('unity-client', 'Assets', 'Scripts', 'Game', ...parts);
const editor = (...parts) => read('unity-client', 'Assets', 'Editor', ...parts);

const feedback = game('RoaEconomyFeedback.cs');
const canvas = game('RoaHudCanvas.EconomyFeedback.cs');
const hud = game('RoaHudCanvas.cs');
const groundItems = game('RoaGroundItems.cs');
const audio = game('RoaAudio.cs');
const probe = editor('RoaEconomyFeedbackProbe.cs');
const audit = editor('RoaClientAuditRunner.cs');
const feedbackMeta = game('RoaEconomyFeedback.cs.meta');
const canvasMeta = game('RoaHudCanvas.EconomyFeedback.cs.meta');
const probeMeta = editor('RoaEconomyFeedbackProbe.cs.meta');

assert(feedback.includes('Read(JObject payload, RoaEconomySnapshot previous = null)')
  && feedback.includes('if (payload["inventory"] is JArray inventory)')
  && feedback.includes('previous != null ? previous.Copy()'),
'Economy feedback no longer merges partial authoritative self snapshots safely');
assert(feedback.includes('next.Level > previous.Level')
  && feedback.includes('next.Level == previous.Level && next.Xp > previous.Xp'),
'Experience and level rollover feedback is incomplete');
assert(feedback.includes('payload["equipmentRuntime"] as JObject')
  && feedback.includes('EquipmentItems')
  && probe.includes('moving owned armor between bag and equipment'),
'Moving an owned item between bag and equipment can look like gain or spend');
assert(feedback.includes('RoaItemCategories.Category(id) != "ammo"'),
'Ordinary ammunition consumption can spam the reward rail');
assert(feedback.includes('RoaItemData.Name(notice.ItemId)')
  && feedback.includes('SampleToast(float age, float lifetime)'),
'Reward notifications expose raw ids or lost their bounded transition');

assert(canvas.includes('_economySocket.OnJoined += HandleEconomyJoined;')
  && canvas.includes('_economySocket.OnAuthoritativeSelf += HandleEconomySelf;')
  && canvas.includes('_economySocket.OnDisconnected += HandleEconomyDisconnected;'),
'Reward feedback is not connected to join-safe authoritative state');
assert(canvas.includes('_economyBaseline = RoaEconomyFeedback.Read(ack?.Self);')
  && canvas.includes('if (_economyBaseline == null)')
  && canvas.includes('RoaEconomyFeedback.Diff(_economyBaseline, next)'),
'Initial or reconnect snapshots can replay the whole inventory as rewards');
assert(canvas.includes('RoaEconomyFeedback.MaxVisible')
  && canvas.includes('RoaEconomyFeedback.MaxQueued')
  && canvas.includes('mobile ? 0.88f : 1f'),
'Reward rail lost its bounded queue or mobile layout');
assert(canvas.includes('PlayEconomyCue(RoaEconomyNoticeKind.LevelUp)')
  && canvas.includes('PlayEconomyCue(RoaEconomyNoticeKind.Gain)'),
'Confirmed rewards no longer reach the economy audio cues');
assert(hud.includes('ConfigureEconomyFeedback(hud != null ? hud.Socket : null);')
  && hud.includes('BuildEconomyFeedback();')
  && hud.includes('RefreshEconomyFeedback(worldHud);')
  && hud.includes('ReleaseEconomyFeedback();'),
'Adaptive HUD does not own the complete reward feedback lifecycle');
assert(groundItems.includes('if (ok)')
  && groundItems.includes('_statusUntil = 0f;')
  && !groundItems.includes('? "подобрано: " + nearest.ItemId'),
'Ground pickup still duplicates a raw item id through legacy IMGUI');
assert(audio.includes('BuildActivitySignal("EconomyGain"')
  && audio.includes('BuildActivitySignal("LevelUp"')
  && audio.includes('public bool EconomyCuesReady'),
'Generated gain and level-up sounds are incomplete');
assert(probe.includes('[НАГРАДЫ HUD] готово:')
  && probe.includes('partial authoritative vitals')
  && probe.includes('audio.EconomyCuesReady && audio.GeneratedClipCount == 32')
  && audit.includes('typeof(RoaEconomyFeedbackProbe)'),
'Unity audit no longer covers authoritative reward notifications');

for (const [contents, label] of [
  [feedbackMeta, 'RoaEconomyFeedback'],
  [canvasMeta, 'RoaHudCanvas.EconomyFeedback'],
  [probeMeta, 'RoaEconomyFeedbackProbe']
]) {
  assert(contents.includes('fileFormatVersion: 2') && /^guid: [0-9a-f]{32}$/m.test(contents),
    `${label} Unity meta is invalid`);
}

console.log('Unity economy feedback OK: join-safe authoritative diffs, readable gains/XP/levels, mobile toast queue and generated cues');
