using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 07/20: efficient, MEP-backed water surfaces aligned to
    /// the final relief field. River, clean basins and contaminated wetlands are
    /// combined into three persistent meshes for the strategic WebGL view.
    /// </summary>
    internal static class KromkaGlobalMapWaterAuthoring
    {
        internal const int TextureIteration = 7;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        internal const int RiverSubdivisions = 10;
        private const float MinimumDownhillGrade = 0.00008f;
        private const float TesmaLift = 0.016f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalWater.shader";
        private const string NormalPath =
            "Assets/MEP/MEP_Environment/MEP_FX/Water_Placeholder/MEP_Water_Placeholder_Nor.png";
        private const string CleanMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalWater_Clean_MEP.mat";
        private const string ToxicMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalWater_Toxic_MEP.mat";
        private const string KarstMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalWater_Karst_MEP.mat";
        private const string CleanMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalWater_Clean.asset";
        private const string ToxicMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalWater_Toxic.asset";
        private const string KarstMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalWater_Karst.asset";

        internal static readonly Vector2[] TesmaPath =
        {
            // The Tesma is born on the inner northern mountain slope. It no
            // longer enters from beyond the map boundary or continues uphill
            // after reaching the terminal Zero Basin.
            new Vector2(183f, 292f), new Vector2(194f, 282f),
            new Vector2(205f, 267f), new Vector2(197f, 253f),
            new Vector2(191f, 240f), new Vector2(196f, 223f),
            new Vector2(205f, 205f), new Vector2(202f, 189f),
            new Vector2(194f, 173f), new Vector2(199f, 154f),
            new Vector2(209f, 135f), new Vector2(207f, 116f),
            // Skirt the R-12 foundations and discharge into the existing
            // eastern settling lake, not through the regenerator column.
            new Vector2(202f, 98f), new Vector2(217f, 90f),
            new Vector2(232f, 83f), new Vector2(248f, 74f)
        };

        private readonly struct RiverSection
        {
            internal readonly Vector2 Point, Left, Right;
            internal readonly float Level, Width;
            internal RiverSection(Vector2 point, Vector2 left, Vector2 right,
                                  float level, float width)
            {
                Point = point; Left = left; Right = right; Level = level; Width = width;
            }
        }

        private static RiverSection[] tesmaSections;
        private static readonly Vector2 CrownLakeCentre = new Vector2(211f, 276f);
        private static readonly Vector2 CrownLakeRadius = new Vector2(26f, 15f);
        private static float crownLakeLevel;
        private static float CrownLakeLevel
        {
            get
            {
                if (tesmaSections == null)
                    tesmaSections = BuildRiverSections(TesmaPath, 1.9f, 2.55f, TesmaLift);
                return crownLakeLevel;
            }
        }
        private static readonly Vector2 SinkLakeCentre = new Vector2(257f, 68f);
        private static readonly Vector2 SinkLakeRadius = new Vector2(22f, 12f);

        private sealed class LakeBasin
        {
            internal readonly Vector2 Centre, Radius;
            internal readonly float Seed;
            private readonly int segments;
            private float? level;
            internal LakeBasin(float x, float y, float rx, float ry, float seed, int segments = 64)
            { Centre = new Vector2(x, y); Radius = new Vector2(rx, ry); Seed = seed; this.segments = segments; }
            internal float Level
            {
                get
                {
                    if (level.HasValue) return level.Value;
                    float lowestBank = float.MaxValue;
                    for (int i = 0; i < segments; i++)
                    {
                        float a = i * Mathf.PI * 2f / segments;
                        float edge = .94f + Mathf.Sin(a * 3f + Seed) * .032f + Mathf.Sin(a * 7f + Seed * 1.91f) * .022f;
                        lowestBank = Mathf.Min(lowestBank, KromkaGlobalMapReliefAuthoring.UncarvedHeightAtMap(
                            Centre.x + Mathf.Cos(a) * Radius.x * edge, Centre.y + Mathf.Sin(a) * Radius.y * edge));
                    }
                    level = lowestBank - .014f;
                    return level.Value;
                }
            }
        }
        private static readonly LakeBasin[] SeparateBasins = {
            new LakeBasin(157f, 273f, 27f, 14.5f, .13f),
            new LakeBasin(249f, 258f, 23f, 12.5f, 2.61f),
            // The settling pond is behind the fuel yard, not beneath its tanks.
            new LakeBasin(144f, 64f, 14f, 6.5f, .46f),
            new LakeBasin(214f, 43f, 22f, 11.5f, 1.72f),
            new LakeBasin(137f, 82f, 18f, 10f, 4.18f, 56),
            new LakeBasin(276f, 108f, 7.5f, 5f, .81f, 40),
            new LakeBasin(307f, 98f, 6f, 4.3f, 1.93f, 40),
            new LakeBasin(337f, 87f, 8f, 5.2f, 3.17f, 40),
            new LakeBasin(292f, 68f, 5.8f, 4.1f, 4.39f, 40),
            new LakeBasin(326f, 58f, 7.1f, 4.7f, 5.51f, 40),
            new LakeBasin(334f, 70f, 5.6f, 3.9f, 6.73f, 40)
        };

        private static float SinkLakeLevel
        {
            get
            {
                if (tesmaSections == null)
                    tesmaSections = BuildRiverSections(TesmaPath, 1.9f, 2.55f, TesmaLift);
                return tesmaSections[tesmaSections.Length - 1].Level - .001f;
            }
        }

        internal static Vector2[] SampleTesma()
        {
            if (tesmaSections == null)
                tesmaSections = BuildRiverSections(TesmaPath, 1.9f, 2.55f, TesmaLift);
            var points = new Vector2[tesmaSections.Length];
            for (int i = 0; i < points.Length; i++) points[i] = tesmaSections[i].Point;
            return points;
        }

        // The water grade is derived from the uncarved terrain once. The same
        // profile then cuts the visible terrain and its runtime height field,
        // so downhill water cannot disappear underneath an uphill bed segment.
        internal static float CarveTesmaBed(float mapX, float mapY, float terrain)
        {
            foreach (LakeBasin basin in SeparateBasins)
                if (Mathf.Abs(mapX - basin.Centre.x) <= basin.Radius.x * 1.12f
                    && Mathf.Abs(mapY - basin.Centre.y) <= basin.Radius.y * 1.12f)
                    terrain = CarveLake(mapX, mapY, terrain, basin.Centre, basin.Radius, basin.Seed, basin.Level);
            if (mapX < 177f || mapX > 284f || mapY < 53f || mapY > 297f)
                return terrain;
            if (tesmaSections == null)
                tesmaSections = BuildRiverSections(TesmaPath, 1.9f, 2.55f, TesmaLift);
            terrain = CarveLake(mapX, mapY, terrain, CrownLakeCentre, CrownLakeRadius, 1.37f, CrownLakeLevel);
            // The receiving lake shares the river's outlet elevation. Excavate
            // its actual basin rather than putting a higher water plane across
            // the mouth (which would imply water flowing uphill).
            terrain = CarveLake(mapX, mapY, terrain, SinkLakeCentre, SinkLakeRadius, 2.94f, SinkLakeLevel);
            Vector2 point = new Vector2(mapX, mapY);
            float bestDistance = float.MaxValue, level = 0f, width = 0f;
            for (int i = 0; i < tesmaSections.Length - 1; i++)
            {
                RiverSection a = tesmaSections[i], b = tesmaSections[i + 1];
                Vector2 delta = b.Point - a.Point;
                float t = Mathf.Clamp01(Vector2.Dot(point - a.Point, delta)
                    / Mathf.Max(0.00001f, delta.sqrMagnitude));
                float distance = Vector2.Distance(point, a.Point + delta * t);
                if (distance >= bestDistance) continue;
                bestDistance = distance;
                level = Mathf.Lerp(a.Level, b.Level, t);
                width = Mathf.Lerp(a.Width, b.Width, t);
            }
            if (bestDistance >= width + 2.2f) return terrain;
            float bed = level - Mathf.Lerp(0.062f, 0.025f,
                Mathf.SmoothStep(0f, 1f, bestDistance / Mathf.Max(width, 0.1f)));
            float blend = 1f - Mathf.SmoothStep(0f, 1f,
                Mathf.InverseLerp(width, width + 2.2f, bestDistance));
            return Mathf.Lerp(terrain, Mathf.Min(terrain, bed), blend);
        }

        private static float LakeDistance(Vector2 point, Vector2 centre, Vector2 radius, float seed)
        {
            Vector2 delta = new Vector2((point.x - centre.x) / radius.x, (point.y - centre.y) / radius.y);
            float angle = Mathf.Atan2(delta.y, delta.x);
            float edge = .94f + Mathf.Sin(angle * 3f + seed) * .032f
                + Mathf.Sin(angle * 7f + seed * 1.91f) * .022f;
            return delta.magnitude / edge;
        }

        private static float CarveLake(float x, float y, float terrain, Vector2 centre,
            Vector2 radius, float seed, float level)
        {
            float distance = LakeDistance(new Vector2(x, y), centre, radius, seed);
            if (distance >= 1.12f) return terrain;
            float bed = level - Mathf.Lerp(.052f, .025f, Mathf.SmoothStep(0f, 1f, distance));
            float blend = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(1f, 1.12f, distance));
            return Mathf.Lerp(terrain, Mathf.Min(terrain, bed), blend);
        }

        private static RiverSection[] BuildRiverSections(Vector2[] points,
            float minimumHalfWidthKm, float maximumHalfWidthKm, float lift)
        {
            var smoothPoints = new List<Vector2>();
            for (int segment = 0; segment < points.Length - 1; segment++)
            {
                Vector2 p0 = points[Mathf.Max(0, segment - 1)];
                Vector2 p1 = points[segment];
                Vector2 p2 = points[segment + 1];
                Vector2 p3 = points[Mathf.Min(points.Length - 1, segment + 2)];
                for (int step = 0; step < RiverSubdivisions; step++)
                    smoothPoints.Add(MeshAccumulator.CatmullRom(p0, p1, p2, p3,
                        step / (float)RiverSubdivisions));
            }
            smoothPoints.Add(points[points.Length - 1]);
            var sections = new RiverSection[smoothPoints.Count];
            float previousLevel = float.PositiveInfinity;
            for (int i = 0; i < smoothPoints.Count; i++)
            {
                Vector2 point = smoothPoints[i];
                Vector2 previous = smoothPoints[Mathf.Max(0, i - 1)];
                Vector2 next = smoothPoints[Mathf.Min(smoothPoints.Count - 1, i + 1)];
                Vector2 tangent = (next - previous).normalized;
                Vector2 side = new Vector2(-tangent.y, tangent.x);
                float width = Mathf.Lerp(minimumHalfWidthKm, maximumHalfWidthKm,
                    0.5f + 0.5f * Mathf.Sin(i * 0.19f + 0.4f)) + Mathf.Sin(i * 1.71f) * 0.16f;
                float progress = i / (float)(smoothPoints.Count - 1);
                width *= Mathf.SmoothStep(0.42f, 1f,
                    Mathf.Clamp01(Mathf.Min(progress, 1f - progress) * 14f));
                Vector2 left = point + side * width, right = point - side * width;
                float bed = Mathf.Min(
                    KromkaGlobalMapReliefAuthoring.UncarvedHeightAtMap(point.x, point.y),
                    KromkaGlobalMapReliefAuthoring.UncarvedHeightAtMap(left.x, left.y),
                    KromkaGlobalMapReliefAuthoring.UncarvedHeightAtMap(right.x, right.y));
                float level = Mathf.Min(bed + lift,
                    previousLevel - Vector2.Distance(previous, point) * MinimumDownhillGrade);
                sections[i] = new RiverSection(point, left, right, level, width);
                previousLevel = level;
            }
            // A reservoir is one level water body, not a floating plane above
            // a second sloping river surface. Use its downstream outlet level
            // and grade the headwater approach gently into that basin.
            int first = -1, last = -1;
            for (int i = 0; i < sections.Length; i++)
                if (LakeDistance(sections[i].Point, CrownLakeCentre, CrownLakeRadius, 1.37f) <= 1.04f)
                { if (first < 0) first = i; last = i; }
            if (first < 0) throw new InvalidOperationException("Tesma no longer reaches the crown reservoir.");
            crownLakeLevel = sections[last].Level;
            for (int i = first; i <= last; i++) sections[i] = AtLevel(sections[i], crownLakeLevel);
            for (int i = first - 1; i >= 0; i--)
                sections[i] = AtLevel(sections[i], Mathf.Min(sections[i].Level,
                    sections[i + 1].Level + Vector2.Distance(sections[i].Point, sections[i + 1].Point) * .012f));
            return sections;
        }

        private static RiverSection AtLevel(RiverSection section, float level) =>
            new RiverSection(section.Point, section.Left, section.Right, level, section.Width);

        internal static void Compose(Transform root)
        {
            Material clean = BuildMaterial(CleanMaterialPath,
                new Color(0.08f, 0.43f, 0.47f, 0.88f),
                new Color(0.015f, 0.12f, 0.16f, 0.92f),
                new Color(0.30f, 0.58f, 0.57f, 1f),
                0.74f, 0.66f, 0.48f, 0.016f, 0.85f, 0.16f, 0f);
            Material toxic = BuildMaterial(ToxicMaterialPath,
                new Color(0.20f, 0.31f, 0.075f, 0.92f),
                new Color(0.012f, 0.047f, 0.032f, 0.95f),
                new Color(0.45f, 0.61f, 0.11f, 1f),
                0.82f, 0.35f, 0.39f, 0.006f, 0.72f, 0.18f, 0.42f);
            Material karst = BuildMaterial(KarstMaterialPath,
                new Color(0.13f, 0.39f, 0.42f, 0.84f),
                new Color(0.025f, 0.14f, 0.17f, 0.90f),
                new Color(0.53f, 0.58f, 0.48f, 1f),
                0.68f, 0.48f, 0.62f, 0.010f, 0.78f, 0.22f, 0f);

            MeshAccumulator cleanMesh = new MeshAccumulator();
            cleanMesh.AddRiver(TesmaPath, 1.9f, 2.55f, TesmaLift);
            cleanMesh.AddPool(new Vector2(157f, 273f), new Vector2(27f, 14.5f),
                0.064f, 0.13f, 64);
            cleanMesh.AddPool(CrownLakeCentre, CrownLakeRadius,
                0.064f, 1.37f, 64, CrownLakeLevel);
            cleanMesh.AddPool(new Vector2(249f, 258f), new Vector2(23f, 12.5f),
                0.060f, 2.61f, 64);

            MeshAccumulator toxicMesh = new MeshAccumulator();
            toxicMesh.AddPool(new Vector2(144f, 64f), new Vector2(14f, 6.5f),
                0.052f, 0.46f, 64);
            toxicMesh.AddPool(new Vector2(214f, 43f), new Vector2(22f, 11.5f),
                0.052f, 1.72f, 64);
            toxicMesh.AddPool(SinkLakeCentre, SinkLakeRadius,
                0.050f, 2.94f, 64, SinkLakeLevel);
            toxicMesh.AddPool(new Vector2(137f, 82f), new Vector2(18f, 10f),
                0.050f, 4.18f, 56);

            MeshAccumulator karstMesh = new MeshAccumulator();
            karstMesh.AddPool(new Vector2(276f, 108f), new Vector2(7.5f, 5.0f),
                0.042f, 0.81f, 40);
            karstMesh.AddPool(new Vector2(307f, 98f), new Vector2(6.0f, 4.3f),
                0.042f, 1.93f, 40);
            karstMesh.AddPool(new Vector2(337f, 87f), new Vector2(8.0f, 5.2f),
                0.042f, 3.17f, 40);
            karstMesh.AddPool(new Vector2(292f, 68f), new Vector2(5.8f, 4.1f),
                0.040f, 4.39f, 40);
            karstMesh.AddPool(new Vector2(326f, 58f), new Vector2(7.1f, 4.7f),
                0.040f, 5.51f, 40);
            karstMesh.AddPool(new Vector2(334f, 70f), new Vector2(5.6f, 3.9f),
                0.040f, 6.73f, 40);

            CreateSurface("CleanWater_SURFACE_MEP", root,
                PersistMesh(CleanMeshPath, cleanMesh.Build("Kromka_GlobalWater_Clean")), clean);
            CreateSurface("ToxicWater_SURFACE_MEP", root,
                PersistMesh(ToxicMeshPath, toxicMesh.Build("Kromka_GlobalWater_Toxic")), toxic);
            CreateSurface("KarstWater_SURFACE_MEP", root,
                PersistMesh(KarstMeshPath, karstMesh.Build("Kromka_GlobalWater_Karst")), karst);
            Child(root, "TesmaRibbon_REFERENCE");
            Child(root, "TesmaMountainHeadwaters_REFERENCE");
            Child(root, "TesmaZeroBasinSink_REFERENCE");
            Child(root, "SingleTesmaChannel_REFERENCE");
            Child(root, "NorthernReservoirs_3_REFERENCE");
            Child(root, "ZeroBasinPools_4_REFERENCE");
            Child(root, "ChalkKarstWindows_6_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 07")]
        public static void ValidateIteration07()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D normal = AssetDatabase.LoadAssetAtPath<Texture2D>(NormalPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka global water shader is missing or invalid.");
            Require(normal != null && normal.width >= 1024 && normal.height >= 1024,
                "The direct MEP water normal is missing or below strategic resolution.");
            ValidateMaterial(CleanMaterialPath, shader, normal, 0.68f, 0.80f, 0f);
            ValidateMaterial(ToxicMaterialPath, shader, normal, 0.76f, 0.88f, 0.35f);
            ValidateMaterial(KarstMaterialPath, shader, normal, 0.62f, 0.76f, 0f);
            ValidateSurface("CleanWater_SURFACE_MEP", CleanMeshPath,
                CleanMaterialPath, 540);
            ValidateSurface("ToxicWater_SURFACE_MEP", ToxicMeshPath,
                ToxicMaterialPath, 240);
            ValidateSurface("KarstWater_SURFACE_MEP", KarstMeshPath,
                KarstMaterialPath, 240);
            Mesh cleanMesh = AssetDatabase.LoadAssetAtPath<Mesh>(CleanMeshPath);
            int tesmaVertices = ValidateDownhillRiver(cleanMesh, 0, TesmaPath,
                TesmaLift, "Tesma");
            Require(cleanMesh.vertexCount == tesmaVertices + 3 * (64 + 2),
                "Clean water must contain one Tesma channel and three reservoir pools only.");
            Require(GameObject.Find("TesmaRibbon_REFERENCE") != null
                && GameObject.Find("TesmaMountainHeadwaters_REFERENCE") != null
                && GameObject.Find("TesmaZeroBasinSink_REFERENCE") != null
                && GameObject.Find("SingleTesmaChannel_REFERENCE") != null
                && GameObject.Find("NorthernReservoirs_3_REFERENCE") != null
                && GameObject.Find("ZeroBasinPools_4_REFERENCE") != null
                && GameObject.Find("ChalkKarstWindows_6_REFERENCE") != null,
                "Water geography reference handles are incomplete.");
            Require(GameObject.Find("FloodedExit_NorthernTesma") == null
                && GameObject.Find("FloodedExit_SouthernZeroBasin") == null,
                "A flat boundary water sheet has returned above the outer terrain apron.");
            Require(GameObject.Find("CascadeCanal_REFERENCE") == null,
                "A removed side channel has returned to the water layer.");
            Debug.Log("[KROMKA TEXTURES 35%] PASS: the Tesma descends from its "
                + "northern mountain headwaters into Zero Basin without reverse grades or "
                + "floating boundary sheets; one main channel, three northern reservoirs, four "
                + "contaminated basin pools and six karst windows remain combined into "
                + "three WebGL-friendly water meshes.");
        }

        private static int ValidateDownhillRiver(Mesh mesh, int firstVertex,
                                                 Vector2[] path, float lift,
                                                 string label)
        {
            Require(mesh != null, label + " water mesh is missing.");
            int rowCount = (path.Length - 1) * RiverSubdivisions + 1;
            Vector3[] vertices = mesh.vertices;
            Require(firstVertex >= 0 && firstVertex + rowCount * 3 <= vertices.Length,
                label + " river rows are incomplete.");

            float previousLevel = float.PositiveInfinity;
            float sourceLevel = 0f;
            float sinkLevel = 0f;
            for (int row = 0; row < rowCount; row++)
            {
                int index = firstVertex + row * 3;
                float level = vertices[index].y;
                if (row == 0) sourceLevel = level;
                if (row == rowCount - 1) sinkLevel = level;
                Require(level <= previousLevel + 0.0001f,
                    label + " contains an uphill water reach at row " + row + ".");
                previousLevel = level;

                for (int side = 0; side <= 2; side += 2)
                {
                    Vector3 vertex = vertices[index + side];
                    float mapX = vertex.x / Scale + 190f;
                    float mapY = 150f - vertex.z / Scale;
                    float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY);
                    bool inReservoir = LakeDistance(new Vector2(mapX, mapY),
                        CrownLakeCentre, CrownLakeRadius, 1.37f) <= 1.12f;
                    // Inside the connected lake these are submerged cross-section
                    // points, not dry banks. Its excavated bed is up to .062 deep.
                    Require(vertex.y - terrain <= (inReservoir ? .065f : .035f),
                        label + " floats above its terrain bed at row " + row + ".");
                }
            }
            Require(sourceLevel > sinkLevel + 0.35f,
                label + " does not descend meaningfully from source to sink.");
            return rowCount * 3;
        }

        private static Material BuildMaterial(string path, Color shallow, Color deep,
                                              Color foam, float opacity,
                                              float normalScale, float normalTiling,
                                              float flowSpeed, float smoothness,
                                              float mineralVeil, float toxicPulse)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            if (shader == null) throw new InvalidOperationException("Kromka water shader is missing.");
            Texture2D normal = AssetDatabase.LoadAssetAtPath<Texture2D>(NormalPath);
            if (normal == null) throw new InvalidOperationException("MEP water normal is missing.");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                material.name = System.IO.Path.GetFileNameWithoutExtension(path);
                AssetDatabase.CreateAsset(material, path);
            }
            else if (material.shader != shader) material.shader = shader;
            material.SetTexture("_NormalMap", normal);
            material.SetColor("_ShallowColor", shallow);
            material.SetColor("_DeepColor", deep);
            material.SetColor("_FoamColor", foam);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_NormalScale", normalScale);
            material.SetFloat("_NormalTiling", normalTiling);
            material.SetFloat("_FlowSpeed", flowSpeed);
            material.SetFloat("_Smoothness", smoothness);
            material.SetFloat("_FresnelPower", 4.2f);
            material.SetFloat("_MineralVeil", mineralVeil);
            material.SetFloat("_ToxicPulse", toxicPulse);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void CreateSurface(string name, Transform parent, Mesh mesh,
                                          Material material)
        {
            GameObject surface = new GameObject(name);
            surface.transform.SetParent(parent, false);
            surface.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            GameObjectUtility.SetStaticEditorFlags(surface, StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Mesh PersistMesh(string path, Mesh generated)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            // Set native mesh buffers explicitly: copying serialization alone
            // can leave the old channel visible in an already open editor.
            existing.Clear();
            existing.vertices = generated.vertices;
            existing.normals = generated.normals;
            existing.uv = generated.uv;
            existing.triangles = generated.triangles;
            existing.bounds = generated.bounds;
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        private static void ValidateMaterial(string path, Shader shader, Texture2D normal,
                                             float minOpacity, float maxOpacity,
                                             float minimumToxicPulse)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader,
                path + " does not use the authored Kromka water shader.");
            Require(material.GetTexture("_NormalMap") == normal,
                path + " does not reference the MEP water normal directly.");
            float opacity = material.GetFloat("_Opacity");
            Require(opacity >= minOpacity && opacity <= maxOpacity,
                path + " opacity is outside its readable range.");
            Require(material.GetFloat("_NormalTiling") >= 0.35f
                && material.GetFloat("_NormalTiling") <= 0.70f,
                path + " ripple scale is outside strategic-map range.");
            Require(material.GetFloat("_ToxicPulse") >= minimumToxicPulse,
                path + " lacks its required contaminated-water signature.");
        }

        private static void ValidateSurface(string name, string meshPath,
                                            string materialPath, int minimumVertices)
        {
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            GameObject surface = GameObject.Find(name);
            Require(mesh != null && mesh.vertexCount >= minimumVertices,
                name + " mesh is missing or under-resolved.");
            Require(surface != null, name + " is absent from the global scene.");
            MeshFilter filter = surface.GetComponent<MeshFilter>();
            MeshRenderer renderer = surface.GetComponent<MeshRenderer>();
            Require(filter != null && filter.sharedMesh == mesh,
                name + " does not reference its persistent mesh asset.");
            Require(renderer != null && renderer.sharedMaterial == material
                && renderer.shadowCastingMode == ShadowCastingMode.Off,
                name + " renderer is not configured for strategic transparent water.");
        }

        private static Transform Child(Transform parent, string name)
        {
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static Vector3 World(float x, float z, float y)
        {
            return new Vector3((x - 190f) * Scale, y, (150f - z) * Scale);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private sealed class MeshAccumulator
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<Vector3> normals = new List<Vector3>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private readonly List<int> triangles = new List<int>();

            internal void AddRiver(Vector2[] points, float minimumHalfWidthKm,
                                   float maximumHalfWidthKm, float lift)
            {
                RiverSection[] sections = BuildRiverSections(points,
                    minimumHalfWidthKm, maximumHalfWidthKm, lift);
                float accumulated = 0f;
                for (int i = 0; i < sections.Length; i++)
                {
                    RiverSection section = sections[i];
                    Vector2 point = section.Point, left = section.Left, right = section.Right;
                    float level = section.Level;
                    int index = vertices.Count;
                    vertices.Add(World(left.x, left.y, level));
                    vertices.Add(World(point.x, point.y, level + 0.001f));
                    vertices.Add(World(right.x, right.y, level));
                    normals.Add(Vector3.up);
                    normals.Add(Vector3.up);
                    normals.Add(Vector3.up);
                    if (i > 0) accumulated += Vector2.Distance(sections[i - 1].Point, point);
                    uv.Add(new Vector2(0f, accumulated * 0.16f));
                    uv.Add(new Vector2(1f, accumulated * 0.16f));
                    uv.Add(new Vector2(0f, accumulated * 0.16f));
                    if (i == 0) continue;
                    // The reservoir is already a water surface. Do not draw a
                    // second ribbon through its interior (UV stripe/z fighting).
                    RiverSection previous = sections[i - 1];
                    if (new[] { previous.Left, previous.Right, left, right }.All(p =>
                        LakeDistance(p, CrownLakeCentre, CrownLakeRadius, 1.37f) < .98f)) continue;
                    triangles.Add(index - 3);
                    triangles.Add(index);
                    triangles.Add(index - 2);
                    triangles.Add(index);
                    triangles.Add(index + 1);
                    triangles.Add(index - 2);
                    triangles.Add(index - 2);
                    triangles.Add(index + 1);
                    triangles.Add(index - 1);
                    triangles.Add(index + 1);
                    triangles.Add(index + 2);
                    triangles.Add(index - 1);
                }
            }

            internal static Vector2 CatmullRom(Vector2 p0, Vector2 p1,
                                              Vector2 p2, Vector2 p3, float t)
            {
                float t2 = t * t;
                float t3 = t2 * t;
                return 0.5f * ((2f * p1) + (-p0 + p2) * t
                    + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2
                    + (-p0 + 3f * p1 - 3f * p2 + p3) * t3);
            }

            internal void AddPool(Vector2 centre, Vector2 radiusKm, float lift,
                                  float seed, int segments, float? levelOverride = null)
            {
                int centreIndex = vertices.Count;
                float level = levelOverride ?? SeparateBasins.Single(basin => basin.Centre == centre).Level;
                vertices.Add(World(centre.x, centre.y, level));
                normals.Add(Vector3.up);
                uv.Add(new Vector2(1f, 0f));
                for (int i = 0; i <= segments; i++)
                {
                    float angle = i * Mathf.PI * 2f / segments;
                    float edge = 0.94f + Mathf.Sin(angle * 3f + seed) * 0.032f
                        + Mathf.Sin(angle * 7f + seed * 1.91f) * 0.022f;
                    float x = centre.x + Mathf.Cos(angle) * radiusKm.x * edge;
                    float z = centre.y + Mathf.Sin(angle) * radiusKm.y * edge;
                    vertices.Add(World(x, z, level));
                    normals.Add(Vector3.up);
                    uv.Add(new Vector2(0f, i / (float)segments));
                    if (i == 0) continue;
                    triangles.Add(centreIndex);
                    triangles.Add(centreIndex + i + 1);
                    triangles.Add(centreIndex + i);
                }
            }

            internal Mesh Build(string name)
            {
                Mesh mesh = new Mesh { name = name };
                mesh.SetVertices(vertices);
                mesh.SetNormals(normals);
                mesh.SetUVs(0, uv);
                mesh.SetTriangles(triangles, 0, true);
                mesh.RecalculateBounds();
                return mesh;
            }
        }
    }
}
