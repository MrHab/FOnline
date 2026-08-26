#if UNITY_EDITOR
using System;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaCombatConfirmationProbe
    {
        [MenuItem("Realm of Ashes/Проверить подтверждение попадания")]
        private static void Run()
        {
            GameObject root = null;
            try
            {
                RoaCombatConfirmation.Frame normal = RoaCombatConfirmation.Evaluate(0f, false, false);
                RoaCombatConfirmation.Frame critical = RoaCombatConfirmation.Evaluate(0f, true, false);
                RoaCombatConfirmation.Frame killed = RoaCombatConfirmation.Evaluate(0f, true, true);
                RoaCombatConfirmation.Frame settled = RoaCombatConfirmation.Evaluate(0.24f, false, false);

                Require(normal.Visible && normal.Alpha > 0.99f,
                        "normal hit marker is not immediately readable");
                Require(critical.Length > normal.Length && critical.Thickness > normal.Thickness,
                        "critical hit is not stronger than a normal hit");
                Require(killed.Radius > critical.Radius && killed.Color.r > killed.Color.g,
                        "kill marker has no distinct size or danger colour");
                Require(settled.Visible && settled.Radius < normal.Radius && settled.Alpha > 0f,
                        "hit marker does not converge before fading");
                Require(RoaCombatConfirmation.Expired(0.39f, false)
                        && !RoaCombatConfirmation.Expired(0.39f, true)
                        && RoaCombatConfirmation.Expired(0.49f, true),
                        "normal and kill marker lifetimes are not bounded");

                root = new GameObject("Combat confirmation probe");
                RoaAudio audio = root.AddComponent<RoaAudio>();
                if (audio.GeneratedClipCount == 0)
                {
                    MethodInfo awake = typeof(RoaAudio).GetMethod("Awake",
                        BindingFlags.Instance | BindingFlags.NonPublic);
                    Require(awake != null, "audio Awake is missing");
                    awake.Invoke(audio, null);
                }
                Require(audio.CombatConfirmationCuesReady && audio.GeneratedClipCount == 32,
                        "normal, critical or kill confirmation audio is missing");

                RoaCombatFx fx = root.AddComponent<RoaCombatFx>();
                RoaCombatPresentationFx polish = root.AddComponent<RoaCombatPresentationFx>();
                fx.Polish = polish;
                fx.PlayConfirmedHit(new Vector3(4f, 0f, 2f), Vector3.zero,
                                    "rifle", true, false);
                Require(fx.ActiveImpactCount == 1,
                        "authoritative hit did not acquire a pooled impact");
                Transform impact = root.transform.Find("LayeredImpactFx");
                Require(impact != null && impact.gameObject.activeSelf && impact.position.y > 0.8f,
                        "confirmed impact is hidden or rendered at the target's feet");

                Debug.Log("[ПОДТВЕРЖДЕНИЕ ПОПАДАНИЯ] готово: marker="
                    + normal.Radius.ToString("0") + "→" + settled.Radius.ToString("0")
                    + ", critical/kill=" + critical.Length.ToString("0") + "/"
                    + killed.Length.ToString("0") + ", audio=" + audio.GeneratedClipCount
                    + ", pooledImpact=" + fx.ActiveImpactCount);
            }
            catch (Exception error)
            {
                Debug.LogError("[ПОДТВЕРЖДЕНИЕ ПОПАДАНИЯ] ошибка: " + error.Message);
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
