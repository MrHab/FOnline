using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Materializes a small, client-only settlement dressing from the authoritative
    /// settlementScene snapshot. NPCs remain server authoritative; these props only
    /// make shortage, danger and recovery readable without creating large crowds.
    /// </summary>
    public sealed class RoaSettlementLifePresentation : MonoBehaviour
    {
        private RoaLocationLoader _loader;
        private GameObject _root;
        private string _revisionKey = string.Empty;
        private bool _localWorldActive;

        public void Configure(RoaLocationLoader loader)
        {
            _loader = loader;
        }

        public void SetLocalWorldActive(bool active)
        {
            _localWorldActive = active;
            if (_root != null) _root.SetActive(active);
            if (!active) _revisionKey = string.Empty;
        }

        public void ApplyWorldState(JObject state)
        {
            JObject scene = state?["settlementScene"] as JObject;
            if (scene == null)
            {
                Clear();
                return;
            }
            string revision = scene["revisionKey"]?.ToString() ?? string.Empty;
            string siteId = state?["worldSiteId"]?.ToString() ?? string.Empty;
            string key = siteId + ":" + revision;
            if (_root != null && key == _revisionKey)
            {
                _root.SetActive(_localWorldActive);
                return;
            }
            _revisionKey = key;
            Rebuild(scene);
        }

        public void Clear()
        {
            if (_root != null) Destroy(_root);
            _root = null;
            _revisionKey = string.Empty;
        }

        private void Rebuild(JObject scene)
        {
            ClearRootOnly();
            if (_loader == null || _loader.CurrentGroundRenderer == null) return;
            bool queue = scene["queue"]?.ToObject<bool>() == true;
            bool barricades = scene["barricades"]?.ToObject<bool>() == true;
            bool repairs = scene["repairCrew"]?.ToObject<bool>() == true;
            if (!queue && !barricades && !repairs) return;

            Bounds bounds = _loader.CurrentGroundRenderer.bounds;
            Vector3 center = bounds.center;
            center.y = bounds.max.y + 0.08f;
            _root = new GameObject("KromkaSettlementLife:" + _revisionKey);
            _root.transform.SetParent(transform, true);

            if (queue) BuildRationQueue(center + new Vector3(-4.5f, 0f, 2.5f));
            if (barricades) BuildBarricades(center + new Vector3(0f, 0f, 7f));
            if (repairs) BuildRepairSite(center + new Vector3(4.5f, 0f, -2.5f));
            _root.SetActive(_localWorldActive);
        }

        private void BuildRationQueue(Vector3 origin)
        {
            Color ration = new Color(0.54f, 0.43f, 0.22f, 1f);
            MakePrimitive(PrimitiveType.Cube, "RationCrate", origin,
                new Vector3(1.6f, 0.75f, 1.1f), ration);
            for (int index = 0; index < 4; index++)
            {
                Vector3 point = origin + new Vector3(-1.4f + index * 0.95f, 0f, -1.6f);
                MakePrimitive(PrimitiveType.Cylinder, "QueuePost", point,
                    new Vector3(0.12f, 0.75f, 0.12f), new Color(0.38f, 0.34f, 0.27f, 1f));
            }
        }

        private void BuildBarricades(Vector3 origin)
        {
            Color rust = new Color(0.42f, 0.22f, 0.12f, 1f);
            for (int index = -1; index <= 1; index++)
            {
                GameObject barrier = MakePrimitive(PrimitiveType.Cube, "Barricade",
                    origin + new Vector3(index * 2.05f, 0.45f, 0f),
                    new Vector3(1.85f, 0.9f, 0.38f), rust);
                barrier.transform.rotation = Quaternion.Euler(0f, index * 7f, 0f);
            }
        }

        private void BuildRepairSite(Vector3 origin)
        {
            Color steel = new Color(0.32f, 0.38f, 0.40f, 1f);
            MakePrimitive(PrimitiveType.Cube, "RepairBench", origin,
                new Vector3(2.2f, 0.75f, 0.8f), steel);
            MakePrimitive(PrimitiveType.Cylinder, "RepairDrum", origin + new Vector3(1.6f, 0.55f, 0.3f),
                new Vector3(0.55f, 0.55f, 0.55f), new Color(0.30f, 0.45f, 0.42f, 1f));
            MakePrimitive(PrimitiveType.Cube, "RepairParts", origin + new Vector3(-1.5f, 0.3f, -0.35f),
                new Vector3(0.9f, 0.6f, 0.9f), new Color(0.48f, 0.34f, 0.18f, 1f));
        }

        private GameObject MakePrimitive(PrimitiveType type, string objectName, Vector3 position,
                                         Vector3 scale, Color color)
        {
            GameObject go = GameObject.CreatePrimitive(type);
            go.name = objectName;
            go.transform.SetParent(_root.transform, true);
            go.transform.position = position;
            go.transform.localScale = scale;
            Collider collider = go.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            Renderer renderer = go.GetComponent<Renderer>();
            if (renderer != null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null) shader = Shader.Find("Standard");
                if (shader != null)
                {
                    renderer.material = new Material(shader);
                    renderer.material.color = color;
                }
            }
            return go;
        }

        private void ClearRootOnly()
        {
            if (_root != null) Destroy(_root);
            _root = null;
        }

        private void OnDestroy()
        {
            ClearRootOnly();
        }
    }
}
