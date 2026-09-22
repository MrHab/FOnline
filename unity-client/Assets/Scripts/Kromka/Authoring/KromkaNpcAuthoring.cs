using System;
using UnityEngine;

namespace Kromka.Authoring
{
    public enum KromkaNpcSex
    {
        Male,
        Female
    }

    public enum KromkaNpcBuild
    {
        Slim,
        Medium,
        Large
    }

    /// <summary>
    /// Дружелюбный НПС локации в сцене Unity: торговец, служба, квестодатель,
    /// охрана базы. Сцена задаёт, где он стоит, куда смотрит и как выглядит, —
    /// экспорт пишет это в его строку data; всё остальное (торговля, диалог,
    /// квесты) живёт в данных и здесь только показано.
    ///
    /// Живого НПС ставит сервер, поэтому этот объект — только для редактора:
    /// префаб помечен EditorOnly (в сборку клиента не попадает), а в режиме игры
    /// в редакторе объект выключается сам, чтобы не встать рядом с настоящим.
    /// Облик в окне сцены рисует редакторский KromkaNpcPreview.
    /// </summary>
    [DisallowMultipleComponent]
    [SelectionBase]
    [RequireComponent(typeof(KromkaSpawnAuthoring))]
    public sealed class KromkaNpcAuthoring : MonoBehaviour
    {
        [Header("Кто это — из data, правится там")]
        [SerializeField] private string _displayName = string.Empty;
        [SerializeField] private string _role = string.Empty;
        [SerializeField] private string _service = string.Empty;
        [SerializeField] private string _faction = string.Empty;
        [SerializeField] private string[] _quests = Array.Empty<string>();

        [Header("Облик — правится здесь, экспорт пишет в entity.appearance")]
        [SerializeField] private KromkaNpcSex _sex;
        [SerializeField] private KromkaNpcBuild _build = KromkaNpcBuild.Medium;
        [SerializeField, Range(1, 4)] private int _face = 1;
        [SerializeField] private string _hairId = "short_crop";
        [SerializeField, Range(1, 8)] private int _hairColor = 3;

        [Header("Наряд — правится здесь, экспорт пишет в entity.equipment")]
        [SerializeField] private string _weapon = "fists";
        [SerializeField] private string _armor = string.Empty;
        [SerializeField] private string _helmet = string.Empty;
        [SerializeField] private string _boots = string.Empty;
        [SerializeField] private string _backpack = string.Empty;

        /// <summary>Облик или наряд сменился в инспекторе: превью пора пересобрать.</summary>
        public static event Action<KromkaNpcAuthoring> AppearanceChanged;

        /// <summary>Id строки НПС — тот же, что у якоря, по которому экспорт пишет позицию.</summary>
        public string NpcId
        {
            get
            {
                KromkaSpawnAuthoring spawn = GetComponent<KromkaSpawnAuthoring>();
                return spawn != null ? spawn.SpawnId : string.Empty;
            }
        }

        public string DisplayName => _displayName;
        public string Role => _role;
        public string Service => _service;
        public string Faction => _faction;
        public string[] Quests => _quests;

        public string SexId => _sex == KromkaNpcSex.Female ? "female" : "male";
        public string BodyTypeId => _build == KromkaNpcBuild.Slim ? "slim" : _build == KromkaNpcBuild.Large ? "large" : "medium";
        public string FaceId => SexId + "_0" + Mathf.Clamp(_face, 1, 4);
        public string HairId => string.IsNullOrWhiteSpace(_hairId) ? "short_crop" : _hairId;
        public string HairColorId => "hair_0" + Mathf.Clamp(_hairColor, 1, 8);

        public string Weapon => string.IsNullOrWhiteSpace(_weapon) ? "fists" : _weapon;
        public string Armor => _armor ?? string.Empty;
        public string Helmet => _helmet ?? string.Empty;
        public string Boots => _boots ?? string.Empty;
        public string Backpack => _backpack ?? string.Empty;

        /// <summary>Сведения из данных: имя, роль, служба, фракция, квесты.</summary>
        public void ConfigureIdentity(string displayName, string role, string service, string faction, string[] quests)
        {
            _displayName = displayName ?? string.Empty;
            _role = role ?? string.Empty;
            _service = service ?? string.Empty;
            _faction = faction ?? string.Empty;
            _quests = quests ?? Array.Empty<string>();
        }

        /// <summary>Облик в схеме realm.character-appearance.v1.</summary>
        public void ConfigureAppearance(string sex, string bodyType, string faceId, string hairId, string hairColorId)
        {
            _sex = string.Equals(sex, "female", StringComparison.OrdinalIgnoreCase) ? KromkaNpcSex.Female : KromkaNpcSex.Male;
            _build = string.Equals(bodyType, "slim", StringComparison.OrdinalIgnoreCase) ? KromkaNpcBuild.Slim
                : string.Equals(bodyType, "large", StringComparison.OrdinalIgnoreCase) ? KromkaNpcBuild.Large
                : KromkaNpcBuild.Medium;
            _face = Suffix(faceId, 1, 4);
            _hairId = string.IsNullOrWhiteSpace(hairId) ? "short_crop" : hairId;
            _hairColor = Suffix(hairColorId, 1, 8);
            AppearanceChanged?.Invoke(this);
        }

        /// <summary>
        /// Наряд: оружие в руках и четыре носимых слота. Его надевают ровно таким —
        /// пустой слот значит «ничего», а не «что найдётся на складе фракции».
        /// </summary>
        public void ConfigureEquipment(string weapon, string armor, string helmet, string boots, string backpack)
        {
            _weapon = string.IsNullOrWhiteSpace(weapon) ? "fists" : weapon;
            _armor = armor ?? string.Empty;
            _helmet = helmet ?? string.Empty;
            _boots = boots ?? string.Empty;
            _backpack = backpack ?? string.Empty;
            AppearanceChanged?.Invoke(this);
        }

        private static int Suffix(string id, int min, int max)
        {
            if (string.IsNullOrEmpty(id) || id.Length < 2) return min;
            return int.TryParse(id.Substring(id.Length - 2), out int value) ? Mathf.Clamp(value, min, max) : min;
        }

        private void Awake()
        {
            // Awake без ExecuteAlways зовётся только в игре: там НПС ставит сервер.
            if (Application.isPlaying) gameObject.SetActive(false);
        }

        private void OnValidate()
        {
            _face = Mathf.Clamp(_face, 1, 4);
            _hairColor = Mathf.Clamp(_hairColor, 1, 8);
            AppearanceChanged?.Invoke(this);
        }

#if UNITY_EDITOR
        private void OnDrawGizmos()
        {
            // Куда смотрит НПС: так он и встанет в игре, если стоит на месте.
            Vector3 origin = transform.position + Vector3.up * 0.05f;
            Vector3 forward = transform.forward;
            Gizmos.color = new Color(0.95f, 0.78f, 0.35f, 0.9f);
            Gizmos.DrawLine(origin, origin + forward * 1.1f);
            Gizmos.DrawLine(origin + forward * 1.1f, origin + forward * 0.8f + transform.right * 0.18f);
            Gizmos.DrawLine(origin + forward * 1.1f, origin + forward * 0.8f - transform.right * 0.18f);
            Gizmos.DrawWireSphere(origin, 0.35f);

            string label = string.IsNullOrEmpty(_displayName) ? NpcId : _displayName;
            if (!string.IsNullOrEmpty(_service)) label += "\n" + _service;
            else if (!string.IsNullOrEmpty(_role)) label += "\n" + _role;
            UnityEditor.Handles.Label(transform.position + Vector3.up * 2.15f, label);
        }
#endif
    }
}
