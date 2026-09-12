using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 13/20: pale mineral bloom follows three Chalk Lowland
    /// ridge crowns, four relief gullies receive darker karst wash, and six sink
    /// rims collect irregular chalk flour from the direct MEP terrain sources.
    /// </summary>
    internal static class KromkaGlobalMapChalkKarstAuthoring
    {
        internal const int TextureIteration = 13;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalChalkKarst.shader";
        private const string ChalkTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_05.png";
        private const string LimestoneTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Edge_01/Textures/MEP_SandStone_Terrain.tga";
        private const string RidgeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalChalk_RidgeBloom_MEP.mat";
        private const string RunoffMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalChalk_KarstRunoff_MEP.mat";
        private const string SinkMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalChalk_SinkFlour_MEP.mat";
        private const string RidgeMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalChalk_RidgeBloom.asset";
        private const string RunoffMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalChalk_KarstRunoff.asset";
        private const string SinkMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalChalk_SinkFlour.asset";

        private static readonly Vector2[] ChalkRidgeWest =
        {
            new Vector2(247f, 132f), new Vector2(269f, 121f),
            new Vector2(292f, 111f), new Vector2(316f, 104f),
            new Vector2(339f, 101f)
        };

        private static readonly Vector2[] ChalkRidgeCentre =
        {
            new Vector2(260f, 105f), new Vector2(283f, 94f),
            new Vector2(307f, 84f), new Vector2(333f, 79f),
            new Vector2(350f, 82f)
        };

        private static readonly Vector2[] ChalkRidgeSouth =
        {
            new Vector2(250f, 76f), new Vector2(276f, 63f),
            new Vector2(304f, 55f), new Vector2(333f, 56f),
            new Vector2(350f, 67f)
        };

        private static readonly Vector2[] ChalkGullyNorth =
        {
            new Vector2(358f, 118f), new Vector2(344f, 111f),
            new Vector2(322f, 103f), new Vector2(300f, 94f),
            new Vector2(278f, 88f), new Vector2(254f, 91f)
        };

        private static readonly Vector2[] ChalkGullySouth =
        {
            new Vector2(343f, 74f), new Vector2(329f, 68f),
            new Vector2(307f, 72f), new Vector2(286f, 80f),
            new Vector2(267f, 88f)
        };

        private static readonly Vector2[] ChalkRunnelNorth =
        {
            new Vector2(282f, 128f), new Vector2(300f, 115f),
            new Vector2(318f, 103f)
        };

        private static readonly Vector2[] ChalkRunnelSouth =
        {
            new Vector2(310f, 86f), new Vector2(327f, 78f),
            new Vector2(344f, 70f)
        };

        private static readonly Vector2[] KarstCentres =
        {
            new Vector2(276f, 108f), new Vector2(307f, 98f),
            new Vector2(337f, 87f), new Vector2(292f, 68f),
            new Vector2(326f, 58f), new Vector2(334f, 70f)
        };

        private static readonly Vector2[] KarstRadii =
        {
            new Vector2(6.2f, 3.9f), new Vector2(4.9f, 3.3f),
            new Vector2(6.6f, 4.1f), new Vector2(4.7f, 3.1f),
            new Vector2(5.9f, 3.7f), new Vector2(4.5f, 2.9f)
        };

        internal static void Compose(Transform root)
        {
            Material ridge = BuildMaterial(RidgeMaterialPath,
                new Color(0.94f, 0.88f, 0.69f, 1f),
                new Color(0.28f, 0.23f, 0.15f, 1f),
                3.5f, 0.42f, 0.52f, 0.36f, 0.92f, 0.22f, 0.86f, 0.59f);
            Material runoff = BuildMaterial(RunoffMaterialPath,
                new Color(0.56f, 0.52f, 0.41f, 1f),
                new Color(0.13f, 0.11f, 0.085f, 1f),
                3.2f, 0.40f, 0.58f, 0.31f, 0.28f, 0.92f, 0.42f, 2.17f);
            Material sink = BuildMaterial(SinkMaterialPath,
                new Color(1.04f, 0.98f, 0.78f, 1f),
                new Color(0.36f, 0.31f, 0.21f, 1f),
                3.8f, 0.44f, 0.68f, 0.22f, 0.96f, 0.32f, 0.94f, 3.71f);

            ChalkAccumulator ridgeMesh = new ChalkAccumulator();
            ridgeMesh.AddRibbon(ChalkRidgeWest, 2.2f, 0.066f, 7, 0.43f);
            ridgeMesh.AddRibbon(ChalkRidgeCentre, 2.0f, 0.066f, 7, 1.19f);
            ridgeMesh.AddRibbon(ChalkRidgeSouth, 1.9f, 0.066f, 7, 2.03f);

            ChalkAccumulator runoffMesh = new ChalkAccumulator();
            runoffMesh.AddRibbon(ChalkGullyNorth, 1.45f, 0.069f, 7, 0.83f);
            runoffMesh.AddRibbon(ChalkGullySouth, 1.30f, 0.069f, 7, 1.67f);
            runoffMesh.AddRibbon(ChalkRunnelNorth, 0.78f, 0.071f, 8, 2.51f);
            runoffMesh.AddRibbon(ChalkRunnelSouth, 0.72f, 0.071f, 8, 3.29f);

            ChalkAccumulator sinkMesh = new ChalkAccumulator();
            for (int i = 0; i < KarstCentres.Length; i++)
                sinkMesh.AddEllipticalBand(KarstCentres[i], KarstRadii[i],
                    1.45f, 0.074f, 0.37f + i * 0.71f, 72);

            CreateSurface("ChalkRidgeBloom_SURFACE_MEP", root,
                PersistMesh(RidgeMeshPath,
                    ridgeMesh.Build("Kromka_GlobalChalk_RidgeBloom")), ridge);
            CreateSurface("ChalkKarstRunoff_SURFACE_MEP", root,
                PersistMesh(RunoffMeshPath,
                    runoffMesh.Build("Kromka_GlobalChalk_KarstRunoff")), runoff);
            CreateSurface("ChalkSinkFlour_SURFACE_MEP", root,
                PersistMesh(SinkMeshPath,
                    sinkMesh.Build("Kromka_GlobalChalk_SinkFlour")), sink);
            Child(root, "ChalkMineralRidges_3_REFERENCE");
            Child(root, "ChalkKarstDrainage_4_REFERENCE");
            Child(root, "ChalkSinkFlour_6_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 13")]
        public static void ValidateIteration13()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka chalk-karst shader is missing or invalid.");
            Texture2D chalk = ValidateSource(ChalkTexturePath, "chalk flour");
            Texture2D limestone = ValidateSource(LimestoneTexturePath,
                "karst limestone");
            ValidateMaterial(RidgeMaterialPath, shader, chalk, limestone,
                0.46f, 0.58f, 0.84f, 0.98f, 0.14f, 0.30f);
            ValidateMaterial(RunoffMaterialPath, shader, chalk, limestone,
                0.52f, 0.64f, 0.18f, 0.38f, 0.84f, 0.98f);
            ValidateMaterial(SinkMaterialPath, shader, chalk, limestone,
                0.62f, 0.74f, 0.90f, 1.0f, 0.24f, 0.40f);
            ValidateSurface("ChalkRidgeBloom_SURFACE_MEP",
                RidgeMeshPath, RidgeMaterialPath, 220);
            ValidateSurface("ChalkKarstRunoff_SURFACE_MEP",
                RunoffMeshPath, RunoffMaterialPath, 290);
            ValidateSurface("ChalkSinkFlour_SURFACE_MEP",
                SinkMeshPath, SinkMaterialPath, 1200);
            Require(GameObject.Find("ChalkMineralRidges_3_REFERENCE") != null
                && GameObject.Find("ChalkKarstDrainage_4_REFERENCE") != null
                && GameObject.Find("ChalkSinkFlour_6_REFERENCE") != null,
                "Chalk Lowland texture geography reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 65%] PASS: two direct high-resolution MEP "
                + "mineral sources form three chalk-bloom ridges, four karst "
                + "drainage scars and six irregular sink-flour deposits.");
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float mineral, float erosion,
                                              float dust, float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D chalk = AssetDatabase.LoadAssetAtPath<Texture2D>(
                ChalkTexturePath);
            Texture2D limestone = AssetDatabase.LoadAssetAtPath<Texture2D>(
                LimestoneTexturePath);
            if (shader == null || chalk == null || limestone == null)
                throw new InvalidOperationException(
                    "Chalk-karst shader or direct MEP texture is missing.");
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
            material.SetTexture("_MainTex", chalk);
            material.SetTexture("_SecondaryTex", limestone);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_MineralStrength", mineral);
            material.SetFloat("_Erosion", erosion);
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
                                             Texture2D chalk,
                                             Texture2D limestone,
                                             float minOpacity, float maxOpacity,
                                             float minMineral, float maxMineral,
                                             float minErosion, float maxErosion)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == chalk
                && material.GetTexture("_SecondaryTex") == limestone,
                path + " does not directly use both selected MEP sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored chalk range.");
            Require(material.GetFloat("_MineralStrength") >= minMineral
                && material.GetFloat("_MineralStrength") <= maxMineral,
                path + " mineral bloom is outside its authored range.");
            Require(material.GetFloat("_Erosion") >= minErosion
                && material.GetFloat("_Erosion") <= maxErosion,
                path + " karst erosion is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 6f,
                path + " lacks separate chalk grain and lowland scales.");
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
            existing.Clear();
            existing.indexFormat = generated.indexFormat;
            existing.vertices = generated.vertices;
            existing.normals = generated.normals;
            existing.tangents = generated.tangents;
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

        private sealed class ChalkAccumulator
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
                        * (1f + Mathf.Sin(i * 0.79f + seed) * 0.085f);
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float signed = band == 0 ? 1f : band == 1 ? 0f : -1f;
                        Vector2 sample = point + side * width * signed;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y);
                        float visibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.72f, -0.30f, terrainHeight));
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
                    float wobble = 1f + Mathf.Sin(angle * 4f + seed) * 0.065f
                        + Mathf.Sin(angle * 9f - seed * 0.7f) * 0.025f;
                    int index = vertices.Count;
                    for (int band = 0; band < 3; band++)
                    {
                        float offset = band == 0 ? widthKm * 0.5f
                            : band == 1 ? 0f : -widthKm * 0.5f;
                        float x = centre.x + Mathf.Cos(angle)
                            * (radiusKm.x * wobble + offset);
                        float y = centre.y + Mathf.Sin(angle)
                            * (radiusKm.y * wobble + offset * 0.70f);
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
                        vertices.Add(World(x, y,
                            terrainHeight + lift + (band == 1 ? 0.002f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(band == 1 ? 1f : 0f,
                            progress * 4.5f + seed));
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
