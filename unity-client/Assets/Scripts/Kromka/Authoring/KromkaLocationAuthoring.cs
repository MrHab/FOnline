using System;
using System.Collections.Generic;
using UnityEngine;

namespace Kromka.Authoring
{
    public enum KromkaLocationKind
    {
        Settlement,
        FactionCapital,
        CaravanHub,
        RoadOutpost,
        IndustrialSite,
        ResourceSite,
        RaidComplex,
        MutantLair,
        EncounterTemplate,
        BoundaryExpedition,
        Tutorial,
        StoryComplex,
        PersonalBase,
        ClanBase
    }

    public enum KromkaMacroRegion
    {
        NorthernSluices,
        MiddleVein,
        OreArc,
        TractIsthmus,
        ChalkLowland,
        Glasslands,
        ZeroBasin,
        SilentRing,
        OffMap,
        Regional
    }

    public enum KromkaSpawnKind
    {
        PlayerArrival,
        MigrationArrival,
        Exit,
        Npc,
        Enemy,
        Encounter,
        Resource,
        ClanAttacker,
        ClanDefender
    }

    /// <summary>
    /// Unity is the spatial authoring source for a Kromka location. Designers move
    /// child objects and spawn transforms in the scene; export tools serialize the
    /// resulting positions for the authoritative server.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaLocationAuthoring : MonoBehaviour
    {
        public const string CurrentWorldRevision = "kromka-1";

        [Header("Identity")]
        [SerializeField] private string _stableLocationId = string.Empty;
        [SerializeField] private string _displayName = string.Empty;
        [SerializeField] private string _worldRevision = CurrentWorldRevision;
        [SerializeField] private KromkaLocationKind _locationKind;
        [SerializeField] private KromkaMacroRegion _macroRegion;

        [Header("Presentation")]
        [SerializeField] private string _visualProfileId = string.Empty;
        [SerializeField] private string _ambientProfileId = string.Empty;
        [SerializeField, Range(0f, 1f)] private float _anomalyDensity;
        [SerializeField] private string[] _landmarkTags = Array.Empty<string>();

        [Header("Editable scene roots")]
        [SerializeField] private Transform _staticContentRoot;
        [SerializeField] private Transform _dynamicAnchorsRoot;
        [SerializeField] private Transform _playerArrival;
        [SerializeField] private Transform _migrationArrival;

        private readonly Dictionary<string, KromkaPlacedObjectAuthoring> _objects =
            new Dictionary<string, KromkaPlacedObjectAuthoring>(StringComparer.Ordinal);

        public string StableLocationId => _stableLocationId;
        public string DisplayName => _displayName;
        public string WorldRevision => _worldRevision;
        public KromkaLocationKind LocationKind => _locationKind;
        public KromkaMacroRegion MacroRegion => _macroRegion;
        public string VisualProfileId => _visualProfileId;
        public string AmbientProfileId => _ambientProfileId;
        public float AnomalyDensity => _anomalyDensity;
        public IReadOnlyList<string> LandmarkTags => _landmarkTags;
        public Transform StaticContentRoot => _staticContentRoot;
        public Transform DynamicAnchorsRoot => _dynamicAnchorsRoot;
        public Transform PlayerArrival => _playerArrival;
        public Transform MigrationArrival => _migrationArrival;

        public void ConfigureIdentity(string stableLocationId, string displayName,
                                      KromkaLocationKind locationKind,
                                      KromkaMacroRegion macroRegion)
        {
            _stableLocationId = stableLocationId ?? string.Empty;
            _displayName = displayName ?? string.Empty;
            _worldRevision = CurrentWorldRevision;
            _locationKind = locationKind;
            _macroRegion = macroRegion;
        }

        public void ConfigurePresentation(string visualProfileId, string ambientProfileId,
                                          float anomalyDensity, string[] landmarkTags)
        {
            _visualProfileId = visualProfileId ?? string.Empty;
            _ambientProfileId = ambientProfileId ?? string.Empty;
            _anomalyDensity = Mathf.Clamp01(anomalyDensity);
            _landmarkTags = landmarkTags ?? Array.Empty<string>();
        }

        public void ConfigureRoots(Transform staticContentRoot, Transform dynamicAnchorsRoot,
                                   Transform playerArrival, Transform migrationArrival)
        {
            _staticContentRoot = staticContentRoot;
            _dynamicAnchorsRoot = dynamicAnchorsRoot;
            _playerArrival = playerArrival;
            _migrationArrival = migrationArrival;
        }

        public void RebuildObjectIndex()
        {
            _objects.Clear();
            KromkaPlacedObjectAuthoring[] markers =
                GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
            for (int i = 0; i < markers.Length; i++)
            {
                KromkaPlacedObjectAuthoring marker = markers[i];
                if (marker == null || string.IsNullOrWhiteSpace(marker.StableObjectId)) continue;
                if (_objects.ContainsKey(marker.StableObjectId))
                {
                    Debug.LogWarning("[KROMKA] Duplicate placed object id '"
                        + marker.StableObjectId + "' in " + name + ".", marker);
                    continue;
                }
                _objects.Add(marker.StableObjectId, marker);
            }
        }

        public bool TryGetPlacedObject(string objectId, out KromkaPlacedObjectAuthoring marker)
        {
            if (_objects.Count == 0) RebuildObjectIndex();
            marker = null;
            return !string.IsNullOrWhiteSpace(objectId)
                && _objects.TryGetValue(objectId, out marker) && marker != null;
        }

        public bool Validate(out string error)
        {
            if (string.IsNullOrWhiteSpace(_stableLocationId)) return Fail("не задан ID локации", out error);
            if (string.IsNullOrWhiteSpace(_displayName)) return Fail("не задано отображаемое имя", out error);
            if (_worldRevision != CurrentWorldRevision) return Fail("неверная ревизия мира", out error);
            if (string.IsNullOrWhiteSpace(_visualProfileId)) return Fail("не задан визуальный профиль", out error);
            if (string.IsNullOrWhiteSpace(_ambientProfileId)) return Fail("не задан профиль окружения", out error);
            if (_landmarkTags == null || _landmarkTags.Length == 0) return Fail("нет визуального ориентира", out error);
            if (_staticContentRoot == null) return Fail("не задан StaticContent", out error);
            if (_dynamicAnchorsRoot == null) return Fail("не задан DynamicAnchors", out error);
            if (_playerArrival == null) return Fail("не задан PlayerArrival", out error);
            if (_migrationArrival == null) return Fail("не задан MigrationArrival", out error);

            RebuildObjectIndex();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            KromkaPlacedObjectAuthoring[] markers =
                GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
            for (int i = 0; i < markers.Length; i++)
            {
                KromkaPlacedObjectAuthoring marker = markers[i];
                if (marker == null || string.IsNullOrWhiteSpace(marker.StableObjectId))
                    return Fail("найден объект без стабильного ID", out error);
                if (!ids.Add(marker.StableObjectId))
                    return Fail("повторяется ID объекта " + marker.StableObjectId, out error);
            }

            error = null;
            return true;
        }

        private void OnValidate()
        {
            _anomalyDensity = Mathf.Clamp01(_anomalyDensity);
            if (string.IsNullOrWhiteSpace(_worldRevision)) _worldRevision = CurrentWorldRevision;
            RebuildObjectIndex();
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }
    }

}
