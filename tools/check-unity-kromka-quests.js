'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const journal = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.KromkaQuests.cs'), 'utf8');
const pip = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs'), 'utf8');
const interaction = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaInteraction.cs'), 'utf8');
const dialogue = fs.readFileSync(path.join(root, 'unity-client/Assets/Scripts/Game/RoaDialogueCanvas.cs'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const questCatalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/quests.json'), 'utf8'));
const npcCatalog = JSON.parse(fs.readFileSync(path.join(root, 'data/kromka/npcs.json'), 'utf8'));

for (const token of ['КАМПАНИЯ КРОМКИ', 'ФРАКЦИОННЫЕ ЦЕПОЧКИ', 'ЛИЧНЫЕ ДЕЛА', 'currentObjectiveLabel', 'currentObjectiveHint']) {
  assert(journal.includes(token), `Kromka journal is missing ${token}.`);
}
assert(!journal.includes('"record"'), 'The journal must not submit objective completion commands.');
assert(!journal.includes('ВЫПОЛНИТЬ:'), 'The journal must not expose a remote complete-objective button.');
assert(journal.includes('currentObjectiveLabel'), 'The journal must use server-authored localized objective labels.');
assert(interaction.includes('currentObjectiveHint') && journal.includes('currentObjectiveHint'),
  'Quest conditions must show the player where or with whom to fulfil them.');
for (const token of ['kromkaQuestIds', 'SubmitKromkaQuest', 'NpcKromkaQuests', 'NpcKromkaQuestAction', '["enemyId"]', '"turnin"', 'Цель подтверждается действиями в мире.']) {
  assert(interaction.includes(token), `Named-NPC Kromka quest interaction is missing ${token}.`);
}
for (const token of ['Interaction.NpcKromkaQuests()', 'NpcKromkaQuestAction', '"start"', '"turnin"', '"outcome"']) {
  assert(dialogue.includes(token), `Kromka dialogue canvas is missing ${token}.`);
}
assert(interaction.includes('public bool CanAdvanceDialogue;')
  && interaction.includes('currentObjectiveInteraction')
  && interaction.includes('currentObjectiveNpcIds')
  && interaction.includes('CurrentActorMatchesQuestDialogueTarget(quest)')
  && interaction.includes('SubmitKromkaQuest(questId, "dialogue", string.Empty)'),
  'Unity does not limit the server-authoritative dialogue objective action to its intended NPC.');
assert(dialogue.includes('quest.CanAdvanceDialogue')
  && dialogue.includes('NpcKromkaQuestAction(capturedQuest.Id, "dialogue")'),
  'The NPC dialogue screen cannot continue an active quest conversation.');
assert(interaction.includes('KromkaQuestDialogueLine()')
  && interaction.indexOf('KromkaQuestDialogueLine()') < interaction.indexOf('TraderDialogueLine()')
  && interaction.includes('Dialogue = dialogue')
  && interaction.includes('description = "«" + dialogue'),
  'Quest-specific NPC dialogue does not take priority or appear in every quest card.');
assert(Object.keys(questCatalog.questDialogues || {}).length === 35,
  'Every authored quest with a giver needs lifecycle dialogue.');
assert.equal((questCatalog.dialogueQuestIds || []).length, 0,
  'Quest objectives must not use a dialogue-only bypass list.');
assert((npcCatalog.npcs || []).some(npc => npc.id === 'avenir_key'),
  'Avenir Key must exist as the giver of side_iron_argument.');
assert(server.includes("mode === 'turnin'")
  && server.includes("mode === 'dialogue'")
  && server.includes("String(binding.type || '') !== 'dialogue'")
  && server.includes('Один разговор его не заменяет.')
  && server.includes('turnInKromkaQuest')
  && server.includes("'Сначала начните диалог с заказчиком.'"),
  'The server must require an active NPC dialogue for quest acceptance, turn-in and outcome selection.');
assert(server.includes("if (String(enemy.kromkaNamedNpcId || '')) return false;"),
  'Named quest NPCs must not wander into inaccessible daily-routine slots.');
assert(server.includes("&& !String(e.kromkaNamedNpcId || '')"),
  'Named quest NPCs must stay available instead of joining ambient faction combat.');
assert(server.includes("if (String(enemy.kromkaNamedNpcId || '') && enemy.hostileToPlayer === false) return false;"),
  'Ambient hostiles must not close dialogue with a protected named quest NPC.');
assert(server.includes("if (String(enemy.kromkaNamedNpcId || '') && enemy.hostileToPlayer === false) continue;"),
  'Stationary named quest NPCs must not block narrow player routes.');
assert(server.includes('const preservedQuestNpcIds = new Set();')
  && server.includes('if (authoredNpcId && preservedQuestNpcIds.has(authoredNpcId)) return;')
  && server.includes('const protectedQuestNpc = String(enemy?.kromkaNamedNpcId || \'\')'),
  'Named quest NPCs must survive authored-location and temporary battle actor refreshes.');
assert(server.includes('ensureKromkaNamedLocationActors(room, loc);')
  && server.includes('ensureKromkaOnboardingLocationActors(room, loc);'),
  'Location ownership refreshes must restore required quest dialogue actors.');
assert(pip.includes('AddKromkaJournalCards()'));
console.log('Unity Kromka campaign dialogue and journal check passed.');
