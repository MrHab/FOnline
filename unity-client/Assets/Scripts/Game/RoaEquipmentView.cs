using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Утверждённая экипировка поверх общего 65-костного рига персонажа.
    ///
    /// Каждый GLB содержит собственную копию скелета. Оставлять её как есть
    /// нельзя: она не получает анимацию владельца. Поэтому копируются только
    /// SkinnedMeshRenderer, а их bones/rootBone перепривязываются к костям
    /// уже загруженного персонажа по каноническим именам. Это повторяет
    /// makeApprovedEquipmentInstance() web-клиента.
    /// </summary>
    public sealed class RoaEquipmentView
    {
        private sealed class Definition
        {
            public string Slot;
            public string Prefix;

            public Definition(string slot, string prefix)
            {
                Slot = slot;
                Prefix = prefix;
            }
        }

        private sealed class SlotState
        {
            public string ItemId = string.Empty;
            public int Request;
            public GameObject Root;
            public float RetryAt;
            public bool RetryScheduled;
            public string BodyKey = string.Empty;
            public Transform CharacterRoot;
        }

        private static readonly string[] Slots = { "armor", "helmet", "boots", "backpack" };

        private static readonly Dictionary<string, Definition> Definitions =
            new Dictionary<string, Definition>
            {
                { "leather", new Definition("armor", "equipment_leather_jacket") },
                { "metalArmor", new Definition("armor", "equipment_metal_armor") },
                { "ballisticVest", new Definition("armor", "equipment_ballistic_vest") },
                { "combatArmor", new Definition("armor", "equipment_combat_armor") },
                { "heavyArmor", new Definition("armor", "equipment_heavy_armor") },
                { "hazmatSuit", new Definition("armor", "equipment_hazmat_suit") },
                { "energySuit", new Definition("armor", "equipment_energy_suit") },
                { "preWarHelmet", new Definition("helmet", "equipment_prewar_helmet") },
                { "weldedHelmet", new Definition("helmet", "equipment_welded_helmet") },
                { "helmet", new Definition("helmet", "equipment_steel_helmet") },
                { "tacticalHelmet", new Definition("helmet", "equipment_tactical_helmet") },
                { "assaultHelmet", new Definition("helmet", "equipment_assault_helmet") },
                { "boots", new Definition("boots", "equipment_boots") },
                { "assaultBoots", new Definition("boots", "equipment_assault_boots") },
                { "reinforcedBoots", new Definition("boots", "equipment_reinforced_boots") },
                { "scoutBoots", new Definition("boots", "equipment_scout_boots") },
                { "backpack", new Definition("backpack", "equipment_backpack") }
            };

        private static readonly Dictionary<string, Task<GltfImport>> Cache =
            new Dictionary<string, Task<GltfImport>>();

        private readonly Dictionary<string, SlotState> _states =
            new Dictionary<string, SlotState>();

        public int LoadedSlotCount
        {
            get
            {
                int count = 0;
                foreach (SlotState state in _states.Values)
                    if (state != null && state.Root != null) count++;
                return count;
            }
        }

        public bool HasLoadedItem(string slot, string itemId)
        {
            return _states.TryGetValue(slot ?? string.Empty, out SlotState state)
                && state != null && state.Root != null && state.ItemId == BaseItemId(itemId);
        }

        public void CollectRenderers(List<SkinnedMeshRenderer> output)
        {
            if (output == null) return;
            foreach (SlotState state in _states.Values)
            {
                if (state?.Root == null) continue;
                foreach (SkinnedMeshRenderer renderer in state.Root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
                    output.Add(renderer);
            }
        }

        public async Task Apply(string baseUrl, JObject equipment, string bodyKey,
                                Transform characterRoot, Dictionary<string, Transform> bones)
        {
            if (characterRoot == null || bones == null || bones.Count == 0) return;
            if (string.IsNullOrEmpty(bodyKey)) bodyKey = "male_medium";

            var tasks = new List<Task>(Slots.Length);
            foreach (string slot in Slots)
            {
                string itemId = BaseItemId(equipment?[slot]?.ToString() ?? string.Empty);
                tasks.Add(ApplySlot(baseUrl, bodyKey, slot, itemId, characterRoot, bones));
            }
            await Task.WhenAll(tasks);
        }

        public void Clear()
        {
            foreach (SlotState state in _states.Values)
            {
                state.Request++;
                if (state.Root != null) Object.Destroy(state.Root);
                state.Root = null;
                state.ItemId = string.Empty;
                state.BodyKey = string.Empty;
                state.CharacterRoot = null;
                state.RetryAt = 0f;
                state.RetryScheduled = false;
            }
        }

        private async Task ApplySlot(string baseUrl, string bodyKey, string slot, string itemId,
                                     Transform characterRoot, Dictionary<string, Transform> bones)
        {
            if (!_states.TryGetValue(slot, out SlotState state))
            {
                state = new SlotState();
                _states[slot] = state;
            }

            bool sameOwner = state.BodyKey == bodyKey && state.CharacterRoot == characterRoot;
            if (sameOwner && state.ItemId == itemId && (string.IsNullOrEmpty(itemId)
                || state.Root != null || Time.unscaledTime < state.RetryAt)) return;

            state.Request++;
            int request = state.Request;
            state.ItemId = itemId;
            state.BodyKey = bodyKey;
            state.CharacterRoot = characterRoot;
            state.RetryScheduled = false;
            if (state.Root != null) Object.Destroy(state.Root);
            state.Root = null;

            RoaVisibilityGate gate = characterRoot.GetComponentInParent<RoaVisibilityGate>();
            if (gate != null) gate.Invalidate();

            if (string.IsNullOrEmpty(itemId)) return;
            if (!Definitions.TryGetValue(itemId, out Definition definition) || definition.Slot != slot)
            {
                Debug.LogWarning("[ROA] Нет утверждённой модели экипировки для " + slot + ": " + itemId);
                return;
            }

            string url = baseUrl.TrimEnd('/') + "/assets/models/equipment/" + slot + "/"
                + definition.Prefix + "_" + bodyKey + ".glb";

            try
            {
                GltfImport import = await LoadCached(url);
                if (!Current(state, itemId, request, characterRoot)) return;
                if (import == null)
                {
                    ScheduleRetry(state, baseUrl, bodyKey, slot, itemId, characterRoot, bones, request);
                    return;
                }

                var sourceRoot = new GameObject("EquipmentSource:" + itemId);
                sourceRoot.transform.SetParent(characterRoot, false);
                if (!await import.InstantiateMainSceneAsync(sourceRoot.transform))
                {
                    Object.Destroy(sourceRoot);
                    ScheduleRetry(state, baseUrl, bodyKey, slot, itemId, characterRoot, bones, request);
                    Debug.LogWarning("[ROA] Не создан экземпляр экипировки: " + itemId);
                    return;
                }
                if (!Current(state, itemId, request, characterRoot))
                {
                    Object.Destroy(sourceRoot);
                    return;
                }

                GameObject instance = BindSkinnedMeshes(sourceRoot, characterRoot, bones, itemId);
                Object.Destroy(sourceRoot);
                if (instance == null)
                {
                    ScheduleRetry(state, baseUrl, bodyKey, slot, itemId, characterRoot, bones, request);
                    Debug.LogWarning("[ROA] Экипировка " + itemId
                        + " несовместима с костями модели " + bodyKey + ".");
                    return;
                }
                if (!Current(state, itemId, request, characterRoot))
                {
                    Object.Destroy(instance);
                    return;
                }

                state.Root = instance;
                state.RetryAt = 0f;
                state.RetryScheduled = false;
                gate = characterRoot.GetComponentInParent<RoaVisibilityGate>();
                if (gate != null) gate.Invalidate();
            }
            catch (MissingReferenceException)
            {
                // Владелец исчез, пока загружался GLB.
            }
            catch (System.Exception error)
            {
                if (Current(state, itemId, request, characterRoot))
                    ScheduleRetry(state, baseUrl, bodyKey, slot, itemId, characterRoot, bones, request);
                Debug.LogWarning("[ROA] Сбой загрузки экипировки " + itemId + ": " + error.Message);
            }
        }

        private void ScheduleRetry(SlotState state, string baseUrl, string bodyKey, string slot,
                                   string itemId, Transform characterRoot,
                                   Dictionary<string, Transform> bones, int request)
        {
            if (!Current(state, itemId, request, characterRoot)) return;
            state.RetryAt = Time.unscaledTime + 5f;
            if (state.RetryScheduled) return;
            state.RetryScheduled = true;
            _ = RetrySlotLater(state, baseUrl, bodyKey, slot, itemId, characterRoot, bones, request);
        }

        private async Task RetrySlotLater(SlotState state, string baseUrl, string bodyKey, string slot,
                                          string itemId, Transform characterRoot,
                                          Dictionary<string, Transform> bones, int request)
        {
            do
            {
                await Task.Delay(250);
                if (!Current(state, itemId, request, characterRoot)) return;
            }
            while (Time.unscaledTime < state.RetryAt);
            if (!Current(state, itemId, request, characterRoot)) return;
            state.RetryScheduled = false;
            await ApplySlot(baseUrl, bodyKey, slot, itemId, characterRoot, bones);
        }

        private static GameObject BindSkinnedMeshes(GameObject sourceRoot, Transform characterRoot,
                                                    Dictionary<string, Transform> bones, string itemId)
        {
            SkinnedMeshRenderer[] sources = sourceRoot.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            if (sources.Length == 0) return null;

            var output = new GameObject("Equipment:" + itemId);
            output.transform.SetParent(characterRoot, false);

            foreach (SkinnedMeshRenderer source in sources)
            {
                Transform[] targetBones = new Transform[source.bones.Length];
                for (int i = 0; i < source.bones.Length; i++)
                {
                    Transform sourceBone = source.bones[i];
                    if (sourceBone == null || !bones.TryGetValue(sourceBone.name, out targetBones[i])
                        || targetBones[i] == null)
                    {
                        Object.Destroy(output);
                        return null;
                    }
                }

                var meshObject = new GameObject(source.gameObject.name);
                meshObject.transform.SetParent(output.transform, false);
                Matrix4x4 local = characterRoot.worldToLocalMatrix * source.transform.localToWorldMatrix;
                meshObject.transform.localPosition = local.GetColumn(3);
                meshObject.transform.localRotation = local.rotation;
                meshObject.transform.localScale = MatrixScale(local);

                var renderer = meshObject.AddComponent<SkinnedMeshRenderer>();
                renderer.sharedMesh = source.sharedMesh;
                renderer.sharedMaterials = source.sharedMaterials;
                renderer.bones = targetBones;
                if (source.rootBone != null && bones.TryGetValue(source.rootBone.name, out Transform rootBone))
                    renderer.rootBone = rootBone;
                renderer.localBounds = source.localBounds;
                renderer.updateWhenOffscreen = false;
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = false;
            }

            return output;
        }

        private static Vector3 MatrixScale(Matrix4x4 matrix)
        {
            return new Vector3(
                new Vector3(matrix.m00, matrix.m10, matrix.m20).magnitude,
                new Vector3(matrix.m01, matrix.m11, matrix.m21).magnitude,
                new Vector3(matrix.m02, matrix.m12, matrix.m22).magnitude);
        }

        private static bool Current(SlotState state, string itemId, int request, Transform root)
        {
            return state != null && root != null && state.Request == request && state.ItemId == itemId
                && state.CharacterRoot == root;
        }

        private static async Task<GltfImport> LoadCached(string url)
        {
            if (Cache.TryGetValue(url, out Task<GltfImport> cached)) return await cached;
            Task<GltfImport> loading = LoadImport(url);
            Cache[url] = loading;
            GltfImport result = await loading;
            if (result == null) Cache.Remove(url);
            return result;
        }

        private static async Task<GltfImport> LoadImport(string url)
        {
            var import = new GltfImport();
            var settings = new ImportSettings { AnimationMethod = AnimationMethod.None };
            if (await import.Load(RoaModelUrl.Lite(url), settings)) return import;
            import.Dispose();
            return null;
        }

        private static string BaseItemId(string runtimeId)
        {
            if (string.IsNullOrEmpty(runtimeId) || !runtimeId.StartsWith("ui_")) return runtimeId;
            string[] parts = runtimeId.Split('_');
            return parts.Length == 4 ? parts[1] : runtimeId;
        }
    }
}
