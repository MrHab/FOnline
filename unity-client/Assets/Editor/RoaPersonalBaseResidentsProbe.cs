#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Вклад жителей личной базы в окне владельца: что даёт каждый житель,
    /// работает ли он сейчас и что даёт вся база. Прежде окно не показывало
    /// ни одного бонуса, а половина из них не действовала вовсе. Проба
    /// проверяет форматтеры на авторских данных и меряет строки настоящим
    /// шрифтом окна.
    /// </summary>
    public static class RoaPersonalBaseResidentsProbe
    {
        [MenuItem("Realm of Ashes/Probe/Base residents")]
        public static void Run()
        {
            Require(RoaPersonalBaseCanvas.ResidentBonusLabel(JObject.Parse(@"{'repairCostPct':-0.2}")) == "ремонт дома +20%",
                "A repair bonus reads as a gain");
            string trader = RoaPersonalBaseCanvas.ResidentBonusLabel(JObject.Parse(@"{'commonTradePricePct':0.08,'extraOrders':2}"));
            Require(trader == "цены у торговцев выгоднее на 8% · очередь производства +2", "The trader's bonus is named: " + trader);
            Require(RoaPersonalBaseCanvas.ResidentBonusLabel(JObject.Parse(@"{'activeResidentIds':['zoya_splint'],'maxHpFlat':10}")) == "макс. ОЗ +10",
                "Service fields are skipped, numbers are signed");
            Require(RoaPersonalBaseCanvas.ResidentBonusLabel(JObject.Parse(@"{'artifactPenaltyPct':-0.2}")) == "недостатки артефактов −20%",
                "A reduced drawback reads as a minus");
            Require(RoaPersonalBaseCanvas.ResidentBonusLabel(JObject.Parse(@"{'somethingNew':1}")) == string.Empty,
                "An unapplied key is never promised");
            Require(RoaPersonalBaseCanvas.ResidentBonusLabel(null) == string.Empty, "Without a bonus there is no label");

            JObject catalog = JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "../../data/base-residents.json")));
            JObject zoya = null;
            string longestRow = string.Empty;
            var total = new JObject();
            foreach (JToken token in catalog["residents"] as JArray ?? new JArray())
            {
                JObject resident = (JObject)token;
                string label = RoaPersonalBaseCanvas.ResidentBonusLabel(resident["bonus"] as JObject);
                Require(!string.IsNullOrEmpty(label), resident["id"] + " gives something the window can name");
                if (resident["id"]?.ToString() == "zoya_splint") zoya = resident;
                string row = RoaPersonalBaseCanvas.ResidentRowText(resident,
                    JObject.Parse(@"{'recruited':true,'assigned':true,'loyalty':100}"), false);
                if (row.Length > longestRow.Length) longestRow = row;
                foreach (JProperty bonus in ((JObject)resident["bonus"]).Properties())
                    total[bonus.Name] = (total[bonus.Name]?.Value<float>() ?? 0f) + bonus.Value.Value<float>();
            }
            Require(zoya != null, "The doctor is authored");

            string working = RoaPersonalBaseCanvas.ResidentRowText(zoya, JObject.Parse(@"{'recruited':true,'assigned':true,'loyalty':80}"), true);
            Require(working.StartsWith("Врач · лояльность 80 · РАБОТАЕТ"), "A working resident says so: " + working);
            Require(working.Contains("Даёт: сумка врача дома +50% · макс. ОЗ +10"), "The doctor's contribution is named: " + working);
            Require(working.Contains("Нужно: Койка"), "The resident's need stays visible: " + working);
            Require(RoaPersonalBaseCanvas.ResidentRowText(zoya, JObject.Parse(@"{'recruited':true,'assigned':true,'loyalty':20}"), false).Contains("ПРОСТАИВАЕТ"),
                "An assigned resident who does not work is called idle");
            string candidate = RoaPersonalBaseCanvas.ResidentRowText(zoya, null, false);
            Require(!candidate.Contains("лояльность") && !candidate.Contains("РАБОТАЕТ") && candidate.Contains("Даёт:"),
                "A candidate shows what they would give: " + candidate);

            // Строки окна меряются тем же шрифтом и кеглем, что в игре.
            var host = new GameObject("BaseResidentsProbe");
            try
            {
                float rowHeight = TextHeight(host, "ОСВОБОДИТЬ МЕСТО · Вениамин Вкредит\n" + longestRow, 14, RoaPersonalBaseCanvas.RowLabelWidth);
                Debug.Log("[BASE RESIDENTS] longest resident row: " + Mathf.CeilToInt(rowHeight) + " / " + (RoaPersonalBaseCanvas.ResidentRowHeight - 8f) + " px");
                Require(rowHeight <= RoaPersonalBaseCanvas.ResidentRowHeight - 8f,
                    "The longest resident row does not fit — " + Mathf.CeilToInt(rowHeight) + " px: " + longestRow);
                // Вся база сразу — с запасом больше, чем помещается жителей.
                string note = "ВКЛАД БАЗЫ: " + RoaPersonalBaseCanvas.ResidentBonusLabel(total);
                float noteHeight = TextHeight(host, note, 14, RoaPersonalBaseCanvas.RowLabelWidth + 24f);
                Debug.Log("[BASE RESIDENTS] full contribution note: " + Mathf.CeilToInt(noteHeight) + " / " + RoaPersonalBaseCanvas.NoteHeight + " px");
                Require(noteHeight <= RoaPersonalBaseCanvas.NoteHeight,
                    "The contribution note does not fit — " + Mathf.CeilToInt(noteHeight) + " px: " + note);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }

            Debug.Log("[BASE RESIDENTS] OK: every authored bonus is named, working and idle residents are told apart, rows and the contribution note fit the window.");
        }

        private static float TextHeight(GameObject host, string content, int fontSize, float width)
        {
            var go = new GameObject("Measure", typeof(RectTransform));
            go.transform.SetParent(host.transform, false);
            try
            {
                var text = go.AddComponent<Text>();
                text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                text.fontSize = fontSize;
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.verticalOverflow = VerticalWrapMode.Overflow;
                text.alignment = TextAnchor.UpperLeft;
                text.text = content;
                ((RectTransform)go.transform).sizeDelta = new Vector2(width, 4000f);
                return text.preferredHeight;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(go);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[BASE RESIDENTS] " + message);
        }
    }
}
#endif
