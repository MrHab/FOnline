#if UNITY_EDITOR
using System.Collections.Generic;
using RealmOfAshes.Game;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Где на префабе пака лежит метка тира (RoaTierMark). Считается по треугольникам в
    /// редакторе и хранится в палитре: в сборке вершины моделей пака не читаются.
    ///   * вытянутый предмет — изолента поперёк самой тонкой части в середине длины;
    ///   * ствол, бочка, пучок стеблей — обмотка вплотную к узкому месту у основания;
    ///   * плоский предмет (лист, ткань) — пятно краски на широкой грани;
    ///   * остальное (камень, пень, мешок, шлем) — пятно краски сверху.
    /// Пятно ставится лучом на саму поверхность и ложится по её нормали, поэтому не висит
    /// в воздухе. Сечения берутся плоскостью по рёбрам треугольников: у low-poly моделей
    /// вершины бывают только на концах, и выборка вершин середины пуста.
    /// </summary>
    public static class RoaTierMarkLayout
    {
        private sealed class Shape
        {
            public readonly List<Vector3> Vertices = new List<Vector3>();
            public readonly List<int> Triangles = new List<int>();
            public Bounds Bounds;
        }

        public static RoaTierMarkPlacement Compute(GameObject prefab, bool node)
        {
            var placement = new RoaTierMarkPlacement();
            Shape shape = Read(prefab);
            if (shape.Triangles.Count < 3) return placement;
            Bounds bounds = shape.Bounds;
            Vector3 size = bounds.size;

            if (node)
            {
                // Ствол или горловина пучка — обмотка у основания; бочка, колонка — пояс
                // краски на корпусе; приземистое (камень, пень, куст) — пятно сверху.
                if (TrunkLike(shape, out RoaTierMarkPlacement trunk)) return trunk;
                if (size.y >= 1.2f * Mathf.Max(size.x, size.z)) return Band(shape, 0.4f, 0.4f, out _);
                return Dab(shape, 1, Mathf.Clamp(0.3f * Mathf.Min(size.x, size.z), 0.12f, 0.5f));
            }

            int[] axes = { 0, 1, 2 };
            System.Array.Sort(axes, (a, b) => size[b].CompareTo(size[a]));
            int along = axes[0];
            float length = size[along];
            float width = Mathf.Max(size[axes[1]], 0.001f);
            // Пучок травы — обвязка у основания; бутылка, бочонок — обмотка по корпусу.
            if (TrunkLike(shape, out RoaTierMarkPlacement tie)) return tie;
            if (along == 1 && length >= 1.3f * width) return Band(shape, 0.4f, 0.4f, out _);
            // Плоское и лежачее (ковёр, лист железа): изолента только на рейке, иначе пятно.
            bool flatLying = size.y < 0.2f * width;
            if (length >= (flatLying ? 4f : 1.8f) * width)
                return Tape(shape, along, axes);
            float patch = Mathf.Clamp(0.3f * width, 0.03f, 0.3f);
            int thin = axes[2];
            // Стоячий лист (жесть, полотно) — сквозная нашивка: видна с обеих сторон.
            if (thin != 1 && size[thin] < 0.3f * width) return Patch(shape, thin, patch);
            return Dab(shape, 1, patch);
        }

        /// <summary>
        /// Ствол или пучок: узкое место у основания, и модель либо стоячая, либо узка и
        /// на трети высоты. Суженное днище камня или лежачего свёртка стволом не считается.
        /// </summary>
        private static bool TrunkLike(Shape shape, out RoaTierMarkPlacement band)
        {
            Vector3 size = shape.Bounds.size;
            float footprint = Mathf.Max(size.x * size.z, 0.0001f);
            band = Band(shape, 0.04f, 0.19f, out float area);
            if (!band.valid || area >= 0.3f * footprint) return false;
            // Пучок стеблей сходится в точку; у пня с корнями сужение слабее.
            if (size.y >= 0.8f * Mathf.Max(size.x, size.z) && area < 0.15f * footprint) return true;
            Band(shape, 0.3f, 0.3f, out float upper);
            return upper < 0.3f * footprint;
        }

        /// <summary>Обмотка по самому узкому горизонтальному сечению в долях высоты [from, to].</summary>
        private static RoaTierMarkPlacement Band(Shape shape, float from, float to, out float area)
        {
            Bounds bounds = shape.Bounds;
            float height = Mathf.Max(bounds.size.y, 0.05f);
            area = float.MaxValue;
            float bestAt = 0f;
            Bounds best = default;
            bool round = true;
            for (int step = 0; step <= 5; step++)
            {
                float at = bounds.min.y + Mathf.Lerp(from, to, step / 5f) * height;
                if (!Section(shape, 1, at, out Bounds section, out bool sectionRound)) continue;
                float sectionArea = Mathf.Max(section.size.x, 0.01f) * Mathf.Max(section.size.z, 0.01f);
                if (sectionArea < area) { area = sectionArea; bestAt = at; best = section; round = sectionRound; }
            }
            if (area == float.MaxValue) return new RoaTierMarkPlacement();
            float band = Mathf.Clamp(0.05f * height, 0.02f, 0.12f);
            float grow = round ? 1.06f : 1.04f;
            return new RoaTierMarkPlacement
            {
                valid = true,
                round = round,
                position = new Vector3(best.center.x, bestAt, best.center.z),
                scale = new Vector3(best.size.x * grow + 0.008f, band, best.size.z * grow + 0.008f)
            };
        }

        /// <summary>Изолента поперёк вытянутого предмета: где сечение между 30% и 70% длины самое тонкое.</summary>
        private static RoaTierMarkPlacement Tape(Shape shape, int along, int[] axes)
        {
            Bounds bounds = shape.Bounds;
            float length = bounds.size[along];
            float bestArea = float.MaxValue, bestAt = 0.5f;
            Bounds best = bounds;
            bool round = false, found = false;
            for (int step = 0; step <= 8; step++)
            {
                float at = 0.3f + 0.05f * step;
                if (!Section(shape, along, bounds.min[along] + at * length, out Bounds section, out bool sectionRound)) continue;
                float area = Mathf.Max(section.size[axes[1]], 0.002f) * Mathf.Max(section.size[axes[2]], 0.002f);
                if (area < bestArea) { bestArea = area; bestAt = at; best = section; round = sectionRound; found = true; }
            }
            if (!found) return new RoaTierMarkPlacement();
            float thickness = Mathf.Clamp(0.07f * length, 0.012f, 0.22f);
            Vector3 position = best.center;
            position[along] = bounds.min[along] + bestAt * length;
            Vector3 scale = best.size * 1.1f + Vector3.one * 0.005f;
            // Цилиндр метки стоит вдоль Y: повернуть его вдоль длины предмета.
            Quaternion rotation = Quaternion.identity;
            if (round && along != 1)
            {
                rotation = along == 0 ? Quaternion.Euler(0f, 0f, 90f) : Quaternion.Euler(90f, 0f, 0f);
                float first = along == 0 ? scale.y : scale.x, second = along == 0 ? scale.z : scale.y;
                scale = new Vector3(first, thickness, second);
            }
            else scale[along] = thickness;
            return new RoaTierMarkPlacement { valid = true, round = round, position = position, rotation = rotation, scale = scale };
        }

        /// <summary>Нашивка сквозь тонкий стоячий лист на середине высоты (брусок на всю толщину).</summary>
        private static RoaTierMarkPlacement Patch(Shape shape, int thin, float patch)
        {
            Bounds bounds = shape.Bounds;
            float at = bounds.min.y + 0.55f * bounds.size.y;
            if (!Section(shape, 1, at, out Bounds section, out _)) return new RoaTierMarkPlacement();
            Vector3 scale = Vector3.one * patch;
            scale[thin] = section.size[thin] + 0.01f;
            return new RoaTierMarkPlacement
            {
                valid = true,
                position = new Vector3(section.center.x, at, section.center.z),
                scale = scale
            };
        }

        /// <summary>
        /// Пятно краски: луч вдоль оси axis (сверху вниз или с «передней» стороны) бьёт по
        /// сетке точек у центра; выигрывает ближайшее попадание, пятно ложится по нормали.
        /// </summary>
        private static RoaTierMarkPlacement Dab(Shape shape, int axis, float patch)
        {
            Bounds bounds = shape.Bounds;
            Vector3 direction = Vector3.zero;
            direction[axis] = -1f;
            float bestDistance = float.MaxValue;
            Vector3 hitPoint = Vector3.zero, hitNormal = Vector3.up;
            // От центра к краям: первое кольцо с попаданием (центральное — лучшее).
            for (int ring = 0; ring <= 3 && bestDistance == float.MaxValue; ring++)
            {
                float reach = 0.12f * ring;
                for (int i = -ring; i <= ring; i++)
                    for (int j = -ring; j <= ring; j++)
                    {
                        if (ring > 0 && Mathf.Abs(i) != ring && Mathf.Abs(j) != ring) continue;
                        Vector3 origin = bounds.center;
                        int u = (axis + 1) % 3, v = (axis + 2) % 3;
                        origin[u] += ring == 0 ? 0f : i * reach / ring * bounds.size[u];
                        origin[v] += ring == 0 ? 0f : j * reach / ring * bounds.size[v];
                        origin[axis] = bounds.max[axis] + 0.1f;
                        if (Raycast(shape, origin, direction, out float distance, out Vector3 normal) && distance < bestDistance)
                        {
                            bestDistance = distance;
                            hitPoint = origin + direction * distance;
                            hitNormal = normal;
                        }
                    }
            }
            if (bestDistance == float.MaxValue) return new RoaTierMarkPlacement();
            if (Vector3.Dot(hitNormal, direction) > 0f) hitNormal = -hitNormal;
            float depth = Mathf.Max(0.006f, 0.1f * patch);
            return new RoaTierMarkPlacement
            {
                valid = true,
                round = true,
                // Утоплено на треть: края диска не торчат над изгибом поверхности.
                position = hitPoint + hitNormal * (depth * 0.2f),
                rotation = Quaternion.FromToRotation(Vector3.up, hitNormal),
                scale = new Vector3(patch, depth, patch)
            };
        }

        /// <summary>Ближайшее пересечение луча с треугольниками (Мёллер — Трумбор).</summary>
        private static bool Raycast(Shape shape, Vector3 origin, Vector3 direction, out float distance, out Vector3 normal)
        {
            distance = float.MaxValue;
            normal = Vector3.up;
            List<Vector3> v = shape.Vertices;
            List<int> t = shape.Triangles;
            for (int i = 0; i + 2 < t.Count; i += 3)
            {
                Vector3 a = v[t[i]], b = v[t[i + 1]], c = v[t[i + 2]];
                Vector3 ab = b - a, ac = c - a;
                Vector3 p = Vector3.Cross(direction, ac);
                float det = Vector3.Dot(ab, p);
                if (Mathf.Abs(det) < 1e-9f) continue;
                float inverse = 1f / det;
                Vector3 s = origin - a;
                float bu = Vector3.Dot(s, p) * inverse;
                if (bu < 0f || bu > 1f) continue;
                Vector3 q = Vector3.Cross(s, ab);
                float bv = Vector3.Dot(direction, q) * inverse;
                if (bv < 0f || bu + bv > 1f) continue;
                float d = Vector3.Dot(ac, q) * inverse;
                if (d <= 0f || d >= distance) continue;
                distance = d;
                normal = Vector3.Cross(ab, ac).normalized;
            }
            return distance < float.MaxValue;
        }

        /// <summary>
        /// Габариты сечения модели плоскостью axis = at (пересечения рёбер треугольников)
        /// и круглое ли оно: у прямоугольного точки доходят до углов габарита.
        /// </summary>
        private static bool Section(Shape shape, int axis, float at, out Bounds section, out bool round)
        {
            section = default;
            round = true;
            var points = new List<Vector3>();
            List<Vector3> v = shape.Vertices;
            List<int> t = shape.Triangles;
            for (int i = 0; i + 2 < t.Count; i += 3)
            {
                for (int e = 0; e < 3; e++)
                {
                    Vector3 a = v[t[i + e]], b = v[t[i + (e + 1) % 3]];
                    float da = a[axis] - at, db = b[axis] - at;
                    if ((da > 0f && db > 0f) || (da < 0f && db < 0f)) continue;
                    float span = a[axis] - b[axis];
                    Vector3 point = Mathf.Abs(span) < 1e-6f ? a : Vector3.Lerp(a, b, da / span);
                    if (points.Count == 0) section = new Bounds(point, Vector3.zero);
                    else section.Encapsulate(point);
                    points.Add(point);
                }
            }
            if (points.Count < 3) return false;
            int u = (axis + 1) % 3, w = (axis + 2) % 3;
            float halfU = Mathf.Max(section.extents[u], 1e-5f), halfW = Mathf.Max(section.extents[w], 1e-5f);
            float farthest = 0f;
            foreach (Vector3 point in points)
            {
                float du = (point[u] - section.center[u]) / halfU, dw = (point[w] - section.center[w]) / halfW;
                farthest = Mathf.Max(farthest, du * du + dw * dw);
            }
            // Круг вписан в габарит (≈1), у прямоугольника углы дают ≈2.
            round = farthest < 1.5f;
            return true;
        }

        /// <summary>Треугольники видимых мешей префаба (без дальних LOD) в координатах его корня.</summary>
        private static Shape Read(GameObject prefab)
        {
            var shape = new Shape();
            if (prefab == null) return shape;
            Matrix4x4 toRoot = prefab.transform.worldToLocalMatrix;
            var meshes = new List<(Mesh mesh, Matrix4x4 matrix)>();
            foreach (MeshFilter filter in prefab.GetComponentsInChildren<MeshFilter>(true))
            {
                if (filter.sharedMesh == null || !Visible(filter.transform, prefab.transform)) continue;
                MeshRenderer renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled) continue;
                meshes.Add((filter.sharedMesh, toRoot * filter.transform.localToWorldMatrix));
            }
            foreach (SkinnedMeshRenderer skinned in prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (skinned.sharedMesh == null || !skinned.enabled || !Visible(skinned.transform, prefab.transform)) continue;
                meshes.Add((skinned.sharedMesh, toRoot * skinned.transform.localToWorldMatrix));
            }
            bool first = true;
            foreach (var (mesh, matrix) in meshes)
            {
                int offset = shape.Vertices.Count;
                foreach (Vector3 vertex in mesh.vertices)
                {
                    Vector3 point = matrix.MultiplyPoint3x4(vertex);
                    shape.Vertices.Add(point);
                    if (first) { shape.Bounds = new Bounds(point, Vector3.zero); first = false; }
                    else shape.Bounds.Encapsulate(point);
                }
                int[] triangles = mesh.triangles;
                for (int i = 0; i + 2 < triangles.Length; i += 3)
                {
                    shape.Triangles.Add(offset + triangles[i]);
                    shape.Triangles.Add(offset + triangles[i + 1]);
                    shape.Triangles.Add(offset + triangles[i + 2]);
                }
            }
            return shape;
        }

        /// <summary>Узел активен по всей цепочке до корня и не дальний LOD.</summary>
        private static bool Visible(Transform node, Transform root)
        {
            for (Transform t = node; t != null; t = t.parent)
            {
                if (!t.gameObject.activeSelf) return false;
                string name = t.name;
                if (name.Contains("_LOD1") || name.Contains("_LOD2") || name.Contains("_LOD3")) return false;
                if (t == root) break;
            }
            return true;
        }
    }
}
#endif
