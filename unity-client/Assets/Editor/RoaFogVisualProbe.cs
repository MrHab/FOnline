using System.IO;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Показывает production-меш затенения поверх открытой игровой сцены.</summary>
    public static class RoaFogVisualProbe
    {
        private const string MenuPath = "Realm of Ashes/Показать визуальный туман";
        private const string ProbeName = "FogVisualProbe";

        [MenuItem(MenuPath)]
        private static void Toggle()
        {
            GameObject existing = GameObject.Find(ProbeName);
            if (existing != null)
            {
                Object.DestroyImmediate(existing);
                Debug.Log("[ТУМАН-ВИЗУАЛ] проба скрыта.");
                return;
            }

            string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../data/locations/settlement.json"));
            if (!File.Exists(path))
            {
                Debug.LogError("[ТУМАН-ВИЗУАЛ] нет " + path);
                return;
            }

            LocationDefinition location = JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(path));
            var host = new GameObject(ProbeName) { hideFlags = HideFlags.DontSave };
            var fog = host.AddComponent<RoaFogOfWar>();
            fog.Perception = 5;
            fog.Build(location);

            GameObject player = GameObject.Find("LocalPlayer");
            Vector3 eye = player != null ? player.transform.position : Vector3.zero;
            fog.Rebuild(eye, false, false, false);

            MeshFilter filter = host.GetComponentInChildren<MeshFilter>();
            MeshRenderer renderer = host.GetComponentInChildren<MeshRenderer>();
            bool meshOk = filter != null && filter.sharedMesh != null
                && filter.sharedMesh.subMeshCount == 2 && filter.sharedMesh.vertexCount > 0;
            bool materialsOk = renderer != null && renderer.sharedMaterials.Length == 2;
            if (!meshOk || !materialsOk || fog.VisualFogCount <= 0)
            {
                Debug.LogError("[ТУМАН-ВИЗУАЛ] меш не собран: fog=" + fog.VisualFogCount
                    + ", block=" + fog.VisualBlockCount);
                Object.DestroyImmediate(host);
                return;
            }

            Debug.Log("[ТУМАН-ВИЗУАЛ] готово: тёмных=" + fog.VisualFogCount
                + ", препятствий=" + fog.VisualBlockCount
                + ", вершин=" + filter.sharedMesh.vertexCount);
        }

        [MenuItem(MenuPath, true)]
        private static bool ValidateToggle()
        {
            return EditorApplication.isPlaying;
        }
    }
}
