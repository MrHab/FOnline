using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Kromka.EditorTools
{
    /// <summary>
    /// Places the two actual road-over-water crossings after the service-road
    /// reroute. The source bridge is the CC0 OpenGameArt model by tbbk and keeps
    /// its embedded Concrete, road and yellowpaint materials.
    /// </summary>
    internal static class KromkaGlobalMapRoadBridgeAuthoring
    {
        private const float WorldScale = 0.1f;
        private const string BridgeModelPath =
            "Assets/ThirdParty/OpenGameArt/ConcreteBridge/Models/concrete-bridge.fbx";
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private sealed class Bridge
        {
            public readonly string Name;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float RouteYaw;
            public readonly float Length;
            public readonly float Width;
            public readonly float Height;

            public Bridge(string name, float mapX, float mapY, float routeYaw,
                          float length, float width, float height)
            {
                Name = name;
                MapX = mapX;
                MapY = mapY;
                RouteYaw = routeYaw;
                Length = length;
                Width = width;
                Height = height;
            }
        }

        private static Bridge[] Bridges => new[]
        {
            AtCrossing("TesmaMainTract_RoadBridge",
                KromkaGlobalMapRouteSurfaceAuthoring.MainTract, 2.40f, 0.58f, 0.50f),
            AtCrossing("R12SouthService_RoadBridge",
                KromkaGlobalMapRouteSurfaceAuthoring.ZeroServiceLine, 1.72f, 0.50f, 0.44f)
        };

        private static Bridge AtCrossing(string name, Vector2[] route,
            float length, float width, float height)
        {
            Vector2[] road = KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(route);
            Vector2[] water = KromkaGlobalMapWaterAuthoring.SampleTesma();
            var hits = new List<(Vector2 Point, Vector2 Tangent)>();
            for (int i = 0; i < road.Length - 1; i++)
                for (int j = 0; j < water.Length - 1; j++)
                    if (TrySegmentIntersection(road[i], road[i + 1], water[j], water[j + 1],
                        out Vector2 point) && hits.All(hit => Vector2.Distance(hit.Point, point) > .02f))
                        hits.Add((point, (road[i + 1] - road[i]).normalized));
            Require(hits.Count == 1, name + " must have exactly one rendered road-water crossing.");
            var crossing = hits[0];
            return new Bridge(name, crossing.Point.x, crossing.Point.y,
                Mathf.Atan2(crossing.Tangent.y, crossing.Tangent.x) * Mathf.Rad2Deg,
                length, width, height);
        }

        internal static void Compose(Transform parent)
        {
            ConfigureSourceImporter();
            GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(BridgeModelPath);
            if (source == null)
                throw new InvalidOperationException("CC0 concrete bridge source is missing: "
                    + BridgeModelPath);

            Transform root = Child(parent, "ConcreteRoadBridges_OpenGameArt_CC0_EDITABLE");
            for (int i = 0; i < Bridges.Length; i++) Place(source, Bridges[i], root);

            Child(parent, "RoadWaterCrossings_2_REFERENCE");
            Child(parent, "OpenGameArtConcreteBridge_CC0_REFERENCE");
            Child(parent, "NativeBridgeMaterials_PRESERVED_REFERENCE");
            Child(parent, "NoRoadRunsInsideTesma_REFERENCE");
            KromkaGlobalMapBridgeApproachAuthoring.Compose(root);
        }

        internal static void Validate()
        {
            GameObject modelRootObject = GameObject.Find(
                "EnvironmentModels_ModelPass_EDITABLE");
            if (modelRootObject == null)
                throw new InvalidOperationException("Global-map model root is missing");
            Transform modelRoot = modelRootObject.transform;
            Require(modelRoot.Find("RoadWaterCrossings_2_REFERENCE") != null,
                "road-water crossing marker is missing");
            Require(modelRoot.Find("OpenGameArtConcreteBridge_CC0_REFERENCE") != null,
                "bridge source marker is missing");
            Require(modelRoot.Find("NativeBridgeMaterials_PRESERVED_REFERENCE") != null,
                "native bridge material marker is missing");
            Require(modelRoot.Find("NoRoadRunsInsideTesma_REFERENCE") != null,
                "river-bank road marker is missing");

            Transform root = FindDescendant(modelRoot,
                "ConcreteRoadBridges_OpenGameArt_CC0_EDITABLE");
            Require(root != null && root.childCount == Bridges.Length,
                "exactly two concrete road bridges are required");

            HashSet<string> nativeMaterialNames = AssetDatabase
                .LoadAllAssetsAtPath(BridgeModelPath).OfType<Material>()
                .Select(material => material.name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            Require(nativeMaterialNames.Contains("Concrete")
                    && nativeMaterialNames.Contains("road")
                    && nativeMaterialNames.Contains("yellowpaint"),
                "the source bridge lost its embedded native materials");

            for (int i = 0; i < Bridges.Length; i++)
            {
                Bridge expected = Bridges[i];
                Transform instance = root.Find(expected.Name);
                Require(instance != null, expected.Name + " is missing");
                string sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(sourcePath == BridgeModelPath,
                    expected.Name + " lost its CC0 source link");
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length >= 5,
                    expected.Name + " has an incomplete bridge silhouette");
                Require(renderers.All(renderer => renderer.sharedMaterials.Length > 0
                        && renderer.sharedMaterials.All(material => material != null
                            && material.shader != null && material.shader.isSupported
                            && nativeMaterialNames.Contains(material.name))),
                    expected.Name + " is not using the model's native materials");
                Bounds bounds = Encapsulate(renderers);
                Vector3 centre = MapToWorld(expected.MapX, expected.MapY);
                Require(Vector2.Distance(new Vector2(bounds.center.x, bounds.center.z),
                            new Vector2(centre.x, centre.z)) <= 0.035f,
                    expected.Name + " drifted away from its road crossing");
                Require(Mathf.Max(bounds.size.x, bounds.size.z) >= expected.Length * 0.82f,
                    expected.Name + " no longer spans both banks");
                Require(bounds.size.y <= expected.Height + 0.04f,
                    expected.Name + " is too tall for the strategic map");
                Require(instance.GetComponentsInChildren<Collider>(true).Length == 0,
                    expected.Name + " can obstruct global-map interaction");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    expected.Name + " can disappear with camera distance");
            }
            ValidateEveryRoadWaterIntersectionIsBridged();
            KromkaGlobalMapBridgeApproachAuthoring.Validate(root);

            Debug.Log("[KROMKA ROAD BRIDGES] PASS: two CC0 concrete road bridges "
                + "span the only authored road crossings and preserve their native "
                + "Concrete, road and yellowpaint materials.");
        }

        [MenuItem("Realm of Ashes/Authoring/Visual review/Repair road crossings")]
        public static void RepairRoadCrossings()
        {
            Require(!EditorApplication.isPlayingOrWillChangePlaymode,
                "Exit Play Mode before repairing authored road crossings.");
            GameObject models = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            Require(models != null, "Open the authored global map first.");
            Transform routes = GameObject.Find("RouteSurfaces_TexturePass_EDITABLE").transform;
            while (routes.childCount > 0)
                UnityEngine.Object.DestroyImmediate(routes.GetChild(0).gameObject);
            KromkaGlobalMapRouteSurfaceAuthoring.Compose(routes);
            KromkaGlobalMapMiddleVeinSettlementsAuthoring.RefreshRailBridgePlacement(models.transform);
            KromkaGlobalMapSovietReplacementAuthoring.RefreshCrossingClearance(models.transform);
            KromkaGlobalMapRouteCrossingAuthoring.Compose(models.transform);
            Compose(models.transform);
            Validate();
            KromkaGlobalMapRouteCrossingAuthoring.ValidateIteration17();
            AssetDatabase.SaveAssets();
            KromkaSceneCapture.SaveOpenGeneratedGlobalMap();
        }

        private static void ConfigureSourceImporter()
        {
            ModelImporter importer = AssetImporter.GetAtPath(BridgeModelPath)
                as ModelImporter;
            if (importer == null)
                throw new InvalidOperationException("Bridge importer is missing");
            bool changed = importer.importAnimation || importer.importCameras
                || importer.importLights || importer.importBlendShapes
                || importer.addCollider;
            importer.importAnimation = false;
            importer.importCameras = false;
            importer.importLights = false;
            importer.importBlendShapes = false;
            importer.addCollider = false;
            if (changed) importer.SaveAndReimport();
        }

        private static void Place(GameObject source, Bridge bridge, Transform parent)
        {
            GameObject instance = PrefabUtility.InstantiatePrefab(source, parent)
                as GameObject;
            if (instance == null)
                throw new InvalidOperationException("Could not instantiate bridge source");
            instance.name = bridge.Name;
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.identity;
            instance.transform.localScale = Vector3.one;

            RemoveRuntimeDistanceComponents(instance);
            Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                .Where(renderer => renderer != null && renderer.enabled).ToArray();
            if (renderers.Length == 0)
                throw new InvalidOperationException(bridge.Name + " has no renderer");
            Bounds sourceBounds = Encapsulate(renderers);
            float sourceWidth = Mathf.Max(0.001f, sourceBounds.size.x);
            float sourceHeight = Mathf.Max(0.001f, sourceBounds.size.y);
            float sourceLength = Mathf.Max(0.001f, sourceBounds.size.z);
            instance.transform.localScale = new Vector3(
                bridge.Width / sourceWidth,
                bridge.Height / sourceHeight,
                bridge.Length / sourceLength);
            // The FBX deck runs along local Z; authoring yaw is measured from
            // map X, hence the quarter-turn when converted to Unity world space.
            instance.transform.localRotation = Quaternion.Euler(
                0f, 90f + bridge.RouteYaw, 0f);

            Bounds scaled = Encapsulate(renderers);
            Vector3 target = MapToWorld(bridge.MapX, bridge.MapY);
            instance.transform.position += new Vector3(
                target.x - scaled.center.x,
                target.y - 0.035f - scaled.min.y,
                target.z - scaled.center.z);

            KromkaGlobalMapBridgeApproachAuthoring.SeatDeckAboveBanks(instance.transform);
            Transform[] hierarchy = instance.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < hierarchy.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(hierarchy[i].gameObject,
                    StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccludeeStatic
                    | StaticEditorFlags.ReflectionProbeStatic);
            for (int i = 0; i < renderers.Length; i++)
            {
                renderers[i].shadowCastingMode = ShadowCastingMode.On;
                renderers[i].receiveShadows = true;
                renderers[i].motionVectorGenerationMode =
                    MotionVectorGenerationMode.ForceNoMotion;
            }
        }

        private static void RemoveRuntimeDistanceComponents(GameObject instance)
        {
            Collider[] colliders = instance.GetComponentsInChildren<Collider>(true);
            for (int i = 0; i < colliders.Length; i++)
                UnityEngine.Object.DestroyImmediate(colliders[i]);
            LODGroup[] lods = instance.GetComponentsInChildren<LODGroup>(true);
            for (int i = 0; i < lods.Length; i++)
                UnityEngine.Object.DestroyImmediate(lods[i]);
            Animator[] animators = instance.GetComponentsInChildren<Animator>(true);
            for (int i = 0; i < animators.Length; i++)
                UnityEngine.Object.DestroyImmediate(animators[i]);
        }

        private static void ValidateEveryRoadWaterIntersectionIsBridged()
        {
            Vector2[][] roads =
            {
                KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(KromkaGlobalMapRouteSurfaceAuthoring.MainTract),
                KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(KromkaGlobalMapRouteSurfaceAuthoring.TesmaServiceRoad),
                KromkaGlobalMapRouteSurfaceAuthoring.SampleRoute(KromkaGlobalMapRouteSurfaceAuthoring.ZeroServiceLine)
            };
            Vector2[][] waters =
            {
                KromkaGlobalMapWaterAuthoring.SampleTesma()
            };
            var intersections = new List<Vector2>();
            for (int road = 0; road < roads.Length; road++)
                for (int water = 0; water < waters.Length; water++)
                    CollectIntersections(roads[road], waters[water], intersections);
            Require(intersections.Count == 2,
                "the authored roads must cross the single Tesma channel exactly twice");
            for (int intersection = 0; intersection < intersections.Count; intersection++)
            {
                bool covered = false;
                for (int bridge = 0; bridge < Bridges.Length; bridge++)
                {
                    float halfSpanInMapUnits = Bridges[bridge].Length / WorldScale * 0.52f;
                    if (Vector2.Distance(intersections[intersection],
                            new Vector2(Bridges[bridge].MapX, Bridges[bridge].MapY))
                        <= halfSpanInMapUnits)
                    {
                        covered = true;
                        break;
                    }
                }
                Require(covered, "road-water intersection at "
                    + intersections[intersection].x.ToString("0.0") + ","
                    + intersections[intersection].y.ToString("0.0")
                    + " is not covered by a bridge");
            }
        }

        private static void CollectIntersections(Vector2[] a, Vector2[] b,
                                                 List<Vector2> intersections)
        {
            for (int first = 0; first < a.Length - 1; first++)
                for (int second = 0; second < b.Length - 1; second++)
                {
                    Vector2 point;
                    if (!TrySegmentIntersection(a[first], a[first + 1],
                            b[second], b[second + 1], out point)) continue;
                    if (intersections.All(existing =>
                            Vector2.Distance(existing, point) > 0.02f))
                        intersections.Add(point);
                }
        }

        private static bool TrySegmentIntersection(Vector2 a, Vector2 b,
                                                   Vector2 c, Vector2 d,
                                                   out Vector2 point)
        {
            Vector2 r = b - a;
            Vector2 s = d - c;
            float denominator = r.x * s.y - r.y * s.x;
            if (Mathf.Abs(denominator) < 0.00001f)
            {
                point = default;
                return false;
            }
            Vector2 delta = c - a;
            float t = (delta.x * s.y - delta.y * s.x) / denominator;
            float u = (delta.x * r.y - delta.y * r.x) / denominator;
            point = a + r * t;
            return t >= 0f && t <= 1f && u >= 0f && u <= 1f;
        }

        private static Vector3 MapToWorld(float mapX, float mapY)
        {
            return new Vector3((mapX - MapCentre.x) * WorldScale,
                KromkaGlobalMapReliefAuthoring.HeightAtMap(mapX, mapY),
                (MapCentre.y - mapY) * WorldScale);
        }

        private static Bounds Encapsulate(Renderer[] renderers)
        {
            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static Transform Child(Transform parent, string name)
        {
            Transform existing = parent.Find(name);
            if (existing != null) UnityEngine.Object.DestroyImmediate(existing.gameObject);
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root == null) return null;
            Transform[] children = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < children.Length; i++)
                if (children[i].name == name) return children[i];
            return null;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
