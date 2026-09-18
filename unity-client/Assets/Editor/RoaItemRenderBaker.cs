#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Печёт иконки предметов из их собственных 3D-моделей: вместо плоского
    /// рисунка с запечённой плиткой в ячейке лежит настоящий рендер на прозрачном фоне.
    ///
    /// Геометрию берём из префабов Assets/Prefabs/Models/** — все GLB уже импортированы
    /// как локальный UPM-пакет, поэтому ни сети, ни GLTFast, ни Play-режима не нужно:
    /// всё синхронно в edit mode. Соответствие «предмет -> модель» НЕ дублируется, а
    /// вызывается из RoaGroundItems.ModelPath рефлексией — иначе печка и игра
    /// разъехались бы при первой же правке каталога.
    ///
    /// Четыре ловушки прозрачности, каждая даёт чёрный квадрат или грязную кромку:
    ///   * cam.allowHDR = false — HDR-буфер URP это B10G11R11_UFloat, в нём НЕТ альфы;
    ///   * renderPostProcessing = false — пост-обработка URP затирает альфу единицей;
    ///   * рендер через RenderPipeline.SubmitRenderRequest, а не camera.Render();
    ///   * даунсемпл усредняет ПРЕМУЛЬТИПЛИЦИРОВАННЫЕ пиксели, иначе по краю
    ///     появляется тёмный ореол от прозрачного чёрного.
    /// </summary>
    public static class RoaItemRenderBaker
    {
        private const int Size = 256;
        private const int Super = 4;
        private const int Layer = 31;              // RoaCharacterPreview.PreviewLayer
        private const string OutDir = "Assets/Resources/RealmUi/items";
        private const string CatalogPath = "../data/kromka/items.json";
        private const int Thumb = 64;
        private const string SheetPath = "Library/PipboyScreen/item-contact-sheet.png";

        // Три четверти сверху-слева: предмет читается объёмным и не «валится набок».
        private const float Pitch = 27f;
        private const float Yaw = -35f;
        private const float Pad = 1.10f;

        /// <summary>Кандидаты наклона кадра; ноль обязан быть первым — при равенстве побеждает он.</summary>
        private static readonly float[] RollCandidates = { 0f, -15f, -30f, -45f, 15f, 30f, 45f };

        [MenuItem("Realm of Ashes/Напечь рендеры предметов")]
        public static void Run()
        {
            List<string> ids = ReadCatalogIds();
            if (ids.Count == 0)
            {
                Debug.LogError("[ITEM BAKE] каталог предметов не прочитан: " + Path.GetFullPath(CatalogPath));
                return;
            }

            Directory.CreateDirectory(OutDir);
            GameObject rig = null;
            var baked = new List<string>();
            var skipped = new List<string>();
            var thumbs = new List<Color[]>();
            var thumbNames = new List<string>();

            // Освещение сцены — часть кадра, а ambient у открытых сцен разный
            // (0.38 у карты против 0.78 у каравана). Без фиксации партия зависела бы
            // от того, что сейчас открыто в редакторе, и перепечка меняла бы яркость
            // случайным образом. Возвращаем всё как было в finally.
            AmbientMode savedMode = RenderSettings.ambientMode;
            Color savedAmbient = RenderSettings.ambientLight;
            float savedIntensity = RenderSettings.ambientIntensity;
            Material savedSkybox = RenderSettings.skybox;
            bool savedFog = RenderSettings.fog;
            try
            {
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = new Color(0.34f, 0.35f, 0.38f, 1f);
                RenderSettings.ambientIntensity = 1f;
                RenderSettings.skybox = null;
                RenderSettings.fog = false;

                Camera camera = BuildRig(out rig);
                foreach (string id in ids)
                {
                    GameObject instance = Instantiate(id, out GameObject focus, out string kind);
                    if (instance == null) { skipped.Add(id); continue; }
                    try
                    {
                        instance.transform.SetParent(rig.transform, false);
                        SetLayerRecursively(instance, Layer);
                        if (focus != instance) HideOutside(instance, focus);
                        if (!Frame(camera, focus, kind)) { skipped.Add(id); continue; }
                        byte[] png = Capture(camera, out Color[] thumb);
                        thumbs.Add(thumb); thumbNames.Add(id);
                        File.WriteAllBytes(Path.Combine(OutDir, "item_" + id + ".png"), png);
                        baked.Add(id);
                    }
                    finally { Object.DestroyImmediate(instance); }
                }
            }
            finally
            {
                if (rig != null) Object.DestroyImmediate(rig);
                RenderSettings.ambientMode = savedMode;
                RenderSettings.ambientLight = savedAmbient;
                RenderSettings.ambientIntensity = savedIntensity;
                RenderSettings.skybox = savedSkybox;
                RenderSettings.fog = savedFog;
            }

            AssetDatabase.Refresh();
            foreach (string id in baked) ApplyImportSettings(Path.Combine(OutDir, "item_" + id + ".png"));
            AssetDatabase.Refresh();

            WriteContactSheet(thumbs);

            Debug.Log("[ITEM BAKE] напечено " + baked.Count + " из " + ids.Count
                      + "; без модели: " + (skipped.Count == 0 ? "нет" : string.Join(", ", skipped))
                      + "; контрольный лист: " + SheetPath);
        }

        private static List<string> ReadCatalogIds()
        {
            var ids = new List<string>();
            if (!File.Exists(CatalogPath)) return ids;
            var catalog = JObject.Parse(File.ReadAllText(CatalogPath));
            foreach (JToken row in catalog["items"] as JArray ?? new JArray())
            {
                string id = row["id"]?.ToString();
                if (!string.IsNullOrEmpty(id)) ids.Add(id);
            }
            return ids;
        }

        /// <summary>
        /// Путь модели спрашиваем у самой игры: RoaGroundItems.ModelPath приватен,
        /// но он единственный держит порядок разрешения (каталог Кромки, библиотека,
        /// оружие, снаряжение). Собственная копия таблиц устарела бы молча.
        /// </summary>
        private static string ModelUrl(string itemId, out string kind)
        {
            MethodInfo method = typeof(RoaGroundItems).GetMethod(
                "ModelPath", BindingFlags.NonPublic | BindingFlags.Static);
            if (method == null)
            {
                // Переименовали резолвер — печка обязана упасть с внятной причиной,
                // а не тихо пропустить все 84 предмета как «без модели».
                throw new System.MissingMethodException(
                    "RoaGroundItems.ModelPath не найден: печка иконок потеряла источник путей к моделям.");
            }
            object[] args = { itemId, null };
            string url = (string)method.Invoke(null, args);
            kind = args[1] as string ?? string.Empty;
            return url ?? string.Empty;
        }

        /// <summary>
        /// Возвращает экземпляр модели и ветку, которую надо снять. Для библиотеки
        /// это разные объекты: вынуть узел наружу нельзя — Unity запрещает
        /// перестраивать иерархию префаб-экземпляра, и попытка молча ничего не даёт.
        /// Поэтому соседей не отрываем, а гасим.
        /// </summary>
        private static GameObject Instantiate(string itemId, out GameObject focus, out string kind)
        {
            focus = null;
            string url = ModelUrl(itemId, out kind);
            if (string.IsNullOrEmpty(url)) return null;

            // /assets/models/X.glb?v=... -> Assets/Prefabs/Models/X.prefab
            // Версию в запросе обязательно срезать явно: каталоги предметов и
            // снаряжения отдают путь с "?v=...", и стоит версии однажды получить
            // точку, как расширение срежется не там и треть путей уедет в никуда.
            int query = url.IndexOf('?');
            if (query >= 0) url = url.Substring(0, query);
            string relative = url.StartsWith("/assets/models/") ? url.Substring("/assets/models/".Length) : url;
            string prefabPath = "Assets/Prefabs/Models/" + Path.ChangeExtension(relative, ".prefab").Replace('\\', '/');
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefab == null) return null;

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            if (instance == null) return null;
            instance.hideFlags = HideFlags.HideAndDontSave;
            focus = instance;
            if (kind != "library") return instance;

            // Библиотека держит два десятка предметов в одной сцене — снимаем одну ветку.
            string libraryId = LibraryAlias(itemId);
            Transform wanted = FindDeep(instance.transform, "ground_item_" + libraryId);
            if (wanted == null) { Object.DestroyImmediate(instance); return null; }
            focus = wanted.gameObject;
            return instance;
        }

        /// <summary>Гасит всё, что не входит в снимаемую ветку.</summary>
        private static void HideOutside(GameObject instance, GameObject focus)
        {
            foreach (Renderer renderer in instance.GetComponentsInChildren<Renderer>(true))
            {
                bool inside = renderer.transform == focus.transform
                              || renderer.transform.IsChildOf(focus.transform);
                renderer.enabled = inside;
            }
        }

        private static string LibraryAlias(string itemId)
        {
            FieldInfo field = typeof(RoaGroundItems).GetField(
                "LibraryAliases", BindingFlags.NonPublic | BindingFlags.Static);
            var aliases = field?.GetValue(null) as Dictionary<string, string>;
            return aliases != null && aliases.TryGetValue(itemId, out string alias) ? alias : itemId;
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

        private static Camera BuildRig(out GameObject rig)
        {
            // Далеко под миром, но не настолько, чтобы терять точность float:
            // превью персонажа стоит на -10000, арт оружия на -10500.
            rig = new GameObject("RoaItemRenderRig") { hideFlags = HideFlags.HideAndDontSave };
            rig.transform.position = new Vector3(0f, -12000f, 0f);

            var cameraGo = new GameObject("BakeCamera") { hideFlags = HideFlags.HideAndDontSave };
            cameraGo.transform.SetParent(rig.transform, false);
            Camera camera = cameraGo.AddComponent<Camera>();
            camera.enabled = false;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
            camera.orthographic = true;
            camera.cullingMask = 1 << Layer;
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 50f;
            camera.allowHDR = false;   // в HDR-буфере URP нет альфы — иначе чёрный квадрат
            camera.allowMSAA = false;
            UniversalAdditionalCameraData data = camera.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = false;  // пост-обработка затёрла бы альфу единицей
            data.antialiasing = AntialiasingMode.None;
            data.renderShadows = false;

            // Альбедо у здешних материалов тёмное (у оружия средняя яркость 35/255),
            // а плитка карточки и того темнее — поэтому rim поднят выше fill: он
            // единственный отделяет силуэт от фона. Четвёртый свет снизу — вместо
            // отражения от пола, которого у висящего в пустоте предмета нет, иначе
            // низ силуэта проваливается в черноту.
            AddLight(rig, new Vector3(38f, -28f, 0f), new Color(1f, 0.96f, 0.89f), 1.65f);
            AddLight(rig, new Vector3(16f, 142f, 0f), new Color(0.72f, 0.82f, 1f), 0.60f);
            AddLight(rig, new Vector3(-24f, 214f, 0f), new Color(1f, 0.78f, 0.55f), 0.85f);
            AddLight(rig, new Vector3(-58f, 24f, 0f), new Color(0.78f, 0.82f, 0.88f), 0.30f);
            return camera;
        }

        private static void AddLight(GameObject rig, Vector3 euler, Color color, float intensity)
        {
            var go = new GameObject("BakeLight") { hideFlags = HideFlags.HideAndDontSave };
            go.transform.SetParent(rig.transform, false);
            go.transform.localRotation = Quaternion.Euler(euler);
            Light light = go.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.shadows = LightShadows.None;
            light.cullingMask = 1 << Layer;
        }

        /// <summary>
        /// Ставит камеру так, чтобы предмет занял кадр целиком. Поворачиваем камеру,
        /// а не модель: иначе лежачие предметы встают под случайным углом.
        /// Возвращает false, если рендерить нечего.
        /// </summary>
        private static bool Frame(Camera camera, GameObject instance, string kind)
        {
            var renderers = instance.GetComponentsInChildren<Renderer>(false);
            if (renderers.Length == 0) return false;
            foreach (Renderer renderer in renderers)
            {
                // У скинов границы в edit mode бывают устаревшие, пока их не пересчитают.
                if (renderer is SkinnedMeshRenderer skinned) skinned.updateWhenOffscreen = true;
            }

            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            if (bounds.extents.sqrMagnitude <= 0f) return false;

            // Наклон кадра подбираем, а не задаём таблицей по семействам: длинные
            // предметы (ствол при соотношении 5.5:1 занимает пятую часть квадрата)
            // укладываются по диагонали ячейки и вырастают вдвое, а компактным
            // подбор сам вернёт ноль. Критерий — минимальная сторона квадрата,
            // в который предмет вписывается.
            // Снаряжение — это одежда, сшитая по телу: у неё нет лежачей позы, и
            // взгляд сверху-сбоку показывает пустую изнанку. Почти фронтальный
            // ракурс читается как вещь на витрине, а не как оболочка.
            bool worn = kind == "equipment" || kind == "equipment-catalog";
            float pitch = worn ? 6f : Pitch;
            float yaw = worn ? -16f : Yaw;

            Quaternion rotation = Quaternion.identity;
            float ex = 0f, ey = 0f, ez = 0f, best = float.MaxValue;
            foreach (float roll in RollCandidates)
            {
                Quaternion candidate = Quaternion.Euler(pitch, yaw, roll);
                Vector3 r = candidate * Vector3.right;
                Vector3 u = candidate * Vector3.up;
                Vector3 f = candidate * Vector3.forward;
                float cx = 0f, cy = 0f, cz = 0f;
                for (int i = 0; i < 8; i++)
                {
                    var corner = new Vector3(
                        (i & 1) == 0 ? -bounds.extents.x : bounds.extents.x,
                        (i & 2) == 0 ? -bounds.extents.y : bounds.extents.y,
                        (i & 4) == 0 ? -bounds.extents.z : bounds.extents.z);
                    cx = Mathf.Max(cx, Mathf.Abs(Vector3.Dot(corner, r)));
                    cy = Mathf.Max(cy, Mathf.Abs(Vector3.Dot(corner, u)));
                    cz = Mathf.Max(cz, Mathf.Abs(Vector3.Dot(corner, f)));
                }
                float side = Mathf.Max(cx, cy);
                if (side >= best) continue;
                best = side; rotation = candidate; ex = cx; ey = cy; ez = cz;
            }

            Vector3 right = rotation * Vector3.right;
            Vector3 up = rotation * Vector3.up;
            Vector3 forward = rotation * Vector3.forward;

            camera.aspect = 1f;
            camera.orthographicSize = Mathf.Max(0.005f, Mathf.Max(ey, ex) * Pad);
            float distance = ez + bounds.extents.magnitude + 1f;
            camera.transform.SetPositionAndRotation(bounds.center - forward * distance, rotation);
            camera.farClipPlane = distance + ez * 2f + 2f;
            return true;
        }

        private static byte[] Capture(Camera camera, out Color[] thumb)
        {
            int side = Size * Super;
            RenderTexture previous = RenderTexture.active;
            var target = new RenderTexture(side, side, 24, RenderTextureFormat.ARGB32)
            {
                name = "ItemBake",
                antiAliasing = 1,
                useMipMap = false,
                autoGenerateMips = false
            };
            Texture2D shot = null;
            Texture2D small = null;
            try
            {
                target.Create();
                camera.targetTexture = target;
                if (GraphicsSettings.currentRenderPipeline != null)
                    RenderPipeline.SubmitRenderRequest(camera, new RenderPipeline.StandardRequest { destination = target });
                else camera.Render();

                RenderTexture.active = target;
                shot = new Texture2D(side, side, TextureFormat.RGBA32, false);
                shot.ReadPixels(new Rect(0f, 0f, side, side), 0, 0);
                shot.Apply(false, false);
                small = Downsample(shot);
                thumb = BoxSample(small.GetPixels(), Size, Thumb);
                return small.EncodeToPNG();
            }
            finally
            {
                RenderTexture.active = previous;
                camera.targetTexture = null;
                target.Release();
                Object.DestroyImmediate(target);
                if (shot != null) Object.DestroyImmediate(shot);
                if (small != null) Object.DestroyImmediate(small);
            }
        }

        /// <summary>
        /// Усреднение блока Super×Super в премультиплицированном виде. Обычное
        /// билинейное уменьшение притягивает к кромке прозрачный чёрный и оставляет
        /// вокруг предмета тёмный ореол, который особенно виден на светлой плитке.
        /// </summary>
        private static Texture2D Downsample(Texture2D source)
        {
            Color[] src = source.GetPixels();
            int side = source.width;
            var result = new Texture2D(Size, Size, TextureFormat.RGBA32, false);
            var pixels = new Color[Size * Size];
            float block = Super * Super;
            for (int y = 0; y < Size; y++)
            {
                for (int x = 0; x < Size; x++)
                {
                    float a = 0f, r = 0f, g = 0f, b = 0f;
                    for (int oy = 0; oy < Super; oy++)
                    {
                        int row = (y * Super + oy) * side;
                        for (int ox = 0; ox < Super; ox++)
                        {
                            Color p = src[row + x * Super + ox];
                            a += p.a; r += p.r * p.a; g += p.g * p.a; b += p.b * p.a;
                        }
                    }
                    pixels[y * Size + x] = a > 0f
                        ? new Color(r / a, g / a, b / a, a / block)
                        : new Color(0f, 0f, 0f, 0f);
                }
            }
            result.SetPixels(pixels);
            result.Apply(false, false);
            return result;
        }

        private static void ApplyImportSettings(string path)
        {
            var importer = AssetImporter.GetAtPath(path.Replace('\\', '/')) as TextureImporter;
            if (importer == null) return;
            importer.textureType = TextureImporterType.Default;
            // Без alphaIsTransparency Unity не размывает цвет под прозрачными пикселями,
            // и при билинейной фильтрации по кромке вылезает грязь.
            importer.alphaIsTransparency = true;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            importer.mipmapEnabled = false;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.filterMode = FilterMode.Bilinear;
            importer.maxTextureSize = Size;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.SaveAndReimport();
        }


        /// <summary>
        /// Контрольный лист: вся партия одной картинкой. Судить о 83 рендерах,
        /// открывая их по одному, нельзя — разъехавшийся ракурс или провалившийся
        /// в темноту силуэт виден только рядом с соседями.
        /// </summary>
        private static void WriteContactSheet(List<Color[]> thumbs)
        {
            if (thumbs.Count == 0) return;
            int columns = 12;
            int rows = Mathf.CeilToInt(thumbs.Count / (float)columns);
            int width = columns * Thumb, height = rows * Thumb;
            var sheet = new Texture2D(width, height, TextureFormat.RGBA32, false);
            var pixels = new Color[width * height];
            // Шахматная подложка: на ней сразу видно, где альфа не получилась.
            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                    pixels[y * width + x] = ((x / 8 + y / 8) % 2 == 0)
                        ? new Color(0.16f, 0.16f, 0.16f, 1f)
                        : new Color(0.22f, 0.22f, 0.22f, 1f);

            for (int i = 0; i < thumbs.Count; i++)
            {
                int col = i % columns;
                int row = rows - 1 - i / columns;   // первая строка сверху
                Color[] cell = thumbs[i];
                for (int y = 0; y < Thumb; y++)
                {
                    for (int x = 0; x < Thumb; x++)
                    {
                        Color over = cell[y * Thumb + x];
                        int index = (row * Thumb + y) * width + col * Thumb + x;
                        Color under = pixels[index];
                        pixels[index] = Color.Lerp(under, over, over.a);
                    }
                }
            }
            sheet.SetPixels(pixels);
            sheet.Apply(false, false);
            Directory.CreateDirectory(Path.GetDirectoryName(SheetPath));
            File.WriteAllBytes(SheetPath, sheet.EncodeToPNG());
            Object.DestroyImmediate(sheet);
        }

        /// <summary>Усреднение блоками до стороны target; альфа честная, цвет премультиплицирован.</summary>
        private static Color[] BoxSample(Color[] source, int sourceSide, int target)
        {
            int factor = Mathf.Max(1, sourceSide / target);
            var result = new Color[target * target];
            float block = factor * factor;
            for (int y = 0; y < target; y++)
            {
                for (int x = 0; x < target; x++)
                {
                    float a = 0f, r = 0f, g = 0f, b = 0f;
                    for (int oy = 0; oy < factor; oy++)
                    {
                        int line = (y * factor + oy) * sourceSide;
                        for (int ox = 0; ox < factor; ox++)
                        {
                            Color p = source[line + x * factor + ox];
                            a += p.a; r += p.r * p.a; g += p.g * p.a; b += p.b * p.a;
                        }
                    }
                    result[y * target + x] = a > 0f
                        ? new Color(r / a, g / a, b / a, a / block)
                        : new Color(0f, 0f, 0f, 0f);
                }
            }
            return result;
        }

        private static void SetLayerRecursively(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform) SetLayerRecursively(child.gameObject, layer);
        }
    }
}
#endif
