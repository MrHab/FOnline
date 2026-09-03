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

        public int MapWidth { get; private set; }
        public int MapDepth { get; private set; }
        public int StaticFeatureCount { get; private set; }
        public int MarkerCount { get { return _markers.Count; } }
        public string LocationName { get; private set; } = string.Empty;
        public Texture2D StaticTexture { get { return _staticTexture; } }
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
        private Texture2D _arrowTexture;
        private float _nextRefresh;

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
        }

        public void SetWorldMap(JArray worldMap)
        {
            _worldMap = worldMap != null ? (JArray)worldMap.DeepClone() : null;
            if (_location == null || MapWidth <= 0 || MapDepth <= 0) return;
            DestroyRuntime(_staticTexture);
            _staticTexture = null;
            BuildStaticTexture(_location);
        }

        public Vector2 WorldToMapNormalized(Vector3 world)
        {
            if (MapWidth <= 0 || MapDepth <= 0) return Vector2.zero;
            RoaCoords.WorldToTile(world, MapWidth, MapDepth, out int tx, out int tz);
            return new Vector2((tx + 0.5f) / MapWidth, (tz + 0.5f) / MapDepth);
        }

        private void OnDestroy()
        {
            DestroyRuntime(_staticTexture);
            DestroyRuntime(_arrowTexture);
        }

        private void Update()
        {
            if (_location == null || Player == null) return;
            if (Time.unscaledTime < _nextRefresh) return;
            _nextRefresh = Time.unscaledTime + Mathf.Max(0.05f, RefreshSeconds);
            RefreshMarkers();
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

        private void OnGUI()
        {
            RoaUiTheme.Apply();
            if (CanvasDriven) return;
            if (RoaGameBootstrap.BlocksWorldHud) return;
            if (_location == null || _staticTexture == null || Player == null || !Player.gameObject.activeInHierarchy)
                return;

            bool mobileLayout = RoaGameBootstrap.Active != null
                && RoaGameBootstrap.Active.MobileControls != null
                && RoaGameBootstrap.Active.MobileControls.ControlsEnabled;
            float size = mobileLayout
                ? Mathf.Clamp(Screen.height * 0.31f, 100f, 132f)
                : Mathf.Min(Size, Mathf.Max(120f, Screen.height - 70f));
            float margin = mobileLayout ? 8f : 12f;
            float top = mobileLayout ? 78f : 12f;
            float x = Screen.width - size - margin;
            Rect defaultPanel = new Rect(x - 6f, top, size + 12f, size + 42f);
            var panel = mobileLayout && !RoaHudLayout.Editing
                ? defaultPanel
                : RoaHudLayout.Resolve("minimap", defaultPanel);
            x = panel.x + 6f;
            GUI.Box(panel, GUIContent.none);
            GUI.Label(new Rect(x, panel.y + 5f, size, 20f), string.IsNullOrEmpty(LocationName) ? "Карта" : LocationName);
            var mapRect = new Rect(x, panel.y + 26f, size, size);

            // Мир Unity зеркалит ось Z относительно серверной (ToUnity: z → −z),
            // а миникарта строится в серверных тайлах, поэтому без разворота она
            // выглядит перевёрнутой вверх ногами относительно 3D-вида. Отражаем
            // карту по вертикали, чтобы верх миникарты совпадал с «от игрока».
            Matrix4x4 previousMatrix = GUI.matrix;
            GUIUtility.ScaleAroundPivot(new Vector2(1f, -1f), mapRect.center);
            GUI.DrawTexture(mapRect, _staticTexture, ScaleMode.StretchToFill, false);
            DrawGrid(mapRect);
            for (int i = 0; i < _markers.Count; i++) DrawMarker(mapRect, _markers[i]);
            GUI.matrix = previousMatrix;

            DrawPlayer(mapRect);

            Vector2 playerPoint = WorldToMapNormalized(Player.transform.position);
            int tx = Mathf.Clamp(Mathf.FloorToInt(playerPoint.x * MapWidth), 0, MapWidth - 1);
            int tz = Mathf.Clamp(Mathf.FloorToInt(playerPoint.y * MapDepth), 0, MapDepth - 1);
            GUI.Label(new Rect(x, mapRect.yMax + 2f, size, 18f), "клетка " + tx + ":" + tz);
            RoaHudLayout.HandleDrag("minimap", ref panel, "Мини-карта");
        }

        private static void DrawGrid(Rect rect)
        {
            Color previous = GUI.color;
            GUI.color = new Color(0.89f, 0.76f, 0.43f, 0.22f);
            for (int i = 1; i < 10; i++)
            {
                float x = rect.x + rect.width * i / 10f;
                float y = rect.y + rect.height * i / 10f;
                GUI.DrawTexture(new Rect(x, rect.y, 1f, rect.height), Texture2D.whiteTexture);
                GUI.DrawTexture(new Rect(rect.x, y, rect.width, 1f), Texture2D.whiteTexture);
            }
            GUI.color = previous;
        }

        private void DrawMarker(Rect rect, Marker marker)
        {
            Vector2 p = WorldToMapNormalized(marker.Position);
            if (p.x < 0f || p.y < 0f || p.x > 1f || p.y > 1f) return;
            Color color;
            float size;
            switch (marker.Kind)
            {
                case MarkerKind.Enemy: color = new Color(0.88f, 0.31f, 0.22f); size = 4f; break;
                case MarkerKind.FriendlyNpc: color = new Color(0.46f, 0.75f, 0.62f); size = 4f; break;
                case MarkerKind.ServiceNpc: color = new Color(0.95f, 0.75f, 0.30f); size = 5f; break;
                case MarkerKind.RemotePlayer: color = new Color(0.44f, 0.67f, 0.90f); size = 5f; break;
                case MarkerKind.GroundItem: color = new Color(0.90f, 0.84f, 0.50f); size = 3f; break;
                case MarkerKind.Container: color = new Color(0.90f, 0.71f, 0.35f); size = 4f; break;
                case MarkerKind.Objective: color = new Color(0.95f, 0.78f, 0.25f); size = 6f; break;
                case MarkerKind.Threat: color = new Color(0.96f, 0.24f, 0.16f); size = 8f; break;
                case MarkerKind.Extraction: color = new Color(0.42f, 0.82f, 0.40f); size = 7f; break;
                default: color = new Color(0.78f, 0.62f, 0.30f); size = 3f; break;
            }
            Rect markerRect = CenteredRect(rect, p, size);
            Color previous = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(markerRect, Texture2D.whiteTexture);
            GUI.color = previous;
        }

        private void DrawPlayer(Rect rect)
        {
            Vector2 p = WorldToMapNormalized(Player.transform.position);
            if (p.x < 0f || p.y < 0f || p.x > 1f || p.y > 1f) return;
            EnsureArrowTexture();
            // Карта отражена по вертикали (см. OnGUI), поэтому маркер игрока
            // рисуем с зеркальной координатой Y и зеркальным углом курса.
            Vector2 center = new Vector2(rect.x + p.x * rect.width,
                rect.y + (1f - p.y) * rect.height);
            Matrix4x4 previous = GUI.matrix;
            GUIUtility.RotateAroundPivot(-Player.transform.eulerAngles.y, center);
            GUI.DrawTexture(new Rect(center.x - 5f, center.y - 7f, 10f, 14f), _arrowTexture);
            GUI.matrix = previous;
        }

        private static Rect CenteredRect(Rect rect, Vector2 normalized, float size)
        {
            float x = rect.x + normalized.x * rect.width;
            float y = rect.y + normalized.y * rect.height;
            return new Rect(x - size * 0.5f, y - size * 0.5f, size, size);
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
                    Vector3 world = RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z);
                    RoaCoords.WorldToTile(world, MapWidth, MapDepth, out int tx, out int tz);
                    int width = FootprintTiles(entry, true);
                    int depth = FootprintTiles(entry, false);
                    PaintFeature(pixels, tx, tz, width, depth, color);
                    StaticFeatureCount++;
                }
            }

            _staticTexture.SetPixels32(pixels);
            _staticTexture.Apply(false, false);
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
                    int pixelY = MapDepth - 1 - tz;
                    pixels[pixelY * MapWidth + tx] = color;
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
                int pixelY = MapDepth - 1 - tileZ;
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

        private void EnsureArrowTexture()
        {
            if (_arrowTexture != null) return;
            _arrowTexture = new Texture2D(9, 13, TextureFormat.RGBA32, false)
            {
                name = "MinimapPlayerArrow",
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp
            };
            var pixels = new Color32[9 * 13];
            Color32 clear = new Color32(0, 0, 0, 0);
            Color32 fill = new Color32(230, 214, 143, 255);
            for (int i = 0; i < pixels.Length; i++) pixels[i] = clear;
            for (int y = 0; y < 10; y++)
            {
                int half = Mathf.Clamp((9 - y) / 2, 1, 4);
                for (int x = 4 - half; x <= 4 + half; x++) pixels[(12 - y) * 9 + x] = fill;
            }
            for (int y = 0; y < 5; y++)
                for (int x = 3; x <= 5; x++) pixels[y * 9 + x] = fill;
            _arrowTexture.SetPixels32(pixels);
            _arrowTexture.Apply(false, false);
        }

        private static void DestroyRuntime(Object target)
        {
            if (target == null) return;
            if (Application.isPlaying) Destroy(target);
            else DestroyImmediate(target);
        }
    }
}
