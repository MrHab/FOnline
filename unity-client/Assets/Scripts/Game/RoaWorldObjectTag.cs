using UnityEngine;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Метка объекта локации на сцене: по ней подсказка при наведении узнаёт, на что
    /// именно смотрит курсор. Ставится только тем объектам, которым есть что сказать,
    /// и переписывается при выдаче из пула.
    /// </summary>
    public sealed class RoaWorldObjectTag : MonoBehaviour
    {
        public string ObjectId;
    }
}
