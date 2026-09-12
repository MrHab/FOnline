#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Kromka.EditorTools
{
    /// <summary>Records the imported geometry and original texture bindings of the CC0 ruin pack.</summary>
    internal static class KromkaMajadroidSourceAudit
    {
        internal const string SourceRoot =
            "Assets/ThirdParty/OpenGameArt/MajadroidApocalypticBuildings/";

        private static readonly string[] ModelNames =
        {
            "building-01.fbx", "building-02.fbx", "building-03.fbx",
            "building-04.fbx", "building-05.fbx", "building-06.fbx",
            "building-07.fbx", "wreckage-3-types.fbx",
            "fire-stairs.fbx", "billboards-4-types.fbx"
        };

        [MenuItem("Kromka/Checks/Audit Majadroid CC0 ruin sources")]
        public static void WriteReport()
        {
            var report = new StringBuilder();
            report.AppendLine("KROMKA MAJADROID CC0 SOURCE AUDIT");
            int totalTriangles = 0;
            int texturedMaterials = 0;

            for (int i = 0; i < ModelNames.Length; i++)
            {
                string path = SourceRoot + "Models/" + ModelNames[i];
                GameObject model = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (model == null)
                    throw new InvalidOperationException("Missing CC0 ruin source: " + path);

                Mesh[] meshes = model.GetComponentsInChildren<MeshFilter>(true)
                    .Select(filter => filter.sharedMesh)
                    .Where(mesh => mesh != null).Distinct().ToArray();
                int triangles = meshes.Sum(mesh => mesh.triangles.Length / 3);
                totalTriangles += triangles;

                Material[] materials = model.GetComponentsInChildren<Renderer>(true)
                    .SelectMany(renderer => renderer.sharedMaterials)
                    .Where(material => material != null).Distinct().ToArray();
                string[] bindings = materials.Select(material =>
                {
                    Texture texture = material.mainTexture;
                    string texturePath = texture != null
                        ? AssetDatabase.GetAssetPath(texture) : "none";
                    if (texturePath.StartsWith(SourceRoot + "Textures/",
                            StringComparison.Ordinal))
                        texturedMaterials++;
                    return material.name + " -> " + texturePath;
                }).ToArray();

                report.AppendLine(ModelNames[i] + " | meshes=" + meshes.Length
                    + " | triangles=" + triangles + " | materials="
                    + string.Join("; ", bindings));
            }

            report.AppendLine("total_triangles=" + totalTriangles);
            report.AppendLine("source_texture_bindings=" + texturedMaterials);
            string output = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../Build/KromkaSceneCaptures/majadroid-source-audit.txt"));
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            File.WriteAllText(output, report.ToString(), Encoding.UTF8);
            Debug.Log("[KROMKA MAJADROID SOURCE] models=" + ModelNames.Length
                + ", triangles=" + totalTriangles + ", sourceTextures="
                + texturedMaterials + ". Report: " + output);
        }
    }
}
#endif
