using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using RealmOfAshes.World;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Единый источник игровой видимости: туман войны и линия видимости.
    ///
    /// Портирует rebuildRtsFogOfWar(), markVisibilityRay()
    /// и perceptionTileVisionRadius() из 09_update_fog_movement_ai.js:483–612.
    ///
    /// Камера и туман решают РАЗНЫЕ задачи: камера определяет, что попало
    /// на экран, а туман — какую игровую информацию персонаж имеет право
    /// видеть. Экранное открытие стены не может показать сущность, которую
    /// закрыл gameplay LOS (docs/wiki/CAMERA_AND_VISION.md).
    ///
    /// Скрываются только динамические сущности: NPC, враги, другие игроки,
    /// трупы, предметы на земле, контейнеры. Статика не исчезает.
    /// </summary>
    public sealed class RoaFogOfWar : MonoBehaviour
    {
        private struct ExactVisionBox
        {
            public RoaWorldCollisionBox Box;
            public RoaAuthoredVision.Kind Kind;
        }

        public RoaLocationLoader Loader;
        private int _mapWidth = 64;
        private int _mapDepth = 64;

        private readonly HashSet<int> _blockTiles = new HashSet<int>();
        private readonly HashSet<int> _coverTiles = new HashSet<int>();
        private readonly HashSet<int> _authoredBlockTiles = new HashSet<int>();
        private readonly HashSet<int> _authoredCoverTiles = new HashSet<int>();
        private readonly List<ExactVisionBox> _exactVisionBoxes = new List<ExactVisionBox>();
        private readonly HashSet<int> _visible = new HashSet<int>();
        private readonly HashSet<int> _explored = new HashSet<int>();

        // Один динамический меш вместо сотен GameObject: два submesh для
        // невидимых клеток и видимых препятствий.
        private GameObject _overlayRoot;
        private Mesh _overlayMesh;
        private Material _fogMaterial;
        private Material _blockMaterial;
        private readonly List<Vector3> _overlayVertices = new List<Vector3>(2400);
        private readonly List<int> _fogTriangles = new List<int>(3600);
        private readonly List<int> _blockTriangles = new List<int>(1200);

        private const float OverlayY = 0.16f;
        private const float OverlayScale = 0.985f;

        private int _lastTx = int.MinValue;
        private int _lastTz = int.MinValue;
        private bool _lastCrouching;
        private int _lastRadius;
        private Vector3 _observerWorld;
        private int _lastSubTileX = int.MinValue;
        private int _lastSubTileZ = int.MinValue;
        private float _nextSubTileRefreshAt;
        private float _nextSafetyRefreshAt;

        private const float SubTileRefreshSeconds = 0.14f;
        private const float SafetyRefreshSeconds = 2.4f;

        /// <summary>Растёт при каждом пересчёте набора видимых тайлов — для кэшей.</summary>
        public int Version { get; private set; }

        /// <summary>Текущий радиус обзора в тайлах. Для диагностики.</summary>
        public int Radius { get; private set; }

        /// <summary>Сколько тайлов видно сейчас. Для диагностики.</summary>
        public int VisibleCount { get { return _visible.Count; } }

        /// <summary>Число затемнённых тайлов вокруг наблюдателя. Для диагностики.</summary>
        public int VisualFogCount { get; private set; }

        /// <summary>Число подсвеченных тайлов-препятствий. Для диагностики.</summary>
        public int VisualBlockCount { get; private set; }

        [Tooltip("Показывать мягкое затенение невидимых тайлов на уровне земли.")]
        public bool ShowVisualFog = true;

        /// <summary>Восприятие персонажа: приходит из авторитетного SPECIAL.</summary>
        public int Perception { get; set; } = 5;

        /// <summary>Ранг перка «Бдительность».</summary>
        public int Vigilance { get; set; }

        public bool Ready { get; private set; }

        /// <summary>
        /// Наблюдатель. Пока он назначен, туман сам держится в актуальном
        /// состоянии, и порядок Update у компонентов перестаёт что-либо значить.
        /// </summary>
        public RoaPlayerController Observer;

        private int _observerFrame = -1;

        private void OnEnable()
        {
            // При возврате с глобальной карты компонент включается раньше, чем
            // загружена новая локальная сцена. Старый меш в этот промежуток
            // показывать нельзя — Rebuild включит уже пересчитанный слой.
            if (_overlayRoot != null) _overlayRoot.SetActive(false);
        }

        private void OnDisable()
        {
            if (_overlayRoot != null) _overlayRoot.SetActive(false);
        }

        private void OnDestroy()
        {
            DestroyRuntime(_overlayMesh);
            DestroyRuntime(_fogMaterial);
            DestroyRuntime(_blockMaterial);
        }

        private void Update()
        {
            EnsureCurrent();
        }

        /// <summary>
        /// Пересчитать туман, если в этом кадре он ещё не считался.
        ///
        /// Вызывается и из Update, и из каждого запроса видимости. Без этого
        /// ответ зависел бы от того, чей Update Unity выполнил раньше, — а такой
        /// порядок не задан и меняется от сборки к сборке.
        /// </summary>
        private void EnsureCurrent()
        {
            if (Observer == null) return;
            if (_observerFrame == Time.frameCount) return;

            _observerFrame = Time.frameCount;

            Perception = Observer.Perception;
            Vigilance = Observer.Vigilance;

            Rebuild(Observer.transform.position, Observer.Crouching,
                Observer.HasConcussion, Observer.HasInfection);
        }

        /// <summary>
        /// Собрать карту препятствий из авторской локации. Объект перекрывает
        /// обзор, если у него vision.mode = "block" (или blocks = true);
        /// "cover" перекрывает только для присевших.
        /// </summary>
        public void Build(LocationDefinition location)
        {
            Build(location, null);
        }

        public void Build(LocationDefinition location, JArray authoritativeMap)
        {
            _blockTiles.Clear();
            _coverTiles.Clear();
            _authoredBlockTiles.Clear();
            _authoredCoverTiles.Clear();
            _exactVisionBoxes.Clear();
            _visible.Clear();
            _explored.Clear();
            _lastTx = int.MinValue;
            _lastSubTileX = int.MinValue;
            _lastSubTileZ = int.MinValue;
            _nextSubTileRefreshAt = 0f;
            _nextSafetyRefreshAt = 0f;
            Ready = false;
            ClearVisualOverlay();

            if (location == null) return;

            _mapWidth = location.TileWidth;
            _mapDepth = location.TileDepth;

            foreach (LocationObject entry in location.Objects)
            {
                // Живых сущностей в разметке нет: их позиции авторитетно
                // задаёт сервер, и обзор они не перекрывают.
                if (entry == null || entry.IsLiveEntity()) continue;

                RoaAuthoredVision.Kind kind = RoaAuthoredVision.Resolve(entry);

                if (kind == RoaAuthoredVision.Kind.Block || kind == RoaAuthoredVision.Kind.Cover)
                {
                    var boxes = new List<RoaWorldCollisionBox>();
                    int exactCount = Loader != null ? Loader.CollectCollisionBoxes(entry.Id, boxes) : 0;
                    if (exactCount > 0)
                    {
                        for (int i = 0; i < boxes.Count; i++)
                            _exactVisionBoxes.Add(new ExactVisionBox { Box = boxes[i], Kind = kind });
                    }
                    else if (kind == RoaAuthoredVision.Kind.Block) MarkFootprint(entry, _authoredBlockTiles);
                    else MarkFootprint(entry, _authoredCoverTiles);
                }
            }

            RebuildTerrainVision(authoritativeMap);

            Ready = true;
            EnsureVisualOverlay();
            Debug.Log("[ROA] Видимость: карта " + _mapWidth + "x" + _mapDepth
                + ", перекрывают обзор " + _blockTiles.Count + " тайлов, укрытий "
                + _coverTiles.Count);
        }

        /// <summary>
        /// Applies tree/full-cover and rock/resource/ruin low-cover flags from the
        /// same authoritative map used by the server and browser. Water deliberately
        /// remains transparent to sight, matching isFullVisionBlockingTile().
        /// </summary>
        public void ApplyWorldMap(JArray authoritativeMap)
        {
            if (!Ready || authoritativeMap == null) return;
            RebuildTerrainVision(authoritativeMap);
            _lastTx = int.MinValue;
        }

        private void RebuildTerrainVision(JArray authoritativeMap)
        {
            _blockTiles.Clear();
            _coverTiles.Clear();
            _blockTiles.UnionWith(_authoredBlockTiles);
            _coverTiles.UnionWith(_authoredCoverTiles);
            if (authoritativeMap == null) return;

            int rows = Mathf.Min(_mapDepth, authoritativeMap.Count);
            for (int tz = 0; tz < rows; tz++)
            {
                JArray row = authoritativeMap[tz] as JArray;
                if (row == null) continue;
                int columns = Mathf.Min(_mapWidth, row.Count);
                for (int tx = 0; tx < columns; tx++)
                {
                    int type = row[tx]?.ToObject<int>() ?? 0;
                    int key = Key(tx, tz);
                    if (type == 1) _blockTiles.Add(key);
                    else if (type == 2 || type == 6 || type == 7 || type == 8 || type == 9)
                        _coverTiles.Add(key);
                }
            }
        }

        /// <summary>
        /// Отметить тайлы, которые занимает объект.
        /// markAuthoredLocationObjectOnClientMap(), 02c:1620.
        ///
        /// Раскладка вокруг центра НЕСИММЕТРИЧНА: при чётном числе клеток лишняя
        /// уходит в плюс (floor вниз, ceil вверх). Симметричное деление съело бы
        /// у каждой стены 10×8 по ряду и оставило в ней щели.
        /// </summary>
        private void MarkFootprint(LocationObject entry, HashSet<int> target)
        {
            Vector3 position = entry.Position != null
                ? RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z)
                : Vector3.zero;

            int tx;
            int tz;
            RoaCoords.WorldToTile(position, _mapWidth, _mapDepth, out tx, out tz);

            float width;
            float depth;
            CollisionSize(entry, out width, out depth);

            int cellsX = Mathf.Max(1, Mathf.RoundToInt(width / RoaCoords.Tile));
            int cellsZ = Mathf.Max(1, Mathf.RoundToInt(depth / RoaCoords.Tile));

            int fromX = -Mathf.FloorToInt((cellsX - 1) / 2f);
            int toX = Mathf.CeilToInt((cellsX - 1) / 2f);
            int fromZ = -Mathf.FloorToInt((cellsZ - 1) / 2f);
            int toZ = Mathf.CeilToInt((cellsZ - 1) / 2f);

            for (int dz = fromZ; dz <= toZ; dz++)
            {
                for (int dx = fromX; dx <= toX; dx++)
                {
                    int x = tx + dx;
                    int z = tz + dz;
                    if (InBounds(x, z)) target.Add(Key(x, z));
                }
            }
        }

        /// <summary>
        /// Размер объекта в метрах. authoredObjectCollisionSize(), 02a:1666.
        ///
        /// Приоритет: явный collisionSize → placement.cells (в тайлах) →
        /// footprint (в метрах) → масштаб объекта, где 1.0 значит один тайл.
        /// Габаритов из самих GLB тут нет: они появляются только после загрузки
        /// модели, а туман нужен раньше.
        /// </summary>
        private static void CollisionSize(LocationObject entry, out float width, out float depth)
        {
            if (entry.CollisionSize != null)
            {
                float exactWidth = Number(entry.CollisionSize["width"] ?? entry.CollisionSize["x"]);
                float exactDepth = Number(entry.CollisionSize["depth"] ?? entry.CollisionSize["z"]);

                if (exactWidth > 0f && exactDepth > 0f)
                {
                    width = Mathf.Max(0.4f, exactWidth);
                    depth = Mathf.Max(0.4f, exactDepth);
                    return;
                }
            }

            JToken cells = entry.Placement != null ? entry.Placement["cells"] : null;
            float cellWidth = Number(cells?["x"]) * RoaCoords.Tile;
            float cellDepth = Number(cells?["z"]) * RoaCoords.Tile;

            float scaleX = entry.Scale != null ? Mathf.Abs(entry.Scale.X) : 1f;
            float scaleZ = entry.Scale != null ? Mathf.Abs(entry.Scale.Z) : 1f;

            float footWidth = entry.Footprint != null ? entry.Footprint.X : 0f;
            float footDepth = entry.Footprint != null ? entry.Footprint.Z : 0f;

            width = Mathf.Max(0.45f, cellWidth > 0f ? cellWidth
                : footWidth > 0f ? footWidth
                : Mathf.Max(1f, scaleX) * RoaCoords.Tile);

            depth = Mathf.Max(0.45f, cellDepth > 0f ? cellDepth
                : footDepth > 0f ? footDepth
                : Mathf.Max(1f, scaleZ) * RoaCoords.Tile);
        }

        private static float Number(JToken token)
        {
            if (token == null) return 0f;
            // JValue.ToString() форматирует double текущей культурой (ru-RU даёт "173,3"),
            // и инвариантный разбор такой строки молча возвращал fallback. Числовые токены
            // читаем напрямую, строки разбираем инвариантно.
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return token.Value<float>();

            float value;
            return float.TryParse(token.ToString(), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out value) ? value : 0f;
        }

        /// <summary>
        /// Радиус обзора в тайлах. perceptionTileVisionRadius(), 09:483.
        /// Времени суток в игре нет, поэтому ночного штрафа тоже нет.
        /// </summary>
        public int ComputeRadius(bool crouching, bool concussion, bool infection)
        {
            float per = Mathf.Clamp(Perception, 1, 15);
            float radius = 5.5f + per * 0.7f + Vigilance;

            if (crouching) radius -= 1f;
            if (concussion) radius -= 2f;
            if (infection) radius -= 0.5f;

            // Радиус вдвое меньше «сырого»: камера подведена к модели близко,
            // и полный радиус открывал бы карту далеко за краем экрана.
            // JavaScript Math.round() округляет положительную половину вверх,
            // а Mathf.RoundToInt() — к ближайшему чётному. При PER=5 это было
            // 4 вместо авторских 5 тайлов (4.5 → 4). Все значения здесь
            // положительны, поэтому floor(x + 0.5) точно повторяет web.
            return Mathf.Clamp(Mathf.FloorToInt(radius / 2f + 0.5f), 3, 9);
        }

        /// <summary>
        /// Пересобрать туман от позиции игрока. Смена тайла, стойки и радиуса
        /// применяется сразу; движение внутри тайла квантуется по 0.1 м и
        /// ограничено тем же бюджетом 0.14 с, что у web-клиента.
        /// </summary>
        public void Rebuild(Vector3 playerWorld, bool crouching)
        {
            Rebuild(playerWorld, crouching, false, false);
        }

        /// <summary>Пересобрать туман с авторитетными штрафами травм.</summary>
        public void Rebuild(Vector3 playerWorld, bool crouching, bool concussion, bool infection)
        {
            if (!Ready) return;

            int radius = ComputeRadius(crouching, concussion, infection);

            int tx;
            int tz;
            RoaCoords.WorldToTile(playerWorld, _mapWidth, _mapDepth, out tx, out tz);

            tx = Mathf.Clamp(tx, 0, _mapWidth - 1);
            tz = Mathf.Clamp(tz, 0, _mapDepth - 1);

            Vector3 tileCenter = RoaCoords.TileToWorld(tx, tz, _mapWidth, _mapDepth);
            int subTileX = JsRound((playerWorld.x - tileCenter.x) * 10f);
            int subTileZ = JsRound((playerWorld.z - tileCenter.z) * 10f);
            float now = Time.realtimeSinceStartup;
            bool hardChanged = tx != _lastTx || tz != _lastTz
                || crouching != _lastCrouching || radius != _lastRadius;
            bool subTileChanged = subTileX != _lastSubTileX || subTileZ != _lastSubTileZ;
            bool safetyRefresh = now >= _nextSafetyRefreshAt;

            // Exact OBB doorways depend on the observer's position inside a tile.
            // Do not pay for a full fog pass every frame while running, though.
            if (!hardChanged && !safetyRefresh
                && (!subTileChanged || now < _nextSubTileRefreshAt)) return;

            _lastTx = tx;
            _lastTz = tz;
            _observerWorld = playerWorld;
            _lastSubTileX = subTileX;
            _lastSubTileZ = subTileZ;
            _lastCrouching = crouching;
            _lastRadius = radius;
            _nextSubTileRefreshAt = now + SubTileRefreshSeconds;
            _nextSafetyRefreshAt = now + SafetyRefreshSeconds;
            Radius = radius;

            // Версия растёт на каждый фактический пересчёт. Сравнивать размеры
            // наборов нельзя: разные наборы бывают одинаковой мощности, и кэш,
            // построенный на такой «версии», отдавал бы устаревший ответ.
            Version++;
            _visible.Clear();

            for (int dz = -radius; dz <= radius; dz++)
            {
                for (int dx = -radius; dx <= radius; dx++)
                {
                    int x = tx + dx;
                    int z = tz + dz;

                    if (!InBounds(x, z)) continue;
                    if (dx * dx + dz * dz > radius * radius) continue;

                    MarkRay(tx, tz, x, z, crouching);
                }
            }

            RebuildVisualOverlay(tx, tz, crouching);
        }

        private static int JsRound(float value)
        {
            return Mathf.FloorToInt(value + 0.5f);
        }

        /// <summary>
        /// Визуальный слой updateVisibilityGridVisual(), 09:666. Браузер рисует
        /// только круг radius+4: невидимые клетки затемняются, а видимые стены
        /// получают слабый коричневый тон. Разведанная, но сейчас невидимая
        /// клетка выглядит так же, как неизвестная — fogSeenOpacity в пресетах 0.
        /// </summary>
        private void RebuildVisualOverlay(int observerTx, int observerTz, bool crouching)
        {
            if (!ShowVisualFog || !EnsureVisualOverlay())
            {
                ClearVisualOverlay();
                return;
            }

            _overlayVertices.Clear();
            _fogTriangles.Clear();
            _blockTriangles.Clear();
            VisualFogCount = 0;
            VisualBlockCount = 0;

            int cullRadius = Radius + 4;
            int cullRadiusSq = cullRadius * cullRadius;
            for (int dz = -cullRadius; dz <= cullRadius; dz++)
            {
                for (int dx = -cullRadius; dx <= cullRadius; dx++)
                {
                    if (dx * dx + dz * dz > cullRadiusSq) continue;
                    int tx = observerTx + dx;
                    int tz = observerTz + dz;
                    if (!InBounds(tx, tz)) continue;

                    int key = Key(tx, tz);
                    if (!_visible.Contains(key))
                    {
                        AddOverlayQuad(tx, tz, _fogTriangles, 1f);
                        VisualFogCount++;
                    }
                    else if (Blocks(key, crouching))
                    {
                        AddOverlayQuad(tx, tz, _blockTriangles, 0.94f);
                        VisualBlockCount++;
                    }
                }
            }

            _overlayMesh.Clear(false);
            _overlayMesh.SetVertices(_overlayVertices);
            _overlayMesh.subMeshCount = 2;
            _overlayMesh.SetTriangles(_fogTriangles, 0, false);
            _overlayMesh.SetTriangles(_blockTriangles, 1, false);
            _overlayMesh.RecalculateBounds();
            _overlayRoot.SetActive(true);
        }

        private void AddOverlayQuad(int tx, int tz, List<int> triangles, float scale)
        {
            Vector3 center = RoaCoords.TileToWorld(tx, tz, _mapWidth, _mapDepth);
            center.y = OverlayY;
            float half = RoaCoords.Tile * 0.5f * OverlayScale * scale;
            int start = _overlayVertices.Count;
            _overlayVertices.Add(center + new Vector3(-half, 0f, -half));
            _overlayVertices.Add(center + new Vector3(-half, 0f, half));
            _overlayVertices.Add(center + new Vector3(half, 0f, half));
            _overlayVertices.Add(center + new Vector3(half, 0f, -half));
            triangles.Add(start);
            triangles.Add(start + 1);
            triangles.Add(start + 2);
            triangles.Add(start);
            triangles.Add(start + 2);
            triangles.Add(start + 3);
        }

        private bool EnsureVisualOverlay()
        {
            if (!Application.isPlaying) return false;
            if (_overlayRoot != null && _overlayMesh != null) return true;

            _overlayRoot = new GameObject("VisibilityTileShading");
            _overlayRoot.transform.SetParent(transform, false);
            var filter = _overlayRoot.AddComponent<MeshFilter>();
            var renderer = _overlayRoot.AddComponent<MeshRenderer>();
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            _overlayMesh = new Mesh { name = "VisibilityTileShadingMesh" };
            _overlayMesh.MarkDynamic();
            filter.sharedMesh = _overlayMesh;

            _fogMaterial = CreateOverlayMaterial(new Color(0.01f, 0.02f, 0.025f, 0.22f));
            _blockMaterial = CreateOverlayMaterial(new Color(0.478f, 0.29f, 0.18f, 0.045f));
            if (_fogMaterial == null || _blockMaterial == null)
            {
                Debug.LogError("[ROA] Визуальный туман отключён: в player build нет подходящего shader.");
                if (_fogMaterial != null) Destroy(_fogMaterial);
                if (_blockMaterial != null) Destroy(_blockMaterial);
                _fogMaterial = null;
                _blockMaterial = null;
                Destroy(_overlayMesh);
                _overlayMesh = null;
                Destroy(_overlayRoot);
                _overlayRoot = null;
                return false;
            }
            renderer.sharedMaterials = new[] { _fogMaterial, _blockMaterial };
            return true;
        }

        private static Material CreateOverlayMaterial(Color color)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Unlit")
                ?? Shader.Find("Unlit/Color")
                ?? Shader.Find("Standard");
            if (shader == null) return null;
            var material = new Material(shader) { color = color, renderQueue = 3000 };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 1f);
            if (material.HasProperty("_SrcBlend"))
                material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            if (material.HasProperty("_DstBlend"))
                material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 0f);
            material.SetOverrideTag("RenderType", "Transparent");
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            material.DisableKeyword("_ALPHATEST_ON");
            return material;
        }

        private void ClearVisualOverlay()
        {
            VisualFogCount = 0;
            VisualBlockCount = 0;
            if (_overlayMesh != null) _overlayMesh.Clear(false);
            if (_overlayRoot != null) _overlayRoot.SetActive(false);
        }

        private static void DestroyRuntime(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }

        /// <summary>
        /// Луч Брезенхэма от игрока к тайлу. Ключевая деталь: препятствие
        /// останавливает луч ПОСЛЕ того, как его собственный тайл уже отмечен
        /// видимым — иначе стены были бы невидимы.
        /// </summary>
        private void MarkRay(int startTx, int startTz, int endTx, int endTz, bool crouching)
        {
            int x = startTx;
            int z = startTz;

            int dx = Mathf.Abs(endTx - x);
            int dz = Mathf.Abs(endTz - z);
            int sx = x < endTx ? 1 : -1;
            int sz = z < endTz ? 1 : -1;
            int err = dx - dz;

            while (true)
            {
                if (!InBounds(x, z)) return;

                int key = Key(x, z);
                _visible.Add(key);
                _explored.Add(key);

                if (x == endTx && z == endTz) return;

                bool isStart = x == startTx && z == startTz;
                if (!isStart && Blocks(key, crouching)) return;

                int previousX = x;
                int previousZ = z;
                int e2 = err * 2;
                if (e2 > -dz) { err -= dz; x += sx; }
                if (e2 < dx) { err += dx; z += sz; }

                if (ExactVisionBlocked(VisibilityWorldPoint(previousX, previousZ, startTx, startTz),
                    VisibilityWorldPoint(x, z, startTx, startTz), crouching))
                {
                    if (InBounds(x, z))
                    {
                        int wallKey = Key(x, z);
                        _visible.Add(wallKey);
                        _explored.Add(wallKey);
                    }
                    return;
                }
            }
        }

        /// <summary>
        /// Низкое укрытие перекрывает обзор только присевшему наблюдателю:
        /// стоя человек смотрит поверх ящика.
        /// </summary>
        private bool Blocks(int key, bool crouching)
        {
            if (_blockTiles.Contains(key)) return true;
            return crouching && _coverTiles.Contains(key);
        }

        /// <summary>
        /// Mirrors roomBlockingDistanceOnRay(): trees block the complete technical
        /// tile, while rock/resource/ruin/oil tiles do so only for a crouched
        /// shooter. Exact GLB blockers remain a separate Physics raycast.
        /// </summary>
        public bool TerrainBlocksBallisticLine(Vector3 startWorld, Vector3 endWorld,
            bool shooterCrouching, float endPadding)
        {
            if (!Ready) return false;

            Vector3 delta = endWorld - startWorld;
            delta.y = 0f;
            float distance = delta.magnitude;
            if (distance < 0.15f) return false;

            const float step = 0.45f;
            float checkDistance = Mathf.Max(0.15f, distance - Mathf.Max(0f, endPadding));
            Vector3 direction = delta / distance;
            for (float d = step; d <= checkDistance; d += step)
            {
                Vector3 sample = startWorld + direction * d;
                RoaCoords.WorldToTile(sample, _mapWidth, _mapDepth, out int tx, out int tz);
                bool blocked = !InBounds(tx, tz) || Blocks(Key(tx, tz), shooterCrouching);
                if (!blocked) continue;

                float clearDistance = Mathf.Max(0.1f, d - step * 0.5f);
                return clearDistance + 0.35f < checkDistance;
            }
            return false;
        }

        /// <summary>
        /// Видна ли точка мира для геймплея.
        /// Портирует isPointVisibleForGameplay(), 09:760.
        ///
        /// Одной проверки набора видимых тайлов мало. Луч, проложенный к дальней
        /// цели, попутно метит промежуточные тайлы, и из-за округления Брезенхэма
        /// туда может попасть тайл, к которому прямого луча нет. Поэтому набор
        /// даёт быстрый отказ, а решение принимает строгая линия видимости.
        ///
        /// targetCrouching — стойка ЦЕЛИ, не наблюдателя: присевший за ящиком
        /// не виден и стоящему.
        /// </summary>
        public bool IsVisible(Vector3 world, bool targetCrouching = false)
        {
            // Пока туман ни разу не пересчитан, наблюдателя ещё нет: прятать
            // сущности не от кого, и «всё невидимо» было бы просто чёрным экраном.
            if (!Ready) return true;

            EnsureCurrent();
            if (_lastTx == int.MinValue) return true;

            int tx;
            int tz;
            RoaCoords.WorldToTile(world, _mapWidth, _mapDepth, out tx, out tz);

            if (!InBounds(tx, tz)) return false;

            int dx = tx - _lastTx;
            int dz = tz - _lastTz;
            if (dx * dx + dz * dz > Radius * Radius) return false;

            if (!_visible.Contains(Key(tx, tz))) return false;
            if (!HasStrictLineOfSightInternal(_lastTx, _lastTz, tx, tz, _lastCrouching, world)) return false;

            if (targetCrouching && HiddenByLowCover(_lastTx, _lastTz, tx, tz, world)) return false;

            return true;
        }

        /// <summary>
        /// Строгая линия видимости между тайлами. hasStrictTileLineOfSight(), 09:496.
        ///
        /// Отличие от разметочного луча: проверяется СЛЕДУЮЩИЙ тайл после шага.
        /// Тайл самой цели препятствием не считается — иначе стена никогда бы
        /// не была видна, а существо у стены пропадало бы.
        /// </summary>
        public bool HasStrictLineOfSight(int startTx, int startTz, int endTx, int endTz, bool observerCrouching)
        {
            return HasStrictLineOfSightInternal(startTx, startTz, endTx, endTz, observerCrouching, null);
        }

        private bool HasStrictLineOfSightInternal(int startTx, int startTz, int endTx, int endTz,
            bool observerCrouching, Vector3? targetWorld)
        {
            Vector3 startWorld = VisibilityWorldPoint(startTx, startTz, startTx, startTz);
            Vector3 endWorld = targetWorld ?? VisibilityWorldPoint(endTx, endTz, startTx, startTz);
            if (ExactVisionBlocked(startWorld, endWorld, observerCrouching)) return false;

            int x = startTx;
            int z = startTz;

            int dx = Mathf.Abs(endTx - x);
            int dz = Mathf.Abs(endTz - z);
            int sx = x < endTx ? 1 : -1;
            int sz = z < endTz ? 1 : -1;
            int err = dx - dz;

            while (true)
            {
                if (!InBounds(x, z)) return false;
                if (x == endTx && z == endTz) return true;

                int e2 = err * 2;
                if (e2 > -dz) { err -= dz; x += sx; }
                if (e2 < dx) { err += dx; z += sz; }

                if (!InBounds(x, z)) return false;
                if (x == endTx && z == endTz) return true;
                if (Blocks(Key(x, z), observerCrouching)) return false;
            }
        }

        /// <summary>
        /// Скрыт ли присевший за низким укрытием.
        /// isCrouchedTargetHiddenByLowCover(), 09:141.
        ///
        /// Низкое укрытие не режет обзор и не прячет карту. Оно скрывает
        /// присевшего — и только если тот стоит в ПЕРВОЙ клетке сразу за
        /// укрытием от наблюдателя. Дальше по линии эффект пропадает: там
        /// человек уже не «за ящиком», а просто дальше него.
        /// </summary>
        private bool HiddenByLowCover(int startTx, int startTz, int targetTx, int targetTz,
            Vector3? targetWorld = null)
        {
            if (startTx == targetTx && startTz == targetTz) return false;

            Vector3 startWorld = VisibilityWorldPoint(startTx, startTz, startTx, startTz);
            Vector3 endWorld = targetWorld ?? VisibilityWorldPoint(targetTx, targetTz, startTx, startTz);
            for (int i = 0; i < _exactVisionBoxes.Count; i++)
            {
                ExactVisionBox row = _exactVisionBoxes[i];
                if (row.Kind != RoaAuthoredVision.Kind.Cover) continue;
                if (TryVisionHit(row.Box, startWorld, endWorld, out _, out float far, out float maxRange)
                    && maxRange - far <= RoaCoords.Tile * 1.25f) return true;
            }

            int x = startTx;
            int z = startTz;

            int dx = Mathf.Abs(targetTx - x);
            int dz = Mathf.Abs(targetTz - z);
            int sx = x < targetTx ? 1 : -1;
            int sz = z < targetTz ? 1 : -1;
            int err = dx - dz;

            // Тайл самого наблюдателя в линию не входит (lineTilesBetween, 09:107
            // добавляет тайлы только ПОСЛЕ шага). Иначе игрок, стоящий на укрытии,
            // прятал бы от себя же присевшего соседа.
            bool previousIsObserver = true;
            int previousKey = 0;

            while (true)
            {
                int e2 = err * 2;
                if (e2 > -dz) { err -= dz; x += sx; }
                if (e2 < dx) { err += dx; z += sz; }

                if (!InBounds(x, z)) return false;

                // Дошли до цели: прячет только укрытие вплотную перед ней.
                if (x == targetTx && z == targetTz)
                    return !previousIsObserver && _coverTiles.Contains(previousKey);

                previousKey = Key(x, z);
                previousIsObserver = false;
            }
        }

        private Vector3 VisibilityWorldPoint(int tx, int tz, int startTx, int startTz)
        {
            Vector3 center = RoaCoords.TileToWorld(tx, tz, _mapWidth, _mapDepth);
            if (_lastTx != startTx || _lastTz != startTz) return center;
            Vector3 startCenter = RoaCoords.TileToWorld(startTx, startTz, _mapWidth, _mapDepth);
            float maxOffset = RoaCoords.Tile * 0.48f;
            center.x += Mathf.Clamp(_observerWorld.x - startCenter.x, -maxOffset, maxOffset);
            center.z += Mathf.Clamp(_observerWorld.z - startCenter.z, -maxOffset, maxOffset);
            return center;
        }

        private bool ExactVisionBlocked(Vector3 start, Vector3 end, bool observerCrouching)
        {
            for (int i = 0; i < _exactVisionBoxes.Count; i++)
            {
                ExactVisionBox row = _exactVisionBoxes[i];
                if (row.Kind == RoaAuthoredVision.Kind.Cover && !observerCrouching) continue;
                if (TryVisionHit(row.Box, start, end, out _, out _, out _)) return true;
            }
            return false;
        }

        private static bool TryVisionHit(RoaWorldCollisionBox box, Vector3 start, Vector3 end,
            out float nearHit, out float farHit, out float maxRange)
        {
            Vector3 delta = end - start;
            delta.y = 0f;
            maxRange = delta.magnitude;
            nearHit = 0f;
            farHit = 0f;
            if (maxRange <= 0.001f) return false;

            Vector3 direction = delta / maxRange;
            Quaternion inverse = Quaternion.Inverse(Quaternion.Euler(0f, box.RotationY * Mathf.Rad2Deg, 0f));
            Vector3 localOrigin = inverse * new Vector3(start.x - box.X, 0f, start.z - box.Z);
            Vector3 localDirection = inverse * direction;
            float tMin = 0.02f;
            float tMax = maxRange - 0.02f;
            if (!ClipAxis(localOrigin.x, localDirection.x, -box.HalfX, box.HalfX, ref tMin, ref tMax)
                || !ClipAxis(localOrigin.z, localDirection.z, -box.HalfZ, box.HalfZ, ref tMin, ref tMax))
                return false;
            if (tMax < 0.02f || tMin >= maxRange - 0.02f) return false;
            nearHit = tMin;
            farHit = tMax;
            return true;
        }

        private static bool ClipAxis(float origin, float direction, float minimum, float maximum,
            ref float tMin, ref float tMax)
        {
            if (Mathf.Abs(direction) < 0.00001f)
                return origin >= minimum && origin <= maximum;
            float near = (minimum - origin) / direction;
            float far = (maximum - origin) / direction;
            if (near > far)
            {
                float swap = near;
                near = far;
                far = swap;
            }
            tMin = Mathf.Max(tMin, near);
            tMax = Mathf.Min(tMax, far);
            return tMin <= tMax;
        }

        /// <summary>
        /// Был ли тайл когда-либо разведан. История разведки используется
        /// мини-картой и двухслойным затемнением земли.
        /// </summary>
        public bool IsExplored(Vector3 world)
        {
            int tx;
            int tz;
            RoaCoords.WorldToTile(world, _mapWidth, _mapDepth, out tx, out tz);

            return _explored.Contains(Key(tx, tz));
        }

        private bool InBounds(int tx, int tz)
        {
            return tx >= 0 && tz >= 0 && tx < _mapWidth && tz < _mapDepth;
        }

        private int Key(int tx, int tz)
        {
            return tz * 4096 + tx;
        }
    }
}
