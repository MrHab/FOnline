using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Текстуры земли зон: каталог Resources/RealmOfAshes/Ground/ground-textures.json
    /// (собирает tools/build-ground-textures.js из source-assets/ground-textures) и
    /// материал шейдера «Realm of Ashes/Kromka Ground». Пресет грунта локации
    /// (ground.preset) выбирает набор; тропы и грязь — общие наборы каталога.
    /// Текстуры грузятся один раз и живут весь сеанс: их делят все зоны.
    /// </summary>
    public static class RoaGroundTextures
    {
        public const string ShaderName = "Realm of Ashes/Kromka Ground";
        public const string ResourceFolder = "RealmOfAshes/Ground/";
        public const string LiteKeyword = "_KROMKA_GROUND_LITE";

        public struct SetInfo
        {
            public string Id;
            public float TilingMeters;
            public Color Tint;
            public float Saturation;
        }

        private static JObject _catalog;
        private static bool _catalogLoaded;
        private static readonly Dictionary<string, Texture2D> Textures = new Dictionary<string, Texture2D>();

        /// <summary>Для проб: прежняя земля URP/Lit, чтобы снять её рядом с новой.</summary>
        public static bool ForceLegacy { get; set; }

        public static bool Available
        {
            get
            {
                if (ForceLegacy) return false;
                Shader shader = Shader.Find(ShaderName);
                return shader != null && shader.isSupported && Catalog != null;
            }
        }

        private static JObject Catalog
        {
            get
            {
                if (_catalogLoaded) return _catalog;
                _catalogLoaded = true;
                TextAsset asset = Resources.Load<TextAsset>(ResourceFolder + "ground-textures");
                if (asset == null) return null;
                try { _catalog = JObject.Parse(asset.text); }
                catch (System.Exception error)
                {
                    Debug.LogWarning("[ROA] Каталог текстур земли повреждён: " + error.Message);
                    _catalog = null;
                }
                return _catalog;
            }
        }

        /// <summary>Набор для пресета грунта; неизвестный пресет — набор по умолчанию.</summary>
        public static string SetForPreset(string preset)
        {
            JObject catalog = Catalog;
            if (catalog == null) return null;
            string id = !string.IsNullOrEmpty(preset) ? catalog["presets"]?[preset]?.ToString() : null;
            return string.IsNullOrEmpty(id) ? catalog["defaultSet"]?.ToString() : id;
        }

        public static string PathSet { get { return Catalog?["pathSet"]?.ToString(); } }
        public static string MudSet { get { return Catalog?["mudSet"]?.ToString(); } }

        public static SetInfo Info(string id)
        {
            var info = new SetInfo { Id = id, TilingMeters = 3f, Tint = Color.white, Saturation = 1f };
            JObject set = Catalog?["sets"]?[id ?? string.Empty] as JObject;
            if (set == null) return info;
            info.TilingMeters = Mathf.Clamp(set["tilingMeters"]?.Value<float>() ?? 3f, 0.5f, 12f);
            info.Saturation = Mathf.Clamp(set["saturation"]?.Value<float>() ?? 1f, 0f, 1.5f);
            if (set["tint"] is JArray tint && tint.Count >= 3)
                info.Tint = new Color(tint[0].Value<float>(), tint[1].Value<float>(), tint[2].Value<float>(), 1f);
            return info;
        }

        /// <summary>
        /// Материал земли для пресета грунта. null — шейдера, каталога или текстур нет:
        /// тогда RoaLocalTerrain остаётся на прежней земле URP/Lit.
        /// </summary>
        public static Material CreateMaterial(string preset, string name, bool mobile)
        {
            if (!Available) return null;
            string groundSet = SetForPreset(preset);
            string pathSet = PathSet;
            var material = new Material(Shader.Find(ShaderName)) { name = name };
            if (!ApplySet(material, "_Ground", groundSet) || !ApplySet(material, "_Path", pathSet))
            {
                if (Application.isPlaying) Object.Destroy(material);
                else Object.DestroyImmediate(material);
                Debug.LogWarning("[ROA] Текстуры земли для пресета '" + preset + "' не найдены — земля остаётся прежней.");
                return null;
            }
            // Грязь — необязательный набор: без него земля просто не раскисает.
            string mudSet = MudSet;
            if (!string.IsNullOrEmpty(mudSet) && !ApplySet(material, "_Mud", mudSet))
                Debug.LogWarning("[ROA] Набор грязи '" + mudSet + "' не найден — лужи будут без грязи.");
            if (mobile) material.EnableKeyword(LiteKeyword);
            return material;
        }

        private static bool ApplySet(Material material, string prefix, string id)
        {
            if (string.IsNullOrEmpty(id)) return false;
            Texture2D albedo = Load(id + "_albedo");
            Texture2D normal = Load(id + "_normal");
            Texture2D mask = Load(id + "_mask");
            if (albedo == null || normal == null || mask == null) return false;
            SetInfo info = Info(id);
            material.SetTexture(prefix + "Albedo", albedo);
            material.SetTexture(prefix + "Normal", normal);
            material.SetTexture(prefix + "Mask", mask);
            material.SetFloat(prefix + "Tiling", info.TilingMeters);
            material.SetColor(prefix + "Tint", info.Tint);
            material.SetFloat(prefix + "Saturation", info.Saturation);
            return true;
        }

        private static Texture2D Load(string name)
        {
            if (Textures.TryGetValue(name, out Texture2D cached) && cached != null) return cached;
            Texture2D texture = Resources.Load<Texture2D>(ResourceFolder + name);
            if (texture != null) Textures[name] = texture;
            return texture;
        }
    }
}
