using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Visual local-world ground built from the server-authoritative tile snapshot.
    /// The browser deliberately hides its technical 38x38 planes and paints one
    /// continuous wasteland backplate with soft road, scorch and water patches.
    /// Unity follows the same composition, baked into one runtime texture so the
    /// result stays cheap on desktop and mobile and never exposes a square grid.
    /// </summary>
    public sealed class RoaLocalTerrain : MonoBehaviour
    {
        private const int Grass = 0;
        private const int Tree = 1;
        private const int Water = 3;
        private const int Dark = 4;
        private const int Path = 5;
        private const int Ore = 6;
        private const int Wood = 7;
        private const int Oil = 9;

        private LocationDefinition _location;
        private Mesh _mesh;
        private Material _material;
        private Texture2D _albedo;
        private Texture2D _microDetail;
        private int _textureSize;
        private float _visualWidth;
        private float _visualDepth;
        private int _mapSignature = int.MinValue;
        private GameObject _movementRoot;
        private RoaGroundDressing _groundDressing;

        public Renderer GroundRenderer { get; private set; }
        public int AuthoritativeMapWidth { get; private set; }
        public int AuthoritativeMapDepth { get; private set; }
        public int SurfaceDetailClusterCount { get { return _groundDressing != null ? _groundDressing.SurfaceClusterCount : 0; } }
        public int DistantRidgeCount { get { return _groundDressing != null ? _groundDressing.RidgeCount : 0; } }
        public int DetailVertexCount { get { return _groundDressing != null ? _groundDressing.VertexCount : 0; } }
        public int MicroDetailTextureSize { get { return _microDetail != null ? _microDetail.width : 0; } }
        public int AlbedoTextureSize { get { return _albedo != null ? _albedo.width : 0; } }
        public int PathConnectionCount { get; private set; }
        public bool UsesAuthoredEnvironment { get { return _groundDressing != null && _groundDressing.UsesAuthoredPrefabs; } }
        public int AuthoredEnvironmentPrefabCount { get { return _groundDressing != null ? _groundDressing.AuthoredPrefabCount : 0; } }
        public int GroundAccentCount { get { return _groundDressing != null ? _groundDressing.GroundAccentCount : 0; } }

        public void Initialize(LocationDefinition location, JArray stateMap)
        {
            _location = location;
            name = "Ground";

            float worldWidth = location != null ? location.WorldWidth : 76f;
            float worldDepth = location != null ? location.WorldDepth : 76f;
            bool settlement = IsSettlement;
            float edgeBorder = settlement ? 40f : 32f;
            _visualWidth = worldWidth + edgeBorder * 2f;
            _visualDepth = worldDepth + edgeBorder * 2f;
            _textureSize = AlbedoResolution(Application.isMobilePlatform);

            _mesh = BuildReliefMesh(_visualWidth, _visualDepth, settlement ? 48 : 12,
                location != null ? location.Seed : 1L, settlement);
            var filter = gameObject.AddComponent<MeshFilter>();
            filter.sharedMesh = _mesh;
            var renderer = gameObject.AddComponent<MeshRenderer>();
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = true;
            GroundRenderer = renderer;

            // The web relief is visual only. A flat authoritative walk surface keeps
            // movement/raycasting identical to the Node server's XZ simulation.
            var collider = gameObject.AddComponent<BoxCollider>();
            collider.center = new Vector3(0f, -0.12f, 0f);
            collider.size = new Vector3(worldWidth, 0.24f, worldDepth);
            BuildPlayableBoundary(location);
            _groundDressing = gameObject.GetComponent<RoaGroundDressing>();
            if (_groundDressing == null) _groundDressing = gameObject.AddComponent<RoaGroundDressing>();

            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (shader != null)
            {
                _material = new Material(shader) { name = "RuntimeLocalGround:" + (location?.Id ?? "unknown") };
                SetMaterialColor(_material, Color.white);
                if (_material.HasProperty("_Smoothness")) _material.SetFloat("_Smoothness", 0.015f);
                if (_material.HasProperty("_Glossiness")) _material.SetFloat("_Glossiness", 0.015f);
                renderer.sharedMaterial = _material;
                ApplyMicroDetail(_material, location != null ? location.Seed : 1L);
            }

            ApplyMap(stateMap, true);
        }

        public static int AlbedoResolution(bool mobile)
        {
            return mobile ? 512 : 1024;
        }

        /// <summary>Repaints the visual surface when the server publishes a new map.</summary>
        public bool ApplyMap(JArray stateMap, bool force = false)
        {
            int signature = MapSignature(stateMap);
            if (!force && signature == _mapSignature) return false;
            _mapSignature = signature;

            ReadMapSize(stateMap, out int mapWidth, out int mapDepth);
            AuthoritativeMapWidth = mapWidth;
            AuthoritativeMapDepth = mapDepth;
            PathConnectionCount = 0;
            BuildTileMovementColliders(stateMap, mapWidth, mapDepth);
            if (_groundDressing != null)
                _groundDressing.Build(_location, stateMap, mapWidth, mapDepth, _visualWidth, _visualDepth);

            if (_albedo == null || _albedo.width != _textureSize)
            {
                DestroyRuntime(_albedo);
                _albedo = new Texture2D(_textureSize, _textureSize, TextureFormat.RGBA32, true, false)
                {
                    name = "RuntimeLocalGroundAlbedo:" + (_location?.Id ?? "unknown"),
                    filterMode = FilterMode.Bilinear,
                    wrapMode = TextureWrapMode.Clamp,
                    anisoLevel = Application.isMobilePlatform ? 2 : 8
                };
            }

            Color32[] pixels = BuildBasePixels();
            if (IsSettlement) PaintSettlementLayers(pixels);
            else PaintAuthoritativeTiles(pixels, stateMap, mapWidth, mapDepth);
            PaintAmbientAge(pixels);

            _albedo.SetPixels32(pixels);
            _albedo.Apply(true, false);
            if (_material != null)
            {
                if (_material.HasProperty("_BaseMap")) _material.SetTexture("_BaseMap", _albedo);
                if (_material.HasProperty("_MainTex")) _material.SetTexture("_MainTex", _albedo);
            }
            return true;
        }

        /// <summary>
        /// The Node simulation treats only water as an ordinary full-tile terrain
        /// blocker. The legacy settlement additionally blocks its hand-built tree
        /// cells. Procedural trees, rocks, ruins and resources instead use their
        /// exact rotated model boxes from RoaLocationLoader, just like the server.
        /// Merge adjacent terrain-only cells so prediction stays cheap.
        /// </summary>
        private void BuildTileMovementColliders(JArray stateMap, int mapWidth, int mapDepth)
        {
            if (_movementRoot != null) DestroyRuntime(_movementRoot);
            _movementRoot = new GameObject("AuthoritativeTileMovement");
            // Movement-only volumes must not pretend that water or a low resource
            // tile blocks bullets. Physics.DefaultRaycastLayers excludes layer 2.
            _movementRoot.layer = 2;
            _movementRoot.transform.SetParent(transform, false);
            if (stateMap == null || mapWidth <= 0 || mapDepth <= 0) return;

            var blocked = new bool[mapWidth, mapDepth];
            var used = new bool[mapWidth, mapDepth];
            for (int z = 0; z < mapDepth; z++)
            {
                JArray row = z < stateMap.Count ? stateMap[z] as JArray : null;
                for (int x = 0; x < mapWidth; x++)
                {
                    int type = row != null && x < row.Count ? row[x]?.ToObject<int>() ?? Grass : Grass;
                    blocked[x, z] = BlocksTerrainMovement(type);
                }
            }

            int boxes = 0;
            for (int z = 0; z < mapDepth; z++)
            {
                for (int x = 0; x < mapWidth; x++)
                {
                    if (!blocked[x, z] || used[x, z]) continue;

                    int spanX = 1;
                    while (x + spanX < mapWidth && blocked[x + spanX, z] && !used[x + spanX, z])
                        spanX++;

                    int spanZ = 1;
                    bool extend = true;
                    while (z + spanZ < mapDepth && extend)
                    {
                        for (int sx = 0; sx < spanX; sx++)
                        {
                            if (!blocked[x + sx, z + spanZ] || used[x + sx, z + spanZ])
                            {
                                extend = false;
                                break;
                            }
                        }
                        if (extend) spanZ++;
                    }

                    for (int dz = 0; dz < spanZ; dz++)
                        for (int dx = 0; dx < spanX; dx++)
                            used[x + dx, z + dz] = true;

                    Vector3 first = RoaCoords.TileToWorld(x, z, mapWidth, mapDepth);
                    Vector3 last = RoaCoords.TileToWorld(x + spanX - 1, z + spanZ - 1, mapWidth, mapDepth);
                    var holder = new GameObject("BlockedTiles:" + x + ":" + z + ":" + spanX + "x" + spanZ);
                    holder.layer = 2;
                    holder.transform.SetParent(_movementRoot.transform, false);
                    var collider = holder.AddComponent<BoxCollider>();
                    collider.center = new Vector3((first.x + last.x) * 0.5f, 1.6f, (first.z + last.z) * 0.5f);
                    collider.size = new Vector3(spanX * RoaCoords.Tile, 3.2f, spanZ * RoaCoords.Tile);
                    boxes++;
                }
            }

            _movementRoot.name += ":" + boxes;
        }

        private bool BlocksTerrainMovement(int type)
        {
            return type == Water || (IsSettlement && type == Tree);
        }

        private bool IsSettlement
        {
            get { return string.Equals(_location?.Id, "settlement", System.StringComparison.Ordinal); }
        }

        private void BuildPlayableBoundary(LocationDefinition location)
        {
            if (location == null) return;
            int mapWidth = location.TileWidth;
            int mapDepth = location.TileDepth;

            // Стены строятся ВСЕГДА, даже когда играбельная зона совпадает с
            // картой. Ни одна из 30 авторских локаций не задаёт playableBounds,
            // и без стен по краю карты персонаж уходил за пределы мира и падал
            // с обрыва земли (проверено живым прогоном: y улетал к −270).
            // Web-клиент за границу не пускает всегда:
            // isWorldTerrainWalkableTile → false вне bounds (02c:1398).
            PlayableBoundsDefinition bounds = location.PlayableBounds;
            int minX = 0;
            int minZ = 0;
            int maxX = mapWidth - 1;
            int maxZ = mapDepth - 1;

            if (bounds != null && bounds.Width > 0 && bounds.Height > 0)
            {
                minX = bounds.MinX;
                minZ = bounds.MinZ;
                maxX = bounds.MaxX;
                maxZ = bounds.MaxZ;
            }

            float left = (minX - mapWidth / 2f) * RoaCoords.Tile;
            float right = (maxX + 1f - mapWidth / 2f) * RoaCoords.Tile;
            float top = (minZ - mapDepth / 2f) * RoaCoords.Tile;
            float bottom = (maxZ + 1f - mapDepth / 2f) * RoaCoords.Tile;
            float width = Mathf.Max(RoaCoords.Tile, right - left);
            float depth = Mathf.Max(RoaCoords.Tile, bottom - top);
            const float thickness = 0.24f;
            const float height = 3.2f;

            AddBoundaryBox("West", new Vector3(left - thickness * 0.5f, height * 0.5f, -(top + bottom) * 0.5f),
                new Vector3(thickness, height, depth));
            AddBoundaryBox("East", new Vector3(right + thickness * 0.5f, height * 0.5f, -(top + bottom) * 0.5f),
                new Vector3(thickness, height, depth));
            AddBoundaryBox("North", new Vector3((left + right) * 0.5f, height * 0.5f, -(top - thickness * 0.5f)),
                new Vector3(width, height, thickness));
            AddBoundaryBox("South", new Vector3((left + right) * 0.5f, height * 0.5f, -(bottom + thickness * 0.5f)),
                new Vector3(width, height, thickness));
        }

        private void AddBoundaryBox(string suffix, Vector3 center, Vector3 size)
        {
            var wall = new GameObject("PlayableBoundary:" + suffix);
            wall.transform.SetParent(transform, false);
            var box = wall.AddComponent<BoxCollider>();
            box.center = center;
            box.size = size;
        }

        private Color32[] BuildBasePixels()
        {
            var pixels = new Color32[_textureSize * _textureSize];
            int seed = unchecked((int)(_location != null ? _location.Seed : 1L));
            Color32 low = IsSettlement ? Hex(0x80603a) : Hex(0x725a3b);
            Color32 high = IsSettlement ? Hex(0xc2a471) : Hex(0xb79a68);
            Color32 dust = IsSettlement ? Hex(0xa78654) : Hex(0x9d7a4d);

            for (int y = 0; y < _textureSize; y++)
            {
                float worldZ = (y / (_textureSize - 1f) - 0.5f) * _visualDepth;
                for (int x = 0; x < _textureSize; x++)
                {
                    float worldX = (x / (_textureSize - 1f) - 0.5f) * _visualWidth;
                    float macro = SurfaceMacroSample(worldX, worldZ, seed);
                    float mottle = ValueNoise((worldX + macro * 2.1f) * 0.23f,
                        (worldZ - macro * 1.7f) * 0.21f, seed + 73);
                    float grain = ValueNoise(worldX * 1.15f, worldZ * 1.15f, seed + 79);
                    float tone = 0.47f + (macro - 0.5f) * 0.44f + (mottle - 0.5f) * 0.14f;
                    Color32 color = Lerp(low, high, tone);
                    color = Lerp(color, dust, 0.055f + grain * 0.075f);
                    pixels[y * _textureSize + x] = color;
                }
            }
            return pixels;
        }

        /// <summary>
        /// Continuous large-scale surface variation in world metres. Rotated coordinates
        /// and a low-frequency domain warp prevent the tile-sized square cells produced
        /// by sampling noise in texture pixels. The result is resolution-independent.
        /// </summary>
        public static float SurfaceMacroSample(float worldX, float worldZ, int seed)
        {
            float rotatedX = worldX * 0.82f + worldZ * 0.41f;
            float rotatedZ = worldZ * 0.86f - worldX * 0.37f;
            float warpX = (ValueNoise(rotatedX * 0.028f, rotatedZ * 0.028f, seed + 41) - 0.5f) * 9f;
            float warpZ = (ValueNoise(rotatedX * 0.031f, rotatedZ * 0.031f, seed + 47) - 0.5f) * 9f;
            float broad = ValueNoise((rotatedX + warpX) * 0.052f,
                (rotatedZ + warpZ) * 0.046f, seed + 53);
            float wash = ValueNoise((rotatedX - warpZ * 0.38f) * 0.105f,
                (rotatedZ + warpX * 0.28f) * 0.082f, seed + 59);
            float streak = ValueNoise((rotatedX + rotatedZ * 0.22f) * 0.15f,
                (rotatedZ - rotatedX * 0.08f) * 0.038f, seed + 61);
            return Mathf.Clamp01(broad * 0.58f + wash * 0.28f + streak * 0.14f);
        }

        private void PaintAuthoritativeTiles(Color32[] pixels, JArray stateMap, int mapWidth, int mapDepth)
        {
            if (stateMap == null || mapWidth <= 0 || mapDepth <= 0) return;
            int locationSeed = unchecked((int)(_location != null ? _location.Seed : 1L));
            for (int tz = 0; tz < mapDepth; tz++)
            {
                JArray row = tz < stateMap.Count ? stateMap[tz] as JArray : null;
                if (row == null) continue;
                for (int tx = 0; tx < mapWidth && tx < row.Count; tx++)
                {
                    int type = row[tx]?.ToObject<int>() ?? Grass;
                    Vector3 center = JitteredTileCenter(tx, tz, mapWidth, mapDepth);
                    float rotation = Hash01(tx, tz, 381) * Mathf.PI * 2f;

                    if (type == Water)
                    {
                        PaintEllipse(pixels, center.x, center.z, 2.36f, 1.84f, rotation + 0.34f,
                            Hex(0x695334), 0.42f, tx * 97 + tz * 193);
                        PaintEllipse(pixels, center.x, center.z, 1.88f, 1.48f, rotation,
                            Hex(0x1c5361), 0.82f, tx * 101 + tz * 197);
                    }
                    else if (type == Path)
                    {
                        PaintPathTile(pixels, stateMap, tx, tz, mapWidth, mapDepth, center);
                    }
                    else if (type == Dark)
                    {
                        PaintEllipse(pixels, center.x, center.z, 2.12f, 1.72f, rotation,
                            Hex(0x33261b), 0.38f, tx * 107 + tz * 211);
                    }

                    float h = Hash01(tx, tz, locationSeed);
                    float h2 = Hash01(tx, tz, 777);
                    float h3 = Hash01(tx, tz, 991);
                    if ((type == Grass || type == Dark) && h < 0.24f)
                    {
                        PaintEllipse(pixels, center.x + (h2 - 0.5f) * 0.8f,
                            center.z + (h3 - 0.5f) * 0.8f, 0.34f, 0.20f,
                            h3 * Mathf.PI, Hex(0x756640), 0.54f, tx + tz * 43);
                    }
                    if (type != Water && h3 < 0.10f)
                    {
                        PaintEllipse(pixels, center.x, center.z, 0.60f + h * 0.5f,
                            0.32f + h2 * 0.26f, rotation, Hex(0xe8c995), 0.18f, tx * 41 + tz);
                    }
                }
            }
        }

        private void PaintPathTile(Color32[] pixels, JArray stateMap, int tx, int tz,
                                   int mapWidth, int mapDepth, Vector3 center)
        {
            PaintEllipse(pixels, center.x, center.z, 2.46f, 2.18f, 0f,
                Hex(0x73583a), 0.16f, tx * 101 + tz * 197);
            PaintEllipse(pixels, center.x, center.z, 2.18f, 1.92f, 0f,
                Hex(0xb99764), 0.34f, tx * 103 + tz * 199);

            if (TileType(stateMap, tx + 1, tz, mapWidth, mapDepth) == Path)
                PaintPathConnection(pixels, center,
                    JitteredTileCenter(tx + 1, tz, mapWidth, mapDepth), tx, tz, 1);
            if (TileType(stateMap, tx, tz + 1, mapWidth, mapDepth) == Path)
                PaintPathConnection(pixels, center,
                    JitteredTileCenter(tx, tz + 1, mapWidth, mapDepth), tx, tz, 2);
        }
        private void PaintPathConnection(Color32[] pixels, Vector3 from, Vector3 to,
                                         int tx, int tz, int salt)
        {
            PathConnectionCount++;
            PaintLine(pixels, from.x, from.z, to.x, to.z, 1.12f,
                Hex(0x705538), 0.18f);
            PaintLine(pixels, from.x, from.z, to.x, to.z, 0.88f,
                Hex(0xb79561), 0.42f);
            Vector2 direction = new Vector2(to.x - from.x, to.z - from.z).normalized;
            Vector2 side = new Vector2(-direction.y, direction.x) * 0.29f;
            PaintLine(pixels, from.x + side.x, from.z + side.y,
                to.x + side.x, to.z + side.y, 0.090f,
                Hex(0x675035), 0.16f);
            PaintLine(pixels, from.x - side.x, from.z - side.y,
                to.x - side.x, to.z - side.y, 0.090f,
                Hex(0x675035), 0.16f);
            float t = 0.24f + Hash01(tx, tz, 430 + salt) * 0.52f;
            PaintEllipse(pixels, Mathf.Lerp(from.x, to.x, t), Mathf.Lerp(from.z, to.z, t),
                0.34f, 0.18f, Mathf.Atan2(direction.y, direction.x),
                Hex(0x71583a), 0.34f, tx * 131 + tz * 17 + salt);
        }
        private static int TileType(JArray stateMap, int tx, int tz, int mapWidth, int mapDepth)
        {
            if (stateMap == null || tx < 0 || tz < 0 || tx >= mapWidth || tz >= mapDepth
                || tz >= stateMap.Count) return -1;
            JArray row = stateMap[tz] as JArray;
            return row != null && tx < row.Count ? row[tx]?.ToObject<int>() ?? Grass : -1;
        }

        private static Vector3 JitteredTileCenter(int tx, int tz, int mapWidth, int mapDepth)
        {
            Vector3 center = RoaCoords.TileToWorld(tx, tz, mapWidth, mapDepth);
            center.x += (Hash01(tx, tz, 371) - 0.5f) * 0.18f;
            center.z += (Hash01(tx, tz, 373) - 0.5f) * 0.18f;
            return center;
        }

        private void PaintSettlementLayers(Color32[] pixels)
        {
            // Same authored zones as createTraderYardTerrainLayers() in the web client.
            PaintServerPatch(pixels, 0f, 2f, 28f, 22f, 0.01f, 0xc8a36c, 0.62f, 7601);
            PaintServerPatch(pixels, 0f, 22f, 28f, 4f, 0.02f, 0xc8a36c, 0.34f, 7602);
            PaintServerPatch(pixels, -25f, 2f, 4f, 21f, Mathf.PI / 2f, 0xc8a36c, 0.20f, 7603);
            PaintServerPatch(pixels, 25f, 2f, 4f, 21f, Mathf.PI / 2f, 0xc8a36c, 0.20f, 7604);
            PaintServerPatch(pixels, 0f, 1f, 24f, 17f, -0.04f, 0x4f3c2b, 0.20f, 7610);

            PaintServerPatch(pixels, 1f, -10f, 9.5f, 29f, 0.015f, 0xb89a62, 0.64f, 7620);
            PaintServerPatch(pixels, -13f, 3f, 13.5f, 7.2f, -0.02f, 0xb89a62, 0.46f, 7621);
            PaintServerPatch(pixels, 2f, 1f, 12f, 9f, 0.04f, 0xb89a62, 0.36f, 7622);

            PaintServerPatch(pixels, 3f, -8f, 7.4f, 16f, 0.02f, 0x5b4932, 0.32f, 7630);
            PaintServerPatch(pixels, 11f, 4f, 15f, 6f, -0.18f, 0x5b4932, 0.22f, 7631);
            PaintServerPatch(pixels, -12f, -5f, 13f, 8f, -0.02f, 0x362923, 0.30f, 7640);
            PaintServerPatch(pixels, 13f, 1f, 7f, 4f, 0.18f, 0x362923, 0.22f, 7641);
            PaintServerPatch(pixels, 15f, 10f, 15f, 15f, 0.10f, 0xa39173, 0.44f, 7650);
            PaintServerPatch(pixels, -5f, 11f, 5f, 4f, -0.08f, 0xa39173, 0.34f, 7651);

            // Cheap baked contact AO under the same important prop clusters.
            PaintServerPatch(pixels, -14.3f, 3.2f, 11.6f, 5.4f, 0f, 0x30261d, 0.30f, 7660);
            PaintServerPatch(pixels, -12f, -5f, 12f, 6.6f, 0f, 0x30261d, 0.24f, 7661);
            PaintServerPatch(pixels, -5f, 11f, 4.2f, 3f, 0.08f, 0x30261d, 0.22f, 7662);
            PaintServerPatch(pixels, 13f, 1f, 6f, 3.3f, 0.26f, 0x30261d, 0.20f, 7663);
            PaintServerPatch(pixels, 18f, 18f, 5.3f, 3.7f, 0f, 0x30261d, 0.20f, 7664);
        }

        private void PaintServerPatch(Color32[] pixels, float serverX, float serverZ,
            float sizeX, float sizeZ, float serverRotation, int rgb, float opacity, int seed)
        {
            PaintEllipse(pixels, serverX, -serverZ, sizeX, sizeZ, -serverRotation,
                Hex(rgb), opacity, seed);
        }

        private void PaintAmbientAge(Color32[] pixels)
        {
            int count = Application.isMobilePlatform ? 70 : 150;
            int seed = unchecked((int)(_location != null ? _location.Seed : 1L));
            for (int i = 0; i < count; i++)
            {
                float x = (Hash01(i, seed, 7701) - 0.5f) * _visualWidth * 0.62f;
                float z = (Hash01(i, seed, 7703) - 0.5f) * _visualDepth * 0.62f;
                float size = 0.18f + Hash01(i, seed, 7705) * 0.54f;
                Color32 color = Hash01(i, seed, 7707) > 0.48f ? Hex(0x665938) : Hex(0xb19b79);
                PaintEllipse(pixels, x, z, size, size * 0.55f,
                    Hash01(i, seed, 7709) * Mathf.PI, color, 0.30f, seed + i);
            }
        }


        private void PaintLine(Color32[] pixels, float x1, float z1, float x2, float z2,
            float width, Color32 color, float opacity)
        {
            float distance = Vector2.Distance(new Vector2(x1, z1), new Vector2(x2, z2));
            int steps = Mathf.Max(2, Mathf.CeilToInt(distance / Mathf.Max(0.04f, width)));
            for (int i = 0; i <= steps; i++)
            {
                float t = i / (float)steps;
                PaintEllipse(pixels, Mathf.Lerp(x1, x2, t), Mathf.Lerp(z1, z2, t),
                    width * 2f, width * 2f, 0f, color, opacity, i + steps * 17);
            }
        }

        private void PaintEllipse(Color32[] pixels, float centerX, float centerZ,
            float sizeX, float sizeZ, float rotation, Color32 color, float opacity, int seed)
        {
            if (sizeX <= 0.001f || sizeZ <= 0.001f || opacity <= 0.001f) return;
            float pixelsPerX = (_textureSize - 1f) / _visualWidth;
            float pixelsPerZ = (_textureSize - 1f) / _visualDepth;
            int radiusPx = Mathf.CeilToInt(Mathf.Max(sizeX * pixelsPerX, sizeZ * pixelsPerZ) * 0.58f) + 2;
            int centerPx = Mathf.RoundToInt((centerX / _visualWidth + 0.5f) * (_textureSize - 1));
            int centerPy = Mathf.RoundToInt((centerZ / _visualDepth + 0.5f) * (_textureSize - 1));
            float cos = Mathf.Cos(rotation);
            float sin = Mathf.Sin(rotation);
            float halfX = Mathf.Max(0.01f, sizeX * 0.5f);
            float halfZ = Mathf.Max(0.01f, sizeZ * 0.5f);

            int minX = Mathf.Max(0, centerPx - radiusPx);
            int maxX = Mathf.Min(_textureSize - 1, centerPx + radiusPx);
            int minY = Mathf.Max(0, centerPy - radiusPx);
            int maxY = Mathf.Min(_textureSize - 1, centerPy + radiusPx);
            for (int py = minY; py <= maxY; py++)
            {
                float worldZ = (py / (_textureSize - 1f) - 0.5f) * _visualDepth - centerZ;
                for (int px = minX; px <= maxX; px++)
                {
                    float worldX = (px / (_textureSize - 1f) - 0.5f) * _visualWidth - centerX;
                    float localX = cos * worldX + sin * worldZ;
                    float localZ = -sin * worldX + cos * worldZ;
                    float radial = Mathf.Sqrt(localX * localX / (halfX * halfX)
                        + localZ * localZ / (halfZ * halfZ));
                    float irregular = (Hash01(px, py, seed) - 0.5f) * 0.12f;
                    float coverage = Mathf.Clamp01((1.04f + irregular - radial) / 0.28f);
                    if (coverage <= 0f) continue;
                    int index = py * _textureSize + px;
                    pixels[index] = Lerp(pixels[index], color, opacity * coverage);
                }
            }
        }

        private Mesh BuildReliefMesh(float width, float depth, int segments, long seedValue, bool relief)
        {
            int side = segments + 1;
            var vertices = new Vector3[side * side];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[segments * segments * 6];
            int seed = unchecked((int)seedValue);
            int v = 0;
            for (int z = 0; z <= segments; z++)
            {
                float tz = z / (float)segments;
                for (int x = 0; x <= segments; x++)
                {
                    float tx = x / (float)segments;
                    float wx = (tx - 0.5f) * width;
                    float wz = (tz - 0.5f) * depth;
                    float baseY = relief ? -0.086f : -0.052f;
                    float lift = relief
                        ? (ValueNoise(wx * 0.11f, wz * 0.11f, seed + 601) - 0.5f) * 0.075f
                        : 0f;
                    vertices[v] = new Vector3(wx, baseY + lift, wz);
                    uv[v] = new Vector2(tx, tz);
                    v++;
                }
            }

            int t = 0;
            for (int z = 0; z < segments; z++)
            {
                for (int x = 0; x < segments; x++)
                {
                    int a = z * side + x;
                    int b = a + 1;
                    int c = a + side;
                    int d = c + 1;
                    triangles[t++] = a; triangles[t++] = c; triangles[t++] = b;
                    triangles[t++] = b; triangles[t++] = c; triangles[t++] = d;
                }
            }

            var mesh = new Mesh { name = "RuntimeLocalGroundMesh" };
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void ReadMapSize(JArray stateMap, out int width, out int depth)
        {
            depth = stateMap?.Count ?? 0;
            width = 0;
            if (stateMap == null) return;
            for (int z = 0; z < stateMap.Count; z++)
            {
                if (stateMap[z] is JArray row && row.Count > width) width = row.Count;
            }
        }

        private static int MapSignature(JArray stateMap)
        {
            if (stateMap == null) return 0;
            unchecked
            {
                int hash = 17;
                hash = hash * 31 + stateMap.Count;
                for (int z = 0; z < stateMap.Count; z++)
                {
                    JArray row = stateMap[z] as JArray;
                    hash = hash * 31 + (row?.Count ?? 0);
                    if (row == null) continue;
                    for (int x = 0; x < row.Count; x++) hash = hash * 31 + (row[x]?.ToObject<int>() ?? 0);
                }
                return hash;
            }
        }

        private static float ValueNoise(float x, float y, int seed)
        {
            int x0 = Mathf.FloorToInt(x);
            int y0 = Mathf.FloorToInt(y);
            float tx = Mathf.SmoothStep(0f, 1f, x - x0);
            float ty = Mathf.SmoothStep(0f, 1f, y - y0);
            float a = Hash01(x0, y0, seed);
            float b = Hash01(x0 + 1, y0, seed);
            float c = Hash01(x0, y0 + 1, seed);
            float d = Hash01(x0 + 1, y0 + 1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, tx), Mathf.Lerp(c, d, tx), ty);
        }

        /// <summary>Exact integer hash used by the browser terrain composer.</summary>
        private static float Hash01(int a, int b, int c)
        {
            unchecked
            {
                uint x = (uint)(((a ^ unchecked((int)0x9e3779b9)) * unchecked((int)0x85ebca6b)));
                x ^= (uint)((b + unchecked((int)0xc2b2ae35)) * unchecked((int)0x27d4eb2d));
                x ^= (uint)((c + unchecked((int)0x165667b1)) * unchecked((int)0x9e3779b1));
                x ^= x >> 15;
                return (x % 100000u) / 100000f;
            }
        }

        private static Color32 Hex(int rgb)
        {
            return new Color32((byte)((rgb >> 16) & 0xff), (byte)((rgb >> 8) & 0xff),
                (byte)(rgb & 0xff), 255);
        }

        private static Color32 Lerp(Color32 a, Color32 b, float t)
        {
            t = Mathf.Clamp01(t);
            return new Color32(
                (byte)Mathf.RoundToInt(Mathf.Lerp(a.r, b.r, t)),
                (byte)Mathf.RoundToInt(Mathf.Lerp(a.g, b.g, t)),
                (byte)Mathf.RoundToInt(Mathf.Lerp(a.b, b.b, t)),
                255);
        }

        private void ApplyMicroDetail(Material material, long seedValue)
        {
            if (material == null || !material.HasProperty("_DetailAlbedoMap")) return;
            int size = Application.isMobilePlatform ? 64 : 128;
            _microDetail = new Texture2D(size, size, TextureFormat.RGB24, true, true)
            {
                name = "RuntimeLocalGroundMicroDetail:" + (_location?.Id ?? "unknown"),
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Repeat,
                anisoLevel = Application.isMobilePlatform ? 2 : 8
            };
            int seed = unchecked((int)seedValue);
            var pixels = new Color32[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float broad = ValueNoise(x * 0.16f, y * 0.16f, seed + 9011);
                float grain = Hash01(x, y, seed + 9013);
                float value = Mathf.Clamp01(0.5f + (broad - 0.5f) * 0.14f + (grain - 0.5f) * 0.06f);
                byte channel = (byte)Mathf.RoundToInt(value * 255f);
                pixels[y * size + x] = new Color32(channel, channel, channel, 255);
            }
            _microDetail.SetPixels32(pixels);
            _microDetail.Apply(true, true);
            material.SetTexture("_DetailAlbedoMap", _microDetail);
            material.SetTextureScale("_DetailAlbedoMap", new Vector2(
                Mathf.Max(1f, _visualWidth / 4.2f), Mathf.Max(1f, _visualDepth / 4.2f)));
            if (material.HasProperty("_DetailAlbedoMapScale")) material.SetFloat("_DetailAlbedoMapScale", 0.48f);
            material.EnableKeyword("_DETAIL_MULX2");
        }

        private static void SetMaterialColor(Material material, Color color)
        {
            if (material == null) return;
            material.color = color;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        }

        private static void DestroyRuntime(Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }

        private void OnDestroy()
        {
            DestroyRuntime(_albedo);
            DestroyRuntime(_microDetail);
            DestroyRuntime(_material);
            DestroyRuntime(_mesh);
            _albedo = null;
            _microDetail = null;
            _material = null;
            _mesh = null;
        }
    }
}
