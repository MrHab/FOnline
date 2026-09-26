#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using GLTFast;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Exercises the actual character rig and every authored weapon in edit mode.</summary>
    public static class RoaWeaponVisualGripProbe
    {
        [InitializeOnLoadMethod]
        private static void RunIfRequested()
        {
            string request = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../Library/roa-weapon-visual-grip-probe.request"));
            if (!File.Exists(request)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(request)) return;
                File.Delete(request);
                Run();
            };
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Check all weapon grips")]
        public static async void Run()
        {
            try { await RunAsync(); }
            catch (Exception error) { Debug.LogError("[ROA WEAPON GRIPS] " + error); }
        }

        public static async Task RunAsync()
        {
            GameObject host = null;
            UninterruptedDeferAgent agent = null;
            string reportPath = Path.GetFullPath(Path.Combine(
                Application.dataPath, "../Temp/RoaWeaponVisualGripProbe.txt"));
            var report = new StringBuilder();
            int count = 0;
            int failed = 0;
            try
            {
                if (!Application.isPlaying)
                {
                    agent = new UninterruptedDeferAgent();
                    GltfImport.SetDefaultDeferAgent(agent);
                }
                host = new GameObject("RoaWeaponVisualGripProbe");
                host.transform.position = new Vector3(0f, 10000f, 0f);
                var preview = host.AddComponent<RoaCharacterPreview>();
                var appearance = new CharacterAppearance
                {
                    Sex = "male", HairId = "short_crop", HairColorId = "hair_08"
                };
                preview.Show("http://127.0.0.1:3000", appearance, 480, 540);
                DateTime deadline = DateTime.UtcNow.AddSeconds(45);
                while (!preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!preview.IsReady) throw new TimeoutException("Character preview did not load.");
                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                if (character == null || !character.Ready) throw new InvalidOperationException("Character rig is absent.");
                RoaApocalypseCharacterSkin skin = character.GetComponent<RoaApocalypseCharacterSkin>();
                if (skin == null) throw new InvalidOperationException("Visible PolygonApocalypse body is absent.");
                MethodInfo poseFrame = typeof(RoaCharacterView).GetMethod("LateUpdate",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                if (poseFrame == null) throw new MissingMethodException("RoaCharacterView.LateUpdate");

                foreach (RoaApocalypseModels.WeaponEntry row in RoaApocalypseModels.WeaponEntries)
                {
                    if (row == null || row.prefab == null) continue;
                    bool firearm = RoaWeaponView.IsFirearm(row.itemId);
                    RoaMeleeGrip.Profile melee = RoaMeleeGrip.Get(row.itemId);
                    if (!firearm && melee == null) continue;
                    count++;
                    try
                    {
                        await character.EquipWeapon("http://127.0.0.1:3000", row.itemId);
                        if (!character.WeaponReady) throw new InvalidOperationException("Weapon failed to load.");
                        character.UpdateLocomotion(Vector3.zero, 0f, false, false);
                        poseFrame.Invoke(character, null);
                        skin.SyncPose();
                        Transform primary = null;
                        Transform support = null;
                        foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                        {
                            if (!node.gameObject.activeInHierarchy) continue;
                            if (node.name == "PolygonApocalypse_PrimaryHand") primary = node;
                            else if (node.name == "PolygonApocalypse_SupportHand") support = node;
                        }
                        if (primary == null || (firearm || melee.TwoHanded) && support == null)
                            throw new InvalidOperationException("Visible handhold is missing.");
                        Transform right = skin.VisibleHand(false);
                        Transform left = skin.VisibleHand(true);
                        float rightDistance = right != null ? Vector3.Distance(right.position, primary.position) : float.PositiveInfinity;
                        bool needsSupport = firearm || melee.TwoHanded;
                        float leftDistance = needsSupport && support != null && left != null
                            ? Vector3.Distance(left.position, support.position) : 0f;
                        if (rightDistance > 0.24f || leftDistance > 0.28f)
                            throw new InvalidOperationException("Hand misses model: right="
                                + rightDistance.ToString("F3") + " left=" + leftDistance.ToString("F3")
                                + " target=" + (support != null ? character.transform.InverseTransformPoint(support.position).ToString("F3") : "none")
                                + " wrist=" + (left != null ? character.transform.InverseTransformPoint(left.position).ToString("F3") : "none"));
                        report.AppendLine(row.itemId + " right=" + rightDistance.ToString("F3")
                            + " left=" + leftDistance.ToString("F3"));
                        if (row.itemId == "assaultRifle" || row.itemId == "shotgun"
                            || row.itemId == "pistol" || row.itemId == "axe")
                        {
                            Capture(preview, row.itemId);
                            preview.Show("http://127.0.0.1:3000", appearance, 640, 360);
                            Capture(preview, row.itemId + "_landscape");
                            preview.Show("http://127.0.0.1:3000", appearance, 480, 540);
                        }
                    }
                    catch (Exception error)
                    {
                        failed++;
                        report.AppendLine("FAIL " + row.itemId + ": " + error.Message);
                    }
                }
                report.Insert(0, "Weapon grip probe: " + count + " weapons, " + failed + " failures\n");
                File.WriteAllText(reportPath, report.ToString());
                if (failed > 0) Debug.LogError("[ROA WEAPON GRIPS] " + failed + " failures: " + reportPath);
                else Debug.Log("[ROA WEAPON GRIPS] PASS " + count + " weapons: " + reportPath);
            }
            finally
            {
                if (agent != null) GltfImport.UnsetDefaultDeferAgent(agent);
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Capture(RoaCharacterPreview preview, string itemId)
        {
            if (!preview.RenderNow() || preview.Texture == null) return;
            RenderTexture previous = RenderTexture.active;
            Texture2D readback = null;
            try
            {
                RenderTexture.active = preview.Texture;
                readback = new Texture2D(preview.Texture.width, preview.Texture.height,
                    TextureFormat.RGBA32, false);
                readback.ReadPixels(new Rect(0, 0, readback.width, readback.height), 0, 0);
                readback.Apply(false, false);
                string path = Path.GetFullPath(Path.Combine(Application.dataPath,
                    "../Temp/RoaGrip_" + itemId + ".png"));
                File.WriteAllBytes(path, readback.EncodeToPNG());
            }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.DestroyImmediate(readback);
            }
        }
    }
}
#endif
