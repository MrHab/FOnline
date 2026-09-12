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
    /// Environment-model iteration 20/20. Six restrained roadside service nodes
    /// give the route network a recognisable post-Soviet civic layer. The pass
    /// also performs the final global material, grounding and optimization audit
    /// across every completed environment-model iteration.
    /// </summary>
    internal static class KromkaGlobalMapRoadsideFinalAuthoring
    {
        internal const int ModelIteration = 20;
        internal const int ModelIterationCount = 20;
        private const int ExpectedStopCount = 6;
        private const int ExpectedShelterCount = 6;
        private const int ExpectedBenchCount = 6;
        private const int ExpectedFenceCount = 12;
        private const int MarkerRendererCount = 7;
        private const int GlobalRendererBudget = 5000;
        private const int GlobalMaterialBudget = 160;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string BuildingRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string MepBuildingSourceMaterial =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/MEP_Shacks/Materials/MEP_Wall_Roof_Dif.mat";
        private const string ShelterMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Roadside_Shelters_MEP.mat";
        private const string FurnitureMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Roadside_Furniture_MEP.mat";
        private const string ConcreteMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Roadside_Concrete.mat";
        private const string PoleMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Roadside_Poles.mat";
        private const string SignMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Roadside_FadedBlue.mat";
        private const string StripeMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Roadside_AmberStripe.mat";
        private const string LampMaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_Roadside_Lamp.mat";

        private static readonly string[] ShelterSources =
        {
            BuildingRoot + "MEP_Shack_Broken_N.prefab",
            BuildingRoot + "MEP_Shack_01_N.prefab",
            BuildingRoot + "MEP_Shack_02_N.prefab"
        };

        private static readonly string[] BenchSources =
        {
            BuildingRoot + "MEP_Bench_N.prefab"
        };

        private static readonly string[] FenceSources =
        {
            BuildingRoot + "MEP_Fence_01_N.prefab",
            BuildingRoot + "MEP_Fence_02_N.prefab",
            BuildingRoot + "MEP_Fence_03_N.prefab"
        };

        private readonly struct Stop
        {
            public readonly string Name;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Yaw;

            public Stop(string name, float mapX, float mapY, float yaw)
            {
                Name = name;
                MapX = mapX;
                MapY = mapY;
                Yaw = yaw;
            }
        }

        private readonly struct Placement
        {
            public readonly string Name;
            public readonly string StopName;
            public readonly string AssetPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public Placement(string name, string stopName, string assetPath,
                             float mapX, float mapY, float footprint,
                             float maximumHeight, float yaw, float embed)
            {
                Name = name;
                StopName = stopName;
                AssetPath = assetPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly Stop[] Stops =
        {
            new Stop("WestTractStop", 105f, 159f, 10f),
            new Stop("TesmaDispatch", 183f, 242f, 2f),
            new Stop("ZeroKilometreShelter", 181f, 115f, -35f),
            new Stop("EastTractStop", 247f, 155f, -44f),
            new Stop("OreRailFlagstop", 148f, 214f, 7f),
            new Stop("SouthSluiceStop", 206f, 248f, -5f)
        };

        private static readonly Placement[] Shelters =
        {
            new Placement("WestTract_Shelter", "WestTractStop", ShelterSources[0], 98f, 152f, 0.55f, 0.44f, 10f, 0.025f),
            new Placement("Tesma_Shelter", "TesmaDispatch", ShelterSources[1], 180f, 235f, 0.55f, 0.44f, 2f, 0.025f),
            new Placement("ZeroKm_Shelter", "ZeroKilometreShelter", ShelterSources[2], 174f, 108f, 0.55f, 0.44f, -35f, 0.025f),
            new Placement("EastTract_Shelter", "EastTractStop", ShelterSources[0], 240f, 148f, 0.55f, 0.44f, -44f, 0.025f),
            new Placement("OreRail_Shelter", "OreRailFlagstop", ShelterSources[1], 141f, 207f, 0.55f, 0.44f, 7f, 0.025f),
            new Placement("SouthSluice_Shelter", "SouthSluiceStop", ShelterSources[2], 199f, 241f, 0.55f, 0.44f, -5f, 0.025f)
        };

        private static readonly Placement[] Benches =
        {
            new Placement("WestTract_Bench", "WestTractStop", BenchSources[0], 102f, 155f, 0.24f, 0.20f, 10f, 0.020f),
            new Placement("Tesma_Bench", "TesmaDispatch", BenchSources[0], 184f, 238f, 0.24f, 0.20f, 2f, 0.020f),
            new Placement("ZeroKm_Bench", "ZeroKilometreShelter", BenchSources[0], 178f, 111f, 0.24f, 0.20f, -35f, 0.020f),
            new Placement("EastTract_Bench", "EastTractStop", BenchSources[0], 244f, 151f, 0.24f, 0.20f, -44f, 0.020f),
            new Placement("OreRail_Bench", "OreRailFlagstop", BenchSources[0], 145f, 210f, 0.24f, 0.20f, 7f, 0.020f),
            new Placement("SouthSluice_Bench", "SouthSluiceStop", BenchSources[0], 203f, 244f, 0.24f, 0.20f, -5f, 0.020f)
        };

        private static readonly Placement[] Fences =
        {
            new Placement("WestTract_FenceA", "WestTractStop", FenceSources[0], 94f, 157f, 0.36f, 0.26f, 10f, 0.025f),
            new Placement("WestTract_FenceB", "WestTractStop", FenceSources[1], 99f, 162f, 0.36f, 0.26f, 100f, 0.025f),
            new Placement("Tesma_FenceA", "TesmaDispatch", FenceSources[1], 176f, 240f, 0.36f, 0.26f, 2f, 0.025f),
            new Placement("Tesma_FenceB", "TesmaDispatch", FenceSources[2], 181f, 245f, 0.36f, 0.26f, 92f, 0.025f),
            new Placement("ZeroKm_FenceA", "ZeroKilometreShelter", FenceSources[2], 170f, 113f, 0.36f, 0.26f, -35f, 0.025f),
            new Placement("ZeroKm_FenceB", "ZeroKilometreShelter", FenceSources[0], 175f, 118f, 0.36f, 0.26f, 55f, 0.025f),
            new Placement("EastTract_FenceA", "EastTractStop", FenceSources[0], 236f, 153f, 0.36f, 0.26f, -44f, 0.025f),
            new Placement("EastTract_FenceB", "EastTractStop", FenceSources[2], 241f, 158f, 0.36f, 0.26f, 46f, 0.025f),
            new Placement("OreRail_FenceA", "OreRailFlagstop", FenceSources[1], 137f, 212f, 0.36f, 0.26f, 7f, 0.025f),
            new Placement("OreRail_FenceB", "OreRailFlagstop", FenceSources[0], 142f, 217f, 0.36f, 0.26f, 97f, 0.025f),
            // Keep the stop furniture on the dry shoulders. These two fences
            // used to overlap the Tesma because the clearance audit treated
            // every object below a parent containing "Sluice" as hydraulic.
            new Placement("SouthSluice_FenceA", "SouthSluiceStop", FenceSources[2], 188f, 246f, 0.36f, 0.26f, -5f, 0.025f),
            new Placement("SouthSluice_FenceB", "SouthSluiceStop", FenceSources[1], 202f, 251f, 0.36f, 0.26f, 85f, 0.025f)
        };

        internal static void Compose(Transform parent)
        {
            Material shelters = BuildMepMaterial(ShelterMaterialPath,
                "Kromka_Roadside_Shelters_MEP",
                new Color(0.33f, 0.34f, 0.30f, 1f));
            Material furniture = BuildMepMaterial(FurnitureMaterialPath,
                "Kromka_Roadside_Furniture_MEP",
                new Color(0.24f, 0.20f, 0.16f, 1f));
            Material concrete = BuildSolidMaterial(ConcreteMaterialPath,
                "Kromka_Roadside_Concrete",
                new Color(0.39f, 0.39f, 0.34f, 1f), 0.04f, 0.14f);
            Material poles = BuildSolidMaterial(PoleMaterialPath,
                "Kromka_Roadside_Poles",
                new Color(0.13f, 0.15f, 0.14f, 1f), 0.52f, 0.19f);
            Material signs = BuildSolidMaterial(SignMaterialPath,
                "Kromka_Roadside_FadedBlue",
                new Color(0.12f, 0.28f, 0.30f, 1f), 0.24f, 0.22f);
            Material stripes = BuildEmissiveMaterial(StripeMaterialPath,
                "Kromka_Roadside_AmberStripe",
                new Color(0.42f, 0.18f, 0.018f, 1f),
                new Color(1.10f, 0.25f, 0.018f, 1f));
            Material lamps = BuildEmissiveMaterial(LampMaterialPath,
                "Kromka_Roadside_Lamp",
                new Color(0.44f, 0.38f, 0.22f, 1f),
                new Color(1.65f, 1.02f, 0.35f, 1f));

            Transform root = Child(parent,
                "PostSovietRoadsideNodes_ModelPass20_DirectMEP");
            PlaceSet(Shelters, Child(root, "DirectMEPRoadsideShelters_EDITABLE"),
                shelters);
            PlaceSet(Benches, Child(root, "DirectMEPRoadsideBenches_EDITABLE"),
                furniture);
            PlaceSet(Fences, Child(root, "DirectMEPRoadsideFences_EDITABLE"),
                furniture);
            BuildMarkers(Child(root, "RoadsideSignAssemblies_LANDMARKS"),
                concrete, poles, signs, stripes, lamps);

            Child(parent, "SovietRoadsideStops_6_REFERENCE");
            Child(parent, "DirectMEPRoadsideShelters_6_REFERENCE");
            Child(parent, "DirectMEPRoadsideBenches_6_REFERENCE");
            Child(parent, "DirectMEPRoadsideFences_12_REFERENCE");
            Child(parent, "RoadsideSignAssemblies_6_REFERENCE");
            Child(parent, "AllModelPasses_20_REFERENCE");
            Child(parent, "GlobalModelMaterialAudit_REFERENCE");
            Child(parent, "GlobalModelOptimizationAudit_REFERENCE");
            Child(parent, "ModelIteration_20_of_20");
        }

        internal static void ValidateIteration20()
        {
            GameObject rootObject = GameObject.Find(
                "EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 20 root is missing from the global map");
            Transform root = rootObject.transform;
            string[] markers =
            {
                "SovietRoadsideStops_6_REFERENCE",
                "DirectMEPRoadsideShelters_6_REFERENCE",
                "DirectMEPRoadsideBenches_6_REFERENCE",
                "DirectMEPRoadsideFences_12_REFERENCE",
                "RoadsideSignAssemblies_6_REFERENCE",
                "AllModelPasses_20_REFERENCE",
                "GlobalModelMaterialAudit_REFERENCE",
                "GlobalModelOptimizationAudit_REFERENCE",
                "ModelIteration_20_of_20"
            };
            for (int i = 0; i < markers.Length; i++)
                Require(root.Find(markers[i]) != null, markers[i] + " is missing");
            for (int iteration = 1; iteration <= ModelIterationCount; iteration++)
            {
                string marker = "ModelIteration_" + iteration.ToString("00")
                    + "_of_20";
                Require(root.Find(marker) != null,
                    "completed model-pass marker is missing: " + marker);
            }

            Require(Stops.Length == ExpectedStopCount,
                "six roadside service nodes are required");
            Require(Shelters.Length == ExpectedShelterCount,
                "six direct-MEP shelters are required");
            Require(Benches.Length == ExpectedBenchCount,
                "six direct-MEP benches are required");
            Require(Fences.Length == ExpectedFenceCount,
                "twelve direct-MEP fence fragments are required");

            Transform roadside = FindDescendant(root,
                "PostSovietRoadsideNodes_ModelPass20_DirectMEP");
            Require(roadside != null, "roadside-node hierarchy is missing");
            ValidateSet(FindDescendant(roadside,
                    "DirectMEPRoadsideShelters_EDITABLE"),
                Shelters, RequireMaterial(ShelterMaterialPath), ShelterSources,
                "roadside shelters");
            ValidateSet(FindDescendant(roadside,
                    "DirectMEPRoadsideBenches_EDITABLE"),
                Benches, RequireMaterial(FurnitureMaterialPath), BenchSources,
                "roadside benches");
            ValidateSet(FindDescendant(roadside,
                    "DirectMEPRoadsideFences_EDITABLE"),
                Fences, RequireMaterial(FurnitureMaterialPath), FenceSources,
                "roadside fence fragments");
            ValidateMarkers(FindDescendant(roadside,
                "RoadsideSignAssemblies_LANDMARKS"));
            ValidateGlobalModelAudit(root);
        }

        private static void ValidateGlobalModelAudit(Transform root)
        {
            Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            Require(renderers.Length > 0 && renderers.Length <= GlobalRendererBudget,
                "global environment renderer budget exceeded: "
                + renderers.Length + " / " + GlobalRendererBudget);
            Require(renderers.All(renderer => renderer.sharedMaterials.Length > 0
                    && renderer.sharedMaterials.All(material => material != null
                        && material.shader != null && material.shader.isSupported)),
                "a global environment renderer has a missing or unsupported material");
            int materialCount = renderers.SelectMany(renderer =>
                    renderer.sharedMaterials).Where(material => material != null)
                .Distinct().Count();
            Require(materialCount <= GlobalMaterialBudget,
                "global environment material budget exceeded: "
                + materialCount + " / " + GlobalMaterialBudget);
            Require(root.GetComponentsInChildren<Collider>(true)
                    .All(collider => !collider.enabled),
                "an environment model still owns an active interaction collider");
            Require(root.GetComponentsInChildren<LODGroup>(true).Length == 0,
                "an environment model can still disappear with camera distance");
            Require(renderers.All(renderer => renderer.gameObject.isStatic),
                "an environment renderer is missing static batching flags");
            Require(renderers.All(renderer => IsFinite(renderer.bounds.center)
                    && IsFinite(renderer.bounds.size)
                    && renderer.bounds.size.sqrMagnitude > 0.0000001f),
                "an environment renderer has invalid or degenerate bounds");

            Debug.Log("[KROMKA MODELS 100%] PASS: six restrained post-Soviet "
                + "roadside nodes add six direct-MEP shelters, six benches, twelve "
                + "fence fragments and six grounded sign assemblies. All twenty "
                + "model passes are present; " + renderers.Length + " enabled "
                + "renderers and " + materialCount + " materials remain inside "
                + "the reviewed static-map budgets with no active colliders or "
                + "distance-dependent LOD groups.");
        }

        internal static void RefreshMarkerContact()
        {
            Transform root = GameObject.Find("RoadsideSignAssemblies_LANDMARKS").transform;
            while (root.childCount > 0) UnityEngine.Object.DestroyImmediate(root.GetChild(0).gameObject);
            BuildMarkers(root, RequireMaterial(ConcreteMaterialPath), RequireMaterial(PoleMaterialPath),
                RequireMaterial(SignMaterialPath), RequireMaterial(StripeMaterialPath), RequireMaterial(LampMaterialPath));
            ValidateMarkers(root);
        }

        private static void BuildMarkers(Transform root, Material concrete,
                                         Material poles, Material signs,
                                         Material stripes, Material lamps)
        {
            for (int i = 0; i < Stops.Length; i++)
            {
                Stop stop = Stops[i];
                Transform group = Child(root, stop.Name);
                Quaternion rotation = Quaternion.Euler(0f, stop.Yaw, 0f);
                Vector3 centre = MapToWorld(stop.MapX, stop.MapY);
                float terrain = centre.y;
                BuildPrimitive("ConcretePlinth", group, PrimitiveType.Cube,
                    new Vector3(centre.x, terrain + 0.04f, centre.z),
                    new Vector3(0.16f, 0.08f, 0.14f), rotation, concrete);
                BuildPrimitive("SignPole", group, PrimitiveType.Cylinder,
                    new Vector3(centre.x, terrain + 0.38f, centre.z),
                    new Vector3(0.026f, 0.30f, 0.026f),
                    Quaternion.identity, poles);
                BuildPrimitive("FadedRouteSign", group, PrimitiveType.Cube,
                    new Vector3(centre.x, terrain + 0.71f, centre.z),
                    new Vector3(0.38f, 0.18f, 0.035f), rotation, signs);
                Vector3 stripePosition = new Vector3(centre.x, terrain + 0.71f,
                    centre.z) + rotation * new Vector3(0f, 0f, -0.024f);
                BuildPrimitive("AmberRouteStripe", group, PrimitiveType.Cube,
                    stripePosition, new Vector3(0.27f, 0.026f, 0.012f),
                    rotation, stripes);
                BuildPrimitive("ServiceLamp", group, PrimitiveType.Sphere,
                    new Vector3(centre.x, terrain + 0.8175f, centre.z),
                    new Vector3(0.055f, 0.045f, 0.055f),
                    Quaternion.identity, lamps);
                for (int side = 0; side < 2; side++)
                {
                    float sign = side == 0 ? -1f : 1f;
                    Vector3 bollard = centre + rotation
                        * new Vector3(sign * 0.28f, 0f, 0.05f);
                    bollard.y = HeightAtWorld(bollard.x, bollard.z) + 0.115f;
                    BuildPrimitive("RoadBollard_" + side, group,
                        PrimitiveType.Cylinder, bollard,
                        new Vector3(0.035f, 0.12f, 0.035f),
                        Quaternion.identity, poles);
                }
            }
        }

        private static void ValidateMarkers(Transform root)
        {
            Require(root != null && root.childCount == ExpectedStopCount,
                "six roadside sign assemblies are required");
            for (int i = 0; i < Stops.Length; i++)
            {
                Stop stop = Stops[i];
                Transform group = root.Find(stop.Name);
                Require(group != null, stop.Name + " sign assembly is missing");
                Renderer[] renderers = group.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length == MarkerRendererCount,
                    stop.Name + " sign silhouette is incomplete");
                string[] grounded =
                {
                    "ConcretePlinth", "RoadBollard_0", "RoadBollard_1"
                };
                for (int groundedIndex = 0; groundedIndex < grounded.Length;
                     groundedIndex++)
                {
                    Transform item = group.Find(grounded[groundedIndex]);
                    Require(item != null && item.GetComponent<Renderer>() != null,
                        stop.Name + " grounding element is missing");
                    Renderer renderer = item.GetComponent<Renderer>();
                    float terrain = HeightAtWorld(renderer.bounds.center.x,
                        renderer.bounds.center.z);
                    Require(renderer.bounds.min.y >= terrain - 0.012f
                            && renderer.bounds.min.y <= terrain + 0.005f,
                        stop.Name + " has a floating or buried sign element");
                }
                Bounds lamp = group.Find("ServiceLamp").GetComponent<Renderer>().bounds;
                Bounds sign = group.Find("FadedRouteSign").GetComponent<Renderer>().bounds;
                Require(Mathf.Abs(lamp.min.y - sign.max.y) < .008f,
                    stop.Name + " lamp is detached from its sign support");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        stop.MapX, stop.MapY, 0.10f),
                    stop.Name + " lies outside the visible landmass");
            }
        }

        private static void PlaceSet(Placement[] placements, Transform root,
                                     Material material)
        {
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Transform stop = root.Find(placement.StopName)
                    ?? Child(root, placement.StopName);
                GameObject instance =
                    KromkaGlobalMapRockLandmarkAuthoring.InstantiateMepRock(
                        placement.AssetPath, placement.Name, stop,
                        placement.MapX, placement.MapY, placement.Footprint,
                        placement.MaximumHeight, placement.Yaw, placement.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                for (int rendererIndex = 0; rendererIndex < renderers.Length;
                     rendererIndex++)
                {
                    renderers[rendererIndex].sharedMaterials = Enumerable.Repeat(
                        material, renderers[rendererIndex].sharedMaterials.Length)
                        .ToArray();
                    renderers[rendererIndex].receiveShadows = true;
                }
            }
        }

        private static void ValidateSet(Transform root, Placement[] placements,
                                        Material material, string[] allowedSources,
                                        string label)
        {
            Require(root != null, label + " root is missing");
            var allowed = new HashSet<string>(allowedSources, StringComparer.Ordinal);
            var used = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < placements.Length; i++)
            {
                Placement placement = placements[i];
                Transform instance = FindDescendant(root, placement.Name);
                Require(instance != null, placement.Name + " is missing");
                string source = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(source == placement.AssetPath && allowed.Contains(source),
                    placement.Name + " lost its reviewed direct-MEP source link");
                used.Add(source);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, placement.Name + " has no renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials
                        .All(shared => shared == material)),
                    placement.Name + " lost its reviewed strategic material");
                Bounds bounds = Encapsulate(renderers);
                float terrain = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    placement.MapX, placement.MapY);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - placement.Footprint) <= 0.04f,
                    placement.Name + " footprint drifted from authored scale");
                Require(Mathf.Abs(bounds.min.y - (terrain - placement.Embed)) <= 0.04f,
                    placement.Name + " is floating or buried relative to terrain");
                Require(bounds.size.y <= placement.MaximumHeight + 0.04f,
                    placement.Name + " is too tall for strategic-map scale");
                Require(KromkaGlobalMapReliefAuthoring.ContainsMapPoint(
                        placement.MapX, placement.MapY, 0.08f),
                    placement.Name + " lies outside the visible landmass");
            }
            Require(used.SetEquals(allowed), label + " source set is incomplete");
            ValidateClearance(placements, label);
        }

        private static void ValidateClearance(Placement[] placements, string label)
        {
            for (int a = 0; a < placements.Length; a++)
            {
                for (int b = a + 1; b < placements.Length; b++)
                {
                    if (placements[a].StopName != placements[b].StopName) continue;
                    float dx = (placements[a].MapX - placements[b].MapX)
                        * WorldScale;
                    float dz = (placements[a].MapY - placements[b].MapY)
                        * WorldScale;
                    float distance = Mathf.Sqrt(dx * dx + dz * dz);
                    float minimum = (placements[a].Footprint
                        + placements[b].Footprint) * 0.48f;
                    Require(distance >= minimum,
                        label + " contains intersecting authored footprints: "
                        + placements[a].Name + " / " + placements[b].Name);
                }
            }
        }

        private static void BuildPrimitive(string name, Transform parent,
                                           PrimitiveType type, Vector3 position,
                                           Vector3 scale, Quaternion rotation,
                                           Material material)
        {
            GameObject primitive = GameObject.CreatePrimitive(type);
            primitive.name = name;
            primitive.transform.SetParent(parent, false);
            primitive.transform.position = position;
            primitive.transform.rotation = rotation;
            primitive.transform.localScale = scale;
            Collider collider = primitive.GetComponent<Collider>();
            if (collider != null) UnityEngine.Object.DestroyImmediate(collider);
            Renderer renderer = primitive.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
            renderer.motionVectorGenerationMode =
                MotionVectorGenerationMode.ForceNoMotion;
            GameObjectUtility.SetStaticEditorFlags(primitive,
                StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic
                | StaticEditorFlags.ReflectionProbeStatic);
        }

        private static Material BuildMepMaterial(string path, string name,
                                                 Color tint)
        {
            Material source = AssetDatabase.LoadAssetAtPath<Material>(
                MepBuildingSourceMaterial);
            if (source == null || source.shader == null || !source.shader.isSupported)
                throw new InvalidOperationException(
                    "MEP source material is unavailable for roadside nodes");
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(source);
                AssetDatabase.CreateAsset(material, path);
            }
            else material.CopyPropertiesFromMaterial(source);
            material.name = name;
            if (material.HasProperty("_BaseColor"))
                material.SetColor("_BaseColor", tint);
            if (material.HasProperty("_Color")) material.SetColor("_Color", tint);
            material.enableInstancing = true;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material BuildSolidMaterial(string path, string name,
                                                   Color color, float metallic,
                                                   float smoothness)
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

        private static Material BuildEmissiveMaterial(string path, string name,
                                                      Color color, Color emission)
        {
            Material material = BuildSolidMaterial(path, name, color, 0.20f, 0.28f);
            material.EnableKeyword("_EMISSION");
            material.SetColor("_EmissionColor", emission);
            material.globalIlluminationFlags =
                MaterialGlobalIlluminationFlags.RealtimeEmissive;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Material RequireMaterial(string path)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            Require(material != null && material.shader != null
                    && material.shader.isSupported,
                "material is missing or unsupported: " + path);
            return material;
        }

        private static bool IsFinite(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x)
                && !float.IsNaN(value.y) && !float.IsInfinity(value.y)
                && !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static float HeightAtWorld(float worldX, float worldZ)
        {
            float mapX = worldX / WorldScale + MapCentre.x;
            float mapY = MapCentre.y - worldZ / WorldScale;
            return KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY);
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
                bounds.Encapsulate(renderers[i].bounds);
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
            if (!condition)
                throw new InvalidOperationException(
                    "Kromka model iteration 20 validation failed: " + message);
        }
    }
}
#endif
