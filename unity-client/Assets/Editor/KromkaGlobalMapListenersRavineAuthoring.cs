#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Environment-model iteration 12/20. The Listeners' Ravine is a natural
    /// MEP karst landmark: a broken double wall, paired echo pillars, collapsed
    /// cave chambers and dark listening basins around the canonical lair node.
    /// </summary>
    internal static class KromkaGlobalMapListenersRavineAuthoring
    {
        internal const int ModelIteration = 12;
        internal const int ModelIterationCount = 20;
        private const int ExpectedCanyonWallCount = 22;
        private const int ExpectedEchoPillarCount = 24;
        private const int ExpectedCollapseCount = 18;
        private const int ExpectedBridgeCount = 4;
        private const int ExpectedListeningBasinCount = 3;
        private const int BasinSegments = 12;
        private const float SouthMouthOffsetX = -8f;
        private const float SouthMouthOffsetY = 6f;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string MepCaveRoot =
            "Assets/MEP/MEP_Environment/MEP_Cave/Cave_Parts/Prefabs/";
        private const string MepCaveSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Cave/Materials/MEP_CaveWall_Dif.mat";
        private const string WallMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ListenersRavine_Walls_MEP.mat";
        private const string PillarMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ListenersRavine_EchoPillars_MEP.mat";
        private const string CollapseMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ListenersRavine_Collapse_MEP.mat";
        private const string BasinLipMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ListenersRavine_BasinLip.mat";
        private const string BasinDarkMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_ListenersRavine_BasinDark.mat";

        private static readonly string[] WallSources =
        {
            MepCaveRoot + "MEP_C_Wall_01_N.prefab",
            MepCaveRoot + "MEP_C_Wall_02_N.prefab",
            MepCaveRoot + "MEP_C_Wall_03_N.prefab",
            MepCaveRoot + "MEP_C_Wall_04_N.prefab",
            MepCaveRoot + "MEP_C_Wall_05_N.prefab",
            MepCaveRoot + "MEP_C_Wall_06_N.prefab",
            MepCaveRoot + "MEP_C_Wall_07_N.prefab",
            MepCaveRoot + "MEP_C_Transition_01_N.prefab",
            MepCaveRoot + "MEP_C_Transition_02_N.prefab",
            MepCaveRoot + "MEP_C_Entrance_01_N.prefab"
        };

        private static readonly string[] PillarSources =
        {
            MepCaveRoot + "MEP_C_Stalagmite_01_N.prefab",
            MepCaveRoot + "MEP_C_Stalagmite_02_N.prefab",
            MepCaveRoot + "MEP_C_Stalagmite_03_N.prefab",
            MepCaveRoot + "MEP_C_Stalagmite_04_N.prefab",
            MepCaveRoot + "MEP_C_Stalagmite_05_N.prefab",
            MepCaveRoot + "MEP_C_Stalagmite_06_N.prefab"
        };

        private static readonly string[] CollapseSources =
        {
            MepCaveRoot + "MEP_C_Boulder_01_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_02_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_03_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_04_N.prefab",
            MepCaveRoot + "MEP_C_Boulder_Grp_01_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_01_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_02_N.prefab",
            MepCaveRoot + "MEP_C_ClusterStone_03_N.prefab",
            MepCaveRoot + "MEP_C_ConcaveStone_N.prefab"
        };

        private static readonly string[] BridgeSources =
        {
            MepCaveRoot + "MEP_C_Block_01_N.prefab",
            MepCaveRoot + "MEP_C_Block_02_N.prefab",
            MepCaveRoot + "MEP_C_Edge_01_N.prefab",
            MepCaveRoot + "MEP_C_Rock_01_N.prefab"
        };

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string Zone;
            public readonly string AssetPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string zone, string assetPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed)
            {
                Name = name;
                Zone = zone;
                AssetPath = assetPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        internal static void Compose(Transform parent)
        {
            Material walls = BuildMepMaterial(WallMaterialPath,
                "Kromka_ListenersRavine_Walls_MEP",
                new Color(0.78f, 0.78f, 0.68f, 1f));
            Material pillars = BuildMepMaterial(PillarMaterialPath,
                "Kromka_ListenersRavine_EchoPillars_MEP",
                new Color(0.65f, 0.70f, 0.65f, 1f));
            Material collapse = BuildMepMaterial(CollapseMaterialPath,
                "Kromka_ListenersRavine_Collapse_MEP",
                new Color(0.68f, 0.66f, 0.57f, 1f));
            Material basinLip = BuildSolidMaterial(BasinLipMaterialPath,
                "Kromka_ListenersRavine_BasinLip",
                new Color(0.52f, 0.61f, 0.58f, 1f), 0.05f, 0.12f);
            Material basinDark = BuildSolidMaterial(BasinDarkMaterialPath,
                "Kromka_ListenersRavine_BasinDark",
                new Color(0.035f, 0.055f, 0.052f, 1f), 0.08f, 0.32f);

            Placement[] canyonWalls = BuildCanyonWalls();
            Placement[] echoPillars = BuildEchoPillars();
            Placement[] collapses = BuildCollapses();
            Placement[] bridges = BuildBridges();

            Transform root = Child(parent, "ListenersRavine_NaturalKarst_MEP");
            PlaceSet(canyonWalls, Child(root, "DoubleCanyonWalls_EDITABLE"), walls);
            PlaceSet(echoPillars, Child(root, "PairedEchoPillars_EDITABLE"), pillars);
            PlaceSet(collapses, Child(root, "CollapsedKarstChambers_EDITABLE"), collapse);
            PlaceSet(bridges, Child(root, "NaturalStoneBridges_EDITABLE"), walls);
            BuildListeningBasins(root, basinLip, basinDark);

            Child(parent, "ListenersRavineNode_332_83_REFERENCE");
            Child(parent, "DirectMEPCanyonWalls_22_REFERENCE");
            Child(parent, "DirectMEPEchoPillars_24_REFERENCE");
            Child(parent, "DirectMEPCollapsePieces_18_REFERENCE");
            Child(parent, "DirectMEPNaturalBridges_4_REFERENCE");
            Child(parent, "ListeningBasins_3_REFERENCE");
            Child(parent, "ListenerKarstRavineProfile_REFERENCE");
            Child(parent, "PersistentListenersRavineGeometry_REFERENCE");
            Child(parent, "ModelIteration_12_of_20");
        }

        internal static void ValidateIteration12()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 12 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "ListenersRavineNode_332_83_REFERENCE",
                "DirectMEPCanyonWalls_22_REFERENCE",
                "DirectMEPEchoPillars_24_REFERENCE",
                "DirectMEPCollapsePieces_18_REFERENCE",
                "DirectMEPNaturalBridges_4_REFERENCE",
                "ListeningBasins_3_REFERENCE",
                "ListenerKarstRavineProfile_REFERENCE",
                "PersistentListenersRavineGeometry_REFERENCE",
                "ModelIteration_12_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");

            Placement[] canyonWalls = BuildCanyonWalls();
            Placement[] echoPillars = BuildEchoPillars();
            Placement[] collapses = BuildCollapses();
            Placement[] bridges = BuildBridges();
            Require(canyonWalls.Length == ExpectedCanyonWallCount,
                "twenty-two canyon-wall pieces are required");
            Require(echoPillars.Length == ExpectedEchoPillarCount,
                "twenty-four paired echo pillars are required");
            Require(collapses.Length == ExpectedCollapseCount,
                "eighteen collapsed-karst pieces are required");
            Require(bridges.Length == ExpectedBridgeCount,
                "four natural bridge pieces are required");

            Transform ravine = FindDescendant(root, "ListenersRavine_NaturalKarst_MEP");
            Require(ravine != null, "Listeners' Ravine model root is missing");
            ValidateSet(FindDescendant(ravine, "DoubleCanyonWalls_EDITABLE"),
                canyonWalls, RequireMaterial(WallMaterialPath), WallSources);
            ValidateSet(FindDescendant(ravine, "PairedEchoPillars_EDITABLE"),
                echoPillars, RequireMaterial(PillarMaterialPath), PillarSources);
            ValidateSet(FindDescendant(ravine, "CollapsedKarstChambers_EDITABLE"),
                collapses, RequireMaterial(CollapseMaterialPath), CollapseSources);
            ValidateSet(FindDescendant(ravine, "NaturalStoneBridges_EDITABLE"),
                bridges, RequireMaterial(WallMaterialPath), BridgeSources);

            Transform basins = FindDescendant(ravine,
                "ListeningBasins_DarkKarstWindows_LANDMARK");
            Require(basins != null && basins.childCount == ExpectedListeningBasinCount,
                "three listening basins are required");
            Require(basins.GetComponentsInChildren<Renderer>(true).Length
                    == ExpectedListeningBasinCount * (BasinSegments + 1),
                "listening-basin silhouettes are incomplete");
            Require(ravine.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "Listeners' Ravine geometry can obstruct strategic-map interaction");
            Require(ravine.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "Listeners' Ravine geometry can disappear with camera distance");

            Debug.Log("[KROMKA MODELS 60%] PASS: the canonical Listeners' Ravine "
                + "at 332x83 uses twenty-two direct MEP canyon walls, twenty-four "
                + "paired echo pillars, eighteen collapse pieces, two natural bridge "
                + "crossings and three persistent dark listening basins.");
        }

        private static Placement[] BuildCanyonWalls()
        {
            var placements = new List<Placement>(ExpectedCanyonWallCount);
            for (int step = 0; step < 10; step++)
            {
                float mapY = 61f + step * 4.8f;
                float centreX = 332f + Mathf.Sin(step * 0.66f) * 2.2f;
                float halfWidth = 7.1f + Mathf.Cos(step * 0.81f) * 0.75f;
                string zone = ZoneFor(mapY);
                string leftSource = WallSources[step % 9];
                string rightSource = WallSources[(step + 4) % 9];
                placements.Add(new Placement("RavineWall_Left_" + step.ToString("00"),
                    zone, leftSource, centreX - halfWidth, mapY,
                    0.62f + (step % 3) * 0.065f, 0.52f + (step % 2) * 0.09f,
                    66f + step * 7f, 0.050f));
                placements.Add(new Placement("RavineWall_Right_" + step.ToString("00"),
                    zone, rightSource, centreX + halfWidth, mapY + 0.8f,
                    0.64f + ((step + 1) % 3) * 0.065f, 0.54f + ((step + 1) % 2) * 0.09f,
                    -63f - step * 6f, 0.052f));
            }
            placements.Add(new Placement("Ravine_CaveMouthSouth", "SouthMouth",
                WallSources[9], 331f, 58f, 1.12f, 0.82f, 177f, 0.075f));
            placements.Add(new Placement("Ravine_CaveMouthNorth", "NorthReach",
                WallSources[9], 335f, 107f, 1.06f, 0.78f, -4f, 0.072f));
            return placements.ToArray();
        }

        private static Placement[] BuildEchoPillars()
        {
            var placements = new List<Placement>(ExpectedEchoPillarCount);
            for (int pair = 0; pair < 12; pair++)
            {
                float mapY = 64f + pair * 3.5f;
                float centreX = 332f + Mathf.Sin(pair * 0.72f) * 1.75f;
                float gap = 2.25f + (pair % 4) * 0.38f;
                string zone = ZoneFor(mapY);
                for (int side = 0; side < 2; side++)
                {
                    int index = pair * 2 + side;
                    float mapX = centreX + (side == 0 ? -gap : gap);
                    placements.Add(new Placement("EchoPillar_" + index.ToString("00"),
                        zone, PillarSources[index % PillarSources.Length], mapX,
                        mapY + (side == 0 ? -0.35f : 0.35f),
                        0.28f + (index % 4) * 0.045f,
                        0.58f + (index % 5) * 0.07f,
                        index * 29f, 0.028f));
                }
            }
            return placements.ToArray();
        }

        private static Placement[] BuildCollapses()
        {
            Vector2[] centres =
            {
                new Vector2(319f, 69f),
                new Vector2(346f, 83f),
                new Vector2(322f, 99f)
            };
            var placements = new List<Placement>(ExpectedCollapseCount);
            for (int cluster = 0; cluster < centres.Length; cluster++)
            {
                for (int piece = 0; piece < 6; piece++)
                {
                    int index = cluster * 6 + piece;
                    float angle = (piece * 61f + cluster * 23f) * Mathf.Deg2Rad;
                    float radius = 2.1f + (piece % 3) * 1.05f;
                    float mapX = centres[cluster].x + Mathf.Cos(angle) * radius;
                    float mapY = centres[cluster].y + Mathf.Sin(angle) * radius;
                    placements.Add(new Placement(
                        "KarstCollapse_" + cluster + "_" + piece,
                        "CollapseChamber_" + cluster,
                        CollapseSources[index % CollapseSources.Length], mapX, mapY,
                        0.42f + (index % 4) * 0.035f + (piece % 3) * 0.09f,
                        0.30f + (index % 3) * 0.07f,
                        index * 37f, 0.034f));
                }
            }
            return placements.ToArray();
        }

        private static Placement[] BuildBridges()
        {
            return new[]
            {
                new Placement("SoundBridgeSouth_WestSlab", "SoundBridgeSouth",
                    BridgeSources[0], 330f, 75f, 0.92f, 0.34f, 82f, 0.045f),
                new Placement("SoundBridgeSouth_EastSlab", "SoundBridgeSouth",
                    BridgeSources[1], 334f, 75f, 0.90f, 0.34f, 97f, 0.045f),
                new Placement("SoundBridgeNorth_WestEdge", "SoundBridgeNorth",
                    BridgeSources[2], 331f, 92f, 0.88f, 0.32f, 78f, 0.042f),
                new Placement("SoundBridgeNorth_EastRock", "SoundBridgeNorth",
                    BridgeSources[3], 335f, 92f, 0.86f, 0.34f, 101f, 0.044f)
            };
        }

        private static void PlaceSet(Placement[] placements, Transform root,
                                     Material material)
        {
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Transform zone = root.Find(placement.Zone) ?? Child(root, placement.Zone);
                GameObject instance =
                    KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                        placement.AssetPath, placement.Name, zone,
                        AdjustedMapX(placement), AdjustedMapY(placement),
                        placement.Footprint,
                        placement.MaximumHeight, placement.Yaw, placement.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                {
                    renderers[rendererIndex].sharedMaterials = Enumerable.Repeat(material,
                        renderers[rendererIndex].sharedMaterials.Length).ToArray();
                    renderers[rendererIndex].receiveShadows = true;
                }
            }
        }

        private static void ValidateSet(Transform root, Placement[] placements,
                                        Material material, string[] expectedSources)
        {
            Require(root != null, "a Listeners' Ravine placement root is missing");
            var sources = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Require(placement.MapX >= 315f && placement.MapX <= 350f
                        && placement.MapY >= 58f && placement.MapY <= 107f,
                    placement.Name + " is outside the reviewed Listeners' Ravine");
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath,
                    placement.Name + " lost its direct MEP source link");
                sources.Add(source);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials
                        .All(shared => shared == material)),
                    placement.Name + " lost its reviewed material");
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    AdjustedMapX(placement), AdjustedMapY(placement));
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.04f,
                    placement.Name + " footprint drifted from authored scale");
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is not grounded on the authored relief");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for the strategic-map scale");
            }
            Require(sources.SetEquals(expectedSources),
                "a reviewed Listeners' Ravine MEP source set is incomplete");
        }

        private static void BuildListeningBasins(Transform parent, Material lip,
                                                 Material dark)
        {
            Transform root = Child(parent,
                "ListeningBasins_DarkKarstWindows_LANDMARK");
            Vector2[] centres =
            {
                new Vector2(319f, 69f),
                new Vector2(346f, 83f),
                new Vector2(322f, 99f)
            };
            for (int basinIndex = 0; basinIndex < centres.Length; basinIndex++)
            {
                Transform basin = Child(root, "ListeningBasin_" + basinIndex);
                basin.position = MapToWorld(centres[basinIndex].x, centres[basinIndex].y)
                    + new Vector3(0f, 0.012f, 0f);
                float radius = 0.56f + basinIndex * 0.055f;
                BuildPrimitive("SoundlessFloor", basin, PrimitiveType.Cylinder,
                    new Vector3(0f, -0.012f, 0f),
                    new Vector3(radius * 0.78f, 0.012f, radius * 0.78f),
                    Quaternion.identity, dark);
                float segmentLength = 2f * Mathf.PI * radius / BasinSegments * 0.82f;
                for (int segment = 0; segment < BasinSegments; segment++)
                {
                    float angle = segment * (360f / BasinSegments)
                        + basinIndex * 7f;
                    float radians = angle * Mathf.Deg2Rad;
                    BuildPrimitive("ChalkLip_" + segment.ToString("00"), basin,
                        PrimitiveType.Cube,
                        new Vector3(Mathf.Cos(radians) * radius,
                            0.012f + (segment % 3) * 0.008f,
                            Mathf.Sin(radians) * radius),
                        new Vector3(segmentLength, 0.045f, 0.075f),
                        Quaternion.Euler(0f, -angle + 90f,
                            segment % 2 == 0 ? 3f : -3f), lip);
                }
            }
        }

        private static void BuildPrimitive(string name, Transform parent,
                                           PrimitiveType type, Vector3 localPosition,
                                           Vector3 localScale, Quaternion localRotation,
                                           Material material)
        {
            GameObject primitive = GameObject.CreatePrimitive(type);
            primitive.name = name;
            primitive.transform.SetParent(parent, false);
            primitive.transform.localPosition = localPosition;
            primitive.transform.localScale = localScale;
            primitive.transform.localRotation = localRotation;
            Collider collider = primitive.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            Renderer renderer = primitive.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
            GameObjectUtility.SetStaticEditorFlags(primitive,
                StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Material BuildMepMaterial(string path, string name, Color tint)
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(MepCaveSourceMaterial);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException(
                    "MEP cave material is unavailable for Listeners' Ravine");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = name;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildSolidMaterial(string path, string name, Color color,
                                                   float metallic, float smoothness)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(shader);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.shader = shader;
            material.name = name;
            material.SetColor("_BaseColor", color);
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null && material.shader.isSupported,
                "material is missing or unsupported: " + path);
            return material;
        }

        private static string ZoneFor(float mapY)
        {
            if (mapY < 75f) return "SouthMouth";
            return mapY > 92f ? "NorthReach" : "DeepCut";
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static float AdjustedMapX(Placement placement)
        {
            return placement.Zone == "SouthMouth"
                ? placement.MapX + SouthMouthOffsetX : placement.MapX;
        }

        private static float AdjustedMapY(Placement placement)
        {
            return placement.Zone == "SouthMouth"
                ? placement.MapY + SouthMouthOffsetY : placement.MapY;
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root == null) return null;
            Transform[] descendants = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < descendants.Length; i++)
                if (descendants[i].name == name) return descendants[i];
            return null;
        }

        private static Transform Child(Transform parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(
                "Kromka model iteration 12 validation failed: " + message);
        }
    }
}
#endif
