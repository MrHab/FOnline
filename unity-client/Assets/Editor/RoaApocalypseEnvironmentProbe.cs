#if UNITY_EDITOR
using System;
using System.IO;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    [InitializeOnLoad]
    public static class RoaApocalypseEnvironmentProbe
    {
        private static double _nextCheck;

        static RoaApocalypseEnvironmentProbe() => EditorApplication.update += Poll;

        private static void Poll()
        {
            if (EditorApplication.timeSinceStartup < _nextCheck) return;
            _nextCheck = EditorApplication.timeSinceStartup + 0.5d;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string path = Path.Combine(Application.dataPath,
                "../Library/roa-apocalypse-environment-probe.request");
            if (!File.Exists(path)) return;
            File.Delete(path);
            Run();
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Check fallback environment")]
        public static void Run()
        {
            string[] keys =
            {
                "armory_rack", "armoryRack", "road_tile", "roadTile", "wasteland_shack",
                "quarry_face", "rail_bridge", "filter_bank", "shelterbelt_tree", "checkpoint_gate"
            };
            foreach (string key in keys)
                if (RoaApocalypseModels.Environment(key) == null)
                    throw new InvalidOperationException("Missing fallback model for " + key);

            GameObject original = GameObject.CreatePrimitive(PrimitiveType.Cube);
            original.name = "FallbackEnvironmentProbe";
            original.transform.localScale = new Vector3(2f, 0.5f, 3f);
            try
            {
                MeshRenderer oldRenderer = original.GetComponent<MeshRenderer>();
                GameObject prefab = RoaApocalypseModels.Environment("road_tile");
                GameObject art = RoaApocalypseVisuals.AttachStatic(original.transform, prefab);
                if (art == null || oldRenderer.enabled
                    || art.GetComponentsInChildren<Renderer>(true).Length == 0
                    || original.GetComponent<Collider>() == null)
                    throw new InvalidOperationException("Fallback model did not preserve collision and replace art.");
                Vector3 native = prefab.transform.localScale;
                Vector3 actual = art.transform.lossyScale;
                if (Vector3.Distance(native, actual) > 0.001f)
                    throw new InvalidOperationException("Fallback model changed native size: " + actual);
                original.transform.localScale = new Vector3(0.5f, 3f, 1.5f);
                RoaApocalypseNativeScale nativeSize = art.GetComponent<RoaApocalypseNativeScale>();
                if (nativeSize == null)
                    throw new InvalidOperationException("Fallback has no runtime native-size guard.");
                nativeSize.EnsureNativeSize();
                if (Vector3.Distance(native, art.transform.lossyScale) > 0.001f)
                    throw new InvalidOperationException("Fallback size changed with its gameplay root.");
                Debug.Log("[ROA APOCALYPSE] Environment fallback passed: "
                    + keys.Length + " roles, collision retained, old mesh hidden.");

                string basePath = Path.GetFullPath(Path.Combine(Application.dataPath,
                    "../../data/kromka/base-building.json"));
                JArray profiles = JObject.Parse(File.ReadAllText(basePath))["objects"] as JArray;
                int built = 0;
                foreach (JToken profile in profiles ?? new JArray())
                {
                    string modelKey = profile["model"]?.ToString();
                    GameObject basePrefab = RoaApocalypseModels.Environment(modelKey);
                    if (basePrefab == null) throw new InvalidOperationException("Missing base model: " + modelKey);
                    GameObject holder = new GameObject("BaseProbe:" + modelKey);
                    try
                    {
                        GameObject placed = RoaApocalypseVisuals.CreateGrounded(holder.transform, basePrefab);
                        AssertGrounded(placed, holder.transform, basePrefab, modelKey);
                        built++;
                    }
                    finally { UnityEngine.Object.DestroyImmediate(holder); }
                }
                string[] tutorialKinds = { "truck", "gate", "cot", "target", "bench", "crate", "cover", "ore", "wood" };
                foreach (string kind in tutorialKinds)
                {
                    GameObject holder = new GameObject("TutorialProbe:" + kind);
                    try
                    {
                        GameObject tutorial = RoaTutorialProps.Build(kind, holder.transform);
                        if (tutorial.transform.Find(RoaApocalypseVisuals.ChildName) == null)
                            throw new InvalidOperationException("Tutorial still uses primitives: " + kind);
                    }
                    finally { UnityEngine.Object.DestroyImmediate(holder); }
                }
                Debug.Log("[ROA APOCALYPSE] Native runtime props passed: " + built
                    + " personal-base models and " + tutorialKinds.Length + " tutorial models.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(original);
            }
        }

        private static void AssertGrounded(GameObject visual, Transform root, GameObject prefab, string key)
        {
            if (visual == null || Vector3.Distance(visual.transform.lossyScale, prefab.transform.localScale) > 0.001f)
                throw new InvalidOperationException("Runtime model changed size: " + key);
            Bounds bounds = default;
            bool found = false;
            foreach (Renderer renderer in visual.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                if (!found) { bounds = renderer.bounds; found = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            if (!found) throw new InvalidOperationException("Runtime model has no visible renderers: " + key);
            if (Mathf.Abs(bounds.min.y - root.position.y) > 0.02f)
                throw new InvalidOperationException("Runtime model is not grounded: " + key + " at " + bounds.min.y);
        }
    }
}
#endif
