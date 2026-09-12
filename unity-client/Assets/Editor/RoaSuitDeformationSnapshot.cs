using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Read-only, frame-bound mesh evidence for the isolated suit probe.</summary>
    public static class RoaSuitDeformationSnapshot
    {
        public static void Write(string directory, string name, string runId,
            SkinnedMeshRenderer[] renderers, Camera camera)
        {
            var meshes = new JArray();
            foreach (var skin in renderers.Where(r => r.name.Contains("body_base")
                || r.transform.GetComponentsInParent<Transform>(true)
                    .Any(t => t.name == "Equipment:hazmatSuit" || t.name == "Equipment:energySuit")))
            {
                var baked = new Mesh();
                try
                {
                    skin.BakeMesh(baked, false);
                    var source = skin.sharedMesh;
                    var weights = source.boneWeights;
                    meshes.Add(new JObject {
                        ["name"] = skin.name,
                        ["rest"] = Vectors(source.vertices.Select(skin.transform.TransformPoint)),
                        ["posed"] = Vectors(baked.vertices.Select(skin.transform.TransformPoint)),
                        ["triangles"] = new JArray(source.triangles),
                        ["materials"] = new JArray(skin.sharedMaterials.Select(m => m.name)),
                        ["submeshes"] = new JArray(Enumerable.Range(0, source.subMeshCount)
                            .Select(i => new JArray(source.GetTriangles(i)))),
                        ["weights"] = new JArray(weights.Select(w => new JArray(
                            w.boneIndex0,w.weight0,w.boneIndex1,w.weight1,
                            w.boneIndex2,w.weight2,w.boneIndex3,w.weight3))),
                        ["bones"] = new JArray(skin.bones.Select(b => b.name)),
                        ["boneWorld"] = new JArray(skin.bones.Select(b => Matrix(b.localToWorldMatrix))),
                        ["bindposes"] = new JArray(source.bindposes.Select(Matrix)),
                        ["rendererWorld"] = Matrix(skin.transform.localToWorldMatrix),
                        ["skinQuality"] = skin.quality.ToString()
                    });
                }
                finally { UnityEngine.Object.Destroy(baked); }
            }
            var manifest = JObject.Parse(File.ReadAllText("Logs/UpperSuitCandidate/manifest.json"));
            File.WriteAllText(Path.Combine(directory, name + ".skin.json"), new JObject {
                ["schema"] = "realm.suit-deformation-snapshot.v1",
                ["runId"] = runId, ["frame"] = Time.frameCount,
                ["at"] = DateTime.UtcNow.ToString("O"),
                ["candidateVersion"] = manifest["version"],
                ["candidateFiles"] = manifest["files"].DeepClone(),
                ["coordinateSystem"] = "Unity world, metres, Y-up",
                ["camera"] = Vectors(new[] { camera.transform.position, camera.transform.forward }),
                ["skinWeights"] = QualitySettings.skinWeights.ToString(),
                ["meshes"] = meshes
            }.ToString(Newtonsoft.Json.Formatting.None));
        }

        private static JArray Vectors(System.Collections.Generic.IEnumerable<Vector3> points)
            => new JArray(points.Select(p => new JArray(p.x, p.y, p.z)));

        private static JArray Matrix(Matrix4x4 m)
            => new JArray(Enumerable.Range(0, 16).Select(i => m[i / 4, i % 4]));
    }
}
