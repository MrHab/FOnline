#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaActivityHubPresentationProbe
    {
        [MenuItem("Realm of Ashes/Проверить центр активностей")]
        public static void Run()
        {
            var tasks = new List<JObject> { Task("signal:1", "Сигнал у вышки", 128, 24, 18d) };
            string stable = Signature(tasks, false, false, 4.01f, 12d);
            var repeated = new List<JObject> { (JObject)tasks[0].DeepClone() };
            repeated[0]["revision"] = 99;
            Require(stable == Signature(repeated, false, false, 4.04f, 12d),
                "invisible snapshot revisions rebuild the activity cards");
            repeated[0]["title"] = "Новый сигнал";
            Require(stable != Signature(repeated, false, false, 4.04f, 12d),
                "a visible title change does not rebuild the activity cards");
            Require(stable != Signature(tasks, true, false, 4.01f, 12d),
                "travel state does not refresh disabled activity actions");
            Require(stable != Signature(tasks, false, true, 4.01f, 12d),
                "accepted state does not refresh the activity card");

            RoaActivityHubPresentation.TransitionSample openStart =
                RoaActivityHubPresentation.Sample(true, 0f);
            RoaActivityHubPresentation.TransitionSample openEnd =
                RoaActivityHubPresentation.Sample(true, RoaActivityHubPresentation.TransitionSeconds);
            RoaActivityHubPresentation.TransitionSample closeEnd =
                RoaActivityHubPresentation.Sample(false, RoaActivityHubPresentation.TransitionSeconds);
            Require(openStart.PanelAlpha < 0.001f && openStart.LauncherAlpha > 0.99f
                    && openStart.PanelOffsetX < -15f,
                "activity hub does not begin from the compact launcher");
            Require(openEnd.PanelAlpha > 0.99f && openEnd.LauncherAlpha < 0.001f
                    && Mathf.Abs(openEnd.PanelOffsetX) < 0.01f,
                "activity hub does not settle fully open");
            Require(closeEnd.PanelAlpha < 0.001f && closeEnd.LauncherAlpha > 0.99f,
                "activity hub does not settle into the compact launcher");
            RoaActivityHubPresentation.CardRefreshSample cardsStart =
                RoaActivityHubPresentation.SampleCardRefresh(0f);
            RoaActivityHubPresentation.CardRefreshSample cardsEnd =
                RoaActivityHubPresentation.SampleCardRefresh(0.18f);
            Require(cardsStart.Alpha > 0.5f && cardsStart.Alpha < 0.55f && cardsStart.OffsetY > 4.9f
                    && cardsEnd.Alpha > 0.99f && cardsEnd.OffsetY < 0.01f,
                "changed cards do not settle without a visible pop");
            Require(RoaActivityHubPresentation.LauncherText(true, 8.2f, 3) == "В ПУТИ · 9 С"
                    && RoaActivityHubPresentation.LauncherText(false, 0f, 3).EndsWith("· 3"),
                "compact launcher does not communicate travel or signal count");
            Require(RoaActivityHubPresentation.DeadlineLabel(tasks[0], 12d) == "ещё 6 ч"
                    && RoaActivityHubPresentation.DeadlineLabel(tasks[0], 17.5d) == "меньше часа",
                "activity deadline urgency is unclear");

            Debug.Log("[ЦЕНТР АКТИВНОСТЕЙ] готово: стабильные карточки, плавное сворачивание, "
                + "маршрут и срок читаются в компактном режиме");
        }

        private static string Signature(List<JObject> tasks, bool travel, bool accepted,
                                        float distance, double worldHour)
        {
            return RoaActivityHubPresentation.BuildSignature(tasks, travel, false,
                _ => accepted, _ => accepted, _ => false, _ => distance, worldHour);
        }

        private static JObject Task(string id, string title, int xp, int caps, double expires)
        {
            return new JObject
            {
                ["id"] = id,
                ["revision"] = 1,
                ["type"] = "distress_signal",
                ["title"] = title,
                ["targetSiteName"] = "Старая вышка",
                ["siteId"] = "site:tower",
                ["issuerSiteId"] = "site:settlement",
                ["priority"] = 5,
                ["expiresHour"] = expires,
                ["reward"] = new JObject { ["xp"] = xp, ["caps"] = caps }
            };
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
