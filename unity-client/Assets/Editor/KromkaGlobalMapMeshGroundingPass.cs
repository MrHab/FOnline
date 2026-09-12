#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Kromka.EditorTools
{
    // Unlike a bounds/terrain overlap, actual lower-envelope vertices cannot
    // report contact with terrain below an empty corner of a rotated mesh.
    [InitializeOnLoad]
    public static class KromkaGlobalMapMeshGroundingPass
    {
        private const string ScenePath = "Assets/Scenes/Kromka/KromkaGlobalMap.unity";
        private const string PlayKey = "Kromka.MeshGrounding.BatchPlay";
        private static readonly HashSet<string> Reviewed = new HashSet<string>(StringComparer.Ordinal) {
            "BrokenRoadBarrier_1", "BrokenRoadBarrier_3", "EchoPillar_12", "EchoPillar_14",
            "Burrower_RidgePiece_03", "KarstCollapse_1_2", "SecondHaven_WalkWest",
            "Zero_SealedGarage", "DestroyedUaz_Centre" };
        private static string Output => Path.GetFullPath(Path.Combine(Application.dataPath,
            "../../Build/KromkaSceneCaptures/mesh-grounding-pass"));

        public static void RunBaseline()
        {
            Open();
            Inspect("before");
            KromkaGlobalMapPhysicalSceneAudit.Run();
        }

        static KromkaGlobalMapMeshGroundingPass()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            EditorApplication.playModeStateChanged += state => {
                if (!Application.isBatchMode || !SessionState.GetBool(PlayKey, false)
                    || state != PlayModeStateChange.EnteredEditMode) return;
                SessionState.SetBool(PlayKey, false);
                string report = Path.GetFullPath(Path.Combine(Output, "../full-scene-play-review/play-mode-audit.txt"));
                DateTime start = DateTime.Parse(SessionState.GetString(PlayKey + ".start", ""), null,
                    System.Globalization.DateTimeStyles.RoundtripKind);
                bool pass = File.Exists(report) && File.GetLastWriteTimeUtc(report) >= start
                    && File.ReadAllText(report).StartsWith("PASS: 40 frames", StringComparison.Ordinal);
                EditorApplication.Exit(pass ? 0 : 1);
            };
        }

        [MenuItem("Realm of Ashes/Authoring/Visual review/Repair mesh-grounded models")]
        public static void RunRepair()
        {
            Open();
            int changed = Inspect("repair", true, false);
            Inspect("after");
            if (Inspect("idempotence", true, false) != 0)
                throw new InvalidOperationException("Grounding pass must be idempotent.");
            KromkaGlobalMapFiveIterationReview.ValidateFinalStructures();
            KromkaSceneCapture.SaveOpenGeneratedGlobalMap();
            Debug.Log("[MESH GROUNDING] Saved " + changed + " vertical corrections; second pass unchanged.");
        }

        // Reapply measured contact after a full or incremental terrain rebuild.
        // Only the nine inspected model instances are eligible; never bridges,
        // roof assemblies, effects or arbitrarily selected imported objects.
        internal static void ApplyReviewedContacts() => Inspect("generated", true, false);

        public static void RunPlayBatch()
        {
            if (!Application.isBatchMode) throw new InvalidOperationException("Batch entry point only.");
            Open();
            SessionState.SetString(PlayKey + ".start", DateTime.UtcNow.ToString("O"));
            SessionState.SetBool(PlayKey, true);
            KromkaOuterWastelandPlayAudit.RunFullScene();
        }

        private static void Open()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Exit Play Mode before changing the map.");
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new InvalidOperationException("Unsaved scene: no changes made.");
            if (SceneManager.GetActiveScene().path != ScenePath)
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
        }

        private static int Inspect(string stage, bool repair = false, bool capture = true)
        {
            Directory.CreateDirectory(Output);
            var temporary = new List<GameObject>();
            try
            {
                MeshFilter[] filters = SceneManager.GetActiveScene().GetRootGameObjects()
                    .SelectMany(r => r.GetComponentsInChildren<MeshFilter>()).Where(Visible).ToArray();
                var grounds = new List<MeshCollider>();
                foreach (MeshFilter filter in filters.Where(f => f.GetComponent<Renderer>().sharedMaterials
                    .Any(m => m != null && (m.name == "Kromka_GlobalTerrain_MEP"
                        || m.name == "Kromka_OuterNuclearGround_MEP"))))
                {
                    var go = new GameObject("MeshGroundingTerrainProbe") { hideFlags = HideFlags.HideAndDontSave };
                    temporary.Add(go);
                    go.transform.SetPositionAndRotation(filter.transform.position, filter.transform.rotation);
                    go.transform.localScale = filter.transform.lossyScale;
                    var collider = go.AddComponent<MeshCollider>(); collider.sharedMesh = filter.sharedMesh;
                    grounds.Add(collider);
                }
                Physics.SyncTransforms();
                var roots = new HashSet<GameObject>();
                foreach (MeshFilter filter in filters.Where(f => Imported(f.sharedMesh)))
                    roots.Add(PrefabUtility.GetOutermostPrefabInstanceRoot(filter.gameObject) ?? filter.gameObject);
                var rows = new JArray(); int changed = 0;
                foreach (GameObject root in roots.OrderBy(r => r.name))
                {
                    MeshFilter[] meshes = root.GetComponentsInChildren<MeshFilter>().Where(Visible).ToArray();
                    if (meshes.Length == 0) continue;
                    Bounds bounds = meshes[0].GetComponent<Renderer>().bounds;
                    foreach (MeshFilter f in meshes.Skip(1)) bounds.Encapsulate(f.GetComponent<Renderer>().bounds);
                    var envelope = new Dictionary<Vector2Int, Vector3>();
                    foreach (MeshFilter mesh in meshes)
                        foreach (Vector3 vertex in mesh.sharedMesh.vertices)
                        {
                            Vector3 p = mesh.transform.TransformPoint(vertex);
                            if (p.y > bounds.min.y + Mathf.Max(.025f, bounds.size.y * .22f)) continue;
                            var cell = new Vector2Int(Mathf.FloorToInt((p.x - bounds.min.x) / Mathf.Max(.005f, bounds.size.x / 12f)),
                                Mathf.FloorToInt((p.z - bounds.min.z) / Mathf.Max(.005f, bounds.size.z / 12f)));
                            if (!envelope.TryGetValue(cell, out Vector3 old) || p.y < old.y) envelope[cell] = p;
                        }
                    float minimumGap = float.PositiveInfinity; int supported = 0, missing = 0;
                    foreach (Vector3 p in envelope.Values)
                    {
                        float ground = float.NegativeInfinity;
                        foreach (MeshCollider collider in grounds)
                            if (collider.Raycast(new Ray(new Vector3(p.x, 20f, p.z), Vector3.down), out RaycastHit hit, 60f))
                                ground = Mathf.Max(ground, hit.point.y);
                        if (float.IsNegativeInfinity(ground)) { missing++; continue; }
                        float gap = p.y - ground;
                        minimumGap = Mathf.Min(minimumGap, gap);
                        if (gap <= .008f) supported++;
                    }
                    float correction = 0f;
                    if (repair && Reviewed.Contains(root.name) && !float.IsInfinity(minimumGap) && minimumGap > .015f)
                    {
                        correction = minimumGap + .012f;
                        Undo.RecordObject(root.transform, "Seat model on actual terrain");
                        root.transform.position -= Vector3.up * correction;
                        if (PrefabUtility.IsPartOfPrefabInstance(root))
                            PrefabUtility.RecordPrefabInstancePropertyModifications(root.transform);
                        minimumGap -= correction; changed++;
                    }
                    rows.Add(new JObject { ["name"] = root.name, ["path"] = Hierarchy(root.transform),
                        ["source"] = AssetDatabase.GetAssetPath(meshes[0].sharedMesh),
                        ["mapX"] = 190f + bounds.center.x * 10f, ["mapY"] = 150f - bounds.center.z * 10f,
                        ["height"] = bounds.size.y, ["samples"] = envelope.Count, ["missing"] = missing,
                        ["supportedSamples"] = supported, ["minimumGap"] = float.IsInfinity(minimumGap) ? (float?)null : minimumGap,
                        ["loweredBy"] = correction,
                        ["floating"] = envelope.Count != 0 && minimumGap > .015f });
                }
                JArray findings = new JArray(rows.Where(r => (bool)r["floating"]).OrderByDescending(r => (float?)r["minimumGap"]));
                File.WriteAllText(Path.Combine(Output, stage + ".json"), new JObject {
                    ["createdAt"] = DateTime.UtcNow.ToString("O"), ["models"] = rows.Count,
                    ["groundMeshes"] = grounds.Count, ["changed"] = changed,
                    ["floating"] = findings, ["inventory"] = rows }.ToString());
                Debug.Log("[MESH GROUNDING] " + stage + ": " + rows.Count + " models; " + findings.Count + " floating candidates.");
                foreach (JToken item in capture ? rows.Where(r => Reviewed.Contains((string)r["name"])) : Enumerable.Empty<JToken>())
                {
                    float x = (float)item["mapX"], y = (float)item["mapY"];
                    KromkaSceneCapture.CaptureSector(SceneManager.GetActiveScene(),
                        Path.Combine(Output, stage + "-" + (string)item["name"] + ".png"),
                        x, y, 150f, 18f, Mathf.Clamp((float)item["height"] * 5f, 3f, 9f), 1200, 675);
                }
                if (!repair && stage != "before" && findings.Count != 0)
                    throw new InvalidOperationException("The mesh grounding audit still has unsupported models.");
                return changed;
            }
            finally { foreach (GameObject go in temporary) UnityEngine.Object.DestroyImmediate(go); }
        }

        private static bool Imported(Mesh mesh)
        {
            string path = AssetDatabase.GetAssetPath(mesh);
            return path.StartsWith("Assets/ThirdParty/", StringComparison.Ordinal)
                || path.StartsWith("Assets/MEP/", StringComparison.Ordinal);
        }
        private static bool Visible(MeshFilter f) => f.sharedMesh != null && f.gameObject.activeInHierarchy
            && f.GetComponent<Renderer>() != null && f.GetComponent<Renderer>().enabled;
        private static string Hierarchy(Transform t) => t.parent == null ? t.name : Hierarchy(t.parent) + "/" + t.name;
    }
}
#endif
