using System;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    public static class RoaTutorialCoverAuthoring
    {
        public const string ModelKey = "tutorialRoadBarrier";
        public const string ModelPath = "Assets/ThirdParty/AtomicRealmPostApocalyptic/Starter/Models/wall_concrete_metal.fbx";
        // Scenes instance this tracked prefab, never the model: Atomic Realm files are installed locally and stay out
        // of Git, so a scene instance of the FBX is an unresolved reference in every clean checkout, CI included.
        public const string PrefabPath = "Assets/Prefabs/Kromka/TutorialRoadBarrier.prefab";
        private const string TexturePath = "Assets/ThirdParty/AtomicRealmPostApocalyptic/Starter/Models/post-apocalyptic_texture.png";
        private const string MaterialPath = "Assets/Art/Kromka/Materials/TutorialRoadBarrier.mat";
        private static readonly Vector3 Size = new Vector3(3.2f, 1.16f, .8f);

        public static GameObject Build(Transform parent)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath) ?? BuildPrefab();
            var root = new GameObject("Tutorial_cover");
            root.transform.SetParent(parent, false);
            PrefabUtility.InstantiatePrefab(prefab, root.transform);
            return root;
        }

        public static GameObject BuildPrefab()
        {
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(TexturePath);
            if (source == null || texture == null) throw new InvalidOperationException("Tutorial barrier source/atlas missing.");
            var material = AssetDatabase.LoadAssetAtPath<Material>(MaterialPath);
            if (material == null)
            {
                var shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null) throw new InvalidOperationException("URP Lit shader missing.");
                material = new Material(shader) { name = "TutorialRoadBarrier", mainTexture = texture, color = Color.white };
                material.SetFloat("_Smoothness", .08f);
                AssetDatabase.CreateAsset(material, MaterialPath);
            }
            material.mainTexture = texture;
            material.color = new Color(.65f, .65f, .65f);
            EditorUtility.SetDirty(material);
            var root = new GameObject(Path.GetFileNameWithoutExtension(PrefabPath));
            try
            {
                // Native copy of the model's meshes, without colliders: the prefab keeps no link to the FBX model prefab.
                var visual = new GameObject("Visual");
                visual.transform.SetParent(root.transform, false);
                foreach (var filter in source.GetComponentsInChildren<MeshFilter>(true))
                {
                    if (filter.sharedMesh == null) continue;
                    var part = new GameObject(filter.name);
                    part.transform.SetParent(visual.transform, false);
                    Matrix4x4 local = source.transform.worldToLocalMatrix * filter.transform.localToWorldMatrix;
                    part.transform.localPosition = local.GetColumn(3);
                    part.transform.localRotation = local.rotation;
                    part.transform.localScale = local.lossyScale;
                    part.AddComponent<MeshFilter>().sharedMesh = filter.sharedMesh;
                    var renderer = filter.GetComponent<Renderer>();
                    int slots = renderer != null ? Math.Max(1, renderer.sharedMaterials.Length) : 1;
                    part.AddComponent<MeshRenderer>().sharedMaterials = Enumerable.Repeat(material, slots).ToArray();
                }
                // Fit in the established gameplay envelope; do not move the objective or change server blockers.
                var bounds = LocalBounds(root);
                if (bounds.size.x < .001f || bounds.size.y < .001f || bounds.size.z < .001f)
                    throw new InvalidOperationException("Degenerate tutorial barrier mesh.");
                visual.transform.localScale = new Vector3(Size.x / bounds.size.x, Size.y / bounds.size.y, Size.z / bounds.size.z);
                bounds = LocalBounds(root);
                visual.transform.localPosition -= new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
                if (prefab == null) throw new InvalidOperationException("Could not save " + PrefabPath);
                return prefab;
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        [MenuItem("Realm of Ashes/Onboarding/Replace retired tutorial cover")]
        public static void Replace()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Stop Play Mode first.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty) throw new InvalidOperationException("Save open scenes first.");
            var scene = SceneManager.GetSceneByPath(RoaTutorialYardAuthoring.ScenePath);
            bool opened = !scene.isLoaded;
            if (opened) scene = EditorSceneManager.OpenScene(RoaTutorialYardAuthoring.ScenePath, OpenSceneMode.Additive);
            var marker = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true))
                .Single(row => row.StableObjectId == "yard_cover_a");
            // Build and validate first. Only the cover's visuals are replaced, not the rest of the authored yard.
            var replacement = Build(marker.transform.parent);
            replacement.transform.localPosition = marker.transform.localPosition;
            replacement.transform.localRotation = marker.transform.localRotation;
            replacement.transform.localScale = marker.transform.localScale;
            foreach (Transform child in marker.transform.Cast<Transform>().ToArray())
                Undo.DestroyObjectImmediate(child.gameObject);
            foreach (Transform child in replacement.transform.Cast<Transform>().ToArray())
                child.SetParent(marker.transform, false);
            UnityEngine.Object.DestroyImmediate(replacement);
            Undo.RecordObject(marker, "Replace tutorial cover archetype");
            marker.Configure(marker.StableObjectId, ModelKey, marker.Role, marker.GameplayTags.ToArray(),
                marker.ServerAuthoritative, marker.BlocksMovement, marker.BlocksVision);
            Validate(marker);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
            if (opened) EditorSceneManager.CloseScene(scene, true);
            Debug.Log("[TUTORIAL COVER] PASS: imported textured barrier saved as the tracked prefab; ID, position and solid collision preserved.");
        }

        public static void Validate(KromkaPlacedObjectAuthoring marker)
        {
            if (marker.ServerArchetypeId != ModelKey || !marker.BlocksMovement || !marker.BlocksVision)
                throw new InvalidOperationException("Tutorial cover lost its authored gameplay flags.");
            // Play Mode copies carry no prefab link, so the saved scene is checked in edit mode only.
            if (!EditorApplication.isPlaying
                && marker.transform.Cast<Transform>().Any(child => PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(child.gameObject) != PrefabPath))
                throw new InvalidOperationException("Tutorial cover must instance " + PrefabPath + ", not the local model.");
            var filters = marker.GetComponentsInChildren<MeshFilter>();
            if (filters.Length == 0 || filters.Any(filter => AssetDatabase.GetAssetPath(filter.sharedMesh) != ModelPath))
                throw new InvalidOperationException("Tutorial cover still uses a proxy or incorrect imported model.");
            var bounds = LocalBounds(marker.gameObject);
            if ((bounds.size - Size).sqrMagnitude > .00001f || Math.Abs(bounds.min.y) > .001f
                || Math.Abs(bounds.center.x) > .001f || Math.Abs(bounds.center.z) > .001f)
                throw new InvalidOperationException("Tutorial cover mesh does not match its grounded gameplay envelope.");
            var collider = marker.GetComponent<BoxCollider>();
            if (collider == null || !collider.enabled || collider.isTrigger || (collider.size - Size).sqrMagnitude > .00001f
                || (collider.center - new Vector3(0, .58f, 0)).sqrMagnitude > .00001f)
                throw new InvalidOperationException("Tutorial cover collision changed.");
            var definition = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/locations/tutorialCaravanYard.json"))));
            var row = definition["objects"].OfType<JObject>().Single(obj => (string)obj["id"] == marker.StableObjectId);
            if ((string)row["model"] != ModelKey || (string)row["collision"] != "solid" || (bool)row["vision"]["blocks"] != true
                || Math.Abs((float)row["footprint"]["x"] - Size.x) > .001f || Math.Abs((float)row["footprint"]["z"] - Size.z) > .001f)
                throw new InvalidOperationException("Tutorial cover server/client mismatch.");
        }

        private static Bounds LocalBounds(GameObject root)
        {
            Bounds bounds = default;
            bool found = false;
            foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true))
            {
                var mesh = filter.sharedMesh;
                if (mesh == null) continue;
                var box = mesh.bounds;
                for (int x = -1; x <= 1; x += 2)
                    for (int y = -1; y <= 1; y += 2)
                        for (int z = -1; z <= 1; z += 2)
                        {
                            var point = root.transform.InverseTransformPoint(filter.transform.TransformPoint(
                                box.center + Vector3.Scale(box.extents, new Vector3(x, y, z))));
                            if (!found) { bounds = new Bounds(point, Vector3.zero); found = true; }
                            else bounds.Encapsulate(point);
                        }
            }
            return bounds;
        }
    }
}
