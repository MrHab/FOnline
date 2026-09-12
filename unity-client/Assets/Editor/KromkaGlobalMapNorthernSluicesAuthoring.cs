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
    /// Environment-model iteration 05/20. Three broken dam crowns establish the
    /// Northern Sluices silhouette. Authored concrete ribbons provide the macro
    /// mass while direct MEP wall prefabs form the damaged breach edges.
    /// </summary>
    internal static class KromkaGlobalMapNorthernSluicesAuthoring
    {
        internal const int ModelIteration = 5;
        internal const int ModelIterationCount = 20;
        private const int ExpectedDamCount = 3;
        private const int SectionsPerDam = 4;
        private const int ExpectedSectionCount = ExpectedDamCount * SectionsPerDam;
        private const int AccentsPerDam = 4;
        private const int ExpectedAccentCount = ExpectedDamCount * AccentsPerDam;
        private const int PiersPerDam = 2;
        private const int ExpectedPierCount = ExpectedDamCount * PiersPerDam;
        private const int SamplesPerSection = 24;
        private const float WorldScale = 0.1f;
        private static readonly Vector2 MapCentre = new Vector2(190f, 150f);

        private const string MepStructureRoot =
            "Assets/MEP/MEP_Environment/MEP_Buildings&Props/Prefabs/";
        private const string ThirdPartyRoot =
            "Assets/ThirdParty/PolyHaven/ConcreteWall009/";
        private const string DiffusePath = ThirdPartyRoot
            + "concrete_wall_009_diff_2k.jpg";
        private const string NormalPath = ThirdPartyRoot
            + "concrete_wall_009_nor_gl_2k.jpg";
        private const string OcclusionPath = ThirdPartyRoot
            + "concrete_wall_009_ao_2k.jpg";
        private const string MaterialPath =
            "Assets/Art/Kromka/Materials/Kromka_NorthernSluices_Concrete009_MEP.mat";
        private const string MeshFolder = "Assets/Art/Kromka/Meshes";
        private const string GatePierMeshPath = MeshFolder
            + "/Kromka_NorthernSluice_GatePier.asset";

        private static readonly string[] MepWallPrefabs =
        {
            MepStructureRoot + "MEP_Wall_01_N.prefab",
            MepStructureRoot + "MEP_Wall_02_N.prefab",
            MepStructureRoot + "MEP_Wall_03_N.prefab",
            MepStructureRoot + "MEP_Wall_04_N.prefab"
        };

        private static readonly Vector2[] SectionIntervals =
        {
            new Vector2(0.00f, 0.18f),
            new Vector2(0.24f, 0.43f),
            new Vector2(0.57f, 0.76f),
            new Vector2(0.82f, 1.00f)
        };

        private readonly struct DamProfile
        {
            public readonly string Name;
            public readonly Vector2 Start;
            public readonly Vector2 Control;
            public readonly Vector2 End;
            public readonly float Width;
            public readonly float Height;

            public DamProfile(string name, Vector2 start, Vector2 control,
                              Vector2 end, float width, float height)
            {
                Name = name;
                Start = start;
                Control = control;
                End = end;
                Width = width;
                Height = height;
            }
        }

        private readonly struct AccentPlacement
        {
            public readonly string Name;
            public readonly string DamName;
            public readonly string PrefabPath;
            public readonly float MapX;
            public readonly float MapY;
            public readonly float Footprint;
            public readonly float MaximumHeight;
            public readonly float Yaw;
            public readonly float Embed;

            public AccentPlacement(string name, string damName, string prefabPath,
                                   float mapX, float mapY, float footprint,
                                   float maximumHeight, float yaw, float embed)
            {
                Name = name;
                DamName = damName;
                PrefabPath = prefabPath;
                MapX = mapX;
                MapY = mapY;
                Footprint = footprint;
                MaximumHeight = maximumHeight;
                Yaw = yaw;
                Embed = embed;
            }
        }

        private static readonly DamProfile[] Dams =
        {
            new DamProfile("WesternSpillway",
                new Vector2(137f, 261f), new Vector2(157f, 258f),
                new Vector2(177f, 263f), 2.1f, 0.24f),
            new DamProfile("CrownDam",
                new Vector2(181f, 267f), new Vector2(205f, 259f),
                new Vector2(231f, 267f), 2.3f, 0.30f),
            new DamProfile("EasternDiversion",
                new Vector2(229f, 246f), new Vector2(249f, 243f),
                new Vector2(269f, 248f), 2.1f, 0.25f)
        };

        internal static void RefreshCurrent(Transform parent)
        {
            Transform previous = parent.Find("NorthernSluices_DamComplex_MEP");
            if (previous != null) UnityEngine.Object.DestroyImmediate(previous.gameObject);
            Compose(parent);
            ValidateIteration05();
        }

        internal static void Compose(Transform parent)
        {
            EnsureFolder(MeshFolder);
            Material concrete = BuildConcreteMaterial();
            Mesh gatePierMesh = BuildGatePierMesh();
            Transform root = Child(parent, "NorthernSluices_DamComplex_MEP");
            Transform sectionRoot = Child(root, "ContinuousDamSections_EDITABLE");
            Transform accentRoot = Child(root, "MepBreachAccents_EDITABLE");
            Transform pierRoot = Child(root, "GatePiers_EDITABLE");

            for (int damIndex = 0; damIndex < Dams.Length; damIndex++)
            {
                DamProfile dam = Dams[damIndex];
                Transform damSections = Child(sectionRoot, dam.Name);
                for (int sectionIndex = 0; sectionIndex < SectionIntervals.Length;
                     sectionIndex++)
                {
                    Mesh generated = BuildDamSectionMesh(dam, damIndex, sectionIndex);
                    string assetPath = MeshFolder + "/Kromka_NorthernSluice_"
                        + dam.Name + "_Section" + sectionIndex.ToString("00") + ".asset";
                    Mesh mesh = SaveMesh(generated, assetPath);
                    var section = new GameObject("NorthernSluice_" + dam.Name
                        + "_Section_" + sectionIndex.ToString("00"));
                    section.transform.SetParent(damSections, false);
                    section.AddComponent<MeshFilter>().sharedMesh = mesh;
                    MeshRenderer renderer = section.AddComponent<MeshRenderer>();
                    renderer.sharedMaterial = concrete;
                    renderer.shadowCastingMode = ShadowCastingMode.On;
                    renderer.receiveShadows = true;
                    renderer.motionVectorGenerationMode =
                        MotionVectorGenerationMode.ForceNoMotion;
                    MarkStatic(section);
                }

                BuildGatePiers(dam, pierRoot, concrete, gatePierMesh);
            }

            List<AccentPlacement> accents = BuildAccentPlacements();
            for (int i = 0; i < accents.Count; i++)
            {
                AccentPlacement accent = accents[i];
                Transform damAccents = accentRoot.Find(accent.DamName)
                    ?? Child(accentRoot, accent.DamName);
                GameObject instance = KromkaGlobalMapRockLandmarkAuthoring
                    .InstantiateMepRock(accent.PrefabPath, accent.Name, damAccents,
                        accent.MapX, accent.MapY, accent.Footprint,
                        accent.MaximumHeight, accent.Yaw, accent.Embed);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true);
                for (int rendererIndex = 0; rendererIndex < renderers.Length;
                     rendererIndex++)
                    renderers[rendererIndex].sharedMaterial = concrete;
            }

            Child(parent, "NorthernDamCrowns_3_REFERENCE");
            Child(parent, "BrokenDamSections_12_REFERENCE");
            Child(parent, "ConcreteGatePiers_6_REFERENCE");
            Child(parent, "DirectMEPWallAccents_12_REFERENCE");
            Child(parent, "DirectMEPWallPrefabs_4_REFERENCE");
            Child(parent, "SpillwayBreaches_3_REFERENCE");
            Child(parent, "PolyHavenConcreteWall009_CC0_REFERENCE");
            Child(parent, "ModelIteration_05_of_20");
        }

        internal static void ValidateIteration05()
        {
            GameObject rootObject = GameObject.Find("EnvironmentModels_ModelPass_EDITABLE");
            if (rootObject == null)
                throw new InvalidOperationException(
                    "Model iteration 05 root is missing from the global map.");
            Transform root = rootObject.transform;
            Require(root.Find("NorthernDamCrowns_3_REFERENCE") != null,
                "dam-crown reference is missing");
            Require(root.Find("BrokenDamSections_12_REFERENCE") != null,
                "dam section-count reference is missing");
            Require(root.Find("ConcreteGatePiers_6_REFERENCE") != null,
                "gate-pier reference is missing");
            Require(root.Find("DirectMEPWallAccents_12_REFERENCE") != null,
                "MEP accent-count reference is missing");
            Require(root.Find("DirectMEPWallPrefabs_4_REFERENCE") != null,
                "MEP source reference is missing");
            Require(root.Find("SpillwayBreaches_3_REFERENCE") != null,
                "spillway-breach reference is missing");
            Require(root.Find("PolyHavenConcreteWall009_CC0_REFERENCE") != null,
                "CC0 concrete reference is missing");
            Require(root.Find("ModelIteration_05_of_20") != null,
                "model iteration marker is missing");

            Texture2D diffuse = AssetDatabase.LoadAssetAtPath<Texture2D>(DiffusePath);
            Texture2D normal = AssetDatabase.LoadAssetAtPath<Texture2D>(NormalPath);
            Texture2D occlusion = AssetDatabase.LoadAssetAtPath<Texture2D>(OcclusionPath);
            Require(diffuse != null && diffuse.width >= 2048 && diffuse.height >= 2048,
                "Poly Haven concrete diffuse is missing or under-resolved");
            Require(normal != null && normal.width >= 2048 && normal.height >= 2048,
                "Poly Haven concrete normal is missing or under-resolved");
            Require(occlusion != null && occlusion.width >= 2048 && occlusion.height >= 2048,
                "Poly Haven concrete AO is missing or under-resolved");
            Material concrete = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            Require(concrete != null && concrete.shader != null
                && concrete.shader.isSupported, "Northern Sluices material is unavailable");
            Require(concrete.GetTexture("_BaseMap") == diffuse
                && concrete.GetTexture("_BumpMap") == normal
                && concrete.GetTexture("_OcclusionMap") == occlusion,
                "Northern Sluices material lost a CC0 source texture");

            Transform damRoot = FindDescendant(root, "NorthernSluices_DamComplex_MEP");
            Transform sectionRoot = FindDescendant(damRoot,
                "ContinuousDamSections_EDITABLE");
            Require(sectionRoot != null && sectionRoot.childCount == ExpectedDamCount,
                "three authored dam groups are required");
            MeshFilter[] sectionFilters = sectionRoot
                .GetComponentsInChildren<MeshFilter>(true);
            Require(sectionFilters.Length == ExpectedSectionCount,
                "iteration 05 must contain twelve continuous dam sections");
            for (int i = 0; i < sectionFilters.Length; i++)
            {
                Mesh mesh = sectionFilters[i].sharedMesh;
                Require(mesh != null && mesh.vertexCount == (SamplesPerSection + 1) * 4,
                    sectionFilters[i].name + " has incomplete dam geometry");
                Require(mesh.bounds.center.z < -9f,
                    sectionFilters[i].name + " is not beside the northern reservoirs");
                MeshRenderer renderer = sectionFilters[i].GetComponent<MeshRenderer>();
                Require(renderer != null && renderer.sharedMaterial == concrete,
                    sectionFilters[i].name + " lost the concrete material");
                Require(sectionFilters[i].GetComponentsInChildren<Collider>(true).Length == 0,
                    sectionFilters[i].name + " can obstruct strategic-map interaction");
            }

            Transform pierRoot = FindDescendant(damRoot, "GatePiers_EDITABLE");
            Require(pierRoot != null && pierRoot.childCount == ExpectedPierCount,
                "iteration 05 must contain six gate piers");
            for (int i = 0; i < pierRoot.childCount; i++)
            {
                Transform pier = pierRoot.GetChild(i);
                MeshRenderer renderer = pier.GetComponent<MeshRenderer>();
                Require(renderer != null && renderer.sharedMaterial == concrete,
                    pier.name + " lost the concrete material");
                Require(pier.GetComponentsInChildren<Collider>(true).Length == 0,
                    pier.name + " can obstruct strategic-map interaction");
            }

            List<AccentPlacement> accents = BuildAccentPlacements();
            Require(accents.Count == ExpectedAccentCount,
                "iteration 05 must contain twelve direct MEP wall accents");
            var sourcePaths = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < accents.Count; i++)
            {
                AccentPlacement accent = accents[i];
                Transform instance = FindDescendant(damRoot, accent.Name);
                Require(instance != null, accent.Name + " is missing");
                string sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(
                    instance.gameObject).Replace('\\', '/');
                Require(sourcePath == accent.PrefabPath,
                    accent.Name + " lost its direct MEP prefab link");
                sourcePaths.Add(sourcePath);
                Renderer[] renderers = instance.GetComponentsInChildren<Renderer>(true)
                    .Where(renderer => renderer != null && renderer.enabled).ToArray();
                Require(renderers.Length > 0, accent.Name + " has no visible renderer");
                Require(renderers.All(renderer => renderer.sharedMaterials
                        .All(shared => shared == concrete)),
                    accent.Name + " lost the reviewed concrete override");
                Bounds bounds = Encapsulate(renderers);
                Require(Mathf.Abs(Mathf.Max(bounds.size.x, bounds.size.z)
                        - accent.Footprint) <= 0.035f,
                    accent.Name + " footprint drifted from authored scale");
                Require(bounds.size.y <= accent.MaximumHeight + 0.035f,
                    accent.Name + " is too tall for a breach accent");
                float terrainHeight = KromkaGlobalMapReliefAuthoring.HeightAtMap(
                    accent.MapX, accent.MapY);
                Require(Mathf.Abs(bounds.min.y - (terrainHeight - accent.Embed)) <= 0.035f,
                    accent.Name + " is floating above the dam approach");
                Require(instance.GetComponentsInChildren<LODGroup>(true).Length == 0,
                    accent.Name + " can disappear with camera distance");
                Require(instance.GetComponentsInChildren<Collider>(true)
                        .All(collider => !collider.enabled),
                    accent.Name + " can obstruct strategic-map interaction");
            }
            Require(sourcePaths.SetEquals(MepWallPrefabs),
                "iteration 05 must use all four reviewed direct MEP wall sources");

            Debug.Log("[KROMKA MODELS 25%] PASS: three curved Northern Sluices "
                + "dam crowns retain twelve broken sections, six gate piers and "
                + "twelve direct MEP breach accents using CC0 Concrete Wall 009.");
        }

        private static Mesh BuildDamSectionMesh(DamProfile dam, int damIndex,
                                                int sectionIndex)
        {
            Vector2 interval = SectionIntervals[sectionIndex];
            var vertices = new Vector3[(SamplesPerSection + 1) * 4];
            var uv = new Vector2[vertices.Length];
            var triangles = new List<int>(SamplesPerSection * 18 + 12);
            float distance = 0f;
            Vector3 previous = Vector3.zero;

            for (int sample = 0; sample <= SamplesPerSection; sample++)
            {
                float local = sample / (float)SamplesPerSection;
                float t = Mathf.Lerp(interval.x, interval.y, local);
                Vector2 point = Quadratic(dam.Start, dam.Control, dam.End, t);
                Vector2 tangent = QuadraticTangent(dam.Start, dam.Control, dam.End, t)
                    .normalized;
                Vector2 normal = new Vector2(-tangent.y, tangent.x);
                float edgeWobble = Mathf.Sin((t * 8.7f + damIndex * 0.61f)
                    * Mathf.PI) * 0.42f;
                point += normal * edgeWobble;
                Vector2 frontMap = point + normal * (dam.Width * 0.5f);
                Vector2 backMap = point - normal * (dam.Width * 0.5f);
                Vector3 front = MapToWorld(frontMap.x, frontMap.y);
                Vector3 back = MapToWorld(backMap.x, backMap.y);
                float chippedTop = Mathf.Sin((t * 4.3f + damIndex * 0.71f)
                    * Mathf.PI) * 0.010f
                    + Mathf.Sin((t * 9.1f + sectionIndex * 0.43f)
                    * Mathf.PI) * 0.005f;
                if ((sample + damIndex + sectionIndex * 4) % 13 == 0)
                    chippedTop -= 0.032f;
                float top = Mathf.Max(front.y, back.y) + dam.Height + chippedTop;
                Vector3 frontTop = new Vector3(front.x, top, front.z);
                Vector3 backTop = new Vector3(back.x, top, back.z);
                if (sample > 0) distance += Vector3.Distance(previous, frontTop);
                previous = frontTop;

                int vertex = sample * 4;
                vertices[vertex] = front;
                vertices[vertex + 1] = frontTop;
                vertices[vertex + 2] = backTop;
                vertices[vertex + 3] = back;
                float u = distance * 0.74f;
                uv[vertex] = new Vector2(u, 0f);
                uv[vertex + 1] = new Vector2(u, 1f);
                uv[vertex + 2] = new Vector2(u, 1f);
                uv[vertex + 3] = new Vector2(u, 0f);

                if (sample == SamplesPerSection) continue;
                int next = vertex + 4;
                // Winding points the front face towards the strategic camera,
                // the rear face into the reservoir and the crown upwards.
                AddQuad(triangles, vertex, vertex + 1, next, next + 1);
                AddQuad(triangles, vertex + 3, next + 3, vertex + 2, next + 2);
                AddQuad(triangles, vertex + 1, vertex + 2, next + 1, next + 2);
            }

            AddQuad(triangles, 0, 3, 1, 2);
            int last = SamplesPerSection * 4;
            AddQuad(triangles, last, last + 1, last + 3, last + 2);
            var mesh = new Mesh
            {
                name = "Kromka_NorthernSluice_" + dam.Name + "_Section"
                    + sectionIndex.ToString("00")
            };
            mesh.vertices = vertices;
            mesh.uv = uv;
            mesh.triangles = triangles.ToArray();
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void BuildGatePiers(DamProfile dam, Transform parent,
                                           Material concrete, Mesh gatePierMesh)
        {
            float[] fractions = { 0.465f, 0.535f };
            for (int pierIndex = 0; pierIndex < fractions.Length; pierIndex++)
            {
                float t = fractions[pierIndex];
                Vector2 point = Quadratic(dam.Start, dam.Control, dam.End, t);
                Vector2 tangent = QuadraticTangent(dam.Start, dam.Control, dam.End, t)
                    .normalized;
                Vector2 normal = new Vector2(-tangent.y, tangent.x);
                point += normal * ((pierIndex == 0 ? -1f : 1f) * dam.Width * 0.15f);
                float height = dam.Height * 1.08f;
                Vector3 position = MapToWorld(point.x, point.y);
                var pier = new GameObject();
                pier.name = "NorthernSluice_" + dam.Name + "_GatePier_"
                    + pierIndex.ToString("00");
                pier.transform.SetParent(parent, false);
                pier.transform.position = position + Vector3.up * (height * 0.5f);
                pier.transform.rotation = Quaternion.Euler(0f,
                    Mathf.Atan2(tangent.x, -tangent.y) * Mathf.Rad2Deg, 0f);
                pier.transform.localScale = new Vector3(0.18f, height,
                    dam.Width * WorldScale * 1.12f);
                pier.AddComponent<MeshFilter>().sharedMesh = gatePierMesh;
                MeshRenderer renderer = pier.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = concrete;
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = true;
                renderer.motionVectorGenerationMode =
                    MotionVectorGenerationMode.ForceNoMotion;
                MarkStatic(pier);
            }
        }

        private static Mesh BuildGatePierMesh()
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(GatePierMeshPath);
            if (existing != null) return existing;

            Vector3[] vertices =
            {
                new Vector3(-0.5f, -0.5f,  0.5f), new Vector3( 0.5f, -0.5f,  0.5f),
                new Vector3( 0.5f,  0.5f,  0.5f), new Vector3(-0.5f,  0.5f,  0.5f),
                new Vector3( 0.5f, -0.5f, -0.5f), new Vector3(-0.5f, -0.5f, -0.5f),
                new Vector3(-0.5f,  0.5f, -0.5f), new Vector3( 0.5f,  0.5f, -0.5f),
                new Vector3(-0.5f, -0.5f, -0.5f), new Vector3(-0.5f, -0.5f,  0.5f),
                new Vector3(-0.5f,  0.5f,  0.5f), new Vector3(-0.5f,  0.5f, -0.5f),
                new Vector3( 0.5f, -0.5f,  0.5f), new Vector3( 0.5f, -0.5f, -0.5f),
                new Vector3( 0.5f,  0.5f, -0.5f), new Vector3( 0.5f,  0.5f,  0.5f),
                new Vector3(-0.5f,  0.5f,  0.5f), new Vector3( 0.5f,  0.5f,  0.5f),
                new Vector3( 0.5f,  0.5f, -0.5f), new Vector3(-0.5f,  0.5f, -0.5f),
                new Vector3(-0.5f, -0.5f, -0.5f), new Vector3( 0.5f, -0.5f, -0.5f),
                new Vector3( 0.5f, -0.5f,  0.5f), new Vector3(-0.5f, -0.5f,  0.5f)
            };
            Vector2[] faceUv =
            {
                new Vector2(0f, 0f), new Vector2(1f, 0f),
                new Vector2(1f, 1f), new Vector2(0f, 1f)
            };
            Vector2[] uv = new Vector2[24];
            for (int face = 0; face < 6; face++)
                Array.Copy(faceUv, 0, uv, face * 4, 4);
            int[] triangles =
            {
                 0, 1, 2,  0, 2, 3,
                 4, 5, 6,  4, 6, 7,
                 8, 9,10,  8,10,11,
                12,13,14, 12,14,15,
                16,17,18, 16,18,19,
                20,21,22, 20,22,23
            };
            var mesh = new Mesh
            {
                name = "Kromka_NorthernSluice_GatePier",
                vertices = vertices,
                uv = uv,
                triangles = triangles
            };
            mesh.RecalculateNormals();
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            AssetDatabase.CreateAsset(mesh, GatePierMeshPath);
            return mesh;
        }

        private static List<AccentPlacement> BuildAccentPlacements()
        {
            var result = new List<AccentPlacement>(ExpectedAccentCount);
            float[] fractions = { 0.21f, 0.455f, 0.545f, 0.79f };
            for (int damIndex = 0; damIndex < Dams.Length; damIndex++)
            {
                DamProfile dam = Dams[damIndex];
                for (int accentIndex = 0; accentIndex < fractions.Length; accentIndex++)
                {
                    float t = fractions[accentIndex];
                    Vector2 point = Quadratic(dam.Start, dam.Control, dam.End, t);
                    Vector2 tangent = QuadraticTangent(dam.Start, dam.Control, dam.End, t)
                        .normalized;
                    Vector2 normal = new Vector2(-tangent.y, tangent.x);
                    point += normal * ((accentIndex % 2 == 0 ? -1f : 1f)
                        * dam.Width * 0.34f);
                    float footprint = 0.18f
                        + ((damIndex + accentIndex) % 3) * 0.030f;
                    string name = "NorthernSluice_" + dam.Name + "_MepBreach_"
                        + accentIndex.ToString("00");
                    string prefab = MepWallPrefabs[(damIndex * AccentsPerDam
                        + accentIndex) % MepWallPrefabs.Length];
                    float yaw = Mathf.Atan2(tangent.x, -tangent.y) * Mathf.Rad2Deg
                        + (accentIndex - 1.5f) * 9f;
                    result.Add(new AccentPlacement(name, dam.Name, prefab,
                        point.x, point.y, footprint, footprint * 0.76f,
                        yaw, 0.018f + (accentIndex % 2) * 0.006f));
                }
            }
            return result;
        }

        private static Material BuildConcreteMaterial()
        {
            ConfigureTexture(DiffusePath, false, true);
            ConfigureTexture(NormalPath, true, false);
            ConfigureTexture(OcclusionPath, false, false);
            Texture2D diffuse = LoadTexture(DiffusePath);
            Texture2D normal = LoadTexture(NormalPath);
            Texture2D occlusion = LoadTexture(OcclusionPath);
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
                throw new InvalidOperationException("URP Lit shader is unavailable.");

            Material material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                material = new Material(shader)
                {
                    name = "Kromka_NorthernSluices_Concrete009_MEP"
                };
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            else material.shader = shader;

            material.SetTexture("_BaseMap", diffuse);
            material.SetTextureScale("_BaseMap", new Vector2(0.78f, 0.78f));
            material.SetColor("_BaseColor", new Color(0.31f, 0.32f, 0.29f, 1f));
            material.SetTexture("_BumpMap", normal);
            material.SetFloat("_BumpScale", 0.68f);
            material.EnableKeyword("_NORMALMAP");
            material.SetTexture("_OcclusionMap", occlusion);
            material.SetFloat("_OcclusionStrength", 0.82f);
            material.EnableKeyword("_OCCLUSIONMAP");
            material.SetFloat("_Smoothness", 0.17f);
            material.SetFloat("_Metallic", 0.02f);
            material.SetFloat("_Cull", 0f);
            EditorUtility.SetDirty(material);
            return material;
        }

        private static Texture2D LoadTexture(string path)
        {
            Texture2D texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (texture == null)
                throw new InvalidOperationException("Missing concrete texture: " + path);
            return texture;
        }

        private static void ConfigureTexture(string path, bool normalMap, bool sRgb)
        {
            TextureImporter importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (importer == null)
                throw new InvalidOperationException(
                    "Missing concrete texture importer: " + path);
            bool changed = importer.maxTextureSize != 2048
                || importer.textureType != (normalMap
                    ? TextureImporterType.NormalMap : TextureImporterType.Default)
                || importer.sRGBTexture != sRgb
                || importer.textureCompression != TextureImporterCompression.CompressedHQ
                || (normalMap && importer.flipGreenChannel);
            importer.maxTextureSize = 2048;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.textureType = normalMap
                ? TextureImporterType.NormalMap : TextureImporterType.Default;
            importer.sRGBTexture = sRgb;
            if (normalMap) importer.flipGreenChannel = false;
            if (changed) importer.SaveAndReimport();
        }

        private static Mesh SaveMesh(Mesh generated, string path)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }
            // CopySerialized can retain stale native mesh buffers during the same
            // batch run. Replace every authored channel explicitly so validation
            // and the immediate review render see the new coordinates.
            existing.Clear();
            existing.name = generated.name;
            existing.vertices = generated.vertices;
            existing.uv = generated.uv;
            existing.triangles = generated.triangles;
            existing.normals = generated.normals;
            existing.tangents = generated.tangents;
            existing.bounds = generated.bounds;
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            AssetDatabase.SaveAssetIfDirty(existing);
            return existing;
        }

        private static Vector2 Quadratic(Vector2 a, Vector2 control, Vector2 b, float t)
        {
            float inverse = 1f - t;
            return inverse * inverse * a + 2f * inverse * t * control + t * t * b;
        }

        private static Vector2 QuadraticTangent(Vector2 a, Vector2 control,
                                                Vector2 b, float t)
        {
            return 2f * (1f - t) * (control - a) + 2f * t * (b - control);
        }

        private static void AddQuad(List<int> triangles, int a, int b, int c, int d)
        {
            triangles.Add(a);
            triangles.Add(b);
            triangles.Add(c);
            triangles.Add(c);
            triangles.Add(b);
            triangles.Add(d);
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

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root == null) return null;
            Transform[] descendants = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < descendants.Length; i++)
                if (descendants[i].name == name) return descendants[i];
            return null;
        }

        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            string parent = path.Substring(0, slash);
            string name = path.Substring(slash + 1);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, name);
        }

        private static void MarkStatic(GameObject root)
        {
            Transform[] transforms = root.GetComponentsInChildren<Transform>(true);
            StaticEditorFlags flags = StaticEditorFlags.BatchingStatic
                | StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic;
            for (int i = 0; i < transforms.Length; i++)
                GameObjectUtility.SetStaticEditorFlags(transforms[i].gameObject, flags);
        }

        private static Transform Child(Transform parent, string name)
        {
            Transform existing = parent.Find(name);
            if (existing != null) return existing;
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            return child.transform;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(
                "Kromka model iteration 05 validation failed: " + message);
        }
    }
}
#endif
