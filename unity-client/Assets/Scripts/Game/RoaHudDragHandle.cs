using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Перетаскивание HUD-панели в режиме редактирования (body.hud-edit-mode
    /// web: золотая рамка, drag мышью/пальцем, позиция запоминается локально).
    /// Смещение хранится относительно авторской позиции панели, поэтому
    /// раскладка переживает смену разрешения; Reset в RoaHudLayout обнуляет.
    /// </summary>
    public sealed class RoaHudDragHandle : MonoBehaviour, IBeginDragHandler, IDragHandler, IEndDragHandler
    {
        private static readonly Color Frame = new Color(0.94f, 0.78f, 0.36f, 0.95f);

        public string Id;

        private RectTransform _rect;
        private Vector2 _basePosition;
        private Vector2 _dragStart;
        private Vector2 _dragOffsetStart;
        private Image _catcher;
        private Outline _frame;
        private int _appliedResetVersion = -1;
        private bool _editing;

        public void Configure(string id)
        {
            Id = id;
            _rect = (RectTransform)transform;
            _basePosition = _rect.anchoredPosition;

            // Прозрачный «ловец» кликов поверх панели: включается только в редакторе,
            // чтобы в игре не перехватывать нажатия по кнопкам HUD.
            var catcherGo = new GameObject("DragCatcher", typeof(RectTransform));
            var catcherRect = (RectTransform)catcherGo.transform;
            catcherRect.SetParent(transform, false);
            catcherRect.anchorMin = Vector2.zero;
            catcherRect.anchorMax = Vector2.one;
            catcherRect.offsetMin = Vector2.zero;
            catcherRect.offsetMax = Vector2.zero;
            _catcher = catcherGo.AddComponent<Image>();
            _catcher.color = new Color(0.94f, 0.78f, 0.36f, 0.08f);
            _catcher.raycastTarget = true;
            _frame = catcherGo.AddComponent<Outline>();
            _frame.effectColor = Frame;
            _frame.effectDistance = new Vector2(2f, -2f);
            var pass = catcherGo.AddComponent<RoaDragRelay>();
            pass.Target = this;
            catcherGo.SetActive(false);

            Apply();
        }

        public void SetBasePosition(Vector2 basePosition)
        {
            _basePosition = basePosition;
            Apply();
        }

        private void Update()
        {
            bool editing = RoaHudLayout.Editing;
            if (editing != _editing)
            {
                _editing = editing;
                if (_catcher != null) _catcher.gameObject.SetActive(editing);
            }
            if (editing || _appliedResetVersion != RoaHudLayout.ResetVersion) Apply();
        }

        private void Apply()
        {
            _appliedResetVersion = RoaHudLayout.ResetVersion;
            if (_rect == null) _rect = (RectTransform)transform;
            _rect.anchoredPosition = _basePosition + RoaHudLayout.CanvasOffset(Id);
        }

        public void OnBeginDrag(PointerEventData eventData)
        {
            if (!RoaHudLayout.Editing) return;
            _dragStart = eventData.position;
            _dragOffsetStart = RoaHudLayout.CanvasOffset(Id);
        }

        public void OnDrag(PointerEventData eventData)
        {
            if (!RoaHudLayout.Editing) return;
            // Переводим экранный сдвиг в единицы канвы через масштаб корневого Canvas.
            Canvas canvas = GetComponentInParent<Canvas>();
            float scale = canvas != null ? canvas.scaleFactor : 1f;
            Vector2 delta = (eventData.position - _dragStart) / Mathf.Max(0.01f, scale);
            RoaHudLayout.SetCanvasOffset(Id, _dragOffsetStart + delta, false);
            Apply();
        }

        public void OnEndDrag(PointerEventData eventData)
        {
            if (!RoaHudLayout.Editing) return;
            RoaHudLayout.SetCanvasOffset(Id, RoaHudLayout.CanvasOffset(Id), true);
        }

        /// <summary>Ловец получает события указателя и передаёт их панели.</summary>
        private sealed class RoaDragRelay : MonoBehaviour, IBeginDragHandler, IDragHandler, IEndDragHandler
        {
            public RoaHudDragHandle Target;
            public void OnBeginDrag(PointerEventData e) { Target?.OnBeginDrag(e); }
            public void OnDrag(PointerEventData e) { Target?.OnDrag(e); }
            public void OnEndDrag(PointerEventData e) { Target?.OnEndDrag(e); }
        }
    }
}
