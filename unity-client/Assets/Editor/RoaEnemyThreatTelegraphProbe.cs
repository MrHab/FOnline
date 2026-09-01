#if UNITY_EDITOR
using System;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaEnemyThreatTelegraphProbe
    {
        [MenuItem("Realm of Ashes/Проверить предупреждение атаки NPC")]
        private static void Run()
        {
            GameObject root = null;
            try
            {
                RoaEnemyThreatTelegraph.Frame early = RoaEnemyThreatTelegraph.Evaluate(
                    0.38f, 0.4f, true, true);
                RoaEnemyThreatTelegraph.Frame urgent = RoaEnemyThreatTelegraph.Evaluate(
                    0.05f, 0.4f, true, true);
                RoaEnemyThreatTelegraph.Frame party = RoaEnemyThreatTelegraph.Evaluate(
                    0.18f, 0.52f, false, false);
                RoaEnemyThreatTelegraph.Frame expired = RoaEnemyThreatTelegraph.Evaluate(
                    0f, 0.4f, true, true);

                Require(early.Visible && early.Progress < 0.1f,
                    "warning does not begin at the server window boundary");
                Require(urgent.Radius < early.Radius && urgent.Width > early.Width
                    && urgent.Color.r >= urgent.Color.g,
                    "attack tell does not converge and intensify before impact");
                Require(party.Visible && !party.TargetsLocalPlayer && party.AimAlpha <= 0f,
                    "party warning incorrectly draws a personal aim line");
                Require(!expired.Visible, "expired warning stays visible after impact");

                root = new GameObject("Enemy threat telegraph probe");
                RoaEnemyThreatTelegraph view = root.AddComponent<RoaEnemyThreatTelegraph>();
                view.Present(urgent, new Vector3(2f, 0f, 3f), new Vector3(6f, 0f, 7f), true);
                Require(view.ActiveRendererCount == 2,
                    "targeted ranged warning is missing ring or aim line");
                view.Present(expired, Vector3.zero, Vector3.forward, true);
                Require(view.ActiveRendererCount == 0,
                    "warning renderers are not disabled after expiry");

                RoaAudio audio = root.AddComponent<RoaAudio>();
                if (audio.GeneratedClipCount == 0)
                {
                    MethodInfo awake = typeof(RoaAudio).GetMethod("Awake",
                        BindingFlags.Instance | BindingFlags.NonPublic);
                    Require(awake != null, "audio Awake is missing");
                    awake.Invoke(audio, null);
                }
                Require(audio.ThreatWarningCueReady && audio.GeneratedClipCount == 32,
                    "personal threat warning audio is missing");

                Debug.Log("[ПРЕДУПРЕЖДЕНИЕ NPC] готово: сходящееся кольцо, личная линия и скрытие проверены.");
            }
            catch (Exception error)
            {
                Debug.LogError("[ПРЕДУПРЕЖДЕНИЕ NPC] ошибка: " + error.Message);
            }
            finally
            {
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
