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
    /// <summary>
    /// Лукбук экипировки: надевает на персонажа каждую базовую носимую вещь
    /// и каждое оружие из data/kromka/items.json по одной и снимает спереди и сзади.
    /// Тировые варианты носятся моделью базовой вещи, поэтому снимаются только базы.
    /// Кадры и отчёт ложатся в Temp/EquipmentLookbook/.
    /// </summary>
    public static class RoaEquipmentLookbookProbe
    {
        private const string Menu = "Realm of Ashes/Снять лукбук экипировки";
        private const string PendingKey = "RoaEquipmentLookbookProbe.Pending";
        private const string BaseUrl = "http://127.0.0.1:3000";
        private static readonly string[] WornSlots =
            { "armor", "helmet", "boots", "backpack", "detector", "artifactBelt" };

        [MenuItem(Menu)]
        public static void Start()
        {
            if (EditorApplication.isPlaying) { Run(); return; }
            SessionState.SetBool(PendingKey, true);
            EditorApplication.EnterPlaymode();
        }

        [InitializeOnLoadMethod]
        private static void ResumeInPlayMode()
        {
            EditorApplication.playModeStateChanged += state =>
            {
                if (state != PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(PendingKey, false)) return;
                SessionState.EraseBool(PendingKey);
                Run();
            };
        }

        private static async void Run()
        {
            string dir = Path.GetFullPath(Path.Combine(Application.dataPath, "../Temp/EquipmentLookbook"));
            // "equipprobe" hands the play session to the wardrobe regression probe
            // (it asserts and exits Play Mode itself; report in Temp/ApocalypseEquipmentProbe.txt).
            string onlyFile = Path.Combine(Path.GetDirectoryName(dir), "EquipmentLookbook.only");
            if (File.Exists(onlyFile) && File.ReadAllText(onlyFile).Trim() == "equipprobe")
            {
                // The probe leaves Play Mode only when it entered it itself: wait
                // for its report and leave here, so the shared editor is not held.
                string probeReport = Path.GetFullPath(Path.Combine(
                    Application.dataPath, "../Temp/ApocalypseEquipmentProbe.txt"));
                if (File.Exists(probeReport)) File.Delete(probeReport);
                RoaApocalypseEquipmentProbe.Run();
                DateTime until = DateTime.UtcNow.AddMinutes(12);
                while (!File.Exists(probeReport) && DateTime.UtcNow < until && EditorApplication.isPlaying)
                    await Task.Delay(500);
                await Task.Delay(500);
                if (EditorApplication.isPlaying) EditorApplication.ExitPlaymode();
                return;
            }
            string report = Path.Combine(dir, "report.txt");
            var lines = new List<string>();
            GameObject host = null;
            Texture2D readback = null;
            try
            {
                if (File.Exists(report)) File.Delete(report);
                Directory.CreateDirectory(dir);
                // Optional Temp/EquipmentLookbook.only: comma list of item ids or slots to shoot.
                string onlyPath = Path.Combine(Path.GetDirectoryName(dir), "EquipmentLookbook.only");
                var only = File.Exists(onlyPath)
                    ? new HashSet<string>(File.ReadAllText(onlyPath).Replace(",", " ").Split((char[])null,
                        StringSplitOptions.RemoveEmptyEntries))
                    : null;
                bool Wanted(string slot, string id) => only == null || only.Contains(slot) || only.Contains(id);
                JObject catalog = JObject.Parse(File.ReadAllText(Path.GetFullPath(
                    Path.Combine(Application.dataPath, "../../data/kromka/items.json"))));
                JArray items = (JArray)catalog["items"];
                // Looks (visualId) come from the checkout's data, not from whatever the server loaded.
                if (!RoaItemData.ApplyCatalog(catalog, out string catalogError))
                    lines.Add("catalog not applied: " + catalogError);

                host = new GameObject("EquipmentLookbookProbe");
                var preview = host.AddComponent<RoaCharacterPreview>();
                preview.Show(BaseUrl, new CharacterAppearance
                    { Sex = "male", HairId = "short_crop", HairColorId = "hair_08" }, 600, 760);
                DateTime deadline = DateTime.UtcNow.AddSeconds(60);
                while (!preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
                if (!preview.IsReady) throw new TimeoutException("Character preview did not load.");
                Camera camera = host.GetComponentInChildren<Camera>(true);
                if (camera != null) camera.backgroundColor = new Color(0.36f, 0.39f, 0.35f, 1f);
                RoaCharacterView character = host.GetComponentInChildren<RoaCharacterView>(true);
                RoaApocalypseCharacterSkin skin = character.GetComponent<RoaApocalypseCharacterSkin>();
                readback = new Texture2D(preview.Texture.width, preview.Texture.height, TextureFormat.RGBA32, false);

                // "kit": weapons are shot in the full heavy kit (the bulkiest look the arms
                // must clear); "kitarmor=<id>" swaps the armor of that kit.
                bool useKit = only != null && only.Contains("kit");
                string kitArmor = "heavyArmor";
                if (only != null)
                    foreach (string token in only)
                        if (token.StartsWith("kitarmor=")) kitArmor = token.Substring(9);
                JObject Kit(string armor) => new JObject
                {
                    ["armor"] = armor, ["helmet"] = "assaultHelmet", ["boots"] = "reinforcedBoots",
                    ["backpack"] = "backpack", ["detector"] = "artifactDetectorMk3", ["artifactBelt"] = "artifactBelt4"
                };

                await Dress(character, skin, new JObject(), "fists");
                Capture(preview, character, readback, dir, "00_base");

                if (only != null && only.Contains("idle"))
                {
                    // Empty hands at rest: bare, then every armor inside the full kit, sampled
                    // at three moments of the idle clip.
                    var looks = new List<string> { "bare" };
                    foreach (JToken row in items)
                        if (row.Value<string>("slot") == "armor") looks.Add(row.Value<string>("id"));
                    foreach (string look in looks)
                    {
                        await Dress(character, skin, look == "bare" ? new JObject() : Kit(look), null);
                        for (int k = 0; k < 3; k++)
                        {
                            DateTime next = DateTime.UtcNow.AddMilliseconds(k == 0 ? 200 : 900);
                            while (DateTime.UtcNow < next)
                            {
                                character.UpdateLocomotion(Vector3.zero, character.transform.eulerAngles.y, false, false);
                                await Task.Yield();
                            }
                            skin.SyncPose();
                            string tag = "idle_" + look + "_t" + k;
                            string SourceElbow(string side)
                            {
                                Transform up = null, low = null, hand = null;
                                foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                                {
                                    if (node.name == "upperarm_" + side) up = node;
                                    if (node.name == "lowerarm_" + side) low = node;
                                    if (node.name == "hand_" + side) hand = node;
                                }
                                if (up == null || low == null || hand == null) return "-";
                                return Vector3.Angle(up.position - low.position, hand.position - low.position).ToString("F0")
                                    + " hand " + character.transform.InverseTransformPoint(hand.position).ToString("F2")
                                    + " sh " + character.transform.InverseTransformPoint(up.position).ToString("F2");
                            }
                            lines.Add("  source R " + SourceElbow("r") + " | L " + SourceElbow("l"));
                            lines.Add("idle " + tag + " clip " + character.CurrentClip + " phase " + character.CurrentClipPhase.ToString("F2")
                                + " body " + BodyReport(character));
                            Shot(preview, readback, Path.Combine(dir, tag + "_front.png"));
                            character.transform.localRotation = Quaternion.Euler(0f, 270f, 0f);
                            skin.SyncPose();
                            Shot(preview, readback, Path.Combine(dir, tag + "_right.png"));
                            character.transform.localRotation = Quaternion.Euler(0f, 90f, 0f);
                            skin.SyncPose();
                            Shot(preview, readback, Path.Combine(dir, tag + "_left.png"));
                            character.transform.localRotation = Quaternion.identity;
                        }
                    }
                }

                foreach (JToken row in items)
                {
                    string id = row.Value<string>("id");
                    string slot = row.Value<string>("slot");
                    if (Array.IndexOf(WornSlots, slot) < 0 || !Wanted(slot, id)) continue;
                    await Dress(character, skin, new JObject { [slot] = id }, "fists");
                    bool loaded = character.HasLoadedEquipment(slot, id);
                    lines.Add(slot + "\t" + id + "\t" + (loaded ? "loaded" : "NOT LOADED"));
                    if (only != null)
                        foreach (SkinnedMeshRenderer r in character.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                            if (r.name.StartsWith("PolygonApocalypse_Armor:"))
                                lines.Add("  garment " + r.name + " mesh " + (r.sharedMesh != null ? r.sharedMesh.name
                                    + " tris " + r.sharedMesh.triangles.Length / 3 : "-") + " enabled " + r.enabled
                                    + " active " + r.gameObject.activeInHierarchy + " bounds " + r.bounds.center.ToString("F2")
                                    + " " + r.bounds.size.ToString("F2") + " root " + (r.rootBone != null ? r.rootBone.name : "-"));
                    Capture(preview, character, readback, dir, slot + "_" + id);
                }

                await Dress(character, skin, new JObject
                {
                    ["armor"] = "combatArmor", ["helmet"] = "tacticalHelmet",
                    ["boots"] = "assaultBoots", ["backpack"] = "backpack",
                    ["detector"] = "artifactDetectorMk2", ["artifactBelt"] = "artifactBelt3"
                }, "assaultRifle");
                Capture(preview, character, readback, dir, "01_full_kit");

                character.SetAim(character.transform.position + character.transform.forward * 5f
                    + Vector3.up * 1.3f, true);
                // The game's own catalog download may land after the first apply.
                RoaItemData.ApplyCatalog(catalog, out _);
                foreach (JToken row in items)
                {
                    string id = row.Value<string>("id");
                    if (row.Value<string>("slot") != "weapon" || id == "fists" || !Wanted("weapon", id)) continue;
                    await Dress(character, skin, useKit ? Kit(kitArmor) : new JObject(), id);
                    lines.Add("weapon\t" + id + "\t" + (character.WeaponReady && character.WeaponId == id
                        ? "loaded" : "NOT LOADED"));
                    if (only != null)
                        foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                            if (node.name.StartsWith("Weapon:"))
                                foreach (Renderer r in node.GetComponentsInChildren<Renderer>(true))
                                    if (r.enabled && r.gameObject.activeInHierarchy)
                                        lines.Add("  renderer " + r.name
                                            + " meshZ " + character.transform.InverseTransformDirection(r.transform.forward).ToString("F2")
                                            + " meshX " + character.transform.InverseTransformDirection(r.transform.right).ToString("F2")
                                            + " mesh "
                                            + (r.GetComponent<MeshFilter>()?.sharedMesh?.name ?? "-")
                                            + " size " + r.bounds.size.ToString("F3")
                                            + " scale " + r.transform.lossyScale.ToString("F3"));
                    Capture(preview, character, readback, dir, "weapon_" + id, backToo: false, side: true);
                    if (useKit)
                    {
                        character.transform.localRotation = Quaternion.Euler(0f, 270f, 0f);
                        skin.SyncPose();
                        Shot(preview, readback, Path.Combine(dir, "weapon_" + id + "_right.png"));
                        character.transform.localRotation = Quaternion.identity;
                        skin.SyncPose();
                    }
                    if (only != null)
                    {
                        RoaWeaponView held = character.HeldWeapon;
                        lines.Add("  hold " + (held != null ? held.HoldKind + " active=" + held.HoldActive
                            + " stowed=" + held.Stowed : "-") + " archetype=" + skin.HoldArchetype
                            + " missRight=" + skin.HoldMissPrimary.ToString("F3")
                            + " missLeft=" + skin.HoldMissSupport.ToString("F3")
                            + " armorShift=" + skin.DebugGripShift.ToString("F3"));
                        skin.SyncPose();
                        lines.Add("  push R " + skin.DebugArmPushRight + " L " + skin.DebugArmPushLeft
                            + " grip " + skin.ArmorGripDepth.ToString("F2"));
                        lines.Add("  body " + BodyReport(character));
                    }
                    RoaWeaponView swung = character.HeldWeapon;
                    if (only != null && only.Contains("swing") && swung != null
                        && (swung.HoldKind != "LongGun" && swung.HoldKind != "Pistol" && swung.HoldKind != "SawedOff"
                            && swung.HoldKind != "HipGun" && swung.HoldKind != "Launcher"))
                    {
                        // A slowed strike (1.4 s) sampled at its phases; the pose is rebuilt
                        // right before each measurement and shot.
                        // 4 s: the weapon pose lags the read phase by one frame, and an
                        // unfocused editor runs slowly — at 1.4 s that lag was up to 0.1 phase.
                        // "walk": the same strike while the walk clip plays (gait keeps the legs).
                        bool walkStrike = only.Contains("walk");
                        if (walkStrike)
                        {
                            for (int i = 0; i < 20; i++)
                            {
                                character.UpdateLocomotion(character.transform.forward * 1.4f,
                                    character.transform.eulerAngles.y, true, false);
                                await Task.Yield();
                            }
                        }
                        character.PlayAttack(4f);
                        foreach (float target in new[] { 0.2f, 0.4f, 0.5f, 0.58f, 0.7f, 0.85f })
                        {
                            DateTime until = DateTime.UtcNow.AddSeconds(4);
                            while (swung.DebugAttackPhase < target && swung.DebugAttackPhase >= 0f && DateTime.UtcNow < until)
                            {
                                if (walkStrike)
                                    character.UpdateLocomotion(character.transform.forward * 1.4f,
                                        character.transform.eulerAngles.y, true, false);
                                await Task.Yield();
                            }
                            float phase = swung.DebugAttackPhase;
                            skin.SyncPose();
                            foreach (Transform node in character.GetComponentsInChildren<Transform>(true))
                                if (node.name == RoaApocalypseVisuals.ChildName && node.parent != null && node.parent.name.StartsWith("Weapon:"))
                                    lines.Add("  swingAxis " + phase.ToString("F2") + " meshZ "
                                        + character.transform.InverseTransformDirection(node.forward).ToString("F2")
                                        + " at " + character.transform.InverseTransformPoint(node.position).ToString("F2"));
                            Transform visualRoot = character.transform.Find(RoaApocalypseVisuals.ChildName);
                            Vector3 footL = Vector3.zero, footR = Vector3.zero;
                            foreach (Transform node in visualRoot.GetComponentsInChildren<Transform>(true))
                            {
                                if (node.name == "Ankle_L") footL = character.transform.InverseTransformPoint(node.position);
                                if (node.name == "Ankle_R") footR = character.transform.InverseTransformPoint(node.position);
                            }
                            lines.Add("  feet " + phase.ToString("F2") + " clip " + character.CurrentClip + " step "
                                + skin.LungeStepOffset.ToString("F2") + " L " + footL.ToString("F2") + " R " + footR.ToString("F2"));
                            lines.Add("  swing " + phase.ToString("F2") + " missRight=" + skin.HoldMissPrimary.ToString("F3")
                                + " missLeft=" + skin.HoldMissSupport.ToString("F3") + " body " + BodyReport(character));
                            string tag = "weapon_" + id + (walkStrike ? "_walkswing" : "_swing") + Mathf.RoundToInt(target * 100f);
                            Shot(preview, readback, Path.Combine(dir, tag + "_front.png"));
                            character.transform.localRotation = Quaternion.Euler(0f, 270f, 0f);
                            skin.SyncPose();
                            Shot(preview, readback, Path.Combine(dir, tag + "_right.png"));
                            character.transform.localRotation = Quaternion.identity;
                        }
                        await Task.Delay(1500);
                    }
                    if (only != null && only.Contains("closeup"))
                    {
                        // Grip review: two more turns and the hands at twice the zoom.
                        foreach (float yaw in new[] { 45f, 135f, 270f })
                        {
                            character.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
                            Shot(preview, readback, Path.Combine(dir, "weapon_" + id + "_yaw" + yaw + ".png"));
                        }
                        float fov = preview.FieldOfView;
                        preview.FieldOfView = fov * 0.45f;
                        // The camera looks at the hips: lower the actor so chest-high hands are centred.
                        Vector3 standing = character.transform.localPosition;
                        character.transform.localPosition = standing - Vector3.up * 0.28f;
                        foreach (float yaw in new[] { 0f, 45f, 90f, 270f })
                        {
                            character.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
                            Shot(preview, readback, Path.Combine(dir, "weapon_" + id + "_close" + yaw + ".png"));
                        }
                        preview.FieldOfView = fov;
                        character.transform.localPosition = standing;
                        character.transform.localRotation = Quaternion.identity;
                    }
                }
                if (only != null && only.Contains("fists"))
                {
                    // Jab + cross with empty hands, standing and while walking; slowed
                    // time so the phases can be sampled in an unfocused editor.
                    await Dress(character, skin, new JObject(), null);
                    foreach (bool walking in new[] { false, true })
                    {
                        Vector3 move = walking ? character.transform.forward * 1.4f : Vector3.zero;
                        for (int i = 0; i < 20; i++)
                        {
                            character.UpdateLocomotion(move, character.transform.eulerAngles.y, walking, false);
                            await Task.Yield();
                        }
                        foreach (string punch in new[] { "jab", "cross" })
                        {
                            Time.timeScale = 0.12f;
                            character.PlayAttack(0f);
                            foreach (float target in new[] { 0.15f, 0.3f, 0.45f, 0.6f, 0.8f })
                            {
                                DateTime until = DateTime.UtcNow.AddSeconds(8);
                                while (character.DebugPunchPhase < target && character.DebugPunchPhase >= 0f && DateTime.UtcNow < until)
                                {
                                    character.UpdateLocomotion(move, character.transform.eulerAngles.y, walking, false);
                                    await Task.Yield();
                                }
                                skin.SyncPose();
                                Transform visualRoot = character.transform.Find(RoaApocalypseVisuals.ChildName);
                                Vector3 footL = Vector3.zero, footR = Vector3.zero;
                                foreach (Transform node in visualRoot.GetComponentsInChildren<Transform>(true))
                                {
                                    if (node.name == "Ankle_L") footL = character.transform.InverseTransformPoint(node.position);
                                    if (node.name == "Ankle_R") footR = character.transform.InverseTransformPoint(node.position);
                                    if (node.name == "Hand_L" || node.name == "Hand_R" || node.name == "Shoulder_L" || node.name == "Shoulder_R")
                                        lines.Add("  fistpoint " + node.name + " " + character.transform.InverseTransformPoint(node.position).ToString("F2"));
                                }
                                string tag = "fists_" + (walking ? "walk" : "stand") + "_" + punch + Mathf.RoundToInt(target * 100f);
                                lines.Add("fists " + tag + " phase " + character.DebugPunchPhase.ToString("F2")
                                    + " clip " + character.CurrentClip + " upper " + character.UpperBodyPunch
                                    + " L " + footL.ToString("F2") + " R " + footR.ToString("F2")
                                    + " body " + BodyReport(character));
                                Shot(preview, readback, Path.Combine(dir, tag + "_front.png"));
                                character.transform.localRotation = Quaternion.Euler(0f, 270f, 0f);
                                skin.SyncPose();
                                Shot(preview, readback, Path.Combine(dir, tag + "_right.png"));
                                character.transform.localRotation = Quaternion.identity;
                            }
                            while (character.PunchActive)
                            {
                                character.UpdateLocomotion(move, character.transform.eulerAngles.y, walking, false);
                                await Task.Yield();
                            }
                            Time.timeScale = 1f;
                        }
                    }
                }
                lines.Insert(0, "PASS");
                Debug.Log("[ROA LOOKBOOK] PASS: " + (lines.Count - 1) + " items captured to " + dir);
            }
            catch (Exception error)
            {
                lines.Insert(0, "FAIL: " + error);
                Debug.LogError("[ROA LOOKBOOK] FAIL " + error);
            }
            finally
            {
                File.WriteAllLines(report, lines);
                Time.timeScale = 1f;
                if (readback != null) UnityEngine.Object.Destroy(readback);
                if (host != null) UnityEngine.Object.Destroy(host);
                EditorApplication.ExitPlaymode();
            }
        }

        /// <summary>
        /// Both visible arms measured in the body's own frame (right = shoulder line,
        /// up = world up), so a stance that twists the chest does not skew them.
        /// Per arm: elbow angle (180 = straight), elbow below the shoulder–wrist line
        /// (drop > 0 natural, < 0 = elbow raised) and outward from it (out < 0 = elbow
        /// tucked across the body), and the deepest point of the upper-arm/forearm axis
        /// inside the torso, an ellipse around the hips–neck line: half-width 0.14 m,
        /// half-depth 0.11 m, grown by 4 cm for the arm's own thickness (depth 0 = clear,
        /// 1 = on the spine). The first quarter of the upper arm sits on the shoulder
        /// joint and is skipped.
        /// </summary>
        private static string BodyReport(RoaCharacterView character)
        {
            var skin = character.GetComponent<RoaApocalypseCharacterSkin>();
            Transform visual = character.transform.Find(RoaApocalypseVisuals.ChildName);
            Transform Bone(string name)
            {
                foreach (Transform node in visual.GetComponentsInChildren<Transform>(true))
                    if (node.name == name) return node;
                return null;
            }
            (Transform shoulder, Transform elbow, Transform hand) Arm(bool left)
            {
                Transform hand = skin.VisibleHand(left), elbow = null, shoulder = null;
                for (Transform up = hand != null ? hand.parent : null; up != null; up = up.parent)
                {
                    if (elbow == null && up.name.StartsWith("Elbow")) elbow = up;
                    else if (elbow != null && up.name.StartsWith("Shoulder")) { shoulder = up; break; }
                }
                return (shoulder, elbow, hand);
            }
            var right = Arm(false);
            var left = Arm(true);
            Transform hips = Bone("Hips"), neck = Bone("Neck");
            if (right.shoulder == null || left.shoulder == null || hips == null || neck == null) return "bones missing";
            Vector3 across = Vector3.ProjectOnPlane(right.shoulder.position - left.shoulder.position, Vector3.up).normalized;
            Vector3 forward = Vector3.Cross(across, Vector3.up);
            Vector3 Frame(Vector3 world, Vector3 origin) =>
                new Vector3(Vector3.Dot(world - origin, across), (world - origin).y, Vector3.Dot(world - origin, forward));
            Vector3 h = hips.position, n = neck.position;
            string One(string label, (Transform shoulder, Transform elbow, Transform hand) arm, float sign)
            {
                Vector3 s = Frame(arm.shoulder.position, h), e = Frame(arm.elbow.position, h), w = Frame(arm.hand.position, h);
                float angle = Vector3.Angle(s - e, w - e);
                Vector3 line = w - s;
                Vector3 off = (e - s) - Vector3.Project(e - s, line);
                float depth = 0f;
                string where = "";
                for (int seg = 0; seg < 2; seg++)
                {
                    Vector3 a = seg == 0 ? s : e, b = seg == 0 ? e : w;
                    for (float t = seg == 0 ? 0.25f : 0f; t <= 1.001f; t += 0.1f)
                    {
                        Vector3 p = Vector3.Lerp(a, b, t);
                        Vector3 top = Frame(n, h);
                        if (p.y < -0.05f || p.y > top.y) continue;
                        Vector3 axis = Vector3.Lerp(Vector3.zero, top, Mathf.InverseLerp(0f, top.y, p.y));
                        float dx = (p.x - axis.x) / 0.18f, dz = (p.z - axis.z) / 0.15f;
                        float inside = 1f - Mathf.Sqrt(dx * dx + dz * dz);
                        if (inside > depth) { depth = inside; where = (seg == 0 ? "upperArm" : "forearm") + "@" + t.ToString("F1"); }
                    }
                }
                // Wrist over the thigh: below the belt, less than 20 cm ahead of the hips and
                // within the leg span — the fist sits on the leg instead of in front of the body.
                bool thigh = w.y < 0.12f && w.z < 0.2f && Mathf.Abs(w.x) < 0.22f;
                return label + ": elbow " + angle.ToString("F0") + "° drop " + (-off.y).ToString("F2")
                    + " out " + (off.x * sign).ToString("F2") + " torso " + depth.ToString("F2") + (depth > 0f ? "@" + where : "")
                    + (thigh ? " THIGH" : "")
                    + " | shoulder " + s.ToString("F2") + " elbow " + e.ToString("F2") + " wrist " + w.ToString("F2");
            }
            return One("right", right, 1f) + " || " + One("left", left, -1f) + " ## " + GarmentReport(character)
                + " ## armor " + GarmentReport(character, true);
        }

        /// <summary>
        /// How deep each arm sinks into the worn torso: the visible body and armor are
        /// baked in the current pose; torso vertices (skinned to Hips/Spine) are cut in
        /// horizontal slices around the spine line, and every sample along the upper arm
        /// and forearm is compared with the torso surface in its direction, minus the
        /// arm's own measured thickness. "pen" > 0 = the sleeve surface is inside the
        /// torso surface by that much (m); ~0.02 is a sleeve resting on the side.
        /// </summary>
        private static string GarmentReport(RoaCharacterView character, bool armorOnly = false)
        {
            Transform visual = character.transform.Find(RoaApocalypseVisuals.ChildName);
            if (visual == null) return "garment -";
            var torso = new List<Vector3>();
            var armVerts = new Dictionary<string, List<Vector3>>();
            Transform hips = null, neck = null;
            var bonesByName = new Dictionary<string, Transform>();
            foreach (Transform node in visual.GetComponentsInChildren<Transform>(true))
                if (!bonesByName.ContainsKey(node.name)) bonesByName[node.name] = node;
            bonesByName.TryGetValue("Hips", out hips);
            bonesByName.TryGetValue("Neck", out neck);
            if (hips == null || neck == null) return "garment bones missing";
            foreach (SkinnedMeshRenderer r in visual.GetComponentsInChildren<SkinnedMeshRenderer>(false))
            {
                if (!r.enabled || r.sharedMesh == null || !r.sharedMesh.isReadable) continue;
                if (armorOnly && !r.name.StartsWith("PolygonApocalypse_Armor")) continue;
                var baked = new Mesh();
                r.BakeMesh(baked, true);
                Vector3[] vertices = baked.vertices;
                BoneWeight[] weights = r.sharedMesh.boneWeights;
                Transform[] bones = r.bones;
                Matrix4x4 toWorld = Matrix4x4.TRS(r.transform.position, r.transform.rotation, Vector3.one);
                for (int i = 0; i < vertices.Length && i < weights.Length; i++)
                {
                    BoneWeight w = weights[i];
                    int top = w.boneIndex0;
                    if (top < 0 || top >= bones.Length || bones[top] == null) continue;
                    string bone = bones[top].name;
                    float armShare = 0f;
                    void Share(int index, float weight)
                    {
                        if (index >= 0 && index < bones.Length && bones[index] != null)
                        {
                            string n = bones[index].name;
                            if (n.StartsWith("Shoulder") || n.StartsWith("Elbow") || n.StartsWith("Hand")) armShare += weight;
                        }
                    }
                    Share(w.boneIndex0, w.weight0); Share(w.boneIndex1, w.weight1);
                    Share(w.boneIndex2, w.weight2); Share(w.boneIndex3, w.weight3);
                    Vector3 world = toWorld.MultiplyPoint3x4(vertices[i]);
                    if ((bone == "Hips" || bone.StartsWith("Spine")) && armShare < 0.2f) torso.Add(world);
                    else if (armShare > 0.8f && (bone.StartsWith("Shoulder") || bone.StartsWith("Elbow")))
                    {
                        if (!armVerts.TryGetValue(bone, out List<Vector3> list)) armVerts[bone] = list = new List<Vector3>();
                        list.Add(world);
                    }
                }
                UnityEngine.Object.Destroy(baked);
            }
            if (torso.Count == 0)
            {
                var names = new HashSet<string>();
                foreach (SkinnedMeshRenderer r in visual.GetComponentsInChildren<SkinnedMeshRenderer>(false))
                    if (r.enabled) names.Add(r.name + "[" + (r.sharedMesh != null && r.sharedMesh.isReadable) + ":" + (r.bones.Length > 0 && r.bones[0] != null ? r.bones[0].name : "-") + "]");
                return "garment no torso " + string.Join(",", names);
            }
            Vector3 up = Vector3.up;
            float Thickness(string bone, Vector3 a, Vector3 b)
            {
                if (!armVerts.TryGetValue(bone, out List<Vector3> list) || list.Count < 8) return 0.04f;
                var d = new List<float>();
                Vector3 axis = (b - a).normalized;
                foreach (Vector3 v in list)
                {
                    float t = Vector3.Dot(v - a, axis);
                    if (t < 0f || t > (b - a).magnitude) continue;
                    d.Add(Vector3.Distance(v, a + axis * t));
                }
                if (d.Count < 8) return 0.04f;
                d.Sort();
                return d[d.Count / 2];
            }
            string Side(string side)
            {
                if (!bonesByName.TryGetValue("Shoulder_" + side, out Transform shoulder)
                    || !bonesByName.TryGetValue("Elbow_" + side, out Transform elbow)
                    || !bonesByName.TryGetValue("Hand_" + side, out Transform hand)) return "-";
                float upperR = Thickness("Shoulder_" + side, shoulder.position, elbow.position);
                float foreR = Thickness("Elbow_" + side, elbow.position, hand.position);
                float worst = -1f;
                string where = "";
                for (int seg = 0; seg < 2; seg++)
                {
                    Vector3 a = seg == 0 ? shoulder.position : elbow.position, b = seg == 0 ? elbow.position : hand.position;
                    float radius = seg == 0 ? upperR : foreR;
                    for (float t = seg == 0 ? 0.6f : 0f; t <= 1.001f; t += 0.1f)
                    {
                        Vector3 p = Vector3.Lerp(a, b, t);
                        if (p.y < hips.position.y - 0.05f || p.y > neck.position.y) continue;
                        Vector3 axis = Vector3.Lerp(hips.position, neck.position,
                            Mathf.InverseLerp(hips.position.y, neck.position.y, p.y));
                        Vector3 v = Vector3.ProjectOnPlane(p - axis, up);
                        float dist = v.magnitude;
                        if (dist < 1e-4f) { worst = Mathf.Max(worst, 0.3f); where = (seg == 0 ? "upper" : "fore") + t.ToString("F1"); continue; }
                        float surface = 0f;
                        foreach (Vector3 q in torso)
                        {
                            if (Mathf.Abs(q.y - p.y) > 0.03f) continue;
                            Vector3 u = Vector3.ProjectOnPlane(q - axis, up);
                            if (Vector3.Angle(u, v) > 12f) continue;
                            surface = Mathf.Max(surface, Vector3.Dot(u, v / dist));
                        }
                        float pen = surface - (dist - radius);
                        if (pen > worst) { worst = pen; where = (seg == 0 ? "upper" : "fore") + t.ToString("F1"); }
                    }
                }
                return side + " pen " + worst.ToString("F2") + "@" + where + " r " + upperR.ToString("F3") + "/" + foreR.ToString("F3");
            }
            return "garment " + Side("R") + " | " + Side("L");
        }

        private static async Task Dress(RoaCharacterView character, RoaApocalypseCharacterSkin skin,
            JObject equipment, string weaponId)
        {
            await character.EquipItems(BaseUrl, equipment);
            await character.EquipWeapon(BaseUrl, weaponId);
            // Sample the gameplay idle, then let a few frames pass: skinned
            // meshes show the previous frame's skin.
            Animation idle = character.GetComponentInChildren<Animation>(true);
            if (idle != null && idle["idle"] != null)
            {
                idle.Play("idle");
                idle.Sample();
            }
            character.UpdateLocomotion(Vector3.zero, 0f, false, false);
            await Task.Delay(250);
            skin?.SyncPose();
        }

        private static void Capture(RoaCharacterPreview preview, RoaCharacterView character,
            Texture2D readback, string dir, string name, bool backToo = true, bool side = false)
        {
            Shot(preview, readback, Path.Combine(dir, name + "_front.png"));
            if (side)
            {
                character.transform.localRotation = Quaternion.Euler(0f, 90f, 0f);
                Shot(preview, readback, Path.Combine(dir, name + "_side.png"));
            }
            if (backToo)
            {
                character.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
                Shot(preview, readback, Path.Combine(dir, name + "_back.png"));
            }
            character.transform.localRotation = Quaternion.identity;
        }

        private static void Shot(RoaCharacterPreview preview, Texture2D readback, string path)
        {
            if (!preview.RenderNow()) throw new InvalidOperationException("Preview render failed: " + path);
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = preview.Texture;
            readback.ReadPixels(new Rect(0, 0, preview.Texture.width, preview.Texture.height), 0, 0);
            readback.Apply();
            RenderTexture.active = previous;
            File.WriteAllBytes(path, readback.EncodeToPNG());
        }
    }
}
