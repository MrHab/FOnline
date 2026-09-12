using System;
using System.IO;
using System.Linq;
using Kromka.Authoring;
using Kromka.EditorTools;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    public static class RoaTutorialYardAuthoring
    {
        public const string ScenePath = "Assets/Scenes/Kromka/Locations/tutorialCaravanYard.unity";

        [MenuItem("Realm of Ashes/Onboarding/Rebuild practical tutorial yard")]
        public static void Rebuild()
        {
            if (EditorApplication.isPlaying) throw new InvalidOperationException("Stop Play Mode before rebuilding the tutorial.");
            Scene scene = SceneManager.GetSceneByPath(ScenePath);
            bool opened = !scene.isLoaded;
            if (opened) scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Additive);
            var authoring = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<KromkaLocationAuthoring>(true)).Single();
            var parent = authoring.StaticContentRoot;
            // Rebuild every required prop, including deleted legacy prefab references.
            foreach (Transform child in parent.Cast<Transform>().ToArray()) UnityEngine.Object.DestroyImmediate(child.gameObject);

            var ground = GameObject.CreatePrimitive(PrimitiveType.Cube);
            ground.name = "Ground_EDITABLE";
            ground.transform.SetParent(parent, false);
            ground.transform.localPosition = new Vector3(0, -.25f, 0);
            ground.transform.localScale = new Vector3(76, .5f, 76);
            ground.GetComponent<Renderer>().sharedMaterial = MaterialFor("TutorialGround", new Color(.38f, .39f, .34f));
            ground.AddComponent<KromkaPlacedObjectAuthoring>().Configure("tutorialCaravanYard-ground",
                "ground", "terrain", Array.Empty<string>(), false, false, false);

            ComposeGameplay(parent);
            // Remove the old decorative casualty proxy; Shurik is a server NPC.
            foreach (var spawn in authoring.DynamicAnchorsRoot.GetComponentsInChildren<KromkaSpawnAuthoring>(true))
                if (spawn.name.Contains("yard_casualty")) UnityEngine.Object.DestroyImmediate(spawn.gameObject);
            authoring.PlayerArrival.localPosition = new Vector3(0, .1f, -26);
            authoring.MigrationArrival.localPosition = new Vector3(0, .1f, -26);
            authoring.GetComponent<RoaUnityLocationScene>().Configure("tutorialCaravanYard", null, ground.GetComponent<Renderer>(), true);
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            KromkaWorldSceneExporter.ExportLocationScene(scene);
            AssetDatabase.SaveAssets();
            if (opened) EditorSceneManager.CloseScene(scene, true);
            Debug.Log("[TUTORIAL YARD] Rebuilt: clear ground, cover, repair bench, ore, wood and caravan; NPCs, supplies and target are server actors.");
        }

        public static void ComposeGameplay(Transform parent)
        {
            var definition = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../data/locations/tutorialCaravanYard.json"))));
            foreach (var pair in new[] { ("yard_cover_a", "cover"), ("yard_repair_bench", "bench"), ("yard_ore", "ore"), ("yard_wood", "wood"),
                ("yard_caravan_truck", "truck"), ("yard_gate_left", "gate"), ("yard_gate_right", "gate"), ("yard_casualty_cot", "cot") })
            {
                var row = ((JArray)definition["objects"]).OfType<JObject>().Single(obj => (string)obj["id"] == pair.Item1);
                bool cover = pair.Item2 == "cover";
                var obj = cover ? RoaTutorialCoverAuthoring.Build(parent) : RoaTutorialProps.Build(pair.Item2, parent);
                obj.name = pair.Item1;
                obj.transform.localPosition = new Vector3((float)row["position"]["x"], 0, (float)row["position"]["z"]);
                obj.transform.localRotation = Quaternion.Euler(0, (float)row["rotation"]["y"] * Mathf.Rad2Deg, 0);
                obj.AddComponent<KromkaPlacedObjectAuthoring>().Configure(pair.Item1,
                    cover ? RoaTutorialCoverAuthoring.ModelKey : (string)row["model"], "tutorial",
                    ((JArray)row["tags"]).Values<string>().ToArray(), true, cover, cover);
                obj.AddComponent<RoaUnityLocationObject>().Configure(pair.Item1);
                if (cover)
                {
                    var collider = obj.AddComponent<BoxCollider>();
                    collider.center = new Vector3(0, .58f, 0);
                    collider.size = new Vector3(3.2f, 1.16f, .8f);
                }
                foreach (var renderer in obj.GetComponentsInChildren<Renderer>())
                {
                    if (cover) continue; // Imported barrier already uses its persistent textured URP material.
                    var source = renderer.sharedMaterial;
                    renderer.sharedMaterial = MaterialFor(source.name, source.color);
                    UnityEngine.Object.DestroyImmediate(source);
                }
            }
        }

        private static Material MaterialFor(string name, Color color)
        {
            const string folder = "Assets/Art/Kromka/Materials";
            string path = folder + "/" + name + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null) return material;
            material = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = name, color = color };
            material.SetFloat("_Smoothness", .05f);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }
    }
}
