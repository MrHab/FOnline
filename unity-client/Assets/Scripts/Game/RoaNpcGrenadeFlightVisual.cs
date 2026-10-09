using System;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Cosmetic flight between the server's grenade warning and detonation.
    /// The server alone chooses the impact, timing and damage.
    /// </summary>
    [DefaultExecutionOrder(1100)]
    public sealed class RoaNpcGrenadeFlightVisual : MonoBehaviour
    {
        private const int MaxVisibleFlights = 16;
        private const float ReleaseSeconds = 0.62f;
        private static int _visibleFlights;

        private RoaCombat _owner;
        private RoaEnemies _enemies;
        private string _enemyId;
        private Vector3 _start;
        private Vector3 _impact;
        private long _serverStartedAt;
        private float _fuseSeconds;
        private float _receivedAt;
        private bool _released;
        private Renderer[] _renderers;

        public static RoaNpcGrenadeFlightVisual TryCreate(RoaCombat owner, RoaEnemies enemies,
            string enemyId, Vector3 impact, long serverStartedAt, int fuseMs)
        {
            if (owner == null || enemies == null || string.IsNullOrEmpty(enemyId)
                || _visibleFlights >= MaxVisibleFlights
                || !enemies.TryGetGrenadeHandPosition(enemyId, out Vector3 hand)) return null;
            GameObject root = RoaNpcActionPropVisual.CreateGrenade(owner.transform);
            root.name = "NpcGrenadeFlight:" + enemyId;
            RoaNpcGrenadeFlightVisual view = root.AddComponent<RoaNpcGrenadeFlightVisual>();
            view._owner = owner;
            view._enemies = enemies;
            view._enemyId = enemyId;
            view._start = hand;
            view._impact = impact + Vector3.up * 0.08f;
            view._serverStartedAt = serverStartedAt;
            view._fuseSeconds = Mathf.Clamp(fuseMs * 0.001f, 0.7f, 3f);
            view._receivedAt = Time.unscaledTime;
            view._renderers = root.GetComponentsInChildren<Renderer>();
            view.SetVisible(false);
            _visibleFlights++;
            return view;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetBudget() => _visibleFlights = 0;

        private void LateUpdate()
        {
            if (_enemies == null || !_enemies.TryGetPosition(_enemyId, out _))
            {
                Destroy(gameObject);
                return;
            }
            double serverNow = RoaRadiationStorm.Active != null
                ? RoaRadiationStorm.Active.ServerNowMs : RoaRadiationStorm.UnixNowMs;
            double serverAge = _serverStartedAt > 0
                ? (serverNow - _serverStartedAt) * 0.001d : double.NaN;
            // An unsynchronised device clock must not leave a projectile hanging.
            float age = !double.IsNaN(serverAge) && Math.Abs(serverAge) < 4d
                ? Mathf.Max(0f, (float)serverAge)
                : Mathf.Max(0f, Time.unscaledTime - _receivedAt);
            if (age >= _fuseSeconds + 0.35f)
            {
                Destroy(gameObject);
                return;
            }
            if (age < ReleaseSeconds)
            {
                if (!_enemies.TryGetGrenadeHandPosition(_enemyId, out _start))
                    Destroy(gameObject);
                return;
            }
            if (!_released)
            {
                _released = true;
                // Use the final posed hand after the skin's LateUpdate.
                if (_enemies.TryGetGrenadeHandPosition(_enemyId, out Vector3 hand)) _start = hand;
                SetVisible(true);
            }
            if (age >= _fuseSeconds)
            {
                SetVisible(false);
                return;
            }
            float progress = Mathf.Clamp01((age - ReleaseSeconds)
                / Mathf.Max(0.1f, _fuseSeconds - ReleaseSeconds));
            float arc = Mathf.Min(1.4f, 0.45f + Vector3.Distance(_start, _impact) * 0.055f);
            transform.position = Vector3.Lerp(_start, _impact, progress)
                + Vector3.up * (Mathf.Sin(progress * Mathf.PI) * arc);
            transform.rotation = Quaternion.Euler(300f * progress, 140f * progress,
                260f * progress);
        }

        private void SetVisible(bool visible)
        {
            if (_renderers == null) return;
            foreach (Renderer renderer in _renderers)
                if (renderer != null) renderer.enabled = visible;
        }

        private void OnDestroy()
        {
            _visibleFlights = Mathf.Max(0, _visibleFlights - 1);
            if (_owner != null) _owner.ForgetNpcGrenadeFlight(_enemyId, this);
        }
    }
}
