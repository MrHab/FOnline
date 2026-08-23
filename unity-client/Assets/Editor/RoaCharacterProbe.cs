using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using GLTFast;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Проверка авторских ассетов персонажа прямо из редактора, без Play Mode.
    ///
    /// Нужна потому, что Play Mode не тикает, пока окно Unity не в фокусе, — а
    /// вопросы «загружается ли GLB», «сколько костей в риге» и «привязываются ли
    /// клипы из общей библиотеки анимаций» решаются и без запуска игры.
    ///
    /// Меню: Realm of Ashes → Проверить модели персонажей.
    /// </summary>
    public static class RoaCharacterProbe
    {
        private const string BaseUrl = "http://127.0.0.1:3000";
        private const string LibraryUrl = "/assets/models/characters/npc/npc_humanoid_animations.glb";

        [MenuItem("Realm of Ashes/Проверить модели персонажей")]
        public static void Run()
        {
            _ = Probe();
        }

        [MenuItem("Realm of Ashes/Проверить хват оружия")]
        public static void RunGrip()
        {
            _ = ProbeGrip();
        }

        /// <summary>
        /// Замер геометрии хвата: где узел крепления относительно кисти
        /// до и после применения позы. Отвечает на вопрос, применяется ли
        /// однокадровый клип assault_rifle_grip вообще.
        /// </summary>
        private static async Task ProbeGrip()
        {
            Debug.Log("[ХВАТ] старт");

            var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };
            var import = new GltfImport();
            string url = BaseUrl + "/assets/models/weapons/approved_assault_rifle_grip.glb";

            if (!await import.Load(url, settings))
            {
                Debug.LogError("[ХВАТ] GLB не загрузился: " + url);
                import.Dispose();
                return;
            }

            var probe = new GameObject("RoaGripProbeDiag");
            if (!await import.InstantiateMainSceneAsync(probe.transform))
            {
                Debug.LogError("[ХВАТ] экземпляр не создан");
                Object.DestroyImmediate(probe);
                import.Dispose();
                return;
            }

            var index = new Dictionary<string, Transform>();
            foreach (Transform t in probe.GetComponentsInChildren<Transform>(true))
                if (!index.ContainsKey(t.name)) index[t.name] = t;

            Debug.Log("[ХВАТ] узлов всего: " + index.Count);

            Transform hand;
            Transform mount;
            index.TryGetValue("hand_r", out hand);
            index.TryGetValue("approved_assault_rifle_mount", out mount);

            if (hand == null || mount == null)
            {
                Debug.LogError("[ХВАТ] нет hand_r или approved_assault_rifle_mount");
                Object.DestroyImmediate(probe);
                import.Dispose();
                return;
            }

            Debug.Log("[ХВАТ] mount родитель: "
                + (mount.parent != null ? mount.parent.name : "<корень сцены>"));
            Debug.Log("[ХВАТ] mount локально: pos=" + mount.localPosition + " rot=" + mount.localEulerAngles);

            Quaternion handBefore = hand.localRotation;
            float distBefore = Vector3.Distance(hand.position, mount.position);
            Debug.Log("[ХВАТ] ДО позы: hand_r=" + hand.position + " mount=" + mount.position
                + " расстояние=" + distBefore.ToString("F3") + " м");

            AnimationClip[] clips = import.GetAnimationClips();
            AnimationClip grip = null;
            if (clips != null)
                foreach (AnimationClip c in clips)
                    if (c != null && c.name.ToLowerInvariant() == "assault_rifle_grip") grip = c;

            if (grip == null)
            {
                Debug.LogError("[ХВАТ] клипа assault_rifle_grip нет");
                Object.DestroyImmediate(probe);
                import.Dispose();
                return;
            }

            Debug.Log("[ХВАТ] клип найден: длительность=" + grip.length.ToString("F3")
                + " с, legacy=" + grip.legacy);

            // Корень сцены glTF, а не обёртка: иначе пути клипа не разрешаются.
            GameObject sampleRoot = probe.transform.childCount > 0
                ? probe.transform.GetChild(0).gameObject
                : probe;
            Debug.Log("[ХВАТ] сэмплируем на объекте: " + sampleRoot.name);

            grip.legacy = true;
            grip.SampleAnimation(sampleRoot, grip.length * 0.5f);

            float handMoved = Quaternion.Angle(handBefore, hand.localRotation);
            float distAfter = Vector3.Distance(hand.position, mount.position);

            Debug.Log("[ХВАТ] ПОСЛЕ позы: hand_r=" + hand.position + " mount=" + mount.position
                + " расстояние=" + distAfter.ToString("F3") + " м");
            Debug.Log("[ХВАТ] кисть повернулась на " + handMoved.ToString("F1") + "°");

            if (handMoved < 0.5f)
                Debug.LogError("[ХВАТ] поза НЕ применилась — SampleAnimation не сработал");
            else if (distAfter > 0.25f)
                Debug.LogWarning("[ХВАТ] поза применилась, но крепление всё равно далеко: "
                    + distAfter.ToString("F3") + " м — значит формула крепления иная");
            else
                Debug.Log("[ХВАТ] крепление в кисти, всё сходится");

            Object.DestroyImmediate(probe);
            import.Dispose();
            Debug.Log("[ХВАТ] готово");
        }

        private static async Task Probe()
        {
            Debug.Log("[ПРОБА] старт");

            var settings = new ImportSettings { AnimationMethod = AnimationMethod.Legacy };

            // 1. Базовая модель.
            string modelUrl = BaseUrl + "/assets/models/characters/base/character_male_medium.glb";
            var baseImport = new GltfImport();

            if (!await baseImport.Load(modelUrl, settings))
            {
                Debug.LogError("[ПРОБА] базовая модель НЕ загрузилась: " + modelUrl
                    + " — запущен ли сервер (npm start)?");
                baseImport.Dispose();
                return;
            }

            var root = new GameObject("ProbeCharacter");
            if (!await baseImport.InstantiateMainSceneAsync(root.transform))
            {
                Debug.LogError("[ПРОБА] экземпляр модели не создан");
                Object.DestroyImmediate(root);
                baseImport.Dispose();
                return;
            }

            var skinned = root.GetComponentsInChildren<SkinnedMeshRenderer>();
            Debug.Log("[ПРОБА] SkinnedMeshRenderer: " + skinned.Length);
            foreach (SkinnedMeshRenderer s in skinned)
            {
                string shader = s.sharedMaterial != null && s.sharedMaterial.shader != null
                    ? s.sharedMaterial.shader.name
                    : "<нет>";
                Debug.Log("[ПРОБА]   " + s.name + ": костей=" + s.bones.Length + " шейдер=" + shader);
            }

            var animation = root.GetComponentInChildren<Animation>();
            if (animation == null)
            {
                Debug.LogError("[ПРОБА] компонента Animation нет — клипы не импортировались");
                Object.DestroyImmediate(root);
                baseImport.Dispose();
                return;
            }

            var own = new List<string>();
            foreach (AnimationState st in animation) own.Add(st.name);
            Debug.Log("[ПРОБА] собственные клипы базы (" + own.Count + "): " + string.Join(", ", own));

            // 2. Общая библиотека анимаций на том же риге.
            var libraryImport = new GltfImport();
            if (!await libraryImport.Load(BaseUrl + LibraryUrl, settings))
            {
                Debug.LogWarning("[ПРОБА] библиотека анимаций не загрузилась — задний ход пойдёт реверсом");
                libraryImport.Dispose();
                Object.DestroyImmediate(root);
                baseImport.Dispose();
                return;
            }

            AnimationClip[] clips = libraryImport.GetAnimationClips();
            Debug.Log("[ПРОБА] клипов в библиотеке: " + (clips != null ? clips.Length : 0));

            AnimationClip probeClip = clips != null
                ? clips.FirstOrDefault(c => c != null && c.name == "walk_back")
                : null;

            if (probeClip == null)
            {
                Debug.LogWarning("[ПРОБА] клипа walk_back в библиотеке нет");
                Object.DestroyImmediate(root);
                libraryImport.Dispose();
                baseImport.Dispose();
                return;
            }

            // 3. Legacy-клип привязывается по ПОЛНОМУ пути трансформа. Скелеты
            // базы и библиотеки идентичны, но корневой узел назван по-разному,
            // поэтому пути расходятся целиком. Клиент выравнивает префикс
            // переименованием корня — проба проверяет ровно этот приём.
            var paths = new List<string>();
            foreach (var binding in AnimationUtility.GetCurveBindings(probeClip))
                if (!paths.Contains(binding.path)) paths.Add(binding.path);

            int before = paths.Count(p => root.transform.Find(p) != null);
            Debug.Log("[ПРОБА] walk_back до переименования: путей " + paths.Count + ", совпало " + before);

            Transform baseRoot = root.transform.Find("character_root");
            if (baseRoot == null)
            {
                Debug.LogError("[ПРОБА] узла character_root нет — структура модели изменилась");
                Object.DestroyImmediate(root);
                libraryImport.Dispose();
                baseImport.Dispose();
                return;
            }

            baseRoot.name = "npc_humanoid_root";
            int after = paths.Count(p => root.transform.Find(p) != null);
            Debug.Log("[ПРОБА] walk_back после переименования: совпало " + after + " из " + paths.Count);

            if (after == paths.Count)
                Debug.Log("[ПРОБА] клипы библиотеки полностью привязываются к ригу базы");
            else if (after > 0)
                Debug.LogWarning("[ПРОБА] привязалась только часть путей — возможны артефакты позы");
            else
                Debug.LogError("[ПРОБА] клипы НЕ привязываются даже после выравнивания префикса");

            Object.DestroyImmediate(root);
            libraryImport.Dispose();
            baseImport.Dispose();
            Debug.Log("[ПРОБА] готово");
        }
    }
}
