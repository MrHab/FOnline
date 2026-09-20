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
        private const string MaterialDir = "Assets/Art/Kromka/Materials";
        private const string MaterialPath = MaterialDir + "/Kromka_Road.mat";
        private const string Target = Dir + "/road_tile.prefab";

        public static void Build()
        {
            // Материал — свой, а не из магазинного набора: все его текстуры песочные,
            // и дорога сливалась с грунтом. Ровный тёмно-серый на песке читается сразу.
            var material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                material = new Material(shader) { name = "Kromka_Road" };
                Directory.CreateDirectory(MaterialDir);
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            var road = new Color(0.34f, 0.33f, 0.31f, 1f);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", road);
            if (material.HasProperty("_Color")) material.SetColor("_Color", road);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.08f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.08f);
            EditorUtility.SetDirty(material);

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
