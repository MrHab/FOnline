using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Local HUD minimap ported from 13_minimap_hud_loop.js. Static authored
    /// features are baked once per location; only visible live markers refresh.
    /// </summary>
    public sealed class RoaMinimap : MonoBehaviour
    {
        public enum MarkerKind
        {
            Enemy,
            FriendlyNpc,
            ServiceNpc,
            RemotePlayer,
            GroundItem,
            Container,
            Resource,
            Objective,
            Threat,
            Extraction
        }

        public struct Marker
        {
            public MarkerKind Kind;
            public Vector3 Position;

            public Marker(MarkerKind kind, Vector3 position)
            {
                Kind = kind;
                Position = position;
            }
        }

        public RoaPlayerController Player;
        public RoaEnemies Enemies;
        public RoaRemotePlayers RemotePlayers;
        public RoaGroundItems GroundItems;
        public RoaInteraction Interaction;
        public RoaWorldActivityCanvas WorldActivity;

        [Range(140f, 280f)] public float Size = 190f;
        [Min(0.05f)] public float RefreshSeconds = 0.12f;
        /// <summary>Сколько ждать после загрузки, прежде чем снимать локацию сверху.</summary>
        public const float SnapshotDelaySeconds = 1.2f;

        public int MapWidth { get; private set; }
        public int MapDepth { get; private set; }
        public int StaticFeatureCount { get; private set; }
        public int MarkerCount { get { return _markers.Count; } }
        public string LocationName { get; private set; } = string.Empty;
        public Texture2D StaticTexture { get { return _staticTexture; } }

        /// <summary>Снимок локации сверху; пока он не снят — миникарта рисует схему.</summary>
        public Texture MapTexture
        {
            get
            {
                RenderTexture snapshot = _snapshot != null && _snapshot.CapturedLocationId == (_location?.Id ?? string.Empty)
                    ? _snapshot.Texture : null;
                return snapshot != null ? (Texture)snapshot : _staticTexture;
            }
        }

        public bool HasSnapshot { get { return MapTexture is RenderTexture; } }
        public bool CanvasDriven { get; set; }
        public IReadOnlyList<Marker> Markers { get { return _markers; } }
        public bool IsReady { get { return _location != null && _staticTexture != null; } }
        public bool HasPlayer { get { return Player != null && Player.gameObject.activeInHierarchy; } }
        public Vector2 PlayerMapNormalized { get { return Player == null ? Vector2.zero : WorldToMapNormalized(Player.transform.position); } }
        public float PlayerHeading { get { return Player == null ? 0f : Player.transform.eulerAngles.y; } }
        public string CellLabel
        {
            get
            {
                if (!IsReady || !HasPlayer || MapWidth <= 0 || MapDepth <= 0) return string.Empty;
                Vector2 p = PlayerMapNormalized;
                int tx = Mathf.Clamp(Mathf.FloorToInt(p.x * MapWidth), 0, MapWidth - 1);
                int tz = Mathf.Clamp(Mathf.FloorToInt(p.y * MapDepth), 0, MapDepth - 1);
                return "\u043a\u043b\u0435\u0442\u043a\u0430 " + tx + ":" + tz;
            }
        }

        private readonly List<Marker> _markers = new List<Marker>(96);
        private LocationDefinition _location;
        private JArray _worldMap;
        private Texture2D _staticTexture;
        private bool _edgeExitAllowed = true;
        private float _nextRefresh;
        private RoaMinimapSnapshot _snapshot;
        private float _snapshotAt;

        public void Configure(RoaEnemies enemies, RoaRemotePlayers remotePlayers,
                              RoaGroundItems groundItems, RoaInteraction interaction)
        {
            Enemies = enemies;
            RemotePlayers = remotePlayers;
            GroundItems = groundItems;
            Interaction = interaction;
        }

        public void SetPlayer(RoaPlayerController player)
        {
            Player = player;
        }

        public void SetLocation(LocationDefinition location)
        {
            SetLocation(location, null);
        }

        public void SetLocation(LocationDefinition location, JArray worldMap)
        {
            _location = location;
            _worldMap = worldMap != null ? (JArray)worldMap.DeepClone() : null;
            _markers.Clear();
            StaticFeatureCount = 0;
            LocationName = location?.Name ?? location?.Id ?? string.Empty;
            MapWidth = location?.TileWidth ?? 0;
            MapDepth = location?.TileDepth ?? 0;
            DestroyRuntime(_staticTexture);
            _staticTexture = null;
            if (location != null && MapWidth > 0 && MapDepth > 0) BuildStaticTexture(location);
            _nextRefresh = 0f;
            // Снимок снимаем не сразу: сначала загрузчик должен доставить модели и собрать мир.
            _snapshot?.Forget();
            _snapshotAt = location != null ? Time.unscaledTime + SnapshotDelaySeconds : 0f;
        }

        /// <summary>Пересобрать снимок локации (например, после правки мира).</summary>
        public void RequestSnapshot()
        {
            _snapshot?.Forget();
            _snapshotAt = Time.unscaledTime;
        }

        public void SetWorldMap(JArray worldMap)
        {
            _worldMap = worldMap != null ? (JArray)worldMap.DeepClone() : null;
            if (_location == null || MapWidth <= 0 || MapDepth <= 0) return;
            DestroyRuntime(_staticTexture);
            _staticTexture = null;
            BuildStaticTexture(_location);
        }

        public void SetEdgeExitAllowed(bool allowed)
        {
            if (_edgeExitAllowed == allowed) return;
            _edgeExitAllowed = allowed;
            if (_location == null || MapWidth <= 0 || MapDepth <= 0) return;
            DestroyRuntime(_staticTexture);
            _staticTexture = null;
            BuildStaticTexture(_location);
        }

        /// <summary>
        /// Разворот карты под камеру: камера стоит под ямом 45°, поэтому квадратная
        /// локация видна ромбом. Карта, повёрнутая на те же 45°, совпадает с экраном:
        /// север уходит влево-вверх, как и в самом мире. Масштаб 1/√2 вписывает
        /// повёрнутый квадрат в окно карты.
        /// </summary>
        public const float CameraAlignDeg = 45f;
        public const float CameraAlignScale = 0.70710678f;

        /// <summary>
        /// Поворот значка игрока на миникарте (градусы, ось Z канвы).
        ///
        /// Миникарта смотрит на мир сверху, север вверху: вправо — +X Unity (восток),
        /// вверх — +Z Unity (север, малые tz). Игрок с yaw θ смотрит в (sin θ, cos θ) —
        /// на карте это тот же вектор. Значок нарисован остриём вверх, поворот φ уводит
        /// остриё в (−sin φ, cos φ), поэтому φ = −θ. Сверяет RoaMinimapSnapshotProbe.
        /// </summary>
        public static float PlayerIconRotation(float headingDeg)
        {
            return -headingDeg;
        }

        public Vector2 WorldToMapNormalized(Vector3 world)
        {
            if (MapWidth <= 0 || MapDepth <= 0) return Vector2.zero;
            RoaCoords.WorldToTile(world, MapWidth, MapDepth, out int tx, out int tz);
            // Север вверху: координаты клиента тождественны серверным, север — +Z, а
            // тайл tz растёт вместе с +Z, то есть на СЕВЕР. Значит ось v ложится на tz
            // как есть — так же, как снимок камеры сверху (верх кадра — +Z) и схема
            // подложки (строка пикселей tz). Прежний переворот зеркалил значок игрока
            // и маркеры относительно картинки. Сверяет RoaMinimapSnapshotProbe.
            return new Vector2((tx + 0.5f) / MapWidth, (tz + 0.5f) / MapDepth);
        }

        private void OnDestroy()
        {
            DestroyRuntime(_staticTexture);
        }

        private void Update()
        {
            if (_location == null || Player == null) return;
            TakeSnapshotWhenWorldIsReady();
            if (Time.unscaledTime < _nextRefresh) return;
            _nextRefresh = Time.unscaledTime + Mathf.Max(0.05f, RefreshSeconds);
            RefreshMarkers();
        }

        /// <summary>
        /// Снимок снимается один раз на локацию — когда загрузчик закончил и мир стоит
        /// на месте. До этого миникарта показывает схему из данных локации.
        /// </summary>
        private void TakeSnapshotWhenWorldIsReady()
        {
            if (_snapshotAt <= 0f || Time.unscaledTime < _snapshotAt) return;
            RoaLocationLoader loader = RoaGameBootstrap.Active != null ? RoaGameBootstrap.Active.Loader : null;
            if (loader != null && (loader.IsLoading || loader.Current != _location)) return;
            if (_snapshot == null) _snapshot = gameObject.AddComponent<RoaMinimapSnapshot>();
            Color ground = GroundColor(_location.Ground?.Preset);
            ground.a = 1f;
            _snapshotAt = _snapshot.Capture(_location, ground) ? 0f : Time.unscaledTime + SnapshotDelaySeconds;
        }

        private void RefreshMarkers()
        {
            _markers.Clear();
            Enemies?.CollectMinimapMarkers(_markers);
            RemotePlayers?.CollectMinimapMarkers(_markers);
            GroundItems?.CollectMinimapMarkers(_markers);
            Interaction?.CollectMinimapMarkers(_markers);
            WorldActivity?.CollectMinimapMarkers(_markers);
        }

        private void BuildStaticTexture(LocationDefinition location)
        {
            _staticTexture = new Texture2D(MapWidth, MapDepth, TextureFormat.RGBA32, false)
            {
                name = "Minimap:" + location.Id,
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp
            };

            Color32 ground = GroundColor(location.Ground?.Preset);
            var pixels = new Color32[MapWidth * MapDepth];
            for (int i = 0; i < pixels.Length; i++) pixels[i] = ground;

            PaintAuthoritativeMap(pixels);

            if (location.Objects != null)
            {
                foreach (LocationObject entry in location.Objects)
                {
                    if (entry == null || entry.Position == null || entry.IsLiveEntity()) continue;
                    Color32 color;
                    if (!TryFeatureColor(entry, out color)) continue;
                    StaticFeatureCount++;
                    // Здание сцены Кромки рисуется своими стенами, а не заливкой размаха.
                    Color32 partColor = color;
                    if (RoaCollisionParts.ForEachTile(entry, MapWidth, MapDepth,
                            (x, z) => pixels[z * MapWidth + x] = partColor))
                        continue;
                    Vector3 world = RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z);
                    RoaCoords.WorldToTile(world, MapWidth, MapDepth, out int tx, out int tz);
                    int width = FootprintTiles(entry, true);
                    int depth = FootprintTiles(entry, false);
                    PaintFeature(pixels, tx, tz, width, depth, color);
                }
            }

            if (_location != null && _location.ExitZone != null && _location.CanExitAtEdge && _edgeExitAllowed)
                PaintEdgeExitBand(pixels);

            _staticTexture.SetPixels32(pixels);
            _staticTexture.Apply(false, false);
        }

        private void PaintEdgeExitBand(Color32[] pixels)
        {
            int band = Mathf.Min(RoaWorldExitBoundary.ExitBandTileCount,
                Mathf.Max(1, Mathf.Min(MapWidth, MapDepth) / 2));
            var gold = new Color32(246, 177, 47, 255);
            for (int tz = 0; tz < MapDepth; tz++)
            for (int tx = 0; tx < MapWidth; tx++)
            {
                int edge = Mathf.Min(Mathf.Min(tx, MapWidth - 1 - tx),
                    Mathf.Min(tz, MapDepth - 1 - tz));
                if (edge >= band) continue;
                int index = tz * MapWidth + tx;
                float strength = edge == 0 ? 0.82f : 0.48f;
                pixels[index] = Color32.Lerp(pixels[index], gold, strength);
            }
        }

        private void PaintAuthoritativeMap(Color32[] pixels)
        {
            if (_worldMap == null) return;
            int rows = Mathf.Min(MapDepth, _worldMap.Count);
            for (int tz = 0; tz < rows; tz++)
            {
                JArray row = _worldMap[tz] as JArray;
                if (row == null) continue;
                int columns = Mathf.Min(MapWidth, row.Count);
                for (int tx = 0; tx < columns; tx++)
                {
                    int type = row[tx]?.ToObject<int>() ?? 0;
                    Color32 color;
                    switch (type)
                    {
                        case 3: color = new Color32(16, 57, 73, 255); break;
                        case 4: color = new Color32(91, 67, 44, 255); break;
                        case 5: color = new Color32(188, 151, 95, 255); break;
                        case 1: color = new Color32(76, 79, 48, 255); break;
                        case 2:
                        case 6: color = new Color32(123, 116, 103, 255); break;
                        case 7: color = new Color32(112, 78, 43, 255); break;
                        case 8: color = new Color32(98, 79, 61, 255); break;
                        case 9: color = new Color32(72, 55, 39, 255); break;
                        default: continue;
                    }
                    pixels[tz * MapWidth + tx] = color;
                }
            }
        }

        private void PaintFeature(Color32[] pixels, int tx, int tz, int width, int depth, Color32 color)
        {
            int minX = tx - width / 2;
            int minZ = tz - depth / 2;
            for (int z = 0; z < depth; z++)
            {
                int tileZ = minZ + z;
                if (tileZ < 0 || tileZ >= MapDepth) continue;
                int pixelY = tileZ;
                for (int x = 0; x < width; x++)
                {
                    int tileX = minX + x;
                    if (tileX < 0 || tileX >= MapWidth) continue;
                    pixels[pixelY * MapWidth + tileX] = color;
                }
            }
        }

        private static bool TryFeatureColor(LocationObject entry, out Color32 color)
        {
            string resource = (entry.ResourceType ?? entry.Resource ?? string.Empty).ToLowerInvariant();
            string model = (entry.Model ?? string.Empty).ToLowerInvariant();
            if (!string.IsNullOrEmpty(resource) || entry.HasTag("resource"))
            {
                color = new Color32(158, 124, 60, 210);
                return true;
            }
            if (entry.HasTag("water") || model.Contains("water"))
            {
                color = new Color32(23, 83, 100, 210);
                return true;
            }
            if (entry.HasTag("path") || entry.HasTag("road") || model.Contains("road"))
            {
                color = new Color32(129, 102, 57, 210);
                return true;
            }
            if (entry.HasTag("tree") || model.Contains("tree") || model.Contains("bush"))
            {
                color = new Color32(45, 86, 37, 210);
                return true;
            }
            if (RoaAuthoredVision.Resolve(entry) != RoaAuthoredVision.Kind.Clear
                || entry.HasTag("wall") || entry.HasTag("roof") || entry.HasTag("structure"))
            {
                color = new Color32(102, 103, 93, 220);
                return true;
            }
            color = default;
            return false;
        }

        private static int FootprintTiles(LocationObject entry, bool horizontal)
        {
            float metres = 0f;
            if (entry.Footprint != null) metres = horizontal ? entry.Footprint.X : entry.Footprint.Z;
            if (entry.Placement?["cells"] != null)
            {
                float cells = entry.Placement["cells"][horizontal ? "x" : "z"]?.ToObject<float>() ?? 0f;
                if (cells > 0f) return Mathf.Clamp(Mathf.RoundToInt(cells), 1, 32);
            }
            return Mathf.Clamp(Mathf.CeilToInt(Mathf.Max(RoaCoords.Tile, metres) / RoaCoords.Tile), 1, 32);
        }

        private static Color32 GroundColor(string preset)
        {
            switch (preset)
            {
                case "ashForest": return new Color32(52, 70, 42, 230);
                case "scrapDust": return new Color32(78, 65, 43, 230);
                case "relayConcrete": return new Color32(72, 73, 68, 230);
                case "dryBasin": return new Color32(88, 72, 43, 230);
                case "ruinedRoad": return new Color32(63, 59, 49, 230);
                default: return new Color32(55, 74, 36, 230);
            }
        }

        private static void DestroyRuntime(Object target)
        {
            if (target == null) return;
            if (Application.isPlaying) Destroy(target);
            else DestroyImmediate(target);
        }
    }
}
