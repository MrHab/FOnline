using System.IO;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Префаб дорожной плиты: ровная плоскость 4 × 4 м с материалом асфальта из
    /// `asphalt_slab`. Сама плита — груда щебня, и мостовая из неё выходила насыпью;
    /// плоскому покрытию нужен плоский меш, а не другой камень.
    ///
    /// Запуск: -executeMethod RealmOfAshes.EditorTools.RoaRoadTileBuilder.Build
    /// </summary>
    public static class RoaRoadTileBuilder
    {
        private const string Dir = "Assets/Prefabs/Kromka/RecoveredEnvironment";
        private const string Source = Dir + "/asphalt_slab.prefab";
        private const string Target = Dir + "/road_tile.prefab";

        public static void Build()
        {
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(Source);
            if (source == null) { Debug.LogError("[road] нет " + Source); return; }
            Material material = null;
            foreach (MeshRenderer renderer in source.GetComponentsInChildren<MeshRenderer>(true))
            {
                if (renderer == null || renderer.sharedMaterial == null) continue;
                material = renderer.sharedMaterial;
                break;
            }
            if (material == null) { Debug.LogError("[road] у плиты асфальта нет материала"); return; }

            var root = new GameObject("road_tile");
            var surface = GameObject.CreatePrimitive(PrimitiveType.Quad);
            surface.name = "surface";
            Object.DestroyImmediate(surface.GetComponent<Collider>());
            surface.transform.SetParent(root.transform, false);
            // Quad стоит вертикально: кладём его на землю и растягиваем на 4 × 4 м.
            surface.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            surface.transform.localScale = new Vector3(4f, 4f, 1f);
            surface.transform.localPosition = new Vector3(0f, 0.03f, 0f);
            surface.GetComponent<MeshRenderer>().sharedMaterial = material;
            surface.GetComponent<MeshRenderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;

            Directory.CreateDirectory(Dir);
            PrefabUtility.SaveAsPrefabAsset(root, Target);
            Object.DestroyImmediate(root);
            AssetDatabase.SaveAssets();
            Debug.Log("[road] собран " + Target + " с материалом " + material.name);
        }
    }
}
