using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Прячет сущность, которую персонаж не имеет права видеть.
    ///
    /// Гасятся именно рендереры, а не сам объект. Выключенный GameObject
    /// перестал бы получать Update: анимация, интерполяция и позы замерли бы,
    /// и сущность выныривала бы из тумана в позе полуминутной давности.
    /// Заодно так не рвутся ссылки на компоненты у менеджеров.
    ///
    /// Список рендереров пересобирается по требованию: модели грузятся
    /// асинхронно и появляются уже после создания корня.
    /// </summary>
    public sealed class RoaVisibilityGate : MonoBehaviour
    {
        private readonly List<Renderer> _renderers = new List<Renderer>();
        private bool _visible = true;
        private int _knownHierarchyCount = -1;

        public bool IsVisible { get { return _visible; } }

        /// <summary>Пересобрать список рендереров при следующем применении.</summary>
        public void Invalidate()
        {
            _knownHierarchyCount = -1;
        }

        public void SetVisible(bool visible)
        {
            // Пересобираем список рендереров, когда МЕНЯЕТСЯ ИЕРАРХИЯ ЛЮБОЙ
            // глубины. transform.childCount ловит только прямых потомков, а
            // GLTFast достраивает меши существу глубже (внуками) и порциями по
            // кадрам: снимок по childCount фиксировал пустой список и больше не
            // обновлялся — существо гасло по gate, но рендереры оставались
            // включёнными. hierarchyCount меняется при добавлении узла на любом
            // уровне и остаётся дешёвым (свойство, без аллокаций).
            int hierarchyCount = transform.hierarchyCount;

            if (_knownHierarchyCount != hierarchyCount)
            {
                _knownHierarchyCount = hierarchyCount;
                _renderers.Clear();
                GetComponentsInChildren(true, _renderers);

                // Свежие рендереры не знают текущего состояния — применяем принудительно.
                Write(visible);
                _visible = visible;
                return;
            }

            if (_visible == visible) return;

            _visible = visible;
            Write(visible);
        }

        private void Write(bool visible)
        {
            for (int i = 0; i < _renderers.Count; i++)
                if (_renderers[i] != null) _renderers[i].enabled = visible;
        }
    }
}
