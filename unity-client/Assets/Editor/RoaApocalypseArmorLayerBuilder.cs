#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Keeps the player's face, hands and feet from their original pack body.
    /// The remaining triangles of each pack outfit become a wearable mesh on
    /// that same skeleton. No vertex positions or model scales are changed.
    /// </summary>
    public static class RoaApocalypseArmorLayerBuilder
    {
        private const string Output = "Assets/Resources/RealmOfAshes/ArmorLayers";
        private const string CharacterFbx = "Assets/Synty/PolygonApocalypse/Models/Characters.fbx";
        private static readonly string[] ArmorIds =
        {
            "leather", "metalArmor", "ballisticVest", "combatArmor",
            "heavyArmor", "hazmatSuit", "energySuit"
        };
        private static readonly string[] FootwearIds =
        {
            "boots", "scoutBoots", "reinforcedBoots", "assaultBoots"
        };
        private enum LayerKind { Identity, IdentityNoFeet, BodyNoFeet, Garment, Footwear }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Rebuild wearable armor layers")]
        public static void Build()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Build armor layers in Edit Mode.");
            var importer = AssetImporter.GetAtPath(CharacterFbx) as ModelImporter;
            if (importer == null) throw new FileNotFoundException(CharacterFbx);
            bool wasReadable = importer.isReadable;
            if (!wasReadable)
            {
                importer.isReadable = true;
                importer.SaveAndReimport();
            }
            try
            {
                Directory.CreateDirectory(Output);
                foreach (bool female in new[] { false, true })
                {
                    string body = female ? "female_medium" : "male_medium";
                    var permanentBody = Body(RoaApocalypseModels.Character(body));
                    SaveLayer("base_" + body, permanentBody, LayerKind.Identity);
                    SaveLayer("base_no_feet_" + body, permanentBody, LayerKind.IdentityNoFeet);
                    SaveLayer("body_no_feet_" + body, permanentBody, LayerKind.BodyNoFeet);
                    foreach (string itemId in ArmorIds)
                        SaveLayer(itemId + "_" + body,
                            Body(RoaApocalypseModels.CharacterOutfit(female, itemId)), LayerKind.Garment);
                    foreach (string itemId in FootwearIds)
                    {
                        var pair = RoaApocalypseModels.Footwear(itemId);
                        SaveLayer("footwear_" + itemId + "_" + body,
                            Body(female ? pair.femalePrefab : pair.malePrefab), LayerKind.Footwear);
                    }
                }
                AssetDatabase.SaveAssets();
                Debug.Log("[ROA APOCALYPSE] Built native-size armor and footwear meshes.");
            }
            finally
            {
                if (!wasReadable)
                {
                    importer.isReadable = false;
                    importer.SaveAndReimport();
                }
            }
        }

        private static SkinnedMeshRenderer Body(GameObject prefab)
        {
            if (prefab == null) throw new InvalidOperationException("Missing pack character prefab.");
            foreach (var renderer in prefab.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                if (renderer.name == prefab.name) return renderer;
            throw new InvalidOperationException("Missing body mesh in " + prefab.name);
        }

        private static void SaveLayer(string name, SkinnedMeshRenderer renderer, LayerKind kind)
        {
            UnityEngine.Mesh source = renderer.sharedMesh;
            if (source == null || !source.isReadable || source.subMeshCount != 1)
                throw new InvalidOperationException("Unreadable or multi-material body: " + renderer.name);
            BoneWeight[] weights = source.boneWeights;
            Vector3[] vertices = source.vertices;
            int[] triangles = source.triangles;
            var chosen = new List<int>(triangles.Length);
            for (int i = 0; i < triangles.Length; i += 3)
            {
                int a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
                bool identity = IdentityWeight(weights[a], renderer.bones)
                    + IdentityWeight(weights[b], renderer.bones)
                    + IdentityWeight(weights[c], renderer.bones) >= 1.5f;
                bool footwear = IsFootwearTriangle(a, b, c, vertices, weights, renderer.bones);
                bool keep = kind == LayerKind.Identity ? identity
                    : kind == LayerKind.IdentityNoFeet ? identity && !footwear
                    : kind == LayerKind.BodyNoFeet ? !footwear
                    : kind == LayerKind.Footwear ? footwear : !identity && !footwear;
                if (!keep) continue;
                chosen.Add(a); chosen.Add(b); chosen.Add(c);
            }
            if (chosen.Count < 30) throw new InvalidOperationException("Empty armor layer: " + name);
            var layer = UnityEngine.Object.Instantiate(source);
            layer.name = "apocalypse_" + name;
            layer.triangles = chosen.ToArray();
            layer.RecalculateBounds();
            // The copied mesh retains every original vertex, normal, UV, bone
            // weight and bind pose. The triangle list alone selects the garment.
            string path = Output + "/" + name + ".asset";
            UnityEngine.Mesh existing = AssetDatabase.LoadAssetAtPath<UnityEngine.Mesh>(path);
            if (existing == null) AssetDatabase.CreateAsset(layer, path);
            else
            {
                EditorUtility.CopySerialized(layer, existing);
                UnityEngine.Object.DestroyImmediate(layer);
                EditorUtility.SetDirty(existing);
            }
        }

        private static bool IsFootwearTriangle(int a, int b, int c, Vector3[] vertices,
            BoneWeight[] weights, Transform[] bones)
        {
            if (Mathf.Max(vertices[a].y, vertices[b].y, vertices[c].y) > 0.42f) return false;
            return FootWeight(weights[a], bones) + FootWeight(weights[b], bones)
                + FootWeight(weights[c], bones) >= 1.5f;
        }

        private static float FootWeight(BoneWeight weight, Transform[] bones)
        {
            return FootPart(weight.boneIndex0, weight.weight0, bones)
                + FootPart(weight.boneIndex1, weight.weight1, bones)
                + FootPart(weight.boneIndex2, weight.weight2, bones)
                + FootPart(weight.boneIndex3, weight.weight3, bones);
        }

        private static float FootPart(int index, float weight, Transform[] bones)
        {
            if (weight <= 0f || index < 0 || index >= bones.Length) return 0f;
            string name = bones[index]?.name ?? string.Empty;
            return name.StartsWith("LowerLeg", StringComparison.Ordinal)
                || name.StartsWith("Ankle", StringComparison.Ordinal)
                || name.StartsWith("Ball", StringComparison.Ordinal)
                || name.StartsWith("Toes", StringComparison.Ordinal) ? weight : 0f;
        }

        private static float IdentityWeight(BoneWeight weight, Transform[] bones)
        {
            return PartWeight(weight.boneIndex0, weight.weight0, bones)
                + PartWeight(weight.boneIndex1, weight.weight1, bones)
                + PartWeight(weight.boneIndex2, weight.weight2, bones)
                + PartWeight(weight.boneIndex3, weight.weight3, bones);
        }

        private static float PartWeight(int index, float weight, Transform[] bones)
        {
            if (weight <= 0f || index < 0 || index >= bones.Length) return 0f;
            string name = bones[index]?.name ?? string.Empty;
            return name == "Head" || name == "Eyes" || name == "Eyebrows" || name == "Jaw"
                || name.StartsWith("Hand", StringComparison.Ordinal)
                || name.StartsWith("Thumb", StringComparison.Ordinal)
                || name.StartsWith("Finger", StringComparison.Ordinal)
                || name.StartsWith("IndexFinger", StringComparison.Ordinal)
                || name.StartsWith("Ankle", StringComparison.Ordinal)
                || name.StartsWith("Ball", StringComparison.Ordinal)
                || name.StartsWith("Toes", StringComparison.Ordinal) ? weight : 0f;
        }
    }
}
#endif
