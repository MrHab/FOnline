#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Deterministic regression coverage for live strategic-map actors: server
    /// snapshot ordering, route extrapolation, model selection and label scaling.
    /// </summary>
    public static class RoaGlobalMapLiveActorsProbe
    {
        private const float Epsilon = 0.001f;
        private static bool _batchOptionsCaptured;
        private static bool _previousEnterPlayModeOptionsEnabled;
        private static EnterPlayModeOptions _previousEnterPlayModeOptions;

        [MenuItem("Realm of Ashes/Проверки/Живые актёры глобальной карты")]
        public static void Run()
        {
            VerifyPartyRouteExtrapolation();
            VerifyWastelandSnapshotOrdering();
            VerifyPartyModelMappings();
            VerifyOverlayLabelScaling();
            VerifyStrategicProfilesAndLod();

            Debug.Log("[GLOBAL MAP LIVE ACTORS] маршрут, снимки, 3D-модели и масштаб меток проверены.");
        }

        public static void RunModelsBatch()
        {
            if (EditorApplication.isPlaying)
            {
                RunModelsBatchAsync();
                return;
            }

            try
            {
                _previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
                _previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
                _batchOptionsCaptured = true;
                EditorSettings.enterPlayModeOptionsEnabled = true;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorApplication.playModeStateChanged += OnModelsPlayModeStateChanged;
                EditorApplication.EnterPlaymode();
            }
            catch (Exception error)
            {
                Debug.LogError("[GLOBAL MAP LIVE ACTORS] MODEL BATCH FAIL: " + error);
                FinishModelsBatch(1);
            }
        }

        private static void OnModelsPlayModeStateChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnModelsPlayModeStateChanged;
            RunModelsBatchAsync();
        }

        private static async void RunModelsBatchAsync()
        {
            try
            {
                await RunModelsAsync();
                Debug.Log("[GLOBAL MAP LIVE ACTORS] MODEL BATCH PASS");
                FinishModelsBatch(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[GLOBAL MAP LIVE ACTORS] MODEL BATCH FAIL: " + error);
                FinishModelsBatch(1);
            }
        }

        private static void FinishModelsBatch(int exitCode)
        {
            if (_batchOptionsCaptured)
            {
                EditorSettings.enterPlayModeOptions = _previousEnterPlayModeOptions;
                EditorSettings.enterPlayModeOptionsEnabled = _previousEnterPlayModeOptionsEnabled;
                _batchOptionsCaptured = false;
            }
            EditorApplication.Exit(exitCode);
        }

        public static async Task RunModelsAsync()
        {
            const string baseUrl = "http://127.0.0.1:9";
            var roots = new List<GameObject>();
            UninterruptedDeferAgent deferAgent = null;
            try
            {
                if (!Application.isPlaying)
                {
                    deferAgent = new UninterruptedDeferAgent();
                    GltfImport.SetDefaultDeferAgent(deferAgent);
                }

                var views = new List<RoaGlobalMapActorView>();
                for (int i = 0; i < 4; i++)
                {
                    var root = new GameObject("GlobalMapActorProbe:" + i);
                    root.transform.position = new Vector3((i - 1.5f) * 2.2f, 0.5f, 0f);
                    roots.Add(root);
                    views.Add(root.AddComponent<RoaGlobalMapActorView>());
                }

                JObject player = new JObject
                {
                    ["appearance"] = new JObject
                    {
                        ["sex"] = "male", ["bodyType"] = "medium",
                        ["faceId"] = "male_02", ["hairId"] = "short_crop",
                        ["skinToneId"] = "skin_03", ["hairColorId"] = "hair_04"
                    },
                    ["equipmentRuntime"] = new JObject()
                };
                JObject caravan = new JObject
                {
                    ["id"] = "probe-caravan", ["kind"] = "caravan",
                    ["faction"] = "caravans"
                };
                JObject mutant = new JObject
                {
                    ["id"] = "probe-mutant", ["kind"] = "squad",
                    ["faction"] = "mutants"
                };
                JObject gecko = new JObject
                {
                    ["id"] = "probe-gecko", ["kind"] = "monster",
                    ["faction"] = "wild", ["visual"] = "fire-gecko"
                };

                if (Application.isPlaying)
                {
                    // Match the first live wasteland snapshot: different actor
                    // archetypes begin loading together and same-URL requests share
                    // their in-flight task.
                    await Task.WhenAll(
                        views[0].ConfigurePlayer(baseUrl, player),
                        views[1].ConfigureParty(baseUrl, caravan),
                        views[2].ConfigureParty(baseUrl, mutant),
                        views[3].ConfigureParty(baseUrl, gecko));
                }
                else
                {
                    // glTFast 6.14.1 has an Editor-only bone-weight job safety issue.
                    await views[0].ConfigurePlayer(baseUrl, player);
                    await views[1].ConfigureParty(baseUrl, caravan);
                    await views[2].ConfigureParty(baseUrl, mutant);
                    await views[3].ConfigureParty(baseUrl, gecko);
                }

                string[] expected =
                {
                    "player", "friendlyBrahmin", "enemySuperMutant", "enemyFireGecko"
                };
                for (int i = 0; i < views.Count; i++)
                {
                    RoaGlobalMapActorView view = views[i];
                    Check(view.Ready && view.ModelRendererCount > 0,
                        "real GLB has no renderer: " + expected[i]);
                    Check(view.ModelKey == expected[i],
                        "wrong GLB key: " + view.ModelKey + " instead of " + expected[i]);
                    Check(view.UsesProjectPrefab,
                        "actor used the network fallback instead of its Unity prefab: " + expected[i]);
                    Check(Mathf.Abs(view.CurrentWorldSpan
                        - view.StrategicProfile.TargetWorldSpan) <= 0.06f,
                        "strategic profile size mismatch: " + expected[i]);
                    view.SetMotion(Vector3.forward, false);
                    view.SetPresentationLod(RoaActorPresentationTier.Far);
                    Check(view.ModelVisible && view.EnabledAnimationCount == 0,
                        "stationary far actor still spends animation budget: " + expected[i]);
                    view.SetPresentationLod(RoaActorPresentationTier.Near);
                    Check(view.EnabledAnimationCount > 0,
                        "near actor has no active animation: " + expected[i]);
                    view.SetMotion(Vector3.forward, true);
                    Check(view.MotionClip == "walk",
                        "real GLB did not enter walk: " + expected[i] + " / " + view.MotionClip);
                    view.SetPresentationLod(RoaActorPresentationTier.Hidden);
                    Check(!view.ModelVisible && view.EnabledAnimationCount == 0,
                        "hidden actor kept a visible or animated model: " + expected[i]);
                    view.SetPresentationLod(RoaActorPresentationTier.Near);
                    foreach (Collider collider in view.GetComponentsInChildren<Collider>(true))
                        Check(!collider.enabled,
                            "strategic GLB left an enabled collider: " + expected[i]);
                }
                Debug.Log("[GLOBAL MAP LIVE ACTORS] real GLBs loaded: "
                    + string.Join(", ", expected));
            }
            finally
            {
                if (deferAgent != null) GltfImport.UnsetDefaultDeferAgent(deferAgent);
                for (int i = 0; i < roots.Count; i++)
                    if (roots[i] != null) UnityEngine.Object.DestroyImmediate(roots[i]);
            }
        }

        private static void VerifyPartyRouteExtrapolation()
        {
            JObject party = MovingParty();
            CheckPoint(DisplayPoint(party, 0f), 100f, 100f, "позиция при возрасте снимка 0 с");
            CheckPoint(DisplayPoint(party, 5f), 106f, 100f, "позиция при возрасте снимка 5 с");
            CheckPoint(DisplayPoint(party, 7f), 106f, 102.4f, "позиция при возрасте снимка 7 с");
            CheckPoint(DisplayPoint(party, 7.5f), 106f, 103f, "позиция на пределе экстраполяции");
            CheckPoint(DisplayPoint(party, 60f), 106f, 103f, "позиция после предела экстраполяции");

            string[] blockedStates =
            {
                "engaged", "onsite", "staging", "recovering", "forming", "destroyed"
            };
            foreach (string state in blockedStates)
            {
                JObject blocked = (JObject)party.DeepClone();
                blocked["state"] = state;
                CheckPoint(DisplayPoint(blocked, 7f), 100f, 100f,
                    "заблокированное состояние " + state);
            }

            JObject destroyed = (JObject)party.DeepClone();
            destroyed["destroyed"] = true;
            CheckPoint(DisplayPoint(destroyed, 7f), 100f, 100f,
                "уничтоженный отряд");
        }

        private static void VerifyWastelandSnapshotOrdering()
        {
            Check(RoaGlobalMap.WastelandSnapshotIsStale(null, null),
                "пустой входящий снимок должен считаться устаревшим");
            Check(!RoaGlobalMap.WastelandSnapshotIsStale(null, new JObject()),
                "первый legacy-снимок должен приниматься");
            Check(!RoaGlobalMap.WastelandSnapshotIsStale(new JObject(), new JObject()),
                "legacy-снимки без отметки времени должны оставаться совместимыми");

            JObject previous = Snapshot(1000d, 6000d);
            Check(RoaGlobalMap.WastelandSnapshotIsStale(previous, new JObject()),
                "снимок без sampledAt не должен заменять версионированный снимок");
            Check(RoaGlobalMap.WastelandSnapshotIsStale(previous, Snapshot(900d, 7000d)),
                "более старый sampledAt должен отклоняться");
            Check(!RoaGlobalMap.WastelandSnapshotIsStale(previous, Snapshot(1100d, 5000d)),
                "более новый sampledAt должен приниматься");
            Check(RoaGlobalMap.WastelandSnapshotIsStale(previous, Snapshot(1000d, 5000d)),
                "старый serverNow одного и того же снимка должен отклоняться");
            Check(!RoaGlobalMap.WastelandSnapshotIsStale(previous, Snapshot(1000d, 6000d)),
                "равный serverNow одного и того же снимка должен приниматься");
            Check(!RoaGlobalMap.WastelandSnapshotIsStale(previous, Snapshot(1000d, 7000d)),
                "новый serverNow одного и того же снимка должен приниматься");
        }

        private static void VerifyPartyModelMappings()
        {
            CheckModel("caravan", null, null, null, "friendlyBrahmin");
            CheckModel("patrol", null, null, null, "klimPatrolGuard");
            CheckModel("raider", null, null, null, "enemyRaider");
            CheckModel("squad", "raiders", null, null, "enemyRaider");
            CheckModel("mutant", null, null, null, "enemySuperMutant");
            CheckModel("squad", "mutants", null, null, "enemySuperMutant");
            CheckModel("monster", "wild", null, "radscorpion", "enemyRadscorpion");
            CheckModel("monster", "wild", null, "mutant-ant", "enemyMutantAnt");
            CheckModel("monster", "wild", null, "fire-gecko", "enemyFireGecko");
            CheckModel("monster", "wild", null, "gecko", "enemyGecko");
            CheckModel("herd", "neutral", "brahmin", null, "friendlyBrahmin");
            CheckModel("monster", "wild", null, "ghoul", "enemyGhoul");
            CheckModel("monster", "wild", null, "ash-wolf", "enemyAshWolf");
            CheckModel("unknown", "neutral", "unknown", "unknown", "wastelandSettler");
        }

        private static void VerifyOverlayLabelScaling()
        {
            bool[][] variants =
            {
                new[] { false, false, false },
                new[] { false, false, true },
                new[] { false, true, false },
                new[] { true, true, true }
            };
            Vector2[] expectedCanvasSizes =
            {
                new Vector2(168f, 30f),
                new Vector2(188f, 32f),
                new Vector2(220f, 44f),
                new Vector2(132f, 26f)
            };
            float[] scales = { 1f, 1.42f, 2f };

            for (int variantIndex = 0; variantIndex < variants.Length; variantIndex++)
            {
                bool cluster = variants[variantIndex][0];
                bool activity = variants[variantIndex][1];
                bool selected = variants[variantIndex][2];
                Vector2 canvasSize = RoaGlobalMapCanvas.OverlayLabelCanvasSize(
                    cluster, activity, selected);
                CheckVector(canvasSize, expectedCanvasSizes[variantIndex],
                    "базовый размер метки " + variantIndex);

                foreach (float scale in scales)
                {
                    Vector2 screenSize = RoaGlobalMapCanvas.OverlayLabelScreenSize(
                        cluster, activity, selected, scale);
                    CheckVector(screenSize, canvasSize * scale,
                        "экранный размер метки при scale=" + scale);

                    Vector2 roundTrip = RoaGlobalMapCanvas.CanvasSizeForScreenRect(
                        new Rect(17f, 23f, screenSize.x, screenSize.y), scale);
                    CheckVector(roundTrip, canvasSize,
                        "обратное преобразование метки при scale=" + scale);
                }
            }
        }

        private static void VerifyStrategicProfilesAndLod()
        {
            CheckProfile("player", 2.15f, 0.50f, 0f,
                RoaStrategicActorFitMode.Height);
            CheckProfile("wastelandSettler", 1.68f, 0.37f, 0f,
                RoaStrategicActorFitMode.Height);
            CheckProfile("enemySuperMutant", 1.95f, 0.37f, 180f,
                RoaStrategicActorFitMode.Height);
            CheckProfile("enemyGhoul", 1.68f, 0.37f, 180f,
                RoaStrategicActorFitMode.Height);
            CheckProfile("friendlyBrahmin", 1.95f, 0.37f, 180f,
                RoaStrategicActorFitMode.Footprint);
            CheckProfile("enemyAshWolf", 1.72f, 0.37f, 180f,
                RoaStrategicActorFitMode.Footprint);
            CheckProfile("enemyGecko", 1.75f, 0.37f, 180f,
                RoaStrategicActorFitMode.Footprint);
            CheckProfile("enemyFireGecko", 1.75f, 0.37f, 180f,
                RoaStrategicActorFitMode.Footprint);
            CheckProfile("enemyRadscorpion", 1.82f, 0.37f, 0f,
                RoaStrategicActorFitMode.Footprint);
            CheckProfile("enemyMutantAnt", 1.68f, 0.37f, 0f,
                RoaStrategicActorFitMode.Footprint);

            Vector3 observer = Vector3.zero;
            Vector3 near = new Vector3(4f, 0f, 3f);
            Vector3 far = new Vector3(40f, 0f, 0f);
            Check(RoaGlobalMap.StrategicActorPresentationTier(
                    RoaGlobalMap.MapDetailTier.Near, false, true, near, observer,
                    false, RoaActorPresentationTier.Near)
                  == RoaActorPresentationTier.Hidden,
                "hidden map marker kept its actor presentation");
            Check(RoaGlobalMap.StrategicActorPresentationTier(
                    RoaGlobalMap.MapDetailTier.Medium, true, true, near, observer,
                    false, RoaActorPresentationTier.Near)
                  == RoaActorPresentationTier.Far,
                "medium semantic zoom kept the expensive near presentation");
            Check(RoaGlobalMap.StrategicActorPresentationTier(
                    RoaGlobalMap.MapDetailTier.Near, true, true, far, observer,
                    false, RoaActorPresentationTier.Far)
                  == RoaActorPresentationTier.Near,
                "selected near-tier party did not retain full presentation");
            Check(RoaGlobalMap.StrategicActorPresentationTier(
                    RoaGlobalMap.MapDetailTier.Near, true, false, near, observer,
                    false, RoaActorPresentationTier.Far)
                  == RoaActorPresentationTier.Near,
                "nearby party did not enter full presentation");
            Check(RoaGlobalMap.StrategicActorPresentationTier(
                    RoaGlobalMap.MapDetailTier.Near, true, false, far, observer,
                    false, RoaActorPresentationTier.Near)
                  == RoaActorPresentationTier.Far,
                "distant party did not leave full presentation");
            Check(RoaGlobalMap.StrategicActorPresentationTier(
                    RoaGlobalMap.MapDetailTier.Near, true, false,
                    new Vector3(11f, 0f, 0f), observer, true,
                    RoaActorPresentationTier.Far)
                  == RoaActorPresentationTier.Far,
                "mobile landscape did not apply its tighter animation budget");
        }

        private static void CheckProfile(string modelKey, float target, float groundDrop,
                                         float yaw, RoaStrategicActorFitMode fitMode)
        {
            RoaStrategicActorProfile profile = RoaGlobalMapActorView.ProfileFor(modelKey);
            Check(Mathf.Abs(profile.TargetWorldSpan - target) <= Epsilon
                  && Mathf.Abs(profile.GroundDropWorld - groundDrop) <= Epsilon
                  && Mathf.Abs(profile.YawOffset - yaw) <= Epsilon
                  && profile.FitMode == fitMode
                  && profile.HasAnimatedBounds,
                "wrong strategic profile for " + modelKey);
        }

        private static JObject MovingParty()
        {
            return new JObject
            {
                ["x"] = 100f,
                ["y"] = 100f,
                ["state"] = "moving",
                ["speedKmh"] = 1f,
                ["movementRoutePoints"] = new JArray(
                    new JObject { ["x"] = 100f, ["y"] = 100f },
                    new JObject { ["x"] = 106f, ["y"] = 100f },
                    new JObject { ["x"] = 106f, ["y"] = 110f })
            };
        }

        private static GlobalMapPoint DisplayPoint(JObject party, float sampleAgeSeconds)
        {
            return RoaGlobalMap.WorldPartyDisplayPoint(party, sampleAgeSeconds,
                30f, 10f, 60000f);
        }

        private static JObject Snapshot(double sampledAt, double serverNow)
        {
            return new JObject
            {
                ["sampledAt"] = sampledAt,
                ["serverNow"] = serverNow
            };
        }

        private static void CheckModel(string kind, string faction, string species,
                                       string visual, string expected)
        {
            string actual = RoaGlobalMapActorView.ResolvePartyModelKey(
                kind, faction, species, visual);
            Check(actual == expected,
                "модель отряда ожидалась " + expected + ", получена " + actual);
        }

        private static void CheckPoint(GlobalMapPoint actual, float expectedX,
                                       float expectedY, string context)
        {
            Check(actual != null
                  && Mathf.Abs(actual.X - expectedX) <= Epsilon
                  && Mathf.Abs(actual.Y - expectedY) <= Epsilon,
                context + ": ожидалось (" + expectedX + ", " + expectedY + "), получено ("
                + (actual != null ? actual.X.ToString() : "null") + ", "
                + (actual != null ? actual.Y.ToString() : "null") + ")");
        }

        private static void CheckVector(Vector2 actual, Vector2 expected, string context)
        {
            Check(Mathf.Abs(actual.x - expected.x) <= Epsilon
                  && Mathf.Abs(actual.y - expected.y) <= Epsilon,
                context + ": ожидалось " + expected + ", получено " + actual);
        }

        private static void Check(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(
                "[GLOBAL MAP LIVE ACTORS] " + message);
        }
    }
}
#endif
