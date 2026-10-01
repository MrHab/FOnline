using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEngine;
using UnityEngine.UI;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Следы постоянных групп A-Life. Вид логова приходит от сервера, а оформление
    /// ставится поверх сцены сектора без коллизии: закреплённые сцены не приходится
    /// пересобирать при изменении состава фауны.
    /// </summary>
    public static class RoaZoneLairDressing
    {
        private sealed class Theme
        {
            public readonly string Label;
            public readonly Color Accent;
            public readonly string[] Props;

            public Theme(string label, Color accent, params string[] props)
            {
                Label = label;
                Accent = accent;
                Props = props;
            }
        }

        // Путники не имеют логов. Каждый вид, которому A-Life заводит логово,
        // получает свой набор узнаваемых следов и подпись в Unity-клиенте.
        private static readonly Dictionary<string, Theme> Themes = new Dictionary<string, Theme>(StringComparer.Ordinal)
        {
            { "raider_band", new Theme("НАЛЁТЧИКИ", new Color(0.78f, 0.28f, 0.20f), "scrap_wall_segment", "rust_barrel_v1", "campfire_rest") },
            { "gari_pack", new Theme("ГАРИ", new Color(0.74f, 0.55f, 0.32f), "rubble_rock", "deadwood", "dry_bush") },
            { "dustling_brood", new Theme("ПЫЛЬНИКИ", new Color(0.83f, 0.72f, 0.45f), "scrap_heap", "perimeter_debris", "dry_bush") },
            { "listener_pack", new Theme("СЛУХАЧИ", new Color(0.40f, 0.62f, 0.72f), "dead_tree_a", "utility_pole", "perimeter_debris") },
            { "rykhlyak_herd", new Theme("РЫХЛЯКИ", new Color(0.63f, 0.47f, 0.30f), "rubble_rock", "rubble_rock", "scrap_heap") },
            { "mourner_flock", new Theme("ПЛАКАЛЬЩИКИ", new Color(0.60f, 0.47f, 0.70f), "dead_tree_b", "deadwood", "rubble_rock") },
            { "fold_cluster", new Theme("СКЛАДНИ", new Color(0.43f, 0.70f, 0.67f), "concrete_wall", "scrap_wall_segment", "perimeter_debris") },
            { "burned_drifters", new Theme("ВЫЖЖЕННЫЕ", new Color(0.87f, 0.39f, 0.21f), "car_wreck", "rust_barrel_v1", "campfire_rest") },
            { "lantern_herd", new Theme("ФОНАРНИКИ", new Color(0.68f, 0.79f, 0.35f), "dead_tree_c", "dry_bush", "garden_patch") }
        };

        private static Material _plaqueMaterial;
        private static readonly Dictionary<string, Material> AccentMaterials = new Dictionary<string, Material>(StringComparer.Ordinal);
        public static int ThemeCount { get { return Themes.Count; } }
        public static bool HasTheme(string speciesId) { return speciesId != null && Themes.ContainsKey(speciesId); }

        public static int Build(LocationDefinition definition, Transform parent)
        {
            JArray lairs = definition?.Zone?["lairs"] as JArray;
            if (lairs == null || parent == null) return 0;
            RoaZoneKitCatalog kit = RoaZoneKitCatalog.Instance;
            var root = new GameObject("LairDressing");
            root.transform.SetParent(parent, false);
            int built = 0;
            foreach (JToken token in lairs)
            {
                if (!(token is JObject row)) continue;
                string speciesId = row["speciesId"]?.ToString() ?? string.Empty;
                if (!Themes.TryGetValue(speciesId, out Theme theme)) continue;
                int tx = row["tx"]?.Value<int>() ?? -1;
                int tz = row["tz"]?.Value<int>() ?? -1;
                if (tx < 0 || tx >= definition.TileWidth || tz < 0 || tz >= definition.TileDepth) continue;
                float x = (tx - definition.TileWidth / 2f + 0.5f) * definition.TileStep;
                float z = (tz - definition.TileDepth / 2f + 0.5f) * definition.TileStep;
                var group = new GameObject("Lair_" + speciesId + "_" + (row["id"]?.ToString() ?? built.ToString()));
                group.transform.SetParent(root.transform, false);
                group.transform.localPosition = new Vector3(x, 0f, z);
                BuildMarker(group.transform, theme, speciesId);
                if (kit != null)
                    for (int i = 0; i < theme.Props.Length; i++)
                        PlaceProp(kit, group.transform, theme.Props[i], i);
                built++;
            }
            return built;
        }

        private static void PlaceProp(RoaZoneKitCatalog kit, Transform parent, string key, int index)
        {
            GameObject prefab = kit.Find(key);
            if (prefab == null) return;
            GameObject instance = UnityEngine.Object.Instantiate(prefab, parent);
            instance.name = "Trace_" + key + "_" + index;
            // Оригинальный размер импортированного префаба сохраняется.
            Vector3[] spots = { new Vector3(-6f, 0f, -4f), new Vector3(6f, 0f, -4f), new Vector3(0f, 0f, 7f) };
            instance.transform.localPosition = spots[index % spots.Length];
            instance.transform.localRotation = Quaternion.Euler(0f, index * 113f, 0f);
            foreach (Collider collider in instance.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
        }

        private static void BuildMarker(Transform parent, Theme theme, string speciesId)
        {
            // Невысокая табличка из металла и цветной знак читаются с любой
            // стороны камеры; звериная площадка при этом остаётся проходимой.
            GameObject post = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            post.name = "MarkerPost";
            post.transform.SetParent(parent, false);
            post.transform.localPosition = new Vector3(0f, 0.85f, -5f);
            post.transform.localScale = new Vector3(0.11f, 0.85f, 0.11f);
            DisableCollider(post);
            post.GetComponent<Renderer>().sharedMaterial = PlaqueMaterial();

            var face = new GameObject("MarkerFace");
            face.transform.SetParent(parent, false);
            face.transform.localPosition = new Vector3(0f, 2.2f, -5f);
            face.AddComponent<RoaZoneLairBillboard>();
            Plate(face.transform, new Vector3(0f, 0f, 0f), new Vector3(5.2f, 0.95f, 0.10f), PlaqueMaterial());
            Plate(face.transform, new Vector3(0f, 0.39f, -0.065f), new Vector3(5.2f, 0.16f, 0.04f), AccentMaterial(speciesId, theme.Accent));
            var canvasObject = new GameObject("NameCanvas", typeof(RectTransform), typeof(Canvas));
            canvasObject.transform.SetParent(face.transform, false);
            canvasObject.transform.localPosition = new Vector3(0f, -0.04f, -0.08f);
            canvasObject.transform.localRotation = Quaternion.identity;
            canvasObject.transform.localScale = Vector3.one * 0.01f;
            Canvas canvas = canvasObject.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            RectTransform canvasRect = canvasObject.GetComponent<RectTransform>();
            canvasRect.sizeDelta = new Vector2(500f, 82f);
            var textObject = new GameObject("Name", typeof(RectTransform), typeof(Text));
            textObject.transform.SetParent(canvasObject.transform, false);
            RectTransform textRect = textObject.GetComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = Vector2.zero;
            textRect.offsetMax = Vector2.zero;
            Text label = textObject.GetComponent<Text>();
            label.text = theme.Label;
            label.font = RoaUiFont.Default;
            label.fontSize = 60;
            label.resizeTextForBestFit = true;
            label.resizeTextMinSize = 30;
            label.resizeTextMaxSize = 60;
            label.alignment = TextAnchor.MiddleCenter;
            label.raycastTarget = false;
            label.color = new Color(0.97f, 0.94f, 0.83f);
        }

        private static void Plate(Transform parent, Vector3 at, Vector3 size, Material material)
        {
            GameObject plate = GameObject.CreatePrimitive(PrimitiveType.Cube);
            plate.transform.SetParent(parent, false);
            plate.transform.localPosition = at;
            plate.transform.localScale = size;
            DisableCollider(plate);
            plate.GetComponent<Renderer>().sharedMaterial = material;
        }

        private static void DisableCollider(GameObject gameObject)
        {
            Collider collider = gameObject.GetComponent<Collider>();
            if (collider == null) return;
            collider.enabled = false;
            UnityEngine.Object.Destroy(collider);
        }

        private static Material PlaqueMaterial()
        {
            if (_plaqueMaterial != null) return _plaqueMaterial;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            _plaqueMaterial = new Material(shader) { color = new Color(0.12f, 0.14f, 0.14f) };
            return _plaqueMaterial;
        }

        private static Material AccentMaterial(string speciesId, Color color)
        {
            if (AccentMaterials.TryGetValue(speciesId, out Material material) && material != null) return material;
            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            material = new Material(shader) { color = color };
            AccentMaterials[speciesId] = material;
            return material;
        }
    }

    public sealed class RoaZoneLairBillboard : MonoBehaviour
    {
        private void LateUpdate()
        {
            Camera camera = Camera.main;
            // Лицевая сторона таблички находится на локальной -Z.
            if (camera != null) transform.rotation = Quaternion.LookRotation(transform.position - camera.transform.position, Vector3.up);
        }
    }
}
