#if UNITY_EDITOR
using System;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Счёт клановой осады на панели боя: чьи передатчики, кто пройдёт на
    /// штурм, чья перезапись ядра и сколько до неё, сколько возрождений
    /// осталось у своей стороны и чем кончилось. Проверяются чистые
    /// форматтеры на серверном снимке события и сборка самой панели.
    /// </summary>
    public static class RoaKromkaSiegeUiProbe
    {
        private const long Now = 1_800_000_000_000L;

        [MenuItem("Realm of Ashes/Probe/Siege score")]
        public static void Run()
        {
            // --- передатчики ---------------------------------------------------------
            JObject relay = Event("relay");
            relay["relayOwners"] = JObject.Parse(@"{'relay_a':'atk','relay_b':'','relay_c':'b2'}");
            relay["relayScores"] = JObject.Parse(@"{'atk':1,'b2':1}");
            string attackerView = RoaKromkaSiegePresentation.DescribeSiege(relay, "atk", Now);
            Require(attackerView.StartsWith("ОСАДА · ПЕРЕДАТЧИКИ · 05:00"), "The phase and its clock lead the panel: " + attackerView);
            Require(attackerView.Contains("наши 1") && attackerView.Contains("«Синие» 1") && attackerView.Contains("ничьих 1")
                && attackerView.Contains("нужно 2 из 3"), "Every relay owner is counted: " + attackerView);
            Require(attackerView.Contains("По времени пройдёт: наши"),
                "On a tie the earlier challenge qualifies, like on the server: " + attackerView);
            Require(attackerView.Contains("Возьмите 2 из 3 передатчиков раньше других"), "A challenger is told what to do: " + attackerView);
            Require(attackerView.Contains("Возрождений у стороны: 2 из 3 (общие на состав)"),
                "The side's shared respawns are counted: " + attackerView);

            string defenderView = RoaKromkaSiegePresentation.DescribeSiege(relay, "def", Now);
            Require(!defenderView.Contains("Возьмите") && defenderView.Contains("гибель тратит возрождение"),
                "The defence is told that killing challengers costs them: " + defenderView);
            Require(defenderView.Contains("«Ржавые»") || defenderView.Contains("«Синие»"), "Foreign sides are named: " + defenderView);

            relay["relayScores"] = JObject.Parse(@"{'atk':0,'b2':1}");
            relay["relayOwners"] = JObject.Parse(@"{'relay_a':'','relay_b':'','relay_c':'b2'}");
            Require(RoaKromkaSiegePresentation.ProjectedQualifier(relay) == "b2", "The relay leader qualifies on time");

            // --- свой клан по ростеру ----------------------------------------------
            Require(RoaKromkaSiegePresentation.OwnClanId(relay, "c2", "atk") == "def",
                "The roster outranks a stale clan id from another player's entry");
            Require(RoaKromkaSiegePresentation.OwnClanId(relay, "ghost", "atk") == "atk", "Without a roster match the server clan stays");

            // --- пролом --------------------------------------------------------------
            JObject breach = Event("breach");
            breach["qualifiedAttackerClanId"] = "atk";
            breach["gateHp"] = 425;
            string breachView = RoaKromkaSiegePresentation.DescribeSiege(breach, "def", Now);
            Require(breachView.Contains("Штурм: «Ржавые» · ворота 425/1000") && breachView.Contains("Удержите ворота"),
                "The breach shows the attacker and the gate: " + breachView);
            Require(RoaKromkaSiegePresentation.DescribeSiege(breach, "b2", Now).Contains("ваш клан в нём не участвует"),
                "A challenger who did not qualify is told so");

            // --- ядро ----------------------------------------------------------------
            JObject core = Event("core");
            core["qualifiedAttackerClanId"] = "atk";
            core["coreOwnerClanId"] = "atk";
            core["coreHoldStartedAt"] = Now - 60000L;
            string coreView = RoaKromkaSiegePresentation.DescribeSiege(core, "atk", Now);
            Require(coreView.Contains("Перезапись: наши · до захвата 02:00"), "The core hold is counted down: " + coreView);
            Require(coreView.Contains("не дайте её сбить (03:00)"), "The hold length comes from the snapshot: " + coreView);
            Require(!coreView.Contains("стоит на ядре") && !coreView.Contains("оспарива"),
                "Nothing is claimed that the server does not track: " + coreView);
            core["phaseEndsAt"] = Now + 30000L;
            Require(RoaKromkaSiegePresentation.DescribeSiege(core, "atk", Now).Contains("не успеет до конца фазы"),
                "A hold that outlasts the phase says so");
            core["coreOwnerClanId"] = string.Empty;
            core["coreHoldStartedAt"] = 0;
            Require(RoaKromkaSiegePresentation.DescribeSiege(core, "def", Now).Contains("перезапись не запущена"),
                "A free core is named plainly");
            core["respawnWaves"] = JObject.Parse(@"{'atk':3}");
            Require(RoaKromkaSiegePresentation.DescribeSiege(core, "atk", Now).Contains("следующая гибель выведет из осады"),
                "No respawns left is a warning, not a zero");

            // --- нейтральный гарнизон и длинные имена ------------------------------
            JObject neutral = Event("breach");
            neutral["defenderClanId"] = "neutral";
            neutral["defenderName"] = "Нейтральный гарнизон";
            Require(!RoaKromkaSiegePresentation.DescribeSiege(neutral, "neutral", Now).Contains("Возрождений"),
                "A neutral garrison has no respawn line");
            JObject longName = Event("relay");
            longName["challengers"][0]["name"] = "Очень длинное название клана на сорок два";
            string cut = RoaKromkaSiegePresentation.SideName(longName, "atk", "def");
            Require(cut.Length <= 18 && cut.EndsWith("…»"), "Long clan names are shortened: " + cut);

            // --- итог ----------------------------------------------------------------
            JObject resolved = Event("core");
            resolved["status"] = "resolved";
            resolved["winnerClanId"] = "atk";
            resolved["result"] = "attacker_core_held";
            string result = RoaKromkaSiegePresentation.DescribeSiege(resolved, "def", Now);
            Require(result.Contains("ОСАДА ЗАВЕРШЕНА") && result.Contains("Победитель: «Ржавые»") && result.Contains("атака удержала ядро"),
                "The result names the winner, not its id: " + result);
            Require(RoaKromkaSiegePresentation.ResultLabel("defender_timeout") == "время защиты истекло",
                "Every server outcome has words");

            // --- возрождение в осаде -----------------------------------------------
            string wave = RoaRecoveryCanvas.NextText(JObject.Parse(@"{'reason':'clanSiegeWave','respawnWavesRemaining':2}"));
            Require(wave.Contains("осталось 2") && !wave.Contains("безопасном поселении"), "A siege respawn is not a trip home: " + wave);
            Require(RoaRecoveryCanvas.NextText(JObject.Parse(@"{'reason':'clanSiegeWave','respawnWavesRemaining':0}")).Contains("последнее возрождение"),
                "The last respawn is announced");
            Require(RoaRecoveryCanvas.NextText(JObject.Parse(@"{'reason':'death','cause':{'siegeEliminated':true}}")).Contains("выбыли из осады"),
                "Elimination is named");

            // --- сама панель -----------------------------------------------------------
            var host = new GameObject("SiegeUiProbe");
            try
            {
                var presentation = host.AddComponent<RoaKromkaSiegePresentation>();
                presentation.Configure(null, null);
                Canvas canvas = host.GetComponentInChildren<Canvas>(true);
                Require(canvas != null, "The siege panel builds its canvas");
                CanvasScaler scaler = canvas.GetComponent<CanvasScaler>();
                Require(scaler != null && scaler.matchWidthOrHeight == 0.5f && scaler.referenceResolution == RoaUiScale.Reference,
                    "The siege canvas scales like the HUD");
                Transform status = canvas.transform.Find("SiegeStatus/Status");
                Require(status != null && status.GetComponent<Text>().verticalOverflow == VerticalWrapMode.Truncate,
                    "The status text never spills over the world");
                RectTransform panel = (RectTransform)canvas.transform.Find("SiegeStatus");
                Require(Mathf.Approximately(panel.anchoredPosition.y, RoaKromkaSiegePresentation.PanelTop),
                    "The panel sits under the PvP banner of the HUD");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }

            Debug.Log("[SIEGE SCORE] OK: relay owners and the time qualifier, breach gate, core hold countdown, shared respawns, named result, siege respawn text and a HUD-scaled truncating panel.");
        }

        private static JObject Event(string phase)
        {
            return JObject.Parse(@"{
                'id':'s1','roomId':'clanSiege#hydro2#s1','status':'active','phase':'" + phase + @"',
                'phaseEndsAt':" + (Now + 300000L) + @",
                'defenderClanId':'def','defenderName':'Гарнизон Узла',
                'challengers':[{'clanId':'atk','name':'Ржавые','declaredAt':1000},{'clanId':'b2','name':'Синие','declaredAt':2000}],
                'rosters':{'atk':['c1'],'def':['c2'],'b2':['c3']},
                'relayOwners':{'relay_a':'','relay_b':'','relay_c':''},'relayScores':{'atk':0,'b2':0},
                'qualifiedAttackerClanId':'','gateHp':1000,'gateMaxHp':1000,
                'coreOwnerClanId':'','coreHoldStartedAt':0,'coreHoldMs':180000,
                'respawnWaves':{'atk':1},'respawnWavesPerSide':3,
                'winnerClanId':'','result':''
            }");
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[SIEGE SCORE] " + message);
        }
    }
}
#endif
