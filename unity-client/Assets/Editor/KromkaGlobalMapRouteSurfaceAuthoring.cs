using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Texture iteration 09/20: MEP-backed transport and hydraulic surfaces with
    /// route-scale wear. Canonical splines conform to the relief while wheel ruts,
    /// mineral shoulder dust, lowland grime and junction aprons break their uniformity.
    /// </summary>
    internal static class KromkaGlobalMapRouteSurfaceAuthoring
    {
        internal const int TextureIteration = 9;
        internal const int TextureIterationCount = 20;

        private const float Scale = 0.1f;
        private const string ShaderPath =
            "Assets/Art/Kromka/Shaders/KromkaGlobalRoute.shader";
        private const string RoadTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_N_Dif.tga";
        private const string BallastTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_StoneGround/Textures/MEP_StoneGround_Dif.png";
        private const string HydraulicTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Rocks/MEP_Edge_01/Textures/MEP_SandStone_Terrain.png";
        private const string WearSoilTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Soil_01_N_Dif.tga";
        private const string MineralDustTexturePath =
            "Assets/MEP/MEP_Environment/MEP_Terrains/MEP_Terrain_Textures/MEP_Sand_03.tga";

        private const string ShoulderMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Shoulder_MEP.mat";
        private const string RoadMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Road_MEP.mat";
        private const string BallastMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Ballast_MEP.mat";
        private const string HydraulicMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Hydraulic_MEP.mat";
        private const string TransitionMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_GlobalRoute_Transitions_MEP.mat";

        private const string ShoulderMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalRoutes_Shoulder.asset";
        private const string RoadMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalRoutes_Road.asset";
        private const string BallastMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalRoutes_Ballast.asset";
        private const string HydraulicMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalRoutes_Hydraulic.asset";
        private const string TransitionMeshPath =
            "Assets/Art/Kromka/Meshes/Kromka_GlobalRoutes_Transitions.asset";

        internal static readonly Vector2[] TesmaServiceRoad =
        {
            new Vector2(184f, 286f), new Vector2(174f, 250f),
            new Vector2(180f, 222f), new Vector2(188f, 210f),
            new Vector2(188f, 190f), new Vector2(189f, 170f),
            new Vector2(193f, 145f), new Vector2(195f, 120f),
            new Vector2(195f, 92f), new Vector2(196f, 72f)
        };

        internal static readonly Vector2[] OreFreightRail =
        {
            // Freight yards -> Keys crossing -> western science-belt service
            // terminus. The old line passed through the sealed laboratory cores.
            new Vector2(28f, 246f), new Vector2(72f, 222f),
            new Vector2(78f, 220f), new Vector2(82f, 216f),
            new Vector2(100f, 214f), new Vector2(102f, 212f),
            new Vector2(152f, 200f), new Vector2(174f, 200f),
            new Vector2(185f, 215f), new Vector2(199f, 217f),
            new Vector2(211f, 219f), new Vector2(221f, 213f),
            new Vector2(229f, 215f), new Vector2(275f, 185f)
        };

        internal static readonly Vector2[] MainTract =
        {
            new Vector2(0f, 155f), new Vector2(54f, 155f),
            new Vector2(125f, 155f), new Vector2(195f, 205f),
            new Vector2(245f, 165f), new Vector2(295f, 110f),
            new Vector2(380f, 85f)
        };

        internal static readonly Vector2[] ZeroServiceLine =
        {
            new Vector2(125f, 155f), new Vector2(160f, 126f),
            // Cross upstream of R-12, then skirt the factory and settling lake.
            new Vector2(184f, 116f), new Vector2(193f, 114f),
            new Vector2(214f, 114f), new Vector2(245f, 102f),
            new Vector2(282f, 82f), new Vector2(304f, 54f)
        };

        // Shared with bridge placement: crossings must use rendered splines,
        // not straight segments between the sparse authored control points.
        internal static Vector2[] SampleRoute(Vector2[] points) =>
            ReferenceEquals(points, OreFreightRail) ? SampleFreightRoute(points)
                : RibbonAccumulator.Smooth(points, 5).ToArray();

        private static Vector2[] SampleFreightRoute(Vector2[] points)
        {
            var corners = new List<Vector2> { points[0] };
            for (int i = 1; i < points.Length - 1; i++)
            {
                float cut = Mathf.Min(.6f, Vector2.Distance(points[i - 1], points[i]) * .2f,
                    Vector2.Distance(points[i], points[i + 1]) * .2f);
                Vector2 a = points[i] + (points[i - 1] - points[i]).normalized * cut;
                Vector2 b = points[i] + (points[i + 1] - points[i]).normalized * cut;
                for (int step = 0; step <= 8; step++)
                {
                    float t = step / 8f;
                    corners.Add((1f - t) * (1f - t) * a + 2f * t * (1f - t) * points[i] + t * t * b);
                }
            }
            corners.Add(points[points.Length - 1]);
            var samples = new List<Vector2>();
            for (int i = 0; i < corners.Count - 1; i++)
            {
                int steps = Mathf.Max(1, Mathf.CeilToInt(Vector2.Distance(corners[i], corners[i + 1]) / .6f));
                for (int step = 0; step < steps; step++) samples.Add(Vector2.Lerp(corners[i], corners[i + 1], step / (float)steps));
            }
            samples.Add(corners[corners.Count - 1]); return samples.ToArray();
        }

        internal static void Compose(Transform root)
        {
            Material shoulder = BuildMaterial(ShoulderMaterialPath, RoadTexturePath,
                MineralDustTexturePath, new Color(0.40f, 0.34f, 0.24f, 1f),
                new Color(0.73f, 0.66f, 0.52f, 1f), 1.65f, 0.29f, 0.29f,
                0.68f, 0.31f, 0.88f, 0.54f, 0.10f, 0.82f, 0.16f, 0.41f);
            Material road = BuildMaterial(RoadMaterialPath, RoadTexturePath,
                WearSoilTexturePath, new Color(0.88f, 0.83f, 0.72f, 1f),
                new Color(0.70f, 0.63f, 0.52f, 1f), 2.15f, 0.37f, 0.25f,
                0.82f, 0.22f, 1.22f, 0.72f, 0.88f, 0.34f, 0.42f, 1.83f);
            Material ballast = BuildMaterial(BallastMaterialPath, BallastTexturePath,
                MineralDustTexturePath, new Color(0.50f, 0.48f, 0.43f, 1f),
                new Color(0.62f, 0.57f, 0.47f, 1f), 2.65f, 0.44f, 0.31f,
                0.88f, 0.18f, 1.42f, 0.46f, 0.12f, 0.58f, 0.18f, 2.67f);
            Material hydraulic = BuildMaterial(HydraulicMaterialPath, HydraulicTexturePath,
                MineralDustTexturePath, new Color(0.58f, 0.55f, 0.47f, 1f),
                new Color(0.76f, 0.72f, 0.62f, 1f), 2.35f, 0.36f, 0.27f,
                0.86f, 0.20f, 1.08f, 0.52f, 0.05f, 0.72f, 0.26f, 3.31f);
            Material transitions = BuildMaterial(TransitionMaterialPath, WearSoilTexturePath,
                MineralDustTexturePath, new Color(0.49f, 0.45f, 0.38f, 1f),
                new Color(0.76f, 0.70f, 0.59f, 1f), 2.45f, 0.46f, 0.36f,
                0.72f, 0.48f, 0.92f, 0.64f, 0.22f, 0.88f, 0.44f, 4.73f);

            RibbonAccumulator shoulderMesh = new RibbonAccumulator();
            shoulderMesh.AddRibbon(MainTract, 2.8f, 0.030f, 5, 0.41f);
            shoulderMesh.AddRibbon(TesmaServiceRoad, 2.35f, 0.031f, 5, 1.37f);
            shoulderMesh.AddRibbon(ZeroServiceLine, 1.55f, 0.032f, 5, 2.71f);

            RibbonAccumulator roadMesh = new RibbonAccumulator();
            roadMesh.AddRibbon(MainTract, 1.45f, 0.046f, 5, 0.93f);
            roadMesh.AddRibbon(TesmaServiceRoad, 1.10f, 0.047f, 5, 1.89f);
            roadMesh.AddRibbon(ZeroServiceLine, 0.64f, 0.048f, 5, 3.23f);

            RibbonAccumulator ballastMesh = new RibbonAccumulator();
            ballastMesh.AddRibbon(OreFreightRail, 1.35f, 0.040f, 5, 4.17f, true);

            RibbonAccumulator hydraulicMesh = new RibbonAccumulator();
            hydraulicMesh.AddRibbon(new[] { new Vector2(137f, 261f), new Vector2(177f, 263f) },
                2.7f, 0.041f, 10, 5.83f);
            hydraulicMesh.AddRibbon(new[] { new Vector2(191f, 264f), new Vector2(231f, 266f) },
                2.8f, 0.041f, 10, 6.47f);
            hydraulicMesh.AddRibbon(new[] { new Vector2(229f, 246f), new Vector2(269f, 248f) },
                2.6f, 0.041f, 10, 7.19f);

            PatchAccumulator transitionMesh = new PatchAccumulator();
            transitionMesh.AddPatch(new Vector2(125f, 155f), 4.5f, 3.1f,
                -38f, 0.061f, 24, 0.63f);
            transitionMesh.AddPatch(new Vector2(195f, 205f), 6.4f, 4.7f,
                14f, 0.061f, 30, 1.37f);
            transitionMesh.AddPatch(new Vector2(216f, 171f), 3.8f, 2.5f,
                32f, 0.062f, 22, 2.11f);
            transitionMesh.AddPatch(new Vector2(245f, 102f), 4.2f, 2.9f,
                -6f, 0.061f, 24, 2.83f);
            transitionMesh.AddPatch(new Vector2(295f, 110f), 3.4f, 2.3f,
                -28f, 0.061f, 22, 3.59f);

            CreateSurface("RouteShoulders_SURFACE_MEP", root,
                PersistMesh(ShoulderMeshPath, shoulderMesh.Build("Kromka_GlobalRoutes_Shoulder")),
                shoulder);
            CreateSurface("RoadCores_SURFACE_MEP", root,
                PersistMesh(RoadMeshPath, roadMesh.Build("Kromka_GlobalRoutes_Road")), road);
            CreateSurface("RailBallast_SURFACE_MEP", root,
                PersistMesh(BallastMeshPath, ballastMesh.Build("Kromka_GlobalRoutes_Ballast")),
                ballast);
            CreateSurface("HydraulicAprons_SURFACE_MEP", root,
                PersistMesh(HydraulicMeshPath,
                    hydraulicMesh.Build("Kromka_GlobalRoutes_Hydraulic")), hydraulic);
            CreateSurface("RouteJunctionTransitions_SURFACE_MEP", root,
                PersistMesh(TransitionMeshPath,
                    transitionMesh.Build("Kromka_GlobalRoutes_Transitions")), transitions);
            Child(root, "VisibleTransportRoutes_4_REFERENCE");
            Child(root, "NorthernDamAprons_3_REFERENCE");
            Child(root, "RouteWearPatterns_4_REFERENCE");
            Child(root, "RouteJunctionTransitions_5_REFERENCE");
        }

        [MenuItem("Kromka/Checks/Validate texture iteration 09")]
        public static void ValidateIteration09()
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Require(shader != null && !ShaderUtil.ShaderHasError(shader),
                "Kromka global route shader is missing or invalid.");
            Texture2D road = ValidateSource(RoadTexturePath, "road soil");
            Texture2D ballast = ValidateSource(BallastTexturePath, "rail ballast");
            Texture2D hydraulic = ValidateSource(HydraulicTexturePath, "hydraulic aggregate");
            Texture2D wearSoil = ValidateSource(WearSoilTexturePath, "route wear soil");
            Texture2D mineralDust = ValidateSource(MineralDustTexturePath,
                "route mineral dust");
            ValidateMaterial(ShoulderMaterialPath, shader, road, mineralDust,
                0.60f, 0.76f, 0.48f, 0.62f);
            ValidateMaterial(RoadMaterialPath, shader, road, wearSoil,
                0.76f, 0.88f, 0.66f, 0.78f);
            ValidateMaterial(BallastMaterialPath, shader, ballast, mineralDust,
                0.82f, 0.94f, 0.40f, 0.52f);
            ValidateMaterial(HydraulicMaterialPath, shader, hydraulic, mineralDust,
                0.80f, 0.92f, 0.46f, 0.58f);
            ValidateMaterial(TransitionMaterialPath, shader, wearSoil, mineralDust,
                0.66f, 0.78f, 0.58f, 0.70f);
            ValidateSurface("RouteShoulders_SURFACE_MEP", ShoulderMeshPath,
                ShoulderMaterialPath, 240);
            ValidateSurface("RoadCores_SURFACE_MEP", RoadMeshPath,
                RoadMaterialPath, 240);
            ValidateSurface("RailBallast_SURFACE_MEP", BallastMeshPath,
                BallastMaterialPath, 90);
            ValidateSurface("HydraulicAprons_SURFACE_MEP", HydraulicMeshPath,
                HydraulicMaterialPath, 99);
            ValidateSurface("RouteJunctionTransitions_SURFACE_MEP", TransitionMeshPath,
                TransitionMaterialPath, 125);
            Require(GameObject.Find("VisibleTransportRoutes_4_REFERENCE") != null
                && GameObject.Find("NorthernDamAprons_3_REFERENCE") != null
                && GameObject.Find("RouteWearPatterns_4_REFERENCE") != null
                && GameObject.Find("RouteJunctionTransitions_5_REFERENCE") != null,
                "Canonical route, wear or transition reference handles are incomplete.");
            Debug.Log("[KROMKA TEXTURES 45%] PASS: five direct high-resolution MEP "
                + "surface uses provide relief-conforming routes with wheel ruts, mineral "
                + "shoulder dust, lowland grime and five irregular junction transitions.");
        }

        private static Material BuildMaterial(string path, string texturePath,
                                              string wearTexturePath, Color tint,
                                              Color wearTint, float detailTiling,
                                              float macroTiling, float macroBlend,
                                              float opacity, float edgeFade,
                                              float wearTiling, float wearStrength,
                                              float ruts, float edgeDust,
                                              float wetLowlands, float seed)
        {
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(ShaderPath);
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
            Texture2D wearTexture = AssetDatabase.LoadAssetAtPath<Texture2D>(wearTexturePath);
            if (shader == null || texture == null || wearTexture == null)
                throw new InvalidOperationException("Route shader or MEP route texture is missing.");
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
            material.SetTexture("_WearTex", wearTexture);
            material.SetColor("_Tint", tint);
            material.SetColor("_WearTint", wearTint);
            material.SetFloat("_DetailTiling", detailTiling);
            material.SetFloat("_MacroTiling", macroTiling);
            material.SetFloat("_MacroBlend", macroBlend);
            material.SetFloat("_Opacity", opacity);
            material.SetFloat("_EdgeFade", edgeFade);
            material.SetFloat("_WearTiling", wearTiling);
            material.SetFloat("_WearStrength", wearStrength);
            material.SetFloat("_Ruts", ruts);
            material.SetFloat("_EdgeDust", edgeDust);
            material.SetFloat("_WetLowlands", wetLowlands);
            material.SetFloat("_Seed", seed);
            material.SetFloat("_Roughness", 0.88f);
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
                                             Texture2D wearTexture, float minimumOpacity,
                                             float maximumOpacity, float minimumWear,
                                             float maximumWear)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader == shader
                && material.GetTexture("_MainTex") == texture
                && material.GetTexture("_WearTex") == wearTexture,
                path + " does not directly use its selected MEP source.");
            Require(material.GetFloat("_Opacity") >= minimumOpacity
                && material.GetFloat("_Opacity") <= maximumOpacity,
                path + " opacity is outside the legible overlay range.");
            Require(material.GetFloat("_DetailTiling")
                    / material.GetFloat("_MacroTiling") >= 4.5f,
                path + " lacks separated detail and macro texture scales.");
            Require(material.GetFloat("_WearStrength") >= minimumWear
                && material.GetFloat("_WearStrength") <= maximumWear,
                path + " wear strength is outside its authored range.");
            Require(material.GetFloat("_WearTiling") >= 0.8f
                && material.GetFloat("_WearTiling") <= 1.6f,
                path + " wear breakup scale is outside the route-scale range.");
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
                name + " does not use its persistent mesh and MEP material.");
        }

        private static void CreateSurface(string name, Transform parent, Mesh mesh,
                                          Material material)
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

        private sealed class PatchAccumulator
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<Vector3> normals = new List<Vector3>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private readonly List<int> triangles = new List<int>();

            internal void AddPatch(Vector2 centre, float radiusXKm, float radiusYKm,
                                   float rotationDegrees, float lift,
                                   int segments, float seed)
            {
                int centreIndex = vertices.Count;
                float centreHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    centre.x, centre.y) + lift + 0.002f;
                vertices.Add(World(centre.x, centre.y, centreHeight));
                normals.Add(Vector3.up);
                uv.Add(new Vector2(1f, seed));

                float rotation = rotationDegrees * Mathf.Deg2Rad;
                float cosRotation = Mathf.Cos(rotation);
                float sinRotation = Mathf.Sin(rotation);
                for (int i = 0; i <= segments; i++)
                {
                    float progress = i / (float)segments;
                    float angle = progress * Mathf.PI * 2f;
                    float irregularity = 1f
                        + Mathf.Sin(angle * 3f + seed * 2.1f) * 0.10f
                        + Mathf.Sin(angle * 7f + seed * 0.73f) * 0.045f;
                    float localX = Mathf.Cos(angle) * radiusXKm * irregularity;
                    float localY = Mathf.Sin(angle) * radiusYKm * irregularity;
                    Vector2 point = centre + new Vector2(
                        localX * cosRotation - localY * sinRotation,
                        localX * sinRotation + localY * cosRotation);
                    float height = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                        point.x, point.y) + lift;
                    vertices.Add(World(point.x, point.y, height));
                    normals.Add(Vector3.up);
                    uv.Add(new Vector2(0f, progress * 4f + seed));
                    if (i == 0) continue;
                    triangles.Add(centreIndex);
                    triangles.Add(centreIndex + i);
                    triangles.Add(centreIndex + i + 1);
                }
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

        private sealed class RibbonAccumulator
        {
            private readonly List<Vector3> vertices = new List<Vector3>();
            private readonly List<Vector3> normals = new List<Vector3>();
            private readonly List<Vector2> uv = new List<Vector2>();
            private readonly List<int> triangles = new List<int>();

            internal void AddRibbon(Vector2[] controlPoints, float halfWidthKm,
                                    float lift, int subdivisions, float seed, bool railway = false)
            {
                List<Vector2> smooth = railway ? new List<Vector2>(SampleFreightRoute(controlPoints))
                    : Smooth(controlPoints, subdivisions);
                float accumulated = 0f;
                for (int i = 0; i < smooth.Count; i++)
                {
                    Vector2 point = smooth[i];
                    Vector2 previous = smooth[Mathf.Max(0, i - 1)];
                    Vector2 next = smooth[Mathf.Min(smooth.Count - 1, i + 1)];
                    Vector2 tangent = (next - previous).normalized;
                    Vector2 side = new Vector2(-tangent.y, tangent.x);
                    float width = halfWidthKm * (1f
                        + Mathf.Sin(i * 0.47f + seed) * 0.045f
                        + Mathf.Sin(i * 0.19f + seed * 1.71f) * 0.025f);
                    Vector2 left = point + side * width;
                    Vector2 right = point - side * width;
                    float leftHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                        left.x, left.y) + lift;
                    float centreHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                        point.x, point.y) + lift + 0.002f;
                    float rightHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                        right.x, right.y) + lift;
                    if (railway)
                    {
                        leftHeight = KromkaGlobalMapRouteCrossingAuthoring.RailwaySurfaceHeight(left, leftHeight - lift);
                        centreHeight = KromkaGlobalMapRouteCrossingAuthoring.RailwaySurfaceHeight(point, centreHeight - lift - .002f);
                        rightHeight = KromkaGlobalMapRouteCrossingAuthoring.RailwaySurfaceHeight(right, rightHeight - lift);
                    }
                    int index = vertices.Count;
                    vertices.Add(World(left.x, left.y, leftHeight));
                    vertices.Add(World(point.x, point.y, centreHeight));
                    vertices.Add(World(right.x, right.y, rightHeight));
                    normals.Add(Vector3.up);
                    normals.Add(Vector3.up);
                    normals.Add(Vector3.up);
                    if (i > 0) accumulated += Vector2.Distance(smooth[i - 1], point);
                    uv.Add(new Vector2(0f, accumulated * 0.13f));
                    uv.Add(new Vector2(1f, accumulated * 0.13f));
                    uv.Add(new Vector2(0f, accumulated * 0.13f));
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

            internal static List<Vector2> Smooth(Vector2[] points, int subdivisions)
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
