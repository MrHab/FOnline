using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 15/20: weathered concrete aprons, wet spillway bleeds
    /// and six rusty gate streaks ground the Northern Sluices in the final relief.
    /// </summary>
    internal static class KromkaGlobalMapSluiceWeatheringAuthoring
    {
        internal const int TextureIteration = 15;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalSluiceWeathering.shader";
        private const string MasonryTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Textures/MEP_StoneGround_Dif.png";
        private const string RockTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_03/Textures/MEP_Cliff_03_Terrain.png";
        private const string ApronMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalSluice_ConcreteApron_MEP.mat";
        private const string WetMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalSluice_WetBleed_MEP.mat";
        private const string RustMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalSluice_RustStreak_MEP.mat";
        private const string ApronMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalSluice_ConcreteApron.asset";
        private const string WetMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalSluice_WetBleed.asset";
        private const string RustMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalSluice_RustStreak.asset";

        private static readonly Vector2[] NorthernDamFront =
        {
            new Vector2(126f, 242f), new Vector2(153f, 239f),
            new Vector2(181f, 243f), new Vector2(209f, 239f),
            new Vector2(237f, 244f), new Vector2(264f, 241f)
        };

        private static readonly Vector2[] NorthernServiceBench =
        {
            new Vector2(121f, 229f), new Vector2(151f, 226f),
            new Vector2(181f, 229f), new Vector2(211f, 226f),
            new Vector2(241f, 231f), new Vector2(271f, 228f)
        };

        private static readonly Vector2[] SluiceSpillway =
        {
            new Vector2(209f, 286f), new Vector2(207f, 270f),
            new Vector2(199f, 255f), new Vector2(191f, 240f),
            new Vector2(193f, 224f), new Vector2(201f, 209f)
        };

        private static readonly Vector2[] SluiceCascadeWest =
        {
            new Vector2(157f, 273f), new Vector2(166f, 265f),
            new Vector2(179f, 255f), new Vector2(191f, 240f)
        };

        private static readonly Vector2[] SluiceCascadeEast =
        {
            new Vector2(249f, 258f), new Vector2(234f, 253f),
            new Vector2(216f, 249f), new Vector2(199f, 243f),
            new Vector2(191f, 240f)
        };

        private static readonly Vector2[][] RustStreaks =
        {
            new[] { new Vector2(137f, 244f), new Vector2(139f, 237f), new Vector2(142f, 230f) },
            new[] { new Vector2(162f, 241f), new Vector2(164f, 234f), new Vector2(163f, 227f) },
            new[] { new Vector2(185f, 244f), new Vector2(183f, 237f), new Vector2(186f, 229f) },
            new[] { new Vector2(209f, 241f), new Vector2(211f, 234f), new Vector2(209f, 227f) },
            new[] { new Vector2(235f, 245f), new Vector2(233f, 238f), new Vector2(236f, 231f) },
            new[] { new Vector2(257f, 243f), new Vector2(255f, 236f), new Vector2(258f, 229f) }
        };

        private static readonly Vector2[] ReservoirCentres =
        {
            new Vector2(157f, 273f), new Vector2(211f, 276f),
            new Vector2(249f, 258f)
        };

        private static readonly Vector2[] ReservoirRadii =
        {
            new Vector2(29f, 16f), new Vector2(28f, 16.5f),
            new Vector2(25f, 14f)
        };

        internal static void Compose(Transform root)
        {
            Material apron = BuildMaterial(ApronMaterialPath,
                new Color(0.70f, 0.73f, 0.69f, 1f),
                new Color(0.11f, 0.15f, 0.15f, 1f),
                3.2f, 0.40f, 0.68f, 0.32f,
                0.38f, 0.12f, 0.74f, 0.53f);
            Material wet = BuildMaterial(WetMaterialPath,
                new Color(0.38f, 0.51f, 0.52f, 1f),
                new Color(0.035f, 0.075f, 0.082f, 1f),
                3.6f, 0.43f, 0.68f, 0.28f,
                0.95f, 0.22f, 0.48f, 1.91f);
            Material rust = BuildMaterial(RustMaterialPath,
                new Color(0.54f, 0.27f, 0.12f, 1f),
                new Color(0.12f, 0.055f, 0.028f, 1f),
                3.8f, 0.46f, 0.72f, 0.24f,
                0.66f, 0.96f, 0.16f, 3.37f);

            WeatheringAccumulator apronMesh = new WeatheringAccumulator();
            apronMesh.AddRibbon(NorthernDamFront, 4.5f, 0.067f, 7, 0.41f);
            apronMesh.AddRibbon(NorthernServiceBench, 3.5f, 0.067f, 7, 1.17f);
            for (int i = 0; i < ReservoirCentres.Length; i++)
                apronMesh.AddEllipticalBand(ReservoirCentres[i], ReservoirRadii[i],
                    5.2f, 0.066f, 0.67f + i * 0.91f, 72);

            WeatheringAccumulator wetMesh = new WeatheringAccumulator();
            wetMesh.AddRibbon(SluiceSpillway, 2.2f, 0.071f, 7, 0.79f);
            wetMesh.AddRibbon(SluiceCascadeWest, 1.55f, 0.071f, 8, 1.63f);
            wetMesh.AddRibbon(SluiceCascadeEast, 1.50f, 0.071f, 8, 2.47f);
            for (int i = 0; i < ReservoirCentres.Length; i++)
                wetMesh.AddEllipticalBand(ReservoirCentres[i],
                    ReservoirRadii[i] - new Vector2(1.4f, 0.8f),
                    1.9f, 0.072f, 1.13f + i * 0.83f, 72);

            WeatheringAccumulator rustMesh = new WeatheringAccumulator();
            for (int i = 0; i < RustStreaks.Length; i++)
                rustMesh.AddRibbon(RustStreaks[i], 0.82f, 0.075f, 8,
                    0.37f + i * 0.69f);

            CreateSurface("SluiceConcreteAprons_SURFACE_MEP", root,
                PersistMesh(ApronMeshPath,
                    apronMesh.Build("Kromka_GlobalSluice_ConcreteApron")), apron);
            CreateSurface("SluiceWetBleeds_SURFACE_MEP", root,
                PersistMesh(WetMeshPath,
                    wetMesh.Build("Kromka_GlobalSluice_WetBleed")), wet);
            CreateSurface("SluiceRustStreaks_SURFACE_MEP", root,
                PersistMesh(RustMeshPath,
                    rustMesh.Build("Kromka_GlobalSluice_RustStreak")), rust);
            Child(root, "SluiceConcreteAprons_5_REFERENCE");
            Child(root, "SluiceWetBleeds_6_REFERENCE");
            Child(root, "SluiceRustStreaks_6_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 15")]
        public static void ValidateIteration15()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka sluice-weathering shader is missing or invalid.");
            Texture2D masonry = ValidateSource(MasonryTexturePath,
                "sluice masonry");
            Texture2D rock = ValidateSource(RockTexturePath,
                "weathered spillway rock");
            ValidateMaterial(ApronMaterialPath, shader, masonry, rock,
                0.62f, 0.74f, 0.30f, 0.46f, 0.06f, 0.18f);
            ValidateMaterial(WetMaterialPath, shader, masonry, rock,
                0.62f, 0.74f, 0.88f, 1f, 0.16f, 0.28f);
            ValidateMaterial(RustMaterialPath, shader, masonry, rock,
                0.66f, 0.78f, 0.58f, 0.74f, 0.90f, 1f);
            ValidateSurface("SluiceConcreteAprons_SURFACE_MEP",
                ApronMeshPath, ApronMaterialPath, 800);
            ValidateSurface("SluiceWetBleeds_SURFACE_MEP",
                WetMeshPath, WetMaterialPath, 900);
            ValidateSurface("SluiceRustStreaks_SURFACE_MEP",
                RustMeshPath, RustMaterialPath, 300);
            Require(GameObject.Find("SluiceConcreteAprons_5_REFERENCE") != null
                && GameObject.Find("SluiceWetBleeds_6_REFERENCE") != null
                && GameObject.Find("SluiceRustStreaks_6_REFERENCE") != null,
                "Northern Sluices weathering reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 75%] PASS: two direct high-resolution MEP "
                + "masonry sources form five concrete apron systems, six wet "
                + "bleeds and six rusty gate streaks around the northern reservoirs.");
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float wetness, float rust,
                                              float mineral, float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D masonry = AssetDatabase.LoadAssetAtPath<Texture2D>(
                MasonryTexturePath);
            Texture2D rock = AssetDatabase.LoadAssetAtPath<Texture2D>(RockTexturePath);
            if (shader == null || masonry == null || rock == null)
                throw new InvalidOperationException(
                    "Sluice-weathering shader or direct MEP texture is missing.");
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
            material.SetTexture("_MainTex", masonry);
            material.SetTexture("_SecondaryTex", rock);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Wetness", wetness);
            material.SetFloat("_Rust", rust);
            material.SetFloat("_Mineral", mineral);
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
                                             Texture2D masonry, Texture2D rock,
                                             float minOpacity, float maxOpacity,
                                             float minWetness, float maxWetness,
                                             float minRust, float maxRust)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == masonry
                && material.GetTexture("_SecondaryTex") == rock,
                path + " does not directly use both selected MEP sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored sluice range.");
            Require(material.GetFloat("_Wetness") >= minWetness
                && material.GetFloat("_Wetness") <= maxWetness,
                path + " wetness is outside its authored range.");
            Require(material.GetFloat("_Rust") >= minRust
                && material.GetFloat("_Rust") <= maxRust,
                path + " rust bleed is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 6f,
                path + " lacks separate masonry detail and reservoir scales.");
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

        private sealed class WeatheringAccumulator
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
                        * (1f + Mathf.Sin(i * 0.77f + seed) * 0.075f);
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float signed = band == 0 ? 1f : band == 1 ? 0f : -1f;
                        Vector2 sample = point + side * width * signed;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y);
                        float visibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.72f, -0.28f, terrainHeight));
                        vertices.Add(World(sample.x, sample.y,
                            terrainHeight + lift + (band == 1 ? 0.002f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            accumulated * 0.13f + seed));
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
                    float wobble = 1f + Mathf.Sin(angle * 3f + seed) * 0.055f
                        + Mathf.Sin(angle * 8f - seed * 0.7f) * 0.023f;
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
                            progress * 4.7f + seed));
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
