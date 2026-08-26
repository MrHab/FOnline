using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    public enum RoaEconomyNoticeKind
    {
        Gain,
        Spend,
        Experience,
        LevelUp
    }

    public readonly struct RoaEconomyNotice
    {
        public readonly RoaEconomyNoticeKind Kind;
        public readonly string ItemId;
        public readonly int Amount;

        public RoaEconomyNotice(RoaEconomyNoticeKind kind, string itemId, int amount)
        {
            Kind = kind;
            ItemId = itemId ?? string.Empty;
            Amount = amount;
        }

        public string Key { get { return Kind + ":" + ItemId; } }
    }

    public sealed class RoaEconomySnapshot
    {
        public readonly Dictionary<string, int> Items = new Dictionary<string, int>();
        public readonly Dictionary<string, int> BagItems = new Dictionary<string, int>();
        public readonly Dictionary<string, int> EquipmentItems = new Dictionary<string, int>();
        public bool HasInventory;
        public bool HasProgress;
        public int Level;
        public int Xp;
        public int XpNeeded = 100;

        public RoaEconomySnapshot Copy()
        {
            var copy = new RoaEconomySnapshot
            {
                HasInventory = HasInventory,
                HasProgress = HasProgress,
                Level = Level,
                Xp = Xp,
                XpNeeded = XpNeeded
            };
            foreach (KeyValuePair<string, int> row in Items) copy.Items[row.Key] = row.Value;
            foreach (KeyValuePair<string, int> row in BagItems) copy.BagItems[row.Key] = row.Value;
            foreach (KeyValuePair<string, int> row in EquipmentItems) copy.EquipmentItems[row.Key] = row.Value;
            return copy;
        }
    }

    /// <summary>Pure authoritative inventory/progression diff and toast animation rules.</summary>
    public static class RoaEconomyFeedback
    {
        public const int MaxVisible = 3;
        public const int MaxQueued = 9;

        public readonly struct ToastSample
        {
            public readonly float Alpha;
            public readonly float OffsetX;
            public readonly float Scale;

            public ToastSample(float alpha, float offsetX, float scale)
            {
                Alpha = alpha;
                OffsetX = offsetX;
                Scale = scale;
            }
        }

        public static RoaEconomySnapshot Read(JObject payload, RoaEconomySnapshot previous = null)
        {
            RoaEconomySnapshot next = previous != null ? previous.Copy() : new RoaEconomySnapshot();
            if (payload == null) return next;
            bool ownershipChanged = false;
            if (payload["inventory"] is JArray inventory)
            {
                next.BagItems.Clear();
                next.HasInventory = true;
                ownershipChanged = true;
                foreach (JToken row in inventory)
                {
                    string id = RoaInventory.BaseId(row?["id"]?.ToString());
                    if (string.IsNullOrEmpty(id)) continue;
                    int quantity = Mathf.Clamp(row?["qty"]?.ToObject<int>() ?? 0, 0, 1000000);
                    AddOwned(next.BagItems, id, quantity);
                }
            }
            JObject equipment = payload["equipmentRuntime"] as JObject ?? payload["equipment"] as JObject;
            if (equipment != null)
            {
                next.EquipmentItems.Clear();
                ownershipChanged = true;
                foreach (KeyValuePair<string, JToken> slot in equipment)
                {
                    string id = RoaInventory.BaseId(slot.Value?.ToString());
                    if (string.IsNullOrEmpty(id) || id == "fists") continue;
                    AddOwned(next.EquipmentItems, id, 1);
                }
            }
            if (ownershipChanged) RebuildOwned(next);

            bool hasLevel = payload["level"] != null;
            bool hasXp = payload["xp"] != null;
            if (hasLevel) next.Level = Mathf.Max(0, payload["level"].ToObject<int>());
            if (hasXp) next.Xp = Mathf.Max(0, payload["xp"].ToObject<int>());
            if (payload["xpNeeded"] != null)
                next.XpNeeded = Mathf.Max(1, payload["xpNeeded"].ToObject<int>());
            else if (payload["xpToNext"] != null)
                next.XpNeeded = Mathf.Max(1, payload["xpToNext"].ToObject<int>());
            if (hasLevel && hasXp) next.HasProgress = true;
            return next;
        }

        public static List<RoaEconomyNotice> Diff(RoaEconomySnapshot previous,
                                                   RoaEconomySnapshot next)
        {
            var notices = new List<RoaEconomyNotice>();
            if (previous == null || next == null) return notices;
            if (previous.HasProgress && next.HasProgress)
            {
                if (next.Level > previous.Level)
                    notices.Add(new RoaEconomyNotice(RoaEconomyNoticeKind.LevelUp,
                        string.Empty, next.Level));
                else if (next.Level == previous.Level && next.Xp > previous.Xp)
                    notices.Add(new RoaEconomyNotice(RoaEconomyNoticeKind.Experience,
                        string.Empty, next.Xp - previous.Xp));
            }

            if (previous.HasInventory && next.HasInventory)
            {
                var ids = new HashSet<string>(previous.Items.Keys);
                ids.UnionWith(next.Items.Keys);
                foreach (string id in ids)
                {
                    previous.Items.TryGetValue(id, out int before);
                    next.Items.TryGetValue(id, out int after);
                    int delta = after - before;
                    if (delta > 0)
                        notices.Add(new RoaEconomyNotice(RoaEconomyNoticeKind.Gain, id, delta));
                    else if (delta < 0 && RoaItemCategories.Category(id) != "ammo")
                        notices.Add(new RoaEconomyNotice(RoaEconomyNoticeKind.Spend, id, -delta));
                }
            }
            notices.Sort(Compare);
            return notices;
        }

        public static string Text(RoaEconomyNotice notice)
        {
            if (notice.Kind == RoaEconomyNoticeKind.LevelUp)
                return "НОВЫЙ УРОВЕНЬ · " + notice.Amount;
            if (notice.Kind == RoaEconomyNoticeKind.Experience)
                return "+" + notice.Amount + " ОПЫТА";
            string name = RoaItemData.Name(notice.ItemId);
            return (notice.Kind == RoaEconomyNoticeKind.Gain ? "+" : "−")
                + notice.Amount + " · " + name;
        }

        public static string Kicker(RoaEconomyNoticeKind kind)
        {
            return kind == RoaEconomyNoticeKind.LevelUp ? "УРОВЕНЬ"
                : kind == RoaEconomyNoticeKind.Experience ? "ПРОГРЕСС"
                : kind == RoaEconomyNoticeKind.Spend ? "РАСХОД" : "ПОЛУЧЕНО";
        }

        public static float Lifetime(RoaEconomyNoticeKind kind)
        {
            return kind == RoaEconomyNoticeKind.LevelUp ? 4.8f : 3.6f;
        }

        public static ToastSample SampleToast(float age, float lifetime)
        {
            float enter = Smooth(Mathf.Clamp01(age / 0.18f));
            float exit = Smooth(Mathf.Clamp01((lifetime - age) / 0.34f));
            float alpha = Mathf.Min(enter, exit);
            return new ToastSample(alpha, Mathf.Lerp(-14f, 0f, enter),
                0.985f + enter * 0.015f);
        }

        private static void AddOwned(Dictionary<string, int> target, string id, int amount)
        {
            if (amount <= 0) return;
            target[id] = Mathf.Min(1000000,
                (target.TryGetValue(id, out int current) ? current : 0) + amount);
        }

        private static void RebuildOwned(RoaEconomySnapshot snapshot)
        {
            snapshot.Items.Clear();
            foreach (KeyValuePair<string, int> row in snapshot.BagItems)
                AddOwned(snapshot.Items, row.Key, row.Value);
            foreach (KeyValuePair<string, int> row in snapshot.EquipmentItems)
                AddOwned(snapshot.Items, row.Key, row.Value);
        }

        private static int Compare(RoaEconomyNotice left, RoaEconomyNotice right)
        {
            int byKind = Priority(left.Kind).CompareTo(Priority(right.Kind));
            if (byKind != 0) return byKind;
            if (left.ItemId == "silver" && right.ItemId != "silver") return -1;
            if (right.ItemId == "silver" && left.ItemId != "silver") return 1;
            return string.Compare(left.ItemId, right.ItemId, StringComparison.Ordinal);
        }

        private static int Priority(RoaEconomyNoticeKind kind)
        {
            return kind == RoaEconomyNoticeKind.LevelUp ? 0
                : kind == RoaEconomyNoticeKind.Experience ? 1
                : kind == RoaEconomyNoticeKind.Gain ? 2 : 3;
        }

        private static float Smooth(float value)
        {
            return value * value * (3f - 2f * value);
        }
    }
}
