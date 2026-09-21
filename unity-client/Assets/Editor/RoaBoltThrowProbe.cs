#if UNITY_EDITOR
using System;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaBoltThrowProbe
    {
        public static void RunBatch()
        {
            try
            {
                RunProbe();
                EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[BOLT THROW] FAIL: " + error);
                EditorApplication.Exit(1);
            }
        }

        private static void RunProbe()
        {
            GameObject actor = null;
            GameObject tool = null;
            try
            {
                actor = new GameObject("Bolt throw actor");
                actor.transform.position = new Vector3(3f, 0f, -2f);
                RoaCharacterView view = actor.AddComponent<RoaCharacterView>();
                Transform hand = new GameObject("hand_r").transform;
                hand.SetParent(actor.transform, false);
                hand.localPosition = new Vector3(0.31f, 1.07f, 0.18f);

                Require(view.TryGetRightHand(out Vector3 animatedHand)
                        && Vector3.Distance(animatedHand, hand.position) < 0.0001f,
                    "character view did not expose the animated hand_r position");

                MethodInfo resolve = typeof(RoaBoltThrower).GetMethod("ResolveThrowOrigin",
                    BindingFlags.NonPublic | BindingFlags.Static);
                Require(resolve != null, "bolt throw origin resolver is missing");
                Vector3 origin = (Vector3)resolve.Invoke(null, new object[]
                {
                    view, actor.transform.position, new Vector3(8f, 0.13f, 4f)
                });
                Require(Vector3.Distance(origin, hand.position) < 0.0001f,
                    "bolt origin is detached from the animated right hand");

                UnityEngine.Object.DestroyImmediate(hand.gameObject);
                Vector3 fallback = (Vector3)resolve.Invoke(null, new object[]
                {
                    view, actor.transform.position, new Vector3(8f, 0.13f, 4f)
                });
                Require(fallback.y > actor.transform.position.y + 0.8f
                        && Vector3.Distance(fallback, actor.transform.position) > 0.8f,
                    "unloaded-model fallback still launches the bolt from the actor centre");

                tool = new GameObject("Bolt tool without aiming indicator");
                Transform retired = new GameObject("BoltThrowReticle").transform;
                retired.SetParent(tool.transform, false);
                RoaBoltThrower boltThrower = tool.AddComponent<RoaBoltThrower>();
                boltThrower.Configure(null, null, null);
                Require(boltThrower.ThrowRangeMeters == 10f, "Ordinary aiming range changed");
                var socket = tool.AddComponent<RoaSocketClient>();
                var session = new JoinAck { Self = new JObject { ["boltRangeMeters"] = 13 } };
                typeof(RoaSocketClient).GetProperty("Session").SetValue(socket, session);
                boltThrower.Configure(socket, null, null);
                Require(boltThrower.ThrowRangeMeters == 13f, "Magnetic aiming must not be clamped to ordinary range");
                Transform[] presentation = tool.GetComponentsInChildren<Transform>(true);
                Require(Array.TrueForAll(presentation, node => node.name != "BoltThrowReticle"
                        && node.name != "TenMeterRange" && node.name != "ServerProposedTrajectory"
                        && node.name != "TargetCross"),
                    "bolt tool still creates an aiming indicator");

                Debug.Log("[BOLT THROW] PASS: trajectory starts at animated hand_r; "
                    + "the unloaded-model fallback uses a hand-height offset; aim indicator is absent; magnetic aiming reaches 13 m.");
            }
            finally
            {
                if (tool != null) UnityEngine.Object.DestroyImmediate(tool);
                if (actor != null) UnityEngine.Object.DestroyImmediate(actor);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
