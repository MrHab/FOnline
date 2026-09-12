using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 11/20: the Ore Arc receives five relief-conforming
    /// quarry strata, two tapered tailings fans and two dusty haul-ramp scars.
    /// </summary>
    internal static class KromkaGlobalMapOreStrataAuthoring
    {
        internal const int TextureIteration = 11;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalQuarryStrata.shader";
        private const string CliffTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_03/Textures/MEP_Cliff_03_Sand_Terrain.tga";
        private const string AggregateTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Textures/MEP_StoneGround_Dif_Sand.png";
        private const string DustTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_N_Dif.tga";

        private const string BenchMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalOre_BenchStrata_MEP.mat";
        private const string TailingsMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalOre_Tailings_MEP.mat";
        private const string RampMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalOre_HaulDust_MEP.mat";
        private const string BenchMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalOre_BenchStrata.asset";
        private const string TailingsMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalOre_Tailings.asset";
        private const string RampMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalOre_HaulDust.asset";

        private static readonly Vector2[] OreHaulRampNorth =
        {
            new Vector2(65f, 221f), new Vector2(78f, 211f),
            new Vector2(94f, 211f), new Vector2(105f, 222f),
            new Vector2(119f, 229f), new Vector2(136f, 225f),
            new Vector2(151f, 212f)
        };

        private static readonly Vector2[] OreHaulRampSouth =
        {
            new Vector2(64f, 220f), new Vector2(60f, 204f),
            new Vector2(68f, 191f), new Vector2(84f, 183f),
            new Vector2(103f, 184f), new Vector2(119f, 194f),
            new Vector2(132f, 204f)
        };

        private static readonly Vector2[] OreTailingsNorth =
        {
            new Vector2(105f, 258f), new Vector2(126f, 254f),
            new Vector2(145f, 247f), new Vector2(162f, 238f)
        };

        private static readonly Vector2[] OreTailingsSouth =
        {
            new Vector2(91f, 172f), new Vector2(111f, 174f),
            new Vector2(130f, 181f), new Vector2(146f, 190f)
        };

        internal static void Compose(Transform root)
        {
            Material bench = BuildMaterial(BenchMaterialPath,
                CliffTexturePath, AggregateTexturePath,
                new Color(0.92f, 0.55f, 0.25f, 1f),
                new Color(0.15f, 0.052f, 0.022f, 1f),
                2.8f, 0.42f, 0.82f, 0.22f, 0.50f, 0.90f, 0.14f, 0.73f);
            Material tailings = BuildMaterial(TailingsMaterialPath,
                AggregateTexturePath, CliffTexturePath,
                new Color(0.43f, 0.33f, 0.25f, 1f),
                new Color(0.16f, 0.11f, 0.075f, 1f),
                3.2f, 0.48f, 0.60f, 0.34f, 0.72f, 0.37f, 0.54f, 2.19f);
            Material ramp = BuildMaterial(RampMaterialPath,
                DustTexturePath, AggregateTexturePath,
                new Color(0.73f, 0.58f, 0.40f, 1f),
                new Color(0.30f, 0.19f, 0.11f, 1f),
                3.5f, 0.51f, 0.62f, 0.30f, 0.58f, 0.26f, 0.82f, 4.31f);

            OreAccumulator benchMesh = new OreAccumulator();
            benchMesh.AddEllipticalBand(new Vector2(70f, 220f), new Vector2(42f, 42f),
                0.19f, 2.8f, 0.094f, 0.41f, 96);
            benchMesh.AddEllipticalBand(new Vector2(70f, 220f), new Vector2(42f, 42f),
                0.37f, 3.0f, 0.092f, 1.13f, 96);
            benchMesh.AddEllipticalBand(new Vector2(70f, 220f), new Vector2(42f, 42f),
                0.55f, 3.2f, 0.090f, 1.91f, 96);
            benchMesh.AddEllipticalBand(new Vector2(70f, 220f), new Vector2(42f, 42f),
                0.73f, 3.4f, 0.088f, 2.67f, 96);
            benchMesh.AddEllipticalBand(new Vector2(70f, 220f), new Vector2(42f, 42f),
                0.91f, 3.7f, 0.086f, 3.43f, 96);

            OreAccumulator tailingsMesh = new OreAccumulator();
            tailingsMesh.AddTaperedRibbon(OreTailingsNorth,
                4.5f, 10.5f, 0.061f, 8, 0.97f);
            tailingsMesh.AddTaperedRibbon(OreTailingsSouth,
                4.2f, 9.2f, 0.061f, 8, 2.33f);

            OreAccumulator rampMesh = new OreAccumulator();
            rampMesh.AddTaperedRibbon(OreHaulRampNorth,
                1.35f, 2.0f, 0.063f, 6, 3.17f);
            rampMesh.AddTaperedRibbon(OreHaulRampSouth,
                1.35f, 1.9f, 0.063f, 6, 4.49f);

            CreateSurface("OreBenchStrata_SURFACE_MEP", root,
                PersistMesh(BenchMeshPath,
                    benchMesh.Build("Kromka_GlobalOre_BenchStrata")), bench);
            CreateSurface("OreTailingsFans_SURFACE_MEP", root,
                PersistMesh(TailingsMeshPath,
                    tailingsMesh.Build("Kromka_GlobalOre_Tailings")), tailings);
            CreateSurface("OreHaulRampDust_SURFACE_MEP", root,
                PersistMesh(RampMeshPath,
                    rampMesh.Build("Kromka_GlobalOre_HaulDust")), ramp);
            Child(root, "OreBenchStrata_5_REFERENCE");
            Child(root, "OreTailingsFans_2_REFERENCE");
            Child(root, "OreHaulRamps_2_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 11")]
        public static void ValidateIteration11()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka quarry-strata shader is missing or invalid.");
            Texture2D cliff = ValidateSource(CliffTexturePath, "quarry cliff strata");
            Texture2D aggregate = ValidateSource(AggregateTexturePath, "tailings aggregate");
            Texture2D dust = ValidateSource(DustTexturePath, "haul-ramp dust");
            ValidateMaterial(BenchMaterialPath, shader, cliff, aggregate,
                0.76f, 0.86f, 0.84f, 0.96f, 0.08f, 0.20f);
            ValidateMaterial(TailingsMaterialPath, shader, aggregate, cliff,
                0.54f, 0.66f, 0.30f, 0.44f, 0.48f, 0.60f);
            ValidateMaterial(RampMaterialPath, shader, dust, aggregate,
                0.56f, 0.68f, 0.20f, 0.32f, 0.76f, 0.88f);
            ValidateSurface("OreBenchStrata_SURFACE_MEP",
                BenchMeshPath, BenchMaterialPath, 1440);
            ValidateSurface("OreTailingsFans_SURFACE_MEP",
                TailingsMeshPath, TailingsMaterialPath, 145);
            ValidateSurface("OreHaulRampDust_SURFACE_MEP",
                RampMeshPath, RampMaterialPath, 215);
            Require(GameObject.Find("OreBenchStrata_5_REFERENCE") != null
                && GameObject.Find("OreTailingsFans_2_REFERENCE") != null
                && GameObject.Find("OreHaulRamps_2_REFERENCE") != null,
                "Ore Arc strata geography reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 55%] PASS: three direct 2048 MEP rock "
                + "sources form five irregular quarry strata, two tapered tailings "
                + "fans and two dust-scored haul ramps on the final relief field.");
        }

        private static Material BuildMaterial(string path, string mainTexturePath,
                                              string secondaryTexturePath,
                                              Color tint, Color darkTint,
                                              float detailTiling, float macroTiling,
                                              float opacity, float edgeFade,
                                              float breakup, float oxide,
                                              float dust, float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D main = AssetDatabase.LoadAssetAtPath<Texture2D>(mainTexturePath);
            Texture2D secondary = AssetDatabase.LoadAssetAtPath<Texture2D>(
                secondaryTexturePath);
            if (shader == null || main == null || secondary == null)
                throw new InvalidOperationException("Quarry shader or MEP texture is missing.");
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
            material.SetTexture("_MainTex", main);
            material.SetTexture("_SecondaryTex", secondary);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Breakup", breakup);
            material.SetFloat("_Oxide", oxide);
            material.SetFloat("_Dust", dust);
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
                                             Texture2D main, Texture2D secondary,
                                             float minOpacity, float maxOpacity,
                                             float minOxide, float maxOxide,
                                             float minDust, float maxDust)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == main
                && material.GetTexture("_SecondaryTex") == secondary,
                path + " does not directly use its two selected MEP sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored ore range.");
            Require(material.GetFloat("_Oxide") >= minOxide
                && material.GetFloat("_Oxide") <= maxOxide,
                path + " oxide staining is outside its authored range.");
            Require(material.GetFloat("_Dust") >= minDust
                && material.GetFloat("_Dust") <= maxDust,
                path + " dust amount is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 6f,
                path + " lacks distinct quarry detail and macro scales.");
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
                name + " does not use its persistent mesh and MEP ore material.");
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

        private sealed class OreAccumulator
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<Vector3> normals = new List<Vector3>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private readonly List<Color> colors = new List<Color>();
            private readonly List<int> triangles = new List<int>();

            internal void AddEllipticalBand(Vector2 centre, Vector2 baseRadiusKm,
                                            float normalizedRadius, float bandWidthKm,
                                            float lift, float seed, int segments)
            {
                for (int i = 0; i <= segments; i++)
                {
                    float progress = i / (float)segments;
                    float angle = progress * Mathf.PI * 2f;
                    float outline = 1f
                        + Mathf.Sin(angle * 3f + 0.45f) * 0.052f
                        + Mathf.Sin(angle * 7f - 0.90f) * 0.024f;
                    float localBreak = Mathf.Sin(angle * 11f + seed * 1.7f) * 0.016f;
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float offset = band == 0 ? -bandWidthKm * 0.5f
                            : band == 1 ? 0f : bandWidthKm * 0.5f;
                        float radial = (normalizedRadius + localBreak) / outline;
                        float radiusX = Mathf.Max(0.8f,
                            baseRadiusKm.x * radial + offset);
                        float radiusY = Mathf.Max(0.8f,
                            baseRadiusKm.y * radial + offset * 0.78f);
                        float x = centre.x + Mathf.Cos(angle) * radiusX;
                        float y = centre.y + Mathf.Sin(angle) * radiusY;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
                        float height = terrainHeight + lift;
                        float edgeVisibility = normalizedRadius < 0.52f ? 1f
                            : Mathf.SmoothStep(0f, 1f,
                                Mathf.InverseLerp(-0.78f, -0.34f, terrainHeight));
                        if (normalizedRadius >= 0.52f)
                        {
                            float westBankVisibility = Mathf.SmoothStep(0f, 1f,
                                Mathf.InverseLerp(48f, 62f, x));
                            edgeVisibility *= westBankVisibility;
                        }
                        vertices.Add(World(x, y, height));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            progress * 6f + seed));
                        colors.Add(new Color(1f, 1f, 1f, edgeVisibility));
                    }
                    if (i == 0) continue;
                    AddStripTriangles(index);
                }
            }

            internal void AddTaperedRibbon(Vector2[] controlPoints,
                                           float startHalfWidthKm,
                                           float endHalfWidthKm, float lift,
                                           int subdivisions, float seed)
            {
                List<Vector2> smooth = Smooth(controlPoints, subdivisions);
                float accumulated = 0f;
                for (int i = 0; i < smooth.Count; i++)
                {
                    Vector2 point = smooth[i];
                    if (i > 0)
                        accumulated += Vector2.Distance(smooth[i - 1], point);
                    Vector2 previous = smooth[Mathf.Max(0, i - 1)];
                    Vector2 next = smooth[Mathf.Min(smooth.Count - 1, i + 1)];
                    Vector2 tangent = (next - previous).normalized;
                    Vector2 side = new Vector2(-tangent.y, tangent.x);
                    float progress = i / (float)(smooth.Count - 1);
                    float width = Mathf.Lerp(startHalfWidthKm, endHalfWidthKm,
                        Mathf.SmoothStep(0f, 1f, progress));
                    width *= 1f + Mathf.Sin(i * 0.73f + seed) * 0.055f;
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float signed = band == 0 ? 1f : band == 1 ? 0f : -1f;
                        Vector2 sample = point + side * width * signed;
                        float height = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y) + lift + (band == 1 ? 0.002f : 0f);
                        vertices.Add(World(sample.x, sample.y, height));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            accumulated * 0.12f + seed));
                        colors.Add(Color.white);
                    }
                    if (i == 0) continue;
                    AddStripTriangles(index);
                }
            }

            private void AddStripTriangles(int index)
            {
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
