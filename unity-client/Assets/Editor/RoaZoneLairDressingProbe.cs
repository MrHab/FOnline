#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.EditorTools
{
    public static class RoaZoneLairDressingProbe
    {
        [MenuItem("Realm of Ashes/Проверить оформление логов")]
        public static void Run()
        {
            string repo = Environment.GetEnvironmentVariable("ROA_REPO") ??
                Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            var config = JObject.Parse(File.ReadAllText(Path.Combine(repo, "data/kromka/danger-ecology.json")));
            string output = Path.Combine(Application.dataPath, "../Library/LairProbe");
            Directory.CreateDirectory(output);
            var species = ((JArray)config["species"]).OfType<JObject>()
                .Where(row => row["kind"]?.ToString() != "traveller").ToArray();
            Require(species.Length == RoaZoneLairDressing.ThemeCount,
                "Each resident species needs a distinct lair theme");
            foreach (JObject row in species)
            {
                string id = row["id"].ToString();
                Require(RoaZoneLairDressing.HasTheme(id), "Missing lair theme: " + id);
                Capture(id, output);
            }
            Debug.Log("[ROA] Lair dressing passed: " + species.Length + " species; desktop and mobile captures: " + output);
        }

        private static void Capture(string speciesId, string output)
        {
            var root = new GameObject("LairProbe_" + speciesId);
            var cameraObject = new GameObject("LairProbeCamera");
            var lightObject = new GameObject("LairProbeLight");
            try
            {
                var definition = new LocationDefinition
                {
                    Map = new MapDefinition { Width = 100, Depth = 100 },
                    Grid = new GridDefinition { Step = 2f },
                    Zone = new JObject
                    {
                        ["lairs"] = new JArray(new JObject
                        {
                            ["id"] = "probe", ["tx"] = 24, ["tz"] = 24,
                            ["speciesId"] = speciesId
                        })
                    }
                };
                Require(RoaZoneLairDressing.Build(definition, root.transform) == 1,
                    "Lair was not placed: " + speciesId);
                Transform group = root.transform.GetChild(0).GetChild(0);
                Require(group.GetComponentsInChildren<Text>(true).Length == 1,
                    "Lair label missing: " + speciesId);
                Require(group.GetComponentsInChildren<Transform>(true).Count(t => t.name.StartsWith("Trace_")) == 3,
                    "Lair props missing: " + speciesId);
                Require(group.GetComponentsInChildren<Collider>(true).All(c => !c.enabled),
                    "Lair visual blocks gameplay: " + speciesId);

                GameObject floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
                floor.name = "ProbeGround";
                floor.transform.SetParent(root.transform, false);
                floor.transform.localScale = Vector3.one * 3f;
                floor.GetComponent<Renderer>().sharedMaterial = GroundMaterial();

                var camera = cameraObject.AddComponent<Camera>();
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.31f, 0.35f, 0.36f);
                camera.orthographic = true;
                camera.orthographicSize = 8f;
                camera.transform.position = new Vector3(0f, 9f, -16f);
                camera.transform.LookAt(new Vector3(0f, 1.3f, 0f));
                Transform face = group.Find("MarkerFace");
                face.rotation = Quaternion.LookRotation(face.position - camera.transform.position, Vector3.up);

                var light = lightObject.AddComponent<Light>();
                light.type = LightType.Directional;
                light.intensity = 1.4f;
                light.transform.rotation = Quaternion.Euler(48f, -35f, 0f);
                Canvas.ForceUpdateCanvases();
                Kromka.EditorTools.KromkaSceneShot.Capture(camera,
                    Path.Combine(output, speciesId + "-desktop.png"), 1440, 810);
                Kromka.EditorTools.KromkaSceneShot.Capture(camera,
                    Path.Combine(output, speciesId + "-mobile.png"), 844, 390);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(cameraObject);
                UnityEngine.Object.DestroyImmediate(lightObject);
            }
        }

        private static Material GroundMaterial()
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            return new Material(shader) { color = new Color(0.34f, 0.31f, 0.27f) };
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
