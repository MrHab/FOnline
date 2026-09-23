using System;
using System.IO;
using System.Threading.Tasks;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    public static class RoaApocalypseCaravanProbe
    {
        private static bool _enteredPlayMode;

        [InitializeOnLoadMethod]
        private static void RunIfRequested()
        {
            string request = Path.Combine(Application.dataPath,
                "../Library/roa-apocalypse-caravan-probe.request");
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

        [MenuItem("Realm of Ashes/PolygonApocalypse/Check caravan cast")]
        public static async void Run()
        {
            GameObject host = null;
            try
            {
                if (!Application.isPlaying)
                    throw new InvalidOperationException("Caravan probe requires Play Mode.");
                host = new GameObject("ApocalypseCaravanProbe");
                host.SetActive(false);
                var stage = host.AddComponent<RoaCaravanAmbushStage>();
                stage.BeginLoad("http://127.0.0.1:3000", null, null);
                Task completed = await Task.WhenAny(stage.Loading, Task.Delay(90000));
                if (completed != stage.Loading || !stage.Ready)
                    throw new InvalidOperationException("Caravan cast: " + stage.LoadError
                        + "; people=" + stage.LoadedPeople
                        + "; brahmins=" + stage.LoadedBrahmins);
                int visuals = 0;
                foreach (Transform node in host.GetComponentsInChildren<Transform>(true))
                    if (node.name == RoaApocalypseVisuals.ChildName) visuals++;
                if (visuals < 11)
                    throw new InvalidOperationException("Only " + visuals
                        + " cast members have PolygonApocalypse visuals.");
                Debug.Log("[ROA APOCALYPSE] Caravan cast PASS: " + stage.LoadedPeople
                    + " people, " + stage.LoadedBrahmins + " beasts, " + visuals + " pack visuals.");
            }
            catch (Exception error) { Debug.LogError("[ROA APOCALYPSE] Caravan cast FAIL " + error); }
            finally
            {
                if (host != null) UnityEngine.Object.Destroy(host);
                if (_enteredPlayMode)
                {
                    _enteredPlayMode = false;
                    EditorApplication.ExitPlaymode();
                }
            }
        }
    }
}
