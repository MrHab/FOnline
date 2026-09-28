using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Сбор ресурсов как в Albion Online: клик по узлу (или E) начинает сбор, и
    /// персонаж добывает циклами, пока узел не опустеет, пока он стоит на месте
    /// и пока его не ранили. Длительность цикла и запас узла задаёт сервер
    /// (src/server/gathering.js): клиент только ждёт цикл, играет анимацию и
    /// засчитывает цикл запросом harvestResource.
    /// </summary>
    public sealed partial class RoaInteraction
    {
        /// <summary>Шаг дальше этого от места начала прерывает сбор (сервер терпит 0.9 м).</summary>
        private const float GatherMoveTolerance = 0.8f;

        /// <summary>Клик ближе этого к узлу (от луча курсора) выбирает узел.</summary>
        private const float GatherClickRadius = 1.1f;

        private string _gatherId = string.Empty;
        private string _gatherType = string.Empty;
        private string _gatherName = string.Empty;
        private bool _gatherCarcass;
        private int _gatherCharges;
        private int _gatherMaxCharges;
        private float _gatherCycleSeconds;
        private float _gatherCycleStartedAt;
        private float _gatherRetryAt;
        private bool _gatherStarting;
        private bool _gatherAwaiting;
        private bool _gatherToolHelps;
        private Vector3 _gatherAnchor;

        /// <summary>Идёт ли сбор (HUD показывает полосу цикла).</summary>
        public bool GatherActive { get { return !string.IsNullOrEmpty(_gatherId); } }

        /// <summary>Доля текущего цикла, 0..1.</summary>
        public float GatherProgress
        {
            get
            {
                if (!GatherActive || _gatherCycleSeconds <= 0f) return 0f;
                return Mathf.Clamp01((Time.time - _gatherCycleStartedAt) / _gatherCycleSeconds);
            }
        }

        /// <summary>«Добыча: Руда T3» или «Свежевание: Шкура T2».</summary>
        public string GatherTitle
        {
            get { return GatherActive ? (_gatherCarcass ? "Свежевание: " : "Добыча: ") + _gatherName : string.Empty; }
        }

        public int GatherCharges { get { return _gatherCharges; } }
        public int GatherMaxCharges { get { return _gatherMaxCharges; } }
        public bool GatherToolHelps { get { return _gatherToolHelps; } }

        /// <summary>Остаток узла для подсказки: «осталось 5/8».</summary>
        public static string FormatCharges(int charges, int maxCharges)
        {
            return "осталось " + Mathf.Max(0, charges) + "/" + Mathf.Max(1, maxCharges);
        }

        /// <summary>
        /// Клик мышью по ресурсу. true — клик занят сбором (или подсказкой
        /// «подойдите ближе») и не должен стрелять.
        /// </summary>
        public bool TryGatherAtScreenPoint(Vector2 screenPoint)
        {
            if (_panel != PanelKind.None || Player == null || Socket == null) return false;
            Camera camera = Camera.main;
            if (camera == null) return false;
            Ray ray = camera.ScreenPointToRay(screenPoint);
            // Сперва попадание в видимую модель узла (авторская модель стоит не
            // в центре клетки), затем — близость луча к точке узла (туша).
            ResourceView picked = null;
            float bestHit = float.MaxValue;
            float bestNear = GatherClickRadius;
            bool pickedByHit = false;
            foreach (KeyValuePair<string, ResourceView> pair in _resources)
            {
                ResourceView view = pair.Value;
                if (view.Data == null || !(view.Data["hp"]?.ToObject<float>() > 0f)) continue;
                if (Fog != null && !Fog.IsVisible(view.Position)) continue;
                if (TryResourceBounds(pair.Key, view, out Bounds bounds))
                {
                    bounds.Expand(0.5f);
                    if (bounds.IntersectRay(ray, out float along) && along < bestHit)
                    {
                        bestHit = along;
                        picked = view;
                        pickedByHit = true;
                    }
                    continue;
                }
                if (pickedByHit) continue;
                Vector3 point = view.Position + Vector3.up * 0.6f;
                float distance = Vector3.Cross(ray.direction, point - ray.origin).magnitude;
                if (distance >= bestNear) continue;
                bestNear = distance;
                picked = view;
            }
            if (picked == null) return false;
            Vector3 delta = picked.Position - Player.transform.position;
            delta.y = 0f;
            if (delta.magnitude > ContainerRange)
            {
                // Далёкий узел не перехватывает стрельбу — только ближний.
                if (delta.magnitude > ContainerRange * 2.5f) return false;
                Show("Подойдите ближе к ресурсу.", 2f);
                return true;
            }
            BeginGather(picked.Data);
            return true;
        }

        /// <summary>Габариты видимой модели узла: маркер или объект локации.</summary>
        private bool TryResourceBounds(string id, ResourceView view, out Bounds bounds)
        {
            bounds = default(Bounds);
            GameObject root = view.Marker;
            if (root == null && Loader != null) Loader.TryGetObjectRoot(id, out root);
            if (root == null || !root.activeInHierarchy) return false;
            bool found = false;
            foreach (Renderer renderer in root.GetComponentsInChildren<Renderer>())
            {
                if (!renderer.enabled) continue;
                if (!found) { bounds = renderer.bounds; found = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            return found;
        }

        /// <summary>Начать сбор с узла: сервер проверяет дистанцию, навык и выдаёт длительность цикла.</summary>
        private void BeginGather(JObject node)
        {
            string id = node?["id"]?.ToString();
            if (string.IsNullOrEmpty(id) || Socket == null || Player == null) return;
            if (_gatherStarting || (GatherActive && _gatherId == id)) return;
            if (GatherActive) StopGather(null);

            _gatherStarting = true;
            Socket.EmitWithAck("startGather", new Dictionary<string, object> { ["id"] = id }, ack =>
            {
                _gatherStarting = false;
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    Show(ack?["error"]?.ToString() ?? "Сервер не дал начать сбор.", 3f);
                    return;
                }
                JObject resource = ack["resource"] as JObject ?? node;
                _gatherId = id;
                _gatherType = resource["type"]?.ToString() ?? string.Empty;
                _gatherCarcass = resource["carcass"]?.ToObject<bool>() == true;
                int tier = resource["tier"]?.ToObject<int?>() ?? 0;
                _gatherName = ResourceLabel(_gatherType) + (tier > 0 ? " T" + tier : string.Empty);
                _gatherCharges = resource["hp"]?.ToObject<int?>() ?? 0;
                _gatherMaxCharges = resource["maxHp"]?.ToObject<int?>() ?? _gatherCharges;
                _gatherToolHelps = ack["tool"] is JObject;
                _gatherCycleSeconds = Mathf.Max(0.2f, (ack["cycleMs"]?.ToObject<float?>() ?? 2000f) / 1000f);
                _gatherCycleStartedAt = Time.time;
                _gatherAwaiting = false;
                _gatherRetryAt = 0f;
                _gatherAnchor = Player.transform.position;
                PlayGatherLoop();
                if (!_gatherToolHelps)
                    Show(GatherTitle + " — без инструмента своего тира, медленнее.", 2.5f);
            });
        }

        /// <summary>Прервать сбор по воле игрока или клиента; сервер тоже забывает сессию.</summary>
        public void StopGather(string message)
        {
            if (!GatherActive && !_gatherStarting) return;
            Socket?.Emit("stopGather", new Dictionary<string, object>());
            EndGather(message);
        }

        private void EndGather(string message)
        {
            _gatherId = string.Empty;
            _gatherAwaiting = false;
            _gatherCycleSeconds = 0f;
            if (!string.IsNullOrEmpty(message)) Show(message, 3f);
        }

        /// <summary>Каждый кадр: движение прерывает сбор, готовый цикл уходит на сервер.</summary>
        private void UpdateGathering()
        {
            if (!GatherActive) return;
            if (Player == null || !Player.gameObject.activeInHierarchy)
            {
                StopGather(null);
                return;
            }
            Vector3 delta = Player.transform.position - _gatherAnchor;
            delta.y = 0f;
            if (Player.Moving || delta.magnitude > GatherMoveTolerance)
            {
                StopGather("Сбор прерван: вы отошли.");
                return;
            }
            if (_gatherAwaiting || Time.time < _gatherRetryAt) return;
            if (Time.time - _gatherCycleStartedAt < _gatherCycleSeconds)
            {
                // Удар или шаг обрывают клип — пока сбор идёт, персонаж снова берётся за работу.
                RoaCharacterView view = Player.View;
                if (view != null && !view.ActionActive) PlayGatherLoop();
                return;
            }

            _gatherAwaiting = true;
            string id = _gatherId;
            Socket.EmitWithAck("harvestResource", new Dictionary<string, object> { ["id"] = id }, ack =>
            {
                if (_gatherId != id) return;
                _gatherAwaiting = false;
                ApplyActionAck(ack);
                if (ack?["ok"]?.ToObject<bool>() != true)
                {
                    if (ack?["stop"]?.ToObject<bool>() == false)
                    {
                        // Цикл пришёл чуть раньше срока сервера — повторим через миг.
                        _gatherRetryAt = Time.time + 0.2f;
                        return;
                    }
                    EndGather(ack?["error"]?.ToString() ?? "Сбор прерван.");
                    return;
                }

                JObject resource = ack["resource"] as JObject;
                if (resource != null)
                {
                    UpsertResource(resource);
                    _gatherCharges = resource["hp"]?.ToObject<int?>() ?? _gatherCharges;
                    _gatherMaxCharges = resource["maxHp"]?.ToObject<int?>() ?? _gatherMaxCharges;
                }
                ShowGatherYield(ack);
                if (ack["next"]?.ToObject<bool>() == true)
                {
                    _gatherCycleSeconds = Mathf.Max(0.2f, (ack["cycleMs"]?.ToObject<float?>() ?? _gatherCycleSeconds * 1000f) / 1000f);
                    _gatherCycleStartedAt = Time.time;
                    PlayGatherLoop();
                    return;
                }
                EndGather(_gatherCarcass ? "Туша освежевана." : "Ресурс исчерпан.");
            });
        }

        private void ShowGatherYield(JObject ack)
        {
            JObject item = ack["item"] as JObject;
            JObject profession = ack["profession"] as JObject;
            string itemId = item?["id"]?.ToString() ?? string.Empty;
            Show("Получено: " + (string.IsNullOrEmpty(itemId) ? "ресурс" : RoaItemData.Name(itemId))
                + " x" + (item?["qty"]?.ToObject<int>() ?? 1)
                + " · " + FormatCharges(_gatherCharges, _gatherMaxCharges)
                + (profession != null ? " · " + profession["name"] + " +" + profession["gained"]
                    + (profession["leveledUp"]?.ToObject<bool>() == true ? " — уровень " + profession["level"] + "!" : string.Empty)
                    : string.Empty), 2.5f);
        }

        /// <summary>
        /// Анимация сбора на весь цикл: руду и дерево бьют с размаха, волокно
        /// срезают у земли, нефть качают и шкуру снимают на коленях.
        /// </summary>
        private void PlayGatherLoop()
        {
            PlayGatherClip(Player != null ? Player.View : null, _gatherType, _gatherCycleSeconds + 0.4f);
        }

        /// <summary>Клип сбора по типу ресурса — один и тот же у своего и у чужих персонажей.</summary>
        public static bool PlayGatherClip(RoaCharacterView view, string type, float seconds)
        {
            if (view == null) return false;
            switch (type)
            {
                case "wood":
                case "ore": return view.PlayAction("chop", seconds);
                case "fiber": return view.PlayAction("harvest", seconds, 1.3f);
                default: return view.PlayAction("kneel_work", seconds);
            }
        }

        /// <summary>Туша зверя со шкурой, если её ещё можно свежевать.</summary>
        private bool CorpseHasCarcass(JObject actor)
        {
            string enemyId = actor?["id"]?.ToString();
            if (string.IsNullOrEmpty(enemyId)) return false;
            return _resources.TryGetValue("hide_" + enemyId, out ResourceView view)
                && view.Data?["hp"]?.ToObject<float>() > 0f;
        }

        /// <summary>
        /// Туша лежит там, где пал зверь (x/z от сервера), а не в центре клетки.
        /// Своей модели у неё нет: видна сама туша, узел — невидимая точка сбора.
        /// </summary>
        private static bool IsCarcass(JObject row)
        {
            return row?["carcass"]?.ToObject<bool>() == true;
        }

        private static Vector3 CarcassPosition(JObject row)
        {
            return RoaCoords.ToUnity(row["x"]?.ToObject<float>() ?? 0f, row["z"]?.ToObject<float>() ?? 0f);
        }

        private GameObject CreateCarcassMarker(string id)
        {
            var root = new GameObject("Carcass:" + id);
            root.transform.SetParent(transform, false);
            return root;
        }
    }
}
