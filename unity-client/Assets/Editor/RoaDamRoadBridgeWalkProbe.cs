using System;
using System.IO;
using Kromka.EditorTools;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaDamRoadBridgeWalkProbe
    {
        [MenuItem("Realm of Ashes/Zones/Check dam road bridge crossing")]
        public static void Run()
        {
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            var definition = JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(
                Path.Combine(root, "data/zones/authored/z_10_10.json")));
            EditorSceneManager.OpenScene("Assets/Scenes/Kromka/Locations/z_10_10.unity");
            var location = UnityEngine.Object.FindFirstObjectByType<RoaUnityLocationScene>();
            if (location == null || location.GroundRenderer == null)
                throw new InvalidOperationException("Dam road scene has no authored ground.");
            var painter = new GameObject("BridgeWalkGroundPainter");
            painter.AddComponent<RoaLocalTerrain>().InitializeAuthoredSurface(
                definition, null, location.GroundRenderer);
            try
            {
                Physics.SyncTransforms();
                foreach (float z in new[] { -106f, -107.5f, -104.5f }) Walk(z);
                Debug.Log("[ROA DAM ROAD BRIDGE WALK] PASS: capsule crosses all three bridge lanes.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(painter);
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
        }

        private static void Walk(float z)
        {
            var walker = new GameObject("BridgeWalkCapsule");
            try
            {
                walker.transform.position = new Vector3(-113f, 1.05f, z);
                var body = walker.AddComponent<CharacterController>();
                body.height = RoaGameBootstrap.PlayerHeight;
                body.center = Vector3.zero;
                RoaPlayerController.ConfigureAuthoritativeCollision(body);
                for (int step = 0; step < 200 && walker.transform.position.x < -97f; step++)
                    body.Move(new Vector3(0.12f, -0.04f, 0f));
                float reached = walker.transform.position.x;
                if (reached < -97.5f || Mathf.Abs(walker.transform.position.z - z) > 0.55f)
                {
                    Vector3 ahead = walker.transform.position + new Vector3(0.7f, 0f, 0f);
                    string obstacles = string.Join(", ", Array.ConvertAll(
                        Physics.OverlapSphere(ahead, 0.6f), Describe));
                    throw new InvalidOperationException($"Bridge lane z={z} ends at x={reached:0.00}, "
                        + $"y={walker.transform.position.y:0.00}, "
                        + $"z={walker.transform.position.z:0.00}; near: {obstacles}");
                }
                Debug.Log($"[ROA DAM ROAD BRIDGE WALK] lane z={z:0.0} reached "
                    + $"x={reached:0.00}, z={walker.transform.position.z:0.00}");
            }
            finally { UnityEngine.Object.DestroyImmediate(walker); }
        }

        private static string Describe(Collider collider)
        {
            string path = collider.name;
            Transform parent = collider.transform.parent;
            for (int level = 0; parent != null && level < 5; level++, parent = parent.parent)
                path += " < " + parent.name;
            return path;
        }
    }
}
