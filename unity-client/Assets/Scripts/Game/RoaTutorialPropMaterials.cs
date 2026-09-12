using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    public sealed class RoaTutorialPropMaterials : MonoBehaviour
    {
        private readonly List<Material> owned = new List<Material>();
        public void Own(Material material) { owned.Add(material); }
        private void OnDestroy()
        {
            foreach (Material material in owned) if (material != null) Destroy(material);
            owned.Clear();
        }
    }
}
