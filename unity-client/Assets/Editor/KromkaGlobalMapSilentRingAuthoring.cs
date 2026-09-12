using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 18/20: the Silent Ring gains an irregular ash mantle,
    /// broken thermal arcs, inward erosion fans and mineral inner edges. These
    /// surfaces reinforce the existing relief without drawing a uniform border.
    /// </summary>
    internal static class KromkaGlobalMapSilentRingAuthoring
    {
        internal const int TextureIteration = 18;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalSilentRing.shader";
        private const string AshTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Cave/Textures/MEP_CaveGround_Dif_N.png";
        private const string BurnedTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/Cliff_03/Textures/MEP_Cliff_03_Terrain.png";
        private const string MineralTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_05.png";

        private const string AshMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalSilent_AshMantle_MEP.mat";
        private const string BurnMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalSilent_BurnArcs_MEP.mat";
        private const string ErosionMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalSilent_ErosionFans_MEP.mat";
        private const string MineralMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalSilent_MineralEdges_MEP.mat";

        private const string AshMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalSilent_AshMantle.asset";
        private const string BurnMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalSilent_BurnArcs.asset";
        private const string ErosionMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalSilent_ErosionFans.asset";
        private const string MineralMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalSilent_MineralEdges.asset";

        private static readonly Vector2[] BurnArcDegrees =
        {
            new Vector2(-171f, -156f), new Vector2(-143f, -128f),
            new Vector2(-112f, -96f), new Vector2(-72f, -56f),
            new Vector2(-37f, -20f), new Vector2(2f, 18f),
            new Vector2(31f, 48f), new Vector2(65f, 80f),
            new Vector2(97f, 114f), new Vector2(132f, 148f),
            new Vector2(160f, 174f), new Vector2(186f, 199f)
        };

        private static readonly Vector2[] MineralArcDegrees =
        {
            new Vector2(-162f, -151f), new Vector2(-137f, -126f),
            new Vector2(-104f, -90f), new Vector2(-82f, -70f),
            new Vector2(-48f, -35f), new Vector2(-13f, 0f),
            new Vector2(20f, 31f), new Vector2(48f, 60f),
            new Vector2(76f, 87f), new Vector2(104f, 118f),
            new Vector2(127f, 139f), new Vector2(151f, 162f),
            new Vector2(177f, 188f), new Vector2(203f, 215f)
        };

        private static readonly float[] ErosionFanDegrees =
        {
            -155f, -121f, -91f, -60f, -29f,
            8f, 42f, 74f, 111f, 147f
        };

        internal static void Compose(Transform root)
        {
            Material ash = BuildMaterial(AshMaterialPath,
                new Color(0.25f, 0.25f, 0.225f, 1f),
                new Color(0.045f, 0.047f, 0.042f, 1f),
                4.3f, 0.40f, 0.45f, 0.34f,
                0.96f, 0.12f, 0.30f, 0.10f, 0.43f);
            Material burned = BuildMaterial(BurnMaterialPath,
                new Color(0.27f, 0.145f, 0.072f, 1f),
                new Color(0.050f, 0.022f, 0.012f, 1f),
                4.8f, 0.46f, 0.62f, 0.24f,
                0.48f, 0.94f, 0.26f, 0.05f, 1.57f);
            Material erosion = BuildMaterial(ErosionMaterialPath,
                new Color(0.31f, 0.30f, 0.25f, 1f),
                new Color(0.078f, 0.071f, 0.055f, 1f),
                4.5f, 0.43f, 0.50f, 0.30f,
                0.60f, 0.18f, 0.96f, 0.42f, 2.73f);
            Material mineral = BuildMaterial(MineralMaterialPath,
                new Color(0.48f, 0.43f, 0.34f, 1f),
                new Color(0.11f, 0.092f, 0.067f, 1f),
                5.0f, 0.52f, 0.54f, 0.22f,
                0.34f, 0.07f, 0.48f, 0.94f, 4.19f);

            RingAccumulator ashMesh = new RingAccumulator();
            ashMesh.AddArc(-180f, 180f, 0.905f, 10.5f,
                0.020f, 112, 0.37f);

            RingAccumulator burnMesh = new RingAccumulator();
            for (int i = 0; i < BurnArcDegrees.Length; i++)
                burnMesh.AddArc(BurnArcDegrees[i].x, BurnArcDegrees[i].y,
                    0.955f, 6.2f, 0.028f, 15, 0.71f + i * 0.63f);

            RingAccumulator erosionMesh = new RingAccumulator();
            for (int i = 0; i < ErosionFanDegrees.Length; i++)
                erosionMesh.AddRadialFan(ErosionFanDegrees[i],
                    0.965f, 0.79f, 6.2f, 1.7f,
                    0.025f, 13, 0.53f + i * 0.77f);

            RingAccumulator mineralMesh = new RingAccumulator();
            for (int i = 0; i < MineralArcDegrees.Length; i++)
                mineralMesh.AddArc(MineralArcDegrees[i].x,
                    MineralArcDegrees[i].y, 0.825f, 4.3f,
                    0.031f, 10, 0.41f + i * 0.59f);

            CreateSurface("SilentAshMantle_SURFACE_MEP", root,
                PersistMesh(AshMeshPath,
                    ashMesh.Build("Kromka_GlobalSilent_AshMantle")), ash);
            CreateSurface("SilentBurnArcs_SURFACE_MEP", root,
                PersistMesh(BurnMeshPath,
                    burnMesh.Build("Kromka_GlobalSilent_BurnArcs")), burned);
            CreateSurface("SilentErosionFans_SURFACE_MEP", root,
                PersistMesh(ErosionMeshPath,
                    erosionMesh.Build("Kromka_GlobalSilent_ErosionFans")), erosion);
            CreateSurface("SilentMineralEdges_SURFACE_MEP", root,
                PersistMesh(MineralMeshPath,
                    mineralMesh.Build("Kromka_GlobalSilent_MineralEdges")), mineral);
            Child(root, "SilentAshMantle_1_REFERENCE");
            Child(root, "SilentBurnArcs_12_REFERENCE");
            Child(root, "SilentErosionFans_10_REFERENCE");
            Child(root, "SilentMineralEdges_14_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 18")]
        public static void ValidateIteration18()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka Silent Ring shader is missing or invalid.");
            Texture2D ash = ValidateSource(AshTexturePath, "Silent Ring ash ground");
            Texture2D burned = ValidateSource(BurnedTexturePath,
                "Silent Ring burned rock");
            Texture2D mineral = ValidateSource(MineralTexturePath,
                "Silent Ring mineral dust");
            ValidateMaterial(AshMaterialPath, shader, ash, burned, mineral,
                0.39f, 0.51f, 0.90f, 1f, 0.06f, 0.16f);
            ValidateMaterial(BurnMaterialPath, shader, ash, burned, mineral,
                0.56f, 0.68f, 0.42f, 0.54f, 0.88f, 1f);
            ValidateMaterial(ErosionMaterialPath, shader, ash, burned, mineral,
                0.44f, 0.56f, 0.54f, 0.66f, 0.12f, 0.24f);
            ValidateMaterial(MineralMaterialPath, shader, ash, burned, mineral,
                0.48f, 0.60f, 0.28f, 0.40f, 0.03f, 0.11f);
            Require(AssetDatabase.LoadAssetAtPath<Material>(ErosionMaterialPath)
                    .GetFloat("_Erosion") >= 0.90f,
                "Silent Ring erosion fans are not sufficiently differentiated.");
            Require(AssetDatabase.LoadAssetAtPath<Material>(MineralMaterialPath)
                    .GetFloat("_Mineral") >= 0.90f,
                "Silent Ring mineral edges do not expose enough MEP dust detail.");
            ValidateSurface("SilentAshMantle_SURFACE_MEP",
                AshMeshPath, AshMaterialPath, 550);
            ValidateSurface("SilentBurnArcs_SURFACE_MEP",
                BurnMeshPath, BurnMaterialPath, 900);
            ValidateSurface("SilentErosionFans_SURFACE_MEP",
                ErosionMeshPath, ErosionMaterialPath, 680);
            ValidateSurface("SilentMineralEdges_SURFACE_MEP",
                MineralMeshPath, MineralMaterialPath, 750);
            Require(GameObject.Find("SilentAshMantle_1_REFERENCE") != null
                && GameObject.Find("SilentBurnArcs_12_REFERENCE") != null
                && GameObject.Find("SilentErosionFans_10_REFERENCE") != null
                && GameObject.Find("SilentMineralEdges_14_REFERENCE") != null,
                "Silent Ring surface reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 90%] PASS: three direct high-resolution MEP "
                + "sources form one broken ash mantle, twelve thermal arcs, ten "
                + "inward erosion fans and fourteen mineral edges around the Silent Ring.");
        }

        private static Material BuildMaterial(string path, Color tint,
                                              Color darkTint,
                                              float detailTiling,
                                              float macroTiling,
                                              float opacity, float edgeFade,
                                              float ash, float burn,
                                              float erosion, float mineral,
                                              float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D ashTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(AshTexturePath);
            Texture2D burnedTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                BurnedTexturePath);
            Texture2D mineralTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(
                MineralTexturePath);
            if (shader == null || ashTexture == null || burnedTexture == null
                || mineralTexture == null)
                throw new InvalidOperationException(
                    "Silent Ring shader or direct MEP texture is missing.");
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
            material.SetTexture("_MainTex", ashTexture);
            material.SetTexture("_SecondaryTex", burnedTexture);
            material.SetTexture("_MineralTex", mineralTexture);
            material.SetColor("_Tint", tint);
            material.SetColor("_DarkTint", darkTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_Ash", ash);
            material.SetFloat("_Burn", burn);
            material.SetFloat("_Erosion", erosion);
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
                                             Texture2D ash,
                                             Texture2D burned,
                                             Texture2D mineral,
                                             float minOpacity,
                                             float maxOpacity,
                                             float minAsh,
                                             float maxAsh,
                                             float minBurn,
                                             float maxBurn)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == ash
                && material.GetTexture("_SecondaryTex") == burned
                && material.GetTexture("_MineralTex") == mineral,
                path + " does not directly use all selected MEP ring sources.");
            Require(material.GetFloat("_Opacity") >= minOpacity
                && material.GetFloat("_Opacity") <= maxOpacity,
                path + " opacity is outside its authored Silent Ring range.");
            Require(material.GetFloat("_Ash") >= minAsh
                && material.GetFloat("_Ash") <= maxAsh,
                path + " ash strength is outside its authored range.");
            Require(material.GetFloat("_Burn") >= minBurn
                && material.GetFloat("_Burn") <= maxBurn,
                path + " thermal-scorch strength is outside its authored range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 9f,
                path + " lacks separate ash-grain and ring-scale breakup.");
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

        private sealed class RingAccumulator
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<Vector3> normals = new List<Vector3>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private readonly List<Color> colors = new List<Color>();
            private readonly List<int> triangles = new List<int>();

            internal void AddArc(float startDegrees, float endDegrees,
                                 float radiusScale, float halfWidthKm,
                                 float lift, int subdivisions, float seed)
            {
                for (int i = 0; i <= subdivisions; i++)
                {
                    float progress = i / (float)subdivisions;
                    float angle = Mathf.Lerp(startDegrees, endDegrees, progress)
                        * Mathf.Deg2Rad;
                    float wobble = Mathf.Sin(angle * 7f + seed) * 0.012f
                        + Mathf.Sin(angle * 17f - seed * 0.71f) * 0.006f;
                    int row = vertices.Count;
                    for (int band = 0; band < 5; band++)
                    {
                        float signed = -1f + band * 0.5f;
                        float radiusX = 186f * (radiusScale + wobble)
                            + signed * halfWidthKm;
                        float radiusY = 146f * (radiusScale + wobble)
                            + signed * halfWidthKm;
                        float x = 190f + Mathf.Cos(angle) * radiusX;
                        float y = 150f + Mathf.Sin(angle) * radiusY;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(x, y);
                        float visibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.82f, -0.18f, terrainHeight));
                        vertices.Add(World(x, y, terrainHeight + lift
                            + (band == 2 ? 0.001f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(1f - Mathf.Abs(signed),
                            progress * 8f + seed));
                        colors.Add(new Color(1f, 1f, 1f, visibility));
                    }
                    if (i > 0) AddRowTriangles(row);
                }
            }

            internal void AddRadialFan(float angleDegrees,
                                       float outerScale, float innerScale,
                                       float outerWidthKm, float innerWidthKm,
                                       float lift, int subdivisions, float seed)
            {
                float angle = angleDegrees * Mathf.Deg2Rad;
                Vector2 tangent = new Vector2(-Mathf.Sin(angle) * 186f,
                    Mathf.Cos(angle) * 146f).normalized;
                for (int i = 0; i <= subdivisions; i++)
                {
                    float progress = i / (float)subdivisions;
                    float scale = Mathf.Lerp(outerScale, innerScale, progress);
                    float meander = Mathf.Sin(progress * Mathf.PI * 2.7f + seed)
                        * Mathf.Sin(progress * Mathf.PI) * 1.9f;
                    Vector2 centre = new Vector2(
                        190f + Mathf.Cos(angle) * 186f * scale,
                        150f + Mathf.Sin(angle) * 146f * scale) + tangent * meander;
                    float width = Mathf.Lerp(outerWidthKm, innerWidthKm, progress)
                        * (1f + Mathf.Sin(i * 0.81f + seed) * 0.08f);
                    int row = vertices.Count;
                    for (int band = 0; band < 5; band++)
                    {
                        float signed = -1f + band * 0.5f;
                        Vector2 sample = centre + tangent * width * signed;
                        float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                            sample.x, sample.y);
                        float visibility = Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(-0.82f, -0.18f, terrainHeight));
                        vertices.Add(World(sample.x, sample.y,
                            terrainHeight + lift + (band == 2 ? 0.001f : 0f)));
                        normals.Add(Vector3.up);
                        uv.Add(new Vector2(1f - Mathf.Abs(signed),
                            progress * 6.4f + seed));
                        colors.Add(new Color(1f, 1f, 1f, visibility));
                    }
                    if (i > 0) AddRowTriangles(row);
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
