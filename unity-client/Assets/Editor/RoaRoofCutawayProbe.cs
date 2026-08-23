#if UNITY_EDITOR
using System;
using System.Collections;
using System.IO;
using System.Reflection;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaRoofCutawayProbe
    {
        private const string MenuPath = "Realm of Ashes/Проверить прозрачность крыш";

        [MenuItem(MenuPath)]
        private static void Run()
        {
            try
            {
                var roof = new Bounds(new Vector3(0f, 3f, 0f), new Vector3(8f, 0.5f, 6f));
                Vector3 camera = new Vector3(10f, 12f, -10f);
                Vector3 player = new Vector3(0f, 1.12f, 0f);

                Require(RoaRoofCutaway.OccludesPlayer(roof, player, camera),
                        "camera-to-player ray did not cross the roof");
                Require(!RoaRoofCutaway.OccludesPlayer(roof, new Vector3(20f, 1.12f, 20f), camera),
                        "roof faded even though it did not cover the player");

                Require(RoaRoofCutaway.AnyFootprintSampleVisible(roof,
                            point => Mathf.Abs(point.x) < 0.01f && Mathf.Abs(point.z) < 0.01f),
                        "visible floor cell did not open the roof");
                Require(!RoaRoofCutaway.AnyFootprintSampleVisible(roof, point => false),
                        "invisible floor opened the roof");

                var projectionRoof = new Bounds(new Vector3(0f, 5f, 0f), new Vector3(4f, 0.4f, 4f));
                Vector3 projectionCamera = new Vector3(0f, 10f, -10f);
                Require(RoaRoofCutaway.ProjectionCoversVisibleGround(
                            projectionRoof, projectionCamera, point => point.z > 8f),
                        "screen projection did not reveal visible ground behind the roof");

                Require(RoaRoofCutaway.ShouldCutaway(roof, player, camera, point => false),
                        "occluding roof did not enter cutaway state");
                Require(!RoaRoofCutaway.ShouldCutaway(roof, new Vector3(20f, 1.12f, 20f), camera,
                                                       point => false),
                        "unrelated roof entered cutaway state");

                string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                                                            "../../data/locations/settlement.json"));
                LocationDefinition settlement = JsonConvert.DeserializeObject<LocationDefinition>(
                    File.ReadAllText(path));
                int authoredCutawayRoofs = 0;
                for (int i = 0; i < settlement.Objects.Count; i++)
                {
                    LocationObject entry = settlement.Objects[i];
                    if (entry != null && entry.HasTag("trader-cutaway")) authoredCutawayRoofs++;
                }
                Require(authoredCutawayRoofs == 1,
                        "settlement must contain exactly one authored trader-cutaway roof");

                VerifyMaterialTransition();

                Debug.Log("[КРЫШИ] готово: authored=" + authoredCutawayRoofs
                    + ", alpha=" + RoaRoofCutaway.CutawayOpacity.ToString("0.00")
                    + ", release=" + RoaRoofCutaway.ReleaseDelay.ToString("0.00")
                    + "s, material=transparent→restored");
            }
            catch (Exception error)
            {
                Debug.LogError("[КРЫШИ] ошибка: " + error.Message);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void VerifyMaterialTransition()
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            Require(shader != null, "no lit shader is available for the roof material probe");
            var material = new Material(shader) { name = "Roof cutaway probe" };
            try
            {
                Color original = new Color(0.62f, 0.51f, 0.39f, 0.91f);
                if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", original);
                if (material.HasProperty("_Color")) material.SetColor("_Color", original);
                int originalQueue = material.renderQueue;
                float originalSurface = material.HasProperty("_Surface") ? material.GetFloat("_Surface") : 0f;
                float originalZWrite = material.HasProperty("_ZWrite") ? material.GetFloat("_ZWrite") : 1f;

                Type component = typeof(RoaRoofCutaway);
                Type roofType = component.GetNestedType("Roof", BindingFlags.NonPublic);
                Require(roofType != null, "roof runtime state type is missing");
                object roof = Activator.CreateInstance(roofType, true);
                MethodInfo capture = component.GetMethod("Capture", BindingFlags.NonPublic | BindingFlags.Static);
                MethodInfo apply = component.GetMethod("ApplyOpacity", BindingFlags.NonPublic | BindingFlags.Static);
                FieldInfo materialsField = roofType.GetField("Materials", BindingFlags.Public | BindingFlags.Instance);
                Require(capture != null && apply != null && materialsField != null,
                        "roof material transition methods are missing");
                var materials = materialsField.GetValue(roof) as IList;
                Require(materials != null, "roof material state list is missing");
                materials.Add(capture.Invoke(null, new object[] { material }));

                apply.Invoke(null, new[] { roof, (object)RoaRoofCutaway.CutawayOpacity });
                Color faded = material.HasProperty("_BaseColor")
                    ? material.GetColor("_BaseColor") : material.GetColor("_Color");
                Require(faded.a <= RoaRoofCutaway.CutawayOpacity + 0.001f,
                        "cutaway material did not receive the expected alpha");
                Require(material.renderQueue == (int)UnityEngine.Rendering.RenderQueue.Transparent,
                        "cutaway material did not enter the transparent render queue");
                Require(material.IsKeywordEnabled("_SURFACE_TYPE_TRANSPARENT"),
                        "cutaway material did not enable the URP transparent keyword");
                if (material.HasProperty("_Surface"))
                    Require(Mathf.Approximately(material.GetFloat("_Surface"), 1f),
                            "cutaway material surface is not transparent");
                if (material.HasProperty("_ZWrite"))
                    Require(Mathf.Approximately(material.GetFloat("_ZWrite"), 0f),
                            "cutaway material still writes depth");

                apply.Invoke(null, new[] { roof, (object)1f });
                Color restored = material.HasProperty("_BaseColor")
                    ? material.GetColor("_BaseColor") : material.GetColor("_Color");
                Require(Mathf.Abs(restored.a - original.a) < 0.001f,
                        "roof material alpha was not restored");
                Require(material.renderQueue == originalQueue,
                        "roof material render queue was not restored");
                if (material.HasProperty("_Surface"))
                    Require(Mathf.Approximately(material.GetFloat("_Surface"), originalSurface),
                            "roof material surface was not restored");
                if (material.HasProperty("_ZWrite"))
                    Require(Mathf.Approximately(material.GetFloat("_ZWrite"), originalZWrite),
                            "roof material depth write was not restored");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(material);
            }
        }
    }
}
#endif
