#if UNITY_EDITOR
using System.Collections.Generic;
using System.Linq;
using Kromka.Authoring;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Облик НПС в окне сцены: тело нужного пола и сложения, причёска, цвет
    /// волос, форма лица и живая поза покоя — теми же деталями, что собирает
    /// клиент (RoaCharacterView). Модель — дочерний объект с DontSave: в сцену
    /// она не пишется и в сборку не попадает, а при каждом открытии сцены
    /// собирается заново. Клик по модели выделяет самого НПС (SelectionBase).
    /// </summary>
    [InitializeOnLoad]
    internal static class KromkaNpcPreview
    {
        private const string BodyUrlPrefix = "/assets/models/characters/base/character_";
        private const string AnimationLibraryUrl = "/assets/models/characters/npc/npc_humanoid_animations.glb";
        private const string PreviewName = "Облик (только в редакторе)";
        private const HideFlags PreviewFlags = HideFlags.DontSave | HideFlags.NotEditable;
        private const double FrameSeconds = 1.0 / 20.0;

        private sealed class Preview
        {
            public GameObject Holder;
            public string Key;
            public GameObject Animated;
            public AnimationClip Idle;
            public Transform Head;
            public Vector3 HeadScale;
            public float Phase;
        }

        private static readonly Dictionary<KromkaNpcAuthoring, Preview> Previews =
            new Dictionary<KromkaNpcAuthoring, Preview>();
        private static readonly HashSet<string> Reported = new HashSet<string>();
        private static AnimationClip _idle;
        private static double _nextFrame;

        static KromkaNpcPreview()
        {
            // В пакетном режиме смотреть некому, а лишние объекты мешали бы экспорту.
            if (Application.isBatchMode) return;
            EditorApplication.hierarchyChanged += Refresh;
            EditorSceneManager.sceneOpened += (scene, mode) => Refresh();
            EditorApplication.update += Tick;
            KromkaNpcAuthoring.AppearanceChanged += npc => EditorApplication.delayCall += () => Rebuild(npc);
            EditorApplication.playModeStateChanged += state =>
            {
                if (state == PlayModeStateChange.ExitingEditMode) ClearAll();
                if (state == PlayModeStateChange.EnteredEditMode) EditorApplication.delayCall += Refresh;
            };
            AssemblyReloadEvents.beforeAssemblyReload += ClearAll;
            EditorApplication.delayCall += Refresh;
        }

        /// <summary>Собрать недостающие модели и убрать модели ушедших НПС.</summary>
        private static void Refresh()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            var alive = new HashSet<KromkaNpcAuthoring>();
            for (int index = 0; index < SceneManager.sceneCount; index++)
            {
                Scene scene = SceneManager.GetSceneAt(index);
                if (!scene.isLoaded) continue;
                foreach (GameObject root in scene.GetRootGameObjects())
                foreach (KromkaNpcAuthoring npc in root.GetComponentsInChildren<KromkaNpcAuthoring>(true))
                {
                    alive.Add(npc);
                    if (!Previews.TryGetValue(npc, out Preview preview) || preview.Holder == null
                        || preview.Key != KeyOf(npc))
                        Rebuild(npc);
                }
            }
            foreach (KromkaNpcAuthoring gone in Previews.Keys.Where(npc => npc == null || !alive.Contains(npc)).ToList())
            {
                if (Previews[gone].Holder != null) Object.DestroyImmediate(Previews[gone].Holder);
                Previews.Remove(gone);
            }
        }

        private static string KeyOf(KromkaNpcAuthoring npc)
        {
            return npc.SexId + "|" + npc.BodyTypeId + "|" + npc.FaceId + "|" + npc.HairId + "|" + npc.HairColorId;
        }

        internal static void Rebuild(KromkaNpcAuthoring npc)
        {
            if (npc == null || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (Previews.TryGetValue(npc, out Preview old) && old.Holder != null) Object.DestroyImmediate(old.Holder);
            // Модель, оставшаяся от прошлой сборки домена, тоже уходит.
            foreach (Transform child in npc.transform.Cast<Transform>().ToList())
                if (child.name == PreviewName) Object.DestroyImmediate(child.gameObject);

            var holder = new GameObject(PreviewName);
            holder.transform.SetParent(npc.transform, false);
            var preview = new Preview { Holder = holder, Key = KeyOf(npc), Phase = Mathf.Abs(npc.NpcId.GetHashCode() % 1000) / 1000f };
            Previews[npc] = preview;

            string bodyUrl = BodyUrlPrefix + npc.SexId + "_" + npc.BodyTypeId + ".glb";
            if (!RoaModelPrefabCatalog.TryInstantiate(bodyUrl, holder.transform, out GameObject body))
            {
                if (Reported.Add(bodyUrl))
                    Debug.LogWarning("[НПС] Нет префаба тела " + bodyUrl + " — облик в сцене не показан.");
                SetFlags(holder);
                return;
            }

            // Клипы библиотеки привязаны к корню npc_humanoid_root, а у тела он
            // называется character_root — клиент переименовывает его так же.
            Transform skeleton = FindDeep(body.transform, "character_root");
            if (skeleton != null) skeleton.name = "npc_humanoid_root";
            Animation animation = body.GetComponentInChildren<Animation>(true);
            preview.Animated = animation != null ? animation.gameObject : body;
            preview.Idle = IdleClip();

            ApplyAppearance(npc, body, preview);
            SetFlags(holder);
            if (preview.Idle != null) SamplePose(preview, 0.0);
        }

        /// <summary>Причёска, цвет волос и форма лица — как в RoaCharacterView.</summary>
        private static void ApplyAppearance(KromkaNpcAuthoring npc, GameObject body, Preview preview)
        {
            bool showHair = npc.HairId != "shaved";
            Color hair = HairColor(npc.HairColorId);
            var block = new MaterialPropertyBlock();
            foreach (Transform node in body.GetComponentsInChildren<Transform>(true))
            {
                if (node.name == "head")
                {
                    preview.Head = node;
                    preview.HeadScale = Vector3.Scale(node.localScale, HeadFactors(npc.FaceId));
                    node.localScale = preview.HeadScale;
                }
                if (!node.name.StartsWith("hair_")) continue;
                node.gameObject.SetActive(showHair);
                // Цвет — блоком свойств: общий материал модели трогать нельзя.
                foreach (Renderer renderer in node.GetComponentsInChildren<Renderer>(true))
                {
                    renderer.GetPropertyBlock(block);
                    block.SetColor("baseColorFactor", hair);
                    block.SetColor("_BaseColor", hair);
                    block.SetColor("_Color", hair);
                    renderer.SetPropertyBlock(block);
                }
            }
        }

        private static Vector3 HeadFactors(string faceId)
        {
            string suffix = faceId.Length >= 2 ? faceId.Substring(faceId.Length - 2) : "01";
            if (suffix == "02") return new Vector3(0.88f, 1.018f, 1.05f);
            if (suffix == "03") return new Vector3(1.13f, 0.985f, 0.96f);
            if (suffix == "04") return new Vector3(0.98f, 0.982f, 1.09f);
            return Vector3.one;
        }

        private static Color HairColor(string id)
        {
            string hex = id == "hair_01" ? "#1A1512"
                : id == "hair_02" ? "#2A1B16"
                : id == "hair_04" ? "#6B452A"
                : id == "hair_05" ? "#8A6040"
                : id == "hair_06" ? "#A27A4B"
                : id == "hair_07" ? "#7B7D76"
                : id == "hair_08" ? "#5B2922"
                : "#4B3023";
            Color color = ColorUtility.TryParseHtmlString(hex, out Color parsed) ? parsed : new Color(0.294f, 0.188f, 0.137f);
            return QualitySettings.activeColorSpace == ColorSpace.Linear ? color.linear : color;
        }

        private static AnimationClip IdleClip()
        {
            if (_idle != null) return _idle;
            _idle = RoaModelPrefabCatalog.AnimationClips(AnimationLibraryUrl).FirstOrDefault(clip => clip.name == "idle");
            if (_idle == null && Reported.Add(AnimationLibraryUrl))
                Debug.LogWarning("[НПС] В библиотеке " + AnimationLibraryUrl + " нет клипа idle — НПС стоят без позы покоя.");
            return _idle;
        }

        /// <summary>Поза покоя дышит в окне сцены: у каждого НПС свой сдвиг фазы.</summary>
        private static void Tick()
        {
            if (Previews.Count == 0 || EditorApplication.isPlayingOrWillChangePlaymode) return;
            double now = EditorApplication.timeSinceStartup;
            if (now < _nextFrame) return;
            _nextFrame = now + FrameSeconds;
            bool any = false;
            foreach (Preview preview in Previews.Values)
            {
                if (preview.Holder == null || preview.Idle == null || preview.Animated == null) continue;
                SamplePose(preview, now);
                any = true;
            }
            if (any) SceneView.RepaintAll();
        }

        private static void SamplePose(Preview preview, double now)
        {
            float length = Mathf.Max(0.01f, preview.Idle.length);
            float time = (float)((now + preview.Phase * length) % length);
            preview.Idle.SampleAnimation(preview.Animated, time);
            // Клип мог тронуть голову: форма лица накладывается поверх, как у клиента.
            if (preview.Head != null) preview.Head.localScale = preview.HeadScale;
        }

        private static void ClearAll()
        {
            foreach (Preview preview in Previews.Values)
                if (preview.Holder != null) Object.DestroyImmediate(preview.Holder);
            Previews.Clear();
        }

        private static void SetFlags(GameObject holder)
        {
            foreach (Transform node in holder.GetComponentsInChildren<Transform>(true))
                node.gameObject.hideFlags = PreviewFlags;
        }

        private static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name) return root;
            foreach (Transform child in root)
            {
                Transform found = FindDeep(child, name);
                if (found != null) return found;
            }
            return null;
        }
    }
}
#endif
