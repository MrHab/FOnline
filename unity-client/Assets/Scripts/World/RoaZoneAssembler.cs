using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>
    /// Собирает сцену сгенерированной зоны из префабов набора. Экземпляры берутся
    /// из пулов и возвращаются в них при уходе из зоны, поэтому переход из зоны в
    /// зону не создаёт и не уничтожает сотни объектов заново.
    ///
    /// Коллизия ставится по данным, а не по мешу: у преграды тот же бокс, что сервер
    /// строит из collisionParts, поэтому клиент упирается ровно там, где сервер.
    /// Коллайдеры самих префабов выключаются.
    /// </summary>
    public sealed class RoaZoneAssembler : MonoBehaviour
    {
        [Tooltip("Сколько объектов ставить за кадр: сборка не должна подвешивать кадр.")]
        public int ObjectsPerFrame = 40;

        private readonly Dictionary<string, Stack<GameObject>> _pool = new Dictionary<string, Stack<GameObject>>(StringComparer.Ordinal);
        private readonly List<KeyValuePair<string, GameObject>> _active = new List<KeyValuePair<string, GameObject>>();
        private Transform _poolRoot;

        public int ActiveCount { get { return _active.Count; } }
        public int CreatedCount { get; private set; }
        public int MissingPrefabs { get; private set; }

        public IEnumerator Build(LocationDefinition definition, Transform parent,
                                 Dictionary<string, GameObject> roots, Dictionary<string, LocationObject> entries,
                                 Action<float> progress)
        {
            RoaZoneKitCatalog kit = RoaZoneKitCatalog.Instance;
            MissingPrefabs = 0;
            if (definition?.Objects == null || kit == null) yield break;
            int total = definition.Objects.Count;
            int done = 0;
            foreach (LocationObject entry in definition.Objects)
            {
                done++;
                if (entry == null || string.IsNullOrEmpty(entry.Prefab)) continue;
                GameObject instance = Take(kit, entry.Prefab, parent);
                if (instance == null) { MissingPrefabs++; continue; }
                instance.name = string.IsNullOrEmpty(entry.Id) ? entry.Prefab : entry.Id;
                RoaLocationLoader.ApplyTransform(instance.transform, entry);
                ConfigureCollision(instance, entry);
                // Объект с подсказкой помечаем: по метке её находит наведение курсора.
                var tag = instance.GetComponent<RealmOfAshes.Game.RoaWorldObjectTag>();
                if (entry.Hover != null)
                {
                    if (tag == null) tag = instance.AddComponent<RealmOfAshes.Game.RoaWorldObjectTag>();
                    tag.ObjectId = entry.Id;
                    ConfigureHoverProbe(instance, entry);
                }
                else if (tag != null) tag.ObjectId = string.Empty;
                instance.SetActive(true);
                if (!string.IsNullOrEmpty(entry.Id))
                {
                    roots[entry.Id] = instance;
                    entries[entry.Id] = entry;
                }
                if (done % Mathf.Max(1, ObjectsPerFrame) == 0)
                {
                    progress?.Invoke(total > 0 ? done / (float)total : 1f);
                    yield return null;
                }
            }
            progress?.Invoke(1f);
            if (MissingPrefabs > 0)
                Debug.LogWarning("[ROA] Зона " + definition.Id + ": нет префаба у " + MissingPrefabs + " объектов.");
        }

        /// <summary>Вернуть все объекты зоны в пулы.</summary>
        public void ReleaseAll()
        {
            Transform poolRoot = PoolRoot();
            foreach (KeyValuePair<string, GameObject> pair in _active)
            {
                if (pair.Value == null) continue;
                pair.Value.SetActive(false);
                pair.Value.transform.SetParent(poolRoot, false);
                if (!_pool.TryGetValue(pair.Key, out Stack<GameObject> stack))
                {
                    stack = new Stack<GameObject>();
                    _pool[pair.Key] = stack;
                }
                stack.Push(pair.Value);
            }
            _active.Clear();
        }

        private GameObject Take(RoaZoneKitCatalog kit, string key, Transform parent)
        {
            GameObject instance = null;
            if (_pool.TryGetValue(key, out Stack<GameObject> stack))
            {
                while (stack.Count > 0 && instance == null) instance = stack.Pop();
            }
            if (instance == null)
            {
                GameObject prefab = kit.Find(key);
                if (prefab == null) return null;
                instance = Instantiate(prefab);
                instance.SetActive(false);
                foreach (Collider collider in instance.GetComponentsInChildren<Collider>(true)) collider.enabled = false;
                CreatedCount++;
            }
            instance.transform.SetParent(parent, false);
            _active.Add(new KeyValuePair<string, GameObject>(key, instance));
            return instance;
        }

        /// <summary>
        /// Проходимой вещи с подсказкой нужен триггер: без коллайдера луч курсора её не
        /// находит, а сплошной короб перегородил бы дорогу. Триггер ходьбе не мешает.
        /// </summary>
        private static void ConfigureHoverProbe(GameObject instance, LocationObject entry)
        {
            if (instance.GetComponent<BoxCollider>() is BoxCollider solid && solid.enabled && !solid.isTrigger) return;
            BoxCollider probe = null;
            foreach (BoxCollider box in instance.GetComponents<BoxCollider>())
            {
                if (box.isTrigger) { probe = box; break; }
            }
            if (probe == null)
            {
                probe = instance.AddComponent<BoxCollider>();
                probe.isTrigger = true;
            }
            float width = Mathf.Max(0.6f, entry.Footprint != null ? entry.Footprint.X : 1f);
            float depth = Mathf.Max(0.6f, entry.Footprint != null ? entry.Footprint.Z : 1f);
            probe.size = new Vector3(width, 1.8f, depth);
            probe.center = new Vector3(0f, 0.9f, 0f);
            probe.enabled = true;
        }

        private static void ConfigureCollision(GameObject instance, LocationObject entry)
        {
            BoxCollider box = instance.GetComponent<BoxCollider>();
            JObject part = entry.CollisionParts != null && entry.CollisionParts.Count > 0 ? entry.CollisionParts[0] as JObject : null;
            bool solid = string.Equals(entry.Collision, "solid", StringComparison.OrdinalIgnoreCase) && part != null;
            if (!solid)
            {
                if (box != null) box.enabled = false;
                return;
            }
            if (box == null) box = instance.AddComponent<BoxCollider>();
            float sizeX = Number(part["size"]?["x"], 1f);
            float sizeZ = Number(part["size"]?["z"], 1f);
            float height = Mathf.Max(0.3f, Number(part["height"], 1.5f));
            float centerX = Number(part["center"]?["x"], 0f);
            float centerZ = Number(part["center"]?["z"], 0f);
            // Оси сервера → Unity: z отражается (RoaCoords.ToUnity), масштаб и поворот даёт сам объект.
            box.size = new Vector3(Mathf.Max(0.05f, sizeX), height, Mathf.Max(0.05f, sizeZ));
            box.center = new Vector3(centerX, height * 0.5f, -centerZ);
            box.enabled = true;
        }

        private static float Number(JToken token, float fallback)
        {
            if (token == null) return fallback;
            if (token.Type == JTokenType.Float || token.Type == JTokenType.Integer) return token.Value<float>();
            return fallback;
        }

        private Transform PoolRoot()
        {
            if (_poolRoot == null)
            {
                var root = new GameObject("ZoneKitPool");
                root.SetActive(false);
                root.transform.SetParent(transform, false);
                _poolRoot = root.transform;
            }
            return _poolRoot;
        }
    }
}
