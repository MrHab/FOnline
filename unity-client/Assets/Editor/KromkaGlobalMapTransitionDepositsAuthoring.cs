using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 19/20: transition deposits follow the same aprons and
    /// broken fronts already authored in the relief. Four MEP mixtures carry
    /// sluice wash, ore colluvium, glass scree and chalk flour across borders.
    /// </summary>
    internal static class KromkaGlobalMapTransitionDepositsAuthoring
    {
        internal const int TextureIteration = 19;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalTransitionDeposits.shader";
        private const string SoilTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Ground_01_N_Dif.tga";
        private const string StoneTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Textures/MEP_StoneGround_Dif.png";
        private const string MineralTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_05.png";

        private const string SluiceMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTransition_SluiceWash_MEP.mat";
        private const string OreMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTransition_OreColluvium_MEP.mat";
        private const string GlassMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTransition_GlassScree_MEP.mat";
        private const string ChalkMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalTransition_ChalkFlour_MEP.mat";

        private const string SluiceMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTransition_SluiceWash.asset";
        private const string OreMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTransition_OreColluvium.asset";
        private const string GlassMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTransition_GlassScree.asset";
        private const string ChalkMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalTransition_ChalkFlour.asset";

        private static readonly Vector2[] SluiceMiddleApronWest =
        {
            new Vector2(142f, 242f), new Vector2(150f, 232f),
            new Vector2(160f, 222f), new Vector2(170f, 214f)
        };

        private static readonly Vector2[] SluiceMiddleApronEast =
        {
            new Vector2(250f, 243f), new Vector2(244f, 233f),
            new Vector2(238f, 223f), new Vector2(229f, 214f)
        };

        private static readonly Vector2[] OreMiddleApronNorth =
        {
            new Vector2(126f, 229f), new Vector2(145f, 220f),
            new Vector2(164f, 210f), new Vector2(184f, 201f)
        };

        private static readonly Vector2[] OreMiddleApronSouth =
        {
            new Vector2(111f, 177f), new Vector2(133f, 176f),
            new Vector2(155f, 181f), new Vector2(176f, 190f)
        };

        private static readonly Vector2[][] GlassMiddleFronts =
        {
            new[] { new Vector2(244f, 235f), new Vector2(250f, 217f),
                new Vector2(247f, 198f) },
            new[] { new Vector2(247f, 198f), new Vector2(253f, 180f),
                new Vector2(246f, 163f) },
            new[] { new Vector2(246f, 163f), new Vector2(248f, 145f),
                new Vector2(244f, 127f) }
        };

        private static readonly Vector2[] GlassSaddleCentres =
        {
            new Vector2(250f, 217f), new Vector2(255f, 196f),
            new Vector2(247f, 165f)
        };

        private static readonly Vector2[] ChalkZeroBrokenApron =
        {
            new Vector2(244f, 126f), new Vector2(249f, 109f),
            new Vector2(249f, 92f), new Vector2(258f, 78f),
            new Vector2(271f, 66f)
        };

        private static readonly Vector2[] ChalkFanCentres =
        {
            new Vector2(249f, 109f), new Vector2(249f, 92f),
            new Vector2(258f, 78f), new Vector2(271f, 66f)
        };

        internal static void Compose(Transform root)
        {
            Material sluice = BuildMaterial(SluiceMaterialPath,
                new Color(0.40f, 0.42f, 0.31f, 1f),
                new Color(0.095f, 0.105f, 0.075f, 1f),
                4.2f, 0.43f, 0.46f, 0.35f,
                0.05f, 0.91f, 0.05f, 0.16f, 0.47f);
            Material ore = BuildMaterial(OreMaterialPath,
                new Color(0.47f, 0.245f, 0.105f, 1f),
                new Color(0.115f, 0.050f, 0.025f, 1f),
                4.5f, 0.45f, 0.54f, 0.31f,
                0.94f, 0.18f, 0.08f, 0.05f, 1.73f);
            Material glass = BuildMaterial(GlassMaterialPath,
                new Color(0.205f, 0.39f, 0.38f, 1f),
                new Color(0.045f, 0.085f, 0.082f, 1f),
                4.8f, 0.47f, 0.49f, 0.28f,
                0.07f, 0.13f, 0.95f, 0.10f, 2.91f);
            Material chalk = BuildMaterial(ChalkMaterialPath,
                new Color(0.61f, 0.57f, 0.46f, 1f),
                new Color(0.145f, 0.125f, 0.092f, 1f),
                5.0f, 0.51f, 0.52f, 0.27f,
                0.04f, 0.28f, 0.07f, 0.96f, 4.13f);

            DepositAccumulator sluiceMesh = new DepositAccumulator();
            sluiceMesh.AddTaperedRibbon(SluiceMiddleApronWest,
                6.2f, 3.1f, 0.020f, 12, 0.43f);
            sluiceMesh.AddTaperedRibbon(SluiceMiddleApronEast,
                6.0f, 3.0f, 0.020f, 12, 1.31f);
            sluiceMesh.AddPatch(new Vector2(170f, 214f), new Vector2(8.2f, 4.6f),
                -22f, 0.021f, 48, 2.07f);
            sluiceMesh.AddPatch(new Vector2(229f, 214f), new Vector2(8.0f, 4.5f),
                19f, 0.021f, 48, 2.81f);

            DepositAccumulator oreMesh = new DepositAccumulator();
            oreMesh.AddTaperedRibbon(OreMiddleApronNorth,
                7.2f, 3.4f, 0.021f, 12, 0.71f);
            oreMesh.AddTaperedRibbon(OreMiddleApronSouth,
                7.6f, 3.5f, 0.021f, 12, 1.67f);
            oreMesh.AddPatch(new Vector2(184f, 201f), new Vector2(9.4f, 5.2f),
                -18f, 0.022f, 48, 2.53f);
            oreMesh.AddPatch(new Vector2(176f, 190f), new Vector2(9.0f, 5.0f),
                16f, 0.022f, 48, 3.29f);

            DepositAccumulator glassMesh = new DepositAccumulator();
            for (int i = 0; i < GlassMiddleFronts.Length; i++)
                glassMesh.AddTaperedRibbon(GlassMiddleFronts[i],
                    5.8f, 4.0f, 0.022f, 11, 0.59f + i * 0.83f);
            for (int i = 0; i < GlassSaddleCentres.Length; i++)
                glassMesh.AddPatch(GlassSaddleCentres[i], new Vector2(7.0f, 4.3f),
                    -18f + i * 17f, 0.024f, 48, 2.17f + i * 0.71f);

            DepositAccumulator chalkMesh = new DepositAccumulator();
            chalkMesh.AddTaperedRibbon(ChalkZeroBrokenApron,
                6.7f, 3.0f, 0.022f, 12, 0.81f);
            for (int i = 0; i < ChalkFanCentres.Length; i++)
                chalkMesh.AddPatch(ChalkFanCentres[i],
                    new Vector2(7.6f - i * 0.45f, 4.5f - i * 0.25f),
                    -11f + i * 14f, 0.024f, 48, 1.79f + i * 0.73f);

            CreateSurface("TransitionSluiceWash_SURFACE_MEP", root,
                PersistMesh(SluiceMeshPath,
                    sluiceMesh.Build("Kromka_GlobalTransition_SluiceWash")), sluice);
            CreateSurface("TransitionOreColluvium_SURFACE_MEP", root,
                PersistMesh(OreMeshPath,
                    oreMesh.Build("Kromka_GlobalTransition_OreColluvium")), ore);
            CreateSurface("TransitionGlassScree_SURFACE_MEP", root,
                PersistMesh(GlassMeshPath,
                    glassMesh.Build("Kromka_GlobalTransition_GlassScree")), glass);
            CreateSurface("TransitionChalkFlour_SURFACE_MEP", root,
                PersistMesh(ChalkMeshPath,
                    chalkMesh.Build("Kromka_GlobalTransition_ChalkFlour")), chalk);
            Child(root, "TransitionSluiceAprons_2_REFERENCE");
            Child(root, "TransitionOreTongues_2_REFERENCE");
            Child(root, "TransitionGlassFronts_3_REFERENCE");
            Child(root, "TransitionChalkApron_1_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 19")]
        public static void ValidateIteration19()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka transition-deposit shader is missing or invalid.");
            Texture2D soil = ValidateSource(SoilTexturePath, "transition soil");
            Texture2D stone = ValidateSource(StoneTexturePath, "transition stone");
            Texture2D mineral = ValidateSource(MineralTexturePath,
                "transition mineral dust");
            ValidateMaterial(SluiceMaterialPath, shader, soil, stone, mineral,
                0.40f, 0.52f, "_WetWash", 0.86f);
            ValidateMaterial(OreMaterialPath, shader, soil, stone, mineral,
                0.48f, 0.60f, "_Oxide", 0.90f);
            ValidateMaterial(GlassMaterialPath, shader, soil, stone, mineral,
                0.43f, 0.55f, "_GlassDust", 0.90f);
            ValidateMaterial(ChalkMaterialPath, shader, soil, stone, mineral,
                0.46f, 0.58f, "_ChalkDust", 0.90f);
            ValidateSurface("TransitionSluiceWash_SURFACE_MEP",
                SluiceMeshPath, SluiceMaterialPath, 450);
            ValidateSurface("TransitionOreColluvium_SURFACE_MEP",
                OreMeshPath, OreMaterialPath, 450);
            ValidateSurface("TransitionGlassScree_SURFACE_MEP",
                GlassMeshPath, GlassMaterialPath, 450);
            ValidateSurface("TransitionChalkFlour_SURFACE_MEP",
                ChalkMeshPath, ChalkMaterialPath, 430);
            Require(GameObject.Find("TransitionSluiceAprons_2_REFERENCE") != null
                && GameObject.Find("TransitionOreTongues_2_REFERENCE") != null
                && GameObject.Find("TransitionGlassFronts_3_REFERENCE") != null
                && GameObject.Find("TransitionChalkApron_1_REFERENCE") != null,
                "Regional transition reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 95%] PASS: three direct high-resolution MEP "
                + "sources form two sluice aprons, two ore tongues, three broken "
                + "Glassland fronts and one chalk-to-Zero apron on the relief seams.");
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float oxide, float wetWash,
                                              float glassDust, float chalkDust,
                                              float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D soil = AssetDatabase.LoadAssetAtPath<Texture2D>(SoilTexturePath);
            Texture2D stone = AssetDatabase.LoadAssetAtPath<Texture2D>(StoneTexturePath);
            Texture2D mineral = AssetDatabase.LoadAssetAtPath<Texture2D>(MineralTexturePath);
            if (shader == null || soil == null || stone == null || mineral == null)
                throw new InvalidOperationException(
                    "Transition shader or direct MEP texture is missing.");
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
            material.SetTexture("_MainTex", soil);
            material.SetTexture("_SecondaryTex", stone);
            material.SetTexture("_MineralTex", mineral);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Oxide", oxide);
            material.SetFloat("_WetWash", wetWash);
            material.SetFloat("_GlassDust", glassDust);
            material.SetFloat("_ChalkDust", chalkDust);
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
                                             Texture2D soil, Texture2D stone,
                                             Texture2D mineral,
                                             float minOpacity, float maxOpacity,
                                             string dominantProperty,
                                             float minimumDominance)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == soil
                && material.GetTexture("_SecondaryTex") == stone
                && material.GetTexture("_MineralTex") == mineral,
                path + " does not directly use all selected MEP transition sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored transition range.");
            Require(material.GetFloat(dominantProperty) >= minimumDominance,
                path + " lacks its intended dominant deposit process.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 9f,
                path + " lacks separate grain and landscape scales.");
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

            internal void AddTaperedRibbon(Vector2[] controlPoints,
                                           float startHalfWidthKm,
                                           float endHalfWidthKm,
                                           float lift, int subdivisions,
                                           float seed)
            {
                List<Vector2> smooth = Smooth(controlPoints, subdivisions);
                float accumulated = 0f;
                for (int i = 0; i < smooth.Count; i++)
                {
                    Vector2 point = smooth[i];
                    if (i > 0) accumulated += Vector2.Distance(smooth[i - 1], point);
                    float progress = i / (float)Mathf.Max(1, smooth.Count - 1);
                    Vector2 previous = smooth[Mathf.Max(0, i - 1)];
                    Vector2 next = smooth[Mathf.Min(smooth.Count - 1, i + 1)];
                    Vector2 tangent = (next - previous).normalized;
                    Vector2 side = new Vector2(-tangent.y, tangent.x);
                    float width = Mathf.Lerp(startHalfWidthKm, endHalfWidthKm, progress)
                        * (1f + Mathf.Sin(i * 0.73f + seed) * 0.085f);
                    int row = vertices.Count;
                    for (int band = 0; band < 5; band++)
                    {
                        float signed = -1f + band * 0.5f;
                        Vector2 sample = point + side * width * signed;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y);
                        float visibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.78f, -0.20f, terrainHeight));
                        vertices.Add(World(sample.x, sample.y,
                            terrainHeight + lift + (band == 2 ? 0.001f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(1f - Mathf.Abs(signed),
                            accumulated * 0.12f + seed));
                        colors.Add(new Color(1f, 1f, 1f, visibility));
                    }
                    if (i > 0) AddRowTriangles(row);
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
                uv.Add(new Vector2(1f, seed));
                colors.Add(Color.white);
                float rotation = rotationDegrees * Mathf.Deg2Rad;
                float cosRotation = Mathf.Cos(rotation);
                float sinRotation = Mathf.Sin(rotation);
                int previous = -1;
                for (int i = 0; i <= segments; i++)
                {
                    float progress = i / (float)segments;
                    float angle = progress * Mathf.PI * 2f;
                    float wobble = 1f + Mathf.Sin(angle * 3f + seed) * 0.10f
                        + Mathf.Sin(angle * 7f - seed * 0.67f) * 0.045f;
                    float localX = Mathf.Cos(angle) * radiusKm.x * wobble;
                    float localY = Mathf.Sin(angle) * radiusKm.y * wobble;
                    float x = centre.x + localX * cosRotation - localY * sinRotation;
                    float y = centre.y + localX * sinRotation + localY * cosRotation;
                    float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
                    int current = vertices.Count;
                    vertices.Add(World(x, y, terrainHeight + lift));
                    normals.Add(Vector3.up);
                    uv.Add(new Vector2(0f, progress * 4.9f + seed));
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

            private void AddRowTriangles(int row)
            {
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
