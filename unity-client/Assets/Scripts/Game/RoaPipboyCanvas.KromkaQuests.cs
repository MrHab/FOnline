using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaPipboyCanvas
    {
        private void AddKromkaJournalCards()
        {
            JObject journal = Pipboy?.Self?["kromkaQuestJournal"] as JObject;
            if (journal == null) return;
            AddSectionTitle(_questRows, _questsList, "КАМПАНИЯ КРОМКИ");
            AddKromkaQuestArray(journal["campaign"] as JArray);

            AddSectionTitle(_questRows, _questsList, "ФРАКЦИОННЫЕ ЦЕПОЧКИ");
            if (journal["factions"] is JObject factions)
                foreach (KeyValuePair<string, JToken> entry in factions) AddKromkaQuestArray(entry.Value as JArray);

            AddSectionTitle(_questRows, _questsList, "ЛИЧНЫЕ ДЕЛА И МЕХАНИКА");
            AddKromkaQuestArray(journal["mechanic"] as JArray);
            AddKromkaQuestArray(journal["personal"] as JArray);
        }

        private void AddKromkaQuestArray(JArray quests)
        {
            foreach (JToken token in quests ?? new JArray())
            {
                if (!(token is JObject quest)) continue;
                string id = quest["id"]?.ToString() ?? string.Empty;
                string status = quest["status"]?.ToString() ?? "available";
                string body = quest["summary"]?.ToString() ?? string.Empty;
                string current = quest["currentObjectiveLabel"]?.ToString() ?? string.Empty;
                string hint = quest["currentObjectiveHint"]?.ToString() ?? string.Empty;
                int progressCurrent = quest["objectiveProgressCurrent"]?.ToObject<int>() ?? 0;
                int progressTarget = quest["objectiveProgressTarget"]?.ToObject<int>() ?? 0;
                if (!string.IsNullOrEmpty(current) && progressTarget > 1)
                    current += " (" + progressCurrent + "/" + progressTarget + ")";
                if (!string.IsNullOrEmpty(current)) body += "\nТекущая цель: " + current;
                if (status == "active" && !string.IsNullOrEmpty(hint)) body += "\n" + hint;
                if (status == "completed") body += "\nИсход: " + (quest["outcomeId"]?.ToString() ?? "завершено");
                if (status == "available") body += "\nПолучите задание у указанного персонажа.";
                else if (status == "active") body += "\nВыполняется в игровом мире.";
                else if (status == "choice")
                {
                    body += "\nВернитесь к заказчику, чтобы принять решение.";
                }
                AddTextCard(_questRows, _questsList,
                    KromkaQuestStatusLabel(status) + "  " + (quest["title"]?.ToString() ?? id), body);
            }
        }

        /// <summary>
        /// Статус задания по-русски. Раньше карточка печатала сырой ключ сервера, и
        /// игрок читал AVAILABLE, LOCKED и TURNIN в русском журнале.
        /// </summary>
        public static string KromkaQuestStatusLabel(string status)
        {
            switch (status)
            {
                case "available": return "ДОСТУПНО";
                case "active": return "В РАБОТЕ";
                case "choice": return "РЕШЕНИЕ";
                case "turnin": return "К СДАЧЕ";
                case "completed": return "ЗАВЕРШЕНО";
                case "locked": return "ЗАКРЫТО";
                case "failed": return "ПРОВАЛЕНО";
                default: return (status ?? string.Empty).ToUpperInvariant();
            }
        }

    }
}
