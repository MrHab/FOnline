using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Объём, в котором на префабе лежит краска тира, в координатах его корня: полоса
    /// поперёк рукояти, пояс по корпусу или пятно сверху. Считает редактор по
    /// треугольникам префаба (RoaTierMarkLayout) — в сборке вершины пака не читаются.
    /// </summary>
    [Serializable]
    public sealed class RoaTierMarkPlacement
    {
        public const int Box = 0, Cylinder = 1, Sphere = 2;

        public bool valid;
        /// <summary>Форма объёма: Box, Cylinder (ось Y) или Sphere.</summary>
        public int shape;
        public Vector3 position;
        public Quaternion rotation = Quaternion.identity;
        public Vector3 scale = Vector3.one;
    }

    /// <summary>
    /// Метка тира на предмете: чуть краски из баллончика цвета тира прямо по родной
    /// текстуре. Лишней геометрии нет — второй материал (RealmOfAshes/TierSpray)
    /// рисует ту же поверхность и красит только то, что попало в объём метки.
    /// </summary>
    public static class RoaTierMark
    {
        public const string SprayShaderName = "RealmOfAshes/TierSpray";
        private static readonly int SprayMatrix = Shader.PropertyToID("_SprayMatrix");
        private static readonly int SprayColor = Shader.PropertyToID("_SprayColor");
        private static readonly int SprayShape = Shader.PropertyToID("_SprayShape");
        private static Shader _shader;
        private static readonly Dictionary<string, Material> Sprays = new Dictionary<string, Material>();

        /// <summary>
        /// Материал краски на одно место и цвет: у предмета их немного (рендереры × тиры),
        /// поэтому экземпляры общие и живут весь сеанс.
        /// </summary>
        private static Material SprayMaterial(Matrix4x4 objectToVolume, int shape, int tier)
        {
            if (_shader == null) _shader = Resources.Load<Shader>("RealmOfAshes/TierSpray");
            if (_shader == null) return null;
            string key = tier + "|" + shape + "|" + objectToVolume.ToString("F4");
            if (Sprays.TryGetValue(key, out Material material) && material != null) return material;
            material = new Material(_shader) { name = "RoaTierSpray T" + tier, hideFlags = HideFlags.DontSave };
            material.SetMatrix(SprayMatrix, objectToVolume);
            material.SetColor(SprayColor, RoaTierData.TierColor(tier));
            material.SetFloat(SprayShape, shape);
            Sprays[key] = material;
            return material;
        }

        /// <summary>Красит модель под root (прежняя краска снимается); без места или тира — только снимает.</summary>
        public static void Attach(GameObject root, RoaTierMarkPlacement placement, int tier)
        {
            if (root == null) return;
            bool paint = placement != null && placement.valid && tier >= 1;
            Matrix4x4 rootToVolume = paint
                ? Matrix4x4.TRS(placement.position, placement.rotation, placement.scale).inverse * root.transform.worldToLocalMatrix
                : Matrix4x4.identity;
            foreach (MeshRenderer renderer in root.GetComponentsInChildren<MeshRenderer>(true))
            {
                Material[] current = renderer.sharedMaterials;
                var materials = new List<Material>(current.Length + 1);
                foreach (Material material in current)
                    if (!IsSpray(material)) materials.Add(material);
                Material spray = paint
                    ? SprayMaterial(rootToVolume * renderer.transform.localToWorldMatrix, placement.shape, tier)
                    : null;
                if (spray != null) materials.Add(spray);
                if (materials.Count != current.Length || spray != null) renderer.sharedMaterials = materials.ToArray();
            }
        }

        /// <summary>Есть ли на рендерере краска тира и какого она цвета (для проб).</summary>
        public static bool IsSprayed(Renderer renderer, out Color color)
        {
            color = Color.clear;
            if (renderer == null) return false;
            Material[] materials = renderer.sharedMaterials;
            foreach (Material material in materials)
            {
                if (!IsSpray(material)) continue;
                color = material.GetColor(SprayColor);
                return true;
            }
            return false;
        }

        private static bool IsSpray(Material material)
        {
            return material != null && material.shader != null && material.shader.name == SprayShaderName;
        }
    }
}
