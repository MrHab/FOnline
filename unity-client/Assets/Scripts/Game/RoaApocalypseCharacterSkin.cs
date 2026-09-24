using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>Copies the existing animated pose onto a PolygonApocalypse skeleton.</summary>
    [ExecuteAlways]
    [DefaultExecutionOrder(1000)]
    public sealed class RoaApocalypseCharacterSkin : MonoBehaviour
    {
        private struct BonePair
        {
            public Transform Source;
            public Transform Target;
            public Quaternion TargetRest;
            public Transform SourceChild;
            public Transform TargetChild;
        }

        private readonly List<BonePair> _bones = new List<BonePair>();
        private GameObject _visual;
        private Transform _rigRoot;
        private GameObject _basePrefab;
        private GameObject _activePrefab;
        private bool _female;
        private RoaCharacterView _view;
        private GameObject _backpack;
        private GameObject _helmet;
        private GameObject _helmetPrefab;
        private readonly List<GameObject> _footwear = new List<GameObject>();
        private string _footwearId;

        public GameObject ActivePrefab => _activePrefab;
        public GameObject ActiveHelmetPrefab => _helmetPrefab;
        public string ActiveFootwearId => _footwearId;
        public int ActiveFootwearParts => _footwear.Count;

        private static readonly string[] ArmorIds =
        {
            "leather", "metalArmor", "ballisticVest", "combatArmor",
            "heavyArmor", "hazmatSuit", "energySuit"
        };

        private static readonly string[] HelmetIds =
        {
            "weldedHelmet", "helmet", "tacticalHelmet", "assaultHelmet", "preWarHelmet"
        };

        private static readonly string[] FootwearIds =
        {
            "boots", "scoutBoots", "reinforcedBoots", "assaultBoots"
        };

        public bool Bind(GameObject prefab)
        {
            Transform rig = null;
            foreach (Transform child in GetComponentsInChildren<Transform>(true))
                if (child.name == "npc_humanoid_root" || child.name == "character_root")
                { rig = child; break; }
            return Bind(prefab, rig);
        }

        public bool Bind(GameObject prefab, Transform rigRoot)
        {
            if (prefab == null || rigRoot == null || _visual != null) return false;
            if (_basePrefab == null)
            {
                _basePrefab = prefab;
                _female = prefab.name.Contains("_Female_");
                _view = GetComponent<RoaCharacterView>();
            }
            _activePrefab = prefab;
            _rigRoot = rigRoot;
            var source = new Dictionary<string, Transform>();
            var originalRenderers = new List<Renderer>();
            var sourceRenderers = new List<Renderer>();
            Renderer bodyRenderer = null;
            foreach (Transform bone in rigRoot.GetComponentsInChildren<Transform>(true))
            {
                string key = BoneKey(bone.name);
                if (!source.ContainsKey(key)) source.Add(key, bone);
            }
            foreach (Renderer renderer in rigRoot.GetComponentsInChildren<Renderer>(true))
            {
                if (!(renderer is MeshRenderer || renderer is SkinnedMeshRenderer)
                    || IsHeldItem(renderer.transform)) continue;
                sourceRenderers.Add(renderer);
                if (renderer.name == "body_base") bodyRenderer = renderer;
                if (renderer.enabled) originalRenderers.Add(renderer);
            }

            // Rebinding an outfit happens after the legacy renderers were hidden.
            // Read their current world bounds each time: a cached world-space
            // position leaves the new skin behind when the actor has moved.
            Bounds oldBounds = bodyRenderer != null
                ? bodyRenderer.bounds : WorldBounds(sourceRenderers);

            _visual = Instantiate(prefab, transform, false);
            _visual.name = RoaApocalypseVisuals.ChildName;
            foreach (Animator animator in _visual.GetComponentsInChildren<Animator>(true))
                animator.enabled = false;
            foreach (Collider collider in _visual.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
            foreach (Renderer renderer in _visual.GetComponentsInChildren<Renderer>(true))
            {
                string name = renderer.name;
                if (name.Contains("Backpack") || name.Contains("Bedroll")
                    || name.Contains("SupplyBag") || name.Contains("Helmet")
                    || name.Contains("_Hat_") || name.Contains("_Mask_"))
                    renderer.enabled = false;
            }
            foreach (Transform child in _visual.GetComponentsInChildren<Transform>(true))
                child.gameObject.layer = gameObject.layer;
            foreach (Transform target in _visual.GetComponentsInChildren<Transform>(true))
            {
                if (!source.TryGetValue(BoneKey(target.name), out Transform old)) continue;
                _bones.Add(new BonePair
                {
                    Source = old,
                    Target = target,
                    TargetRest = target.localRotation
                });
            }
            for (int i = 0; i < _bones.Count; i++)
            {
                BonePair parent = _bones[i];
                int bestDepth = int.MaxValue;
                foreach (BonePair candidate in _bones)
                {
                    if (candidate.Source == parent.Source || candidate.Target == parent.Target
                        || !candidate.Source.IsChildOf(parent.Source)
                        || !candidate.Target.IsChildOf(parent.Target)) continue;
                    int depth = Depth(candidate.Target) - Depth(parent.Target);
                    if (depth >= bestDepth) continue;
                    bestDepth = depth;
                    parent.SourceChild = candidate.Source;
                    parent.TargetChild = candidate.Target;
                }
                _bones[i] = parent;
            }
            _bones.Sort((a, b) => Depth(a.Target).CompareTo(Depth(b.Target)));
            if (_bones.Count >= 10)
            {
                var fresh = new List<Renderer>();
                foreach (Renderer renderer in _visual.GetComponentsInChildren<Renderer>(true))
                    if (renderer.enabled && renderer.gameObject.activeInHierarchy) fresh.Add(renderer);
                var newBounds = WorldBounds(fresh);
                if (newBounds.size.y > 0.01f && oldBounds.size.y > 0.01f)
                {
                    float ratio = Mathf.Clamp(oldBounds.size.y / newBounds.size.y, 0.7f, 1.4f);
                    _visual.transform.localScale *= ratio;
                    newBounds = WorldBounds(fresh);
                    Vector3 offset = new Vector3(oldBounds.center.x - newBounds.center.x,
                        oldBounds.min.y - newBounds.min.y, oldBounds.center.z - newBounds.center.z);
                    _visual.transform.position += offset;
                }
                foreach (Renderer renderer in originalRenderers) renderer.enabled = false;
                return true;
            }
            foreach (Renderer renderer in originalRenderers) renderer.enabled = true;
            Destroy(_visual);
            _visual = null;
            _bones.Clear();
            return false;
        }

        public void HideLegacyVisuals()
        {
            if (_visual == null || _rigRoot == null) return;
            foreach (Renderer renderer in _rigRoot.GetComponentsInChildren<Renderer>(true))
                if (renderer != null && renderer.enabled && !IsHeldItem(renderer.transform))
                    renderer.enabled = false;
        }

        private static bool IsHeldItem(Transform node)
        {
            for (Transform item = node; item != null; item = item.parent)
                if (item.name.StartsWith("Weapon:") || item.name.StartsWith("OffhandWeapon:")
                    || item.name.StartsWith("Vehicle:") || item.name.StartsWith("CreatureWeapon:"))
                    return true;
            return false;
        }

        private static Bounds WorldBounds(IEnumerable<Renderer> renderers)
        {
            Bounds result = default;
            bool any = false;
            foreach (Renderer renderer in renderers)
            {
                if (!any) { result = renderer.bounds; any = true; }
                else result.Encapsulate(renderer.bounds);
            }
            return result;
        }

        private void LateUpdate() => SyncPose();

        public void SyncPose()
        {
            if (_visual == null) return;
            RefreshOutfit();
            RefreshAccessories();
            foreach (BonePair pair in _bones)
                if (pair.Source != null && pair.Target != null)
                    pair.Target.localRotation = pair.TargetRest;
            foreach (BonePair pair in _bones)
            {
                if (pair.Source == null || pair.Target == null || pair.SourceChild == null
                    || pair.TargetChild == null) continue;
                string key = BoneKey(pair.Target.name);
                if (key == "root" || key == "pelvis" || key.StartsWith("spine")
                    || key.StartsWith("neck")) continue;
                Vector3 current = pair.TargetChild.position - pair.Target.position;
                Vector3 desired = pair.SourceChild.position - pair.Source.position;
                if (current.sqrMagnitude < 0.0001f || desired.sqrMagnitude < 0.0001f) continue;
                pair.Target.rotation = Quaternion.FromToRotation(current, desired) * pair.Target.rotation;
            }
        }

        private void RefreshOutfit()
        {
            if (_view == null) return;
            string armorId = LoadedItem("armor", ArmorIds);
            GameObject next = RoaApocalypseModels.CharacterOutfit(_female, armorId) ?? _basePrefab;
            if (next == _activePrefab) return;
            _visual.SetActive(false);
            if (Application.isPlaying) Destroy(_visual);
            else DestroyImmediate(_visual);
            _visual = null;
            _backpack = null;
            _helmet = null;
            _helmetPrefab = null;
            _footwear.Clear();
            _footwearId = null;
            _bones.Clear();
            Bind(next, _rigRoot);
            HideLegacyVisuals();
        }

        private void RefreshAccessories()
        {
            if (_view == null || _visual == null) return;
            bool showBackpack = _view.HasLoadedEquipment("backpack", "backpack");
            string helmetId = LoadedItem("helmet", HelmetIds);
            GameObject helmetPrefab = RoaApocalypseModels.Item(helmetId);
            if (_helmet != null && helmetPrefab != _helmetPrefab)
                SetAccessory(ref _helmet, false, null, "Head");
            _helmetPrefab = helmetPrefab;
            SetAccessory(ref _backpack, showBackpack,
                RoaApocalypseModels.BackpackAttachment, "Spine_03");
            SetAccessory(ref _helmet, helmetPrefab != null, helmetPrefab, "Head");
            RefreshFootwear();
        }

        private void RefreshFootwear()
        {
            string itemId = LoadedItem("boots", FootwearIds);
            if (itemId == _footwearId) return;
            foreach (GameObject part in _footwear)
            {
                if (part == null) continue;
                part.SetActive(false);
                if (Application.isPlaying) Destroy(part);
                else DestroyImmediate(part);
            }
            _footwear.Clear();
            _footwearId = itemId;
            RoaApocalypseModels.FootwearEntry selected = RoaApocalypseModels.Footwear(itemId);
            if (selected == null) return;
            AddFootwearPart(selected.leftKnee, "LowerLeg_L");
            AddFootwearPart(selected.rightKnee, "LowerLeg_R");
            AddFootwearPart(selected.leftThigh, "UpperLeg_L");
            AddFootwearPart(selected.rightThigh, "UpperLeg_R");
        }

        private void AddFootwearPart(GameObject prefab, string boneName)
        {
            GameObject current = null;
            SetAccessory(ref current, prefab != null, prefab, boneName);
            if (current != null) _footwear.Add(current);
        }

        private string LoadedItem(string slot, string[] ids)
        {
            foreach (string id in ids)
                if (_view.HasLoadedEquipment(slot, id)) return id;
            return null;
        }

        private void SetAccessory(ref GameObject current, bool visible, GameObject prefab, string boneName)
        {
            if (!visible || prefab == null)
            {
                if (current != null)
                {
                    current.SetActive(false);
                    if (Application.isPlaying) Destroy(current);
                    else DestroyImmediate(current);
                    current = null;
                }
                return;
            }
            if (current != null) return;
            Transform bone = null;
            foreach (Transform node in _visual.GetComponentsInChildren<Transform>(true))
                if (node.name == boneName) { bone = node; break; }
            if (bone == null) return;
            // Synty attachment meshes are authored in character-space bind pose.
            // Place them at the visual root first, then keep that world placement
            // while parenting to the animated bone.
            current = Instantiate(prefab, _visual.transform, false);
            var attachmentRenderers = current.GetComponentsInChildren<Renderer>(true);
            if (attachmentRenderers.Length > 0)
            {
                Bounds bounds = WorldBounds(attachmentRenderers);
                Vector3 center = boneName == "Spine_03"
                    ? bone.position - transform.forward * 0.22f
                    : boneName.StartsWith("LowerLeg")
                        ? bone.position - transform.up * 0.06f
                        : boneName.StartsWith("UpperLeg")
                            ? bone.position - transform.up * 0.18f
                            : bone.position + transform.up * 0.08f;
                current.transform.position += center - bounds.center;
            }
            current.transform.SetParent(bone, true);
            current.name = "PolygonApocalypse_" + boneName + "_Accessory";
            foreach (Transform node in current.GetComponentsInChildren<Transform>(true))
                node.gameObject.layer = gameObject.layer;
            foreach (Collider collider in current.GetComponentsInChildren<Collider>(true))
                collider.enabled = false;
        }

        private static int Depth(Transform value)
        {
            int count = 0;
            for (Transform item = value; item != null; item = item.parent) count++;
            return count;
        }

        private static string BoneKey(string name)
        {
            string key = (name ?? string.Empty).ToLowerInvariant()
                .Replace("_", string.Empty).Replace(" ", string.Empty);
            key = key.Replace("upperleg", "thigh").Replace("lowerleg", "calf")
                .Replace("hips", "pelvis").Replace("shoulder", "upperarm")
                .Replace("elbow", "lowerarm");
            return key;
        }
    }
}
