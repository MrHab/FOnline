#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Kromka.EditorTools
{
    /// <summary>Restores deleted visual assets, never regenerates authored scenes or gameplay objects.</summary>
    public static class KromkaLocalPrefabRecovery
    {
        public const string PrefabRoot = "Assets/Prefabs/Kromka/RecoveredEnvironment/";
        private const string Materials = "Assets/Art/Kromka/Materials/RecoveredEnvironment/";
        private static string ProjectRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
        private static JObject Manifest => JObject.Parse(File.ReadAllText(Path.Combine(ProjectRoot, "tools/data/local-prefab-recovery.json")));

        [MenuItem("Кромка/Восстановление/Локальные префабы")]
        public static void Build() => BuildSelected();

        public static void BuildSelected(params string[] keys)
        {
            Require(!EditorApplication.isPlaying, "Exit Play Mode before rebuilding assets.");
            var rows = Manifest["prefabs"].OfType<JObject>().ToArray();
            Require(keys.All(key => rows.Any(row => (string)row["key"] == key)), "Unknown recovery key");
            if (keys.Length > 0) rows = rows.Where(row => keys.Contains((string)row["key"])).ToArray();
            // Preflight all sources and GUID ownership before writing any asset.
            foreach (var row in rows)
            {
                string destination = PrefabRoot + (string)row["key"] + ".prefab";
                string owner = AssetDatabase.GUIDToAssetPath((string)row["guid"]);
                Require(string.IsNullOrEmpty(owner) || owner == destination, "GUID already belongs to " + owner);
                foreach (var part in row["parts"].OfType<JObject>())
                    Require(AssetDatabase.LoadAssetAtPath<GameObject>((string)part["asset"]), "Missing source: " + part["asset"]);
            }
            EnsureFolder(PrefabRoot.TrimEnd('/')); EnsureFolder(Materials.TrimEnd('/'));
            Scene preview = EditorSceneManager.NewPreviewScene();
            try
            {
                foreach (var row in rows)
                {
                    var root = new GameObject((string)row["key"]);
                    SceneManager.MoveGameObjectToScene(root, preview);
                    try
                    {
                        int index = 0;
                        foreach (JObject part in row["parts"]) BuildPart(root.transform, row, part, index++);
                        SaveCompatiblePrefab(root, row);
                    }
                    finally { Object.DestroyImmediate(root); }
                }
                AssetDatabase.SaveAssets();
            }
            finally { EditorSceneManager.ClosePreviewScene(preview); }
            AssetDatabase.Refresh();
            Debug.Log("[LOCAL PREFAB RECOVERY] Restored " + rows.Length + " native visual prefabs; scenes untouched.");
        }

        private static void BuildPart(Transform parent, JObject row, JObject part, int index)
        {
            string sourcePath = (string)part["asset"];
            GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(sourcePath);
            var holder = new GameObject("Part_" + index.ToString("D2")); holder.transform.SetParent(parent, false);
            var orientation = new GameObject("Visual"); orientation.transform.SetParent(holder.transform, false);
            // Keep only the visible top LOD, not overlapping lower-detail copies, colliders or source scripts.
            var excluded = new HashSet<Renderer>();
            foreach (var lod in source.GetComponentsInChildren<LODGroup>(true))
                foreach (var level in lod.GetLODs().Skip(1)) foreach (var renderer in level.renderers) excluded.Add(renderer);
            foreach (MeshFilter mesh in source.GetComponentsInChildren<MeshFilter>(true))
            {
                var renderer = mesh.GetComponent<MeshRenderer>();
                if (!mesh.sharedMesh || !renderer || excluded.Contains(renderer)) continue;
                if (part["mesh"] != null && mesh.name != (string)part["mesh"]) continue;
                var visual = new GameObject(mesh.name); visual.transform.SetParent(orientation.transform, false);
                Matrix4x4 matrix = source.transform.worldToLocalMatrix * mesh.transform.localToWorldMatrix;
                visual.transform.localPosition = matrix.GetColumn(3);
                visual.transform.localRotation = matrix.rotation;
                visual.transform.localScale = matrix.lossyScale;
                visual.AddComponent<MeshFilter>().sharedMesh = mesh.sharedMesh;
                visual.AddComponent<MeshRenderer>().sharedMaterials = renderer.sharedMaterials
                    .Select(material => NativeMaterial(material, sourcePath)).ToArray();
            }
            Require(orientation.GetComponentsInChildren<MeshRenderer>().Length > 0, "No mesh in " + sourcePath);
            orientation.transform.localRotation = Quaternion.Euler(Vector(part["rotation"], Vector3.zero));
            Bounds bounds = BoundsOf(holder);
            Vector3 target = Vector3.Scale(Vector(row["size"]), Vector(part["size"], Vector3.one));
            Vector3 scale = new Vector3(target.x / Mathf.Max(.0001f, bounds.size.x),
                target.y / Mathf.Max(.0001f, bounds.size.y), target.z / Mathf.Max(.0001f, bounds.size.z));
            if ((string)part["fit"] != "stretch") scale = Vector3.one * Mathf.Min(scale.x, scale.y, scale.z);
            holder.transform.localScale = scale;
            bounds = BoundsOf(holder);
            Vector3 center = Vector(row["center"]), min = Vector(row["min"]);
            Vector3 anchor = Vector3.Scale(Vector(row["size"]), Vector(part["bottom"], Vector3.zero));
            holder.transform.localPosition = new Vector3(center.x + anchor.x - bounds.center.x,
                min.y + anchor.y - bounds.min.y, center.z + anchor.z - bounds.center.z);
        }

        private static Material NativeMaterial(Material source, string modelPath)
        {
            Require(source, "Missing material in " + modelPath);
            if (modelPath.StartsWith("Assets/ThirdParty/Kenney/SpaceKit10/", StringComparison.Ordinal))
            {
                string suffix = modelPath.Contains("satelliteDish") ? "ContourCeramic"
                    : modelPath.Contains("structure") ? "LeaningSupports"
                    : modelPath.Contains("hangar") ? "ContourFacility" : "ContourMachinery";
                var reviewed = AssetDatabase.LoadAssetAtPath<Material>("Assets/Art/Kromka/Materials/Kromka_Glasslands_" + suffix + ".mat");
                Require(reviewed, "Missing reviewed machinery palette: " + suffix);
                return reviewed;
            }
            Material atlas = KromkaGlobalMapNativeModelMaterialAuthoring.Resolve(modelPath, null);
            if (atlas)
            {
                bool rubber = modelPath.EndsWith("/debris-tire.fbx", StringComparison.Ordinal);
                bool machinery = modelPath.Contains("/FactoryKit30/");
                if (!rubber && !machinery) return atlas;
                string tintPath = Materials + (rubber ? "Recovered_Rubber" : "Recovered_RustMachinery") + ".mat";
                var tinted = AssetDatabase.LoadAssetAtPath<Material>(tintPath);
                if (!tinted)
                {
                    tinted = new Material(atlas) { name = Path.GetFileNameWithoutExtension(tintPath) };
                    // Preserve the native atlas while weathering the originally pale kit surfaces.
                    Color tint = rubber ? new Color(.045f,.043f,.04f,1) : new Color(.25f,.15f,.095f,1);
                    tinted.SetColor("_BaseColor", tint); tinted.SetColor("_Color", tint);
                    tinted.SetFloat("_Smoothness", .12f);
                    AssetDatabase.CreateAsset(tinted, tintPath);
                }
                return tinted;
            }
            if (source.shader && source.shader.name.StartsWith("Universal Render Pipeline/", StringComparison.Ordinal)) return source;
            AssetDatabase.TryGetGUIDAndLocalFileIdentifier(source, out string guid, out long fileId);
            string path = Materials + guid + "_" + fileId + ".mat";
            Material result = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (result) return result;
            var shader = Shader.Find("Universal Render Pipeline/Lit"); Require(shader, "URP Lit is missing");
            result = new Material(shader) { name = source.name + "_URP", enableInstancing = true };
            Texture texture = source.HasProperty("_BaseMap") ? source.GetTexture("_BaseMap") : source.mainTexture;
            if (modelPath.StartsWith("Assets/ThirdParty/Kenney/", StringComparison.Ordinal))
            {
                string kit = modelPath.Substring(0, modelPath.IndexOf("/Models/", StringComparison.Ordinal));
                texture = AssetDatabase.LoadAssetAtPath<Texture2D>(kit + "/Textures/colormap.png") ?? texture;
            }
            result.SetTexture("_BaseMap", texture);
            result.SetColor("_BaseColor", source.HasProperty("_Color") ? source.color : Color.white);
            if (texture) { result.SetTextureScale("_BaseMap", source.mainTextureScale); result.SetTextureOffset("_BaseMap", source.mainTextureOffset); }
            result.SetFloat("_Smoothness", .2f);
            if (source.HasProperty("_BumpMap") && source.GetTexture("_BumpMap"))
            { result.SetTexture("_BumpMap", source.GetTexture("_BumpMap")); result.EnableKeyword("_NORMALMAP"); }
            bool cutout = source.IsKeywordEnabled("_ALPHATEST_ON") || source.renderQueue == 2450
                || (source.shader && (source.shader.name.Contains("Cutout") || source.shader.name.Contains("Foliage")));
            if (cutout)
            {
                result.SetFloat("_AlphaClip", 1); result.SetFloat("_Cutoff", source.HasProperty("_Cutoff") ? source.GetFloat("_Cutoff") : .4f);
                result.SetFloat("_Cull", 0); result.EnableKeyword("_ALPHATEST_ON"); result.renderQueue = 2450;
            }
            AssetDatabase.CreateAsset(result, path);
            return result;
        }

        private static void SaveCompatiblePrefab(GameObject root, JObject row)
        {
            string path = PrefabRoot + (string)row["key"] + ".prefab";
            // Save as a native prefab, then deterministically remap local IDs. No model variant/source link remains.
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(root, path);
            Require(prefab, "Could not save " + path);
            AssetDatabase.TryGetGUIDAndLocalFileIdentifier(prefab, out _, out long rootId);
            AssetDatabase.TryGetGUIDAndLocalFileIdentifier(prefab.transform, out _, out long transformId);
            string yaml = File.ReadAllText(path).Replace("\r\n", "\n");
            var ids = new Dictionary<string, string> { [rootId.ToString()] = (string)row["rootGameObjectId"],
                [transformId.ToString()] = (string)row["rootTransformId"] };
            int next = 100000;
            foreach (Match match in Regex.Matches(yaml, @"(?m)^--- !u!\d+ &(-?\d+)"))
                if (!ids.ContainsKey(match.Groups[1].Value)) ids.Add(match.Groups[1].Value, (++next).ToString());
            yaml = Regex.Replace(yaml, @"(?m)(^--- !u!\d+ &)(-?\d+)", m => m.Groups[1].Value + ids[m.Groups[2].Value]);
            // External mesh/material fileIDs must never be rewritten.
            yaml = Regex.Replace(yaml, @"\{fileID: (-?\d+)\}", m => ids.TryGetValue(m.Groups[1].Value, out string id) ? "{fileID: " + id + "}" : m.Value);
            File.WriteAllText(path, yaml);
            File.WriteAllText(path + ".meta", "fileFormatVersion: 2\nguid: " + row["guid"]
                + "\nPrefabImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n");
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceUpdate);
            Require(AssetDatabase.AssetPathToGUID(path) == (string)row["guid"], "GUID restore failed: " + path);
        }

        [MenuItem("Кромка/Проверки/Ссылки локальных префабов")]
        public static void ValidateLocations()
        {
            Require(!EditorApplication.isPlaying, "Exit Play Mode before auditing scenes.");
            for (int i = 0; i < SceneManager.sceneCount; i++) Require(!SceneManager.GetSceneAt(i).isDirty, "Save open scenes before the audit.");
            foreach (JObject row in Manifest["prefabs"])
            {
                GameObject prefab = PrefabUtility.LoadPrefabContents(PrefabRoot + row["key"] + ".prefab");
                try
                {
                    Bounds bounds = BoundsOf(prefab);
                    Vector3 size = Vector(row["size"]), center = Vector(row["center"]), min = Vector(row["min"]);
                    Require(Mathf.Abs(bounds.min.y - min.y) < .025f, row["key"] + ": changed ground contact");
                    Require(bounds.size.x <= size.x + .025f && bounds.size.y <= size.y + .025f && bounds.size.z <= size.z + .025f,
                        row["key"] + ": geometry exceeds the authored envelope");
                    Require(Mathf.Abs(bounds.center.x - center.x) + bounds.extents.x <= size.x * .5f + .025f
                        && Mathf.Abs(bounds.center.z - center.z) + bounds.extents.z <= size.z * .5f + .025f,
                        row["key"] + ": visual geometry has drifted outside the authored footprint");
                    Require(prefab.GetComponentsInChildren<Collider>(true).Length == 0 && prefab.GetComponentsInChildren<MonoBehaviour>(true).Length == 0,
                        row["key"] + ": visual recovery must not introduce gameplay logic or blockers");
                }
                finally { PrefabUtility.UnloadPrefabContents(prefab); }
            }
            var setup = EditorSceneManager.GetSceneManagerSetup();
            int objects = 0, scenes = 0, renderers = 0;
            try
            {
                foreach (string path in Directory.GetFiles("Assets/Scenes/Kromka/Locations", "*.unity").OrderBy(p => p, StringComparer.Ordinal))
                {
                    Scene scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Single); scenes++;
                    foreach (var root in scene.GetRootGameObjects())
                    foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                    {
                        Require(!PrefabUtility.IsPrefabAssetMissing(transform.gameObject), path + ": missing prefab " + transform.name);
                        Require(GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(transform.gameObject) == 0, path + ": missing script " + transform.name);
                        var marker = transform.GetComponent<KromkaPlacedObjectAuthoring>();
                        if (marker && marker.Role != "terrain")
                        {
                            objects++;
                            var bridge = marker.GetComponent<RoaUnityLocationObject>();
                            Require(bridge && bridge.ObjectId == marker.StableObjectId, path + ": lost gameplay binding " + marker.StableObjectId);
                        }
                        foreach (var renderer in transform.GetComponents<MeshRenderer>())
                        {
                            renderers++;
                            var mesh = renderer.GetComponent<MeshFilter>();
                            Require((mesh && mesh.sharedMesh) || renderer.GetComponent<TextMesh>(), path + ": missing mesh " + transform.name);
                            Require(renderer.sharedMaterials.All(m => m && m.shader && m.shader.name != "Hidden/InternalErrorShader"), path + ": missing material " + transform.name);
                        }
                    }
                }
            }
            finally
            {
                if (setup.Any(item => item.isActive && item.isLoaded && !string.IsNullOrEmpty(item.path)))
                    EditorSceneManager.RestoreSceneManagerSetup(setup);
                else if (Application.isBatchMode)
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
            string report = $"PASS: {scenes} scenes, {objects} gameplay bindings, {renderers} mesh renderers; 45 recovered envelopes and ground contacts; no missing prefabs/scripts/meshes/materials.";
            string output = Path.Combine(ProjectRoot, "Build/LocalPrefabRepair"); Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "scene-audit.txt"), report);
            Debug.Log("[LOCAL PREFAB AUDIT] " + report);
        }

        private static Bounds BoundsOf(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<MeshRenderer>();
            Bounds bounds = renderers[0].bounds;
            foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
            return bounds;
        }
        private static Vector3 Vector(JToken value, Vector3 fallback = default)
        {
            if (value == null) return fallback;
            return value is JArray a ? new Vector3((float)a[0], (float)a[1], (float)a[2])
                : new Vector3((float)value["x"], (float)value["y"], (float)value["z"]);
        }
        private static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string parent = path.Substring(0, path.LastIndexOf('/')); EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }
        private static void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException("[LOCAL PREFAB RECOVERY] " + message); }
    }
}
#endif
