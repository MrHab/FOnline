using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 14/20: layered peat seams, chemical runoff and oily
    /// industrial stains articulate the connected pools of the Zero Basin while
    /// remaining below the authored open-water surfaces.
    /// </summary>
    internal static class KromkaGlobalMapZeroDepositsAuthoring
    {
        internal const int TextureIteration = 14;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalZeroDeposits.shader";
        private const string PeatTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/ForestFloor_C_Dif.tga";
        private const string WetSoilTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Soil_01_N_Dif.tga";
        private const string PeatMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalZero_PeatSeams_MEP.mat";
        private const string ChemicalMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalZero_ChemicalRunoff_MEP.mat";
        private const string OilMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalZero_OilStains_MEP.mat";
        private const string PeatMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalZero_PeatSeams.asset";
        private const string ChemicalMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalZero_ChemicalRunoff.asset";
        private const string OilMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalZero_OilStains.asset";

        private static readonly Vector2[] ZeroWetlandSpine =
        {
            new Vector2(119f, 52f), new Vector2(144f, 54f),
            new Vector2(169f, 59f), new Vector2(193f, 55f),
            new Vector2(216f, 45f), new Vector2(239f, 54f),
            new Vector2(260f, 68f)
        };

        private static readonly Vector2[] ZeroEastDrain =
        {
            new Vector2(278f, 63f), new Vector2(259f, 72f),
            new Vector2(240f, 79f), new Vector2(221f, 89f),
            new Vector2(202f, 98f)
        };

        private static readonly Vector2[] ZeroPoolConnectorWest =
        {
            new Vector2(137f, 82f), new Vector2(145f, 75f),
            new Vector2(154f, 67f), new Vector2(169f, 59f)
        };

        private static readonly Vector2[] ZeroPoolConnectorCentre =
        {
            new Vector2(169f, 59f), new Vector2(190f, 55f),
            new Vector2(214f, 43f)
        };

        private static readonly Vector2[] ZeroPoolConnectorEast =
        {
            new Vector2(257f, 68f), new Vector2(246f, 61f),
            new Vector2(231f, 52f), new Vector2(214f, 43f)
        };

        private static readonly Vector2[] ZeroSubsidenceWest =
        {
            new Vector2(115f, 91f), new Vector2(129f, 78f),
            new Vector2(145f, 67f)
        };

        private static readonly Vector2[] ZeroSubsidenceEast =
        {
            new Vector2(273f, 83f), new Vector2(260f, 71f),
            new Vector2(249f, 60f)
        };

        private static readonly Vector2[] ChemicalSpringSpill =
        {
            new Vector2(168f, 76f), new Vector2(161f, 69f),
            new Vector2(155f, 61f), new Vector2(151f, 54f)
        };

        private static readonly Vector2[] FuelRampLeak =
        {
            new Vector2(147f, 45f), new Vector2(162f, 49f),
            new Vector2(178f, 54f), new Vector2(193f, 55f)
        };

        private static readonly Vector2[] RegeneratorDrain =
        {
            new Vector2(205f, 65f), new Vector2(203f, 58f),
            new Vector2(208f, 50f), new Vector2(214f, 43f)
        };

        private static readonly Vector2[] BalanceSeep =
        {
            new Vector2(247f, 49f), new Vector2(238f, 48f),
            new Vector2(226f, 45f), new Vector2(214f, 43f)
        };

        internal static void Compose(Transform root)
        {
            Material peat = BuildMaterial(PeatMaterialPath,
                new Color(0.30f, 0.32f, 0.15f, 1f),
                new Color(0.025f, 0.052f, 0.030f, 1f),
                3.7f, 0.44f, 0.52f, 0.40f,
                0.95f, 0.08f, 0.86f, 0.04f, 0.61f);
            Material chemical = BuildMaterial(ChemicalMaterialPath,
                new Color(0.48f, 0.59f, 0.15f, 1f),
                new Color(0.038f, 0.073f, 0.020f, 1f),
                3.3f, 0.41f, 0.68f, 0.28f,
                0.52f, 0.92f, 0.72f, 0.06f, 2.03f);
            Material oil = BuildMaterial(OilMaterialPath,
                new Color(0.12f, 0.15f, 0.11f, 1f),
                new Color(0.012f, 0.025f, 0.022f, 1f),
                3.9f, 0.47f, 0.62f, 0.30f,
                0.68f, 0.52f, 0.94f, 0.95f, 3.67f);

            DepositAccumulator peatMesh = new DepositAccumulator();
            peatMesh.AddRibbon(ZeroWetlandSpine, 4.8f, 0.058f, 7, 0.47f);
            peatMesh.AddRibbon(ZeroEastDrain, 3.0f, 0.059f, 7, 1.31f);

            DepositAccumulator chemicalMesh = new DepositAccumulator();
            chemicalMesh.AddRibbon(ZeroPoolConnectorWest, 1.05f, 0.064f, 8, 0.73f);
            chemicalMesh.AddRibbon(ZeroPoolConnectorCentre, 1.18f, 0.064f, 8, 1.49f);
            chemicalMesh.AddRibbon(ZeroPoolConnectorEast, 1.02f, 0.064f, 8, 2.21f);
            chemicalMesh.AddRibbon(ZeroSubsidenceWest, 0.78f, 0.065f, 8, 2.93f);
            chemicalMesh.AddRibbon(ZeroSubsidenceEast, 0.76f, 0.065f, 8, 3.59f);
            chemicalMesh.AddEllipticalBand(new Vector2(168f, 76f),
                new Vector2(11f, 6.5f), 2.2f, 0.066f, 1.17f, 72);

            DepositAccumulator oilMesh = new DepositAccumulator();
            oilMesh.AddRibbon(ChemicalSpringSpill, 1.6f, 0.068f, 8, 0.89f);
            oilMesh.AddRibbon(FuelRampLeak, 1.9f, 0.068f, 8, 1.73f);
            oilMesh.AddRibbon(RegeneratorDrain, 1.45f, 0.068f, 8, 2.57f);
            oilMesh.AddRibbon(BalanceSeep, 1.35f, 0.068f, 8, 3.41f);
            oilMesh.AddEllipticalBand(new Vector2(147f, 45f),
                new Vector2(10f, 5.8f), 2.5f, 0.069f, 0.53f, 72);
            oilMesh.AddEllipticalBand(new Vector2(205f, 65f),
                new Vector2(8.8f, 5.2f), 2.1f, 0.069f, 1.97f, 72);
            oilMesh.AddEllipticalBand(new Vector2(247f, 49f),
                new Vector2(7.8f, 4.8f), 1.9f, 0.069f, 3.13f, 72);

            CreateSurface("ZeroPeatSeams_SURFACE_MEP", root,
                PersistMesh(PeatMeshPath,
                    peatMesh.Build("Kromka_GlobalZero_PeatSeams")), peat);
            CreateSurface("ZeroChemicalRunoff_SURFACE_MEP", root,
                PersistMesh(ChemicalMeshPath,
                    chemicalMesh.Build("Kromka_GlobalZero_ChemicalRunoff")), chemical);
            CreateSurface("ZeroOilStains_SURFACE_MEP", root,
                PersistMesh(OilMeshPath,
                    oilMesh.Build("Kromka_GlobalZero_OilStains")), oil);
            Child(root, "ZeroPeatSpines_2_REFERENCE");
            Child(root, "ZeroChemicalChannels_5_REFERENCE");
            Child(root, "ZeroIndustrialStains_3_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 14")]
        public static void ValidateIteration14()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka Zero Basin deposit shader is missing or invalid.");
            Texture2D peat = ValidateSource(PeatTexturePath, "Zero Basin peat");
            Texture2D wetSoil = ValidateSource(WetSoilTexturePath,
                "Zero Basin saturated soil");
            ValidateMaterial(PeatMaterialPath, shader, peat, wetSoil,
                0.46f, 0.58f, 0.02f, 0.14f, 0f, 0.10f);
            ValidateMaterial(ChemicalMaterialPath, shader, peat, wetSoil,
                0.62f, 0.74f, 0.86f, 0.98f, 0f, 0.12f);
            ValidateMaterial(OilMaterialPath, shader, peat, wetSoil,
                0.56f, 0.68f, 0.44f, 0.60f, 0.88f, 1f);
            ValidateSurface("ZeroPeatSeams_SURFACE_MEP",
                PeatMeshPath, PeatMaterialPath, 200);
            ValidateSurface("ZeroChemicalRunoff_SURFACE_MEP",
                ChemicalMeshPath, ChemicalMaterialPath, 500);
            ValidateSurface("ZeroOilStains_SURFACE_MEP",
                OilMeshPath, OilMaterialPath, 900);
            Require(GameObject.Find("ZeroPeatSpines_2_REFERENCE") != null
                && GameObject.Find("ZeroChemicalChannels_5_REFERENCE") != null
                && GameObject.Find("ZeroIndustrialStains_3_REFERENCE") != null,
                "Zero Basin deposit geography reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 70%] PASS: two direct high-resolution MEP "
                + "organic sources form two peat spines, five chemical channels "
                + "and three industrial oil-stain fields around the basin pools.");
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float organic, float toxicity,
                                              float wetness, float oilSheen,
                                              float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D peat = AssetDatabase.LoadAssetAtPath<Texture2D>(PeatTexturePath);
            Texture2D wetSoil = AssetDatabase.LoadAssetAtPath<Texture2D>(
                WetSoilTexturePath);
            if (shader == null || peat == null || wetSoil == null)
                throw new InvalidOperationException(
                    "Zero Basin deposit shader or direct MEP texture is missing.");
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
            material.SetTexture("_MainTex", peat);
            material.SetTexture("_SecondaryTex", wetSoil);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Organic", organic);
            material.SetFloat("_Toxicity", toxicity);
            material.SetFloat("_Wetness", wetness);
            material.SetFloat("_OilSheen", oilSheen);
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
                                             Texture2D peat, Texture2D wetSoil,
                                             float minOpacity, float maxOpacity,
                                             float minToxicity, float maxToxicity,
                                             float minOil, float maxOil)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == peat
                && material.GetTexture("_SecondaryTex") == wetSoil,
                path + " does not directly use both selected MEP sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored basin range.");
            Require(material.GetFloat("_Toxicity") >= minToxicity
                && material.GetFloat("_Toxicity") <= maxToxicity,
                path + " toxicity is outside its authored range.");
            Require(material.GetFloat("_OilSheen") >= minOil
                && material.GetFloat("_OilSheen") <= maxOil,
                path + " oil sheen is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 6f,
                path + " lacks separate peat detail and basin scales.");
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

        private sealed class DepositAccumulator
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
                    if (i > 0)
                        accumulated += Vector2.Distance(smooth[i - 1], point);
                    Vector2 previous = smooth[Mathf.Max(0, i - 1)];
                    Vector2 next = smooth[Mathf.Min(smooth.Count - 1, i + 1)];
                    Vector2 tangent = (next - previous).normalized;
                    Vector2 side = new Vector2(-tangent.y, tangent.x);
                    float width = halfWidthKm
                        * (1f + Mathf.Sin(i * 0.83f + seed) * 0.11f);
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float signed = band == 0 ? 1f : band == 1 ? 0f : -1f;
                        Vector2 sample = point + side * width * signed;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y);
                        float visibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.76f, -0.30f, terrainHeight));
                        vertices.Add(World(sample.x, sample.y,
                            terrainHeight + lift + (band == 1 ? 0.002f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            accumulated * 0.14f + seed));
                        colors.Add(new Color(1f, 1f, 1f, visibility));
                    }
                    if (i == 0) continue;
                    AddStripTriangles(index);
                }
            }

            internal void AddEllipticalBand(Vector2 centre, Vector2 radiusKm,
                                            float widthKm, float lift,
                                            float seed, int segments)
            {
                for (int i = 0; i <= segments; i++)
                {
                    float progress = i / (float)segments;
                    float angle = progress * Mathf.PI * 2f;
                    float wobble = 1f + Mathf.Sin(angle * 3f + seed) * 0.085f
                        + Mathf.Sin(angle * 8f - seed * 0.6f) * 0.032f;
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float offset = band == 0 ? widthKm * 0.5f
                            : band == 1 ? 0f : -widthKm * 0.5f;
                        float x = centre.x + Mathf.Cos(angle)
                            * (radiusKm.x * wobble + offset);
                        float y = centre.y + Mathf.Sin(angle)
                            * (radiusKm.y * wobble + offset * 0.72f);
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
                        vertices.Add(World(x, y,
                            terrainHeight + lift + (band == 1 ? 0.002f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            progress * 5f + seed));
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
