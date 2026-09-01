#if UNITY_EDITOR
using System;
using System.Collections;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaRemoteDeathProbe
    {
        [MenuItem("Realm of Ashes/Проверить смерть удалённого игрока")]
        public static void Run()
        {
            GameObject host = new GameObject("RemoteDeathProbe");
            GameObject root = null;
            try
            {
                RoaRemotePlayers players = host.AddComponent<RoaRemotePlayers>();
                Require(RoaEnemies.ResolveSnapshotDeadState(true, false)
                        && RoaEnemies.ResolveSnapshotDeadState(false, true)
                        && !RoaEnemies.ResolveSnapshotDeadState(false, false),
                        "устаревший snapshot снова оживляет уже мёртвого NPC");
                root = new GameObject("Remote:probe");
                root.transform.SetParent(host.transform, false);
                BoxCollider collider = root.AddComponent<BoxCollider>();
                RoaCharacterView view = root.AddComponent<RoaCharacterView>();

                Type managerType = typeof(RoaRemotePlayers);
                Type remoteType = managerType.GetNestedType("Remote", BindingFlags.NonPublic);
                Require(remoteType != null, "runtime remote state type is missing");
                object remote = Activator.CreateInstance(remoteType, true);
                remoteType.GetField("Root", BindingFlags.Public | BindingFlags.Instance)?.SetValue(remote, root);
                remoteType.GetField("View", BindingFlags.Public | BindingFlags.Instance)?.SetValue(remote, view);
                FieldInfo remotesField = managerType.GetField("_remotes", BindingFlags.NonPublic | BindingFlags.Instance);
                IDictionary remotes = remotesField?.GetValue(players) as IDictionary;
                Require(remotes != null, "remote dictionary is missing");
                remotes.Add("probe", remote);

                MethodInfo begin = managerType.GetMethod("BeginRemoteDeath",
                    BindingFlags.NonPublic | BindingFlags.Instance);
                MethodInfo update = managerType.GetMethod("UpdateDeathVisuals",
                    BindingFlags.NonPublic | BindingFlags.Instance);
                Require(begin != null && update != null, "death lifecycle methods are missing");
                bool retained = (bool)begin.Invoke(players, new object[] { "probe", 10f });
                Require(retained && remotes.Count == 0 && players.DeathVisualCount == 1,
                        "dead player stayed targetable or was not retained");
                Require(view.Dead && !collider.enabled && root.name == "RemoteDeath:probe",
                        "death pose, collider removal or diagnostic name is missing");
                view.ApplyDeathSettleForDiagnostics(RoaCharacterView.DeathSettleSeconds);
                Require(view.DeathSettleWeight > 0.999f
                        && Quaternion.Angle(Quaternion.identity, view.transform.localRotation) < 0.1f,
                        "authored death clip was replaced by a synthetic root rotation");

                update.Invoke(players, new object[]
                {
                    10f + RoaRemotePlayers.DeathVisualSeconds - 0.01f
                });
                Require(players.DeathVisualCount == 1, "death visual expired before its hold time");
                update.Invoke(players, new object[]
                {
                    10f + RoaRemotePlayers.DeathVisualSeconds + 0.01f
                });
                Require(players.DeathVisualCount == 0, "death visual did not expire");
                root = null;

                Debug.Log("[СМЕРТЬ ИГРОКА] готово: цель удалена сразу, коллайдер выключен, "
                    + "визуал=" + RoaRemotePlayers.DeathVisualSeconds.ToString("0.0") + "с");
            }
            finally
            {
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
