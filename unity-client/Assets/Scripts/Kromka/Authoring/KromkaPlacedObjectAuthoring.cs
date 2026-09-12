using System;
using System.Collections.Generic;
using UnityEngine;

namespace Kromka.Authoring
{
    /// <summary>Marks a scene object whose transform is edited directly in Unity.</summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class KromkaPlacedObjectAuthoring : MonoBehaviour
    {
        [SerializeField] private string _stableObjectId = string.Empty;
        [SerializeField] private string _serverArchetypeId = string.Empty;
        [SerializeField] private string _role = "scenery";
        [SerializeField] private string[] _gameplayTags = Array.Empty<string>();
        [SerializeField] private bool _serverAuthoritative;
        [SerializeField] private bool _blocksMovement = true;
        [SerializeField] private bool _blocksVision = true;

        public string StableObjectId => _stableObjectId;
        public string ServerArchetypeId => _serverArchetypeId;
        public string Role => _role;
        public IReadOnlyList<string> GameplayTags => _gameplayTags;
        public bool ServerAuthoritative => _serverAuthoritative;
        public bool BlocksMovement => _blocksMovement;
        public bool BlocksVision => _blocksVision;

        public void Configure(string stableObjectId, string serverArchetypeId, string role,
                              string[] gameplayTags, bool serverAuthoritative,
                              bool blocksMovement, bool blocksVision)
        {
            _stableObjectId = stableObjectId ?? string.Empty;
            _serverArchetypeId = serverArchetypeId ?? string.Empty;
            _role = string.IsNullOrWhiteSpace(role) ? "scenery" : role;
            _gameplayTags = gameplayTags ?? Array.Empty<string>();
            _serverAuthoritative = serverAuthoritative;
            _blocksMovement = blocksMovement;
            _blocksVision = blocksVision;
        }
    }
}
