#if UNITY_EDITOR
using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Headless entry point for the deterministic client probes. It runs in an
    /// isolated project copy, records probe errors (the menu probes report rather
    /// than rethrow them), and returns a meaningful process exit code to CI.
    /// </summary>
    public static class RoaClientAuditRunner
    {
        private static readonly Type[] Probes =
        {
            typeof(RoaCharacterCreatorProbe),
            typeof(RealmOfAshes.Editor.RoaItemDataProbe),
            typeof(RealmOfAshes.Editor.RoaQuickbarProbe),
            typeof(RoaMinimapProbe),
            typeof(RoaRoofCutawayProbe),
            typeof(RoaCombatFxProbe),
            typeof(RoaCombatConfirmationProbe),
            typeof(RoaWeaponReadinessProbe),
            typeof(RoaTargetingFeedbackProbe),
            typeof(RoaMobileControlsProbe),
            typeof(RoaHudCanvasProbe),
            typeof(RoaUiPrefabProbe),
            typeof(RoaLightingProbe),
            typeof(RoaCameraProbe),
            typeof(RoaMovementFxProbe),
            typeof(RoaLocomotionContactProbe),
            typeof(RoaNetworkActorMotionProbe),
            typeof(RoaEnemyThreatTelegraphProbe),
            typeof(RoaGroundingProbe),
            typeof(RoaActorPresentationLodProbe),
            typeof(RoaWeaponCollisionProbe),
            typeof(RoaHitReactionProbe),
            typeof(RoaRemoteDeathProbe),
            typeof(RoaActivityFeedbackProbe),
            typeof(RoaActivityHubPresentationProbe),
            typeof(RoaEconomyFeedbackProbe),
            typeof(RoaGroundDressingProbe)
        };

        public static async void Run()
        {
            ILogHandler previous = Debug.unityLogger.logHandler;
            var tracker = new ErrorTrackingLogHandler(previous);
            Debug.unityLogger.logHandler = tracker;
            string failure = string.Empty;
            try
            {
                foreach (Type probe in Probes)
                {
                    MethodInfo run = probe.GetMethod("Run", BindingFlags.Public
                        | BindingFlags.NonPublic | BindingFlags.Static);
                    if (run == null) throw new MissingMethodException(probe.FullName, "Run");
                    run.Invoke(null, null);
                }
                await RoaCharacterPreviewProbe.RunAsync();
                if (tracker.Failed) failure = tracker.FirstError;
            }
            catch (TargetInvocationException error)
            {
                failure = error.InnerException?.ToString() ?? error.ToString();
            }
            catch (Exception error)
            {
                failure = error.ToString();
            }
            finally
            {
                Debug.unityLogger.logHandler = previous;
            }

            if (!string.IsNullOrEmpty(failure))
            {
                Debug.LogError("[UNITY CLIENT AUDIT] FAIL: " + failure);
                EditorApplication.Exit(1);
                return;
            }

            Debug.Log("[UNITY CLIENT AUDIT] PASS: " + (Probes.Length + 1)
                + " deterministic editor probes completed.");
            EditorApplication.Exit(0);
        }

        private sealed class ErrorTrackingLogHandler : ILogHandler
        {
            private readonly ILogHandler _inner;
            public bool Failed { get; private set; }
            public string FirstError { get; private set; } = string.Empty;

            public ErrorTrackingLogHandler(ILogHandler inner)
            {
                _inner = inner;
            }

            public void LogFormat(LogType logType, UnityEngine.Object context,
                                  string format, params object[] args)
            {
                if (logType == LogType.Error || logType == LogType.Exception
                    || logType == LogType.Assert)
                {
                    Failed = true;
                    if (string.IsNullOrEmpty(FirstError))
                        FirstError = string.Format(format, args);
                }
                _inner.LogFormat(logType, context, format, args);
            }

            public void LogException(Exception exception, UnityEngine.Object context)
            {
                Failed = true;
                if (string.IsNullOrEmpty(FirstError)) FirstError = exception.ToString();
                _inner.LogException(exception, context);
            }
        }
    }
}
#endif
