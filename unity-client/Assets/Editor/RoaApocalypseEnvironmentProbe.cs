#if UNITY_EDITOR
using System;
using System.IO;
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
                Debug.Log("[ROA APOCALYPSE] Environment fallback passed: "
                    + keys.Length + " roles, collision retained, old mesh hidden.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(original);
            }
        }
    }
}
#endif
