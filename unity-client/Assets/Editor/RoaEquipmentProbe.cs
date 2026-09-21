#if UNITY_EDITOR
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using UnityEditor;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    /// <summary>
    /// Живая проверка главного инварианта экипировки: её skinned-меши должны
    /// ссылаться на кости тела, а не на уничтожаемый скелет собственного GLB.
    /// Запускается в Play Mode, чтобы использовать обычный асинхронный путь.
    /// </summary>
    public static class RoaEquipmentProbe
    {
        private const string Menu = "Realm of Ashes/Проверить экипировку персонажа";

    }
}
#endif
