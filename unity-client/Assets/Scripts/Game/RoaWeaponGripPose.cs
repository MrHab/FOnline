using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>The shared firearm stance exported from the editable grip prefab.</summary>
    public sealed class RoaWeaponGripPose : ScriptableObject
    {
        private const string ResourcePath = "RealmOfAshes/WeaponGripPose";
        [SerializeField] private Vector3 rightWristLocal = new Vector3(0.1734f, 1.2828f, 0.3988f);

        private static RoaWeaponGripPose _instance;

        public static Vector3 RightWristLocal
        {
            get
            {
                if (_instance == null) _instance = Resources.Load<RoaWeaponGripPose>(ResourcePath);
                return _instance != null ? _instance.rightWristLocal
                    : new Vector3(0.1734f, 1.2828f, 0.3988f);
            }
        }

#if UNITY_EDITOR
        public Vector3 StoredRightWristLocal => rightWristLocal;
        public void SetRightWristLocal(Vector3 position) => rightWristLocal = position;
#endif
    }
}
