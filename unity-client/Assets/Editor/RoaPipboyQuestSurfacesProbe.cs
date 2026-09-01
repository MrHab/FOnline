#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaPipboyQuestSurfacesProbe
    {
        private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

        [MenuItem("Realm of Ashes/Проверить журнал и контракты")]
        public static void Run()
        {
            GameObject host = null;
            try
            {
                host = new GameObject("PIP-ASH quest surfaces probe");
                RoaInteraction interaction = host.AddComponent<RoaInteraction>();

                JObject definitions = new JObject
                {
                    ["story_active"] = Quest("Именной поручитель", "Активный сюжет", "Сюжет продолжается."),
                    ["story_done"] = Quest("Именной поручитель", "Завершённый сюжет", "Сюжет завершён."),
                    ["story_available"] = Quest("Именной поручитель", "Ещё не принято", "Можно получить у персонажа."),
                    ["story_locked"] = Quest("Именной поручитель", "Ещё закрыто", "Сначала нужно условие.")
                };

                JObject acceptedShared = Contract(
                    "accepted-shared", "shared-contract", "active", "Принятый персональный контракт");
                JObject acceptedOffFeed = Contract(
                    "accepted-off-feed", "off-feed-contract", "active", "Принятый контракт вне витрины");
                JObject completedPending = Contract(
                    "completed-pending", "completed-contract", "completed", "Награда ожидает получения");
                completedPending["rewardEligible"] = true;

                JObject self = new JObject
                {
                    ["npcQuests"] = new JObject
                    {
                        ["story_active"] = "active",
                        ["story_done"] = "done",
                        ["story_available"] = "available",
                        ["story_locked"] = "locked",
                        ["story_internal_flag"] = true
                    },
                    ["worldTaskAccepted"] = new JArray(
                        acceptedShared["id"], acceptedOffFeed["id"], completedPending["id"]),
                    ["worldTaskTrackedId"] = acceptedOffFeed["id"],
                    ["worldTaskRewardClaims"] = new JArray(),
                    ["worldTaskRecords"] = new JArray(
                        acceptedShared, acceptedOffFeed, completedPending)
                };
                JObject world = new JObject
                {
                    ["worldHour"] = 10,
                    ["sites"] = new JArray(),
                    ["worldTasks"] = new JArray
                    {
                        Contract("accepted-shared", "shared-contract", "active", "Публичный дубль по id"),
                        Contract("public-semantic-copy", "shared-contract", "active", "Публичный дубль по contractKey"),
                        Contract("public-unique", "unique-contract", "active", "Отдельный публичный контракт"),
                        Contract("completed-pending", "completed-contract", "completed", "Публичный дубль завершённого")
                    }
                };

                SetPrivate(interaction, "_quests", definitions);
                SetPrivate(interaction, "_self", self);
                SetPrivate(interaction, "_world", world);

                List<RoaInteraction.StoryQuestCard> activeQuests = interaction.JournalQuests(false);
                List<RoaInteraction.StoryQuestCard> completedQuests = interaction.JournalQuests(true);
                Require(activeQuests.Count == 1 && activeQuests[0].Id == "story_active",
                    "journal includes available, locked or procedural rows beside the active authored quest");
                Require(completedQuests.Count == 1 && completedQuests[0].Id == "story_done",
                    "journal includes non-completed or procedural rows beside the completed authored quest");
                Require(activeQuests.Concat(completedQuests).All(row => definitions[row.Id] is JObject),
                    "journal exposed a row that has no authored quest definition");
                Require(activeQuests.Concat(completedQuests).All(row =>
                        row.Id != "accepted-shared" && row.Id != "accepted-off-feed"),
                    "worldTaskRecords leaked into the authored story journal");

                List<RoaInteraction.WorldTaskCard> activeContracts = interaction.PipboyWorldTasks(true);
                Require(activeContracts.Count == 3,
                    "contract facade did not collapse public/personal duplicates or lost a unique contract");
                Require(activeContracts.Count(row => row.Id == "accepted-shared") == 1
                        && activeContracts.Single(row => row.Id == "accepted-shared").Title
                            == "Принятый персональный контракт",
                    "personal contract did not win over its public duplicate with the same id");
                Require(activeContracts.All(row => row.Id != "public-semantic-copy"),
                    "contractKey duplicate survived beside the accepted personal contract");
                Require(activeContracts.Any(row => row.Id == "accepted-off-feed"
                        && row.Accepted && row.Tracked),
                    "accepted off-feed contract disappeared from the personal contract list");
                Require(activeContracts.Any(row => row.Id == "public-unique" && !row.Accepted),
                    "unique public contract disappeared while semantic duplicates were collapsed");

                List<RoaInteraction.WorldTaskCard> completedContracts = interaction.PipboyWorldTasks(false);
                Require(completedContracts.Count == 1
                        && completedContracts[0].Id == "completed-pending"
                        && completedContracts[0].CanClaim,
                    "completed personal record with a pending reward was lost or duplicated");

                RoaPipboyCanvas canvas = host.AddComponent<RoaPipboyCanvas>();
                MethodInfo ensureBuilt = typeof(RoaPipboyCanvas).GetMethod("EnsureBuilt", PrivateInstance);
                Require(ensureBuilt != null, "PIP-ASH Canvas build entry point is missing");
                ensureBuilt.Invoke(canvas, null);
                Transform pages = host.transform.Find(
                    "PipboyCanvas/PipboyWindow/Frame/Screen/Pages");
                Require(pages != null, "PIP-ASH Canvas pages root was not built");
                Require(pages.Find("Page:Quests") != null,
                    "PIP-ASH Canvas has no global authored journal page");
                Require(pages.Find("Page:Contracts") != null,
                    "PIP-ASH Canvas has no separate global contracts page");

                Debug.Log("[PIP-ASH ЖУРНАЛ/КОНТРАКТЫ] готово: сюжет отделён, "
                    + "персональные и публичные контракты объединены без дублей");
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static JObject Quest(string giver, string name, string text)
        {
            return new JObject
            {
                ["title"] = giver,
                ["name"] = name,
                ["panel"] = new JObject
                {
                    ["active"] = text,
                    ["done"] = text
                },
                ["requirements"] = new JObject(),
                ["reward"] = new JObject { ["xp"] = 10, ["silver"] = 5 }
            };
        }

        private static JObject Contract(string id, string contractKey, string status, string title)
        {
            return new JObject
            {
                ["id"] = id,
                ["contractKey"] = contractKey,
                ["type"] = "deliver_supplies",
                ["status"] = status,
                ["title"] = title,
                ["text"] = "Проверочный контракт.",
                ["siteId"] = "settlement",
                ["issuerSiteId"] = "settlement",
                ["expiresHour"] = 24,
                ["reward"] = new JObject { ["xp"] = 20, ["caps"] = 10 },
                ["details"] = new JObject
                {
                    ["demand"] = new JObject { ["water"] = 1 }
                }
            };
        }

        private static void SetPrivate(object target, string fieldName, object value)
        {
            FieldInfo field = target.GetType().GetField(fieldName, PrivateInstance);
            Require(field != null, "missing private fixture field: " + fieldName);
            field.SetValue(target, value);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
