using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 17/20: the Tract Isthmus records persistent caravan
    /// traffic through three dust corridors, paired wheel ruts, six staging
    /// yards and nine remnants of the pre-war hard surface.
    /// </summary>
    internal static class KromkaGlobalMapTractWearAuthoring
    {
        internal const int TextureIteration = 17;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalTractWear.shader";
        private const string DustTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_03.tga";
        private const string CompactedTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Dessert_Base_N.tga";
        private const string AggregateTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Textures/MEP_StoneGround_Dif.png";

        private const string DustMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTract_TrafficDust_MEP.mat";
        private const string RutMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTract_WheelRuts_MEP.mat";
        private const string YardMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTract_CaravanYards_MEP.mat";
        private const string SlabMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTract_BrokenSlabs_MEP.mat";

        private const string DustMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTract_TrafficDust.asset";
        private const string RutMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTract_WheelRuts.asset";
        private const string YardMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTract_CaravanYards.asset";
        private const string SlabMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTract_BrokenSlabs.asset";

        private static readonly Vector2[] WesternApproach =
        {
            new Vector2(3f, 155f), new Vector2(52f, 155f),
            new Vector2(91f, 156f), new Vector2(125f, 155f)
        };

        private static readonly Vector2[] CrossroadsToKeys =
        {
            new Vector2(125f, 155f), new Vector2(148f, 169f),
            new Vector2(171f, 190f), new Vector2(195f, 205f)
        };

        private static readonly Vector2[] EasternDescent =
        {
            new Vector2(195f, 205f), new Vector2(221f, 187f),
            new Vector2(245f, 165f), new Vector2(272f, 135f),
            new Vector2(295f, 110f), new Vector2(316f, 103f)
        };

        private static readonly Vector2[] MainTract =
        {
            new Vector2(3f, 155f), new Vector2(54f, 155f),
            new Vector2(125f, 155f), new Vector2(195f, 205f),
            new Vector2(245f, 165f), new Vector2(295f, 110f),
            new Vector2(316f, 103f)
        };

        private static readonly Vector2[] DepotBypass =
        {
            new Vector2(163f, 178f), new Vector2(185f, 158f),
            new Vector2(210f, 145f), new Vector2(235f, 158f),
            new Vector2(245f, 165f)
        };

        private static readonly Vector2[] YardCentres =
        {
            new Vector2(49f, 155f), new Vector2(125f, 155f),
            new Vector2(166f, 184f), new Vector2(210f, 145f),
            new Vector2(245f, 165f), new Vector2(294f, 110f)
        };

        private static readonly Vector2[] YardRadii =
        {
            new Vector2(7.0f, 3.4f), new Vector2(11.5f, 6.5f),
            new Vector2(7.6f, 4.0f), new Vector2(10.0f, 5.3f),
            new Vector2(7.8f, 4.3f), new Vector2(6.8f, 3.8f)
        };

        private static readonly Vector2[] SlabCentres =
        {
            new Vector2(22f, 155f), new Vector2(72f, 156f),
            new Vector2(107f, 155f), new Vector2(143f, 167f),
            new Vector2(178f, 194f), new Vector2(225f, 181f),
            new Vector2(260f, 148f), new Vector2(286f, 120f),
            new Vector2(306f, 105f)
        };

        private static readonly Vector2[] SlabRadii =
        {
            new Vector2(5.0f, 1.7f), new Vector2(4.2f, 1.8f),
            new Vector2(4.8f, 1.9f), new Vector2(4.4f, 1.8f),
            new Vector2(4.6f, 2.0f), new Vector2(4.7f, 1.9f),
            new Vector2(4.3f, 1.8f), new Vector2(4.0f, 1.7f),
            new Vector2(3.8f, 1.6f)
        };

        private static readonly float[] SlabRotations =
        {
            -1f, 2f, -3f, 29f, 35f, -37f, -44f, -42f, -17f
        };

        internal static void Compose(Transform root)
        {
            Material dust = BuildMaterial(DustMaterialPath,
                new Color(0.55f, 0.42f, 0.23f, 1f),
                new Color(0.16f, 0.105f, 0.055f, 1f),
                3.9f, 0.43f, 0.44f, 0.38f,
                0.94f, 0.22f, 0.12f, 0.10f, 0.53f);
            Material ruts = BuildMaterial(RutMaterialPath,
                new Color(0.39f, 0.29f, 0.16f, 1f),
                new Color(0.09f, 0.055f, 0.030f, 1f),
                4.6f, 0.48f, 0.70f, 0.20f,
                0.34f, 0.91f, 0.97f, 0.18f, 1.47f);
            Material yards = BuildMaterial(YardMaterialPath,
                new Color(0.43f, 0.32f, 0.18f, 1f),
                new Color(0.12f, 0.075f, 0.038f, 1f),
                4.2f, 0.44f, 0.58f, 0.31f,
                0.52f, 0.88f, 0.24f, 0.30f, 2.63f);
            Material slabs = BuildMaterial(SlabMaterialPath,
                new Color(0.44f, 0.40f, 0.31f, 1f),
                new Color(0.13f, 0.115f, 0.085f, 1f),
                5.0f, 0.51f, 0.49f, 0.24f,
                0.24f, 0.54f, 0.08f, 0.93f, 4.11f);

            WearAccumulator dustMesh = new WearAccumulator();
            dustMesh.AddRibbon(WesternApproach, 4.8f, 0.027f, 10, 0.37f);
            dustMesh.AddRibbon(CrossroadsToKeys, 4.4f, 0.027f, 10, 1.13f);
            dustMesh.AddRibbon(EasternDescent, 4.2f, 0.027f, 10, 2.19f);

            WearAccumulator rutMesh = new WearAccumulator();
            rutMesh.AddRibbon(MainTract, 0.82f, 0.057f, 11, 0.83f);
            rutMesh.AddRibbon(DepotBypass, 0.70f, 0.056f, 10, 2.71f);

            WearAccumulator yardMesh = new WearAccumulator();
            for (int i = 0; i < YardCentres.Length; i++)
                yardMesh.AddPatch(YardCentres[i], YardRadii[i],
                    -9f + i * 13f, 0.035f, 54, 0.61f + i * 0.79f);

            WearAccumulator slabMesh = new WearAccumulator();
            for (int i = 0; i < SlabCentres.Length; i++)
                slabMesh.AddPatch(SlabCentres[i], SlabRadii[i],
                    SlabRotations[i], 0.045f, 34, 0.43f + i * 0.67f);

            CreateSurface("TractTrafficDust_SURFACE_MEP", root,
                PersistMesh(DustMeshPath,
                    dustMesh.Build("Kromka_GlobalTract_TrafficDust")), dust);
            CreateSurface("TractWheelRuts_SURFACE_MEP", root,
                PersistMesh(RutMeshPath,
                    rutMesh.Build("Kromka_GlobalTract_WheelRuts")), ruts);
            CreateSurface("TractCaravanYards_SURFACE_MEP", root,
                PersistMesh(YardMeshPath,
                    yardMesh.Build("Kromka_GlobalTract_CaravanYards")), yards);
            CreateSurface("TractBrokenSlabs_SURFACE_MEP", root,
                PersistMesh(SlabMeshPath,
                    slabMesh.Build("Kromka_GlobalTract_BrokenSlabs")), slabs);
            Child(root, "TractDustCorridors_3_REFERENCE");
            Child(root, "TractWheelRutPairs_2_REFERENCE");
            Child(root, "TractCaravanYards_6_REFERENCE");
            Child(root, "TractBrokenSlabs_9_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 17")]
        public static void ValidateIteration17()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka Tract-wear shader is missing or invalid.");
            Texture2D dust = ValidateSource(DustTexturePath, "Tract dry dust");
            Texture2D compacted = ValidateSource(CompactedTexturePath,
                "Tract compacted soil");
            Texture2D aggregate = ValidateSource(AggregateTexturePath,
                "Tract road aggregate");
            ValidateMaterial(DustMaterialPath, shader, dust, compacted, aggregate,
                0.38f, 0.50f, 0.88f, 1f, 0.05f, 0.18f);
            ValidateMaterial(RutMaterialPath, shader, dust, compacted, aggregate,
                0.64f, 0.76f, 0.28f, 0.42f, 0.90f, 1f);
            ValidateMaterial(YardMaterialPath, shader, dust, compacted, aggregate,
                0.52f, 0.64f, 0.46f, 0.60f, 0.18f, 0.30f);
            ValidateMaterial(SlabMaterialPath, shader, dust, compacted, aggregate,
                0.43f, 0.55f, 0.18f, 0.30f, 0.04f, 0.12f);
            Require(AssetDatabase.LoadAssetAtPath<Material>(SlabMaterialPath)
                    .GetFloat("_Aggregate") >= 0.88f,
                "Tract broken slabs do not expose enough direct MEP aggregate.");
            ValidateSurface("TractTrafficDust_SURFACE_MEP",
                DustMeshPath, DustMaterialPath, 540);
            ValidateSurface("TractWheelRuts_SURFACE_MEP",
                RutMeshPath, RutMaterialPath, 520);
            ValidateSurface("TractCaravanYards_SURFACE_MEP",
                YardMeshPath, YardMaterialPath, 320);
            ValidateSurface("TractBrokenSlabs_SURFACE_MEP",
                SlabMeshPath, SlabMaterialPath, 300);
            Require(GameObject.Find("TractDustCorridors_3_REFERENCE") != null
                && GameObject.Find("TractWheelRutPairs_2_REFERENCE") != null
                && GameObject.Find("TractCaravanYards_6_REFERENCE") != null
                && GameObject.Find("TractBrokenSlabs_9_REFERENCE") != null,
                "Tract traffic-wear reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 85%] PASS: three direct high-resolution MEP "
                + "sources form three dust corridors, paired wheel ruts, six caravan "
                + "yards and nine broken-slab remnants across the Tract Isthmus.");
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float dust, float compaction,
                                              float ruts, float aggregate,
                                              float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D dustTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                DustTexturePath);
            Texture2D compactedTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                CompactedTexturePath);
            Texture2D aggregateTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                AggregateTexturePath);
            if (shader == null || dustTexture == null || compactedTexture == null
                || aggregateTexture == null)
                throw new InvalidOperationException(
                    "Tract-wear shader or direct MEP texture is missing.");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader)
                {
                    name = System.IO.Path.GetFileNameWithoutExtension(path)
                };
                AssetDatabase.CreateAsset(material, path);
            }
            else if (material.shader != shader) material.shader = shader;
            material.SetTexture("_MainTex", dustTexture);
            material.SetTexture("_SecondaryTex", compactedTexture);
            material.SetTexture("_AggregateTex", aggregateTexture);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Dust", dust);
            material.SetFloat("_Compaction", compaction);
            material.SetFloat("_Ruts", ruts);
            material.SetFloat("_Aggregate", aggregate);
            material.SetFloat("_Seed", seed);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Texture2D ValidateSource(string path, string label)
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            Require(texture != null && texture.width >= 2048 && texture.height >= 2048,
                label + " direct MEP source is missing or under-resolved.");
            return texture;
        }

        private static void ValidateMaterial(string path, Shader shader,
                                             Texture2D dust,
                                             Texture2D compacted,
                                             Texture2D aggregate,
                                             float minOpacity,
                                             float maxOpacity,
                                             float minDust,
                                             float maxDust,
                                             float minRuts,
                                             float maxRuts)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == dust
                && material.GetTexture("_SecondaryTex") == compacted
                && material.GetTexture("_AggregateTex") == aggregate,
                path + " does not directly use all three selected MEP sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored Tract range.");
            Require(material.GetFloat("_Dust") >= minDust
                && material.GetFloat("_Dust") <= maxDust,
                path + " dust strength is outside its authored range.");
            Require(material.GetFloat("_Ruts") >= minRuts
                && material.GetFloat("_Ruts") <= maxRuts,
                path + " rut strength is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 8f,
                path + " lacks separate aggregate detail and traffic scales.");
        }

        private static void ValidateSurface(string name, string meshPath,
                                            string materialPath,
                                            int minimumVertices)
        {
            GameObject surface = GameObject.Find(name);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            Require(surface != null && mesh != null
                && mesh.vertexCount >= minimumVertices,
                name + " is absent or under-resolved.");
            MeshFilter filter = surface.GetComponent<MeshFilter>();
            MeshRenderer renderer = surface.GetComponent<MeshRenderer>();
            Require(filter != null && filter.sharedMesh == mesh
                && renderer != null && renderer.sharedMaterial == material
                && renderer.shadowCastingMode == ShadowCastingMode.Off,
                name + " does not use its persistent mesh and MEP material.");
        }

        private static void CreateSurface(string name, Transform parent,
                                          Mesh mesh, Material material)
        {
            GameObject surface = new GameObject(name);
            surface.transform.SetParent(parent, false);
            surface.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = true;
            GameObjectUtility.SetStaticEditorFlags(surface,
                StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Mesh PersistMesh(string path, Mesh generated)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
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

        private sealed class WearAccumulator
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<Vector3> normals = new List<Vector3>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private readonly List<Color> colors = new List<Color>();
            private readonly List<int> triangles = new List<int>();

            internal void AddRibbon(Vector2[] controlPoints, float halfWidthKm,
                                    float lift, int subdivisions, float seed)
            {
                List<Vector2> smooth = Smooth(controlPoints, subdivisions);
                float accumulated = 0f;
                for (int i = 0; i < smooth.Count; i++)
                {
                    Vector2 point = smooth[i];
                    if (i > 0) accumulated += Vector2.Distance(smooth[i - 1], point);
                    Vector2 previous = smooth[Mathf.Max(0, i - 1)];
                    Vector2 next = smooth[Mathf.Min(smooth.Count - 1, i + 1)];
                    Vector2 tangent = (next - previous).normalized;
                    Vector2 side = new Vector2(-tangent.y, tangent.x);
                    float width = halfWidthKm
                        * (1f + Mathf.Sin(i * 0.73f + seed) * 0.075f
                            + Mathf.Sin(i * 0.29f - seed) * 0.035f);
                    int row = vertices.Count;
                    for (int band = 0; band < 5; band++)
                    {
                        float signed = -1f + band * 0.5f;
                        Vector2 sample = point + side * width * signed;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y);
                        float visibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.78f, -0.22f, terrainHeight));
                        vertices.Add(World(sample.x, sample.y,
                            terrainHeight + lift + (band == 2 ? 0.001f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(signed, accumulated * 0.12f + seed));
                        colors.Add(new Color(1f, 1f, 1f, visibility));
                    }
                    if (i == 0) continue;
                    for (int band = 0; band < 4; band++)
                    {
                        int previousLeft = row - 5 + band;
                        int previousRight = previousLeft + 1;
                        int currentLeft = row + band;
                        int currentRight = currentLeft + 1;
                        triangles.Add(previousLeft);
                        triangles.Add(currentLeft);
                        triangles.Add(previousRight);
                        triangles.Add(currentLeft);
                        triangles.Add(currentRight);
                        triangles.Add(previousRight);
                    }
                }
            }

            internal void AddPatch(Vector2 centre, Vector2 radiusKm,
                                   float rotationDegrees, float lift,
                                   int segments, float seed)
            {
                int centreIndex = vertices.Count;
                float centreHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    centre.x, centre.y);
                vertices.Add(World(centre.x, centre.y, centreHeight + lift));
                normals.Add(Vector3.up);
                uv.Add(new Vector2(0f, seed));
                colors.Add(Color.white);
                float rotation = rotationDegrees * Mathf.Deg2Rad;
                float cosRotation = Mathf.Cos(rotation);
                float sinRotation = Mathf.Sin(rotation);
                int previous = -1;
                for (int i = 0; i <= segments; i++)
                {
                    float progress = i / (float)segments;
                    float angle = progress * Mathf.PI * 2f;
                    float wobble = 1f + Mathf.Sin(angle * 3f + seed) * 0.105f
                        + Mathf.Sin(angle * 7f - seed * 0.71f) * 0.052f;
                    float localX = Mathf.Cos(angle) * radiusKm.x * wobble;
                    float localY = Mathf.Sin(angle) * radiusKm.y * wobble;
                    float x = centre.x + localX * cosRotation - localY * sinRotation;
                    float y = centre.y + localX * sinRotation + localY * cosRotation;
                    float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
                    int current = vertices.Count;
                    vertices.Add(World(x, y, terrainHeight + lift));
                    normals.Add(Vector3.up);
                    uv.Add(new Vector2(1f, progress * 4.7f + seed));
                    colors.Add(Color.white);
                    if (previous >= 0)
                    {
                        triangles.Add(centreIndex);
                        triangles.Add(previous);
                        triangles.Add(current);
                    }
                    previous = current;
                }
            }

            private static List<Vector2> Smooth(Vector2[] points, int subdivisions)
            {
                List<Vector2> result = new List<Vector2>();
                for (int segment = 0; segment < points.Length - 1; segment++)
                {
                    Vector2 p0 = points[Mathf.Max(0, segment - 1)];
                    Vector2 p1 = points[segment];
                    Vector2 p2 = points[segment + 1];
                    Vector2 p3 = points[Mathf.Min(points.Length - 1, segment + 2)];
                    for (int step = 0; step < subdivisions; step++)
                    {
                        float t = step / (float)subdivisions;
                        float t2 = t * t;
                        float t3 = t2 * t;
                        result.Add(0.5f * ((2f * p1) + (-p0 + p2) * t
                            + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2
                            + (-p0 + 3f * p1 - 3f * p2 + p3) * t3));
                    }
                }
                result.Add(points[points.Length - 1]);
                return result;
            }

            internal Mesh Build(string name)
            {
                Mesh mesh = new Mesh { name = name };
                mesh.SetVertices(vertices);
                mesh.SetNormals(normals);
                mesh.SetUVs(0, uv);
                mesh.SetColors(colors);
                mesh.SetTriangles(triangles, 0, true);
                mesh.RecalculateBounds();
                return mesh;
            }
        }
    }
}
