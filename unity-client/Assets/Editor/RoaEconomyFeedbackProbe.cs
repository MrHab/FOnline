#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaEconomyFeedbackProbe
    {
        [MenuItem("Realm of Ashes/Проверить уведомления наград")]
        public static void Run()
        {
            RoaEconomySnapshot baseline = RoaEconomyFeedback.Read(Self(2, 30,
                ("ammo9", 20), ("ore", 1), ("medkit", 2), ("silver", 5)));
            RoaEconomySnapshot changed = RoaEconomyFeedback.Read(Self(2, 55,
                ("ammo9", 14), ("ore", 3), ("medkit", 1), ("silver", 17)), baseline);
            List<RoaEconomyNotice> notices = RoaEconomyFeedback.Diff(baseline, changed);
            Require(notices.Any(row => row.Kind == RoaEconomyNoticeKind.Experience && row.Amount == 25),
                "confirmed experience gain is invisible");
            Require(notices.Any(row => row.Kind == RoaEconomyNoticeKind.Gain
                    && row.ItemId == "ore" && row.Amount == 2),
                "confirmed item gain is invisible");
            Require(notices.Any(row => row.Kind == RoaEconomyNoticeKind.Gain
                    && row.ItemId == "silver" && row.Amount == 12),
                "confirmed caps gain is invisible");
            Require(notices.Any(row => row.Kind == RoaEconomyNoticeKind.Spend
                    && row.ItemId == "medkit" && row.Amount == 1),
                "important item use is invisible");
            Require(!notices.Any(row => row.Kind == RoaEconomyNoticeKind.Spend
                    && row.ItemId == "ammo9"),
                "ordinary ammunition use spams the notification rail");

            JObject beforeEquipPayload = Self(2, 55, ("metalArmor", 1), ("silver", 17));
            beforeEquipPayload["equipmentRuntime"] = new JObject { ["weapon"] = "fists" };
            RoaEconomySnapshot beforeEquip = RoaEconomyFeedback.Read(beforeEquipPayload);
            JObject afterEquipPayload = Self(2, 55, ("silver", 17));
            afterEquipPayload["equipmentRuntime"] = new JObject
            {
                ["weapon"] = "fists",
                ["armor"] = "metalArmor"
            };
            RoaEconomySnapshot afterEquip = RoaEconomyFeedback.Read(afterEquipPayload, beforeEquip);
            Require(!RoaEconomyFeedback.Diff(beforeEquip, afterEquip).Any(row =>
                    row.Kind == RoaEconomyNoticeKind.Gain || row.Kind == RoaEconomyNoticeKind.Spend),
                "moving owned armor between bag and equipment looks like gain or spend");

            JObject partial = new JObject { ["hp"] = 42 };
            RoaEconomySnapshot merged = RoaEconomyFeedback.Read(partial, changed);
            Require(merged.Items["ore"] == 3 && merged.Xp == 55
                    && RoaEconomyFeedback.Diff(changed, merged).Count == 0,
                "partial authoritative vitals look like lost inventory or progress");
            RoaEconomySnapshot level = RoaEconomyFeedback.Read(Self(3, 4,
                ("ammo9", 14), ("ore", 3), ("medkit", 1), ("silver", 17)), changed);
            List<RoaEconomyNotice> levelNotices = RoaEconomyFeedback.Diff(changed, level);
            Require(levelNotices.Count(row => row.Kind == RoaEconomyNoticeKind.LevelUp) == 1
                    && !levelNotices.Any(row => row.Kind == RoaEconomyNoticeKind.Experience),
                "level-up rollover is reported as negative or duplicate experience");
            Require(RoaEconomyFeedback.Text(new RoaEconomyNotice(
                    RoaEconomyNoticeKind.Gain, "ore", 2)).Contains("Железная руда"),
                "notification exposes a raw item id");

            RoaEconomyFeedback.ToastSample start = RoaEconomyFeedback.SampleToast(0f, 3.6f);
            RoaEconomyFeedback.ToastSample settled = RoaEconomyFeedback.SampleToast(0.25f, 3.6f);
            RoaEconomyFeedback.ToastSample end = RoaEconomyFeedback.SampleToast(3.6f, 3.6f);
            Require(start.Alpha < 0.001f && start.OffsetX < -13f && start.Scale < 1f
                    && settled.Alpha > 0.99f && Mathf.Abs(settled.OffsetX) < 0.01f
                    && end.Alpha < 0.001f,
                "reward notification transition is abrupt or unbounded");

            GameObject audioHost = null;
            try
            {
                audioHost = new GameObject("Economy feedback audio probe");
                RoaAudio audio = audioHost.AddComponent<RoaAudio>();
                if (!audio.EconomyCuesReady)
                {
                    var awake = typeof(RoaAudio).GetMethod("Awake",
                        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                    Require(awake != null, "audio initialization entry point is missing");
                    awake.Invoke(audio, null);
                }
                Require(audio.EconomyCuesReady && audio.GeneratedClipCount == 32,
                    "generated reward and level cues are incomplete; generated="
                    + audio.GeneratedClipCount);
            }
            finally
            {
                if (audioHost != null) UnityEngine.Object.DestroyImmediate(audioHost);
            }

            Debug.Log("[НАГРАДЫ HUD] готово: предметы, крышки, опыт, уровень; "
                + "частичный снимок безопасен, расход патронов подавлен");
        }

        private static JObject Self(int level, int xp, params (string id, int qty)[] items)
        {
            var inventory = new JArray();
            foreach ((string id, int qty) item in items)
                inventory.Add(new JObject { ["id"] = item.id, ["qty"] = item.qty });
            return new JObject
            {
                ["level"] = level,
                ["xp"] = xp,
                ["xpNeeded"] = 100,
                ["inventory"] = inventory
            };
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
