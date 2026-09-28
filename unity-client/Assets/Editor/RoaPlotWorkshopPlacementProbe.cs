#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Расстановка вещей в мастерских участков: ничто не висит в воздухе и ничто
    /// не вошло в соседа. Опора — пол (верх плит) или верх другой вещи под ней;
    /// вещи на стене (вывески, лампы, щитки, кабели, огонь) проверяются отдельно:
    /// они должны касаться стены. Пересечение — по настоящей геометрии:
    /// выпуклая оболочка мелкой вещи против сетки постройки или оболочки соседа.
    ///
    /// Меню: «Realm of Ashes/Проверить расстановку мастерских участков».
    /// Отчёт — Library/PlotPreview/placement.txt и строки [PLACEMENT] в логе.
    /// </summary>
    public static class RoaPlotWorkshopPlacementProbe
    {
        private const float Floor = 0.08f;
        private const float Rest = 0.12f;
        private const float Penetration = 0.06f;

        // Вещи, которые по замыслу висят: на стене, на столбе, под крышей, в воздухе.
        private static readonly string[] Hanging =
        {
            "Sign", "Decor_", "Glow", "Cable", "SM_Prop_Bunker_Light_01", "SM_Prop_PowerBoxes_01",
            "FX_", "Fx_", "KitCollision", "SM_Bld_Bunker_Ceiling_Corrugated_01"
        };

        // Постройки: внутри них вещи стоят по замыслу, пересечение ищется с их стенами.
        private static readonly string[] Shells =
        {
            "SM_Bld_", "SM_Prop_Wall_Junk_Container_01", "SM_Prop_Shipping_Container_01"
        };

        private static readonly string[] Floors =
        {
            "SM_Bld_Bunker_Concrete_Floor_01", "SM_Bld_Bunker_Floor_Wood_01", "SM_Bld_Bunker_Floor_Stone_01",
            // Бордюр — край того же основания: куски стыкуются внахлёст.
            "SM_Env_Sidewalk_Edge_"
        };

        private sealed class Item
        {
            public string Name;
            public GameObject Root;
            public Bounds Bounds;
            public float OwnArea;
            public bool Floor;
            public bool Shell;
            public bool Hanging;
            public readonly List<Collider> Colliders = new List<Collider>();
        }

        [MenuItem("Realm of Ashes/Проверить расстановку мастерских участков")]
        public static void Run()
        {
            var report = new StringBuilder();
            int problems = 0;
            foreach (string key in RoaPlotWorkshopBuilder.Keys)
                problems += Check(key, report);
            report.AppendLine(problems == 0 ? "RESULT OK" : "RESULT FAIL " + problems + " problems");
            string file = Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/PlotPreview/placement.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.WriteAllText(file, report.ToString());
            if (problems == 0) Debug.Log("[PLACEMENT] OK\n" + report);
            else Debug.LogError("[PLACEMENT] FAIL\n" + report);
        }

        private static int Check(string key, StringBuilder report)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(RoaPlotWorkshopBuilder.PrefabPath(key));
            if (prefab == null) { report.AppendLine(key + ": нет префаба"); return 1; }
            Scene scene = EditorSceneManager.NewPreviewScene();
            try
            {
                var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
                var items = new List<Item>();
                foreach (Transform child in root.transform)
                {
                    Renderer[] renderers = child.GetComponentsInChildren<Renderer>(false)
                        .Where(renderer => renderer.enabled && !(renderer is ParticleSystemRenderer)).ToArray();
                    string name = child.name;
                    var item = new Item
                    {
                        Name = name + " @" + child.localPosition.ToString("0.0"),
                        Root = child.gameObject,
                        Floor = Floors.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)),
                        Shell = Shells.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)),
                        Hanging = Hanging.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal))
                    };
                    if (renderers.Length == 0) continue;
                    item.OwnArea = OwnArea(child, renderers);
                    item.Bounds = renderers[0].bounds;
                    foreach (Renderer renderer in renderers) item.Bounds.Encapsulate(renderer.bounds);
                    foreach (MeshFilter filter in child.GetComponentsInChildren<MeshFilter>(false))
                    {
                        if (filter.sharedMesh == null) continue;
                        var meshRenderer = filter.GetComponent<MeshRenderer>();
                        if (meshRenderer == null || !meshRenderer.enabled) continue;
                        var collider = filter.gameObject.AddComponent<MeshCollider>();
                        collider.sharedMesh = filter.sharedMesh;
                        // Постройка — настоящая сетка стен; мелкая вещь — выпуклая оболочка.
                        collider.convex = !item.Shell;
                        item.Colliders.Add(collider);
                    }
                    items.Add(item);
                }
                Physics.SyncTransforms();

                int problems = 0;
                var solids = items.Where(item => !item.Floor && !item.Hanging).ToList();
                // Всё стоит на фундаменте участка: плиты лежат от −6,25 до +6,25 м,
                // бордюр со столбиками обходит их снаружи и кончается у ±6,85 м
                // (граница участка 14 × 14 м — ±7 м).
                foreach (Item item in items.Where(item => !item.Name.StartsWith("KitCollision")))
                {
                    Bounds b = item.Bounds;
                    float edge = item.Floor ? 6.9f : 6.25f;
                    float outside = Mathf.Max(Mathf.Max(-edge - b.min.x, b.max.x - edge), Mathf.Max(-edge - b.min.z, b.max.z - edge));
                    if (outside <= 0.05f) continue;
                    report.AppendLine(key + ": выходит за фундамент на " + outside.ToString("0.00") + " м — " + item.Name);
                    problems++;
                }
                foreach (Item item in solids)
                {
                    if (item.Bounds.min.y <= Floor) continue;
                    List<Item> supports = items.Where(other => other != item && !other.Hanging && Supports(other, item)).ToList();
                    if (supports.Count == 0)
                    {
                        report.AppendLine(key + ": висит в воздухе " + item.Name + " (низ на " + item.Bounds.min.y.ToString("0.00") + " м)");
                        problems++;
                        continue;
                    }
                    // Устойчивость: широкая вещь на узкой опоре съедет. Опора (в плане,
                    // под самой вещью) должна занимать хотя бы 60 % её площади, а центр
                    // вещи — стоять над опорой. Постройки (полки, крыши) держат и так.
                    if (supports.Any(other => other.Shell)) continue;
                    // Площади в собственных осях вещей: поворот не раздувает их, как габарит мира.
                    float area = item.OwnArea;
                    float held = supports.Sum(other => other.OwnArea);
                    Vector3 centre = item.Bounds.center;
                    bool centred = supports.Any(other => centre.x >= other.Bounds.min.x && centre.x <= other.Bounds.max.x
                        && centre.z >= other.Bounds.min.z && centre.z <= other.Bounds.max.z);
                    if (held >= area * 0.6f && centred) continue;
                    report.AppendLine(key + ": стоит шатко " + item.Name + " (опора " + (held / Mathf.Max(0.001f, area) * 100f).ToString("0")
                        + " % площади" + (centred ? "" : ", центр не над опорой") + ")");
                    problems++;
                }
                // Висящее держится за закреплённое: стену, столб или уже закреплённое
                // висящее (плиты крыши держат друг друга, лампа висит под крышей).
                var anchored = new HashSet<Item>(items.Where(item => !item.Floor && !item.Hanging));
                var hanging = items.Where(item => item.Hanging && item.Bounds.min.y > Floor
                    && !item.Name.StartsWith("FX_") && !item.Name.StartsWith("Fx_")
                    && !item.Name.StartsWith("KitCollision") && !item.Name.StartsWith("Glow")).ToList();
                for (bool grew = true; grew;)
                {
                    grew = false;
                    foreach (Item item in hanging)
                    {
                        if (anchored.Contains(item)) continue;
                        Bounds grown = item.Bounds;
                        grown.Expand(0.3f);
                        if (!anchored.Any(other => other.Bounds.Intersects(grown))) continue;
                        anchored.Add(item);
                        grew = true;
                    }
                }
                foreach (Item item in hanging.Where(item => !anchored.Contains(item)))
                {
                    report.AppendLine(key + ": висит ни на чём " + item.Name);
                    problems++;
                }
                // Пересечения ищутся и с крышей: мачта или стеллаж под навесом не
                // должны пробивать профлист.
                var bodies = items.Where(item => !item.Floor && (!item.Hanging || item.Shell)).ToList();
                for (int i = 0; i < bodies.Count; i++)
                {
                    for (int j = i + 1; j < bodies.Count; j++)
                    {
                        Item a = bodies[i], b = bodies[j];
                        if (a.Shell && b.Shell) continue;
                        if (!a.Bounds.Intersects(b.Bounds)) continue;
                        // Стоит одно на другом — это опора, а не пересечение.
                        if (Supports(a, b) || Supports(b, a)) continue;
                        float depth = Depth(a, b);
                        if (depth <= Penetration) continue;
                        report.AppendLine(key + ": " + a.Name + " входит в " + b.Name + " на " + depth.ToString("0.00") + " м");
                        problems++;
                    }
                }
                report.AppendLine(key + ": вещей " + items.Count + ", замечаний " + problems);
                return problems;
            }
            finally { EditorSceneManager.ClosePreviewScene(scene); }
        }

        /// <summary>Нижняя вещь держит верхнюю: верх нижней на уровне низа верхней, и они перекрываются в плане.</summary>
        private static bool Supports(Item below, Item above)
        {
            if (Mathf.Abs(below.Bounds.max.y - above.Bounds.min.y) > Rest
                && !(below.Shell && above.Bounds.min.y > below.Bounds.min.y + 0.3f && above.Bounds.min.y < below.Bounds.max.y
                     && Touches(below, above))) return false;
            float overlapX = Mathf.Min(below.Bounds.max.x, above.Bounds.max.x) - Mathf.Max(below.Bounds.min.x, above.Bounds.min.x);
            float overlapZ = Mathf.Min(below.Bounds.max.z, above.Bounds.max.z) - Mathf.Max(below.Bounds.min.z, above.Bounds.min.z);
            return overlapX > 0.05f && overlapZ > 0.05f;
        }

        /// <summary>Вещь на полке или подоконнике постройки: касается её стен.</summary>
        private static bool Touches(Item shell, Item item) => Depth(shell, item, 0.08f) > 0f;

        private static float Depth(Item a, Item b, float inflate = 0f)
        {
            float best = 0f;
            foreach (Collider ca in a.Colliders)
            {
                foreach (Collider cb in b.Colliders)
                {
                    // Сетка против сетки физика не считает: нужна хотя бы одна оболочка.
                    if (!IsConvex(ca) && !IsConvex(cb)) continue;
                    if (inflate > 0f)
                    {
                        if (!ca.bounds.Intersects(Grow(cb.bounds, inflate))) continue;
                        best = Mathf.Max(best, 0.01f);
                        continue;
                    }
                    // Выпуклое тело идёт первым: сетку против оболочки физика считает только так.
                    bool swap = !IsConvex(ca);
                    Collider first = swap ? cb : ca, second = swap ? ca : cb;
                    if (Physics.ComputePenetration(first, first.transform.position, first.transform.rotation,
                            second, second.transform.position, second.transform.rotation, out Vector3 _, out float distance))
                        best = Mathf.Max(best, distance);
                }
            }
            return best;
        }

        /// <summary>Площадь вещи в плане в её собственных осях (без раздувания поворотом).</summary>
        private static float OwnArea(Transform root, IEnumerable<Renderer> renderers)
        {
            Bounds result = default;
            bool any = false;
            foreach (Renderer renderer in renderers)
            {
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                Bounds local = filter != null && filter.sharedMesh != null ? filter.sharedMesh.bounds : renderer.localBounds;
                Matrix4x4 toRoot = root.worldToLocalMatrix * renderer.transform.localToWorldMatrix;
                for (int i = 0; i < 8; i++)
                {
                    Vector3 corner = toRoot.MultiplyPoint3x4(new Vector3(
                        (i & 1) == 0 ? local.min.x : local.max.x,
                        (i & 2) == 0 ? local.min.y : local.max.y,
                        (i & 4) == 0 ? local.min.z : local.max.z));
                    if (!any) { result = new Bounds(corner, Vector3.zero); any = true; }
                    else result.Encapsulate(corner);
                }
            }
            return result.size.x * result.size.z;
        }

        private static bool IsConvex(Collider collider) => !(collider is MeshCollider mesh) || mesh.convex;

        private static Bounds Grow(Bounds bounds, float by)
        {
            bounds.Expand(by * 2f);
            return bounds;
        }
    }
}
#endif
