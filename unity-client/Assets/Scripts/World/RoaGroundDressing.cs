using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Cheap deterministic dressing for the runtime wasteland surface. It breaks up
    /// the empty backplate with ankle-high scrub, stones and a distant low ridge,
    /// while deliberately creating no colliders or gameplay state.
    /// </summary>
    public sealed class RoaGroundDressing : MonoBehaviour
    {
        private const int Grass = 0;
        private const int Dark = 4;
        public const int ScrubBladeCount = 7;
        public const int ScrubLobeCount = 3;
        public const int ScrubToneCount = 2;
        public const float MinimumSurfaceSpacing = 1.35f;
        public const int StoneClusterPieceCount = 4;

        private GameObject _root;
        private Mesh _scrubMesh;
        private Mesh _stoneMesh;
        private Material _scrubMaterial;
        private Material _secondaryScrubMaterial;
        private Material _stoneMaterial;
        private RoaEnvironmentPalette _palette;
        private readonly HashSet<Mesh> _countedMeshes = new HashSet<Mesh>();
        private readonly Dictionary<Material, Material> _authoredMaterialRemap
            = new Dictionary<Material, Material>();

        public int SurfaceClusterCount { get; private set; }
        public int ScrubClusterCount { get; private set; }
        public int DryScrubClusterCount { get; private set; }
        public int OliveScrubClusterCount { get; private set; }
        public int StoneClusterCount { get; private set; }
        public int RidgeCount { get; private set; }
        public int VertexCount { get; private set; }
        public float MinimumClusterSpacing { get; private set; }
        public bool UsesAuthoredPrefabs { get; private set; }
        public int AuthoredPrefabCount { get; private set; }
        public int AuthoredRendererCount { get; private set; }
        public int AuthoredShadowCasterCount { get; private set; }
        public int GroundAccentCount { get; private set; }
        public float MaximumDecorationHeight { get; private set; }
        public int CompatibleMaterialCount { get { return _authoredMaterialRemap.Count; } }

        public static int SurfaceBudget(bool mobile)
        {
            return mobile ? 24 : 40;
        }

        public static int RidgeBudget(bool mobile)
        {
            return mobile ? 8 : 12;
        }

        public static bool SupportsTile(int type)
        {
            return type == Grass || type == Dark;
        }

        public static int ScrubToneIndex(int index, int seed)
        {
            return Hash01(index, seed, 8115) < 0.48f ? 0 : 1;
        }

        public void Build(LocationDefinition location, JArray stateMap, int mapWidth, int mapDepth,
                          float visualWidth, float visualDepth)
        {
            ClearGenerated();
            if (location == null) return;

            bool mobile = Application.isMobilePlatform;
            bool settlement = string.Equals(location.Id, "settlement", StringComparison.Ordinal);
            int seed = unchecked((int)location.Seed);
            float worldWidth = Mathf.Max(RoaCoords.Tile, location.WorldWidth);
            float worldDepth = Mathf.Max(RoaCoords.Tile, location.WorldDepth);

            _palette = Resources.Load<RoaEnvironmentPalette>(RoaEnvironmentPalette.ResourceKey);
            UsesAuthoredPrefabs = _palette != null && _palette.Ready;
            _root = new GameObject("GroundDressing");
            _root.transform.SetParent(transform, false);

            var scrubVertices = new List<Vector3>();
            var dryScrubTriangles = new List<int>();
            var oliveScrubTriangles = new List<int>();
            var stoneVertices = new List<Vector3>();
            var stoneTriangles = new List<int>();

            int budget = SurfaceBudget(mobile);
            var accepted = new List<Vector2>();
            float minimumSpacing = float.PositiveInfinity;
            int attempts = budget * 12;
            for (int i = 0; i < attempts && SurfaceClusterCount < budget; i++)
            {
                float x = (Hash01(i, seed, 8101) - 0.5f) * worldWidth * 0.92f;
                float z = (Hash01(i, seed, 8103) - 0.5f) * worldDepth * 0.92f;
                if (!SupportsPosition(location, stateMap, mapWidth, mapDepth, x, z, settlement)) continue;
                if (KeepClear(location, x, z, mapWidth, mapDepth, settlement)) continue;

                float patch = PatchDensity(x, z, seed);
                if (Hash01(i, seed, 8167) > 0.24f + patch * 0.72f) continue;
                Vector2 point = new Vector2(x, z);
                float nearest = NearestDistance(point, accepted);
                if (nearest < MinimumSurfaceSpacing) continue;

                float yaw = Hash01(i, seed, 8107) * Mathf.PI * 2f;
                float sizeRandom = Hash01(i, seed, 8111);
                float scale = 0.65f + Mathf.Pow(sizeRandom, 1.65f) * 0.72f;
                if (Hash01(i, seed, 8113) < Mathf.Lerp(0.50f, 0.70f, patch))
                {
                    int tone = ScrubToneIndex(i, seed);
                    if (UsesAuthoredPrefabs)
                    {
                        float radius = Mathf.Lerp(0.60f, 0.95f, sizeRandom);
                        AppendAuthoredPrefab(_palette.PickDryScrub(i + tone * 19, seed),
                            new Vector3(x, 0.006f, z), yaw, radius, 0.72f,
                            tone == 0 ? "DryScrub" : "OliveScrub", false);
                    }
                    else
                    {
                        AppendScrub(scrubVertices, tone == 0 ? dryScrubTriangles : oliveScrubTriangles,
                            new Vector3(x, 0.004f, z), yaw, scale, i, seed);
                    }
                    ScrubClusterCount++;
                    if (tone == 0) DryScrubClusterCount++;
                    else OliveScrubClusterCount++;
                }
                else
                {
                    if (UsesAuthoredPrefabs)
                    {
                        float radius = Mathf.Lerp(0.48f, 0.78f, sizeRandom);
                        AppendAuthoredPrefab(_palette.PickStone(i, seed),
                            new Vector3(x, -0.008f, z), yaw, radius, 0.58f,
                            "StoneCluster", false);
                    }
                    else
                    {
                        AppendStoneCluster(stoneVertices, stoneTriangles,
                            new Vector3(x, -0.012f, z), yaw, scale, i, seed);
                    }
                    StoneClusterCount++;
                }
                if (UsesAuthoredPrefabs && Hash01(i, seed, 8189) < 0.18f)
                {
                    float accentRadius = 0.85f + Hash01(i, seed, 8191) * 0.55f;
                    AppendAuthoredPrefab(_palette.PickGroundAccent(i, seed),
                        new Vector3(x, -0.014f, z), yaw + 0.47f, accentRadius, 0.075f,
                        "GroundAccent", false);
                    GroundAccentCount++;
                }
                if (!float.IsInfinity(nearest)) minimumSpacing = Mathf.Min(minimumSpacing, nearest);
                accepted.Add(point);
                SurfaceClusterCount++;
            }
            MinimumClusterSpacing = float.IsInfinity(minimumSpacing) ? 0f : minimumSpacing;
            if (UsesAuthoredPrefabs)
                AppendAuthoredRidges(worldWidth, worldDepth, Mathf.Max(worldWidth, visualWidth),
                    Mathf.Max(worldDepth, visualDepth), seed, mobile);
            else
                AppendDistantRidge(stoneVertices, stoneTriangles, worldWidth, worldDepth,
                    Mathf.Max(worldWidth, visualWidth), Mathf.Max(worldDepth, visualDepth), seed, mobile);

            if (scrubVertices.Count > 0)
            {
                _scrubMesh = CreateMesh("RuntimeGroundScrubMesh", scrubVertices,
                    dryScrubTriangles, oliveScrubTriangles);
                _scrubMaterial = CreateMaterial("RuntimeGroundDryScrubMaterial",
                    settlement ? new Color(0.50f, 0.40f, 0.20f) : new Color(0.47f, 0.39f, 0.20f),
                    true, 0f);
                _secondaryScrubMaterial = CreateMaterial("RuntimeGroundOliveScrubMaterial",
                    settlement ? new Color(0.37f, 0.40f, 0.18f) : new Color(0.34f, 0.37f, 0.18f),
                    true, 0f);
                CreateRenderNode("Scrub", _scrubMesh,
                    new[] { _scrubMaterial, _secondaryScrubMaterial }, false);
            }
            if (stoneVertices.Count > 0)
            {
                _stoneMesh = CreateMesh("RuntimeGroundStoneMesh", stoneVertices, stoneTriangles);
                _stoneMaterial = CreateMaterial("RuntimeGroundStoneMaterial",
                    settlement ? new Color(0.50f, 0.43f, 0.35f) : new Color(0.46f, 0.42f, 0.36f),
                    false, 0.035f);
                CreateRenderNode("StonesAndDistantRidge", _stoneMesh, _stoneMaterial, false);
            }
            VertexCount += scrubVertices.Count + stoneVertices.Count;
        }

        private static bool SupportsPosition(LocationDefinition location, JArray stateMap,
                                             int mapWidth, int mapDepth, float x, float z,
                                             bool settlement)
        {
            if (stateMap == null || mapWidth <= 0 || mapDepth <= 0) return settlement;
            RoaCoords.WorldToTile(new Vector3(x, 0f, z), mapWidth, mapDepth, out int tx, out int tz);
            if (tx < 0 || tz < 0 || tx >= mapWidth || tz >= mapDepth || tz >= stateMap.Count) return false;
            JArray row = stateMap[tz] as JArray;
            if (row == null || tx >= row.Count) return false;
            return SupportsTile(row[tx]?.ToObject<int>() ?? Grass);
        }

        private static bool KeepClear(LocationDefinition location, float x, float z,
                                      int mapWidth, int mapDepth, bool settlement)
        {
            Vector2 point = new Vector2(x, z);
            if (settlement && Mathf.Abs(x) < 28f && Mathf.Abs(z) < 24f) return true;
            if (!settlement && point.sqrMagnitude < 13.5f) return true;

            if (NearTile(point, location.Spawn, mapWidth, mapDepth, 2.6f)
                || NearTile(point, location.EntryFromWorld, mapWidth, mapDepth, 2.6f)) return true;
            if (location.Exit != null && NearTile(point,
                new TileCoord { Tx = location.Exit.Tx, Tz = location.Exit.Tz }, mapWidth, mapDepth, 2.8f)) return true;
            if (location.Transitions != null)
            {
                for (int i = 0; i < location.Transitions.Count; i++)
                {
                    LocationTransition transition = location.Transitions[i];
                    if (transition != null && NearTile(point,
                        new TileCoord { Tx = transition.Tx, Tz = transition.Tz },
                        mapWidth, mapDepth, Mathf.Max(2.5f, transition.Radius + 0.8f))) return true;
                }
            }

            if (location.Objects == null) return false;
            for (int i = 0; i < location.Objects.Count; i++)
            {
                LocationObject entry = location.Objects[i];
                if (entry?.Position == null) continue;
                Vector3 world = RoaCoords.ToUnity(entry.Position.X, entry.Position.Y, entry.Position.Z);
                Vector2 delta = point - new Vector2(world.x, world.z);
                float radius = entry.IsLiveEntity() ? 1.2f : 1.85f;
                if (delta.sqrMagnitude < radius * radius) return true;
            }
            return false;
        }

        private static bool NearTile(Vector2 point, TileCoord tile, int mapWidth, int mapDepth, float radius)
        {
            if (tile == null || mapWidth <= 0 || mapDepth <= 0) return false;
            Vector3 world = RoaCoords.TileToWorld(tile.Tx, tile.Tz, mapWidth, mapDepth);
            Vector2 delta = point - new Vector2(world.x, world.z);
            return delta.sqrMagnitude < radius * radius;
        }

        private static void AppendScrub(List<Vector3> vertices, List<int> triangles,
                                        Vector3 center, float yaw, float scale, int index, int seed)
        {
            for (int blade = 0; blade < ScrubBladeCount; blade++)
            {
                int lobe = blade % ScrubLobeCount;
                float lobeAngle = yaw + lobe * (Mathf.PI * 2f / ScrubLobeCount)
                    + (Hash01(index, lobe, seed + 8119) - 0.5f) * 0.74f;
                float angle = lobeAngle + (Hash01(index, blade, seed + 8120) - 0.5f) * 0.82f;
                float lobeWeight = 0.62f + Hash01(index, lobe, seed + 8117) * 0.38f;
                float length = (0.18f + Hash01(index, blade, seed + 8121) * 0.24f)
                    * scale * lobeWeight;
                float height = (0.10f + Hash01(index, blade, seed + 8123) * 0.14f) * scale;
                float width = (0.055f + Hash01(index, blade, seed + 8125) * 0.040f) * scale;
                Vector3 direction = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle));
                Vector3 tangent = new Vector3(-direction.z, 0f, direction.x);
                float rootSpread = (0.012f + Hash01(index, blade, seed + 8124) * 0.040f) * scale;
                Vector3 sideOffset = tangent
                    * ((Hash01(index, blade, seed + 8126) - 0.5f) * 0.10f * scale);
                Vector3 branchStart = center + direction * rootSpread + sideOffset;
                float curl = (Hash01(index, blade, seed + 8128) - 0.5f) * 0.14f * scale;
                Vector3 branchEnd = branchStart + direction * length + tangent * curl
                    + Vector3.up * height;
                AppendTaperedBranch(vertices, triangles, branchStart, branchEnd, width,
                    width * (0.42f + Hash01(index, blade, seed + 8127) * 0.22f));
            }
            AppendStone(vertices, triangles, center - Vector3.up * 0.012f, yaw,
                0.16f * scale, 0.12f * scale, index, seed + 53, 5);
        }

        private static void AppendTaperedBranch(List<Vector3> vertices, List<int> triangles,
                                                Vector3 from, Vector3 to,
                                                float baseRadius, float tipRadius)
        {
            Vector3 axis = (to - from).normalized;
            Vector3 lateral = Vector3.Cross(Vector3.up, axis).normalized;
            if (lateral.sqrMagnitude < 0.5f) lateral = Vector3.right;
            Vector3 vertical = Vector3.Cross(axis, lateral).normalized;
            int start = vertices.Count;
            vertices.Add(from - lateral * baseRadius - vertical * baseRadius * 0.55f);
            vertices.Add(from + lateral * baseRadius - vertical * baseRadius * 0.55f);
            vertices.Add(from + lateral * baseRadius + vertical * baseRadius * 0.55f);
            vertices.Add(from - lateral * baseRadius + vertical * baseRadius * 0.55f);
            vertices.Add(to - lateral * tipRadius - vertical * tipRadius * 0.55f);
            vertices.Add(to + lateral * tipRadius - vertical * tipRadius * 0.55f);
            vertices.Add(to + lateral * tipRadius + vertical * tipRadius * 0.55f);
            vertices.Add(to - lateral * tipRadius + vertical * tipRadius * 0.55f);
            AppendQuad(triangles, start, 0, 1, 5, 4);
            AppendQuad(triangles, start, 1, 2, 6, 5);
            AppendQuad(triangles, start, 2, 3, 7, 6);
            AppendQuad(triangles, start, 3, 0, 4, 7);
            AppendQuad(triangles, start, 4, 5, 6, 7);
        }

        private static void AppendStoneCluster(List<Vector3> vertices, List<int> triangles,
                                               Vector3 center, float yaw, float scale,
                                               int index, int seed)
        {
            for (int piece = 0; piece < StoneClusterPieceCount; piece++)
            {
                float angle = yaw + piece * Mathf.PI * 0.72f
                    + (Hash01(index, piece, seed + 8135) - 0.5f) * 0.42f;
                float spread = piece == 0 ? 0f
                    : (0.22f + Hash01(index, piece, seed + 8137) * 0.20f) * scale;
                Vector3 offset = new Vector3(Mathf.Cos(angle) * spread, 0f,
                    Mathf.Sin(angle) * spread);
                float baseRadius = piece == 0
                    ? 0.25f + Hash01(index, piece, seed + 8139) * 0.10f
                    : 0.12f + Hash01(index, piece, seed + 8140) * 0.08f;
                float radius = baseRadius * scale;
                float height = radius * (0.54f + Hash01(index, piece, seed + 8142) * 0.24f);
                AppendStone(vertices, triangles, center + offset, angle, radius, height,
                    index * StoneClusterPieceCount + piece, seed + 19, 6);
            }
        }

        private static void AppendStone(List<Vector3> vertices, List<int> triangles,
                                        Vector3 center, float yaw, float radius, float height,
                                        int index, int seed, int sides)
        {
            int start = vertices.Count;
            for (int side = 0; side < sides; side++)
            {
                float angle = yaw + side / (float)sides * Mathf.PI * 2f;
                float jitter = 0.74f + Hash01(index, side, seed + 8131) * 0.42f;
                vertices.Add(center + new Vector3(Mathf.Cos(angle) * radius * jitter,
                    0f, Mathf.Sin(angle) * radius * (0.72f + jitter * 0.22f)));
            }
            int shoulder = vertices.Count;
            for (int side = 0; side < sides; side++)
            {
                float angle = yaw + 0.08f + side / (float)sides * Mathf.PI * 2f;
                float jitter = 0.82f + Hash01(index, side, seed + 8133) * 0.30f;
                vertices.Add(center + new Vector3(Mathf.Cos(angle) * radius * 0.72f * jitter,
                    height * (0.52f + Hash01(index, side, seed + 8134) * 0.12f),
                    Mathf.Sin(angle) * radius * 0.66f * jitter));
            }
            int crown = vertices.Count;
            vertices.Add(center + new Vector3(
                (Hash01(index, seed, 8173) - 0.5f) * radius * 0.30f,
                height,
                (Hash01(index, seed, 8177) - 0.5f) * radius * 0.30f));
            for (int side = 0; side < sides; side++)
            {
                int next = (side + 1) % sides;
                AppendQuad(triangles, 0, start + side, start + next,
                    shoulder + next, shoulder + side);
                triangles.Add(shoulder + side);
                triangles.Add(shoulder + next);
                triangles.Add(crown);
            }
        }

        private static void AppendQuad(List<int> triangles, int offset,
                                       int a, int b, int c, int d)
        {
            triangles.Add(offset + a); triangles.Add(offset + c); triangles.Add(offset + b);
            triangles.Add(offset + a); triangles.Add(offset + d); triangles.Add(offset + c);
        }

        private void AppendAuthoredRidges(float worldWidth, float worldDepth,
                                          float visualWidth, float visualDepth,
                                          int seed, bool mobile)
        {
            int count = RidgeBudget(mobile);
            float playableX = worldWidth * 0.5f;
            float playableZ = worldDepth * 0.5f;
            float outerX = visualWidth * 0.5f - 3f;
            float outerZ = visualDepth * 0.5f - 3f;
            for (int i = 0; i < count; i++)
            {
                int side = i & 3;
                float along = Hash01(i, seed, 8141) * 2f - 1f;
                float depth = 0.28f + Hash01(i, seed, 8143) * 0.58f;
                float x;
                float z;
                if (side == 0 || side == 1)
                {
                    x = along * Mathf.Max(4f, outerX - 2f);
                    z = Mathf.Lerp(playableZ + 5f, outerZ, depth) * (side == 0 ? 1f : -1f);
                }
                else
                {
                    x = Mathf.Lerp(playableX + 5f, outerX, depth) * (side == 2 ? 1f : -1f);
                    z = along * Mathf.Max(4f, outerZ - 2f);
                }

                float radius = 1.65f + Hash01(i, seed, 8147) * 1.45f;
                float height = 1.10f + Hash01(i, seed, 8149) * 1.20f;
                AppendAuthoredPrefab(_palette.PickDistantRidge(i, seed),
                    new Vector3(x, -0.075f, z), Hash01(i, seed, 8153) * Mathf.PI * 2f,
                    radius, height, "DistantRidge", true);
                RidgeCount++;
            }
        }

        private void AppendAuthoredPrefab(GameObject prefab, Vector3 localBase,
                                           float yawRadians, float targetRadius,
                                           float maximumHeight, string role, bool distant)
        {
            if (prefab == null || _root == null) return;

            GameObject instance = Instantiate(prefab, _root.transform);
            instance.name = "Authored_" + role + "_" + AuthoredPrefabCount.ToString("D3");
            instance.transform.localPosition = localBase;
            instance.transform.localRotation = Quaternion.Euler(0f, yawRadians * Mathf.Rad2Deg, 0f);

            StripGameplayComponents(instance);
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (!TryRendererBounds(renderers, out Bounds bounds))
            {
                DisposeObject(instance);
                return;
            }

            float horizontalRadius = Mathf.Max(0.001f, Mathf.Max(bounds.extents.x, bounds.extents.z));
            float height = Mathf.Max(0.001f, bounds.size.y);
            float scale = targetRadius / horizontalRadius;
            scale = Mathf.Min(scale, maximumHeight / height);
            scale = Mathf.Clamp(scale, 0.025f, distant ? 4f : 2.2f);
            instance.transform.localScale *= scale;

            renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (TryRendererBounds(renderers, out bounds))
            {
                float desiredGroundY = _root.transform.TransformPoint(localBase).y;
                instance.transform.position += Vector3.up * (desiredGroundY - bounds.min.y);
                if (TryRendererBounds(renderers, out bounds))
                    MaximumDecorationHeight = Mathf.Max(MaximumDecorationHeight, bounds.size.y);
            }

            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                if (renderer == null) continue;
                renderer.sharedMaterials = BuildCompatibleMaterials(renderer.sharedMaterials);
                bool castContactShadow = !distant
                    && string.Equals(role, "StoneCluster", StringComparison.Ordinal);
                renderer.shadowCastingMode = castContactShadow
                    ? ShadowCastingMode.On : ShadowCastingMode.Off;
                if (castContactShadow) AuthoredShadowCasterCount++;
                renderer.receiveShadows = true;
                renderer.lightProbeUsage = LightProbeUsage.BlendProbes;
                renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
                AuthoredRendererCount++;

                Mesh mesh = null;
                if (renderer is SkinnedMeshRenderer skinned) mesh = skinned.sharedMesh;
                else
                {
                    MeshFilter filter = renderer.GetComponent<MeshFilter>();
                    if (filter != null) mesh = filter.sharedMesh;
                }
                if (mesh != null && _countedMeshes.Add(mesh)) VertexCount += mesh.vertexCount;
            }

            AuthoredPrefabCount++;
        }

        private Material[] BuildCompatibleMaterials(Material[] sourceMaterials)
        {
            if (sourceMaterials == null || sourceMaterials.Length == 0)
                return Array.Empty<Material>();
            var compatible = new Material[sourceMaterials.Length];
            for (int i = 0; i < sourceMaterials.Length; i++)
                compatible[i] = CompatibleMaterial(sourceMaterials[i]);
            return compatible;
        }

        private Material CompatibleMaterial(Material source)
        {
            if (source == null) return null;
            string shaderName = source.shader != null ? source.shader.name : string.Empty;
            if (shaderName.StartsWith("Universal Render Pipeline/", StringComparison.Ordinal))
                return source;
            if (_authoredMaterialRemap.TryGetValue(source, out Material cached)) return cached;

            Shader shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            if (shader == null) return source;
            var material = new Material(shader)
            {
                name = "RuntimeMEP_" + source.name,
                enableInstancing = true
            };

            Texture albedo = TextureProperty(source, "_BaseMap", "_MainTex");
            Color tint = ColorProperty(source, "_BaseColor", "_Color", Color.white);
            bool alphaClip = source.IsKeywordEnabled("_ALPHATEST_ON")
                || string.Equals(source.GetTag("RenderType", false, string.Empty),
                    "TransparentCutout", StringComparison.OrdinalIgnoreCase);
            if (alphaClip)
                tint = Color.Lerp(tint, new Color(0.76f, 0.66f, 0.43f, tint.a), 0.30f);
            SetTexture(material, "_BaseMap", albedo);
            SetTexture(material, "_MainTex", albedo);
            CopyTextureTransform(source, material, "_BaseMap", "_MainTex");
            SetColor(material, "_BaseColor", tint);
            SetColor(material, "_Color", tint);

            Texture normal = TextureProperty(source, "_BumpMap");
            if (normal != null)
            {
                SetTexture(material, "_BumpMap", normal);
                if (material.HasProperty("_BumpScale")) material.SetFloat("_BumpScale",
                    FloatProperty(source, "_BumpScale", 1f));
                material.EnableKeyword("_NORMALMAP");
            }
            Texture occlusion = TextureProperty(source, "_OcclusionMap");
            if (occlusion != null)
            {
                SetTexture(material, "_OcclusionMap", occlusion);
                if (material.HasProperty("_OcclusionStrength")) material.SetFloat("_OcclusionStrength",
                    FloatProperty(source, "_OcclusionStrength", 1f));
            }

            float smoothness = Mathf.Clamp(FloatProperty(source, "_Smoothness",
                FloatProperty(source, "_Glossiness", 0.04f)), 0f, 0.35f);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", 0f);

            ConfigureOpaqueSurface(material, alphaClip,
                FloatProperty(source, "_Cutoff", 0.5f));
            _authoredMaterialRemap[source] = material;
            return material;
        }

        private static void ConfigureOpaqueSurface(Material material, bool alphaClip, float cutoff)
        {
            if (material.HasProperty("_Surface")) material.SetFloat("_Surface", 0f);
            if (material.HasProperty("_Blend")) material.SetFloat("_Blend", 0f);
            if (material.HasProperty("_AlphaClip")) material.SetFloat("_AlphaClip", alphaClip ? 1f : 0f);
            if (material.HasProperty("_Cutoff")) material.SetFloat("_Cutoff", Mathf.Clamp01(cutoff));
            if (material.HasProperty("_SrcBlend")) material.SetFloat("_SrcBlend", (float)BlendMode.One);
            if (material.HasProperty("_DstBlend")) material.SetFloat("_DstBlend", (float)BlendMode.Zero);
            if (material.HasProperty("_ZWrite")) material.SetFloat("_ZWrite", 1f);
            if (alphaClip)
            {
                material.EnableKeyword("_ALPHATEST_ON");
                material.SetOverrideTag("RenderType", "TransparentCutout");
                material.renderQueue = (int)RenderQueue.AlphaTest;
                if (material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
                material.doubleSidedGI = true;
            }
            else
            {
                material.DisableKeyword("_ALPHATEST_ON");
                material.SetOverrideTag("RenderType", "Opaque");
                material.renderQueue = (int)RenderQueue.Geometry;
            }
        }

        private static Texture TextureProperty(Material material, params string[] names)
        {
            if (material == null || names == null) return null;
            for (int i = 0; i < names.Length; i++)
                if (material.HasProperty(names[i]) && material.GetTexture(names[i]) != null)
                    return material.GetTexture(names[i]);
            return null;
        }

        private static Color ColorProperty(Material material, string first, string second, Color fallback)
        {
            if (material != null && material.HasProperty(first)) return material.GetColor(first);
            if (material != null && material.HasProperty(second)) return material.GetColor(second);
            return fallback;
        }

        private static float FloatProperty(Material material, string name, float fallback)
        {
            return material != null && material.HasProperty(name) ? material.GetFloat(name) : fallback;
        }

        private static void SetTexture(Material material, string name, Texture texture)
        {
            if (texture != null && material.HasProperty(name)) material.SetTexture(name, texture);
        }

        private static void SetColor(Material material, string name, Color color)
        {
            if (material.HasProperty(name)) material.SetColor(name, color);
        }

        private static void CopyTextureTransform(Material source, Material target,
                                                 string targetName, params string[] sourceNames)
        {
            if (!target.HasProperty(targetName)) return;
            for (int i = 0; i < sourceNames.Length; i++)
            {
                string sourceName = sourceNames[i];
                if (!source.HasProperty(sourceName)) continue;
                target.SetTextureScale(targetName, source.GetTextureScale(sourceName));
                target.SetTextureOffset(targetName, source.GetTextureOffset(sourceName));
                return;
            }
        }

        private static bool TryRendererBounds(Renderer[] renderers, out Bounds bounds)
        {
            bounds = default;
            bool found = false;
            if (renderers == null) return false;
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                if (renderer == null || !renderer.enabled) continue;
                if (!found) { bounds = renderer.bounds; found = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            return found;
        }

        private static void StripGameplayComponents(GameObject instance)
        {
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++)
            {
                if (colliders[i] == null) continue;
                colliders[i].enabled = false;
                DisposeObject(colliders[i]);
            }
            Rigidbody[] bodies = instance.GetComponentsInChildren<Rigidbody>(true);
            for (int i = 0; i < bodies.Length; i++) DisposeObject(bodies[i]);
        }

        private void AppendDistantRidge(List<Vector3> vertices, List<int> triangles,
                                        float worldWidth, float worldDepth,
                                        float visualWidth, float visualDepth, int seed, bool mobile)
        {
            int count = RidgeBudget(mobile);
            float playableX = worldWidth * 0.5f;
            float playableZ = worldDepth * 0.5f;
            float outerX = visualWidth * 0.5f - 3f;
            float outerZ = visualDepth * 0.5f - 3f;
            for (int i = 0; i < count; i++)
            {
                int side = i & 3;
                float along = Hash01(i, seed, 8141) * 2f - 1f;
                float depth = 0.28f + Hash01(i, seed, 8143) * 0.58f;
                float x;
                float z;
                if (side == 0 || side == 1)
                {
                    x = along * Mathf.Max(4f, outerX - 2f);
                    z = Mathf.Lerp(playableZ + 5f, outerZ, depth) * (side == 0 ? 1f : -1f);
                }
                else
                {
                    x = Mathf.Lerp(playableX + 5f, outerX, depth) * (side == 2 ? 1f : -1f);
                    z = along * Mathf.Max(4f, outerZ - 2f);
                }
                float radius = 1.25f + Hash01(i, seed, 8147) * 2.2f;
                float height = 0.42f + Hash01(i, seed, 8149) * 1.05f;
                AppendStone(vertices, triangles, new Vector3(x, -0.055f, z),
                    Hash01(i, seed, 8153) * Mathf.PI * 2f, radius, height, i, seed + 37, 7);
                RidgeCount++;
            }
        }

        private void CreateRenderNode(string name, Mesh mesh, Material material, bool castShadows)
        {
            CreateRenderNode(name, mesh, new[] { material }, castShadows);
        }

        private void CreateRenderNode(string name, Mesh mesh, Material[] materials, bool castShadows)
        {
            var node = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            node.transform.SetParent(_root.transform, false);
            node.GetComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = node.GetComponent<MeshRenderer>();
            renderer.sharedMaterials = materials;
            renderer.shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = true;
        }

        private static Mesh CreateMesh(string name, List<Vector3> vertices, List<int> triangles)
        {
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateMesh(string name, List<Vector3> vertices,
                                       List<int> firstTriangles, List<int> secondTriangles)
        {
            var mesh = new Mesh { name = name, subMeshCount = ScrubToneCount };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(firstTriangles, 0, false);
            mesh.SetTriangles(secondTriangles, 1, true);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Material CreateMaterial(string name, Color color, bool twoSided,
                                               float emissionLift)
        {
            Shader shader = twoSided
                ? (Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Color"))
                : (Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
            if (shader == null) return null;
            var material = new Material(shader) { name = name, color = color };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", 0.015f);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", 0.015f);
            if (material.HasProperty("_EmissionColor") && emissionLift > 0f)
            {
                material.SetColor("_EmissionColor", color.linear * emissionLift);
                material.EnableKeyword("_EMISSION");
            }
            if (twoSided && material.HasProperty("_Cull")) material.SetFloat("_Cull", (float)CullMode.Off);
            material.doubleSidedGI = twoSided;
            return material;
        }

        private static float PatchDensity(float x, float z, int seed)
        {
            float gx = x / 9f;
            float gz = z / 9f;
            int ix = Mathf.FloorToInt(gx);
            int iz = Mathf.FloorToInt(gz);
            float tx = Mathf.SmoothStep(0f, 1f, gx - ix);
            float tz = Mathf.SmoothStep(0f, 1f, gz - iz);
            float a = Mathf.Lerp(Hash01(ix, iz, seed + 8161),
                Hash01(ix + 1, iz, seed + 8161), tx);
            float b = Mathf.Lerp(Hash01(ix, iz + 1, seed + 8161),
                Hash01(ix + 1, iz + 1, seed + 8161), tx);
            return Mathf.Lerp(a, b, tz);
        }

        private static float NearestDistance(Vector2 point, List<Vector2> accepted)
        {
            float nearest = float.PositiveInfinity;
            for (int i = 0; i < accepted.Count; i++)
                nearest = Mathf.Min(nearest, Vector2.Distance(point, accepted[i]));
            return nearest;
        }

        private static float Hash01(int a, int b, int c)
        {
            unchecked
            {
                uint value = (uint)((a ^ unchecked((int)0x9e3779b9)) * unchecked((int)0x85ebca6b));
                value ^= (uint)((b + unchecked((int)0xc2b2ae35)) * unchecked((int)0x27d4eb2d));
                value ^= (uint)((c + unchecked((int)0x165667b1)) * unchecked((int)0x9e3779b1));
                value ^= value >> 15;
                return (value % 100000u) / 100000f;
            }
        }

        private void ClearGenerated()
        {
            DisposeObject(_root);
            DisposeObject(_scrubMesh);
            DisposeObject(_stoneMesh);
            DisposeObject(_scrubMaterial);
            DisposeObject(_secondaryScrubMaterial);
            DisposeObject(_stoneMaterial);
            foreach (KeyValuePair<Material, Material> pair in _authoredMaterialRemap)
                if (pair.Value != null && pair.Value != pair.Key) DisposeObject(pair.Value);
            _authoredMaterialRemap.Clear();
            _root = null;
            _scrubMesh = null;
            _stoneMesh = null;
            _scrubMaterial = null;
            _secondaryScrubMaterial = null;
            _stoneMaterial = null;
            _palette = null;
            _countedMeshes.Clear();
            SurfaceClusterCount = 0;
            ScrubClusterCount = 0;
            DryScrubClusterCount = 0;
            OliveScrubClusterCount = 0;
            StoneClusterCount = 0;
            RidgeCount = 0;
            VertexCount = 0;
            MinimumClusterSpacing = 0f;
            UsesAuthoredPrefabs = false;
            AuthoredPrefabCount = 0;
            AuthoredRendererCount = 0;
            AuthoredShadowCasterCount = 0;
            GroundAccentCount = 0;
            MaximumDecorationHeight = 0f;
        }

        private void OnDestroy()
        {
            ClearGenerated();
        }

        private static void DisposeObject(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }
}
