using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 16/20: the inhabited Middle Vein receives three silted
    /// flood channels, eight irregular field plots and five worn settlement
    /// aprons, all below the canonical road and water surfaces.
    /// </summary>
    internal static class KromkaGlobalMapFloodplainAuthoring
    {
        internal const int TextureIteration = 16;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalFloodplain.shader";
        private const string GrassTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Grass_01_N_Dif.tga";
        private const string GroundTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Ground_01_N_Dif.tga";
        private const string SiltMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalMiddle_FloodSilt_MEP.mat";
        private const string FieldMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalMiddle_FieldMosaic_MEP.mat";
        private const string TrampledMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalMiddle_TrampledGround_MEP.mat";
        private const string SiltMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalMiddle_FloodSilt.asset";
        private const string FieldMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalMiddle_FieldMosaic.asset";
        private const string TrampledMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalMiddle_TrampledGround.asset";

        private static readonly Vector2[] MiddleCanalWest =
        {
            new Vector2(187f, 227f), new Vector2(174f, 212f),
            new Vector2(161f, 198f), new Vector2(154f, 182f),
            new Vector2(158f, 166f), new Vector2(174f, 151f)
        };

        private static readonly Vector2[] MiddleCanalEast =
        {
            new Vector2(214f, 226f), new Vector2(222f, 210f),
            new Vector2(232f, 194f), new Vector2(235f, 178f),
            new Vector2(230f, 162f), new Vector2(216f, 148f)
        };

        private static readonly Vector2[] CentralOxbowWest =
        {
            new Vector2(197f, 151f), new Vector2(181f, 145f),
            new Vector2(166f, 135f), new Vector2(163f, 122f),
            new Vector2(173f, 111f), new Vector2(190f, 107f),
            new Vector2(202f, 113f)
        };

        private static readonly Vector2[] FarmToKeys =
        {
            new Vector2(151f, 190f), new Vector2(163f, 194f),
            new Vector2(180f, 199f), new Vector2(195f, 205f)
        };

        private static readonly Vector2[] KeysToFilter =
        {
            new Vector2(195f, 205f), new Vector2(208f, 199f),
            new Vector2(222f, 191f), new Vector2(235f, 184f)
        };

        private static readonly Vector2[] FieldCentres =
        {
            new Vector2(139f, 185f), new Vector2(153f, 177f),
            new Vector2(164f, 205f), new Vector2(176f, 217f),
            new Vector2(215f, 215f), new Vector2(228f, 198f),
            new Vector2(222f, 172f), new Vector2(181f, 181f)
        };

        private static readonly Vector2[] FieldRadii =
        {
            new Vector2(13f, 6.5f), new Vector2(10f, 5.2f),
            new Vector2(11.5f, 5.5f), new Vector2(9f, 4.3f),
            new Vector2(11f, 5.4f), new Vector2(9.5f, 4.8f),
            new Vector2(10.5f, 5.1f), new Vector2(8f, 4.2f)
        };

        private static readonly Vector2[] ApronCentres =
        {
            new Vector2(195f, 205f), new Vector2(166f, 224f),
            new Vector2(226f, 229f), new Vector2(151f, 190f),
            new Vector2(235f, 184f)
        };

        private static readonly Vector2[] ApronRadii =
        {
            new Vector2(8.5f, 5.3f), new Vector2(6.0f, 4.0f),
            new Vector2(6.8f, 4.2f), new Vector2(7.5f, 4.5f),
            new Vector2(7.0f, 4.3f)
        };

        internal static void Compose(Transform root)
        {
            Material silt = BuildMaterial(SiltMaterialPath,
                new Color(0.43f, 0.47f, 0.23f, 1f),
                new Color(0.105f, 0.14f, 0.075f, 1f),
                3.5f, 0.43f, 0.56f, 0.34f,
                0.75f, 0.92f, 0.15f, 0.72f, 0.47f);
            Material field = BuildMaterial(FieldMaterialPath,
                new Color(0.55f, 0.50f, 0.23f, 1f),
                new Color(0.18f, 0.15f, 0.075f, 1f),
                3.3f, 0.40f, 0.54f, 0.46f,
                0.92f, 0.46f, 0.38f, 0.30f, 1.93f);
            Material trampled = BuildMaterial(TrampledMaterialPath,
                new Color(0.43f, 0.33f, 0.18f, 1f),
                new Color(0.13f, 0.085f, 0.045f, 1f),
                3.8f, 0.46f, 0.62f, 0.32f,
                0.18f, 0.35f, 0.95f, 0.20f, 3.29f);

            FloodAccumulator siltMesh = new FloodAccumulator();
            siltMesh.AddRibbon(MiddleCanalWest, 3.8f, 0.022f, 7, 0.41f);
            siltMesh.AddRibbon(MiddleCanalEast, 3.6f, 0.022f, 7, 1.19f);
            siltMesh.AddRibbon(CentralOxbowWest, 3.2f, 0.022f, 7, 2.03f);

            FloodAccumulator fieldMesh = new FloodAccumulator();
            for (int i = 0; i < FieldCentres.Length; i++)
                fieldMesh.AddEllipticalPatch(FieldCentres[i], FieldRadii[i],
                    0.024f, 0.31f + i * 0.73f, 56);

            FloodAccumulator trampledMesh = new FloodAccumulator();
            for (int i = 0; i < ApronCentres.Length; i++)
                trampledMesh.AddEllipticalPatch(ApronCentres[i], ApronRadii[i],
                    0.029f, 0.57f + i * 0.83f, 48);
            trampledMesh.AddRibbon(FarmToKeys, 0.95f, 0.031f, 8, 1.37f);
            trampledMesh.AddRibbon(KeysToFilter, 0.90f, 0.031f, 8, 2.61f);

            CreateSurface("MiddleFloodSilt_SURFACE_MEP", root,
                PersistMesh(SiltMeshPath,
                    siltMesh.Build("Kromka_GlobalMiddle_FloodSilt")), silt);
            CreateSurface("MiddleFieldMosaic_SURFACE_MEP", root,
                PersistMesh(FieldMeshPath,
                    fieldMesh.Build("Kromka_GlobalMiddle_FieldMosaic")), field);
            CreateSurface("MiddleTrampledGround_SURFACE_MEP", root,
                PersistMesh(TrampledMeshPath,
                    trampledMesh.Build("Kromka_GlobalMiddle_TrampledGround")), trampled);
            Child(root, "MiddleFloodSilt_3_REFERENCE");
            Child(root, "MiddleFieldPlots_8_REFERENCE");
            Child(root, "MiddleInhabitedAprons_5_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 16")]
        public static void ValidateIteration16()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka floodplain shader is missing or invalid.");
            Texture2D grass = ValidateSource(GrassTexturePath,
                "Middle Vein floodplain vegetation");
            Texture2D ground = ValidateSource(GroundTexturePath,
                "Middle Vein silt ground");
            ValidateMaterial(SiltMaterialPath, shader, grass, ground,
                0.50f, 0.62f, 0.68f, 0.82f, 0.08f, 0.22f);
            ValidateMaterial(FieldMaterialPath, shader, grass, ground,
                0.48f, 0.60f, 0.86f, 0.98f, 0.30f, 0.46f);
            ValidateMaterial(TrampledMaterialPath, shader, grass, ground,
                0.56f, 0.68f, 0.10f, 0.26f, 0.88f, 1f);
            ValidateSurface("MiddleFloodSilt_SURFACE_MEP",
                SiltMeshPath, SiltMaterialPath, 330);
            ValidateSurface("MiddleFieldMosaic_SURFACE_MEP",
                FieldMeshPath, FieldMaterialPath, 450);
            ValidateSurface("MiddleTrampledGround_SURFACE_MEP",
                TrampledMeshPath, TrampledMaterialPath, 350);
            Require(GameObject.Find("MiddleFloodSilt_3_REFERENCE") != null
                && GameObject.Find("MiddleFieldPlots_8_REFERENCE") != null
                && GameObject.Find("MiddleInhabitedAprons_5_REFERENCE") != null,
                "Middle Vein floodplain reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 80%] PASS: two direct high-resolution MEP "
                + "ground sources form three silt channels, eight irregular field "
                + "plots and five inhabited aprons across the Middle Vein.");
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float fertility, float silt,
                                              float trample, float wetness,
                                              float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D grass = AssetDatabase.LoadAssetAtPath<Texture2D>(
                GrassTexturePath);
            Texture2D ground = AssetDatabase.LoadAssetAtPath<Texture2D>(
                GroundTexturePath);
            if (shader == null || grass == null || ground == null)
                throw new InvalidOperationException(
                    "Floodplain shader or direct MEP texture is missing.");
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
            material.SetTexture("_MainTex", grass);
            material.SetTexture("_SecondaryTex", ground);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Fertility", fertility);
            material.SetFloat("_Silt", silt);
            material.SetFloat("_Trample", trample);
            material.SetFloat("_Wetness", wetness);
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
                                             Texture2D grass, Texture2D ground,
                                             float minOpacity, float maxOpacity,
                                             float minFertility, float maxFertility,
                                             float minTrample, float maxTrample)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == grass
                && material.GetTexture("_SecondaryTex") == ground,
                path + " does not directly use both selected MEP sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored floodplain range.");
            Require(material.GetFloat("_Fertility") >= minFertility
                && material.GetFloat("_Fertility") <= maxFertility,
                path + " fertility is outside its authored range.");
            Require(material.GetFloat("_Trample") >= minTrample
                && material.GetFloat("_Trample") <= maxTrample,
                path + " human wear is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 6f,
                path + " lacks separate ground detail and floodplain scales.");
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

        private sealed class FloodAccumulator
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
                        * (1f + Mathf.Sin(i * 0.81f + seed) * 0.095f);
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

            internal void AddEllipticalPatch(Vector2 centre, Vector2 radiusKm,
                                             float lift, float seed, int segments)
            {
                int centreIndex = vertices.Count;
                float centreHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    centre.x, centre.y);
                vertices.Add(World(centre.x, centre.y, centreHeight + lift));
                normals.Add(Vector3.up);
                uv.Add(new Vector2(1f, seed));
                colors.Add(Color.white);
                int previous = -1;
                for (int i = 0; i <= segments; i++)
                {
                    float progress = i / (float)segments;
                    float angle = progress * Mathf.PI * 2f;
                    float wobble = 1f + Mathf.Sin(angle * 3f + seed) * 0.085f
                        + Mathf.Sin(angle * 7f - seed * 0.6f) * 0.040f;
                    float x = centre.x + Mathf.Cos(angle) * radiusKm.x * wobble;
                    float y = centre.y + Mathf.Sin(angle) * radiusKm.y * wobble;
                    float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
                    int current = vertices.Count;
                    vertices.Add(World(x, y, terrainHeight + lift));
                    normals.Add(Vector3.up);
                    uv.Add(new Vector2(0f, progress * 5f + seed));
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
