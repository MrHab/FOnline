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
    /// Each outfit has two layers: without shins (boots are worn over it) and
    /// "_full" with the donor's own shins and shoes for bare-footed wear.
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
        // Outfits whose head-weighted shells (hood, gas mask) are clothing, not a face.
        private static readonly string[] HoodedArmorIds = { "hazmatSuit" };
        // A donor head vertex farther than this from the wearer's skull is clothing.
        private const float HoodClearance = 0.01f;
        // Assault boots borrow the hazmat suit's boots, whose cuffs are painted
        // hazard yellow; on the player they read as bright rings under the knee.
        private static readonly string[] DarkenedYellowFootwear =
            { "footwear_assaultBoots_male_medium", "footwear_assaultBoots_female_medium" };
        private enum LayerKind { Identity, IdentityNoFeet, BodyNoFeet, Garment, GarmentFull, Footwear }

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
                    {
                        var outfit = Body(RoaApocalypseModels.CharacterOutfit(female, itemId));
                        var skull = Array.IndexOf(HoodedArmorIds, itemId) >= 0 ? permanentBody : null;
                        SaveLayer(itemId + "_" + body, outfit, LayerKind.Garment, skull);
                        SaveLayer(itemId + "_full_" + body, outfit, LayerKind.GarmentFull, skull);
                    }
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

        private static void SaveLayer(string name, SkinnedMeshRenderer renderer, LayerKind kind,
            SkinnedMeshRenderer skullOf = null)
        {
            UnityEngine.Mesh source = renderer.sharedMesh;
            if (source == null || !source.isReadable || source.subMeshCount != 1)
                throw new InvalidOperationException("Unreadable or multi-material body: " + renderer.name);
            BoneWeight[] weights = source.boneWeights;
            Vector3[] vertices = source.vertices;
            int[] triangles = source.triangles;
            var chosen = new List<int>(triangles.Length);
            HeadSpace hood = skullOf != null ? new HeadSpace(renderer, skullOf) : null;
            for (int i = 0; i < triangles.Length; i += 3)
            {
                int a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
                bool identity = IdentityWeight(weights[a], renderer.bones)
                    + IdentityWeight(weights[b], renderer.bones)
                    + IdentityWeight(weights[c], renderer.bones) >= 1.5f;
                bool footwear = IsFootwearTriangle(a, b, c, vertices, weights, renderer.bones);
                if (identity && hood != null && hood.OutsideSkull(a, b, c)) identity = false;
                bool keep = kind == LayerKind.Identity ? identity
                    : kind == LayerKind.IdentityNoFeet ? identity && !footwear
                    : kind == LayerKind.BodyNoFeet ? !footwear
                    : kind == LayerKind.Footwear ? footwear
                    : kind == LayerKind.GarmentFull ? !identity || footwear : !identity && !footwear;
                if (!keep) continue;
                chosen.Add(a); chosen.Add(b); chosen.Add(c);
            }
            if (chosen.Count < 30) throw new InvalidOperationException("Empty armor layer: " + name);
            var layer = UnityEngine.Object.Instantiate(source);
            layer.name = "apocalypse_" + name;
            layer.triangles = chosen.ToArray();
            layer.RecalculateBounds();
            if (Array.IndexOf(DarkenedYellowFootwear, name) >= 0) DarkenYellow(layer, chosen, renderer.sharedMaterial);
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

        /// <summary>
        /// Compares a donor's head triangles with the wearer's skull in Head-bone
        /// space: a triangle whose every corner stands clear of the skull surface
        /// (a hood, a mask) belongs to the garment.
        /// </summary>
        private sealed class HeadSpace
        {
            private readonly Vector3[] _donor;
            private readonly List<Vector3> _skull = new List<Vector3>();

            public HeadSpace(SkinnedMeshRenderer donor, SkinnedMeshRenderer wearer)
            {
                _donor = ToHead(donor, out _);
                Vector3[] skull = ToHead(wearer, out UnityEngine.Mesh mesh);
                BoneWeight[] weights = mesh.boneWeights;
                int[] triangles = mesh.triangles;
                for (int i = 0; i < triangles.Length; i += 3)
                {
                    float head = 0f;
                    for (int j = 0; j < 3; j++) head += HeadWeight(weights[triangles[i + j]], wearer.bones);
                    if (head < 1.5f) continue;
                    for (int j = 0; j < 3; j++) _skull.Add(skull[triangles[i + j]]);
                }
            }

            public bool OutsideSkull(int a, int b, int c)
            {
                return Clear(_donor[a]) && Clear(_donor[b]) && Clear(_donor[c]);
            }

            private bool Clear(Vector3 point)
            {
                for (int i = 0; i < _skull.Count; i += 3)
                    if ((ClosestPoint(point, _skull[i], _skull[i + 1], _skull[i + 2]) - point).sqrMagnitude
                        < HoodClearance * HoodClearance) return false;
                return true;
            }

            private static Vector3[] ToHead(SkinnedMeshRenderer renderer, out UnityEngine.Mesh mesh)
            {
                mesh = renderer.sharedMesh;
                int head = Array.FindIndex(renderer.bones, bone => bone != null && bone.name == "Head");
                if (head < 0) throw new InvalidOperationException("No Head bone in " + renderer.name);
                Matrix4x4 bind = mesh.bindposes[head];
                Vector3[] vertices = mesh.vertices;
                for (int i = 0; i < vertices.Length; i++) vertices[i] = bind.MultiplyPoint3x4(vertices[i]);
                return vertices;
            }

            private static float HeadWeight(BoneWeight weight, Transform[] bones)
            {
                return Head(weight.boneIndex0, weight.weight0, bones) + Head(weight.boneIndex1, weight.weight1, bones)
                    + Head(weight.boneIndex2, weight.weight2, bones) + Head(weight.boneIndex3, weight.weight3, bones);
            }

            private static float Head(int index, float weight, Transform[] bones)
            {
                if (weight <= 0f || index < 0 || index >= bones.Length) return 0f;
                string name = bones[index]?.name ?? string.Empty;
                return name == "Head" || name == "Jaw" ? weight : 0f;
            }

            // Closest point on a triangle (Ericson, Real-Time Collision Detection 5.1.5).
            private static Vector3 ClosestPoint(Vector3 p, Vector3 a, Vector3 b, Vector3 c)
            {
                Vector3 ab = b - a, ac = c - a, ap = p - a;
                float d1 = Vector3.Dot(ab, ap), d2 = Vector3.Dot(ac, ap);
                if (d1 <= 0f && d2 <= 0f) return a;
                Vector3 bp = p - b;
                float d3 = Vector3.Dot(ab, bp), d4 = Vector3.Dot(ac, bp);
                if (d3 >= 0f && d4 <= d3) return b;
                float vc = d1 * d4 - d3 * d2;
                if (vc <= 0f && d1 >= 0f && d3 <= 0f) return a + ab * (d1 / (d1 - d3));
                Vector3 cp = p - c;
                float d5 = Vector3.Dot(ab, cp), d6 = Vector3.Dot(ac, cp);
                if (d6 >= 0f && d5 <= d6) return c;
                float vb = d5 * d2 - d1 * d6;
                if (vb <= 0f && d2 >= 0f && d6 <= 0f) return a + ac * (d2 / (d2 - d6));
                float va = d3 * d6 - d5 * d4;
                if (va <= 0f && d4 - d3 >= 0f && d5 - d6 >= 0f)
                    return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
                float denom = 1f / (va + vb + vc);
                return a + ab * (vb * denom) + ac * (vc * denom);
            }
        }

        /// <summary>
        /// Repaints yellow triangles with the boot's own darkest colour by pointing
        /// their UVs at it in the shared atlas. Geometry is untouched.
        /// </summary>
        private static void DarkenYellow(UnityEngine.Mesh layer, List<int> chosen, Material material)
        {
            Texture2D atlas = RoaApocalypseWornVariantBuilder.ReadableAtlas(material);
            try
            {
                Vector2[] uv = layer.uv;
                Vector2 dark = Vector2.zero;
                float darkest = float.MaxValue;
                var yellow = new HashSet<int>();
                for (int i = 0; i < chosen.Count; i += 3)
                {
                    Color c = Color.clear;
                    for (int j = 0; j < 3; j++) c += RoaApocalypseWornVariantBuilder.Sample(atlas, uv[chosen[i + j]]) / 3f;
                    if (c.r > 0.5f && c.g > 0.4f && c.b < 0.3f && c.r - c.b > 0.35f)
                        for (int j = 0; j < 3; j++) yellow.Add(chosen[i + j]);
                    else if (c.r + c.g + c.b < darkest) { darkest = c.r + c.g + c.b; dark = uv[chosen[i]]; }
                }
                if (yellow.Count == 0) return;
                foreach (int vertex in yellow) uv[vertex] = dark;
                layer.uv = uv;
                Debug.Log("[ROA APOCALYPSE] " + layer.name + ": " + yellow.Count + " yellow vertices darkened.");
            }
            finally { UnityEngine.Object.DestroyImmediate(atlas); }
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
