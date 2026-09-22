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
            return npc.SexId + "|" + npc.HairId + "|" + npc.HairColorId
                + "|" + npc.Weapon + "|" + npc.Armor + "|" + npc.Helmet + "|" + npc.Boots + "|" + npc.Backpack;
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

            string bodyUrl = BodyUrlPrefix + npc.BodyKey + ".glb";
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
            Dress(npc, body, skeleton != null ? skeleton : body.transform);
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

        /// <summary>
        /// Наряд — теми же путями моделей и той же привязкой к скелету, что в
        /// игре (RoaEquipmentView). Оружие ложится в правую руку по точке хвата
        /// модели; стойки и IK рук, как у живого НПС в бою, здесь не нужны.
        /// </summary>
        private static void Dress(KromkaNpcAuthoring npc, GameObject body, Transform skeletonRoot)
        {
            var bones = new Dictionary<string, Transform>();
            foreach (Transform node in body.GetComponentsInChildren<Transform>(true))
                if (!bones.ContainsKey(node.name)) bones[node.name] = node;
            string bodyKey = npc.BodyKey;

            var worn = new Dictionary<string, GameObject>();
            foreach ((string slot, string itemId) in new[]
                     { ("armor", npc.Armor), ("helmet", npc.Helmet), ("boots", npc.Boots), ("backpack", npc.Backpack) })
            {
                if (string.IsNullOrEmpty(itemId)) continue;
                if (!RoaEquipmentView.TryModelPath(slot, itemId, bodyKey, "none", out string path))
                {
                    Report("[НПС] Нет модели " + slot + " «" + itemId + "» — в сцене она не показана.");
                    continue;
                }
                GameObject source = InstantiateModel(path, skeletonRoot);
                if (source == null)
                {
                    Report("[НПС] Нет префаба " + path + " — " + slot + " в сцене не показан.");
                    continue;
                }
                GameObject bound = RoaEquipmentView.BindToSkeleton(source, skeletonRoot, bones, itemId);
                Object.DestroyImmediate(source);
                if (bound == null)
                {
                    Report("[НПС] " + itemId + " не садится на кости тела " + bodyKey + ".");
                    continue;
                }
                bound.SetActive(true);
                worn[slot] = bound;
            }

            // Как у клиента: шлем и защитный костюм прячут волосы, отдельные
            // ботинки — встроенную обувь брони.
            if (worn.ContainsKey("helmet") || npc.Armor == "hazmatSuit")
                foreach (Transform node in body.GetComponentsInChildren<Transform>(true))
                    if (node.name.StartsWith("hair_")) node.gameObject.SetActive(false);
            if (worn.TryGetValue("armor", out GameObject armor) && worn.ContainsKey("boots"))
                foreach (SkinnedMeshRenderer renderer in armor.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                    if (renderer.name.Contains(RoaSuitModelCatalog.FootwearLayer)) renderer.gameObject.SetActive(false);

            if (npc.Weapon == "fists" || !bones.TryGetValue("hand_r", out Transform hand)) return;
            GameObject weapon = InstantiateModel("/assets/models/weapons/weapon_" + npc.Weapon + ".glb", hand);
            if (weapon == null)
            {
                Report("[НПС] Нет модели оружия «" + npc.Weapon + "» — в руке пусто.");
                return;
            }
            Transform grip = FindDeep(weapon.transform, "socket_grip_r");
            if (grip == null) return;
            // Точка хвата встаёт в ладонь: сначала поворот, потом сдвиг.
            weapon.transform.rotation = hand.rotation * Quaternion.Inverse(Quaternion.Inverse(weapon.transform.rotation) * grip.rotation);
            weapon.transform.position += hand.position - grip.position;
        }

        /// <summary>Модель по игровому пути: каталог клиента, иначе префаб проекта, иначе сам GLB пакета.</summary>
        private static GameObject InstantiateModel(string url, Transform parent)
        {
            if (RoaModelPrefabCatalog.TryInstantiate(url, parent, out GameObject fromCatalog)) return fromCatalog;
            // Регистр пути сохраняем: имена префабов в camelCase (weapon_assaultRifle).
            const string Root = "/assets/models/";
            int at = url.IndexOf(Root, System.StringComparison.OrdinalIgnoreCase);
            string relative = at >= 0 ? url.Substring(at + Root.Length) : url.TrimStart('/');
            // Хвост версии (?v=…) — для кэша браузера, в пути ассета его нет.
            int query = relative.IndexOfAny(new[] { '?', '#' });
            if (query >= 0) relative = relative.Substring(0, query);
            string withoutExtension = relative.EndsWith(".glb") ? relative.Substring(0, relative.Length - 4) : relative;
            GameObject asset = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/Models/" + withoutExtension + ".prefab")
                ?? AssetDatabase.LoadAssetAtPath<GameObject>("Packages/com.realmofashes.models/" + relative);
            return asset != null ? (GameObject)Object.Instantiate(asset, parent, false) : null;
        }

        private static void Report(string message)
        {
            if (Reported.Add(message)) Debug.LogWarning(message);
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
