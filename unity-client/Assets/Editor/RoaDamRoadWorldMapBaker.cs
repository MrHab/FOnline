using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Kromka;
using Kromka.Authoring;
using Newtonsoft.Json;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Bakes the playable dam road into the matching world-map cutout.</summary>
    public static class RoaDamRoadWorldMapBaker
    {
        private const string AssetPath = "Assets/Resources/RealmOfAshes/DamRoadWorldMapAppearance.asset";
        private const string RootName = "DamRoadLocalAppearance_AUTHORED";
        private const float Scale = 1f / 160f;
        private static readonly Dictionary<Object, Object> Saved = new Dictionary<Object, Object>();
        private static Mesh _asset;
        private static int _assetId;
        private static RoaGlobalMapRelief _relief;
        private static float _datum;
        private static Vector3 _origin;
        private static float[] _waterEdges;
        private static float[] _railEnds;

        [MenuItem("Realm of Ashes/World map/Bake dam road from playable location")]
        public static void Run()
        {
            try { Bake(); if (Application.isBatchMode) EditorApplication.Exit(0); }
            catch (Exception error) { Debug.LogException(error); if (Application.isBatchMode) EditorApplication.Exit(1); else throw; }
        }

        [MenuItem("Realm of Ashes/World map/Check dam road appearance")]
        public static void CheckSaved()
        {
            try
            {
                Scene scene = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
                var authored = Object.FindFirstObjectByType<RoaUnityGlobalMapScene>();
                var appearance = authored.GetComponentInChildren<RoaWorldMapSectorAppearance>(true);
                if (appearance == null || appearance.GetComponentsInChildren<Collider>().Length != 0)
                    throw new InvalidOperationException("The map preview is absent or carries local collision.");
                foreach(MeshRenderer r in appearance.GetComponentsInChildren<MeshRenderer>())
                    if(r.GetComponent<MeshFilter>().sharedMesh==null || r.sharedMaterials.Any(m=>m==null || m.shader==null))
                        throw new InvalidOperationException("Missing saved geometry or material: "+r.name);
                if(appearance.GetComponentsInChildren<MeshRenderer>().Count(r=>r.name.StartsWith("WorldMapRailTransition_RailHeads"))!=2
                    || !appearance.GetComponentsInChildren<MeshRenderer>().Any(r=>r.name.StartsWith("RailHeads_")))
                    throw new InvalidOperationException("Missing local rails or either neighbouring connection.");
                Vector3 origin = authored.transform.InverseTransformPoint(appearance.transform.position);
                MeshRenderer river = appearance.GetComponentsInChildren<MeshRenderer>().Single(r => r.name.StartsWith("TesmaRiver_"));
                Vector3[] riverPoints = river.GetComponent<MeshFilter>().sharedMesh.vertices
                    .Select(v => authored.transform.InverseTransformPoint(river.transform.TransformPoint(v))).ToArray();
                if (Mathf.Abs(riverPoints.Min(v => v.z)-(origin.z-1))>0.0001f
                    || Mathf.Abs(riverPoints.Max(v => v.z)-(origin.z+1))>0.0001f)
                    throw new InvalidOperationException("The saved river does not span the same cutout as the local river.");
                foreach (MeshRenderer renderer in appearance.OriginalRenderers)
                {
                    if (renderer == null) throw new InvalidOperationException("Missing original map renderer.");
                    if (!renderer.enabled || IsGroundOverlay(renderer)) continue;
                    Mesh mesh = renderer.GetComponent<MeshFilter>().sharedMesh;
                    Vector3[] v = mesh.vertices.Select(p => authored.transform.InverseTransformPoint(renderer.transform.TransformPoint(p))).ToArray();
                    int[] triangles = mesh.triangles;
                    for (int i = 0; i < triangles.Length; i += 3)
                    {
                        Vector3 p = (v[triangles[i]]+v[triangles[i+1]]+v[triangles[i+2]])/3;
                        if (p.x>origin.x-0.9999f && p.x<origin.x+0.9999f && p.z>origin.z-0.9999f && p.z<origin.z+0.9999f)
                            throw new InvalidOperationException("Old map geometry remains inside the preview: "+renderer.name+" at "+p.ToString("F6")+" origin "+origin.ToString("F6"));
                    }
                }
                CaptureAndCheck(scene,authored,appearance,appearance.GetComponentsInChildren<MeshRenderer>().Length);
                Debug.Log("[DAM ROAD WORLD MAP CHECK] PASS: saved river, replaced geometry, height picking and collision isolation.");
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error) { Debug.LogException(error); if (Application.isBatchMode) EditorApplication.Exit(1); else throw; }
        }

        private static void Bake()
        {
            Saved.Clear(); _assetId = 0;
            Scene global = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
            RoaUnityGlobalMapScene authored = Object.FindFirstObjectByType<RoaUnityGlobalMapScene>();
            MeshRenderer[] mapRenderers = global.GetRootGameObjects().SelectMany(g => g.GetComponentsInChildren<MeshRenderer>(true)).ToArray();
            Material mapGround = mapRenderers.First(r => r.name == "KromkaLandmass_Relief_100pct").sharedMaterial;
            Material mapWater = mapRenderers.First(r => r.name == "CleanWater_SURFACE_MEP").sharedMaterial;
            var old = authored.GetComponentInChildren<RoaWorldMapSectorAppearance>(true);
            if (old != null)
            {
                for (int i = 0; i < old.OriginalRenderers.Length; i++)
                {
                    MeshRenderer r = old.OriginalRenderers[i];
                    if (r == null) continue;
                    r.enabled = old.OriginalEnabled[i];
                    r.GetComponent<MeshFilter>().sharedMesh = old.OriginalMeshes[i];
                    PrefabUtility.RecordPrefabInstancePropertyModifications(r);
                    PrefabUtility.RecordPrefabInstancePropertyModifications(r.GetComponent<MeshFilter>());
                }
                Object.DestroyImmediate(old.gameObject);
            }
            _asset = AssetDatabase.LoadAssetAtPath<Mesh>(AssetPath);
            if (_asset == null)
            {
                _asset = new Mesh { name = "DamRoadAppearanceAssets" };
                AssetDatabase.CreateAsset(_asset, AssetPath);
            }
            else foreach (Object part in AssetDatabase.LoadAllAssetsAtPath(AssetPath))
                if (part != _asset) Object.DestroyImmediate(part, true);

            Scene local = EditorSceneManager.OpenScene("Assets/Scenes/Kromka/Locations/z_10_10.unity", OpenSceneMode.Additive);
            RoaUnityLocationScene location = local.GetRootGameObjects()
                .SelectMany(g => g.GetComponentsInChildren<RoaUnityLocationScene>(true)).Single();
            string repo = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
            LocationDefinition definition = JsonConvert.DeserializeObject<LocationDefinition>(
                File.ReadAllText(Path.Combine(repo, "data/zones/authored/z_10_10.json")));
            var painter = new GameObject("DamRoadMapBakePainter");
            SceneManager.MoveGameObjectToScene(painter, local);
            painter.AddComponent<RoaLocalTerrain>().InitializeAuthoredSurface(definition, null, location.GroundRenderer);
            RoaGlobalMapRelief relief = Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            Vector2 originPoint = RoaZoneReliefProjection.MapPoint(0, 0, 320, 320);
            Vector2 sitePoint = RoaZoneReliefProjection.MapPoint(-82, -106, 320, 320);
            float datum = relief.HeightAt(sitePoint.x, sitePoint.y);
            Vector3 origin = new Vector3((originPoint.x - relief.WidthPoints * 0.5f) * 0.1f,
                datum, (relief.HeightPoints * 0.5f - originPoint.y) * 0.1f);
            _relief = relief; _datum = datum; _origin = origin;
            _waterEdges = new float[6];
            var railProfile = JsonUtility.FromJson<RoaDamRoadRailProjection.Route>(
                Resources.Load<TextAsset>(RoaDamRoadRailProjection.ResourceKey).text);
            _railEnds = new[] { railProfile.points[0].z, railProfile.points[railProfile.points.Length-1].z };
            for (int edge = 0; edge < 2; edge++)
            {
                float z = edge == 0 ? -160 : 160;
                RoaDamRoadWaterProjection.TryBanksAt(z,out float left,out float right);
                _waterEdges[edge*3] = origin.x+left*Scale;
                _waterEdges[edge*3+1] = origin.x+right*Scale;
                _waterEdges[edge*3+2] = datum+RoaDamRoadWaterProjection.SurfaceHeightAt(z)*Scale;
            }
            var root = new GameObject(RootName);
            SceneManager.MoveGameObjectToScene(root, global);
            root.transform.SetParent(authored.StaticContentRoot, false);
            root.transform.localPosition = origin;
            root.transform.localScale = Vector3.one * Scale;
            root.layer = RoaWorldMap3D.MapLayer;
            var appearance = root.AddComponent<RoaWorldMapSectorAppearance>();
            var textureRemap = new Vector4(160f / authored.transform.lossyScale.x,
                -origin.x * 160f, -origin.z * 160f, 0f);
            int count = 0;
            foreach (MeshRenderer source in local.GetRootGameObjects().SelectMany(g => g.GetComponentsInChildren<MeshRenderer>()))
            {
                if (!source.enabled || !source.gameObject.activeInHierarchy) continue;
                if (Parents(source.transform).Any(t => t.name.Contains("Boundary") || t.name.Contains("EdgeFrame"))) continue;
                if (source != location.GroundRenderer && source.GetComponentInParent<RoaZoneReliefProjection>() == null
                    && source.GetComponentInParent<RoaDamRoadWaterProjection>() == null
                    && source.GetComponentInParent<RoaDamRoadRailProjection>() == null
                    && !Parents(source.transform).Any(t => t.TryGetComponent<KromkaPlacedObjectAuthoring>(out var placed)
                        && placed.StableObjectId.StartsWith("roadOutpost_",StringComparison.Ordinal))) continue;
                Mesh mesh = source.GetComponent<MeshFilter>()?.sharedMesh;
                if (mesh == null || source.bounds.max.x < -160 || source.bounds.min.x > 160
                    || source.bounds.max.z < -160 || source.bounds.min.z > 160) continue;
                var child = new GameObject(source.name + "_" + count++);
                child.transform.SetParent(root.transform, false);
                child.transform.localPosition = source.transform.position;
                child.transform.localRotation = source.transform.rotation;
                child.transform.localScale = source.transform.lossyScale;
                child.layer = RoaWorldMap3D.MapLayer;
                if (source == location.GroundRenderer)
                {
                    Mesh groundCopy = Object.Instantiate(mesh);
                    groundCopy.vertices = mesh.vertices.Select(v => source.transform.TransformPoint(v)).ToArray();
                    groundCopy.RecalculateNormals(); groundCopy.RecalculateBounds();
                    child.transform.localPosition = Vector3.zero; child.transform.localRotation = Quaternion.identity;
                    child.transform.localScale = Vector3.one;
                    groundCopy.uv = groundCopy.vertices.Select(v =>
                    { Vector2 p = RoaZoneReliefProjection.MapPoint(v.x,v.z,320,320);
                        return new Vector2(p.x/380f,p.y/300f); }).ToArray();
                    SavePart(groundCopy); child.AddComponent<MeshFilter>().sharedMesh = groundCopy;
                }
                else child.AddComponent<MeshFilter>().sharedMesh = Persist(mesh);
                var renderer = child.AddComponent<MeshRenderer>();
                renderer.sharedMaterials = source == location.GroundRenderer ? new[] { mapGround }
                    : source.name == "TesmaRiver" ? new[] { mapWater }
                    : source.sharedMaterials.Select(m => PersistMaterial(m, textureRemap)).ToArray();
                renderer.shadowCastingMode = source.shadowCastingMode;
                renderer.receiveShadows = source.receiveShadows;
            }
            // Picking and markers follow the blended shoulders as well as the sector.
            appearance.MapMin=new Vector2(190.8f,195); appearance.MapMax=new Vector2(220.8f,225);
            appearance.HeightSide = 385;
            appearance.Heights = new float[385 * 385];
            for (int z = 0; z < 385; z++) for (int x = 0; x < 385; x++)
            {
                float lx=-240+x*1.25f,lz=-240+z*1.25f;
                Vector3 p=origin+new Vector3(lx*Scale,0,lz*Scale);
                float ex=Mathf.Clamp(p.x,origin.x-1,origin.x+1),ez=Mathf.Clamp(p.z,origin.z-1,origin.z+1);
                float f=1-Mathf.SmoothStep(0,1,Mathf.Clamp01(new Vector2(p.x-ex,p.z-ez).magnitude/0.5f));
                appearance.Heights[z * 385 + x] = Mathf.Abs(lx)<=160 && Mathf.Abs(lz)<=160
                    ? datum+RoaZoneReliefProjection.GroundHeightAt(lx,lz)*Scale
                    : Mathf.Lerp(relief.HeightAt(p.x/0.1f+190,150-p.z/0.1f),GroundTarget(p,ex,ez),f);
            }
            EditorSceneManager.CloseScene(local, true);

            float minX = origin.x - 1f, maxX = origin.x + 1f, minZ = origin.z - 1f, maxZ = origin.z + 1f;
            var originalRenderers = new List<MeshRenderer>();
            var originalMeshes = new List<Mesh>();
            var originalEnabled = new List<bool>();
            foreach (MeshRenderer renderer in global.GetRootGameObjects()
                .SelectMany(g => g.GetComponentsInChildren<MeshRenderer>(true)))
            {
                if (!renderer.enabled || renderer.transform.IsChildOf(root.transform)) continue;
                Bounds worldBounds = renderer.bounds;
                var b = new Bounds(authored.transform.InverseTransformPoint(worldBounds.center),
                    worldBounds.size / authored.transform.lossyScale.x);
                if (b.max.x <= minX || b.min.x >= maxX || b.max.z <= minZ || b.min.z >= maxZ) continue;
                MeshFilter filter = renderer.GetComponent<MeshFilter>();
                if (filter == null || filter.sharedMesh == null) continue;
                originalRenderers.Add(renderer); originalMeshes.Add(filter.sharedMesh); originalEnabled.Add(renderer.enabled);
                if (IsGroundOverlay(renderer))
                {
                    Mesh warped = Clip(filter.sharedMesh, renderer.transform, authored.transform,
                        minX,maxX,minZ,maxZ,renderer,true);
                    SavePart(warped); filter.sharedMesh = warped;
                }
                else if (b.min.x >= minX && b.max.x <= maxX && b.min.z >= minZ && b.max.z <= maxZ)
                    renderer.enabled = false;
                else
                {
                    bool oldBridge = renderer.name == "TesmaRailBridge_ContinuousStructure" || renderer.name == "RailBridgeApproachFill";
                    bool railApproach = renderer.name == "ContinuousFreightRails" || renderer.name == "GroundSupportedSleepers"
                        || renderer.name == "RailBallast_SURFACE_MEP";
                    Mesh clipped = Clip(filter.sharedMesh, renderer.transform, authored.transform,
                        minX-(oldBridge ? 0.6f : railApproach ? 0.5f : 0), maxX+(oldBridge ? 0.6f : railApproach ? 0.5f : 0),
                        minZ-(oldBridge ? 0.5f : 0), maxZ+(oldBridge ? 0.5f : 0), renderer);
                    if (clipped.vertexCount == 0) { Object.DestroyImmediate(clipped); renderer.enabled = false; }
                    else { SavePart(clipped); filter.sharedMesh = clipped; }
                }
                PrefabUtility.RecordPrefabInstancePropertyModifications(renderer);
                PrefabUtility.RecordPrefabInstancePropertyModifications(filter);
            }
            MeshRenderer oldRail = originalRenderers.First(r => r.name == "ContinuousFreightRails");
            int oldRailIndex = originalRenderers.IndexOf(oldRail);
            AddRailTransitions(oldRail,originalMeshes[oldRailIndex],root.transform,authored.transform,minX,maxX,minZ,maxZ);
            appearance.OriginalRenderers = originalRenderers.ToArray();
            appearance.OriginalMeshes = originalMeshes.ToArray();
            appearance.OriginalEnabled = originalEnabled.ToArray();
            AssetDatabase.SaveAssets();
            EditorSceneManager.MarkSceneDirty(global);
            EditorSceneManager.SaveScene(global);
            global = EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.WorldMapScenePath);
            authored = global.GetRootGameObjects().SelectMany(g => g.GetComponentsInChildren<RoaUnityGlobalMapScene>(true)).Single();
            appearance = authored.GetComponentInChildren<RoaWorldMapSectorAppearance>(true);
            CaptureAndCheck(global, authored, appearance, count);
            Debug.Log($"[DAM ROAD WORLD MAP] PASS: {count} local renderers, {originalRenderers.Count} map renderers replaced/clipped.");
        }

        private static void AddRailTransitions(MeshRenderer oldRail,Mesh original,Transform preview,Transform mapRoot,
            float minX,float maxX,float minZ,float maxZ)
        {
            Vector3[] old = original.vertices.Select(v=>mapRoot.InverseTransformPoint(oldRail.transform.TransformPoint(v))).ToArray();
            for (int edge=0;edge<2;edge++)
            {
                float boundary = edge==0 ? minX : maxX;
                Vector3[] outside = old.Where(v=> (edge==0 ? v.x<boundary : v.x>boundary)
                    && Mathf.Abs(v.z-(_origin.z+_railEnds[edge]*Scale))<0.5f).ToArray();
                if (outside.Length==0) throw new InvalidOperationException("Missing neighbouring freight rail.");
                float at = boundary+(edge==0 ? -0.5f : 0.5f);
                // Use a cross-section behind the staggered rail ends so both
                // rails participate even when their terminal caps are angled.
                var crossings=new List<Vector3>();int[] oldTriangles=original.triangles;
                for(int ti=0;ti<oldTriangles.Length;ti+=3) for(int side=0;side<3;side++)
                {
                    Vector3 a=old[oldTriangles[ti+side]],b=old[oldTriangles[ti+(side+1)%3]];
                    float da=a.x-at,db=b.x-at;
                    if(da*db>0 || Mathf.Abs(da-db)<0.000001f)continue;
                    Vector3 hit=Vector3.Lerp(a,b,da/(da-db));
                    if(Mathf.Abs(hit.z-(_origin.z+_railEnds[edge]*Scale))<0.5f)crossings.Add(hit);
                }
                Vector3[] section=crossings.ToArray();
                float low=section.Min(v=>v.z),high=section.Max(v=>v.z),mid=(low+high)*0.5f;
                Vector3[] lower=section.Where(v=>v.z<mid).ToArray(),upper=section.Where(v=>v.z>=mid).ToArray();
                var railVertices=new List<Vector3>();var railTriangles=new List<int>();
                int segments=Mathf.Max(8,Mathf.CeilToInt(Mathf.Abs(boundary-at)/0.004f));
                Func<float,float,float> ground=(x,z)=> {
                    float ex=Mathf.Clamp(x,minX,maxX),ez=Mathf.Clamp(z,minZ,maxZ);
                    float d=new Vector2(x-ex,z-ez).magnitude;
                    float f=1-Mathf.SmoothStep(0,1,Mathf.Clamp01(d/0.5f));
                    return Mathf.Lerp(_relief.HeightAt(x/0.1f+190,150-z/0.1f),GroundTarget(new Vector3(x,0,z),ex,ez),f);
                };
                Action<List<Vector3>,List<int>,Vector3,Vector3,Vector3,Vector3> quad=(v,t,a,b,c,d)=> {
                    int n=v.Count;v.Add((a-_origin)/Scale);v.Add((b-_origin)/Scale);v.Add((c-_origin)/Scale);v.Add((d-_origin)/Scale);
                    t.AddRange(Vector3.Cross(c-a,b-a).y>=0
                        ? new[]{n,n+2,n+1,n+1,n+2,n+3} : new[]{n,n+1,n+2,n+1,n+3,n+2});
                };
                float centreNew=_origin.z+_railEnds[edge]*Scale;
                for(int i=0;i<segments;i++)
                {
                    float ta=i/(float)segments,tb=(i+1)/(float)segments;
                    // A small overlap hides endpoint rounding; native meshes stay untouched.
                    float xa=Mathf.Lerp(at+(edge==0 ? -0.001f : 0.001f),boundary+(edge==0 ? 0.001f : -0.001f),ta);
                    float xb=Mathf.Lerp(at+(edge==0 ? -0.001f : 0.001f),boundary+(edge==0 ? 0.001f : -0.001f),tb);
                    foreach(int sign in new[]{-1,1})
                    {
                        Vector3[] group=sign<0 ? lower : upper;
                        float oldCentre=(group.Min(v=>v.z)+group.Max(v=>v.z))*0.5f;
                        float oldRise=group.Max(v=>v.y)-ground(at,oldCentre);
                        float ya=ground(xa,Mathf.Lerp(oldCentre,centreNew+sign*0.8f*Scale,ta))+Mathf.Lerp(oldRise,0.245f*Scale,ta);
                        float yb=ground(xb,Mathf.Lerp(oldCentre,centreNew+sign*0.8f*Scale,tb))+Mathf.Lerp(oldRise,0.245f*Scale,tb);
                        float za=Mathf.Lerp(oldCentre,centreNew+sign*0.8f*Scale,ta);
                        float zb=Mathf.Lerp((group.Min(v=>v.z)+group.Max(v=>v.z))*0.5f,centreNew+sign*0.8f*Scale,tb);
                        float ha=Mathf.Lerp((group.Max(v=>v.z)-group.Min(v=>v.z))*0.5f,0.04f*Scale,ta);
                        float hb=Mathf.Lerp((group.Max(v=>v.z)-group.Min(v=>v.z))*0.5f,0.04f*Scale,tb);
                        quad(railVertices,railTriangles,new Vector3(xa,ya,za-ha),new Vector3(xb,yb,zb-hb),
                            new Vector3(xa,ya,za+ha),new Vector3(xb,yb,zb+hb));
                    }

                }
                AddTransitionMesh("RailHeads",railVertices,railTriangles,preview,oldRail.sharedMaterial);
            }
        }

        private static void AddTransitionMesh(string name,List<Vector3> vertices,List<int> triangles,Transform parent,Material material)
        {
            var mesh=new Mesh {name="WorldMapRailTransition_"+name}; mesh.SetVertices(vertices); mesh.SetTriangles(triangles,0);
            mesh.RecalculateNormals();mesh.RecalculateBounds();SavePart(mesh);
            var go=new GameObject(mesh.name);go.transform.SetParent(parent,false);go.layer=RoaWorldMap3D.MapLayer;
            go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;
        }

        private static IEnumerable<Transform> Parents(Transform at)
        { for (; at != null; at = at.parent) yield return at; }

        private static bool IsGroundOverlay(MeshRenderer r) => r.sharedMaterials.Any(m => m != null
            && (m.shader.name == "Realm of Ashes/Kromka Global Floodplain"
                || m.shader.name == "Realm of Ashes/Kromka Global Silent Ring"
                || m.shader.name == "Realm of Ashes/Kromka Global Transition Deposits"));

        private static void SavePart(Object part)
        { part.name += "_" + _assetId++; part.hideFlags = HideFlags.None; AssetDatabase.AddObjectToAsset(part, _asset); }

        private static Mesh Persist(Mesh mesh)
        {
            if (!string.IsNullOrEmpty(AssetDatabase.GetAssetPath(mesh))) return mesh;
            if (Saved.TryGetValue(mesh, out Object saved)) return (Mesh)saved;
            Mesh copy = Object.Instantiate(mesh); SavePart(copy); Saved[mesh] = copy; return copy;
        }

        private static Material PersistMaterial(Material material, Vector4 remap)
        {
            if (material == null) return null;
            if (!string.IsNullOrEmpty(AssetDatabase.GetAssetPath(material)) && !material.HasProperty("_SurfaceWorldTransform")) return material;
            if (Saved.TryGetValue(material, out Object saved)) return (Material)saved;
            var copy = new Material(material);
            if (copy.HasProperty("_SurfaceWorldTransform")) copy.SetVector("_SurfaceWorldTransform", remap);
            foreach (string property in copy.GetTexturePropertyNames())
            {
                Texture texture = copy.GetTexture(property);
                if (texture == null || !string.IsNullOrEmpty(AssetDatabase.GetAssetPath(texture))) continue;
                if (!Saved.TryGetValue(texture, out Object stored))
                { stored = Object.Instantiate(texture); SavePart(stored); Saved[texture] = stored; }
                copy.SetTexture(property, (Texture)stored);
            }
            SavePart(copy); Saved[material] = copy; return copy;
        }

        private struct Vertex
        {
            public Vector3 p, n; public Vector4 t; public Vector2 uv, uv2; public Color color;
            public static Vertex Lerp(Vertex a, Vertex b, float s) => new Vertex {
                p = Vector3.Lerp(a.p,b.p,s), n = Vector3.Lerp(a.n,b.n,s), t = Vector4.Lerp(a.t,b.t,s),
                uv = Vector2.Lerp(a.uv,b.uv,s), uv2 = Vector2.Lerp(a.uv2,b.uv2,s), color = Color.Lerp(a.color,b.color,s) };
        }

        // Split each triangle against the four cutout planes, retaining the outside
        // pieces exactly at the boundary. Neighbouring map geometry is preserved.
        private static Mesh Clip(Mesh mesh, Transform transform, Transform mapRoot, float minX, float maxX, float minZ, float maxZ, MeshRenderer renderer, bool keepInterior = false, bool stitch = true)
        {
            Vector3[] p = mesh.vertices, n = mesh.normals; Vector4[] t = mesh.tangents;
            Vector2[] uv = mesh.uv, uv2 = mesh.uv2; Color[] color = mesh.colors;
            var source = new Vertex[p.Length];
            for (int i = 0; i < p.Length; i++) source[i] = new Vertex { p = mapRoot.InverseTransformPoint(transform.TransformPoint(p[i])),
                n = n.Length == p.Length ? n[i] : Vector3.up, t = t.Length == p.Length ? t[i] : new Vector4(1,0,0,1),
                uv = uv.Length == p.Length ? uv[i] : Vector2.zero, uv2 = uv2.Length == p.Length ? uv2[i] : Vector2.zero,
                color = color.Length == p.Length ? color[i] : Color.white };
            var output = new List<Vertex>(); var unique = new Dictionary<Vertex,int>();
            Func<Vertex,int> add = v => { if (unique.TryGetValue(v,out int id)) return id;
                id = output.Count; unique.Add(v,id); output.Add(v); return id; };
            var indices = new List<int>[mesh.subMeshCount];
            for (int sub = 0; sub < indices.Length; sub++)
            {
                indices[sub] = new List<int>(); int[] triangles = mesh.GetTriangles(sub);
                // Dense samples around the cutout keep overlays and railway above
                // the same deformed ground instead of spanning it with long triangles.
                Action<Vertex,Vertex,Vertex,int> visit = null;
                visit = (a,b,c,depth) =>
                {
                    bool nearby = Mathf.Max(a.p.x,Mathf.Max(b.p.x,c.p.x))>minX-0.6f
                        && Mathf.Min(a.p.x,Mathf.Min(b.p.x,c.p.x))<maxX+0.6f
                        && Mathf.Max(a.p.z,Mathf.Max(b.p.z,c.p.z))>minZ-0.6f
                        && Mathf.Min(a.p.z,Mathf.Min(b.p.z,c.p.z))<maxZ+0.6f;
                    float longest = Mathf.Max(Vector3.Distance(a.p,b.p),Mathf.Max(Vector3.Distance(b.p,c.p),Vector3.Distance(c.p,a.p)));
                    if (nearby && longest>0.06f && depth<10)
                    {
                        Vertex ab=Vertex.Lerp(a,b,0.5f),bc=Vertex.Lerp(b,c,0.5f),ca=Vertex.Lerp(c,a,0.5f);
                        visit(a,ab,ca,depth+1); visit(ab,b,bc,depth+1);
                        visit(ca,bc,c,depth+1); visit(ab,bc,ca,depth+1); return;
                    }
                    var polygon = new List<Vertex> { a,b,c };
                    if (keepInterior)
                    {
                        indices[sub].Add(add(a)); indices[sub].Add(add(b)); indices[sub].Add(add(c)); return;
                    }
                    for (int plane = 0; plane < 4 && polygon.Count > 0; plane++)
                    {
                        var inside = new List<Vertex>(); var outside = new List<Vertex>();
                        Func<Vertex,float> distance = v => plane == 0 ? v.p.x-minX : plane == 1 ? maxX-v.p.x
                            : plane == 2 ? v.p.z-minZ : maxZ-v.p.z;
                        for (int k = 0; k < polygon.Count; k++)
                        {
                            Vertex va = polygon[k], vb = polygon[(k+1)%polygon.Count];
                            float da = distance(va), db = distance(vb);
                            (da >= 0 ? inside : outside).Add(va);
                            if ((da < 0) != (db < 0)) { Vertex v = Vertex.Lerp(va,vb,da/(da-db)); inside.Add(v); outside.Add(v); }
                        }
                        for (int k = 1; k + 1 < outside.Count; k++)
                        { indices[sub].Add(add(outside[0])); indices[sub].Add(add(outside[k])); indices[sub].Add(add(outside[k+1])); }
                        polygon = inside;
                    }
                };
                for (int i = 0; i < triangles.Length; i += 3)
                    visit(source[triangles[i]],source[triangles[i+1]],source[triangles[i+2]],0);
            }
            var result = new Mesh { name = "MapOutsideDamRoad_" + mesh.name, indexFormat = IndexFormat.UInt32 };
            if(stitch) Stitch(output,source,mesh.triangles,renderer,_origin.x-1,_origin.x+1,_origin.z-1,_origin.z+1);
            result.SetVertices(output.Select(v => transform.InverseTransformPoint(mapRoot.TransformPoint(v.p))).ToList());
            result.SetNormals(output.Select(v => v.n.normalized).ToList()); result.SetTangents(output.Select(v => v.t).ToList());
            result.SetUVs(0, output.Select(v => v.uv).ToList()); result.SetUVs(1, output.Select(v => v.uv2).ToList());
            result.SetColors(output.Select(v => v.color).ToList()); result.subMeshCount = indices.Length;
            for (int i = 0; i < indices.Length; i++) result.SetTriangles(indices[i],i);
            result.RecalculateNormals(); result.RecalculateBounds();
            if(stitch && renderer.name=="CleanWater_SURFACE_MEP")
            {
                // Bank adjustment can move corner triangles across a second edge.
                // Trim once more without deformation so old water never overlaps the sector.
                Mesh trimmed=Clip(result,transform,mapRoot,minX,maxX,minZ,maxZ,renderer,false,false);
                Object.DestroyImmediate(result);return trimmed;
            }
            return result;
        }

        private static void Stitch(List<Vertex> vertices, Vertex[] source, int[] triangles, MeshRenderer renderer,
            float minX, float maxX, float minZ, float maxZ)
        {
            bool ground = renderer.name == "KromkaLandmass_Relief_100pct" || IsGroundOverlay(renderer) || renderer.sharedMaterials.Any(m => m != null
                && m.shader.name == "Universal Render Pipeline/Realm of Ashes/Global Map Unified Ground");
            bool water = renderer.name == "CleanWater_SURFACE_MEP";
            bool rail = renderer.name == "ContinuousFreightRails" || renderer.name == "GroundSupportedSleepers"
                || renderer.name == "RailBallast_SURFACE_MEP";
            bool decal = !ground && !water && !rail && renderer.sharedMaterials.Any(m => m != null
                && (m.shader.name == "Realm of Ashes/Kromka Global Route"
                    || m.shader.name == "Realm of Ashes/Kromka Global Tract Wear"
                    || m.shader.name == "Realm of Ashes/Kromka Global Shoreline"
                    || m.shader.name == "Realm of Ashes/Kromka Global Sluice Weathering"));
            if (!ground && !water && !rail && !decal) return;
            Vector2[] sections = new Vector2[2];
            if (water || rail) for (int edge = 0; edge < 2; edge++)
                sections[edge] = Section(source,triangles,water ? (edge == 0 ? minZ : maxZ) : (edge == 0 ? minX : maxX),water);
            for (int i = 0; i < vertices.Count; i++)
            {
                Vertex v = vertices[i]; Vector3 p = v.p;
                float x = Mathf.Clamp(p.x,minX,maxX), z = Mathf.Clamp(p.z,minZ,maxZ);
                float distance = new Vector2(p.x-x,p.z-z).magnitude;
                float f = 1-Mathf.SmoothStep(0,1,Mathf.Clamp01(distance/0.5f));
                if (f <= 0) continue;
                if (decal) { v.color.a *= 1-f; vertices[i] = v; continue; }
                if (ground)
                {
                    float target = GroundTarget(p,x,z);
                    if (IsGroundOverlay(renderer)) target += 0.00005f;
                    p.y = Mathf.Lerp(p.y,target,f);
                }
                else if (water && (p.z<=minZ+0.0001f || p.z>=maxZ-0.0001f)
                    && p.x > minX-0.3f && p.x < maxX+0.3f)
                {
                    int edge = p.z < _origin.z ? 0 : 1;
                    Vector2 section = sections[edge];
                    float oldCentre = (section.x+section.y)*0.5f, oldHalf = (section.y-section.x)*0.5f;
                    float newCentre = (_waterEdges[edge*3]+_waterEdges[edge*3+1])*0.5f;
                    float newHalf = (_waterEdges[edge*3+1]-_waterEdges[edge*3])*0.5f;
                    if (oldHalf > 0) p.x = Mathf.Lerp(p.x,newCentre+(p.x-oldCentre)*newHalf/oldHalf,f);
                    p.y = Mathf.Lerp(p.y,_waterEdges[edge*3+2],f);
                }
                else if (rail && (p.x <= minX+0.0001f || p.x >= maxX-0.0001f))
                {
                    int edge = p.x < _origin.x ? 0 : 1;
                    float localX = edge == 0 ? -160 : 160;
                    float localZ = _railEnds[edge];
                    float centre = (sections[edge].x+sections[edge].y)*0.5f;
                    float oldHalf = (sections[edge].y-sections[edge].x)*0.5f;
                    float newHalf = renderer.name == "GroundSupportedSleepers" ? 1.3f*Scale
                        : renderer.name == "RailBallast_SURFACE_MEP" ? 2.1f*Scale : 0.84f*Scale;
                    float targetCentre = _origin.z+localZ*Scale;
                    if (oldHalf > 0) p.z = Mathf.Lerp(p.z,targetCentre+(p.z-centre)*newHalf/oldHalf,f);
                    float rise = renderer.name == "GroundSupportedSleepers" ? 0.105f
                        : renderer.name == "RailBallast_SURFACE_MEP" ? 0.06f : 0.245f;
                    // Follow the stitched ground along the whole approach, not
                    // a chord from the old raised cartographic rail to the endpoint.
                    float originalGround = _relief.HeightAt(p.x/0.1f+190,150-p.z/0.1f);
                    float targetGround = GroundTarget(p,x,z);
                    float oldClearance = Mathf.Max(rise*Scale,p.y-originalGround);
                    p.y = Mathf.Lerp(originalGround,targetGround,f) + Mathf.Lerp(oldClearance,rise*Scale,f);

                }
                v.p = p; vertices[i] = v;
            }
        }

        private static float GroundTarget(Vector3 p,float x,float z)
        {
            float localX=(x-_origin.x)/Scale,localZ=(z-_origin.z)/Scale;
            Func<float,float,float> height=(lx,lz)=>RoaZoneReliefProjection.HeightAt(_relief,lx,lz,320,320);
            float h=height(localX,localZ);
            float gx=(height(Mathf.Min(160,localX+1),localZ)-height(Mathf.Max(-160,localX-1),localZ))
                /(Mathf.Min(160,localX+1)-Mathf.Max(-160,localX-1));
            float gz=(height(localX,Mathf.Min(160,localZ+1))-height(localX,Mathf.Max(-160,localZ-1)))
                /(Mathf.Min(160,localZ+1)-Mathf.Max(-160,localZ-1));
            return _datum+(h-0.05f)*Scale+gx*(p.x-x)+gz*(p.z-z);
        }

        private static Vector2 Section(Vertex[] vertices,int[] triangles,float position,bool horizontal)
        {
            float min = float.PositiveInfinity, max = float.NegativeInfinity;
            for (int i = 0; i < triangles.Length; i += 3) for (int side = 0; side < 3; side++)
            {
                Vector3 a = vertices[triangles[i+side]].p, b = vertices[triangles[i+(side+1)%3]].p;
                float da = (horizontal ? a.z : a.x)-position, db = (horizontal ? b.z : b.x)-position;
                if (da*db > 0 || Mathf.Abs(da-db)<0.000001f) continue;
                Vector3 p = Vector3.Lerp(a,b,da/(da-db));
                float value = horizontal ? p.x : p.z;
                if (horizontal && (value < _origin.x-1.4f || value > _origin.x+1.4f)) continue;
                min = Mathf.Min(min,value); max = Mathf.Max(max,value);
            }
            return float.IsInfinity(min) ? Vector2.zero : new Vector2(min,max);
        }

        private static void CaptureAndCheck(Scene scene, RoaUnityGlobalMapScene authored,
            RoaWorldMapSectorAppearance appearance, int count)
        {
            if (count < 100 || !appearance.TryHeight(new Vector2(200.675f,216.625f), out float at))
                throw new InvalidOperationException("The playable sector was not baked.");
            string output = Environment.GetEnvironmentVariable("ROA_DAM_ROAD_MAP_CAPTURE")
                ?? Path.GetFullPath(Path.Combine(Application.dataPath,"../Build/DamRoadWorldMap"));
            Directory.CreateDirectory(output);
            var map = new GameObject("DamRoadMapCapture").AddComponent<RoaWorldMap3D>();
            map.SetWorldSize(380,300); map.AttachForProbe(scene,authored,false);
            RenderSettings.fog = false;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.5f,0.49f,0.45f);
            var ambient = new SphericalHarmonicsL2(); ambient.AddAmbientLight(RenderSettings.ambientLight);
            RenderSettings.ambientProbe = ambient;
            map.FocusOn(new Vector2(205.8f,210),4f); map.SetView(0,86);
            if (Mathf.Abs(map.ReliefAt(new Vector2(200.675f,216.625f))-at)>0.0001f)
                throw new InvalidOperationException("Map markers do not follow the baked ground.");
            map.CaptureTo(Path.Combine(output,"global-dam-road-desktop.png"),1280,720);
            map.CaptureTo(Path.Combine(output,"global-dam-road-desktop.png"),1280,720);
            map.AttachForProbe(scene,authored,true);
            map.CaptureTo(Path.Combine(output,"global-dam-road-mobile.png"),844,390);
            map.FocusOn(new Vector2(201,216.6f),2.5f); map.SetView(25,52);
            map.CaptureTo(Path.Combine(output,"global-dam-road-oblique.png"),1280,720);
            Object.DestroyImmediate(map.gameObject);
        }
    }
}
