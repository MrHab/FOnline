using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 10/20: relief-conforming littoral deposits. The single
    /// Tesma channel receives wet silt banks; clean northern and karst water receives dry
    /// mineral waterlines; the Zero Basin receives broken chemical crust rings.
    /// </summary>
    internal static class KromkaGlobalMapShorelineAuthoring
    {
        internal const int TextureIteration = 10;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalShoreline.shader";
        private const string DryMineralTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_03.tga";
        private const string WetSiltTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Soil_01_N_Dif.tga";
        private const string ToxicCrustTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Dessert_Base_N.tga";

        private const string DryMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalShore_DryMineral_MEP.mat";
        private const string SiltMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalShore_WetSilt_MEP.mat";
        private const string ToxicMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalShore_ToxicCrust_MEP.mat";
        private const string DryMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalShore_DryMineral.asset";
        private const string SiltMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalShore_WetSilt.asset";
        private const string ToxicMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalShore_ToxicCrust.asset";

        internal static void Compose(Transform root)
        {
            Material dry = BuildMaterial(DryMaterialPath, DryMineralTexturePath,
                new Color(0.66f, 0.61f, 0.50f, 1f),
                new Color(0.31f, 0.27f, 0.18f, 1f),
                2.9f, 0.42f, 0.64f, 0.36f, 0.70f, 0f, 0f, 0.71f);
            Material silt = BuildMaterial(SiltMaterialPath, WetSiltTexturePath,
                new Color(0.42f, 0.38f, 0.29f, 1f),
                new Color(0.11f, 0.13f, 0.10f, 1f),
                3.2f, 0.36f, 0.66f, 0.31f, 0.58f, 0.72f, 0f, 2.13f);
            Material toxic = BuildMaterial(ToxicMaterialPath, ToxicCrustTexturePath,
                new Color(0.40f, 0.36f, 0.14f, 1f),
                new Color(0.075f, 0.095f, 0.030f, 1f),
                3.4f, 0.46f, 0.62f, 0.40f, 0.80f, 0.38f, 0.84f, 4.37f);

            ShoreAccumulator siltMesh = new ShoreAccumulator();
            siltMesh.AddRiverBanks(KromkaGlobalMapWaterAuthoring.TesmaPath, 1.9f, 2.55f,
                3.6f, 0.058f, KromkaGlobalMapWaterAuthoring.RiverSubdivisions, 0.83f);

            ShoreAccumulator dryMesh = new ShoreAccumulator();
            dryMesh.AddPoolRing(new Vector2(157f, 273f), new Vector2(27f, 14.5f),
                0.35f, 2.8f, 0.071f, 0.13f, 64);
            dryMesh.AddPoolRing(new Vector2(211f, 276f), new Vector2(26f, 15f),
                0.35f, 2.7f, 0.071f, 1.37f, 64);
            dryMesh.AddPoolRing(new Vector2(249f, 258f), new Vector2(23f, 12.5f),
                0.30f, 2.5f, 0.068f, 2.61f, 64);
            dryMesh.AddPoolRing(new Vector2(276f, 108f), new Vector2(7.5f, 5.0f),
                0.18f, 1.45f, 0.050f, 3.31f, 40);
            dryMesh.AddPoolRing(new Vector2(307f, 98f), new Vector2(6.0f, 4.3f),
                0.16f, 1.30f, 0.050f, 4.03f, 40);
            dryMesh.AddPoolRing(new Vector2(337f, 87f), new Vector2(8.0f, 5.2f),
                0.18f, 1.55f, 0.050f, 4.79f, 40);
            dryMesh.AddPoolRing(new Vector2(292f, 68f), new Vector2(5.8f, 4.1f),
                0.15f, 1.25f, 0.048f, 5.41f, 40);
            dryMesh.AddPoolRing(new Vector2(326f, 58f), new Vector2(7.1f, 4.7f),
                0.17f, 1.40f, 0.048f, 6.17f, 40);
            dryMesh.AddPoolRing(new Vector2(334f, 70f), new Vector2(5.6f, 3.9f),
                0.15f, 1.20f, 0.048f, 6.91f, 40);

            ShoreAccumulator toxicMesh = new ShoreAccumulator();
            toxicMesh.AddPoolRing(new Vector2(144f, 64f), new Vector2(14f, 6.5f),
                0.28f, 2.0f, 0.061f, 0.46f, 64);
            toxicMesh.AddPoolRing(new Vector2(214f, 43f), new Vector2(22f, 11.5f),
                0.28f, 2.1f, 0.061f, 1.72f, 64);
            toxicMesh.AddPoolRing(new Vector2(257f, 68f), new Vector2(22f, 12f),
                0.25f, 1.9f, 0.059f, 2.94f, 64);
            toxicMesh.AddPoolRing(new Vector2(137f, 82f), new Vector2(18f, 10f),
                0.22f, 1.7f, 0.059f, 4.18f, 56);

            CreateSurface("TesmaWetSiltBanks_SURFACE_MEP", root,
                PersistMesh(SiltMeshPath,
                    siltMesh.Build("Kromka_GlobalShore_WetSilt")), silt);
            CreateSurface("DryMineralWaterlines_SURFACE_MEP", root,
                PersistMesh(DryMeshPath,
                    dryMesh.Build("Kromka_GlobalShore_DryMineral")), dry);
            CreateSurface("ToxicCrustWaterlines_SURFACE_MEP", root,
                PersistMesh(ToxicMeshPath,
                    toxicMesh.Build("Kromka_GlobalShore_ToxicCrust")), toxic);
            Child(root, "SingleTesmaSiltBanks_REFERENCE");
            Child(root, "NorthernRelictWaterlines_3_REFERENCE");
            Child(root, "ChalkKarstMineralRims_6_REFERENCE");
            Child(root, "ZeroToxicCrustRims_4_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 10")]
        public static void ValidateIteration10()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka global shoreline shader is missing or invalid.");
            Texture2D dryTexture = ValidateSource(DryMineralTexturePath,
                "dry mineral shoreline");
            Texture2D siltTexture = ValidateSource(WetSiltTexturePath,
                "wet silt shoreline");
            Texture2D toxicTexture = ValidateSource(ToxicCrustTexturePath,
                "toxic crust shoreline");
            ValidateMaterial(DryMaterialPath, shader, dryTexture,
                0.58f, 0.70f, 0f, 0.05f, 0f, 0.05f);
            ValidateMaterial(SiltMaterialPath, shader, siltTexture,
                0.60f, 0.72f, 0.65f, 0.80f, 0f, 0.05f);
            ValidateMaterial(ToxicMaterialPath, shader, toxicTexture,
                0.56f, 0.68f, 0.32f, 0.44f, 0.78f, 0.90f);
            ValidateSurface("TesmaWetSiltBanks_SURFACE_MEP",
                SiltMeshPath, SiltMaterialPath, 820);
            ValidateSurface("DryMineralWaterlines_SURFACE_MEP",
                DryMeshPath, DryMaterialPath, 1300);
            ValidateSurface("ToxicCrustWaterlines_SURFACE_MEP",
                ToxicMeshPath, ToxicMaterialPath, 740);
            Require(GameObject.Find("SingleTesmaSiltBanks_REFERENCE") != null
                && GameObject.Find("NorthernRelictWaterlines_3_REFERENCE") != null
                && GameObject.Find("ChalkKarstMineralRims_6_REFERENCE") != null
                && GameObject.Find("ZeroToxicCrustRims_4_REFERENCE") != null,
                "One or more shoreline geography reference handles are missing.");
            Debug.Log("[KROMKA TEXTURES 50%] PASS: three direct 2048+ MEP surfaces "
                + "form relief-conforming banks along the single Tesma channel, three northern "
                + "relict waterlines, six karst mineral rims and four toxic crust rings.");
        }

        private static Material BuildMaterial(string path, string texturePath,
                                              Color tint, Color darkTint,
                                              float detailTiling, float macroTiling,
                                              float opacity, float edgeFade,
                                              float breakup, float wetness,
                                              float toxicity, float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
            if (shader == null || texture == null)
                throw new InvalidOperationException("Shoreline shader or MEP texture is missing.");
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
            material.SetTexture("_MainTex", texture);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Breakup", breakup);
            material.SetFloat("_Wetness", wetness);
            material.SetFloat("_Toxicity", toxicity);
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

        private static void ValidateMaterial(string path, Shader shader, Texture2D texture,
                                             float minOpacity, float maxOpacity,
                                             float minWetness, float maxWetness,
                                             float minToxicity, float maxToxicity)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == texture,
                path + " does not directly use its selected MEP shoreline source.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored shoreline range.");
            Require(material.GetFloat("_Wetness") >= minWetness
                && material.GetFloat("_Wetness") <= maxWetness,
                path + " wetness is outside its authored shoreline range.");
            Require(material.GetFloat("_Toxicity") >= minToxicity
                && material.GetFloat("_Toxicity") <= maxToxicity,
                path + " toxicity is outside its authored shoreline range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 6f,
                path + " lacks distinct littoral detail and macro scales.");
        }

        private static void ValidateSurface(string name, string meshPath,
                                            string materialPath, int minimumVertices)
        {
            GameObject surface = GameObject.Find(name);
            Mesh mesh = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
            Material material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            Require(surface != null && mesh != null && mesh.vertexCount >= minimumVertices,
                name + " is absent or under-resolved.");
            MeshFilter filter = surface.GetComponent<MeshFilter>();
            MeshRenderer renderer = surface.GetComponent<MeshRenderer>();
            Require(filter != null && filter.sharedMesh == mesh
                && renderer != null && renderer.sharedMaterial == material
                && renderer.shadowCastingMode == ShadowCastingMode.Off,
                name + " does not use its persistent mesh and MEP shoreline material.");
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

        private sealed class ShoreAccumulator
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<Vector3> normals = new List<Vector3>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private readonly List<int> triangles = new List<int>();

            internal void AddPoolRing(Vector2 centre, Vector2 radiusKm,
                                      float innerOverlapKm, float bandWidthKm,
                                      float lift, float seed, int segments)
            {
                for (int i = 0; i <= segments; i++)
                {
                    float progress = i / (float)segments;
                    float angle = progress * Mathf.PI * 2f;
                    float irregularity = 1f
                        + Mathf.Sin(angle * 3f + seed) * 0.028f
                        + Mathf.Sin(angle * 7f + seed * 1.91f) * 0.021f;
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float offset = band == 0 ? -innerOverlapKm
                            : band == 1 ? bandWidthKm * 0.43f : bandWidthKm;
                        float xRadius = Mathf.Max(0.5f, radiusKm.x + offset) * irregularity;
                        float yRadius = Mathf.Max(0.5f, radiusKm.y + offset * 0.62f)
                            * irregularity;
                        float x = centre.x + Mathf.Cos(angle) * xRadius;
                        float y = centre.y + Mathf.Sin(angle) * yRadius;
                        float height = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y) + lift;
                        vertices.Add(World(x, y, height));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            progress * 4f + seed));
                    }
                    if (i == 0) continue;
                    AddStripTriangles(index);
                }
            }

            internal void AddRiverBanks(Vector2[] controlPoints,
                                        float minimumHalfWidthKm,
                                        float maximumHalfWidthKm,
                                        float bankWidthKm, float lift,
                                        int subdivisions, float seed)
            {
                List<Vector2> smooth = Smooth(controlPoints, subdivisions);
                float accumulated = 0f;
                for (int i = 0; i < smooth.Count; i++)
                {
                    Vector2 point = smooth[i];
                    Vector2 previous = smooth[Mathf.Max(0, i - 1)];
                    Vector2 next = smooth[Mathf.Min(smooth.Count - 1, i + 1)];
                    Vector2 tangent = (next - previous).normalized;
                    Vector2 side = new Vector2(-tangent.y, tangent.x);
                    float width = Mathf.Lerp(minimumHalfWidthKm, maximumHalfWidthKm,
                        0.5f + 0.5f * Mathf.Sin(i * 0.19f + 0.4f))
                        + Mathf.Sin(i * 1.71f) * 0.16f;
                    float progress = i / (float)(smooth.Count - 1);
                    width *= Mathf.SmoothStep(0.42f, 1f,
                        Mathf.Clamp01(Mathf.Min(progress, 1f - progress) * 14f));
                    if (i > 0) accumulated += Vector2.Distance(smooth[i - 1], point);
                    int index = vertices.Count;
                    AddBankSection(point, side, width, bankWidthKm, 1f,
                        lift, accumulated, seed);
                    AddBankSection(point, side, width, bankWidthKm, -1f,
                        lift, accumulated, seed + 0.47f);
                    if (i == 0) continue;
                    AddSectionTriangles(index - 6, index);
                    AddSectionTriangles(index - 3, index + 3);
                }
            }

            private void AddBankSection(Vector2 point, Vector2 side, float waterWidth,
                                        float bankWidth, float sign, float lift,
                                        float accumulated, float seed)
            {
                float[] offsets =
                {
                    waterWidth + bankWidth,
                    waterWidth + bankWidth * 0.44f,
                    Mathf.Max(0.05f, waterWidth - 0.18f)
                };
                for (int band = 0; band < 3; band++)
                {
                    float irregularity = 1f
                        + Mathf.Sin(accumulated * 0.23f + seed + band * 0.61f) * 0.045f;
                    Vector2 sample = point + side * (offsets[band] * sign * irregularity);
                    float height = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                        sample.x, sample.y) + lift;
                    vertices.Add(World(sample.x, sample.y, height));
                    normals.Add(Vector3.up);
                    uv.Add(new Vector2(band == 1 ? 1f : 0f,
                        accumulated * 0.11f + seed));
                }
            }

            private void AddStripTriangles(int index)
            {
                AddSectionTriangles(index - 3, index);
            }

            private void AddSectionTriangles(int previous, int current)
            {
                triangles.Add(previous);
                triangles.Add(current);
                triangles.Add(previous + 1);
                triangles.Add(current);
                triangles.Add(current + 1);
                triangles.Add(previous + 1);
                triangles.Add(previous + 1);
                triangles.Add(current + 1);
                triangles.Add(previous + 2);
                triangles.Add(current + 1);
                triangles.Add(current + 2);
                triangles.Add(previous + 2);
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
                mesh.SetTriangles(triangles, 0, true);
                mesh.RecalculateBounds();
                return mesh;
            }
        }
    }
}
