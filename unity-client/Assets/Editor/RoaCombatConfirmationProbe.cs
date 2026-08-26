#if UNITY_EDITOR
using System;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

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

                float contactSeconds = RoaMeleeGrip.StrikeContactSeconds();
                float fastAckDelay = RoaCombat.MeleePresentationDelay(10f, 10.035f);
                float lateAckDelay = RoaCombat.MeleePresentationDelay(10f, 10.25f);
                Require(contactSeconds > 0.208f && contactSeconds < 0.210f
                        && fastAckDelay > 0.173f && fastAckDelay < 0.175f
                        && lateAckDelay < 0.001f,
                        "melee result is not synchronized with the authored contact phase");
                RoaMeleeGrip.Profile axe = RoaMeleeGrip.Get("axe");
                RoaMeleeGrip.Sample(axe, RoaMeleeGrip.StrikeContactPhase,
                    out Vector3 contactPrimary, out Vector3 contactDirection,
                    out Vector3 contactSpine);
                Require(Vector3.Distance(contactPrimary, axe.Strike.Primary) < 0.001f
                        && Vector3.Angle(contactDirection, axe.Strike.Direction) < 0.1f
                        && Vector3.Distance(contactSpine, axe.SpineStrike) < 0.001f,
                        "shared contact phase no longer reaches the authored strike pose");
                Require(RoaEnemies.ShouldDeferMeleeState(10f, 10.2f, 40, 20, false)
                        && RoaEnemies.ShouldDeferMeleeState(10f, 10.2f, 40, 40, true)
                        && !RoaEnemies.ShouldDeferMeleeState(10.21f, 10.2f, 40, 20, false)
                        && !RoaEnemies.ShouldDeferMeleeState(10f, 10.2f, 40, 40, false),
                        "PvE target damage/death hold is not selective or bounded");

                RoaCombatFeedbackCanvas.FloatingFrame floatingStart =
                    RoaCombatFeedbackCanvas.EvaluateFloating(0f);
                RoaCombatFeedbackCanvas.FloatingFrame floatingFade =
                    RoaCombatFeedbackCanvas.EvaluateFloating(0.82f);
                Require(floatingStart.Visible && floatingStart.Alpha > 0.99f
                        && floatingFade.Visible && floatingFade.Rise > 20f
                        && floatingFade.Alpha < floatingStart.Alpha
                        && !RoaCombatFeedbackCanvas.EvaluateFloating(1.11f).Visible,
                        "floating combat text does not pop, rise, fade and expire deterministically");

                root = new GameObject("Combat confirmation probe");
                RoaEnemies holdProbe = root.AddComponent<RoaEnemies>();
                holdProbe.BeginMeleePresentationHold("target", contactSeconds);
                Require(holdProbe.MeleePresentationHoldCount == 1,
                        "PvE target hold was not registered for the active swing");
                holdProbe.CompleteMeleePresentationHold("target");
                Require(holdProbe.MeleePresentationHoldCount == 0,
                        "PvE target hold survived the contact result");

                var cameraRoot = new GameObject("Combat feedback camera", typeof(Camera));
                cameraRoot.transform.SetParent(root.transform, false);
                Camera camera = cameraRoot.GetComponent<Camera>();
                cameraRoot.transform.position = new Vector3(0f, 3f, -8f);
                cameraRoot.transform.LookAt(new Vector3(0f, 1f, 0f));

                RoaCombatFeedbackCanvas feedback = root.AddComponent<RoaCombatFeedbackCanvas>();
                feedback.Configure(camera);
                Canvas.ForceUpdateCanvases();
                feedback.ShowFloating("КРИТ 42", new Vector3(1.25f, 1.7f, 0f),
                    new Color(1f, 0.82f, 0.3f));
                feedback.ShowHit(new Vector3(1.25f, 1.1f, 0f), true, false);
                feedback.RefreshNow();
                Require(feedback.CanvasReady && feedback.InputTransparent
                        && feedback.ActiveFloatingCount == 1 && feedback.ActiveMarkerCount == 1,
                        "combat feedback Canvas is missing, intercepts input or lost an accepted result");
                RectTransform markerRect = Array.Find(
                    root.GetComponentsInChildren<RectTransform>(true),
                    item => item.gameObject.activeInHierarchy
                        && item.gameObject.name == "AuthoritativeHitMarker");
                RectTransform floatingRect = Array.Find(
                    root.GetComponentsInChildren<RectTransform>(true),
                    item => item.gameObject.activeInHierarchy
                        && item.gameObject.name == "FloatingCombatText");
                Require(markerRect != null && floatingRect != null
                        && markerRect.anchoredPosition.x > 0.1f
                        && floatingRect.anchoredPosition.x > 0.1f
                        && markerRect.GetComponent<CanvasGroup>().alpha > 0.99f
                        && floatingRect.GetComponent<CanvasGroup>().alpha > 0.99f,
                        "accepted feedback did not project to a visible Canvas position");
                RawImage[] markerSegments = Array.FindAll(
                    root.GetComponentsInChildren<RawImage>(true),
                    image => image.gameObject.activeInHierarchy
                        && image.gameObject.name.StartsWith("Segment"));
                Text[] labels = Array.FindAll(root.GetComponentsInChildren<Text>(true),
                    label => label.gameObject.activeInHierarchy);
                Require(markerSegments.Length == 8 && labels.Length == 1
                        && labels[0].fontSize == 23 && labels[0].text == "КРИТ 42",
                        "Canvas marker corners or critical floating text styling is incomplete");

                int floatingPool = feedback.FloatingPoolSize;
                int markerPool = feedback.MarkerPoolSize;
                for (int i = 0; i < floatingPool + 5; i++)
                    feedback.ShowFloating(i.ToString(), new Vector3(0f, 1.7f, 0f), Color.white);
                for (int i = 0; i < markerPool + 5; i++)
                    feedback.ShowHit(new Vector3(0f, 1.1f, 0f), false, false);
                Require(feedback.FloatingPoolSize == floatingPool
                        && feedback.MarkerPoolSize == markerPool
                        && feedback.ActiveFloatingCount == floatingPool
                        && feedback.ActiveMarkerCount == markerPool,
                        "combat feedback pools grew or exceeded their fixed capacity");
                feedback.Clear();
                Require(feedback.ActiveFloatingCount == 0 && feedback.ActiveMarkerCount == 0,
                        "combat feedback pools did not clear cleanly");

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
                    + ", canvasPools=" + floatingPool + "/" + markerPool
                    + ", pooledImpact=" + fx.ActiveImpactCount
                    + ", meleeContact=" + Mathf.RoundToInt(contactSeconds * 1000f)
                    + "ms, ack35Wait=" + Mathf.RoundToInt(fastAckDelay * 1000f)
                    + "ms, targetHold=damage/death");
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
