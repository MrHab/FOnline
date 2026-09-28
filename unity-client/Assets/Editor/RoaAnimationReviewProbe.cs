using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using RealmOfAshes.Game;
using RealmOfAshes.Net;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Обзор анимаций персонажа для критика: каждое состояние (ходьба, бег, присед,
    /// удары, оружие, смерть…) снимается листом из шести фаз. Строки листа: прежнее
    /// тело (GLB Quaternius) сбоку, новое тело PolygonApocalypse сбоку, затем оба в
    /// три четверти. Кадры идут через весь игровой конвейер: клип, процедурная поза,
    /// хват и перенос позы на тело пака. Циклы снимаются с остановленным временем по
    /// фазе клипа, действия (выстрел, перезарядка, смерть) — по реальному времени.
    /// Рядом — report.json: высота стоп над полом и кистей относительно оружия.
    /// Сервер моделей — ROA_ANIM_SERVER, папка — ROA_ANIM_OUT, выбор состояний —
    /// ROA_ANIM_ONLY (через запятую).
    /// </summary>
    public static class RoaAnimationReviewProbe
    {
        private const int W = 240, H = 300, Frames = 6;
        private static bool _batchOptionsCaptured;
        private static bool _previousEnterPlayModeOptionsEnabled;
        private static EnterPlayModeOptions _previousEnterPlayModeOptions;

        private static string Server =>
            Environment.GetEnvironmentVariable("ROA_ANIM_SERVER") ?? "http://127.0.0.1:3000";

        private static string OutDir =>
            Environment.GetEnvironmentVariable("ROA_ANIM_OUT")
            ?? Path.GetFullPath(Path.Combine(Application.dataPath, "../Temp/AnimReview"));

        private sealed class Rig
        {
            public string Name;
            public RoaCharacterPreview Preview;
            public RoaCharacterView View;
            public Animation Anim;
            public Camera Camera;
            public Transform Root;
            public Texture2D Readback;
            public readonly Dictionary<string, Transform> Bones = new Dictionary<string, Transform>();
        }

        private sealed class State
        {
            public string Name;
            public string Weapon = string.Empty;
            public Vector3 Velocity;
            public bool Crouch;
            public bool Aim;
            // null — цикл по фазе клипа; иначе действие по реальному времени.
            public Action<RoaCharacterView> Action;
            public float Seconds = 1f;
            // Клип библиотеки в чистом виде: без логики локомоции, по фазам.
            public string Clip = string.Empty;
        }

        private const string LibraryAsset = "Packages/com.realmofashes.models/characters/npc/npc_humanoid_animations.glb";

        [MenuItem("Realm of Ashes/Animation/Review character animations")]
        public static void RunBatch()
        {
            if (EditorApplication.isPlaying) { RunBatchAsync(); return; }
            try
            {
                // Пакет моделей лежит вне проекта: правку библиотеки клипов первичный
                // Refresh не видит, а ревью должно показывать текущие клипы.
                AssetDatabase.ImportAsset(LibraryAsset, ImportAssetOptions.ForceUpdate);
                var imported = new List<string>();
                foreach (UnityEngine.Object sub in AssetDatabase.LoadAllAssetsAtPath(LibraryAsset))
                    if (sub is AnimationClip) imported.Add(sub.name);
                Debug.Log("[ANIM REVIEW] library clips: " + string.Join(", ", imported));
                _previousEnterPlayModeOptionsEnabled = EditorSettings.enterPlayModeOptionsEnabled;
                _previousEnterPlayModeOptions = EditorSettings.enterPlayModeOptions;
                _batchOptionsCaptured = true;
                EditorSettings.enterPlayModeOptionsEnabled = true;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload;
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                EditorApplication.playModeStateChanged += OnPlayModeChanged;
                EditorApplication.EnterPlaymode();
            }
            catch (Exception error)
            {
                Debug.LogError("[ANIM REVIEW] FAIL: " + error);
                Finish(1);
            }
        }

        private static void OnPlayModeChanged(PlayModeStateChange state)
        {
            if (state != PlayModeStateChange.EnteredPlayMode) return;
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            RunBatchAsync();
        }

        private static async void RunBatchAsync()
        {
            try
            {
                await RunAsync();
                Debug.Log("[ANIM REVIEW] PASS " + OutDir);
                Finish(0);
            }
            catch (Exception error)
            {
                Debug.LogError("[ANIM REVIEW] FAIL: " + error);
                Finish(1);
            }
        }

        private static void Finish(int code)
        {
            Time.timeScale = 1f;
            if (_batchOptionsCaptured)
            {
                EditorSettings.enterPlayModeOptions = _previousEnterPlayModeOptions;
                EditorSettings.enterPlayModeOptionsEnabled = _previousEnterPlayModeOptionsEnabled;
                _batchOptionsCaptured = false;
            }
            if (Application.isBatchMode) EditorApplication.Exit(code);
        }

        private static List<State> States()
        {
            var rows = new List<State>
            {
                new State { Name = "idle" },
                new State { Name = "walk", Velocity = new Vector3(0f, 0f, 1.6f) },
                new State { Name = "run", Velocity = new Vector3(0f, 0f, 4.4f) },
                new State { Name = "walk_back", Velocity = new Vector3(0f, 0f, -1.5f) },
                new State { Name = "run_back", Velocity = new Vector3(0f, 0f, -4.0f) },
                new State { Name = "strafe_walk", Aim = true, Velocity = new Vector3(1.8f, 0f, 0f) },
                new State { Name = "strafe_run", Aim = true, Velocity = new Vector3(4.2f, 0f, 0f) },
                new State { Name = "strafe_step", Aim = true, Velocity = new Vector3(-0.8f, 0f, 0f) },
                new State { Name = "strafe_diag", Aim = true, Velocity = new Vector3(1.3f, 0f, 1.3f) },
                new State { Name = "crouch_idle", Crouch = true },
                new State { Name = "crouch_walk", Velocity = new Vector3(0f, 0f, 1.2f), Crouch = true },
                new State { Name = "crouch_back", Velocity = new Vector3(0f, 0f, -1.0f), Crouch = true },
                new State { Name = "crouch_run", Velocity = new Vector3(0f, 0f, 3.0f), Crouch = true },
                new State { Name = "punch", Action = view => view.PlayAttack(0.45f), Seconds = 0.8f },
                new State { Name = "hurt", Action = view => view.PlayHit(), Seconds = 0.6f },
                new State { Name = "pickup", Action = view => view.PlayAction("pickup", 1.35f), Seconds = 1.35f },
                new State { Name = "consume", Action = view => view.PlayAction("consume", 1.2f), Seconds = 1.2f },
                new State { Name = "harvest", Action = view => view.PlayAction("harvest", 1.5f, 1.3f), Seconds = 1.5f },
                new State { Name = "rifle_idle", Weapon = "assaultRifle", Aim = true },
                new State { Name = "rifle_walk", Weapon = "assaultRifle", Aim = true, Velocity = new Vector3(0f, 0f, 1.6f) },
                new State { Name = "rifle_run", Weapon = "assaultRifle", Velocity = new Vector3(0f, 0f, 4.4f) },
                new State { Name = "rifle_crouch_walk", Weapon = "assaultRifle", Aim = true, Crouch = true, Velocity = new Vector3(0f, 0f, 1.2f) },
                new State { Name = "rifle_fire", Weapon = "assaultRifle", Aim = true, Action = view => view.PlayAttack(), Seconds = 0.6f },
                new State { Name = "rifle_reload", Weapon = "assaultRifle", Aim = true, Action = view => view.StartReload(2.2f), Seconds = 2.2f },
                new State { Name = "pistol_reload", Weapon = "pistol", Aim = true, Action = view => view.StartReload(1.8f), Seconds = 1.8f },
                new State { Name = "pistol_idle", Weapon = "pistol", Aim = true },
                new State { Name = "pistol_walk", Weapon = "pistol", Aim = true, Velocity = new Vector3(0f, 0f, 1.6f) },
                new State { Name = "pistol_fire", Weapon = "pistol", Aim = true, Action = view => view.PlayAttack(), Seconds = 0.6f },
                new State { Name = "axe_idle", Weapon = "axe" },
                new State { Name = "axe_walk", Weapon = "axe", Velocity = new Vector3(0f, 0f, 1.6f) },
                new State { Name = "axe_swing", Weapon = "axe", Action = view => view.PlayAttack(0.55f), Seconds = 0.6f },
                // Замах и удар подробно: кадры каждые 0.07 с до контакта.
                new State { Name = "axe_swing_detail", Weapon = "axe", Action = view => view.PlayAttack(0.55f), Seconds = 0.35f },
                // Прочие удары сверху: зазор рук до головы меряется по каждому кадру.
                new State { Name = "katana_swing", Weapon = "polygonKatana01", Action = view => view.PlayAttack(0.55f), Seconds = 0.6f },
                new State { Name = "pipe_swing", Weapon = "polygonPipe01", Action = view => view.PlayAttack(0.55f), Seconds = 0.6f },
                new State { Name = "crowbar_swing", Weapon = "polygonCrowbar01", Action = view => view.PlayAttack(0.55f), Seconds = 0.6f },
                new State { Name = "pipe_wrench_swing", Weapon = "handPump", Action = view => view.PlayAttack(0.55f), Seconds = 0.6f },
                new State { Name = "spade_swing", Weapon = "pickaxe", Action = view => view.PlayAttack(0.55f), Seconds = 0.6f },
                new State { Name = "death", Action = view => view.SetDead(true), Seconds = 1.6f }
            };
            foreach (string clip in new[]
            {
                "idle", "attack", "punch_cross", "crouch_idle", "crouch_walk", "crouch_walk_back", "crouch_run",
                "crouch_run_back", "pickup", "kneel_work", "chop", "harvest", "consume", "chest_open",
                "strafe_left", "strafe_right", "strafe_run_left", "strafe_run_right"
            })
                rows.Add(new State { Name = "clip_" + clip, Clip = clip });
            // Смерть — последней: после неё тело не встаёт.
            State death = rows.Find(row => row.Name == "death");
            rows.Remove(death);
            rows.Add(death);
            string only = Environment.GetEnvironmentVariable("ROA_ANIM_ONLY");
            if (string.IsNullOrWhiteSpace(only)) return rows;
            var wanted = new HashSet<string>(only.Split(','), StringComparer.Ordinal);
            return rows.FindAll(row => wanted.Contains(row.Name.Trim()));
        }

        public static async Task RunAsync()
        {
            if (!Application.isPlaying) throw new InvalidOperationException("Animation review needs Play Mode.");
            Directory.CreateDirectory(OutDir);
            Rig oldRig = await MakeRig("Old", true, new Vector3(-20f, 0f, 0f));
            Rig newRig = await MakeRig("New", false, new Vector3(20f, 0f, 0f));
            // Разминка: первый кадр после загрузки ещё без перенесённой позы.
            await Drive(new[] { oldRig, newRig }, new State { Name = "warmup" }, 1.0f);
            var report = new StringBuilder("{\n");
            string weapon = string.Empty;
            List<State> states = States();
            for (int s = 0; s < states.Count; s++)
            {
                State state = states[s];
                if (state.Weapon != weapon)
                {
                    foreach (Rig rig in new[] { oldRig, newRig })
                        await rig.View.EquipWeapon(Server, string.IsNullOrEmpty(state.Weapon) ? string.Empty : state.Weapon);
                    weapon = state.Weapon;
                    foreach (Rig rig in new[] { oldRig, newRig }) CollectBones(rig);
                }
                foreach (Rig rig in new[] { oldRig, newRig }) CollectBones(rig);
                var sheet = new Texture2D(Frames * W, 4 * H, TextureFormat.RGBA32, false);
                var metrics = new StringBuilder();
                if (!string.IsNullOrEmpty(state.Clip))
                {
                    Time.timeScale = 0f;
                    for (int f = 0; f < Frames; f++)
                    {
                        float phase = f / (float)Frames;
                        foreach (Rig rig in new[] { oldRig, newRig })
                        {
                            if (rig.Anim[state.Clip] == null) throw new InvalidOperationException(rig.Name + " has no clip " + state.Clip + " (" + ClipNames(rig.Anim) + ")");
                            rig.Anim.Play(state.Clip);
                            SetPhase(rig, state.Clip, phase);
                        }
                        await Hold(0.12f);
                        Shoot(sheet, f, oldRig, newRig, metrics, state.Name + " phase " + phase.ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
                    }
                    Time.timeScale = 1f;
                }
                else
                {
                await Drive(new[] { oldRig, newRig }, state, 0.9f);
                if (state.Action == null)
                {
                    Time.timeScale = 0f;
                    string clipOld = MainClip(oldRig), clipNew = MainClip(newRig);
                    for (int f = 0; f < Frames; f++)
                    {
                        float phase = f / (float)Frames;
                        SetPhase(oldRig, clipOld, phase);
                        SetPhase(newRig, clipNew, phase);
                        await Drive(new[] { oldRig, newRig }, state, f == 0 ? 0.25f : 0.1f);
                        Shoot(sheet, f, oldRig, newRig, metrics, state.Name + " " + clipNew + " phase " + phase.ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
                    }
                    Time.timeScale = 1f;
                }
                else
                {
                    // Игровое время — ровно 1/30 с на кадр: съёмка листа (ReadPixels)
                    // не съедает долю клипа, кадры листа ложатся на свои моменты.
                    Time.captureDeltaTime = 1f / 30f;
                    foreach (Rig rig in new[] { oldRig, newRig }) state.Action(rig.View);
                    float start = Time.time;
                    clearance = float.MaxValue;
                    for (int f = 0; f < Frames; f++)
                    {
                        float at = state.Seconds * f / (Frames - 1);
                        while (Time.time - start < at)
                        {
                            await Drive(new[] { oldRig, newRig }, state, 0f);
                            TrackHeadClearance(newRig, Time.time - start);
                        }
                        TrackHeadClearance(newRig, Time.time - start);
                        Shoot(sheet, f, oldRig, newRig, metrics, state.Name + " t " + (Time.time - start).ToString("F2", System.Globalization.CultureInfo.InvariantCulture));
                    }
                    Time.captureDeltaTime = 0f;
                    await Drive(new[] { oldRig, newRig }, state, 0.8f);
                }
                }
                sheet.Apply();
                File.WriteAllBytes(Path.Combine(OutDir, (s + 1).ToString("00") + "_" + state.Name + ".png"), sheet.EncodeToPNG());
                UnityEngine.Object.Destroy(sheet);
                if (metrics.Length >= 2) metrics.Length -= 2; // висячая запятая последнего кадра
                report.Append("  \"").Append(state.Name).Append("\": [\n").Append(metrics).Append("\n  ],\n");
                if (clearance < float.MaxValue)
                    report.Append("  \"").Append(state.Name).Append("_body_clearance\": {\"min\": ").Append(F(clearance))
                        .Append(", \"t\": ").Append(F(clearanceAt)).Append(", \"part\": \"").Append(clearancePart).Append("\"},\n");
                clearance = float.MaxValue;
            }
            report.Append("  \"rows\": \"old-side, new-side, old-3/4, new-3/4; floor y = 0\"\n}\n");
            File.WriteAllText(Path.Combine(OutDir, "report.json"), report.ToString());
        }

        private static async Task<Rig> MakeRig(string name, bool oldBody, Vector3 offset)
        {
            var host = new GameObject("AnimReview" + name);
            var rig = new Rig { Name = name, Preview = host.AddComponent<RoaCharacterPreview>() };
            rig.Preview.Show(Server, new CharacterAppearance { Sex = "male", HairId = "short_crop", HairColorId = "hair_08" },
                W, H, oldBody);
            DateTime deadline = DateTime.UtcNow.AddSeconds(90);
            while (!rig.Preview.IsReady && DateTime.UtcNow < deadline) await Task.Delay(100);
            if (!rig.Preview.IsReady) throw new TimeoutException(name + " body did not load from " + Server);
            // Превью само крутит модель к камере: здесь ракурс ставит проба.
            rig.Preview.enabled = false;
            rig.View = host.GetComponentInChildren<RoaCharacterView>(true);
            rig.Anim = rig.View.GetComponentInChildren<Animation>(true);
            rig.Camera = host.GetComponentInChildren<Camera>(true);
            rig.Root = rig.Camera.transform.parent;
            rig.Root.position += offset;
            rig.Camera.backgroundColor = new Color(0.34f, 0.37f, 0.36f, 1f);
            rig.View.transform.localRotation = Quaternion.identity;
            // Пол с клеткой через метр: по нему видно проскальзывание и провал стоп.
            for (int x = -3; x <= 3; x++)
                for (int z = -3; z <= 3; z++)
                {
                    GameObject tile = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    UnityEngine.Object.Destroy(tile.GetComponent<Collider>());
                    tile.transform.SetParent(rig.Root, false);
                    tile.transform.localPosition = new Vector3(x, -0.005f, z);
                    tile.transform.localScale = new Vector3(1f, 0.01f, 1f);
                    tile.layer = RoaCharacterPreview.PreviewLayer;
                    tile.GetComponent<Renderer>().material.color = (x + z) % 2 == 0
                        ? new Color(0.22f, 0.24f, 0.22f) : new Color(0.29f, 0.31f, 0.29f);
                }
            rig.Readback = new Texture2D(rig.Preview.Texture.width, rig.Preview.Texture.height, TextureFormat.RGBA32, false);
            if (rig.Preview.Texture.width != W || rig.Preview.Texture.height != H)
                throw new InvalidOperationException("Preview texture is " + rig.Preview.Texture.width + "x" + rig.Preview.Texture.height);
            CollectBones(rig);
            return rig;
        }

        private static string ClipNames(Animation animation)
        {
            var names = new List<string>();
            foreach (AnimationState state in animation) names.Add(state.name);
            return string.Join(", ", names);
        }

        private static float clearance = float.MaxValue, clearanceAt;
        private static string clearancePart = string.Empty;

        /// <summary>
        /// Зазор кистей, локтей и середин предплечий до головы (сфера r 0.13 над костью
        /// головы) на каждом кадре действия: промежуточные кадры замаха лист не снимает.
        /// Отрицательный — рука в голове.
        /// </summary>
        private static void TrackHeadClearance(Rig rig, float t)
        {
            if (!rig.Bones.TryGetValue("head", out Transform head) || head == null) return;
            Transform frame = rig.View.transform;
            Vector3 centre = head.position + frame.up * 0.13f + frame.forward * 0.06f;
            foreach (string side in new[] { "l", "r" })
            {
                if (!rig.Bones.TryGetValue("hand_" + side, out Transform hand) || hand == null) continue;
                if (!rig.Bones.TryGetValue("elbow_" + side, out Transform elbow) || elbow == null) continue;
                foreach ((string part, Vector3 point) in new[] { ("hand_" + side, hand.position),
                    ("forearm_" + side, (hand.position + elbow.position) * 0.5f), ("elbow_" + side, elbow.position) })
                {
                    float gap = Vector3.Distance(point, centre) - 0.13f - 0.045f;
                    if (gap < clearance) { clearance = gap; clearanceAt = t; clearancePart = part; }
                }
                // Кисть против корпуса: капсула от таза до груди, r 0.12 (живот, грудь).
                if (rig.Bones.TryGetValue("hips", out Transform hips) && hips != null
                    && rig.Bones.TryGetValue("spine_03", out Transform chest) && chest != null)
                {
                    Vector3 axis = chest.position - hips.position;
                    float along = Mathf.Clamp01(Vector3.Dot(hand.position - hips.position, axis) / axis.sqrMagnitude);
                    float gap = Vector3.Distance(hand.position, hips.position + axis * along) - 0.12f - 0.045f;
                    if (gap < clearance) { clearance = gap; clearanceAt = t; clearancePart = "hand_" + side + "_torso"; }
                }
            }
        }

        private static void CollectBones(Rig rig)
        {
            rig.Bones.Clear();
            Transform visual = rig.View.transform.Find(RoaApocalypseVisuals.ChildName);
            Transform scope = visual != null ? visual : rig.View.transform;
            foreach (Transform node in scope.GetComponentsInChildren<Transform>(true))
            {
                string key = node.name.ToLowerInvariant();
                if (!rig.Bones.ContainsKey(key)) rig.Bones[key] = node;
            }
            foreach (Transform node in rig.View.GetComponentsInChildren<Transform>(true))
            {
                if (node.name == "socket_grip_r" && !rig.Bones.ContainsKey("weapon")) rig.Bones["weapon"] = node;
                if (node.name == "socket_grip_l" && !rig.Bones.ContainsKey("weapon_support")) rig.Bones["weapon_support"] = node;
                // Кости скрытого скелета, с которого переносится поза.
                if ((node.name == "hand_r" || node.name == "hand_l") && (visual == null || !node.IsChildOf(visual)))
                    rig.Bones["src_" + node.name] = node;
            }
        }

        private static async Task Drive(Rig[] rigs, State state, float seconds)
        {
            float until = Time.realtimeSinceStartup + seconds;
            do
            {
                foreach (Rig rig in rigs)
                {
                    rig.View.transform.localRotation = Quaternion.identity;
                    bool moving = state.Velocity.sqrMagnitude > 0.01f;
                    rig.View.UpdateLocomotion(state.Velocity, 0f, moving, state.Crouch);
                    if (state.Aim)
                        rig.View.SetAim(rig.View.transform.position + Vector3.forward * 6f + Vector3.up * 1.3f, true);
                }
                await Task.Yield();
            } while (Time.realtimeSinceStartup < until);
        }

        private static async Task Hold(float seconds)
        {
            float until = Time.realtimeSinceStartup + seconds;
            while (Time.realtimeSinceStartup < until) await Task.Yield();
        }

        private static string MainClip(Rig rig)
        {
            string best = string.Empty;
            float weight = -1f;
            foreach (AnimationState clip in rig.Anim)
                if (clip.enabled && clip.weight > weight) { weight = clip.weight; best = clip.name; }
            return best;
        }

        private static void SetPhase(Rig rig, string clip, float phase)
        {
            if (string.IsNullOrEmpty(clip) || rig.Anim[clip] == null) return;
            foreach (AnimationState other in rig.Anim)
                if (other.name != clip) other.weight = 0f;
            AnimationState state = rig.Anim[clip];
            state.enabled = true;
            state.weight = 1f;
            state.normalizedTime = phase;
        }

        private static void Shoot(Texture2D sheet, int frame, Rig oldRig, Rig newRig, StringBuilder metrics, string label)
        {
            Grab(sheet, frame, 0, oldRig, true);
            Grab(sheet, frame, 1, newRig, true);
            Grab(sheet, frame, 2, oldRig, false);
            Grab(sheet, frame, 3, newRig, false);
            metrics.Append("    {\"frame\": ").Append(frame).Append(", \"label\": \"").Append(label).Append("\", ")
                .Append("\"old\": ").Append(Measure(oldRig, "foot_l", "foot_r", "ball_l", "ball_r", "hand_l", "hand_r"))
                .Append(", \"new\": ").Append(Measure(newRig, "ankle_l", "ankle_r", "ball_l", "ball_r", "hand_l", "hand_r", "src_hand_l", "src_hand_r", "weapon_support",
                    "head", "spine_03", "elbow_l", "elbow_r", "hips"))
                .Append(", \"skin\": ").Append(SkinState(newRig)).Append("},\n");
        }

        private static string SkinState(Rig rig)
        {
            RoaApocalypseCharacterSkin skin = rig.View.GetComponent<RoaApocalypseCharacterSkin>();
            if (skin == null) return "null";
            return "{\"armed\": " + (skin.Armed ? "true" : "false") + ", \"arms\": " + (skin.ArmsReady ? "true" : "false")
                + ", \"miss\": " + F(skin.HandReachError) + ", \"weaponId\": \"" + rig.View.WeaponId + "\"}";
        }

        private static string Measure(Rig rig, params string[] bones)
        {
            var parts = new List<string>();
            Transform weapon;
            rig.Bones.TryGetValue("weapon", out weapon);
            foreach (string bone in bones)
            {
                if (!rig.Bones.TryGetValue(bone, out Transform node) || node == null) { parts.Add("\"" + bone + "\": null"); continue; }
                Vector3 local = rig.Root.InverseTransformPoint(node.position);
                string row = "\"" + bone + "\": [" + F(local.x) + ", " + F(local.y) + ", " + F(local.z) + "]";
                parts.Add(row);
            }
            if (weapon != null && weapon)
            {
                Vector3 local = rig.Root.InverseTransformPoint(weapon.position);
                parts.Add("\"weapon\": [" + F(local.x) + ", " + F(local.y) + ", " + F(local.z) + "]");
            }
            return "{" + string.Join(", ", parts) + "}";
        }

        private static string F(float value) =>
            value.ToString("F3", System.Globalization.CultureInfo.InvariantCulture);

        private static void Grab(Texture2D sheet, int column, int row, Rig rig, bool side)
        {
            Transform camera = rig.Camera.transform;
            // Одинаковый кадр для обоих тел: разница в росте видна как есть. Камера
            // идёт за тазом по полу: смерть и отдача уводят тело с места.
            Vector3 anchor = rig.Root.position;
            if (rig.Bones.TryGetValue("hips", out Transform hips) || rig.Bones.TryGetValue("pelvis", out hips))
                anchor = new Vector3(hips.position.x, rig.Root.position.y, hips.position.z);
            Vector3 target = anchor + new Vector3(0f, 0.95f, 0f);
            camera.position = side ? anchor + new Vector3(4.6f, 1.1f, 0f)
                                   : anchor + new Vector3(3.1f, 1.7f, 4.0f);
            camera.LookAt(target);
            if (!rig.Preview.RenderNow()) throw new InvalidOperationException("render failed: " + rig.Name);
            RenderTexture previous = RenderTexture.active;
            RenderTexture.active = rig.Preview.Texture;
            rig.Readback.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            rig.Readback.Apply();
            RenderTexture.active = previous;
            sheet.SetPixels32(column * W, (3 - row) * H, W, H, rig.Readback.GetPixels32());
        }
    }
}
