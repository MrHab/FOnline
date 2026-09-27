using System;
using System.Collections.Generic;
using System.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Снимает с вершин каждой модели оружия места для рук и пишет их в
    /// Resources/RealmOfAshes/HoldAnchors.asset (см. RoaHoldAnchors). Меши пака в
    /// сборке нечитаемы, а в редакторе вершины доступны, поэтому замер — здесь.
    /// Повторный запуск на тех же моделях даёт тот же файл.
    /// </summary>
    public static class RoaHoldAnchorBaker
    {
        private const string AssetPath = "Assets/Resources/RealmOfAshes/HoldAnchors.asset";

        [MenuItem("Realm of Ashes/Animation/Bake hold anchors")]
        public static void Bake()
        {
            var anchors = AssetDatabase.LoadAssetAtPath<RoaHoldAnchors>(AssetPath);
            if (anchors == null)
            {
                anchors = ScriptableObject.CreateInstance<RoaHoldAnchors>();
                AssetDatabase.CreateAsset(anchors, AssetPath);
            }
            anchors.Entries.Clear();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            IReadOnlyList<RoaApocalypseModels.WeaponEntry> weapons = LoadWeapons();
            foreach (RoaApocalypseModels.WeaponEntry weapon in weapons.OrderBy(row => row.prefab != null ? row.prefab.name : string.Empty, StringComparer.Ordinal))
            {
                if (weapon?.prefab == null || !seen.Add(weapon.prefab.name)) continue;
                bool firearm = !RoaMeleeGrip.IsMelee(weapon.rigId);
                RoaHoldAnchors.Entry entry = Measure(weapon.prefab, firearm);
                if (entry != null) anchors.Entries.Add(entry);
            }
            anchors.ResetCache();
            EditorUtility.SetDirty(anchors);
            AssetDatabase.SaveAssets();
            Debug.Log("[HOLD ANCHORS] baked " + anchors.Entries.Count + " models into " + AssetPath);
        }

        public static void BakeBatch()
        {
            try { Bake(); EditorApplication.Exit(0); }
            catch (Exception error) { Debug.LogError("[HOLD ANCHORS] FAIL: " + error); EditorApplication.Exit(1); }
        }

        private static IReadOnlyList<RoaApocalypseModels.WeaponEntry> LoadWeapons()
        {
            var palette = AssetDatabase.LoadAssetAtPath<RoaApocalypseModels>(
                "Assets/Resources/RealmOfAshes/PolygonApocalypseModels.asset");
            if (palette == null || palette.EditorWeapons == null || palette.EditorWeapons.Count == 0)
                throw new InvalidOperationException("PolygonApocalypseModels.asset has no weapons");
            return palette.EditorWeapons;
        }

        private struct Part
        {
            public string Name;
            public List<Vector3> Points;
            public int[] Triangles;
        }

        private static bool ActiveUnder(Transform node, Transform root)
        {
            for (Transform t = node; t != null; t = t.parent)
            {
                if (!t.gameObject.activeSelf) return false;
                if (t == root) return true;
            }
            return true;
        }

        private static List<Part> Parts(GameObject prefab)
        {
            var parts = new List<Part>();
            Matrix4x4 toRoot = prefab.transform.worldToLocalMatrix;
            foreach (Renderer renderer in prefab.GetComponentsInChildren<Renderer>(true))
            {
                // У ассета префаба activeInHierarchy всегда false: смотрим activeSelf по цепочке.
                if (!renderer.enabled || !ActiveUnder(renderer.transform, prefab.transform)) continue;
                Mesh mesh = null;
                if (renderer is SkinnedMeshRenderer skinned) mesh = skinned.sharedMesh;
                else if (renderer.TryGetComponent(out MeshFilter filter)) mesh = filter.sharedMesh;
                if (mesh == null) continue;
                Matrix4x4 matrix = toRoot * renderer.transform.localToWorldMatrix;
                var points = new List<Vector3>(mesh.vertexCount);
                foreach (Vector3 vertex in mesh.vertices) points.Add(matrix.MultiplyPoint3x4(vertex));
                parts.Add(new Part { Name = renderer.name, Points = points, Triangles = mesh.triangles });
            }
            return parts;
        }

        /// <summary>
        /// Точки пересечения рёбер треугольников с плоскостью axis = value. У
        /// низкополигональной модели вершин в тонком срезе почти нет, а сечение
        /// по рёбрам даёт настоящий контур.
        /// </summary>
        private static List<Vector3> Slice(IEnumerable<Part> parts, int axis, float value)
        {
            var result = new List<Vector3>();
            foreach (Part part in parts)
            {
                List<Vector3> v = part.Points;
                int[] t = part.Triangles;
                for (int i = 0; i + 2 < t.Length; i += 3)
                {
                    Edge(v[t[i]], v[t[i + 1]], axis, value, result);
                    Edge(v[t[i + 1]], v[t[i + 2]], axis, value, result);
                    Edge(v[t[i + 2]], v[t[i]], axis, value, result);
                }
            }
            return result;
        }

        private static void Edge(Vector3 a, Vector3 b, int axis, float value, List<Vector3> output)
        {
            float da = a[axis] - value, db = b[axis] - value;
            if ((da > 0f && db > 0f) || (da < 0f && db < 0f) || Mathf.Approximately(da, db)) return;
            output.Add(Vector3.Lerp(a, b, da / (da - db)));
        }

        private static RoaHoldAnchors.Entry Measure(GameObject prefab, bool firearm)
        {
            List<Part> parts = Parts(prefab);
            List<Vector3> all = parts.SelectMany(part => part.Points).ToList();
            if (all.Count == 0) return null;
            var entry = new RoaHoldAnchors.Entry { prefab = prefab.name, firearm = firearm };
            entry.min = new Vector3(all.Min(p => p.x), all.Min(p => p.y), all.Min(p => p.z));
            entry.max = new Vector3(all.Max(p => p.x), all.Max(p => p.y), all.Max(p => p.z));
            if (firearm) MeasureFirearm(entry, parts);
            else MeasureMelee(entry, parts);
            return entry;
        }

        private static bool Named(Part part, string word) =>
            part.Name.IndexOf(word, StringComparison.OrdinalIgnoreCase) >= 0;

        private static Vector3 Centre(IEnumerable<Vector3> points)
        {
            Vector3 min = Vector3.positiveInfinity, max = Vector3.negativeInfinity;
            foreach (Vector3 p in points) { min = Vector3.Min(min, p); max = Vector3.Max(max, p); }
            return (min + max) * 0.5f;
        }

        private static void MeasureFirearm(RoaHoldAnchors.Entry entry, List<Part> parts)
        {
            Vector3 size = entry.max - entry.min;
            Part trigger = parts.FirstOrDefault(part => Named(part, "Trigger"));
            entry.trigger = trigger.Points != null ? Centre(trigger.Points)
                : new Vector3((entry.min.x + entry.max.x) * 0.5f, entry.min.y + size.y * 0.55f, entry.min.z + size.z * 0.38f);
            Part magazine = parts.FirstOrDefault(part => Named(part, "Magazine"));
            entry.hasMagazine = magazine.Points != null;
            if (entry.hasMagazine) entry.magazineCentre = Centre(magazine.Points);
            Part handle = parts.FirstOrDefault(part => Named(part, "Handle"));
            entry.hasHandle = handle.Points != null;
            if (entry.hasHandle)
            {
                Vector3 hmin = Vector3.positiveInfinity, hmax = Vector3.negativeInfinity;
                foreach (Vector3 p in handle.Points) { hmin = Vector3.Min(hmin, p); hmax = Vector3.Max(hmax, p); }
                entry.handleCentre = (hmin + hmax) * 0.5f;
                entry.handleSize = hmax - hmin;
            }

            // Корпус без магазина, спуска и снарядов: по нему ищутся рукоять и цевьё.
            List<Part> body = parts.Where(part => !Named(part, "Magazine") && !Named(part, "Trigger")
                && !Named(part, "Missile") && !Named(part, "Arrow") && !Named(part, "Quiver")
                && !Named(part, "Fireworks")).ToList();
            if (body.Count == 0) body = parts;

            MeasurePistolGrip(entry, body);

            // Затыльник: сечение в сантиметре от заднего края.
            List<Vector3> rear = Slice(body, 2, entry.min.z + 0.01f);
            if (rear.Count > 1)
            {
                Vector3 c = Centre(rear);
                entry.butt = new Vector3(c.x, c.y, entry.min.z);
                entry.buttHeight = rear.Max(p => p.y) - rear.Min(p => p.y);
            }
            List<Vector3> front = Slice(parts, 2, entry.max.z - 0.01f);
            Vector3 muzzle = front.Count > 1 ? Centre(front) : new Vector3(entry.trigger.x, entry.trigger.y + 0.04f, entry.max.z);
            entry.muzzle = new Vector3(muzzle.x, muzzle.y, entry.max.z);
            entry.bore = new Vector2(muzzle.x, muzzle.y);

            var under = new List<Vector4>();
            var top = new List<float>();
            for (float z = entry.trigger.z + 0.04f; z < entry.max.z - 0.01f; z += 0.02f)
            {
                List<Vector3> slice = Slice(body, 2, z);
                if (slice.Count < 2) continue;
                float minX = slice.Min(p => p.x), maxX = slice.Max(p => p.x);
                under.Add(new Vector4((minX + maxX) * 0.5f, slice.Min(p => p.y), z, (maxX - minX) * 0.5f));
                top.Add(slice.Max(p => p.y));
            }
            entry.underside = under.ToArray();
            entry.top = top.ToArray();
        }

        private static void MeasurePistolGrip(RoaHoldAnchors.Entry entry, List<Part> body)
        {
            Vector3 t = entry.trigger;
            // Рукоять — столбик под спуском и позади него. Горизонтальное сечение
            // режется на куски по разрывам: скоба и магазин не сливаются с рукоятью.
            var centres = new List<Vector3>();
            float halfX = 0f, halfZ = 0f;
            float expected = t.z - 0.035f;
            for (float y = t.y - 0.02f; y > t.y - 0.17f; y -= 0.01f)
            {
                List<Vector3> slice = Slice(body, 1, y).Where(p => Mathf.Abs(p.x - t.x) < 0.05f
                    && p.z > t.z - 0.17f && p.z < t.z + 0.03f).ToList();
                // Верхние срезы ещё идут по коробке во всю длину: рукоять начинается ниже.
                if (slice.Count < 3) { if (centres.Count == 0) continue; break; }
                List<float> zs = slice.Select(p => p.z).OrderBy(z => z).ToList();
                float bestLo = 0f, bestHi = 0f, bestScore = float.MaxValue;
                float lo = zs[0], hi = zs[0];
                for (int i = 1; i <= zs.Count; i++)
                {
                    if (i < zs.Count && zs[i] - hi <= 0.012f) { hi = zs[i]; continue; }
                    float score = Mathf.Abs((lo + hi) * 0.5f - expected);
                    if (hi - lo < 0.09f && hi - lo > 0.01f && score < bestScore) { bestScore = score; bestLo = lo; bestHi = hi; }
                    if (i < zs.Count) lo = hi = zs[i];
                }
                if (bestScore > 0.04f) { if (centres.Count == 0 && y > t.y - 0.07f) continue; break; }
                float cz = (bestLo + bestHi) * 0.5f;
                List<Vector3> blob = slice.Where(p => p.z >= bestLo - 0.001f && p.z <= bestHi + 0.001f).ToList();
                float minX = blob.Min(p => p.x), maxX = blob.Max(p => p.x);
                var centre = new Vector3((minX + maxX) * 0.5f, y, cz);
                if (centres.Count > 0 && Mathf.Abs(centre.z - centres[centres.Count - 1].z) > 0.02f) break;
                centres.Add(centre);
                expected = cz;
                halfX += (maxX - minX) * 0.5f;
                halfZ += (bestHi - bestLo) * 0.5f;
                if (centres.Count >= 13) break;
            }
            int levels = centres.Count;
            entry.gripMeasured = levels >= 4;
            if (entry.gripMeasured)
            {
                entry.gripTop = centres[0];
                entry.gripBottom = centres[levels - 1];
                entry.gripRadius = Mathf.Clamp((halfX + halfZ) / (2f * levels), 0.009f, 0.03f);
            }
            else
            {
                entry.gripTop = t + new Vector3(0f, -0.02f, -0.035f);
                entry.gripBottom = t + new Vector3(0f, -0.10f, -0.06f);
                entry.gripRadius = 0.016f;
            }
        }

        // Модели, у которых рукоять не на узком конце: клинок уже гарды или
        // рукояти, поэтому конец задан вручную (+1 — боёк на +оси, −1 — на −оси).
        private static readonly Dictionary<string, int> HeadEndOverride = new Dictionary<string, int>(StringComparer.Ordinal)
        {
        };

        private static void MeasureMelee(RoaHoldAnchors.Entry entry, List<Part> parts)
        {
            Vector3 size = entry.max - entry.min;
            int axis = size.x >= size.y && size.x >= size.z ? 0 : (size.y >= size.z ? 1 : 2);
            entry.longAxis = axis;
            float lo = entry.min[axis], hi = entry.max[axis];
            var widths = new List<float>();
            var centres = new List<Vector3>();
            for (float s = lo + 0.005f; s < hi; s += 0.01f)
            {
                List<Vector3> slice = Slice(parts, axis, s);
                if (slice.Count < 2) { widths.Add(-1f); centres.Add(Vector3.zero); continue; }
                Vector3 smin = Vector3.positiveInfinity, smax = Vector3.negativeInfinity;
                foreach (Vector3 p in slice) { smin = Vector3.Min(smin, p); smax = Vector3.Max(smax, p); }
                Vector3 extent = smax - smin;
                extent[axis] = 0f;
                widths.Add(Mathf.Max(extent.x, Mathf.Max(extent.y, extent.z)));
                Vector3 c = (smin + smax) * 0.5f;
                c[axis] = s;
                centres.Add(c);
            }
            int n = widths.Count;
            int edge = Mathf.Max(2, n / 5);
            float EndWidth(IEnumerable<float> run) { float m = 0f; foreach (float w in run) m = Mathf.Max(m, w); return m; }
            float lowEnd = EndWidth(widths.Take(edge)), highEnd = EndWidth(widths.Skip(n - edge));
            int headSign = highEnd >= lowEnd ? 1 : -1;
            if (HeadEndOverride.TryGetValue(entry.prefab, out int forced)) headSign = forced;
            entry.widths = widths.ToArray();
            // От торца рукояти к бойку.
            var order = Enumerable.Range(0, n).ToList();
            if (headSign < 0) order.Reverse();
            var handle = order.Take(Mathf.Max(3, n * 15 / 100)).Select(i => widths[i]).Where(w => w > 0f).OrderBy(w => w).ToList();
            float handleWidth = handle.Count > 0 ? handle[handle.Count / 2] : 0.035f;
            float limit = Mathf.Max(0.045f, handleWidth * 1.7f);
            int first = order.First(i => widths[i] > 0f);
            int last = first;
            foreach (int i in order)
            {
                if (widths[i] < 0f) continue;
                if (widths[i] > limit) break;
                last = i;
            }
            entry.haftBottom = centres[first];
            entry.haftTop = centres[last];
            entry.haftRadius = Mathf.Clamp(handleWidth * 0.5f, 0.01f, 0.028f);
            float top = entry.haftTop[axis];
            List<Vector3> head = parts.SelectMany(part => part.Points)
                .Where(p => headSign > 0 ? p[axis] > top : p[axis] < top).ToList();
            entry.headCentre = head.Count > 0 ? Centre(head) : entry.haftTop;
            Vector3 along = entry.haftTop - entry.haftBottom;
            Vector3 dir = along.sqrMagnitude > 1e-6f ? along.normalized : Vector3.forward;
            Vector3 side = entry.headCentre - entry.haftTop;
            side -= dir * Vector3.Dot(side, dir);
            entry.headSide = side.magnitude > 0.02f ? side.normalized : Vector3.zero;
        }
    }
}
