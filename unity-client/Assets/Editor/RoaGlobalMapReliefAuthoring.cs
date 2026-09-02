#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Автоматический генератор рельефа глобальной карты.
    ///
    /// Детерминированно строит поле высот из авторских данных
    /// data/global-map.json: холмы по биомам клеток (rocky_hills — хребты,
    /// green_lowland — пологие волны, dry_lake — котловины), впадина воды,
    /// выровненные коридоры дорог и площадки узлов. Затем:
    ///  1. заменяет меши девяти GroundTile_X_Y на сетки с высотами
    ///     (ассеты GM_Mesh_Relief_X_Y — переиспользуются, GUID стабилен);
    ///  2. пересаживает декорации сцены на новую поверхность по дельте
    ///     «старый рельеф → новый» (повторный запуск идемпотентен);
    ///  3. записывает поле в Resources (RoaGlobalMapRelief) — рантайм сажает
    ///     маркеры, отряды и подписи на рельеф через PointToWorld.
    ///
    /// Сцену инструмент не сохраняет: художник просматривает результат и
    /// сохраняет сам. «Разгладить» возвращает плоскость той же процедурой
    /// с нулевым полем.
    /// </summary>
    public static class RoaGlobalMapReliefAuthoring
    {
        private const int Seed = 20260901;
        private const int FieldSamples = 181;
        private const int TileQuads = 60;
        private const string MeshFolder = "Assets/Art/GlobalMap/Meshes";
        private const string ReliefAssetPath =
            "Assets/Resources/RealmOfAshes/GlobalMapRelief.asset";

        [MenuItem("Realm of Ashes/Авторинг/Сгенерировать рельеф глобальной карты")]
        public static void Generate()
        {
            Apply(BuildField(null));
        }

        [MenuItem("Realm of Ashes/Авторинг/Разгладить рельеф глобальной карты")]
        public static void Flatten()
        {
            Apply(ReliefField.Flat(FieldSamples, MapWidthPoints, MapHeightPoints));
        }

        /// <summary>
        /// Вход для генератора окружения: пересобрать рельеф с врезанными
        /// руслами рек и вернуть применённое поле.
        /// </summary>
        internal static ReliefField GenerateWithCarves(
            IReadOnlyList<RiverCarve> carves)
        {
            ReliefField field = BuildField(carves);
            Apply(field);
            return field;
        }

        /// <summary>Построить поле без применения — для трассировки рек.</summary>
        internal static ReliefField PreviewField()
        {
            return BuildField(null);
        }

        /// <summary>Врезка русла: точка пути, ширина и глубина в пунктах карты.</summary>
        internal struct RiverCarve
        {
            public Vector2 At;
            public float Radius;
            public float Depth;
        }

        // ------------------------------------------------------------------
        // Поле высот из авторских данных.

        private static float MapWidthPoints = 900f;
        private static float MapHeightPoints = 900f;

        /// <summary>Дискретное поле с билинейной выборкой — как в рантайм-ассете.</summary>
        internal sealed class ReliefField
        {
            public int Samples;
            public float WidthPoints;
            public float HeightPoints;
            public float[] Heights;

            public static ReliefField Flat(int samples, float width, float height)
            {
                return new ReliefField
                {
                    Samples = samples,
                    WidthPoints = width,
                    HeightPoints = height,
                    Heights = new float[samples * samples]
                };
            }

            public float HeightAt(float px, float py)
            {
                float u = Mathf.Clamp01(px / WidthPoints) * (Samples - 1);
                float v = Mathf.Clamp01(py / HeightPoints) * (Samples - 1);
                int x0 = Mathf.Clamp(Mathf.FloorToInt(u), 0, Samples - 2);
                int y0 = Mathf.Clamp(Mathf.FloorToInt(v), 0, Samples - 2);
                float fx = u - x0, fy = v - y0;
                float a = Heights[y0 * Samples + x0];
                float b = Heights[y0 * Samples + x0 + 1];
                float c = Heights[(y0 + 1) * Samples + x0];
                float d = Heights[(y0 + 1) * Samples + x0 + 1];
                return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
            }
        }

        /// <summary>Клетки воды в координатах клеток — для трассировки рек.</summary>
        internal static bool CellIsWater(JObject map, int cx, int cy)
        {
            return string.Equals(
                (map["cells"] as JObject)?[cx + ":" + cy]?["texture"]?.ToString(),
                "water", StringComparison.Ordinal);
        }

        internal static JObject LoadMapJson()
        {
            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName
                ?? Application.dataPath;
            string dataPath = Path.GetFullPath(Path.Combine(projectRoot, "..",
                "data", "global-map.json"));
            return JObject.Parse(File.ReadAllText(dataPath));
        }

        private static ReliefField BuildField(IReadOnlyList<RiverCarve> carves)
        {
            JObject map = LoadMapJson();
            JObject grid = map["grid"] as JObject ?? new JObject();
            int cols = grid["cols"]?.ToObject<int>() ?? 30;
            int rows = grid["rows"]?.ToObject<int>() ?? 30;
            float cellPoints = grid["cellPoints"]?.ToObject<float>() ?? 30f;
            MapWidthPoints = cols * cellPoints;
            MapHeightPoints = rows * cellPoints;

            // Амплитуда и знак по биому клетки: где пустошь холмится, а где нет.
            var amplitude = new float[cols * rows];
            var rocky = new float[cols * rows];
            var water = new float[cols * rows];
            JObject cells = map["cells"] as JObject ?? new JObject();
            for (int cy = 0; cy < rows; cy++)
            {
                for (int cx = 0; cx < cols; cx++)
                {
                    string texture = cells[cx + ":" + cy]?["texture"]?.ToString()
                        ?? "dry_lake";
                    int index = cy * cols + cx;
                    switch (texture)
                    {
                        case "water": water[index] = 1f; break;
                        // Скальный биом — настоящий горный: земля сама
                        // поднимается в хребет, а генератор окружения плотно
                        // застраивает гребни пиками.
                        case "rocky_hills": amplitude[index] = 1.35f; rocky[index] = 1f; break;
                        case "scrap_field": amplitude[index] = 0.30f; break;
                        case "green_lowland": amplitude[index] = 0.16f; break;
                        case "old_road": amplitude[index] = 0.07f; break;
                        default: amplitude[index] = 0.11f; break; // dry_lake и прочее
                    }
                }
            }

            // Выровненные места: дорожные коридоры и площадки узлов/ориентиров.
            var flattenSegments = new List<(Vector2 a, Vector2 b, float radius)>();
            foreach (JToken token in map["infrastructure"] as JArray ?? new JArray())
            {
                JArray points = token?["points"] as JArray;
                if (points == null || points.Count < 2) continue;
                float width = token["width"]?.ToObject<float>() ?? 8f;
                for (int i = 1; i < points.Count; i++)
                {
                    flattenSegments.Add((
                        new Vector2(points[i - 1]["x"]?.ToObject<float>() ?? 0f,
                                    points[i - 1]["y"]?.ToObject<float>() ?? 0f),
                        new Vector2(points[i]["x"]?.ToObject<float>() ?? 0f,
                                    points[i]["y"]?.ToObject<float>() ?? 0f),
                        width * 0.5f + 12f));
                }
            }
            var flattenSpots = new List<(Vector2 at, float radius)>();
            foreach (JToken token in map["nodes"] as JArray ?? new JArray())
                flattenSpots.Add((ReadPoint(token), 52f));
            foreach (JToken token in map["objects"] as JArray ?? new JArray())
                flattenSpots.Add((ReadPoint(token), 30f));

            ReliefField field = ReliefField.Flat(FieldSamples,
                MapWidthPoints, MapHeightPoints);
            for (int sy = 0; sy < FieldSamples; sy++)
            {
                for (int sx = 0; sx < FieldSamples; sx++)
                {
                    float px = sx / (float)(FieldSamples - 1) * MapWidthPoints;
                    float py = sy / (float)(FieldSamples - 1) * MapHeightPoints;
                    float cellAmplitude = SampleCells(amplitude, cols, rows,
                        cellPoints, px, py);
                    float rockyWeight = SampleCells(rocky, cols, rows, cellPoints, px, py);
                    float waterWeight = SampleCells(water, cols, rows, cellPoints, px, py);

                    float smooth = Fbm(px / 165f, py / 165f, 4);
                    float ridge = 1f - Mathf.Abs(Fbm(px / 210f + 37.2f,
                        py / 210f - 11.7f, 4) * 2f - 1f);
                    float noise = Mathf.Lerp(smooth, ridge * ridge, rockyWeight);
                    float height = cellAmplitude * (0.22f + 0.78f * noise);

                    float flatten = 1f;
                    for (int i = 0; i < flattenSpots.Count; i++)
                    {
                        float distance = Vector2.Distance(
                            new Vector2(px, py), flattenSpots[i].at);
                        flatten = Mathf.Min(flatten, Mathf.SmoothStep(0f, 1f,
                            Mathf.Clamp01((distance - flattenSpots[i].radius * 0.55f)
                                / (flattenSpots[i].radius * 0.45f))));
                    }
                    for (int i = 0; i < flattenSegments.Count; i++)
                    {
                        float distance = DistanceToSegment(new Vector2(px, py),
                            flattenSegments[i].a, flattenSegments[i].b);
                        float radius = flattenSegments[i].radius;
                        flatten = Mathf.Min(flatten, Mathf.SmoothStep(0f, 1f,
                            Mathf.Clamp01((distance - radius) / (radius * 1.2f))));
                    }
                    height *= flatten;

                    // Вода — пологая впадина; берег сходит к нулю сам за счёт
                    // билинейной выборки веса клеток.
                    height = Mathf.Lerp(height, -0.34f, waterWeight);

                    // Русла рек: врезка генератора окружения. Максимум, а не
                    // сумма — перекрывающиеся точки пути не копают втройне.
                    if (carves != null)
                    {
                        float cut = 0f;
                        for (int i = 0; i < carves.Count; i++)
                        {
                            float distance = Vector2.Distance(
                                new Vector2(px, py), carves[i].At);
                            if (distance >= carves[i].Radius) continue;
                            cut = Mathf.Max(cut, carves[i].Depth * Mathf.SmoothStep(
                                1f, 0f, distance / carves[i].Radius));
                        }
                        height -= cut;
                    }

                    // Рельеф гаснет к границам карты: кромка диорамы
                    // сходится с губой горизонт-террейна без обрыва — шов
                    // мира не читается резкой линией.
                    float edgeFade = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(
                        Mathf.Min(Mathf.Min(px, field.WidthPoints - px),
                            Mathf.Min(py, field.HeightPoints - py)) / 70f));
                    field.Heights[sy * FieldSamples + sx] =
                        Mathf.Clamp(height * edgeFade, -0.5f, 1.45f);
                }
            }
            return field;
        }

        private static Vector2 ReadPoint(JToken token)
        {
            return new Vector2(token?["x"]?.ToObject<float>() ?? 0f,
                               token?["y"]?.ToObject<float>() ?? 0f);
        }

        private static float SampleCells(float[] values, int cols, int rows,
                                         float cellPoints, float px, float py)
        {
            float u = px / cellPoints - 0.5f;
            float v = py / cellPoints - 0.5f;
            int x0 = Mathf.Clamp(Mathf.FloorToInt(u), 0, cols - 2);
            int y0 = Mathf.Clamp(Mathf.FloorToInt(v), 0, rows - 2);
            float fx = Mathf.Clamp01(u - x0);
            float fy = Mathf.Clamp01(v - y0);
            float a = values[y0 * cols + x0];
            float b = values[y0 * cols + x0 + 1];
            float c = values[(y0 + 1) * cols + x0];
            float d = values[(y0 + 1) * cols + x0 + 1];
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }

        private static float DistanceToSegment(Vector2 point, Vector2 a, Vector2 b)
        {
            Vector2 ab = b - a;
            float t = Mathf.Clamp01(Vector2.Dot(point - a, ab)
                / Mathf.Max(0.0001f, ab.sqrMagnitude));
            return Vector2.Distance(point, a + ab * t);
        }

        // Детерминированный value-noise: без UnityEngine.Random, один seed.
        private static float Hash01(int x, int y)
        {
            unchecked
            {
                int h = x * 374761393 + y * 668265263 + Seed * 1442695041;
                h = (h ^ (h >> 13)) * 1274126177;
                return ((h ^ (h >> 16)) & 0x7fffffff) / (float)int.MaxValue;
            }
        }

        private static float ValueNoise(float x, float y)
        {
            int x0 = Mathf.FloorToInt(x), y0 = Mathf.FloorToInt(y);
            float fx = x - x0, fy = y - y0;
            fx = fx * fx * fx * (fx * (fx * 6f - 15f) + 10f);
            fy = fy * fy * fy * (fy * (fy * 6f - 15f) + 10f);
            float a = Hash01(x0, y0), b = Hash01(x0 + 1, y0);
            float c = Hash01(x0, y0 + 1), d = Hash01(x0 + 1, y0 + 1);
            return Mathf.Lerp(Mathf.Lerp(a, b, fx), Mathf.Lerp(c, d, fx), fy);
        }

        private static float Fbm(float x, float y, int octaves)
        {
            float sum = 0f, gain = 0.5f, frequency = 1f, total = 0f;
            for (int i = 0; i < octaves; i++)
            {
                sum += ValueNoise(x * frequency + i * 19.7f,
                    y * frequency - i * 7.3f) * gain;
                total += gain;
                frequency *= 2.02f;
                gain *= 0.5f;
            }
            return sum / Mathf.Max(0.0001f, total);
        }

        // ------------------------------------------------------------------
        // Применение поля к сцене, ассетам мешей и рантайм-ассету.

        private static void Apply(ReliefField field)
        {
            RoaUnityGlobalMapScene marker = FindLoadedMarker()
                ?? throw new InvalidOperationException(
                    "Сцена GlobalMapAuthored не загружена в редакторе.");
            Transform staticRoot = marker.StaticContentRoot
                ?? throw new InvalidOperationException("StaticContentRoot отсутствует.");

            ReliefField previous = LoadPreviousField();
            // Тайлы ищутся по всей сцене: контейнер земли лежит в корне сцены,
            // а не под маркером. Декорации — только из StaticContentRoot.
            int tiles = 0;
            foreach (GameObject sceneRoot in marker.gameObject.scene.GetRootGameObjects())
                tiles += RebuildGroundTiles(sceneRoot.transform, field);
            int props = ReseatProps(staticRoot, previous, field);
            SaveRuntimeAsset(field);

            UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(
                marker.gameObject.scene);
            Debug.Log("[РЕЛЬЕФ] тайлов пересобрано: " + tiles
                + ", декораций пересажено: " + props
                + ". Сцена изменена — проверьте вид и сохраните её сами.");
        }

        private static ReliefField LoadPreviousField()
        {
            var asset = AssetDatabase.LoadAssetAtPath<RoaGlobalMapRelief>(ReliefAssetPath);
            if (asset == null || !asset.Ready)
                return ReliefField.Flat(2, MapWidthPoints, MapHeightPoints);
            return new ReliefField
            {
                Samples = asset.SamplesX,
                WidthPoints = asset.WidthPoints,
                HeightPoints = asset.HeightPoints,
                Heights = (float[])asset.Heights.Clone()
            };
        }

        private static int RebuildGroundTiles(Transform staticRoot, ReliefField field)
        {
            var pattern = new Regex("^GroundTile_(\\d+)_(\\d+)$");
            int rebuilt = 0;
            foreach (Transform child in staticRoot.GetComponentsInChildren<Transform>(true))
            {
                if (child == null || !pattern.IsMatch(child.name)) continue;
                // Меш может лежать на дочернем объекте префаба тайла.
                MeshFilter filter = child.GetComponentInChildren<MeshFilter>(true);
                if (filter == null) continue;

                Vector3 scale = filter.transform.lossyScale;
                Vector3 origin = filter.transform.position;
                string assetPath = MeshFolder + "/GM_Mesh_Relief_"
                    + child.name.Substring("GroundTile_".Length) + ".asset";
                Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(assetPath);
                bool fresh = mesh == null;
                if (fresh) mesh = new Mesh();
                mesh.name = Path.GetFileNameWithoutExtension(assetPath);
                FillTileMesh(mesh, field, origin, scale);
                if (fresh) AssetDatabase.CreateAsset(mesh, assetPath);
                else EditorUtility.SetDirty(mesh);

                Undo.RecordObject(filter, "Рельеф глобальной карты");
                filter.sharedMesh = mesh;
                rebuilt++;
            }
            AssetDatabase.SaveAssets();
            return rebuilt;
        }

        /// <summary>
        /// Сетка тайла в его локальном пространстве (юнит-квад −0.5..0.5, как
        /// GM_Mesh_Tile): позиции по миру → точки карты → высота поля.
        /// </summary>
        private static void FillTileMesh(Mesh mesh, ReliefField field,
                                         Vector3 origin, Vector3 scale)
        {
            int side = TileQuads + 1;
            var vertices = new Vector3[side * side];
            var normals = new Vector3[side * side];
            var uv = new Vector2[side * side];
            var triangles = new int[TileQuads * TileQuads * 6];

            float worldToPointX = 1f / 0.1f;
            for (int y = 0; y < side; y++)
            {
                for (int x = 0; x < side; x++)
                {
                    float u = x / (float)TileQuads;
                    float v = y / (float)TileQuads;
                    float worldX = origin.x + (u - 0.5f) * scale.x;
                    float worldZ = origin.z + (v - 0.5f) * scale.z;
                    float px = worldX * worldToPointX + field.WidthPoints * 0.5f;
                    float py = field.HeightPoints * 0.5f - worldZ * worldToPointX;
                    // Поле высот ложится ПОВЕРХ авторской плоскости земли:
                    // нулевой рельеф возвращает ровно исходную поверхность
                    // −0.13, на которую рассчитаны дороги, декорации и пробы.
                    float height = RoaGlobalMapEnvironmentAuthoring.ExpectedVisibleGroundY
                        + field.HeightAt(px, py);

                    int index = y * side + x;
                    vertices[index] = new Vector3(u - 0.5f,
                        (height - origin.y) / Mathf.Max(0.0001f, scale.y), v - 0.5f);
                    uv[index] = new Vector2(u, v);

                    const float step = 3f;
                    float hx = field.HeightAt(px + step, py)
                        - field.HeightAt(px - step, py);
                    float hz = field.HeightAt(px, py + step)
                        - field.HeightAt(px, py - step);
                    // py растёт на юг (world −Z): наклон по Z меняет знак.
                    normals[index] = new Vector3(-hx, 2f * step * 0.1f, hz).normalized;
                }
            }

            int t = 0;
            for (int y = 0; y < TileQuads; y++)
            {
                for (int x = 0; x < TileQuads; x++)
                {
                    int a = y * side + x;
                    triangles[t++] = a;
                    triangles[t++] = a + side;
                    triangles[t++] = a + 1;
                    triangles[t++] = a + 1;
                    triangles[t++] = a + side;
                    triangles[t++] = a + side + 1;
                }
            }

            mesh.Clear();
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
        }

        /// <summary>
        /// Пересадка декораций по дельте рельефа. Пропускаются сами тайлы и
        /// крупные плоскости (океан, горизонт, токсичная мгла) — всё, чей
        /// след больше 20 юнитов.
        /// </summary>
        private static int ReseatProps(Transform staticRoot, ReliefField previous,
                                       ReliefField next)
        {
            var moved = new HashSet<Transform>();
            int count = 0;
            foreach (MeshRenderer renderer in
                     staticRoot.GetComponentsInChildren<MeshRenderer>(true))
            {
                if (renderer == null) continue;
                if (renderer.name.StartsWith("GroundTile_", StringComparison.Ordinal))
                    continue;
                Bounds bounds = renderer.bounds;
                if (bounds.size.x > 20f || bounds.size.z > 20f) continue;

                GameObject root = PrefabUtility.GetNearestPrefabInstanceRoot(
                    renderer.gameObject);
                Transform target = root != null
                    ? root.transform : renderer.transform;
                if (!moved.Add(target)) continue;

                Vector3 position = target.position;
                float px = position.x * 10f + next.WidthPoints * 0.5f;
                float py = next.HeightPoints * 0.5f - position.z * 10f;
                float delta = next.HeightAt(px, py) - previous.HeightAt(px, py);
                if (Mathf.Abs(delta) < 0.001f) continue;

                Undo.RecordObject(target, "Рельеф глобальной карты");
                target.position = position + Vector3.up * delta;
                count++;
            }
            return count;
        }

        private static void SaveRuntimeAsset(ReliefField field)
        {
            string folder = Path.GetDirectoryName(ReliefAssetPath)?.Replace('\\', '/');
            if (!AssetDatabase.IsValidFolder(folder))
                AssetDatabase.CreateFolder("Assets/Resources", "RealmOfAshes");
            var asset = AssetDatabase.LoadAssetAtPath<RoaGlobalMapRelief>(ReliefAssetPath);
            bool fresh = asset == null;
            if (fresh) asset = ScriptableObject.CreateInstance<RoaGlobalMapRelief>();
            asset.SamplesX = field.Samples;
            asset.SamplesY = field.Samples;
            asset.WidthPoints = field.WidthPoints;
            asset.HeightPoints = field.HeightPoints;
            asset.Heights = (float[])field.Heights.Clone();
            if (fresh) AssetDatabase.CreateAsset(asset, ReliefAssetPath);
            else EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
        }

        private static RoaUnityGlobalMapScene FindLoadedMarker()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                Scene scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded) continue;
                foreach (GameObject root in scene.GetRootGameObjects())
                {
                    RoaUnityGlobalMapScene marker =
                        root.GetComponentInChildren<RoaUnityGlobalMapScene>(true);
                    if (marker != null) return marker;
                }
            }
            return null;
        }
    }
}
#endif
