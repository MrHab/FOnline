#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    /// <summary>Renders repeatable visual-review frames from the editable Kromka scenes.</summary>
    public static class KromkaSceneCapture
    {
        private const string GlobalScene = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string LocationRoot = "Assets/Scenes/Kromka/Locations/";

        private static readonly string[] ReviewLocations =
        {
            "tutorialCaravanYard",
            "settlement",
            "sluiceCity",
            "scrapTown",
            "relayStation",
            "secondHaven",
            "personalBase",
            "clanFilterT6",
            "mutantCrater",
            "vectorLab"
        };

        [MenuItem("Кромка/Проверки/Снимки ключевых сцен")]
        public static void CaptureReviewSet()
        {
            RefuseDirtyOpenScenes();
            Scene original = SceneManager.GetActiveScene();
            string originalPath = original.IsValid() ? original.path : string.Empty;
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);

            try
            {
                Scene global = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
                Capture(global, Path.Combine(output, "00-global-map.png"), 42f, 52f);
                for (int i = 0; i < ReviewLocations.Length; i++)
                {
                    string id = ReviewLocations[i];
                    Scene location = EditorSceneManager.OpenScene(LocationRoot + id + ".unity",
                        OpenSceneMode.Single);
                    Capture(location, Path.Combine(output,
                        (i + 1).ToString("00") + "-" + id + ".png"), 38f, 50f);
                }
            }
            finally
            {
                if (!string.IsNullOrWhiteSpace(originalPath)
                    && AssetDatabase.LoadAssetAtPath<SceneAsset>(originalPath) != null)
                    EditorSceneManager.OpenScene(originalPath, OpenSceneMode.Single);
            }

            Debug.Log("[KROMKA CAPTURE] PASS: " + (ReviewLocations.Length + 1)
                + " снимков сохранены в " + output);
        }

        [MenuItem("Кромка/Проверки/Снимок глобальной карты")]
        public static void CaptureGlobalMapOnly()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            Capture(global, Path.Combine(output, "00-global-map.png"), 0f, 50f);
            Debug.Log("[KROMKA CAPTURE] PASS: глобальная карта сохранена в " + output);
        }

        [MenuItem("Кромка/Авторинг/Пересобрать и снять глобальную карту")]
        public static void RebuildAndCaptureGlobalMap()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            CaptureGlobalMapOnly();
        }

        [MenuItem("Kromka/Checks/Capture relief iteration 20")]
        public static void CaptureReliefIteration20()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            Renderer[] renderers = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Renderer>(true)).ToArray();
            bool[] enabled = renderers.Select(renderer => renderer != null && renderer.enabled).ToArray();
            Light[] lights = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Light>(true)).ToArray();
            bool[] lightEnabled = lights.Select(light => light != null && light.enabled).ToArray();
            float[] lightIntensity = lights.Select(light => light != null ? light.intensity : 0f).ToArray();
            Quaternion[] lightRotation = lights.Select(light => light != null
                ? light.transform.rotation : Quaternion.identity).ToArray();
            float ambientIntensity = RenderSettings.ambientIntensity;
            bool fog = RenderSettings.fog;
            Renderer reliefRenderer = renderers.FirstOrDefault(renderer => renderer != null
                && renderer.gameObject.name == "KromkaLandmass_Relief_100pct");
            Material reliefMaterial = reliefRenderer != null ? reliefRenderer.sharedMaterial : null;
            bool hasBaseColor = reliefMaterial != null && reliefMaterial.HasProperty("_BaseColor");
            bool hasSmoothness = reliefMaterial != null && reliefMaterial.HasProperty("_Smoothness");
            Color baseColor = hasBaseColor ? reliefMaterial.GetColor("_BaseColor") : Color.white;
            float smoothness = hasSmoothness ? reliefMaterial.GetFloat("_Smoothness") : 0f;
            try
            {
                for (int i = 0; i < renderers.Length; i++)
                {
                    Renderer renderer = renderers[i];
                    if (renderer == null) continue;
                    renderer.enabled = renderer.gameObject.name == "KromkaLandmass_Relief_100pct";
                }
                for (int i = 0; i < lights.Length; i++)
                {
                    Light light = lights[i];
                    if (light == null) continue;
                    light.enabled = light.type == LightType.Directional;
                    if (light.type != LightType.Directional) continue;
                    light.intensity = 1.48f;
                    light.transform.rotation = Quaternion.Euler(29f, -58f, 0f);
                }
                if (hasBaseColor)
                    reliefMaterial.SetColor("_BaseColor", new Color(0.48f, 0.45f, 0.39f, 1f));
                if (hasSmoothness) reliefMaterial.SetFloat("_Smoothness", 0.05f);
                RenderSettings.ambientIntensity = 0.58f;
                RenderSettings.fog = false;
                Capture(global, Path.Combine(output, "relief-100pct.png"), 8f, 32f, 0.76f);
            }
            finally
            {
                for (int i = 0; i < renderers.Length; i++)
                    if (renderers[i] != null) renderers[i].enabled = enabled[i];
                for (int i = 0; i < lights.Length; i++)
                {
                    if (lights[i] == null) continue;
                    lights[i].enabled = lightEnabled[i];
                    lights[i].intensity = lightIntensity[i];
                    lights[i].transform.rotation = lightRotation[i];
                }
                RenderSettings.ambientIntensity = ambientIntensity;
                RenderSettings.fog = fog;
                if (hasBaseColor) reliefMaterial.SetColor("_BaseColor", baseColor);
                if (hasSmoothness) reliefMaterial.SetFloat("_Smoothness", smoothness);
            }
            Debug.Log("[KROMKA RELIEF 100%] Review capture saved to " + output);
        }

        public static void ValidateAndCaptureReliefIteration20()
        {
            KromkaGlobalMapReliefAuthoring.ValidateIteration20();
            CaptureReliefIteration20();
        }

        public static void RebuildValidateAndCaptureReliefIteration20()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            KromkaGlobalMapReliefAuthoring.ValidateIteration20();
            CaptureGlobalMapOnly();
            CaptureReliefIteration20();
        }

        [MenuItem("Kromka/Checks/Capture texture iteration 20")]
        public static void CaptureTextureIteration20()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            GameObject waterRootObject = GameObject.Find("WaterSurfaces_TexturePass_EDITABLE");
            Transform waterRoot = waterRootObject != null ? waterRootObject.transform : null;
            GameObject routeRootObject = GameObject.Find("RouteSurfaces_TexturePass_EDITABLE");
            Transform routeRoot = routeRootObject != null ? routeRootObject.transform : null;
            GameObject shorelineRootObject = GameObject.Find(
                "ShorelineSurfaces_TexturePass_EDITABLE");
            Transform shorelineRoot = shorelineRootObject != null
                ? shorelineRootObject.transform : null;
            GameObject oreStrataRootObject = GameObject.Find(
                "OreStrataSurfaces_TexturePass_EDITABLE");
            Transform oreStrataRoot = oreStrataRootObject != null
                ? oreStrataRootObject.transform : null;
            GameObject fusedGlassRootObject = GameObject.Find(
                "FusedGlassSurfaces_TexturePass_EDITABLE");
            Transform fusedGlassRoot = fusedGlassRootObject != null
                ? fusedGlassRootObject.transform : null;
            GameObject chalkKarstRootObject = GameObject.Find(
                "ChalkKarstSurfaces_TexturePass_EDITABLE");
            Transform chalkKarstRoot = chalkKarstRootObject != null
                ? chalkKarstRootObject.transform : null;
            GameObject zeroDepositRootObject = GameObject.Find(
                "ZeroDepositSurfaces_TexturePass_EDITABLE");
            Transform zeroDepositRoot = zeroDepositRootObject != null
                ? zeroDepositRootObject.transform : null;
            GameObject sluiceWeatheringRootObject = GameObject.Find(
                "SluiceWeatheringSurfaces_TexturePass_EDITABLE");
            Transform sluiceWeatheringRoot = sluiceWeatheringRootObject != null
                ? sluiceWeatheringRootObject.transform : null;
            GameObject floodplainRootObject = GameObject.Find(
                "FloodplainSurfaces_TexturePass_EDITABLE");
            Transform floodplainRoot = floodplainRootObject != null
                ? floodplainRootObject.transform : null;
            GameObject tractWearRootObject = GameObject.Find(
                "TractWearSurfaces_TexturePass_EDITABLE");
            Transform tractWearRoot = tractWearRootObject != null
                ? tractWearRootObject.transform : null;
            GameObject silentRingRootObject = GameObject.Find(
                "SilentRingSurfaces_TexturePass_EDITABLE");
            Transform silentRingRoot = silentRingRootObject != null
                ? silentRingRootObject.transform : null;
            GameObject transitionRootObject = GameObject.Find(
                "TransitionDeposits_TexturePass_EDITABLE");
            Transform transitionRoot = transitionRootObject != null
                ? transitionRootObject.transform : null;
            Renderer[] renderers = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Renderer>(true)).ToArray();
            bool[] enabled = renderers.Select(renderer => renderer != null && renderer.enabled).ToArray();
            Light[] lights = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Light>(true)).ToArray();
            bool[] lightEnabled = lights.Select(light => light != null && light.enabled).ToArray();
            float[] lightIntensity = lights.Select(light => light != null ? light.intensity : 0f).ToArray();
            Quaternion[] lightRotation = lights.Select(light => light != null
                ? light.transform.rotation : Quaternion.identity).ToArray();
            float ambientIntensity = RenderSettings.ambientIntensity;
            bool fog = RenderSettings.fog;
            try
            {
                for (int i = 0; i < renderers.Length; i++)
                {
                    Renderer renderer = renderers[i];
                    if (renderer == null) continue;
                    renderer.enabled = renderer.gameObject.name == "KromkaLandmass_Relief_100pct"
                        || (waterRoot != null && renderer.transform.IsChildOf(waterRoot))
                        || (shorelineRoot != null && renderer.transform.IsChildOf(shorelineRoot))
                        || (oreStrataRoot != null && renderer.transform.IsChildOf(oreStrataRoot))
                        || (fusedGlassRoot != null && renderer.transform.IsChildOf(fusedGlassRoot))
                        || (chalkKarstRoot != null && renderer.transform.IsChildOf(chalkKarstRoot))
                        || (zeroDepositRoot != null && renderer.transform.IsChildOf(zeroDepositRoot))
                        || (sluiceWeatheringRoot != null && renderer.transform.IsChildOf(sluiceWeatheringRoot))
                        || (floodplainRoot != null && renderer.transform.IsChildOf(floodplainRoot))
                        || (tractWearRoot != null && renderer.transform.IsChildOf(tractWearRoot))
                        || (silentRingRoot != null && renderer.transform.IsChildOf(silentRingRoot))
                        || (transitionRoot != null && renderer.transform.IsChildOf(transitionRoot))
                        || (routeRoot != null && renderer.transform.IsChildOf(routeRoot));
                }
                for (int i = 0; i < lights.Length; i++)
                {
                    Light light = lights[i];
                    if (light == null) continue;
                    light.enabled = light.type == LightType.Directional;
                    if (light.type != LightType.Directional) continue;
                    light.intensity = 1.30f;
                    light.transform.rotation = Quaternion.Euler(31f, -52f, 0f);
                }
                RenderSettings.ambientIntensity = 0.62f;
                RenderSettings.fog = false;
                Capture(global, Path.Combine(output, "textures-100pct.png"),
                    8f, 32f, 0.76f);
            }
            finally
            {
                for (int i = 0; i < renderers.Length; i++)
                    if (renderers[i] != null) renderers[i].enabled = enabled[i];
                for (int i = 0; i < lights.Length; i++)
                {
                    if (lights[i] == null) continue;
                    lights[i].enabled = lightEnabled[i];
                    lights[i].intensity = lightIntensity[i];
                    lights[i].transform.rotation = lightRotation[i];
                }
                RenderSettings.ambientIntensity = ambientIntensity;
                RenderSettings.fog = fog;
            }
            Debug.Log("[KROMKA TEXTURES 100%] Review capture saved to " + output);
        }

        public static void ValidateAndCaptureTextureIteration20()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            KromkaGlobalMapTextureAuthoring.ValidateIteration06();
            KromkaGlobalMapWaterAuthoring.ValidateIteration07();
            KromkaGlobalMapRouteSurfaceAuthoring.ValidateIteration09();
            KromkaGlobalMapShorelineAuthoring.ValidateIteration10();
            KromkaGlobalMapOreStrataAuthoring.ValidateIteration11();
            KromkaGlobalMapFusedGlassAuthoring.ValidateIteration12();
            KromkaGlobalMapChalkKarstAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroDepositsAuthoring.ValidateIteration14();
            KromkaGlobalMapSluiceWeatheringAuthoring.ValidateIteration15();
            KromkaGlobalMapFloodplainAuthoring.ValidateIteration16();
            KromkaGlobalMapTractWearAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingAuthoring.ValidateIteration18();
            KromkaGlobalMapTransitionDepositsAuthoring.ValidateIteration19();
            KromkaGlobalMapFinalTextureAuthoring.ValidateIteration20();
            CaptureTextureIteration20();
        }

        public static void RebuildValidateAndCaptureTextureIteration20()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            KromkaGlobalMapReliefAuthoring.ValidateIteration20();
            KromkaGlobalMapTextureAuthoring.ValidateIteration06();
            KromkaGlobalMapWaterAuthoring.ValidateIteration07();
            KromkaGlobalMapRouteSurfaceAuthoring.ValidateIteration09();
            KromkaGlobalMapShorelineAuthoring.ValidateIteration10();
            KromkaGlobalMapOreStrataAuthoring.ValidateIteration11();
            KromkaGlobalMapFusedGlassAuthoring.ValidateIteration12();
            KromkaGlobalMapChalkKarstAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroDepositsAuthoring.ValidateIteration14();
            KromkaGlobalMapSluiceWeatheringAuthoring.ValidateIteration15();
            KromkaGlobalMapFloodplainAuthoring.ValidateIteration16();
            KromkaGlobalMapTractWearAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingAuthoring.ValidateIteration18();
            KromkaGlobalMapTransitionDepositsAuthoring.ValidateIteration19();
            KromkaGlobalMapFinalTextureAuthoring.ValidateIteration20();
            CaptureGlobalMapOnly();
            CaptureTextureIteration20();
        }

        [MenuItem("Kromka/Checks/Capture model iteration 01")]
        public static void CaptureModelIteration01()
        {
            CaptureModelStage("models-05pct.png", "[KROMKA MODELS 5%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 02")]
        public static void CaptureModelIteration02()
        {
            CaptureModelStage("models-10pct.png", "[KROMKA MODELS 10%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 03")]
        public static void CaptureModelIteration03()
        {
            CaptureModelStage("models-15pct.png", "[KROMKA MODELS 15%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 04")]
        public static void CaptureModelIteration04()
        {
            CaptureModelStage("models-20pct.png", "[KROMKA MODELS 20%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 05")]
        public static void CaptureModelIteration05()
        {
            CaptureModelStage("models-25pct.png", "[KROMKA MODELS 25%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 06")]
        public static void CaptureModelIteration06()
        {
            CaptureModelStage("models-30pct.png", "[KROMKA MODELS 30%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 07")]
        public static void CaptureModelIteration07()
        {
            CaptureModelStage("models-35pct.png", "[KROMKA MODELS 35%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 08")]
        public static void CaptureModelIteration08()
        {
            CaptureModelStage("models-40pct.png", "[KROMKA MODELS 40%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 09")]
        public static void CaptureModelIteration09()
        {
            CaptureModelStage("models-45pct.png", "[KROMKA MODELS 45%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 10")]
        public static void CaptureModelIteration10()
        {
            CaptureModelStage("models-50pct.png", "[KROMKA MODELS 50%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 11")]
        public static void CaptureModelIteration11()
        {
            CaptureModelStage("models-55pct.png", "[KROMKA MODELS 55%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 12")]
        public static void CaptureModelIteration12()
        {
            CaptureModelStage("models-60pct.png", "[KROMKA MODELS 60%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 13")]
        public static void CaptureModelIteration13()
        {
            CaptureModelStage("models-65pct.png", "[KROMKA MODELS 65%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 14")]
        public static void CaptureModelIteration14()
        {
            CaptureModelStage("models-70pct.png", "[KROMKA MODELS 70%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 15")]
        public static void CaptureModelIteration15()
        {
            CaptureModelStage("models-75pct.png", "[KROMKA MODELS 75%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 16")]
        public static void CaptureModelIteration16()
        {
            CaptureModelStage("models-80pct.png", "[KROMKA MODELS 80%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 17")]
        public static void CaptureModelIteration17()
        {
            CaptureModelStage("models-85pct.png", "[KROMKA MODELS 85%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 18")]
        public static void CaptureModelIteration18()
        {
            CaptureModelStage("models-90pct.png", "[KROMKA MODELS 90%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 19")]
        public static void CaptureModelIteration19()
        {
            CaptureModelStage("models-95pct.png", "[KROMKA MODELS 95%]");
        }

        [MenuItem("Kromka/Checks/Capture model iteration 20")]
        public static void CaptureModelIteration20()
        {
            CaptureModelStage("models-100pct.png", "[KROMKA MODELS 100%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 01")]
        public static void CaptureEffectIteration01()
        {
            CaptureEffectStage("effects-05pct.png", "[KROMKA EFFECTS 5%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 02")]
        public static void CaptureEffectIteration02()
        {
            CaptureEffectStage("effects-10pct.png", "[KROMKA EFFECTS 10%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 03")]
        public static void CaptureEffectIteration03()
        {
            CaptureEffectStage("effects-15pct.png", "[KROMKA EFFECTS 15%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 04")]
        public static void CaptureEffectIteration04()
        {
            CaptureEffectStage("effects-20pct.png", "[KROMKA EFFECTS 20%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 05")]
        public static void CaptureEffectIteration05()
        {
            CaptureEffectStage("effects-25pct.png", "[KROMKA EFFECTS 25%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 06")]
        public static void CaptureEffectIteration06()
        {
            CaptureEffectStage("effects-30pct.png", "[KROMKA EFFECTS 30%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 07")]
        public static void CaptureEffectIteration07()
        {
            CaptureEffectStage("effects-35pct.png", "[KROMKA EFFECTS 35%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 08")]
        public static void CaptureEffectIteration08()
        {
            CaptureEffectStage("effects-40pct.png", "[KROMKA EFFECTS 40%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 09")]
        public static void CaptureEffectIteration09()
        {
            CaptureEffectStage("effects-45pct.png", "[KROMKA EFFECTS 45%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 10")]
        public static void CaptureEffectIteration10()
        {
            CaptureEffectStage("effects-50pct.png", "[KROMKA EFFECTS 50%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 11")]
        public static void CaptureEffectIteration11()
        {
            CaptureEffectStage("effects-55pct.png", "[KROMKA EFFECTS 55%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 12")]
        public static void CaptureEffectIteration12()
        {
            CaptureEffectStage("effects-60pct.png", "[KROMKA EFFECTS 60%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 13")]
        public static void CaptureEffectIteration13()
        {
            CaptureEffectStage("effects-65pct.png", "[KROMKA EFFECTS 65%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 14")]
        public static void CaptureEffectIteration14()
        {
            CaptureEffectStage("effects-70pct.png", "[KROMKA EFFECTS 70%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 15")]
        public static void CaptureEffectIteration15()
        {
            CaptureEffectStage("effects-75pct.png", "[KROMKA EFFECTS 75%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 16")]
        public static void CaptureEffectIteration16()
        {
            CaptureEffectStage("effects-80pct.png", "[KROMKA EFFECTS 80%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 17")]
        public static void CaptureEffectIteration17()
        {
            CaptureEffectStage("effects-85pct.png", "[KROMKA EFFECTS 85%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 18")]
        public static void CaptureEffectIteration18()
        {
            CaptureEffectStage("effects-90pct.png", "[KROMKA EFFECTS 90%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 19")]
        public static void CaptureEffectIteration19()
        {
            CaptureEffectStage("effects-95pct.png", "[KROMKA EFFECTS 95%]");
        }

        [MenuItem("Kromka/Checks/Capture effect iteration 20")]
        public static void CaptureEffectIteration20()
        {
            CaptureEffectStage("effects-100pct.png", "[KROMKA EFFECTS 100%]");
        }

        [MenuItem("Kromka/Checks/Capture global-map visual audit views")]
        public static void CaptureGlobalMapVisualAuditViews()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene,
                OpenSceneMode.Single);
            Transform effectsRoot = GameObject.Find("Effects_EffectPass_EDITABLE")
                ?.transform;

            Capture(global, Path.Combine(output, "visual-audit-west.png"),
                -90f, 6f, 0.78f, effectsRoot);
            Capture(global, Path.Combine(output, "visual-audit-north.png"),
                0f, 6f, 0.78f, effectsRoot);
            Capture(global, Path.Combine(output, "visual-audit-east.png"),
                90f, 6f, 0.78f, effectsRoot);
            Capture(global, Path.Combine(output, "visual-audit-south.png"),
                180f, 6f, 0.78f, effectsRoot);
            Debug.Log("[KROMKA VISUAL AUDIT] Four low-angle review captures "
                + "saved to " + output);
        }

        public static void RebuildAndCaptureGlobalMapVisualAuditViews()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            CaptureGlobalMapVisualAuditViews();
            CaptureGlobalMapVisualDetailViews();
            KromkaGlobalMapVisualDefectAudit.WriteReport();
        }

        [MenuItem("Kromka/Checks/Capture lore boundary review set")]
        public static void CaptureLoreBoundaryReviewSet()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene,
                OpenSceneMode.Single);
            KromkaGlobalMapBoundaryAuthoring.Validate();
            Capture(global, Path.Combine(output, "boundary-overview.png"),
                8f, 35f, 0.73f);
            CaptureSector(global, Path.Combine(output, "boundary-west.png"),
                16f, 150f, -86f, 16f, 6.8f);
            CaptureSector(global, Path.Combine(output, "boundary-north-headwaters.png"),
                183f, 286f, 2f, 16f, 6.8f);
            CaptureSector(global, Path.Combine(output, "boundary-east.png"),
                364f, 150f, 86f, 16f, 6.8f);
            CaptureSector(global, Path.Combine(output, "boundary-south-dry-basin-rim.png"),
                190f, 17f, 178f, 16f, 6.8f);
            Debug.Log("[KROMKA BOUNDARY CAPTURE] Five boundary review images saved to "
                + output);
        }

        public static void RebuildAndCaptureLoreBoundaryReviewSet()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            CaptureLoreBoundaryReviewSet();
        }

        [MenuItem("Kromka/Checks/Capture outer wasteland iteration 01")]
        public static void CaptureOuterWastelandIteration01()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene,
                OpenSceneMode.Single);
            KromkaGlobalMapOuterWastelandAuthoring.ValidateIteration01();
            Capture(global, Path.Combine(output,
                "outer-wasteland-05pct-overview.png"), 4f, 42f, 0.88f);
            CaptureSector(global, Path.Combine(output,
                    "outer-wasteland-05pct-northwest.png"),
                -3f, 5f, 42f, 48f, 9.5f);
            CaptureSector(global, Path.Combine(output,
                    "outer-wasteland-05pct-craters.png"),
                -12f, 7f, 28f, 56f, 5.2f);
            Debug.Log("[KROMKA OUTER WASTELAND CAPTURE 5%] overview, "
                + "north-west exterior and crater review saved to " + output);
        }

        public static void RebuildValidateAndCaptureOuterWastelandIteration01()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            CaptureOuterWastelandIteration01();
            KromkaGlobalMapVisualDefectAudit.WriteReport();
        }

        [MenuItem("Kromka/Checks/Capture outer wasteland iteration 02")]
        public static void CaptureOuterWastelandIteration02()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene,
                OpenSceneMode.Single);
            KromkaGlobalMapOuterWastelandAuthoring.ValidateIteration01();
            KromkaGlobalMapOuterWastelandIteration02Authoring
                .ValidateIteration02();
            Capture(global, Path.Combine(output,
                "outer-wasteland-10pct-overview.png"), 4f, 42f, 0.88f);
            CaptureSector(global, Path.Combine(output,
                    "outer-wasteland-10pct-western-sector.png"),
                -45f, 58f, 52f, 50f, 11.0f);
            CaptureSector(global, Path.Combine(output,
                    "outer-wasteland-10pct-convoy.png"),
                -43f, 58f, 72f, 55f, 6.7f);
            Debug.Log("[KROMKA OUTER WASTELAND CAPTURE 10%] overview, western "
                + "evacuation graveyard and destroyed-convoy review saved to "
                + output);
        }

        public static void RebuildValidateAndCaptureOuterWastelandIteration02()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            CaptureOuterWastelandIteration02();
            KromkaGlobalMapVisualDefectAudit.WriteReport();
        }

        [MenuItem("Kromka/Checks/Capture outer wasteland iteration 03")]
        public static void CaptureOuterWastelandIteration03()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene,
                OpenSceneMode.Single);
            KromkaGlobalMapOuterWastelandAuthoring.ValidateIteration01();
            KromkaGlobalMapOuterWastelandIteration02Authoring
                .ValidateIteration02();
            KromkaGlobalMapOuterWastelandIteration03Authoring
                .ValidateIteration03();
            Capture(global, Path.Combine(output,
                "outer-wasteland-15pct-overview.png"), 4f, 42f, 0.88f);
            CaptureSector(global, Path.Combine(output,
                    "outer-wasteland-15pct-collapsed-city.png"),
                -52f, 121f, 63f, 51f, 10.5f);
            CaptureSector(global, Path.Combine(output,
                    "outer-wasteland-15pct-ground-zero.png"),
                -48f, 126f, 76f, 57f, 6.2f);
            Debug.Log("[KROMKA OUTER WASTELAND CAPTURE 15%] overview, western "
                + "collapsed city and ground-zero review saved to " + output);
        }

        [MenuItem("Realm of Ashes/Checks/Capture outer wasteland 15pct")]
        public static void CaptureOuterWastelandIteration03FromAgentGate()
        {
            CaptureOuterWastelandIteration03();
        }

        [MenuItem("Realm of Ashes/Checks/Rebuild validate capture outer wasteland 15pct")]
        public static void RebuildValidateAndCaptureOuterWastelandIteration03()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            CaptureOuterWastelandIteration03();
            KromkaGlobalMapVisualDefectAudit.WriteReport();
        }

        [MenuItem("Kromka/Checks/Capture river and road-bridge review set")]
        public static void CaptureRiverAndRoadBridgeReviewSet()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene,
                OpenSceneMode.Single);
            KromkaGlobalMapRoadBridgeAuthoring.Validate();
            KromkaGlobalMapRiverClearanceAudit.WriteReport();

            GameObject effectsRoot = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsRoot != null) effectsRoot.SetActive(false);
            try
            {
                CaptureSector(global, Path.Combine(output,
                        "river-bridge-main-tract.png"),
                    206.1f, 196.1f, 52f, 48f, 3.8f);
                CaptureSector(global, Path.Combine(output,
                        "river-bridge-r12-service.png"),
                    205.8f, 69.7f, 76f, 48f, 3.5f);
                CaptureSector(global, Path.Combine(output,
                        "river-clearance-south-sluice.png"),
                    195f, 248f, 12f, 58f, 4.2f);
            }
            finally
            {
                if (effectsRoot != null) effectsRoot.SetActive(true);
            }
            Debug.Log("[KROMKA RIVER/BRIDGE CAPTURE] Two road bridges and the "
                + "corrected South Sluice banks saved to " + output);
        }

        public static void RebuildValidateAndCaptureRiverAndRoadBridgeReviewSet()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            CaptureRiverAndRoadBridgeReviewSet();
            KromkaGlobalMapVisualDefectAudit.WriteReport();
        }

        [MenuItem("Кромка/Авторинг/Обновить единое русло Тесьмы")]
        public static void RebuildSingleTesmaChannel()
        {
            Scene scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || scene.path != GlobalScene)
                throw new InvalidOperationException("Откройте глобальную карту Кромки.");
            string[] layerNames =
            {
                "WaterSurfaces_TexturePass_EDITABLE",
                "ShorelineSurfaces_TexturePass_EDITABLE",
                "RouteSurfaces_TexturePass_EDITABLE",
                "ChalkKarstSurfaces_TexturePass_EDITABLE"
            };
            Transform[] layers = layerNames.Select(name => scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Transform>(true))
                .Single(node => node.name == name)).ToArray();
            KromkaGlobalMapReliefAuthoring.RefreshTerrainMeshAndField();
            // Update only generated water/bank/route layers, preserving all
            // terrain objects, locations and manually positioned model objects.
            foreach (Transform layer in layers)
                while (layer.childCount > 0)
                    UnityEngine.Object.DestroyImmediate(layer.GetChild(0).gameObject);
            KromkaGlobalMapWaterAuthoring.Compose(layers[0]);
            KromkaGlobalMapShorelineAuthoring.Compose(layers[1]);
            KromkaGlobalMapRouteSurfaceAuthoring.Compose(layers[2]);
            KromkaGlobalMapChalkKarstAuthoring.Compose(layers[3]);
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.RefreshRailBridgePlacement(
                GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform);
            KromkaGlobalMapSovietReplacementAuthoring.RefreshCrossingClearance(
                GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform);
            KromkaGlobalMapRouteCrossingAuthoring.Compose(
                GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform);
            KromkaGlobalMapRoadBridgeAuthoring.Compose(
                GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform);
            KromkaGlobalMapRoadsideFinalAuthoring.RefreshMarkerContact();
            KromkaGlobalMapNorthernSluicesAuthoring.RefreshCurrent(
                GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform);
            SeatTesmaSinkObjects();
            KromkaGlobalMapAssemblySupportAuthoring.Apply(
                GameObject.Find("EnvironmentModels_ModelPass_EDITABLE").transform);
            KromkaGlobalMapMeshGroundingPass.ApplyReviewedContacts();
            AssetDatabase.SaveAssets();
            SaveOpenGeneratedGlobalMap();
            ValidateAndCaptureTesmaHydrology();
            SaveOpenGeneratedGlobalMap();
        }

        [MenuItem("Realm of Ashes/Authoring/Visual review/Seat river mouth objects")]
        public static void SeatTesmaSinkObjects()
        {
            if (SceneManager.GetActiveScene().path != GlobalScene
                || EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Open the authored global map outside Play Mode.");
            // An incremental basin rebuild changes the ground below these four
            // already-instantiated props. Preserve XZ, source, scale and rotation;
            // use the same foundation embed as their normal source generators.
            foreach (var item in new[] {
                (Name: "Balance_DataCoolantEast", Embed: .026f),
                (Name: "NorthernSluice_EasternDiversion_MepBreach_01", Embed: .024f),
                (Name: "NorthernSluice_EasternDiversion_MepBreach_02", Embed: .018f),
                (Name: "SilentRing_CliffPiece_05_00", Embed: .035f),
                (Name: "SilentWindfall_15", Embed: .040f) })
            {
                GameObject instance = GameObject.Find(item.Name);
                if (instance == null) throw new InvalidOperationException(item.Name + " is missing.");
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>().Where(r => r.enabled).ToArray();
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
                float ground = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    190f + bounds.center.x * 10f, 150f - bounds.center.z * 10f);
                instance.transform.position += Vector3.up * (ground - item.Embed - bounds.min.y);
            }
            SaveOpenGeneratedGlobalMap();
        }

        [MenuItem("Кромка/Проверки/Проверить физику реки Тесьма")]
        public static void ValidateAndCaptureTesmaHydrology()
        {
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = SceneManager.GetActiveScene();
            if (!global.IsValid() || global.path != GlobalScene)
            {
                RefuseDirtyOpenScenes();
                global = EditorSceneManager.OpenScene(GlobalScene,
                    OpenSceneMode.Single);
            }
            KromkaGlobalMapWaterAuthoring.ValidateIteration07();
            KromkaGlobalMapShorelineAuthoring.ValidateIteration10();
            KromkaGlobalMapRouteSurfaceAuthoring.ValidateIteration09();
            KromkaGlobalMapBoundaryAuthoring.Validate();
            KromkaGlobalMapRoadBridgeAuthoring.Validate();
            KromkaGlobalMapRiverClearanceAudit.WriteReport();

            GameObject effectsRoot = GameObject.Find("Effects_EffectPass_EDITABLE");
            if (effectsRoot != null) effectsRoot.SetActive(false);
            try
            {
                CaptureSector(global, Path.Combine(output,
                        "tesma-headwaters-desktop.png"),
                    187f, 282f, 4f, 18f, 8.4f);
                CaptureSector(global, Path.Combine(output,
                        "tesma-full-grade-desktop.png"),
                    202f, 164f, 0f, 22f, 23f);
                CaptureSector(global, Path.Combine(output,
                        "tesma-full-grade-mobile-landscape.png"),
                    202f, 164f, 0f, 22f, 23f, 932, 430);
                CaptureSector(global, Path.Combine(output,
                        "tesma-single-channel-desktop.png"),
                    204f, 222f, 180f, 40f, 14f);
                CaptureSector(global, Path.Combine(output,
                        "tesma-single-channel-mobile-landscape.png"),
                    204f, 222f, 180f, 40f, 14f, 932, 430);
            }
            finally
            {
                if (effectsRoot != null) effectsRoot.SetActive(true);
            }
            Debug.Log("[KROMKA TESMA HYDROLOGY] PASS: grounded northern mountain "
                + "headwaters, continuously descending river surface and dry boundary apron. "
                + "Desktop and mobile-landscape captures saved to " + output);
        }

        [MenuItem("Кромка/Авторинг/Сохранить открытую глобальную карту")]
        public static void SaveOpenGeneratedGlobalMap()
        {
            Scene scene = SceneManager.GetActiveScene();
            if (!scene.IsValid() || scene.path != GlobalScene)
                throw new InvalidOperationException("Открыта не глобальная карта Кромки.");
            if (!scene.GetRootGameObjects().Any(root =>
                    root.name == "KromkaGlobalMap_kromka-1"))
                throw new InvalidOperationException(
                    "В открытой сцене нет корня сгенерированной карты Кромки.");
            if (!EditorSceneManager.SaveScene(scene))
                throw new InvalidOperationException(
                    "Unity не смог сохранить открытую глобальную карту.");
            Debug.Log("[KROMKA] PASS: открытая сгенерированная глобальная карта сохранена.");
        }

        [MenuItem("Kromka/Checks/Capture global-map visual detail views")]
        public static void CaptureGlobalMapVisualDetailViews()
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene,
                OpenSceneMode.Single);
            CaptureSector(global, Path.Combine(output, "visual-detail-sluices.png"),
                200f, 55f, 18f, 18f, 7.5f);
            CaptureSector(global, Path.Combine(output, "visual-detail-ore-arc.png"),
                98f, 225f, 28f, 18f, 9f);
            CaptureSector(global, Path.Combine(output, "visual-detail-middle-vein.png"),
                193f, 204f, -18f, 18f, 8f);
            CaptureSector(global, Path.Combine(output, "visual-detail-tract.png"),
                140f, 153f, 24f, 18f, 7.5f);
            CaptureSector(global, Path.Combine(output, "visual-detail-glasslands.png"),
                287f, 187f, -28f, 18f, 8f);
            CaptureSector(global, Path.Combine(output, "visual-detail-chalk.png"),
                292f, 109f, 18f, 18f, 7.5f);
            CaptureSector(global, Path.Combine(output, "visual-detail-ravine.png"),
                302f, 88f, -22f, 18f, 7f);
            CaptureSector(global, Path.Combine(output, "visual-detail-zero.png"),
                220f, 65f, 26f, 18f, 7.5f);
            CaptureSector(global, Path.Combine(output, "visual-detail-silent-ring.png"),
                88f, 80f, -24f, 18f, 7.5f);
            CaptureSector(global, Path.Combine(output,
                    "visual-models-soviet-housing.png"),
                198f, 205f, -22f, 15f, 4f);
            CaptureSector(global, Path.Combine(output,
                    "visual-models-soviet-substation.png"),
                165f, 160f, 32f, 15f, 3.2f);
            CaptureSector(global, Path.Combine(output,
                    "visual-models-soviet-garage.png"),
                216f, 211f, -24f, 14f, 1.65f);
            CaptureSector(global, Path.Combine(output,
                    "visual-models-glasslands-utility.png"),
                289f, 188f, -28f, 15f, 4f);
            CaptureSector(global, Path.Combine(output,
                    "visual-models-silent-ring-utility.png"),
                88f, 85f, 28f, 15f, 3.5f);
            CaptureSector(global, Path.Combine(output,
                    "visual-models-ore-industrial-warehouse.png"),
                83f, 204f, 20f, 15f, 3.4f);
            GameObject effectsRoot = GameObject.Find(
                "Effects_EffectPass_EDITABLE");
            if (effectsRoot == null)
                throw new InvalidOperationException(
                    "Visual comparison cannot find the global effect root.");
            effectsRoot.SetActive(false);
            try
            {
                CaptureSector(global, Path.Combine(output,
                        "visual-debug-ravine-no-effects.png"),
                    302f, 88f, -22f, 18f, 7f);
                CaptureSector(global, Path.Combine(output,
                        "visual-debug-chalk-no-effects.png"),
                    292f, 109f, 18f, 18f, 7.5f);
                CaptureSector(global, Path.Combine(output,
                        "visual-debug-glasslands-no-effects.png"),
                    287f, 187f, -28f, 18f, 8f);
            }
            finally
            {
                effectsRoot.SetActive(true);
            }
            Debug.Log("[KROMKA VISUAL DETAIL AUDIT] Eighteen close regional "
                + "and replacement-model captures saved to " + output);
        }

        private static void CaptureModelStage(string fileName, string logMarker)
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);

            string[] visibleRootNames =
            {
                "TransitionDeposits_TexturePass_EDITABLE",
                "WaterSurfaces_TexturePass_EDITABLE",
                "ShorelineSurfaces_TexturePass_EDITABLE",
                "OreStrataSurfaces_TexturePass_EDITABLE",
                "FusedGlassSurfaces_TexturePass_EDITABLE",
                "ChalkKarstSurfaces_TexturePass_EDITABLE",
                "ZeroDepositSurfaces_TexturePass_EDITABLE",
                "SluiceWeatheringSurfaces_TexturePass_EDITABLE",
                "FloodplainSurfaces_TexturePass_EDITABLE",
                "RouteSurfaces_TexturePass_EDITABLE",
                "TractWearSurfaces_TexturePass_EDITABLE",
                "SilentRingSurfaces_TexturePass_EDITABLE",
                "EnvironmentModels_ModelPass_EDITABLE"
            };
            Transform[] visibleRoots = visibleRootNames
                .Select(name => GameObject.Find(name))
                .Select(gameObject => gameObject != null ? gameObject.transform : null)
                .ToArray();
            if (visibleRoots.Any(root => root == null))
                throw new InvalidOperationException(
                    "Model review cannot find every texture/model authoring root.");

            Renderer[] renderers = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Renderer>(true)).ToArray();
            bool[] enabled = renderers.Select(renderer => renderer != null && renderer.enabled).ToArray();
            Light[] lights = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Light>(true)).ToArray();
            bool[] lightEnabled = lights.Select(light => light != null && light.enabled).ToArray();
            float[] lightIntensity = lights.Select(light => light != null ? light.intensity : 0f).ToArray();
            Quaternion[] lightRotation = lights.Select(light => light != null
                ? light.transform.rotation : Quaternion.identity).ToArray();
            float ambientIntensity = RenderSettings.ambientIntensity;
            bool fog = RenderSettings.fog;
            try
            {
                for (int i = 0; i < renderers.Length; i++)
                {
                    Renderer renderer = renderers[i];
                    if (renderer == null) continue;
                    renderer.enabled = renderer.gameObject.name == "KromkaLandmass_Relief_100pct"
                        || visibleRoots.Any(root => renderer.transform.IsChildOf(root));
                }
                for (int i = 0; i < lights.Length; i++)
                {
                    Light light = lights[i];
                    if (light == null) continue;
                    light.enabled = light.type == LightType.Directional;
                    if (light.type != LightType.Directional) continue;
                    light.intensity = 1.30f;
                    light.transform.rotation = Quaternion.Euler(31f, -52f, 0f);
                }
                RenderSettings.ambientIntensity = 0.62f;
                RenderSettings.fog = false;
                Capture(global, Path.Combine(output, fileName),
                    8f, 32f, 0.80f);
            }
            finally
            {
                for (int i = 0; i < renderers.Length; i++)
                    if (renderers[i] != null) renderers[i].enabled = enabled[i];
                for (int i = 0; i < lights.Length; i++)
                {
                    if (lights[i] == null) continue;
                    lights[i].enabled = lightEnabled[i];
                    lights[i].intensity = lightIntensity[i];
                    lights[i].transform.rotation = lightRotation[i];
                }
                RenderSettings.ambientIntensity = ambientIntensity;
                RenderSettings.fog = fog;
            }
            Debug.Log(logMarker + " Review capture saved to " + output);
        }

        private static void CaptureEffectStage(string fileName, string logMarker)
        {
            RefuseDirtyOpenScenes();
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures"));
            Directory.CreateDirectory(output);
            Scene global = EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);

            string[] visibleRootNames =
            {
                "TransitionDeposits_TexturePass_EDITABLE",
                "WaterSurfaces_TexturePass_EDITABLE",
                "ShorelineSurfaces_TexturePass_EDITABLE",
                "OreStrataSurfaces_TexturePass_EDITABLE",
                "FusedGlassSurfaces_TexturePass_EDITABLE",
                "ChalkKarstSurfaces_TexturePass_EDITABLE",
                "ZeroDepositSurfaces_TexturePass_EDITABLE",
                "SluiceWeatheringSurfaces_TexturePass_EDITABLE",
                "FloodplainSurfaces_TexturePass_EDITABLE",
                "RouteSurfaces_TexturePass_EDITABLE",
                "TractWearSurfaces_TexturePass_EDITABLE",
                "SilentRingSurfaces_TexturePass_EDITABLE",
                "EnvironmentModels_ModelPass_EDITABLE",
                "Effects_EffectPass_EDITABLE"
            };
            Transform[] visibleRoots = visibleRootNames
                .Select(name => GameObject.Find(name))
                .Select(gameObject => gameObject != null ? gameObject.transform : null)
                .ToArray();
            if (visibleRoots.Any(root => root == null))
                throw new InvalidOperationException(
                    "Effect review cannot find every terrain, model and effect root.");

            Renderer[] renderers = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Renderer>(true)).ToArray();
            bool[] enabled = renderers
                .Select(renderer => renderer != null && renderer.enabled).ToArray();
            Light[] lights = global.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Light>(true)).ToArray();
            bool[] lightEnabled = lights
                .Select(light => light != null && light.enabled).ToArray();
            float[] lightIntensity = lights
                .Select(light => light != null ? light.intensity : 0f).ToArray();
            Quaternion[] lightRotation = lights.Select(light => light != null
                ? light.transform.rotation : Quaternion.identity).ToArray();
            float ambientIntensity = RenderSettings.ambientIntensity;
            bool fog = RenderSettings.fog;
            try
            {
                for (int i = 0; i < renderers.Length; i++)
                {
                    Renderer renderer = renderers[i];
                    if (renderer == null) continue;
                    renderer.enabled = renderer.gameObject.name
                            == "KromkaLandmass_Relief_100pct"
                        || visibleRoots.Any(root => renderer.transform.IsChildOf(root));
                }
                for (int i = 0; i < lights.Length; i++)
                {
                    Light light = lights[i];
                    if (light == null) continue;
                    light.enabled = light.type == LightType.Directional;
                    if (light.type != LightType.Directional) continue;
                    light.intensity = 1.30f;
                    light.transform.rotation = Quaternion.Euler(31f, -52f, 0f);
                }
                RenderSettings.ambientIntensity = 0.62f;
                RenderSettings.fog = false;
                Capture(global, Path.Combine(output, fileName),
                    8f, 32f, 0.80f, visibleRoots[visibleRoots.Length - 1]);
            }
            finally
            {
                for (int i = 0; i < renderers.Length; i++)
                    if (renderers[i] != null) renderers[i].enabled = enabled[i];
                for (int i = 0; i < lights.Length; i++)
                {
                    if (lights[i] == null) continue;
                    lights[i].enabled = lightEnabled[i];
                    lights[i].intensity = lightIntensity[i];
                    lights[i].transform.rotation = lightRotation[i];
                }
                RenderSettings.ambientIntensity = ambientIntensity;
                RenderSettings.fog = fog;
            }
            Debug.Log(logMarker + " Review capture saved to " + output);
        }

        public static void ValidateAndCaptureModelIteration01()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            CaptureModelIteration01();
        }

        public static void RebuildValidateAndCaptureModelIteration01()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            CaptureGlobalMapOnly();
            CaptureModelIteration01();
        }

        public static void ValidateAndCaptureModelIteration02()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            CaptureModelIteration02();
        }

        public static void RebuildValidateAndCaptureModelIteration02()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            CaptureGlobalMapOnly();
            CaptureModelIteration02();
        }

        public static void ValidateAndCaptureModelIteration03()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            CaptureModelIteration03();
        }

        public static void RebuildValidateAndCaptureModelIteration03()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            CaptureGlobalMapOnly();
            CaptureModelIteration03();
        }

        public static void ValidateAndCaptureModelIteration04()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            CaptureModelIteration04();
        }

        public static void RebuildValidateAndCaptureModelIteration04()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            CaptureGlobalMapOnly();
            CaptureModelIteration04();
        }

        public static void ValidateAndCaptureModelIteration05()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            CaptureModelIteration05();
        }

        public static void RebuildValidateAndCaptureModelIteration05()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            CaptureGlobalMapOnly();
            CaptureModelIteration05();
        }

        public static void ValidateAndCaptureModelIteration06()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            CaptureModelIteration06();
        }

        public static void RebuildValidateAndCaptureModelIteration06()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            CaptureGlobalMapOnly();
            CaptureModelIteration06();
        }

        public static void ValidateAndCaptureModelIteration07()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            CaptureModelIteration07();
        }

        public static void RebuildValidateAndCaptureModelIteration07()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            CaptureGlobalMapOnly();
            CaptureModelIteration07();
        }

        public static void ValidateAndCaptureModelIteration08()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            CaptureModelIteration08();
        }

        public static void RebuildValidateAndCaptureModelIteration08()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            CaptureGlobalMapOnly();
            CaptureModelIteration08();
        }

        public static void ValidateAndCaptureModelIteration09()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            CaptureModelIteration09();
        }

        public static void RebuildValidateAndCaptureModelIteration09()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            CaptureGlobalMapOnly();
            CaptureModelIteration09();
        }

        public static void ValidateAndCaptureModelIteration10()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            CaptureModelIteration10();
        }

        public static void RebuildValidateAndCaptureModelIteration10()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            CaptureGlobalMapOnly();
            CaptureModelIteration10();
        }

        public static void ValidateAndCaptureModelIteration11()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            CaptureModelIteration11();
        }

        public static void RebuildValidateAndCaptureModelIteration11()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            CaptureGlobalMapOnly();
            CaptureModelIteration11();
        }

        public static void ValidateAndCaptureModelIteration12()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            CaptureModelIteration12();
        }

        public static void RebuildValidateAndCaptureModelIteration12()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            CaptureGlobalMapOnly();
            CaptureModelIteration12();
        }

        public static void ValidateAndCaptureModelIteration13()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            CaptureModelIteration13();
        }

        public static void RebuildValidateAndCaptureModelIteration13()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            CaptureGlobalMapOnly();
            CaptureModelIteration13();
        }

        public static void ValidateAndCaptureModelIteration14()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            CaptureModelIteration14();
        }

        public static void RebuildValidateAndCaptureModelIteration14()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            CaptureGlobalMapOnly();
            CaptureModelIteration14();
        }

        public static void ValidateAndCaptureModelIteration15()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            CaptureModelIteration15();
        }

        public static void RebuildValidateAndCaptureModelIteration15()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            CaptureGlobalMapOnly();
            CaptureModelIteration15();
        }

        public static void ValidateAndCaptureModelIteration16()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            CaptureModelIteration16();
        }

        public static void RebuildValidateAndCaptureModelIteration16()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            CaptureGlobalMapOnly();
            CaptureModelIteration16();
        }

        public static void ValidateAndCaptureModelIteration17()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            CaptureModelIteration17();
        }

        public static void RebuildValidateAndCaptureModelIteration17()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            CaptureGlobalMapOnly();
            CaptureModelIteration17();
        }

        public static void ValidateAndCaptureModelIteration18()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingDeadwoodAuthoring.ValidateIteration18();
            CaptureModelIteration18();
        }

        public static void RebuildValidateAndCaptureModelIteration18()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingDeadwoodAuthoring.ValidateIteration18();
            CaptureGlobalMapOnly();
            CaptureModelIteration18();
        }

        public static void ValidateAndCaptureModelIteration19()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingDeadwoodAuthoring.ValidateIteration18();
            KromkaGlobalMapPowerCorridorAuthoring.ValidateIteration19();
            CaptureModelIteration19();
        }

        public static void RebuildValidateAndCaptureModelIteration19()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingDeadwoodAuthoring.ValidateIteration18();
            KromkaGlobalMapPowerCorridorAuthoring.ValidateIteration19();
            CaptureGlobalMapOnly();
            CaptureModelIteration19();
        }

        public static void ValidateAndCaptureModelIteration20()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingDeadwoodAuthoring.ValidateIteration18();
            KromkaGlobalMapPowerCorridorAuthoring.ValidateIteration19();
            KromkaGlobalMapRoadsideFinalAuthoring.ValidateIteration20();
            KromkaGlobalMapRoadBridgeAuthoring.Validate();
            KromkaGlobalMapRiverClearanceAudit.WriteReport();
            KromkaGlobalMapOuterWastelandAuthoring.ValidateIteration01();
            CaptureModelIteration20();
        }

        public static void RebuildValidateAndCaptureModelIteration20()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingDeadwoodAuthoring.ValidateIteration18();
            KromkaGlobalMapPowerCorridorAuthoring.ValidateIteration19();
            KromkaGlobalMapRoadsideFinalAuthoring.ValidateIteration20();
            KromkaGlobalMapRoadBridgeAuthoring.Validate();
            KromkaGlobalMapRiverClearanceAudit.WriteReport();
            KromkaGlobalMapOuterWastelandAuthoring.ValidateIteration01();
            CaptureGlobalMapOnly();
            CaptureModelIteration20();
        }

        public static void ValidateAndCaptureEffectIteration01()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            CaptureEffectIteration01();
        }

        public static void RebuildValidateAndCaptureEffectIteration01()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            CaptureEffectIteration01();
        }

        public static void ValidateAndCaptureEffectIteration02()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            CaptureEffectIteration02();
        }

        public static void RebuildValidateAndCaptureEffectIteration02()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            CaptureEffectIteration02();
        }

        public static void ValidateAndCaptureEffectIteration03()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            CaptureEffectIteration03();
        }

        public static void RebuildValidateAndCaptureEffectIteration03()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            CaptureEffectIteration03();
        }

        public static void ValidateAndCaptureEffectIteration04()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            CaptureEffectIteration04();
        }

        public static void RebuildValidateAndCaptureEffectIteration04()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            CaptureEffectIteration04();
        }

        public static void ValidateAndCaptureEffectIteration05()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            CaptureEffectIteration05();
        }

        public static void RebuildValidateAndCaptureEffectIteration05()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            CaptureEffectIteration05();
        }

        public static void ValidateAndCaptureEffectIteration06()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            CaptureEffectIteration06();
        }

        public static void RebuildValidateAndCaptureEffectIteration06()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            CaptureEffectIteration06();
        }

        public static void ValidateAndCaptureEffectIteration07()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            CaptureEffectIteration07();
        }

        public static void RebuildValidateAndCaptureEffectIteration07()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            CaptureEffectIteration07();
        }

        public static void ValidateAndCaptureEffectIteration08()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration08();
            CaptureEffectIteration08();
        }

        public static void RebuildValidateAndCaptureEffectIteration08()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration08();
            CaptureEffectIteration08();
        }

        public static void ValidateAndCaptureEffectIteration09()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration08();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration09();
            CaptureEffectIteration09();
        }

        public static void RebuildValidateAndCaptureEffectIteration09()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration08();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration09();
            CaptureEffectIteration09();
        }

        public static void ValidateAndCaptureEffectIteration10()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration08();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration09();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration10();
            CaptureEffectIteration10();
        }

        public static void RebuildValidateAndCaptureEffectIteration10()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration08();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration09();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration10();
            CaptureEffectIteration10();
        }

        public static void ValidateAndCaptureEffectIteration11()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            CaptureEffectIteration11();
        }

        public static void RebuildValidateAndCaptureEffectIteration11()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            CaptureEffectIteration11();
        }

        public static void ValidateAndCaptureEffectIteration12()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            CaptureEffectIteration12();
        }

        public static void RebuildValidateAndCaptureEffectIteration12()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            CaptureEffectIteration12();
        }

        public static void ValidateAndCaptureEffectIteration13()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration13();
            CaptureEffectIteration13();
        }

        public static void RebuildValidateAndCaptureEffectIteration13()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration13();
            CaptureEffectIteration13();
        }

        public static void ValidateAndCaptureEffectIteration14()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration13();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration14();
            CaptureEffectIteration14();
        }

        public static void RebuildValidateAndCaptureEffectIteration14()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration13();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration14();
            CaptureEffectIteration14();
        }

        public static void ValidateAndCaptureEffectIteration15()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration13();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration14();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration15();
            CaptureEffectIteration15();
        }

        public static void RebuildValidateAndCaptureEffectIteration15()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration13();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration14();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration15();
            CaptureEffectIteration15();
        }

        public static void ValidateAndCaptureEffectIteration16()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            CaptureEffectIteration16();
        }

        public static void RebuildValidateAndCaptureEffectIteration16()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            CaptureEffectIteration16();
        }

        public static void ValidateAndCaptureEffectIteration17()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            CaptureEffectIteration17();
        }

        public static void RebuildValidateAndCaptureEffectIteration17()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            CaptureEffectIteration17();
        }

        public static void ValidateAndCaptureEffectIteration18()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration18();
            CaptureEffectIteration18();
        }

        public static void RebuildValidateAndCaptureEffectIteration18()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration18();
            CaptureEffectIteration18();
        }

        public static void ValidateAndCaptureEffectIteration19()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration18();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration19();
            CaptureEffectIteration19();
        }

        public static void RebuildValidateAndCaptureEffectIteration19()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration18();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration19();
            CaptureEffectIteration19();
        }

        public static void ValidateAndCaptureEffectIteration20()
        {
            RefuseDirtyOpenScenes();
            EditorSceneManager.OpenScene(GlobalScene, OpenSceneMode.Single);
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration18();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration19();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration20();
            CaptureEffectIteration20();
        }

        public static void RebuildValidateAndCaptureEffectIteration20()
        {
            KromkaWorldSceneBuilder.RebuildGlobalMapFromSeed();
            ValidateCompletedTerrainAndTextureStages();
            ValidateCompletedModelStages();
            ValidateCompletedEffectStagesThrough15();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration16();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration17();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration18();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration19();
            KromkaGlobalMapToxicFogEffectAuthoring.ValidateIteration20();
            CaptureEffectIteration20();
        }

        private static void ValidateCompletedEffectStagesThrough15()
        {
            ValidateCompletedEffectStagesThrough10();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration11();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration12();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration13();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration14();
            KromkaGlobalMapSmokeEffectAuthoring.ValidateIteration15();
        }

        private static void ValidateCompletedEffectStagesThrough10()
        {
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration01();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration02();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration03();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration04();
            KromkaGlobalMapDustEffectAuthoring.ValidateIteration05();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration06();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration07();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration08();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration09();
            KromkaGlobalMapFogEffectAuthoring.ValidateIteration10();
        }

        private static void ValidateCompletedModelStages()
        {
            KromkaGlobalMapRockLandmarkAuthoring.ValidateIteration01();
            KromkaGlobalMapTalusAuthoring.ValidateIteration02();
            KromkaGlobalMapQuarryBenchAuthoring.ValidateIteration03();
            KromkaGlobalMapSilentRingCliffAuthoring.ValidateIteration04();
            KromkaGlobalMapNorthernSluicesAuthoring.ValidateIteration05();
            KromkaGlobalMapOreIndustryAuthoring.ValidateIteration06();
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.ValidateIteration07();
            KromkaGlobalMapTractInfrastructureAuthoring.ValidateIteration08();
            KromkaGlobalMapGlasslandsScienceAuthoring.ValidateIteration09();
            KromkaGlobalMapGlasslandsLandmarkAuthoring.ValidateIteration10();
            KromkaGlobalMapChalkLowlandSettlementAuthoring.ValidateIteration11();
            KromkaGlobalMapListenersRavineAuthoring.ValidateIteration12();
            KromkaGlobalMapZeroCoreAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroOuterAuthoring.ValidateIteration14();
            KromkaGlobalMapHostileLandmarkAuthoring.ValidateIteration15();
            KromkaGlobalMapSilentRingOutpostAuthoring.ValidateIteration16();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingDeadwoodAuthoring.ValidateIteration18();
            KromkaGlobalMapPowerCorridorAuthoring.ValidateIteration19();
            KromkaGlobalMapRoadsideFinalAuthoring.ValidateIteration20();
            KromkaGlobalMapRoadBridgeAuthoring.Validate();
            KromkaGlobalMapRiverClearanceAudit.WriteReport();
            KromkaGlobalMapOuterWastelandAuthoring.ValidateIteration01();
        }

        private static void ValidateCompletedTerrainAndTextureStages()
        {
            KromkaGlobalMapReliefAuthoring.ValidateIteration20();
            KromkaGlobalMapTextureAuthoring.ValidateIteration06();
            KromkaGlobalMapWaterAuthoring.ValidateIteration07();
            KromkaGlobalMapRouteSurfaceAuthoring.ValidateIteration09();
            KromkaGlobalMapShorelineAuthoring.ValidateIteration10();
            KromkaGlobalMapOreStrataAuthoring.ValidateIteration11();
            KromkaGlobalMapFusedGlassAuthoring.ValidateIteration12();
            KromkaGlobalMapChalkKarstAuthoring.ValidateIteration13();
            KromkaGlobalMapZeroDepositsAuthoring.ValidateIteration14();
            KromkaGlobalMapSluiceWeatheringAuthoring.ValidateIteration15();
            KromkaGlobalMapFloodplainAuthoring.ValidateIteration16();
            KromkaGlobalMapTractWearAuthoring.ValidateIteration17();
            KromkaGlobalMapSilentRingAuthoring.ValidateIteration18();
            KromkaGlobalMapTransitionDepositsAuthoring.ValidateIteration19();
            KromkaGlobalMapFinalTextureAuthoring.ValidateIteration20();
        }

        private static void Capture(Scene scene, string path, float yaw, float pitch,
                                    float framing = 1f,
                                    Transform framingExclusionRoot = null)
        {
            Renderer[] renderers = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<Renderer>(true))
                .Where(renderer => renderer != null && renderer.enabled
                    && renderer.gameObject.activeInHierarchy).ToArray();
            if (renderers.Length == 0)
                throw new InvalidOperationException("В сцене нет видимой геометрии: " + scene.path);

            Renderer[] framingRenderers = framingExclusionRoot != null
                ? renderers.Where(renderer =>
                    !renderer.transform.IsChildOf(framingExclusionRoot)).ToArray()
                : renderers;
            if (framingRenderers.Length == 0) framingRenderers = renderers;
            Bounds bounds = framingRenderers[0].bounds;
            for (int i = 1; i < framingRenderers.Length; i++)
                bounds.Encapsulate(framingRenderers[i].bounds);
            Vector3 target = bounds.center;
            target.y = Mathf.Clamp(target.y, 0f, 8f);
            float horizontalRadius = Mathf.Max(bounds.extents.x, bounds.extents.z);
            float distance = Mathf.Clamp(horizontalRadius * 2.15f + bounds.extents.y * 0.8f,
                48f, 120f) * Mathf.Clamp(framing, 0.60f, 1.30f);

            GameObject cameraObject = new GameObject("KromkaCaptureCamera")
            {
                hideFlags = HideFlags.HideAndDontSave
            };
            RenderTexture targetTexture = null;
            Texture2D readback = null;
            try
            {
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.Skybox;
                camera.fieldOfView = 46f;
                camera.nearClipPlane = 0.05f;
                camera.farClipPlane = 650f;
                camera.allowHDR = true;
                camera.allowMSAA = true;
                Quaternion orbit = Quaternion.Euler(pitch, yaw, 0f);
                camera.transform.position = target + orbit * (Vector3.back * distance);
                camera.transform.LookAt(target);

                targetTexture = new RenderTexture(1600, 900, 24, RenderTextureFormat.ARGB32)
                {
                    antiAliasing = 4,
                    name = "KromkaCaptureRT"
                };
                targetTexture.Create();
                camera.targetTexture = targetTexture;
                SimulateParticles(scene);
                // Unity 6 may compile/warm several imported MEP/URP variants on
                // the first off-screen frame. Never use that transient frame as
                // review evidence: render one warm-up frame, then the capture.
                camera.Render();
                camera.Render();

                RenderTexture previous = RenderTexture.active;
                RenderTexture.active = targetTexture;
                readback = new Texture2D(1600, 900, TextureFormat.RGB24, false);
                readback.ReadPixels(new Rect(0, 0, 1600, 900), 0, 0);
                readback.Apply(false, false);
                RenderTexture.active = previous;
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (targetTexture != null)
                {
                    Camera captureCamera = cameraObject != null
                        ? cameraObject.GetComponent<Camera>() : null;
                    if (captureCamera != null) captureCamera.targetTexture = null;
                    targetTexture.Release();
                    UnityEngine.Object.DestroyImmediate(targetTexture);
                }
                UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        internal static void CaptureSector(Scene scene, string path,
                                          float mapX, float mapY, float yaw,
                                          float pitch, float distance,
                                          int width = 1600, int height = 900)
        {
            Vector3 target = new Vector3((mapX - 190f) * 0.1f,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY) + 0.18f,
                (150f - mapY) * 0.1f);
            GameObject cameraObject = new GameObject("KromkaSectorCaptureCamera")
            {
                hideFlags = HideFlags.HideAndDontSave
            };
            RenderTexture targetTexture = null;
            Texture2D readback = null;
            try
            {
                Camera camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.Skybox;
                camera.fieldOfView = 43f;
                camera.nearClipPlane = 0.05f;
                camera.farClipPlane = 250f;
                camera.allowHDR = true;
                camera.allowMSAA = true;
                Quaternion orbit = Quaternion.Euler(pitch, yaw, 0f);
                camera.transform.position = target + orbit
                    * (Vector3.back * distance);
                camera.transform.LookAt(target);

                targetTexture = new RenderTexture(width, height, 24,
                    RenderTextureFormat.ARGB32)
                {
                    antiAliasing = 4,
                    name = "KromkaSectorCaptureRT"
                };
                targetTexture.Create();
                camera.targetTexture = targetTexture;
                SimulateParticles(scene);
                camera.Render();
                camera.Render();

                RenderTexture previous = RenderTexture.active;
                RenderTexture.active = targetTexture;
                readback = new Texture2D(width, height, TextureFormat.RGB24, false);
                readback.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                readback.Apply(false, false);
                RenderTexture.active = previous;
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
                if (targetTexture != null)
                {
                    Camera captureCamera = cameraObject != null
                        ? cameraObject.GetComponent<Camera>() : null;
                    if (captureCamera != null) captureCamera.targetTexture = null;
                    targetTexture.Release();
                    UnityEngine.Object.DestroyImmediate(targetTexture);
                }
                UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        private static void RefuseDirtyOpenScenes()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene scene = SceneManager.GetSceneAt(i);
                if (scene.IsValid() && scene.isDirty)
                    throw new InvalidOperationException("Сначала сохраните открытую сцену: " + scene.path);
            }
        }

        private static void SimulateParticles(Scene scene)
        {
            ParticleSystem[] systems = scene.GetRootGameObjects()
                .SelectMany(root => root.GetComponentsInChildren<ParticleSystem>(true))
                .Where(system => system != null && system.gameObject.activeInHierarchy)
                .ToArray();
            for (int i = 0; i < systems.Length; i++)
                systems[i].Simulate(7f, true, true, true);
        }

    }
}
#endif
