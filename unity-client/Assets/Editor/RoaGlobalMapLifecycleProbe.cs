#if UNITY_EDITOR
using System;
using System.Reflection;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Regression test for cleanup after a Unity script/domain reload.</summary>
    public static class RoaGlobalMapLifecycleProbe
    {
        private static readonly string[] ManagedStateFields =
        {
            "_routeVisuals",
            "_colorBlock",
            "_dynamicTargets",
            "_activityHighlightVisuals",
            "_activityOverlayLabels",
            "_territoryByCell",
            "_playerPoint",
            "_selectedPoint",
            "_route",
            "_ignoredRouteContacts"
        };

        [MenuItem("Realm of Ashes/Проверки/Жизненный цикл глобальной карты")]
        public static void Run()
        {
            RunInternal();
        }

        public static void RunBatch()
        {
            try
            {
                RunInternal();
                if (Application.isBatchMode) EditorApplication.Exit(0);
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                if (Application.isBatchMode) EditorApplication.Exit(1);
                else throw;
            }
        }

        private static void RunInternal()
        {
            GameObject host = new GameObject("GlobalMapLifecycleProbe");
            try
            {
                RoaGlobalMap map = host.AddComponent<RoaGlobalMap>();
                NullManagedState(map);

                // Configure represents the first normal call after a script reload.
                map.Configure(null, null, null, null);
                foreach (string fieldName in ManagedStateFields)
                {
                    FieldInfo field = Field(fieldName);
                    Require(field.GetValue(map) != null,
                            "Configure did not restore " + fieldName + ".");
                }

                // Destroy/leave may be called more than once on a partially restored object.
                NullManagedState(map);
                MethodInfo clear = typeof(RoaGlobalMap).GetMethod("ClearVisuals",
                    BindingFlags.Instance | BindingFlags.NonPublic)
                    ?? throw new MissingMethodException(typeof(RoaGlobalMap).FullName, "ClearVisuals");
                clear.Invoke(map, null);
                clear.Invoke(map, null);
                UnityEngine.Object.DestroyImmediate(host);
                host = null;
                Debug.Log("[ГЛОБАЛЬНАЯ КАРТА] lifecycle cleanup устойчив к null и повторному вызову.");
            }
            finally
            {
                if (host != null) UnityEngine.Object.DestroyImmediate(host);
            }
        }

        private static void NullManagedState(RoaGlobalMap map)
        {
            foreach (string fieldName in ManagedStateFields) Field(fieldName).SetValue(map, null);
        }

        private static FieldInfo Field(string name)
        {
            return typeof(RoaGlobalMap).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)
                   ?? throw new MissingFieldException(typeof(RoaGlobalMap).FullName, name);
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
