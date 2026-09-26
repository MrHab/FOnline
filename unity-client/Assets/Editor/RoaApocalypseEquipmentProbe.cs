using System;
using System.Collections.Generic;
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
            string report = Path.GetFullPath(Path.Combine(
                Application.dataPath, "../Temp/ApocalypseEquipmentProbe.txt"));
            if (File.Exists(report)) File.Delete(report);
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
                Camera previewCamera = host.GetComponentInChildren<Camera>(true);
                if (previewCamera != null)
                    previewCamera.backgroundColor = new Color(0.36f, 0.39f, 0.35f, 1f);
                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                if (character == null || !character.Ready)
                    throw new InvalidOperationException("Character body did not load.");
                Animation driver = character.GetComponentInChildren<Animation>(true);
                if (driver == null || driver.cullingType != AnimationCullingType.AlwaysAnimate)
                    throw new InvalidOperationException("The hidden source rig does not animate the pack body.");
                character.SetPresentationLod(RoaActorPresentationTier.Far);
                if (driver.cullingType != AnimationCullingType.AlwaysAnimate)
                    throw new InvalidOperationException("Far NPC LOD freezes the hidden animation rig.");
                character.SetPresentationLod(RoaActorPresentationTier.Near);
                if (driver.cullingType != AnimationCullingType.AlwaysAnimate)
                    throw new InvalidOperationException("Near NPC LOD freezes the hidden animation rig.");
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
                RoaApocalypseCharacterSkin activeSkin =
                    character.GetComponent<RoaApocalypseCharacterSkin>();
                activeSkin?.SyncPose();
                RoaVisibilityGate visibility = character.GetComponent<RoaVisibilityGate>();
                if (visibility == null) visibility = character.gameObject.AddComponent<RoaVisibilityGate>();
                visibility.SetVisible(false);
                visibility.SetVisible(true);
                int hiddenOriginalParts = 0;
                int visiblePackParts = 0;
                foreach (Renderer renderer in character.GetComponentsInChildren<Renderer>(true))
                {
                    if (activeSkin != null && activeSkin.HidesOriginalRenderer(renderer))
                    {
                        hiddenOriginalParts++;
                        if (renderer.enabled)
                            throw new InvalidOperationException("Fog restored the duplicate NPC body or gear: "
                                + renderer.name);
                    }
                    else if (renderer.enabled && renderer.gameObject.activeInHierarchy)
                        visiblePackParts++;
                }
                if (hiddenOriginalParts == 0 || visiblePackParts == 0)
                    throw new InvalidOperationException("Fog visibility check missed a character body.");
                if (Environment.GetEnvironmentVariable("ROA_EQUIPMENT_GATE_ONLY") == "1")
                {
                    File.WriteAllText(report,
                        "PASS: fog keeps the original body and equipment hidden while the pack body stays visible.");
                    return;
                }
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
                var skin = character.GetComponent<RoaApocalypseCharacterSkin>();
                Transform baseVisual = character.transform.Find(RoaApocalypseVisuals.ChildName);
                GameObject basePrefab = skin.ActivePrefab;
                await character.EquipWeapon("http://127.0.0.1:3000", "polygonAssaultRifle02");
                await Task.Delay(180);
                AssertWeaponVisible(character, "polygonAssaultRifle02");
                string[] armorSamples =
                {
                    "leather", "metalArmor", "ballisticVest", "combatArmor",
                    "heavyArmor", "hazmatSuit", "energySuit"
                };
                foreach (string armorId in armorSamples)
                {
                    await character.EquipItems("http://127.0.0.1:3000", new JObject
                    {
                        ["armor"] = armorId, ["helmet"] = "helmet",
                        ["backpack"] = "backpack", ["boots"] = "boots"
                    });
                    await Task.Delay(120);
                    skin.SyncPose();
                    if (!character.HasLoadedEquipment("armor", armorId)
                        || skin.ActivePrefab != basePrefab || skin.ActiveArmorId != armorId
                        || character.transform.Find(RoaApocalypseVisuals.ChildName) != baseVisual)
                        throw new InvalidOperationException("Armor changed the person or failed to equip: " + armorId
                            + " loaded=" + character.HasLoadedEquipment("armor", armorId)
                            + " prefab=" + (skin.ActivePrefab == basePrefab)
                            + " armor=" + skin.ActiveArmorId
                            + " visual=" + (character.transform.Find(RoaApocalypseVisuals.ChildName) == baseVisual));
                    AssertWeaponVisible(character, "polygonAssaultRifle02");
                    Transform armor = baseVisual.Find("PolygonApocalypse_Armor:" + armorId);
                    SkinnedMeshRenderer garment = armor?.GetComponent<SkinnedMeshRenderer>();
                    if (garment == null || !garment.enabled || !garment.gameObject.activeInHierarchy
                        || garment.gameObject.layer != character.gameObject.layer
                        || garment.sharedMesh == null || garment.sharedMesh.triangles.Length < 300)
                        throw new InvalidOperationException("Armor garment is not visible: " + armorId);
                    if (armorId == "heavyArmor" && skin.ActiveArmorParts < 6)
                        throw new InvalidOperationException("Bastion is missing native metal plates: "
                            + skin.ActiveArmorParts);
                    if (armorId == "ballisticVest")
                        Capture(preview, readback, "ApocalypseBallisticVest.png");
                    if (armorId == "combatArmor")
                        Capture(preview, readback, "ApocalypseCombatArmor.png");
                    if (armorId == "heavyArmor")
                        Capture(preview, readback, "ApocalypseHeavyArmor.png");
                }
                string[] helmetSamples =
                {
                    "weldedHelmet", "helmet", "tacticalHelmet",
                    "assaultHelmet", "preWarHelmet"
                };
                var seenHelmets = new HashSet<GameObject>();
                foreach (string helmetId in helmetSamples)
                {
                    await character.EquipItems("http://127.0.0.1:3000", new JObject
                    {
                        ["armor"] = "combatArmor", ["helmet"] = helmetId,
                        ["backpack"] = "backpack", ["boots"] = "boots"
                    });
                    skin.SyncPose();
                    if (skin.ActiveHelmetPrefab != RoaApocalypseModels.Item(helmetId)
                        || !seenHelmets.Add(skin.ActiveHelmetPrefab))
                        throw new InvalidOperationException("Helmet did not change to its own model: " + helmetId);
                }
                string[] bootSamples =
                {
                    "boots", "scoutBoots", "reinforcedBoots", "assaultBoots"
                };
                int[] expectedParts = { 2, 2, 2, 4 };
                var footwearMeshes = new HashSet<Mesh>();
                for (int i = 0; i < bootSamples.Length; i++)
                {
                    await character.EquipItems("http://127.0.0.1:3000", new JObject
                    {
                        ["armor"] = "combatArmor", ["helmet"] = "helmet",
                        ["backpack"] = "backpack", ["boots"] = bootSamples[i]
                    });
                    skin.SyncPose();
                    if (skin.ActiveFootwearId != bootSamples[i]
                        || skin.ActiveFootwearParts != expectedParts[i])
                        throw new InvalidOperationException("Footwear did not change: " + bootSamples[i]);
                    Transform boot = baseVisual.Find("PolygonApocalypse_Footwear:" + bootSamples[i]);
                    SkinnedMeshRenderer bootRenderer = boot?.GetComponent<SkinnedMeshRenderer>();
                    if (bootRenderer == null || bootRenderer.sharedMesh == null
                        || bootRenderer.sharedMesh.triangles.Length < 300
                        || !footwearMeshes.Add(bootRenderer.sharedMesh))
                        throw new InvalidOperationException("Footwear lacks its own full shoe mesh: " + bootSamples[i]);
                    Capture(preview, readback, "ApocalypseBoots_" + bootSamples[i] + ".png");
                }
                Transform visibleHead = null;
                foreach (Transform node in baseVisual.GetComponentsInChildren<Transform>(true))
                    if (node.name == "Head") { visibleHead = node; break; }
                if (visibleHead == null) throw new InvalidOperationException("Visible head bone is missing.");
                float standingHeadY = visibleHead.position.y;
                for (int i = 0; i < 24; i++)
                {
                    character.UpdateLocomotion(Vector3.zero, 0f, false, true);
                    await Task.Delay(20);
                }
                skin.SyncPose();
                Capture(preview, readback, "ApocalypseCrouch.png");
                if (standingHeadY - visibleHead.position.y < 0.12f)
                    throw new InvalidOperationException("Visible character does not crouch.");
                for (int i = 0; i < 24; i++)
                {
                    character.UpdateLocomotion(Vector3.zero, 0f, false, false);
                    await Task.Delay(20);
                }
                Debug.Log("[ROA APOCALYPSE] Wardrobe PASS: seven armor layers, stable character and weapon, five helmets, four footwear variants.");
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
                    Transform visual = AssertWeaponVisible(character, weaponId);
                    Transform weapon = visual.parent;
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
                string gripReport = Path.GetFullPath(Path.Combine(
                    Application.dataPath, "../Temp/ApocalypseWeaponGripProbe.txt"));
                var gripLines = new List<string>();
                foreach (RoaApocalypseModels.WeaponEntry entry in RoaApocalypseModels.WeaponEntries)
                {
                    await character.EquipWeapon("http://127.0.0.1:3000", entry.itemId);
                    await Task.Delay(100);
                    if (!character.WeaponReady)
                        throw new InvalidOperationException("Weapon did not load: " + entry.itemId);
                    Transform visual = AssertWeaponVisible(character, entry.itemId);
                    Transform grip = RoaItemModelCatalog.FindSocket(visual.parent, "socket_grip_r");
                    skin.SyncPose();
                    Transform palm = skin.VisibleHand(false);
                    Transform sourcePalm = null, sourceLeft = null;
                    foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                    {
                        if (node.name == "hand_r") sourcePalm = node;
                        if (node.name == "hand_l") sourceLeft = node;
                    }
                    Transform visibleLeft = skin.VisibleHand(true);
                    if (grip == null || palm == null || sourcePalm == null
                        || sourceLeft == null || visibleLeft == null)
                        throw new InvalidOperationException("Weapon grip or visible hand is missing: " + entry.itemId);
                    float gap = Vector3.Distance(grip.position, palm.position);
                    float sourceGap = sourcePalm != null ? Vector3.Distance(grip.position, sourcePalm.position) : -1f;
                    float retargetGap = sourcePalm != null ? Vector3.Distance(palm.position, sourcePalm.position) : -1f;
                    float leftGap = Vector3.Distance(visibleLeft.position, sourceLeft.position);
                    Transform sourceShoulder = null, visibleShoulder = null;
                    foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                    {
                        if (node.name == "clavicle_r") sourceShoulder = node;
                        if (node.name == "Clavicle_R") visibleShoulder = node;
                    }
                    gripLines.Add(entry.itemId + ": grip " + gap.ToString("F3")
                        + " m, source " + sourceGap.ToString("F3")
                        + " m, retarget " + retargetGap.ToString("F3")
                        + " m, left " + leftGap.ToString("F3") + " m"
                        + ", shoulders " + (sourceShoulder != null && visibleShoulder != null
                            ? Vector3.Distance(sourceShoulder.position, visibleShoulder.position).ToString("F3") : "missing")
                        + ", reach " + (visibleShoulder != null
                            ? Vector3.Distance(visibleShoulder.position, sourcePalm.position).ToString("F3") : "missing")
                        + ", sourcePalm " + character.transform.InverseTransformPoint(sourcePalm.position).ToString("F3")
                        + ", visiblePalm " + character.transform.InverseTransformPoint(palm.position).ToString("F3"));
                    File.WriteAllLines(gripReport, gripLines);
                    if (retargetGap > 0.10f || leftGap > 0.10f)
                        throw new InvalidOperationException("Visible hand misses " + entry.itemId
                            + " source palm by " + retargetGap.ToString("F3")
                            + "/" + leftGap.ToString("F3") + " m");
                    if (entry.itemId == "shotgun")
                        Capture(preview, readback, "ApocalypseShotgun.png");
                    if (entry.itemId == "sawedOffShotgun")
                        Capture(preview, readback, "ApocalypseSawedOffShotgun.png");
                }
                await character.EquipWeapon("http://127.0.0.1:3000", "medkit");
                await Task.Delay(180);
                Transform medical = null;
                foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                    if (node.name == "ItemModel:medkit") { medical = node; break; }
                if (!character.WeaponReady || medical == null
                    || !medical.IsChildOf(skin.VisibleHand(false)))
                    throw new InvalidOperationException("Medkit is not in the visible right hand.");
                Capture(preview, readback, "ApocalypseMedkit.png");
                gripLines.Add("medkit: visible right hand");
                File.WriteAllLines(gripReport, gripLines);
                await ValidateFemaleArmor();
                File.WriteAllText(report,
                    "PASS: seven wearable armor layers for each sex, stable person and weapon, five helmets, four footwear variants and backpack.");
                Debug.Log("[ROA APOCALYPSE] Equipment probe PASS: armor, backpack and five pack weapons visible.");
            }
            catch (Exception error)
            {
                File.WriteAllText(report, "FAIL: " + error);
                Debug.LogError("[ROA APOCALYPSE] Equipment probe FAIL " + error);
            }
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

        private static async Task ValidateFemaleArmor()
        {
            GameObject host = null;
            Texture2D readback = null;
            try
            {
                host = new GameObject("ApocalypseFemaleWardrobeProbe");
                var preview = host.AddComponent<RoaCharacterPreview>();
                preview.Show("http://127.0.0.1:3000", new CharacterAppearance
                    { Sex = "female", HairId = "short_crop", HairColorId = "hair_08" }, 360, 450);
                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                while (!preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!preview.IsReady) throw new TimeoutException("Female character preview did not load.");
                Camera previewCamera = host.GetComponentInChildren<Camera>(true);
                if (previewCamera != null)
                    previewCamera.backgroundColor = new Color(0.36f, 0.39f, 0.35f, 1f);
                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                RoaApocalypseCharacterSkin skin = character?.GetComponent<RoaApocalypseCharacterSkin>();
                if (character == null || skin == null)
                    throw new InvalidOperationException("Female character skin is missing.");
                readback = new Texture2D(preview.Texture.width, preview.Texture.height,
                    TextureFormat.RGBA32, false);
                Transform baseVisual = character.transform.Find(RoaApocalypseVisuals.ChildName);
                GameObject basePrefab = skin.ActivePrefab;
                foreach (string armorId in new[]
                    { "leather", "metalArmor", "ballisticVest", "combatArmor",
                      "heavyArmor", "hazmatSuit", "energySuit" })
                {
                    await character.EquipItems("http://127.0.0.1:3000", new JObject
                    {
                        ["armor"] = armorId, ["helmet"] = "helmet",
                        ["backpack"] = "backpack", ["boots"] = "boots"
                    });
                    skin.SyncPose();
                    if (!character.HasLoadedEquipment("armor", armorId)
                        || skin.ActivePrefab != basePrefab || skin.ActiveArmorId != armorId
                        || character.transform.Find(RoaApocalypseVisuals.ChildName) != baseVisual)
                        throw new InvalidOperationException("Female armor changed the person: " + armorId);
                    Capture(preview, readback, "ApocalypseFemale_" + armorId + ".png");
                }
                Debug.Log("[ROA APOCALYPSE] Female wardrobe PASS: seven wearable armor layers.");
            }
            finally
            {
                if (readback != null) UnityEngine.Object.Destroy(readback);
                if (host != null) UnityEngine.Object.Destroy(host);
            }
        }

        private static Transform AssertWeaponVisible(RoaCharacterView character, string weaponId)
        {
            Transform weapon = null;
            foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                if (node.name == "Weapon:" + weaponId) { weapon = node; break; }
            Transform visual = weapon?.Find(RoaApocalypseVisuals.ChildName);
            if (visual != null)
                foreach (Renderer renderer in visual.GetComponentsInChildren<Renderer>(true))
                    if (renderer.enabled && renderer.gameObject.activeInHierarchy) return visual;
            throw new InvalidOperationException("Pack weapon is missing after equipment change: " + weaponId);
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
