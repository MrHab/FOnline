using UnityEngine;

namespace RealmOfAshes.Game
{
    public enum RoaUiPrefabKind
    {
        Root,
        LoadingScreen,
        AuthScreen,
        CharacterCreator,
        Hud,
        Minimap,
        SystemLog,
        Quickbar,
        Pipboy,
        Progression,
        Crafting,
        LocalMap,
        ModalWindow,
        Settings,
        Tutorial,
        QuantityDialog,
        LootWindow,
        BarterWindow,
        StorageWindow,
        GraphicsWindow,
        PauseScreen,
        ContextMenu,
        GlobalMap,
        MobileControls
    }

    /// <summary>
    /// Редактируемая Prefab-точка для каждого класса UI.
    /// Данные описывают те же breakpoints, что CSS web-клиента.
    /// </summary>
    public sealed class RoaUiPrefabTemplate : MonoBehaviour
    {
        public RoaUiPrefabKind Kind;
        public Vector2 DesktopReference = new Vector2(1920f, 1080f);
        public Vector2 MobileLandscapeReference = new Vector2(896f, 414f);
        public Vector4 SafePadding = new Vector4(12f, 12f, 12f, 12f);
        public string WebSelector = string.Empty;
        [TextArea] public string Purpose = string.Empty;
    }
}
