#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using A = Kromka.EditorTools.KromkaGlobalMapOuterWastelandAuthoring;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Deterministic, incremental exterior authoring. Each transaction adds exactly
    /// one 18-degree sector; no playable geometry, node, collider or route is edited.
    /// The distant low-poly skirt is continuous and extends beyond strategic fog.
    /// </summary>
    internal static class KromkaGlobalMapOuterWastelandPerimeterAuthoring
    {
        internal const string ScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string ProgressPath = "Assets/Art/Kromka/OuterWastelandProgress.json";
        private const string MeshRoot = "Assets/Art/Kromka/Meshes/";
        private const string MaterialRoot = "Assets/Art/Kromka/Materials/";
        private const string Buildings = "Assets/ThirdParty/OpenGameArt/MajadroidApocalypticBuildings/Models/";
        private const string Factory = "Assets/ThirdParty/Kenney/FactoryKit30/Models/";
        private const string Industrial = "Assets/ThirdParty/Kenney/CityKitIndustrial20/Models/";
        private const string Wreck = "Assets/ThirdParty/OpenGameArt/MehozavrUaz452/uaz_destroyed.fbx";
        private const string Trees = "Assets/MEP/MEP_Environment/Vegetation/MEP_Trees/MEP_BrokenTrees/Prefabs/";
        private const float Start = 2.199115f;
        private const float Step = Mathf.PI / 10f;
        private const int Angles = 32;
        private const int Rows = 24;
        private static readonly string[] Themes = {
            "NorthWest", "Evacuation", "CollapsedCity",
            "CharredForest", "ShatteredFactory", "GlassDesert", "WarheadField",
            "DeadIndustrialBelt", "BuriedConvoy", "AshDunes", "RupturedSilos",
            "SouthernGroundZero", "BurntResidentialBlocks", "EasternScrapyard",
            "ScorchedUplands", "FallenRelay", "DustBasin", "NorthernGhostTown",
            "FalloutForest", "LastRuins"
        };

        [Serializable] private sealed class Progress { public int completedIterations = 3; }
        internal static int Completed => Mathf.Clamp(JsonUtility.FromJson<Progress>(
            File.ReadAllText(ProgressPath)).completedIterations, 3, 20);

        private readonly struct Crater
        {
            public readonly float Angle, Outset, Radius, Depth;
            public Crater(float angle, float outset, float radius, float depth)
            { Angle = angle; Outset = outset; Radius = radius; Depth = depth; }
        }

        private static Crater[] Craters(int sector)
        {
            float mid = Start + (sector - 0.5f) * Step;
            // Keep the near blast bowls away from radial seams. Distinct distant
            // impact basins break the repetition of a uniform ring of small pits.
            return new[] {
                new Crater(mid - 0.026f, 0.34f, sector % 4 == 0 ? 1.55f : 1.05f,
                    sector % 4 == 0 ? 0.60f : 0.37f),
                new Crater(mid + 0.065f, 0.515f, 0.62f + sector % 3 * 0.12f, 0.27f),
                new Crater(mid - 0.012f, 1.18f + sector % 3 * 0.16f,
                    3.0f + sector % 4 * 0.55f, 0.8f + sector % 3 * 0.2f)
            };
        }

        private static string SectorName(int n) =>
            "Iteration" + n.ToString("00") + "_" + Themes[n - 1] + "_" + (n * 5) + "pct";

        internal static void ComposeCompleted(Transform staticContent)
        {
            if (Completed < 4) return;
            Transform outer = staticContent.Find("WorldEdge_AUTHORED/OuterNuclearWasteland_AUTHORED");
            A.Require(outer != null, "Existing exterior is required.");
            BuildHorizon(outer);
            for (int i = 4; i <= Completed; i++) ComposeSector(outer, i);
            SeatApronJoins(outer, Completed);
        }

        [MenuItem("Realm of Ashes/Authoring/Outer wasteland/Add next 5 percent")]
        public static void AddNext()
        {
            RefuseDirtyScenes();
            int next = Completed + 1;
            A.Require(next <= 20, "All twenty exterior sectors already exist.");
            Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            Transform outer = FindOuter(scene);
            // Persistent mesh references retain their GUIDs across future rebuilds.
            if (outer.Find("DistantAshHorizon_AUTHORED") == null) BuildHorizon(outer);
            ComposeSector(outer, next);
            SeatApronJoins(outer, next);
            Validate(scene, next);
            AssetDatabase.SaveAssets();
            A.Require(EditorSceneManager.SaveScene(scene), "Could not save exterior scene.");
            File.WriteAllText(ProgressPath, JsonUtility.ToJson(
                new Progress { completedIterations = next }, true) + "\n");
            AssetDatabase.ImportAsset(ProgressPath);
            string output = Output;
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "iteration-" + next.ToString("00") + ".txt"),
                "PASS: " + (next * 5) + "%; " + Themes[next - 1]
                + "; seams, outside-only vertices, disabled colliders, persistent meshes.\n");
            Debug.Log("[OUTER WASTELAND] PASS: " + next + "/20, " + next * 5 + "%.");
        }

        [MenuItem("Realm of Ashes/Checks/Outer wasteland/Validate completed perimeter")]
        public static void ValidateCompleted()
        {
            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            Validate(scene, Completed);
            Transform outer = FindOuter(scene);
            MeshFilter[] meshes = outer.GetComponentsInChildren<MeshFilter>(true);
            long triangles = meshes.Sum(f => (long)f.sharedMesh.triangles.Length / 3);
            int renderers = outer.GetComponentsInChildren<Renderer>(true).Length;
            Directory.CreateDirectory(Output);
            File.WriteAllText(Path.Combine(Output, "final-audit.txt"),
                "PASS: " + Completed + "/20 sectors. Closed at 20. No active exterior colliders.\n"
                + "All near and horizon seams agree within 0.003 world units; horizon extends beyond fog.\n"
                + "Exterior triangles: " + triangles + "; renderers: " + renderers + ".\n");
        }

        [MenuItem("Realm of Ashes/Authoring/Outer wasteland/Repair terrain joins")]
        public static void RepairTerrainJoins()
        {
            RefuseDirtyScenes();
            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            Transform outer = FindOuter(scene);
            SeatApronJoins(outer, Completed);
            A.BuildOuterGroundMaterial();
            for (int n = 4; n <= Completed; n++)
                A.PersistMesh(MeshRoot + "Kromka_OuterPerimeterScorch_" + n.ToString("00")
                    + ".asset", BuildScars(n));
            Validate(scene, Completed);
            AssetDatabase.SaveAssets();
            A.Require(EditorSceneManager.SaveScene(scene), "Could not save repaired exterior.");
        }

        // The older exterior started above the edge apron, exposing its backface
        // as a black slit from a low camera. Weld only the first three exterior
        // rows to the existing apron; leave the playable mesh untouched.
        private static void SeatApronJoins(Transform outer, int completed)
        {
            Mesh apron = outer.parent.Find("BoundaryLandscape_AUTHORED/TerrainApron_FadesIntoStorm")
                .GetComponent<MeshFilter>().sharedMesh;
            Vector3[] apronPoints = apron.vertices;
            int[] apronIndices = apron.triangles;
            for (int n = 1; n <= completed; n++)
            {
                Mesh mesh = NearMesh(outer, n);
                Vector3[] points = mesh.vertices;
                for (int row = 0; row < 3; row++)
                    for (int i = 0; i <= Angles; i++)
                    {
                        int index = row * 33 + i;
                        Vector3 p = points[index];
                        float angle = Mathf.Atan2(p.z / 14.65f, p.x / 18.65f);
                        float arc = Mathf.Repeat(angle - Start, Mathf.PI * 2f);
                        float original = n <= 3 ? LegacyHeight(p, n)
                            : NearHeight(p, angle, .09f + row * (.51f / Rows), n, arc);
                        A.Require(TrySurface(p, apronPoints, apronIndices, out float lower),
                            "Exterior/apron overlap missing at sector " + n);
                        p.y = Mathf.Lerp(lower + .008f, original,
                            Mathf.SmoothStep(0f, 1f, row / 3f));
                        points[index] = p;
                    }
                mesh.vertices = points;
                mesh.RecalculateNormals(); mesh.RecalculateBounds();
                EditorUtility.SetDirty(mesh);
            }
        }

        private static bool TrySurface(Vector3 p, Vector3[] vertices, int[] indices, out float height)
        {
            for (int i = 0; i < indices.Length; i += 3)
            {
                Vector3 a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
                if (p.x < Mathf.Min(a.x, Mathf.Min(b.x, c.x)) - .0001f
                    || p.x > Mathf.Max(a.x, Mathf.Max(b.x, c.x)) + .0001f
                    || p.z < Mathf.Min(a.z, Mathf.Min(b.z, c.z)) - .0001f
                    || p.z > Mathf.Max(a.z, Mathf.Max(b.z, c.z)) + .0001f) continue;
                float denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
                if (Mathf.Abs(denominator) < .0000001f) continue;
                float u = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / denominator;
                float v = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / denominator;
                if (u < -.0001f || v < -.0001f || u + v > 1.0001f) continue;
                height = a.y * u + b.y * v + c.y * (1f - u - v);
                return true;
            }
            height = 0f; return false;
        }

        private static void RefuseDirtyScenes()
        {
            A.Require(!EditorApplication.isPlayingOrWillChangePlaymode, "Exit Play Mode first.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                A.Require(!SceneManager.GetSceneAt(i).isDirty,
                    "Save your unsaved scene before exterior authoring.");
        }

        internal static Transform FindOuter(Scene scene)
        {
            A.Require(scene.IsValid() && scene.isLoaded, "Kromka global map must be loaded.");
            Transform root = scene.GetRootGameObjects().SelectMany(g =>
                g.GetComponentsInChildren<Transform>(true)).FirstOrDefault(t =>
                    t.name == "OuterNuclearWasteland_AUTHORED");
            A.Require(root != null, "Outer wasteland root missing.");
            return root;
        }

        internal static string Output => Path.GetFullPath(Path.Combine(Application.dataPath,
            "../../Build/KromkaSceneCaptures/outer-wasteland-perimeter"));

        private static void ReplaceChild(Transform parent, string name)
        {
            Transform old = parent.Find(name);
            if (old != null) UnityEngine.Object.DestroyImmediate(old.gameObject);
        }

        private static void ComposeSector(Transform outer, int n)
        {
            ReplaceChild(outer, SectorName(n));
            Transform root = A.Child(outer, SectorName(n));
            StoreGround(root, "DevastatedTerrain", BuildGrid(n, false),
                "Kromka_OuterPerimeter_" + n.ToString("00"));
            Mesh scars = BuildScars(n);
            A.CreateMeshObject("NuclearImpactScorch", root, A.PersistMesh(
                MeshRoot + "Kromka_OuterPerimeterScorch_" + n.ToString("00") + ".asset", scars),
                A.RequireMaterial(MaterialRoot + "Kromka_OuterNuclearCraterScorch_MEP.mat"), false);
            Transform impactRoot = A.Child(root, "ImpactBasins_DEFORMED_TERRAIN");
            foreach (Crater crater in Craters(n))
                A.Child(impactRoot, "BlastBowl_r" + crater.Radius.ToString("F2",
                    System.Globalization.CultureInfo.InvariantCulture)).position =
                    Point(crater.Angle, crater.Outset);

            Transform props = A.Child(root, "OutsideOnly_SourcedModels");
            float mid = Start + (n - 0.5f) * Step;
            int kind = n % 5;
            if (kind == 0 || kind == 3)
            {
                Place(props, Buildings + "building-0" + (1 + n % 7) + ".fbx",
                    "CollapsedConcreteBlock", mid - .075f, .29f, 1.8f, 1.05f, n * 47f);
                Place(props, Buildings + "wreckage-3-types.fbx",
                    "BlastThrownMasonry", mid + .02f, .23f, 1.2f, .28f, n * 29f);
                Place(props, Buildings + "building-0" + (1 + (n + 2) % 7) + ".fbx",
                    "DistantGhostBlock", mid + .05f, .83f, 2.8f, 1.25f, n * 71f);
            }
            if (kind == 0 || kind == 1)
            {
                Place(props, Industrial + (n % 2 == 0 ? "building-g.fbx" : "building-k.fbx"),
                    "ShatteredIndustrialShell", mid + .078f, .36f, 1.65f, .85f, n * 19f, true);
                Place(props, Factory + (n % 2 == 0 ? "crane.fbx" : "hopper-high-round.fbx"),
                    "RustedFactoryRemnant", mid - .085f, .49f, 1.4f, 1.15f, n * 31f, true);
                Place(props, Factory + "conveyor-long-sides.fbx",
                    "CollapsedConveyor", mid + .016f, .60f, 1.7f, .26f, n * 73f, true);
            }
            if (kind == 2 || kind == 3 || n == 9)
            {
                for (int k = 0; k < 3; k++)
                    Place(props, Wreck, "BurntEvacuationVehicle_" + k,
                        mid - .085f + k * .054f, .19f + k * .023f, .46f, .25f,
                        n * 23f + k * 19f);
            }
            if (kind == 4 || n == 4 || n == 19)
            {
                for (int k = 0; k < 7; k++)
                    Place(props, Trees + "MEP_BrokenDeadTree_0" + (1 + k % 6) + "_N.prefab",
                        "BlastStrippedTree_" + k, mid - .104f + k * .029f,
                        .19f + ((k * 7 + n) % 5) * .071f, .33f, .5f + k % 3 * .13f,
                        n * 31f + k * 51f);
            }
            // Every sector has debris but no landmarks inside the playable outline.
            Place(props, Buildings + "wreckage-3-types.fbx", "ScatteredDebris",
                mid + .091f, .57f, 1.35f, .27f, n * 57f);
            if (n % 3 == 0)
                Place(props, Buildings + "building-04.fbx", "HorizonRuinSilhouette",
                    mid - .03f, 2.05f, 4.2f, 1.75f, n * 37f);
            A.MarkStatic(root.gameObject);
        }

        private static void Place(Transform parent, string path, string name,
            float angle, float outset, float footprint, float height, float yaw,
            bool industrialPalette = false)
        {
            GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            A.Require(source != null, "Missing sourced model: " + path);
            GameObject go = (GameObject)PrefabUtility.InstantiatePrefab(source, parent);
            go.name = name + "_SOURCE_" + Path.GetFileNameWithoutExtension(path);
            go.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            if (industrialPalette)
            {
                Material metal = A.RequireMaterial(MaterialRoot + "Kromka_OuterCity_RustMetal.mat");
                Material concrete = A.RequireMaterial(MaterialRoot + "Kromka_OuterCity_BrokenConcreteDark.mat");
                foreach (Renderer renderer in go.GetComponentsInChildren<Renderer>(true))
                    renderer.sharedMaterials = renderer.sharedMaterials.Select((m, i) =>
                        i % 2 == 0 ? metal : concrete).ToArray();
            }
            A.FitAndSeat(go, Point(angle, outset), footprint, height, .055f);
        }

        private static void StoreGround(Transform root, string name, Mesh mesh, string asset)
        {
            A.CreateMeshObject(name, root, A.PersistMesh(MeshRoot + asset + ".asset", mesh),
                A.RequireMaterial(MaterialRoot + "Kromka_OuterNuclearGround_MEP.mat"), false);
        }

        private static void BuildHorizon(Transform outer)
        {
            ReplaceChild(outer, "DistantAshHorizon_AUTHORED");
            Transform horizon = A.Child(outer, "DistantAshHorizon_AUTHORED");
            for (int n = 1; n <= 20; n++)
                StoreGround(horizon, "AshHorizon_" + n.ToString("00"), BuildGrid(n, true),
                    "Kromka_OuterAshHorizon_" + n.ToString("00"));
        }

        // Exact 18-degree intervals; source first three used rounded boundaries.
        private static float AngleAt(int sector, float t)
        {
            if (sector == 4 && t == 0f) return 3.141593f;
            if (sector == 20 && t == 1f) return Start + Mathf.PI * 2f;
            return Start + (sector - 1 + t) * Step;
        }

        private static Mesh BuildGrid(int sector, bool distant)
        {
            var verts = new List<Vector3>();
            var uv = new List<Vector2>();
            var triangles = new List<int>();
            int radialRows = distant ? 48 : Rows;
            for (int row = 0; row <= radialRows; row++)
            {
                // Coarser with distance; radius >230 at every azimuth. The final
                // edge lies behind fully opaque linear fog, even at the map rim.
                float outset = distant ? .60f + 20f * Mathf.Pow(row / (float)radialRows, 2.5f)
                    : Mathf.Lerp(.09f, .60f, row / (float)Rows);
                for (int i = 0; i <= Angles; i++)
                {
                    Vector3 v = Point(AngleAt(sector, i / (float)Angles), outset);
                    verts.Add(v); uv.Add(new Vector2(v.x / 38f + .5f, .5f - v.z / 30f));
                    if (row == 0 || i == 0) continue;
                    int a = (row - 1) * (Angles + 1) + i - 1;
                    int b = a + 1, c = a + Angles + 1, d = c + 1;
                    triangles.Add(a); triangles.Add(b); triangles.Add(c);
                    triangles.Add(b); triangles.Add(d); triangles.Add(c);
                }
            }
            var mesh = new Mesh { name = (distant ? "AshHorizon" : "DevastatedTerrain") + sector };
            mesh.SetVertices(verts); mesh.SetUVs(0, uv); mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals(); mesh.RecalculateBounds();
            return mesh;
        }

        private static Vector3 Point(float angle, float outset)
        {
            Vector3 p = RawPoint(angle, outset);
            p.y = Height(p, angle, outset);
            return p;
        }

        private static Vector3 RawPoint(float angle, float outset = 0f)
        {
            Vector2 p = KromkaGlobalMapReliefAuthoring.BoundaryMapPoint(angle, -outset);
            return new Vector3((p.x - 190f) * .1f, 0f, (150f - p.y) * .1f);
        }

        private static float LegacyHeight(Vector3 point, int sector)
        {
            if (sector == 1) return A.SurfaceHeightAtWorld(point);
            if (sector == 2) return KromkaGlobalMapOuterWastelandIteration02Authoring.SurfaceHeightAtWorld(point);
            return KromkaGlobalMapOuterWastelandIteration03Authoring.SurfaceHeightAtWorld(point);
        }

        private static float Height(Vector3 p, float angle, float outset)
        {
            float arc = Mathf.Repeat(angle - Start, Mathf.PI * 2f);
            int sector = Mathf.Min(20, Mathf.FloorToInt(arc / Step) + 1);
            if (outset <= .60f) return NearHeight(p, angle, outset, sector, arc);
            Vector3 edge = RawPoint(angle, .60f);
            float edgeHeight = NearHeight(edge, angle, .60f, sector, arc);
            float fade = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(.60f, 1.1f, outset));
            float ridges = (Mathf.PerlinNoise(p.x * .055f + 91f, p.z * .055f + 37f) - .5f) * 2.8f
                + (Mathf.PerlinNoise(p.x * .15f + 17f, p.z * .15f + 73f) - .5f) * .55f;
            float h = Mathf.Lerp(edgeHeight, -1.35f + ridges, fade);
            // Only new sectors have newly authored large distant blast bowls.
            for (int i = 4; i <= 20; i++)
                h += Deform(p, Craters(i)[2]) * fade;
            return h;
        }

        private static float NearHeight(Vector3 p, float angle, float outset, int sector, float arc)
        {
            if (sector <= 3) return LegacyHeight(p, sector);
            float t = Mathf.InverseLerp(.09f, .60f, outset);
            float edge = KromkaGlobalMapReliefAuthoring.BoundaryWorldPoint(angle, -.09f, 0f).y;
            float h = Mathf.Lerp(edge - .015f, -1.13f, t)
                + Mathf.Sin(angle * 31f + outset * 17f) * .032f
                + Mathf.Sin(angle * 73f - outset * 29f) * .018f;
            Crater[] craters = Craters(sector);
            h += Deform(p, craters[0]) + Deform(p, craters[1]);
            // Blend to original analytic surfaces at the only two old/new seams.
            if (sector == 4)
                h = Mathf.Lerp(LegacyHeight(p, 3), h,
                    Mathf.SmoothStep(0f, 1f, (arc - 3f * Step) / .035f));
            if (sector == 20)
                h = Mathf.Lerp(LegacyHeight(p, 1), h,
                    Mathf.SmoothStep(0f, 1f, (Mathf.PI * 2f - arc) / .035f));
            return h;
        }

        private static float Deform(Vector3 p, Crater crater)
        {
            Vector3 c = RawPoint(crater.Angle, crater.Outset);
            float d = Vector2.Distance(new Vector2(p.x, p.z), new Vector2(c.x, c.z)) / crater.Radius;
            float bowl = d < .82f ? -crater.Depth * Mathf.Pow(1f - d / .82f, 2f) : 0f;
            float rim = d > .74f && d < 1.28f
                ? crater.Depth * .34f * Mathf.Clamp01(1f - Mathf.Abs(d - 1.01f) / .27f) : 0f;
            return bowl + rim;
        }

        private static Mesh BuildScars(int sector)
        {
            var vertices = new List<Vector3>(); var uv = new List<Vector2>();
            var colors = new List<Color>(); var triangles = new List<int>();
            var normals = new List<Vector3>();
            Mesh near = AssetDatabase.LoadAssetAtPath<Mesh>(MeshRoot + "Kromka_OuterPerimeter_"
                + sector.ToString("00") + ".asset");
            var surfaces = new List<(Vector3[] points, int[] indices, Vector3[] normals)> {
                (near.vertices, near.triangles, near.normals)
            };
            for (int k = sector - 1; k <= sector + 1; k++)
            {
                int n = (k + 19) % 20 + 1;
                Mesh far = AssetDatabase.LoadAssetAtPath<Mesh>(MeshRoot + "Kromka_OuterAshHorizon_"
                    + n.ToString("00") + ".asset");
                surfaces.Add((far.vertices, far.triangles, far.normals));
            }
            foreach (Crater crater in Craters(sector))
            {
                Vector3 centre = RawPoint(crater.Angle, crater.Outset);
                foreach (var surface in surfaces)
                {
                    var remap = new Dictionary<int, int>();
                    float RadiusAt(int index)
                    {
                        Vector3 p = surface.points[index];
                        return Vector2.Distance(new Vector2(p.x, p.z),
                            new Vector2(centre.x, centre.z)) / crater.Radius;
                    }
                    int MapVertex(int index)
                    {
                        if (remap.TryGetValue(index, out int mapped)) return mapped;
                        mapped = vertices.Count;
                        remap.Add(index, mapped);
                        Vector3 p = surface.points[index];
                        float radius = RadiusAt(index);
                        // Copy the actual terrain triangles, not merely points
                        // sampled onto them. Different triangulations intersected
                        // between samples and produced black teeth in Play Mode.
                        p.y += .008f;
                        vertices.Add(p);
                        normals.Add(surface.normals[index]);
                        uv.Add(new Vector2(radius, 0f));
                        float alpha = .96f * (1f - Mathf.SmoothStep(0f, 1f,
                            Mathf.InverseLerp(.72f, 1.28f, radius)));
                        colors.Add(new Color(1f, 1f, 1f, alpha));
                        return mapped;
                    }
                    for (int i = 0; i < surface.indices.Length; i += 3)
                    {
                        int a = surface.indices[i], b = surface.indices[i + 1], c = surface.indices[i + 2];
                        if (RadiusAt(a) > 1.28f && RadiusAt(b) > 1.28f && RadiusAt(c) > 1.28f) continue;
                        triangles.Add(MapVertex(a)); triangles.Add(MapVertex(b)); triangles.Add(MapVertex(c));
                    }
                }
            }
            var mesh = new Mesh { name = "NuclearScorch_" + sector };
            mesh.SetVertices(vertices); mesh.SetUVs(0, uv); mesh.SetColors(colors);
            mesh.SetNormals(normals); mesh.SetTriangles(triangles, 0); mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh NearMesh(Transform outer, int n)
        {
            Transform root = n <= 3 ? outer.Cast<Transform>().First(t =>
                t.name.StartsWith("Iteration" + n.ToString("00") + "_", StringComparison.Ordinal))
                : outer.Find(SectorName(n));
            return root.GetComponentsInChildren<MeshFilter>(true).First(f =>
                f.sharedMesh != null && f.sharedMesh.vertexCount == 825).sharedMesh;
        }

        private static void Validate(Scene scene, int completed)
        {
            Transform outer = FindOuter(scene);
            A.Require(outer.GetComponentsInChildren<Collider>(true).All(c => !c.enabled),
                "Exterior must not intercept movement or map selection.");
            A.Require(outer.Find("DistantAshHorizon_AUTHORED").childCount == 20, "Horizon ring incomplete.");
            Transform horizon = outer.Find("DistantAshHorizon_AUTHORED");
            for (int n = 1; n <= 20; n++)
            {
                Vector3[] current = horizon.Find("AshHorizon_" + n.ToString("00"))
                    .GetComponent<MeshFilter>().sharedMesh.vertices;
                Vector3[] next = horizon.Find("AshHorizon_" + (n % 20 + 1).ToString("00"))
                    .GetComponent<MeshFilter>().sharedMesh.vertices;
                for (int row = 0; row <= 48; row++)
                    A.Require(Vector3.Distance(current[row * 33 + 32], next[row * 33]) < .003f,
                        "Distant horizon seam at sector " + n + ", row " + row);
                if (n <= completed)
                {
                    Vector3[] near = NearMesh(outer, n).vertices;
                    for (int i = 0; i <= Angles; i++)
                        A.Require(Vector3.Distance(near[24 * 33 + i], current[i]) < .003f,
                            "Near/distant terrain separation at sector " + n);
                }
            }
            for (int n = 4; n <= completed; n++)
            {
                Transform root = outer.Find(SectorName(n));
                A.Require(root != null, "Missing iteration " + n);
                Mesh current = NearMesh(outer, n), previous = NearMesh(outer, n - 1);
                // Both original and new near meshes use radial-major arrays.
                for (int row = 0; row <= Rows; row++)
                {
                    Vector3 previousEdge = previous.vertices[row * 33 + 32];
                    A.Require(Vector3.Distance(current.vertices[row * 33], previousEdge) < .003f,
                        "Exterior crack at sector " + n + ", row " + row);
                }
                foreach (MeshFilter filter in root.GetComponentsInChildren<MeshFilter>(true))
                {
                    A.Require(filter.sharedMesh != null && AssetDatabase.Contains(filter.sharedMesh),
                        "Missing persisted exterior mesh.");
                    foreach (Vector3 vertex in filter.sharedMesh.vertices)
                    {
                        Vector3 p = filter.transform.TransformPoint(vertex);
                        float angle = Mathf.Atan2(p.z / 14.65f, p.x / 18.65f);
                        Vector3 edge = RawPoint(angle);
                        float radius = new Vector2(p.x / 18.65f, p.z / 14.65f).magnitude;
                        float edgeRadius = new Vector2(edge.x / 18.65f, edge.z / 14.65f).magnitude;
                        A.Require(radius > edgeRadius + .025f,
                            "Exterior model intrudes on playable map: " + filter.name);
                    }
                }
                A.Require(root.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    "Source LOD may silently hide exterior props.");
            }
            if (completed == 20)
                for (int row = 0; row <= Rows; row++)
                    A.Require(Vector3.Distance(NearMesh(outer, 20).vertices[row * 33 + 32],
                        NearMesh(outer, 1).vertices[row * 33]) < .003f, "Closing perimeter seam is open.");
        }
    }
}
#endif
