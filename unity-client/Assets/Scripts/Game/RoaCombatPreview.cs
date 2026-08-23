using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Read-only combat forecast used by the target hint. The formulas mirror
    /// serverHitChance/serverDamageRoll and the browser getTargetHitInfo path;
    /// the result never mutates state and never replaces the authoritative ack.
    /// </summary>
    public static class RoaCombatPreview
    {
        public sealed class Result
        {
            public int Chance;
            public float Distance;
            public float Range;
            public int ApCost;
            public int CriticalChance;
            public int EnergyFailureChance;
            public int DamageMin;
            public int DamageMax;
            public int DamageAverage;
            public int DamageExpected;
            public string DamageType;
            public string ModeLabel;
            public bool InRange;
            public bool HasDamage;
        }

        private sealed class Weapon
        {
            public string Id;
            public string Skill;
            public string DamageType;
            public int Strength;
            public int Min;
            public int Max;
            public float Range;
            public int Ap;
            public bool Ammo;
            public bool Automatic;
            public bool Dual;
            public float AccuracyBonus;
            public float AutoPenaltyReduction;

            public Weapon Copy()
            {
                return (Weapon)MemberwiseClone();
            }
        }

        private static readonly Dictionary<string, Weapon> Weapons = BuildWeapons();

        public static float EffectiveRange(JObject self, JObject combat, string requestedMode)
        {
            string weaponId = BaseId(combat?["weapon"]?.ToString()
                ?? self?["equipment"]?["weapon"]?.ToString() ?? "fists");
            Weapon source;
            if (!Weapons.TryGetValue(weaponId, out source)) source = Weapons["fists"];
            Weapon weapon = ApplyModifications(source.Copy(), combat?["weaponMods"] as JObject);
            string mode = ResolveMode(weapon, requestedMode, self);
            return weapon.Range * (mode == "dual" ? 0.85f : 1f);
        }

        public static Result Calculate(JObject self, JObject combat, JObject target,
                                       RoaPlayerController player, Vector3 targetPosition,
                                       string requestedMode)
        {
            var result = new Result { DamageType = "ballistic", ModeLabel = "Одиночный" };
            if (self == null || target == null || player == null) return result;

            string weaponId = BaseId(combat?["weapon"]?.ToString()
                ?? self["equipment"]?["weapon"]?.ToString() ?? "fists");
            Weapon source;
            if (!Weapons.TryGetValue(weaponId, out source)) source = Weapons["fists"];
            Weapon weapon = ApplyModifications(source.Copy(), combat?["weaponMods"] as JObject);
            string mode = ResolveMode(weapon, requestedMode, self);
            float modeHit = mode == "aimed" ? 0.24f : mode == "dual" ? -0.15f : 0f;
            float modeDamage = mode == "aimed" ? 1.05f : 1f;
            float modeRange = mode == "dual" ? 0.85f : 1f;
            float cap = mode == "dual" ? 0.78f : mode == "aimed" ? 0.99f : weapon.Ammo ? 0.96f : 0.94f;

            result.ModeLabel = ModeLabel(mode);
            result.Distance = HorizontalDistance(player.transform.position, targetPosition);
            result.Range = weapon.Range * modeRange;
            result.InRange = result.Distance <= result.Range;
            result.ApCost = ModeApCost(weapon, mode, self);
            if (Injury(self, "brokenArm")) result.ApCost++;
            result.CriticalChance = weapon.Ammo ? Stat(self, "luck") : 0;
            result.DamageType = weapon.DamageType;
            result.EnergyFailureChance = EnergyFailurePercent(weapon, mode, self, combat);
            if (!result.InRange || target["dead"]?.ToObject<bool>() == true) return result;

            float condition = Mathf.Clamp(combat?["condition"]?.ToObject<float>() ?? 100f, 1f, 100f);
            float conditionPenalty = weapon.Ammo ? Mathf.Max(0f, 70f - condition) * 0.0025f : 0f;
            float statAimBonus = (Stat(self, "per") - 5) * 0.025f + (HasTrait(self, "trainedEye") ? 0.06f : 0f);
            float luckBonus = Mathf.Max(0, Stat(self, "luck") - 5) * 0.006f;
            bool ambush = player.Crouching && Talent(self, "ambush") > 0
                && target["aiState"]?.ToString() != "chase"
                && target["aiState"]?.ToString() != "attack";

            if (weapon.Ammo && (mode == "single" || mode == "aimed"))
                modeHit += Talent(self, "gunslinger") * 0.07f;
            if (weapon.DamageType == "explosive") modeHit += Talent(self, "grenadier") * 0.06f;
            if (weapon.DamageType == "fire") modeHit += Talent(self, "pyromaniac") * 0.04f;
            if (ambush) modeHit += Talent(self, "ambush") * 0.08f;

            float skillBonus = SkillNorm(self, weapon.Skill) * (weapon.Ammo ? 0.30f : 0.18f);
            if (weapon.DamageType == "explosive") skillBonus += SkillNorm(self, "throwing") * 0.08f;
            if (weapon.Skill == "heavyWeapons") skillBonus += Talent(self, "heavyShooter") * 0.06f;
            if (weapon.Skill == "energyWeapons") skillBonus += Talent(self, "energyTech") * 0.05f;
            if (weapon.Skill == "unarmed") skillBonus += Talent(self, "unarmedFighter") * 0.04f;

            float strengthMissing = Mathf.Max(0, weapon.Strength - Stat(self, "str"));
            float strengthPenalty = strengthMissing * 0.055f;
            float movementPenalty = player.Moving && !player.Crouching ? 0.035f : 0f;
            float traumaPenalty = (Injury(self, "brokenArm") ? 0.12f : 0f)
                + (Injury(self, "concussion") ? 0.10f : 0f)
                + (Injury(self, "infection") ? 0.03f : 0f);
            float chance;
            if (weapon.Ammo)
            {
                chance = Mathf.Max(0.38f, 0.82f - result.Distance / (weapon.Range * 3.1f))
                    + skillBonus + statAimBonus + luckBonus + modeHit + weapon.AccuracyBonus
                    - conditionPenalty - strengthPenalty - movementPenalty - traumaPenalty;
                if (mode == "auto")
                    chance -= AutomaticPenalty(weapon, self, player, condition, strengthMissing);
                if (weapon.Id == "shotgun") chance *= ShotgunHitMultiplier(weapon, result.Distance);
            }
            else
            {
                chance = 0.72f + skillBonus + Mathf.Max(0, Stat(self, "str") - 5) * 0.012f
                    + luckBonus - strengthPenalty - traumaPenalty;
            }
            chance = Mathf.Clamp(chance, 0.05f, cap);
            result.Chance = Round(chance * 100f);

            // Browser/server enemy mitigation is name-based for player attacks.
            // PvP uses a different armor path, so avoid presenting a false exact range.
            if (target["isRemotePlayer"]?.ToObject<bool>() == true) return result;
            int bonus = 0;
            if (!weapon.Ammo)
            {
                bonus += Round(SkillNorm(self, weapon.Skill) * (weapon.Skill == "unarmed" ? 4f : 6f));
                bonus += Mathf.Max(0, Mathf.FloorToInt((Stat(self, "str") - 5) / 2f));
                if (HasTrait(self, "bruiser")) bonus += 2;
                if (weapon.Skill == "melee") bonus += Talent(self, "meleeBreaker") * 2;
                if (weapon.Skill == "unarmed") bonus += Talent(self, "unarmedFighter") * 2;
            }
            if (weapon.Skill == "energyWeapons") bonus += Mathf.Max(0, Mathf.FloorToInt((Stat(self, "int") - 5) / 2f));
            if (weapon.Ammo) bonus += Talent(self, "sharpshooter") * 2;
            float fireMultiplier = weapon.DamageType == "fire" ? 1f + Talent(self, "pyromaniac") * 0.12f : 1f;
            float ambushMultiplier = ambush ? 1f + Talent(self, "ambush") * 0.14f : 1f;
            float shotgunMultiplier = weapon.Id == "shotgun" ? ShotgunDamageMultiplier(weapon, result.Distance) : 1f;
            float multiplier = modeDamage * fireMultiplier * ambushMultiplier * shotgunMultiplier;
            int minRaw = Mathf.Max(1, Round((weapon.Min + bonus) * multiplier));
            int maxRaw = Mathf.Max(minRaw, Round((weapon.Max + bonus) * multiplier));
            int avgRaw = Mathf.Max(1, Round((((weapon.Min + weapon.Max) / 2f) + bonus) * multiplier));
            result.DamageMin = MitigateEnemy(minRaw, target, weapon.DamageType);
            result.DamageMax = MitigateEnemy(maxRaw, target, weapon.DamageType);
            result.DamageAverage = MitigateEnemy(avgRaw, target, weapon.DamageType);
            if (result.DamageMin > result.DamageMax)
            {
                int swap = result.DamageMin;
                result.DamageMin = result.DamageMax;
                result.DamageMax = swap;
            }
            float criticalExpected = 1f + result.CriticalChance / 100f;
            result.DamageExpected = Mathf.Max(0, Round(result.DamageAverage * criticalExpected * chance));
            result.HasDamage = true;
            return result;
        }

        private static Weapon ApplyModifications(Weapon weapon, JObject mods)
        {
            if (!weapon.Ammo || mods == null) return weapon;
            float damage = 1f;
            float range = 1f;
            foreach (JProperty property in mods.Properties())
            {
                switch (property.Value?.ToString())
                {
                    case "barrel_precision": damage *= 1.06f; range *= 1.12f; break;
                    case "barrel_suppressor": range *= 0.96f; weapon.AccuracyBonus += 0.04f; break;
                    case "barrel_choke": range *= 1.18f; weapon.AccuracyBonus += 0.04f; break;
                    case "barrel_nozzle": damage *= 1.04f; range *= 1.20f; break;
                    case "barrel_accelerator": damage *= 1.08f; range *= 1.10f; break;
                    case "barrel_rocket_stabilizer": range *= 1.12f; weapon.AccuracyBonus += 0.05f; break;
                    case "scope_reflex": weapon.AccuracyBonus += 0.04f; break;
                    case "scope_marksman": range *= 1.10f; weapon.AccuracyBonus += 0.08f; break;
                    case "scope_thermal": range *= 1.06f; weapon.AccuracyBonus += 0.06f; break;
                    case "mag_overcharged": damage *= 1.12f; break;
                    case "barrel_pipe_long": damage *= 1.03f; range *= 1.30f; break;
                    case "forend_wire_wrap": weapon.AccuracyBonus += 0.03f; break;
                    case "forend_grip": weapon.AccuracyBonus += 0.03f; weapon.AutoPenaltyReduction += 0.04f; break;
                    case "forend_bipod": weapon.AccuracyBonus += 0.06f; break;
                    case "forend_heatshield": weapon.AccuracyBonus += 0.02f; break;
                }
            }
            weapon.Min = Mathf.Max(1, Round(weapon.Min * damage));
            weapon.Max = Mathf.Max(weapon.Min, Round(weapon.Max * damage));
            weapon.Range = Mathf.Max(0.4f, Round(weapon.Range * range * 10f) / 10f);
            return weapon;
        }

        private static float AutomaticPenalty(Weapon weapon, JObject self, RoaPlayerController player,
                                              float condition, float strengthMissing)
        {
            if (!weapon.Automatic) return 0f;
            float perk = weapon.Skill == "lightWeapons" ? Talent(self, "automaticMan") * 0.03f
                : weapon.Skill == "heavyWeapons" ? Talent(self, "machineGunner") * 0.04f
                : weapon.Skill == "energyWeapons" ? Talent(self, "energyTech") * 0.03f : 0f;
            float value = 0.18f - SkillNorm(self, weapon.Skill) * 0.08f
                + strengthMissing * 0.025f
                + (player.Moving && !player.Crouching ? 0.04f : 0f)
                + Mathf.Max(0f, 70f - condition) * 0.0015f
                - (player.Crouching ? 0.03f : 0f) - perk - weapon.AutoPenaltyReduction;
            return Mathf.Clamp(value, 0.04f, 0.32f);
        }

        private static int EnergyFailurePercent(Weapon weapon, string mode, JObject self, JObject combat)
        {
            if (weapon.Skill != "energyWeapons" && weapon.DamageType != "energy") return 0;
            float condition = Mathf.Clamp(combat?["condition"]?.ToObject<float>() ?? 100f, 1f, 100f);
            float chance = 0.16f * (1f - SkillNorm(self, weapon.Skill) * 0.55f)
                + Mathf.Max(0f, 65f - condition) * 0.003f
                + (mode == "auto" ? 0.04f : 0f) - Talent(self, "energyTech") * 0.035f;
            return Round(Mathf.Clamp(chance, 0.01f, 0.36f) * 100f);
        }

        private static int ModeApCost(Weapon weapon, string mode, JObject self)
        {
            if (mode == "aimed") return weapon.Ap + 2;
            if (mode == "auto")
            {
                float half = weapon.Ap / 2f;
                return Mathf.Max(1, SkillPercent(self, weapon.Skill) >= 70 ? Mathf.FloorToInt(half) : Mathf.CeilToInt(half));
            }
            if (mode == "dual")
            {
                string offhandId = BaseId(self?["equipment"]?["offhand"]?.ToString());
                Weapon offhand;
                int otherAp = Weapons.TryGetValue(offhandId, out offhand) ? offhand.Ap : weapon.Ap;
                return Mathf.Max(1, Mathf.CeilToInt((weapon.Ap + otherAp) * 0.75f));
            }
            return weapon.Ap;
        }

        private static string ResolveMode(Weapon weapon, string requested, JObject self)
        {
            if (!weapon.Ammo) return "melee";
            if (requested == "auto" && weapon.Automatic) return "auto";
            if (requested == "dual" && weapon.Dual)
            {
                string offhand = BaseId(self?["equipment"]?["offhand"]?.ToString());
                Weapon other;
                if (Weapons.TryGetValue(offhand, out other) && other.Dual) return "dual";
            }
            return requested == "aimed" ? "aimed" : "single";
        }

        private static float ShotgunHitMultiplier(Weapon weapon, float distance)
        {
            float t = Mathf.Clamp01(distance / Mathf.Max(1f, weapon.Range));
            return Mathf.Clamp(1f - Mathf.Max(0f, (t - 0.25f) / 0.75f) * 0.24f, 0.55f, 1f);
        }

        private static float ShotgunDamageMultiplier(Weapon weapon, float distance)
        {
            float t = Mathf.Clamp01(distance / Mathf.Max(1f, weapon.Range));
            float close = t <= 0.18f ? 1.14f : 1.08f;
            float falloff = t <= 0.25f ? close : 1.08f - ((t - 0.25f) / 0.75f) * 0.68f;
            return Mathf.Clamp(falloff, 0.28f, 1.14f);
        }

        private static int MitigateEnemy(int raw, JObject target, string type)
        {
            string name = (target?["name"]?.ToString() ?? string.Empty).ToLowerInvariant();
            float protection = 0f;
            int threshold = 0;
            if (name.Contains("рейдер") && type == "ballistic") { protection = 0.08f; threshold = 1; }
            else if (name.Contains("супермутант") && type == "ballistic") { protection = 0.10f; threshold = 2; }
            else if (name.Contains("гуль") && type == "radiation") { protection = 0.35f; threshold = 1; }
            int minimum = Mathf.Max(1, Mathf.FloorToInt(raw * 0.12f));
            int damage = Mathf.Max(minimum, Round(Mathf.Max(0, raw - threshold) * (1f - protection)));
            return Mathf.Max(1, damage);
        }

        private static int SkillPercent(JObject self, string id)
        {
            int stored = self?["skillRanks"]?[id]?.ToObject<int>() ?? 0;
            return Mathf.Clamp(Mathf.Max(stored, SkillBase(self, id)), 20, 100);
        }

        private static float SkillNorm(JObject self, string id)
        {
            return SkillPercent(self, id) / 100f;
        }

        private static int SkillBase(JObject self, string id)
        {
            int str = Stat(self, "str"), per = Stat(self, "per"), end = Stat(self, "end");
            int cha = Stat(self, "cha"), intelligence = Stat(self, "int"), agi = Stat(self, "agi"), luck = Stat(self, "luck");
            int value;
            switch (id)
            {
                case "lightWeapons": value = 15 + agi * 2 + per; break;
                case "heavyWeapons": value = 10 + str * 2 + end; break;
                case "energyWeapons": value = 10 + intelligence * 2 + per; break;
                case "throwing": value = 10 + agi * 2 + str; break;
                case "melee": value = 15 + str * 2 + agi; break;
                case "unarmed": value = 15 + str + agi + end; break;
                case "doctor": value = 10 + intelligence * 2 + per; break;
                case "firstAid": value = 12 + intelligence + per + end; break;
                case "stealth": value = 10 + agi * 2 + luck; break;
                case "lockpick": value = 10 + agi * 2 + per; break;
                case "traps": value = 10 + per + agi + intelligence; break;
                case "science": value = 10 + intelligence * 3; break;
                case "repair": value = 10 + intelligence * 2 + per; break;
                case "speech": value = 10 + cha * 3; break;
                case "barter": value = 10 + cha * 2 + intelligence; break;
                case "wanderer": value = 10 + end + per + luck * 2; break;
                default: value = 20; break;
            }
            value = Mathf.Clamp(value, 20, 45);
            if (Tagged(self, id)) value += 5;
            return Mathf.Clamp(value, 20, 50);
        }

        private static int Stat(JObject self, string id)
        {
            int value = self?["special"]?[id]?.ToObject<int>() ?? 5;
            string talent = "special" + char.ToUpperInvariant(id[0]) + id.Substring(1);
            return Mathf.Clamp(value + Talent(self, talent), 1, 15);
        }

        private static int Talent(JObject self, string id)
        {
            return Mathf.Max(0, self?["talentRanks"]?[id]?.ToObject<int>() ?? 0);
        }

        private static bool Tagged(JObject self, string id)
        {
            JArray rows = self?["taggedSkills"] as JArray;
            if (rows == null) return false;
            foreach (JToken token in rows) if (token?.ToString() == id) return true;
            return false;
        }

        private static bool HasTrait(JObject self, string id)
        {
            JArray rows = self?["traits"] as JArray;
            if (rows == null) return false;
            foreach (JToken token in rows) if (token?.ToString() == id) return true;
            return false;
        }

        private static bool Injury(JObject self, string id)
        {
            return self?["injuries"]?[id]?.ToObject<bool>() == true;
        }

        private static float HorizontalDistance(Vector3 a, Vector3 b)
        {
            return new Vector2(a.x - b.x, a.z - b.z).magnitude;
        }

        private static int Round(float value)
        {
            return (int)Math.Floor(value + 0.5f);
        }

        private static string BaseId(string runtimeId)
        {
            return RoaInventory.BaseId(runtimeId ?? string.Empty);
        }

        private static string ModeLabel(string mode)
        {
            if (mode == "aimed") return "Прицельный";
            if (mode == "auto") return "Автоматический";
            if (mode == "dual") return "Парный залп";
            if (mode == "melee") return "Ближний бой";
            return "Одиночный";
        }

        private static Dictionary<string, Weapon> BuildWeapons()
        {
            var rows = new Dictionary<string, Weapon>();
            Add(rows, "pistol", "lightWeapons", "ballistic", 2, 18, 26, 12f, 3, true, false, true);
            Add(rows, "revolver", "lightWeapons", "ballistic", 3, 22, 32, 14f, 3, true);
            Add(rows, "sawedOffShotgun", "lightWeapons", "ballistic", 4, 30, 44, 7f, 4, true);
            Add(rows, "smg", "lightWeapons", "ballistic", 4, 12, 17, 14f, 4, true, true);
            Add(rows, "rifle", "lightWeapons", "ballistic", 4, 28, 40, 24f, 4, true);
            Add(rows, "assaultRifle", "lightWeapons", "ballistic", 5, 13, 19, 18f, 4, true, true);
            Add(rows, "machineGun", "heavyWeapons", "ballistic", 7, 12, 18, 20f, 5, true, true);
            Add(rows, "laserPistol", "energyWeapons", "energy", 3, 22, 32, 16f, 4, true, false, true);
            Add(rows, "flamethrower", "heavyWeapons", "fire", 6, 14, 22, 8f, 5, true, true);
            Add(rows, "plasmaRifle", "energyWeapons", "energy", 5, 32, 48, 18f, 5, true);
            Add(rows, "shotgun", "lightWeapons", "ballistic", 5, 26, 40, 11f, 5, true);
            Add(rows, "rocketLauncher", "heavyWeapons", "explosive", 7, 54, 78, 22f, 6, true);
            Add(rows, "knife", "melee", "ballistic", 1, 9, 15, 2.1f, 2, false);
            Add(rows, "pickaxe", "melee", "ballistic", 4, 13, 21, 2f, 3, false);
            Add(rows, "axe", "melee", "ballistic", 3, 11, 19, 2.1f, 3, false);
            Add(rows, "handPump", "melee", "ballistic", 3, 7, 12, 1.8f, 3, false);
            Add(rows, "fists", "unarmed", "ballistic", 1, 2, 4, 1.35f, 2, false);
            return rows;
        }

        private static void Add(Dictionary<string, Weapon> rows, string id, string skill, string type,
                                int strength, int min, int max, float range, int ap,
                                bool ammo, bool automatic = false, bool dual = false)
        {
            rows[id] = new Weapon
            {
                Id = id, Skill = skill, DamageType = type, Strength = strength,
                Min = min, Max = max, Range = range, Ap = ap,
                Ammo = ammo, Automatic = automatic, Dual = dual
            };
        }
    }
}
