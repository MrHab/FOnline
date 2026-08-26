#if UNITY_EDITOR
using System;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Optional one-shot capture of the real Wasteland scene. It is deliberately
    /// environment-gated so a normal editor or build never receives the staged enemy.
    /// </summary>
    [InitializeOnLoad]
    public static class RoaLiveCombatSceneProbe
    {
        private const string CaptureVariable = "ROA_LIVE_COMBAT_CAPTURE";
        private const string EnemyId = "capture-raider";
        private static readonly MethodInfo ApplySnapshot = typeof(RoaEnemies).GetMethod(
            "ApplySnapshotRow", BindingFlags.Instance | BindingFlags.NonPublic,
            null, new[] { typeof(string), typeof(JObject) }, null);
        private static readonly MethodInfo ApplyConfirmedHit = typeof(RoaEnemies).GetMethod(
            "ApplySnapshotRow", BindingFlags.Instance | BindingFlags.NonPublic,
            null, new[] { typeof(string), typeof(JObject), typeof(bool), typeof(Vector3),
                          typeof(int), typeof(bool) }, null);
        private static readonly FieldInfo HoverTarget = typeof(RoaCombat).GetField(
            "_hoverTarget", BindingFlags.Instance | BindingFlags.NonPublic);
        private static readonly FieldInfo HoverPosition = typeof(RoaCombat).GetField(
            "_hoverPosition", BindingFlags.Instance | BindingFlags.NonPublic);

        private static int _stage;
        private static float _nextStageAt;
        private static float _deadline;
        private static string _capturePath;
        private static JObject _enemy;
        private static Vector3 _target;

        static RoaLiveCombatSceneProbe()
        {
            _capturePath = Environment.GetEnvironmentVariable(CaptureVariable);
            if (string.IsNullOrWhiteSpace(_capturePath)) return;
            EditorApplication.update += Update;
            // A clean isolated project can spend a couple of minutes importing
            // glTFast and Newtonsoft before it is ready to enter Play Mode.
            _deadline = Time.realtimeSinceStartup + 240f;
        }

        private static void Update()
        {
            if (string.IsNullOrWhiteSpace(_capturePath)) return;
            if (Time.realtimeSinceStartup > _deadline)
            {
                Fail("timeout while waiting for the live combat scene");
                return;
            }
            if (!EditorApplication.isPlaying || Time.realtimeSinceStartup < _nextStageAt) return;

            try
            {
                RoaGameBootstrap game = RoaGameBootstrap.Active;
                RoaPlayerController player = game?.Combat?.Player;
                if (game == null || !game.InGame || player?.View == null || !player.View.Ready
                    || game.Enemies == null || game.CombatFx == null || game.CameraRig == null)
                    return;

                if (_stage == 0)
                {
                    StageEncounter(game, player);
                    _stage = 1;
                    _nextStageAt = Time.realtimeSinceStartup + 5f;
                    return;
                }
                if (_stage == 1)
                {
                    StageImpact(game, player);
                    _stage = 2;
                    _nextStageAt = Time.realtimeSinceStartup + 0.055f;
                    return;
                }
                if (_stage == 2)
                {
                    string directory = Path.GetDirectoryName(_capturePath);
                    if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                    ScreenCapture.CaptureScreenshot(_capturePath);
                    _stage = 3;
                    _nextStageAt = Time.realtimeSinceStartup + 0.5f;
                    return;
                }
                if (_stage == 3 && File.Exists(_capturePath)
                    && new FileInfo(_capturePath).Length > 1024)
                {
                    Debug.Log("[LIVE COMBAT CAPTURE] " + _capturePath);
                    EditorApplication.Exit(0);
                }
            }
            catch (Exception error)
            {
                Fail(error.ToString());
            }
        }

        private static void StageEncounter(RoaGameBootstrap game, RoaPlayerController player)
        {
            Require(ApplySnapshot != null && ApplyConfirmedHit != null,
                "enemy snapshot methods are unavailable");
            Require(HoverTarget != null && HoverPosition != null,
                "combat hover fields are unavailable");

            Camera camera = game.CameraRig.GetComponent<Camera>();
            Require(camera != null, "world camera is unavailable");
            Vector3 forward = camera.transform.forward;
            forward.y = 0f;
            forward = forward.sqrMagnitude > 0.001f ? forward.normalized : Vector3.forward;
            Vector3 right = camera.transform.right;
            right.y = 0f;
            right = right.sqrMagnitude > 0.001f ? right.normalized : Vector3.right;
            _target = player.transform.position + forward * 3.7f + right * 1.15f;
            _target.y = player.transform.position.y;
            RoaCoords.ToServer(_target, out float serverX, out float serverZ);

            _enemy = new JObject
            {
                ["id"] = EnemyId,
                ["name"] = "Рейдер-налётчик",
                ["modelKey"] = "enemyRaider",
                ["visual"] = "raider",
                ["species"] = "human",
                ["x"] = serverX,
                ["z"] = serverZ,
                ["vx"] = 0f,
                ["vz"] = 0f,
                ["moving"] = false,
                ["dead"] = false,
                ["hp"] = 86,
                ["maxHp"] = 100,
                ["scale"] = 1f,
                ["hostileToPlayer"] = true,
                ["canDialogue"] = true,
                ["appearance"] = new JObject
                {
                    ["gender"] = "male",
                    ["body"] = "medium",
                    ["face"] = "male_03",
                    ["hair"] = "short_crop",
                    ["hairColor"] = "hair_08"
                },
                ["equipment"] = new JObject
                {
                    ["weapon"] = "assaultRifle",
                    ["armor"] = "combatArmor",
                    ["helmet"] = "tacticalHelmet",
                    ["boots"] = "scoutBoots",
                    ["backpack"] = "backpack"
                }
            };
            ApplySnapshot.Invoke(game.Enemies, new object[] { EnemyId, _enemy });
            HoverTarget.SetValue(game.Combat, _enemy);
            HoverPosition.SetValue(game.Combat, _target);
            player.View.SetAim(_target + Vector3.up * 1.05f, true);
        }

        private static void StageImpact(RoaGameBootstrap game, RoaPlayerController player)
        {
            HoverTarget.SetValue(game.Combat, _enemy);
            HoverPosition.SetValue(game.Combat, _target);

            Vector3 delta = _target - player.transform.position;
            delta.y = 0f;
            float yaw = Mathf.Atan2(delta.x, delta.z) * Mathf.Rad2Deg;
            player.transform.rotation = Quaternion.Euler(0f, yaw, 0f);
            player.View.UpdateLocomotion(Vector3.zero, yaw, false, false);
            player.View.SetAim(_target + Vector3.up * 1.05f, true);
            player.View.PlayAttack();

            JObject hit = (JObject)_enemy.DeepClone();
            hit["hp"] = 49;
            ApplyConfirmedHit.Invoke(game.Enemies, new object[]
            {
                EnemyId, hit, true, player.transform.position, 37, true
            });
            _enemy = hit;
            HoverTarget.SetValue(game.Combat, _enemy);

            Vector3 muzzle = player.transform.position + Vector3.up * 1.05f;
            player.View.TryGetMuzzle(out muzzle);
            Vector3 impact = _target + Vector3.up * 1.02f;
            string weapon = string.IsNullOrEmpty(player.View.WeaponId)
                ? "assaultRifle" : player.View.WeaponId;
            game.CombatFx.PlayShot(muzzle, impact, weapon, true);
            game.CombatFx.PlayConfirmedHit(_target, muzzle, weapon, true, false);

            RoaCombatFeedbackCanvas feedback = game.Combat.GetComponent<RoaCombatFeedbackCanvas>();
            if (feedback == null) feedback = game.Combat.gameObject.AddComponent<RoaCombatFeedbackCanvas>();
            feedback.Configure(game.CameraRig.GetComponent<Camera>());
            feedback.ShowFloating("−37  КРИТ", _target + Vector3.up * 1.62f,
                new Color(1f, 0.72f, 0.16f));
            feedback.ShowHit(impact, true, false);
            feedback.RefreshNow();
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        private static void Fail(string message)
        {
            Debug.LogError("[LIVE COMBAT CAPTURE] " + message);
            _capturePath = string.Empty;
            EditorApplication.Exit(1);
        }
    }
}
#endif
