using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 12/20: the Glasslands receive a relief-conforming
    /// six-branch fracture network and three fused impact basins. Broad thermal
    /// shadows sit below narrow cold-glass seams so the plateau reads at map zoom.
    /// </summary>
    internal static class KromkaGlobalMapFusedGlassAuthoring
    {
        internal const int TextureIteration = 12;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalFusedGlass.shader";
        private const string MineralTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Ground_Snow_01_N.tga";
        private const string StoneTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Textures/MEP_StoneGround_Dif.png";
        private const string FusedMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalGlass_FusedSeams_MEP.mat";
        private const string ScorchMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalGlass_ThermalScorch_MEP.mat";
        private const string FusedMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalGlass_FusedSeams.asset";
        private const string ScorchMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalGlass_ThermalScars.asset";

        private static readonly Vector2[] GlassFractureNorth =
        {
            new Vector2(269f, 248f), new Vector2(297f, 230f),
            new Vector2(326f, 223f), new Vector2(351f, 204f)
        };

        private static readonly Vector2[] GlassFractureSouth =
        {
            new Vector2(267f, 184f), new Vector2(294f, 171f),
            new Vector2(326f, 169f), new Vector2(344f, 151f)
        };

        private static readonly Vector2[] GlassFaultCentral =
        {
            new Vector2(266f, 246f), new Vector2(279f, 225f),
            new Vector2(273f, 205f), new Vector2(288f, 184f),
            new Vector2(283f, 161f), new Vector2(296f, 139f)
        };

        private static readonly Vector2[] GlassFaultEast =
        {
            new Vector2(342f, 246f), new Vector2(332f, 225f),
            new Vector2(347f, 204f), new Vector2(339f, 184f),
            new Vector2(351f, 164f), new Vector2(340f, 148f)
        };

        private static readonly Vector2[] GlassSplinterNorth =
        {
            new Vector2(285f, 244f), new Vector2(301f, 232f),
            new Vector2(316f, 220f)
        };

        private static readonly Vector2[] GlassSplinterEast =
        {
            new Vector2(319f, 208f), new Vector2(332f, 196f),
            new Vector2(346f, 187f)
        };

        internal static void Compose(Transform root)
        {
            Material fused = BuildMaterial(FusedMaterialPath,
                new Color(0.25f, 0.90f, 0.95f, 1f),
                new Color(0.025f, 0.12f, 0.14f, 1f),
                4.2f, 0.46f, 0.90f, 0.18f, 0.95f, 0.06f, 0.38f, 1.27f);
            Material scorch = BuildMaterial(ScorchMaterialPath,
                new Color(0.31f, 0.29f, 0.25f, 1f),
                new Color(0.055f, 0.043f, 0.035f, 1f),
                3.1f, 0.39f, 0.44f, 0.38f, 0.28f, 0.92f, 0f, 3.61f);

            GlassAccumulator thermalMesh = new GlassAccumulator();
            AddNetwork(thermalMesh, 2.30f, 0.064f);
            thermalMesh.AddEllipticalBand(new Vector2(313f, 210f),
                new Vector2(10.5f, 7.5f), 2.8f, 0.064f, 0.73f, 72);
            thermalMesh.AddEllipticalBand(new Vector2(350f, 194f),
                new Vector2(8.5f, 6.2f), 2.4f, 0.064f, 1.81f, 72);
            thermalMesh.AddEllipticalBand(new Vector2(289f, 166f),
                new Vector2(9.2f, 6.8f), 2.5f, 0.064f, 2.77f, 72);

            GlassAccumulator fusedMesh = new GlassAccumulator();
            AddNetwork(fusedMesh, 0.90f, 0.076f);
            fusedMesh.AddEllipticalBand(new Vector2(313f, 210f),
                new Vector2(8.4f, 5.8f), 1.4f, 0.077f, 1.17f, 72);
            fusedMesh.AddEllipticalBand(new Vector2(350f, 194f),
                new Vector2(6.7f, 4.7f), 1.3f, 0.077f, 2.19f, 72);
            fusedMesh.AddEllipticalBand(new Vector2(289f, 166f),
                new Vector2(7.2f, 5.2f), 1.3f, 0.077f, 3.09f, 72);

            CreateSurface("GlassThermalScars_SURFACE_MEP", root,
                PersistMesh(ScorchMeshPath,
                    thermalMesh.Build("Kromka_GlobalGlass_ThermalScars")), scorch);
            CreateSurface("GlassFusedSeams_SURFACE_MEP", root,
                PersistMesh(FusedMeshPath,
                    fusedMesh.Build("Kromka_GlobalGlass_FusedSeams")), fused);
            Child(root, "GlassFractureNetwork_6_REFERENCE");
            Child(root, "GlassImpactBasins_3_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 12")]
        public static void ValidateIteration12()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka fused-glass shader is missing or invalid.");
            Texture2D mineral = ValidateSource(MineralTexturePath,
                "fused mineral glass");
            Texture2D stone = ValidateSource(StoneTexturePath,
                "thermally scarred stone");
            ValidateMaterial(FusedMaterialPath, shader, mineral, stone,
                0.86f, 0.96f, 0.02f, 0.10f, 0.34f, 0.44f);
            ValidateMaterial(ScorchMaterialPath, shader, mineral, stone,
                0.38f, 0.50f, 0.86f, 0.98f, 0f, 0.02f);
            ValidateSurface("GlassThermalScars_SURFACE_MEP",
                ScorchMeshPath, ScorchMaterialPath, 700);
            ValidateSurface("GlassFusedSeams_SURFACE_MEP",
                FusedMeshPath, FusedMaterialPath, 700);
            Require(GameObject.Find("GlassFractureNetwork_6_REFERENCE") != null
                && GameObject.Find("GlassImpactBasins_3_REFERENCE") != null,
                "Glasslands fracture geography reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 60%] PASS: two direct high-resolution MEP "
                + "mineral sources form six paired fused-glass fractures, broad "
                + "thermal shadows and three impact-basin halos on the eastern plateau.");
        }

        private static void AddNetwork(GlassAccumulator mesh, float halfWidthKm,
                                       float lift)
        {
            mesh.AddRibbon(GlassFractureNorth, halfWidthKm, lift, 9, 0.41f);
            mesh.AddRibbon(GlassFractureSouth, halfWidthKm * 0.93f,
                lift, 9, 1.07f);
            mesh.AddRibbon(GlassFaultCentral, halfWidthKm * 1.08f,
                lift, 8, 1.73f);
            mesh.AddRibbon(GlassFaultEast, halfWidthKm,
                lift, 8, 2.39f);
            mesh.AddRibbon(GlassSplinterNorth, halfWidthKm * 0.72f,
                lift, 8, 3.11f);
            mesh.AddRibbon(GlassSplinterEast, halfWidthKm * 0.68f,
                lift, 8, 3.83f);
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float crystalline, float scorch,
                                              float emission, float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D mineral = AssetDatabase.LoadAssetAtPath<Texture2D>(
                MineralTexturePath);
            Texture2D stone = AssetDatabase.LoadAssetAtPath<Texture2D>(
                StoneTexturePath);
            if (shader == null || mineral == null || stone == null)
                throw new InvalidOperationException(
                    "Fused-glass shader or direct MEP texture is missing.");
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
            material.SetTexture("_MainTex", mineral);
            material.SetTexture("_SecondaryTex", stone);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Crystalline", crystalline);
            material.SetFloat("_Scorch", scorch);
            material.SetFloat("_EmissionStrength", emission);
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
                                             Texture2D mineral, Texture2D stone,
                                             float minOpacity, float maxOpacity,
                                             float minScorch, float maxScorch,
                                             float minEmission, float maxEmission)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == mineral
                && material.GetTexture("_SecondaryTex") == stone,
                path + " does not directly use both selected MEP sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored Glasslands range.");
            Require(material.GetFloat("_Scorch") >= minScorch
                && material.GetFloat("_Scorch") <= maxScorch,
                path + " thermal scorch is outside its authored range.");
            Require(material.GetFloat("_EmissionStrength") >= minEmission
                && material.GetFloat("_EmissionStrength") <= maxEmission,
                path + " cold emission is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 6f,
                path + " lacks separate shard and plateau texture scales.");
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

        private sealed class GlassAccumulator
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
                        * (1f + Mathf.Sin(i * 0.81f + seed) * 0.10f);
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float signed = band == 0 ? 1f : band == 1 ? 0f : -1f;
                        Vector2 sample = point + side * width * signed;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y);
                        float landVisibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.72f, -0.30f, terrainHeight));
                        vertices.Add(World(sample.x, sample.y,
                            terrainHeight + lift + (band == 1 ? 0.002f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            accumulated * 0.15f + seed));
                        colors.Add(new Color(1f, 1f, 1f, landVisibility));
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
                    float wobble = 1f + Mathf.Sin(angle * 3f + seed) * 0.075f
                        + Mathf.Sin(angle * 7f - seed * 0.5f) * 0.035f;
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
