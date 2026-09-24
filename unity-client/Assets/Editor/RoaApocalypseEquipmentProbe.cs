using System;
using System.IO;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseEquipmentProbe
    {
        private const string RequestName = "../Library/roa-apocalypse-equipment-probe.request";
        private static bool _enteredPlayMode;

        [InitializeOnLoadMethod]
        private static void RunIfRequested()
        {
            string request = Path.Combine(Application.dataPath, RequestName);
            if (!File.Exists(request)) return;
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(request)) return;
                File.Delete(request);
                if (EditorApplication.isPlaying) { Run(); return; }
                _enteredPlayMode = true;
                EditorApplication.playModeStateChanged += OnPlayModeChanged;
                EditorApplication.EnterPlaymode();
            };
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            Run();
        }

        [MenuItem("Realm of Ashes/PolygonApocalypse/Capture equipped character")]
        public static async void Run()
        {
            GameObject host = null;
            Texture2D readback = null;
            RenderTexture previous = RenderTexture.active;
            try
            {
                if (!Application.isPlaying)
                    throw new InvalidOperationException("Equipment probe requires Play Mode.");
                host = new GameObject("ApocalypseEquipmentProbe");
                var preview = host.AddComponent<RoaCharacterPreview>();
                preview.Show("http://127.0.0.1:3000", new CharacterAppearance
                    { Sex = "male", HairId = "short_crop", HairColorId = "hair_08" }, 480, 540);
                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                while (!preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!preview.IsReady) throw new TimeoutException("Character preview did not load.");
                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                if (character == null || !character.Ready)
                    throw new InvalidOperationException("Character body did not load.");
                Animation driver = character.GetComponentInChildren<Animation>(true);
                if (driver == null || driver.cullingType != AnimationCullingType.AlwaysAnimate)
                    throw new InvalidOperationException("The hidden source rig does not animate the pack body.");
                // Outfits can change after the player has travelled. Keep the
                // preview camera with the actor while moving both in world space.
                host.transform.position = new Vector3(13f, 0f, -9f);
                await character.EquipItems("http://127.0.0.1:3000", new JObject
                {
                    ["armor"] = "combatArmor",
                    ["helmet"] = "tacticalHelmet",
                    ["backpack"] = "backpack",
                    ["boots"] = "scoutBoots"
                });
                if (!character.HasLoadedEquipment("backpack", "backpack")
                    || !character.HasLoadedEquipment("armor", "combatArmor"))
                    throw new InvalidOperationException("The runtime outfit did not equip.");
                // Sample the gameplay idle before photographing attached equipment.
                Animation idle = character.GetComponentInChildren<Animation>(true);
                if (idle != null && idle["idle"] != null)
                {
                    idle.Play("idle");
                    idle.Sample();
                }
                character.UpdateLocomotion(Vector3.zero, 0f, false, false);
                await Task.Delay(150);
                character.GetComponent<RoaApocalypseCharacterSkin>()?.SyncPose();
                AssertPackBodyFollowsCharacter(character);
                readback = new Texture2D(preview.Texture.width, preview.Texture.height,
                    TextureFormat.RGBA32, false);
                Capture(preview, readback, "ApocalypseEquipmentFront.png");
                bool attached = false;
                foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                    if (node.name == "PolygonApocalypse_Spine_03_Accessory") attached = true;
                if (!attached) throw new InvalidOperationException("Pack backpack attachment is missing.");
                foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                    if (node.name == "Equipment:backpack")
                        foreach (Renderer renderer in node.GetComponentsInChildren<Renderer>(true))
                            if (renderer.enabled)
                                throw new InvalidOperationException("Legacy backpack is still visible: " + renderer.name);
                Transform accessory = null;
                foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                    if (node.name == "PolygonApocalypse_Spine_03_Accessory") accessory = node;
                Renderer pack = accessory?.GetComponentInChildren<Renderer>(true);
                if (pack == null) throw new InvalidOperationException("Pack backpack mesh is missing.");
                Vector3 packCenter = character.transform.InverseTransformPoint(pack.bounds.center);
                if (Mathf.Abs(packCenter.x) > 0.18f || packCenter.y < 1.05f
                    || packCenter.y > 1.7f || packCenter.z > -0.12f)
                    throw new InvalidOperationException("Pack backpack is not on the back: "
                        + packCenter.ToString("F3"));
                character.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
                Capture(preview, readback, "ApocalypseEquipmentBack.png");
                character.transform.localRotation = Quaternion.identity;
                Transform packAnkle = null;
                foreach (Transform node in character.transform.Find(RoaApocalypseVisuals.ChildName)
                    .GetComponentsInChildren<Transform>(true))
                    if (node.name == "Ankle_L") { packAnkle = node; break; }
                if (packAnkle == null || driver["walk"] == null)
                    throw new InvalidOperationException("Pack ankle or walk clip is missing.");
                driver.Play("walk");
                driver["walk"].time = driver["walk"].length * 0.1f;
                driver.Sample();
                character.GetComponent<RoaApocalypseCharacterSkin>().SyncPose();
                Vector3 firstAnkle = character.transform.InverseTransformPoint(packAnkle.position);
                Capture(preview, readback, "ApocalypseWalkA.png");
                driver["walk"].time = driver["walk"].length * 0.6f;
                driver.Sample();
                character.GetComponent<RoaApocalypseCharacterSkin>().SyncPose();
                Vector3 secondAnkle = character.transform.InverseTransformPoint(packAnkle.position);
                Capture(preview, readback, "ApocalypseWalkB.png");
                if (Vector3.Distance(firstAnkle, secondAnkle) < 0.12f)
                    throw new InvalidOperationException("Pack body did not follow the walking pose.");
                driver.Play("idle");
                driver.Sample();
                character.UpdateLocomotion(Vector3.zero, 0f, false, false);
                character.SetAim(character.transform.position + character.transform.forward * 5f
                    + Vector3.up * 1.3f, true);
                string[] weaponSamples =
                {
                    "polygonAssaultRifle02", "polygonRevolver02", "polygonKatana01",
                    "polygonGrenade01", "polygonVehMiniGun01"
                };
                foreach (string weaponId in weaponSamples)
                {
                    await character.EquipWeapon("http://127.0.0.1:3000", weaponId);
                    await Task.Delay(180);
                    if (character.WeaponId != weaponId)
                        throw new InvalidOperationException("Pack weapon did not equip: " + weaponId);
                    Transform weapon = null;
                    foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                        if (node.name == "Weapon:" + weaponId) { weapon = node; break; }
                    Transform visual = weapon?.Find(RoaApocalypseVisuals.ChildName);
                    bool visible = false;
                    if (visual != null)
                        foreach (Renderer renderer in visual.GetComponentsInChildren<Renderer>(true))
                            if (renderer.enabled) { visible = true; break; }
                    if (!visible)
                        throw new InvalidOperationException("Pack weapon visual did not replace GLB: " + weaponId);
                    Bounds visualBounds = RoaApocalypseVisuals.LocalBounds(weapon,
                        visual.GetComponentsInChildren<Renderer>(true));
                    Debug.Log("[ROA APOCALYPSE] " + weaponId + " bounds "
                        + visualBounds.size.ToString("F3"));
                    if (weaponId == "polygonGrenade01"
                        && Mathf.Max(visualBounds.size.x, visualBounds.size.y,
                            visualBounds.size.z) > 0.4f)
                        throw new InvalidOperationException("Pack grenade is too large in hand.");
                    if (weaponId == "polygonAssaultRifle02")
                        Capture(preview, readback, "ApocalypseWeaponAssault02.png");
                    if (weaponId == "polygonKatana01")
                    {
                        Capture(preview, readback, "ApocalypseWeaponKatana.png");
                        character.transform.localRotation = Quaternion.Euler(0f, 90f, 0f);
                        Capture(preview, readback, "ApocalypseWeaponKatanaSide.png");
                        character.transform.localRotation = Quaternion.identity;
                    }
                    if (weaponId == "polygonGrenade01")
                        Capture(preview, readback, "ApocalypseWeaponGrenade.png");
                }
                Debug.Log("[ROA APOCALYPSE] Equipment probe PASS: armor, backpack and five pack weapons visible.");
            }
            catch (Exception error) { Debug.LogError("[ROA APOCALYPSE] Equipment probe FAIL " + error); }
            finally
            {
                RenderTexture.active = previous;
                if (readback != null) UnityEngine.Object.Destroy(readback);
                if (host != null) UnityEngine.Object.Destroy(host);
                if (_enteredPlayMode)
                {
                    _enteredPlayMode = false;
                    EditorApplication.ExitPlaymode();
                }
            }
        }

        private static void AssertPackBodyFollowsCharacter(RoaCharacterView character)
        {
            Transform skin = character.transform.Find(RoaApocalypseVisuals.ChildName);
            if (skin == null) throw new InvalidOperationException("Pack character skin is missing.");
            Renderer body = null;
            foreach (Renderer renderer in character.GetComponentsInChildren<Renderer>(true))
                if (renderer.name == "body_base") { body = renderer; break; }
            if (body == null) throw new InvalidOperationException("Source body is missing.");
            bool found = false;
            Bounds packBounds = default;
            foreach (Renderer renderer in skin.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                if (!found) { packBounds = renderer.bounds; found = true; }
                else packBounds.Encapsulate(renderer.bounds);
            }
            if (!found) throw new InvalidOperationException("Pack character has no visible mesh.");
            Vector2 sourceCenter = new Vector2(body.bounds.center.x, body.bounds.center.z);
            Vector2 packCenter = new Vector2(packBounds.center.x, packBounds.center.z);
            if (Vector2.Distance(sourceCenter, packCenter) > 1.2f)
                throw new InvalidOperationException("Pack character stayed behind after outfit change: "
                    + Vector2.Distance(sourceCenter, packCenter).ToString("F2") + " m.");
        }

        private static void Capture(RoaCharacterPreview preview, Texture2D readback, string name)
        {
            if (!preview.RenderNow()) throw new InvalidOperationException("Preview render failed: " + name);
            RenderTexture.active = preview.Texture;
            readback.ReadPixels(new Rect(0, 0, preview.Texture.width, preview.Texture.height), 0, 0);
            readback.Apply();
            string path = Path.GetFullPath(Path.Combine(Application.dataPath, "../Temp/", name));
            File.WriteAllBytes(path, readback.EncodeToPNG());
        }
    }
}
