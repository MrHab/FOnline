#if UNITY_EDITOR
using System;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Входящий запрос лечения и приглашение к обмену. Прежде оба открывали
    /// выключенное IMGUI-окно ПУТНИКА: игрок терял HUD и управление, не видя
    /// ни одного окна. Проба гонит настоящие обработчики событий сокета и
    /// смотрит, что открывается живая канва, а невидимое окно не держит ввод.
    /// </summary>
    public static class RoaSocialRoutingProbe
    {
        private const BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;

        [MenuItem("Realm of Ashes/Probe/Social routing")]
        public static void Run()
        {
            var host = new GameObject("SocialRoutingProbe");
            try
            {
                var pipboy = host.AddComponent<RoaPipboy>();
                int canvasOpens = 0;
                pipboy.CanvasDriven = true;
                pipboy.OpenSocialCanvas = () => canvasOpens++;

                // --- запрос лечения ------------------------------------------------
                Invoke(pipboy, "HandleMedicalConsentRequested",
                    JObject.Parse(@"{'id':'consent-1','healerName':'Лекарь','itemId':'medkit'}"));
                Require(canvasOpens == 1, "A medical consent request opens the Friends page of the canvas");
                Require(!pipboy.IsOpen, "The hidden IMGUI window is never reported open under the canvas");
                Require(!pipboy.PointerOverUi, "The hidden IMGUI window never swallows the pointer");
                Require(pipboy.MedicalConsentRequest?["id"]?.ToString() == "consent-1",
                    "The request reaches the page that draws it");

                // --- обмен ----------------------------------------------------------
                var trade = JObject.Parse(@"{'state':{'id':'trade-1','status':'invited'},'message':'Приглашение к обмену.'}");
                Invoke(pipboy, "HandlePlayerTradeUpdated", trade);
                Require(canvasOpens == 2, "A new trade opens the Friends page");
                Invoke(pipboy, "HandlePlayerTradeUpdated",
                    JObject.Parse(@"{'state':{'id':'trade-1','status':'open'}}"));
                Require(canvasOpens == 2, "Later trade updates do not reopen a terminal the player closed");
                Invoke(pipboy, "HandlePlayerTradeUpdated", JObject.Parse(@"{'state':null}"));
                Require(pipboy.PlayerTrade == null, "A finished trade clears the state");
                Invoke(pipboy, "HandlePlayerTradeUpdated", trade);
                Require(canvasOpens == 3, "The next trade opens the page again");
                Require(!pipboy.IsOpen, "Trades never raise the hidden IMGUI flag");

                // --- прежний путь без канвы -----------------------------------------
                var legacy = host.AddComponent<RoaPipboy>();
                legacy.CanvasDriven = false;
                legacy.OpenSocial();
                Require(legacy.IsOpen, "Without the canvas the IMGUI window still opens");

                Debug.Log("[SOCIAL ROUTING] OK: consent and trade open the canvas Friends page, the hidden IMGUI window never holds input.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Invoke(RoaPipboy pipboy, string method, JObject payload)
        {
            MethodInfo info = typeof(RoaPipboy).GetMethod(method, Private);
            if (info == null) throw new Exception("[SOCIAL ROUTING] RoaPipboy has no " + method);
            info.Invoke(pipboy, new object[] { payload });
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception("[SOCIAL ROUTING] " + message);
        }
    }
}
#endif
