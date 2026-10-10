using System;
using System.Linq;
using Kromka.Authoring;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;

namespace RealmOfAshes.EditorTools
{
    internal static class RoaAuthoredIdentity
    {
        internal static void Configure(RoaUnityLocationScene location,JObject definition)
        {
            var authoring=location.GetComponent<KromkaLocationAuthoring>();
            string id=definition.Value<string>("id");
            if(authoring==null || !Enum.TryParse((definition.Value<string>("macroRegion")??"").Replace("_",""),true,out KromkaMacroRegion region))throw new InvalidOperationException("Unknown authored identity "+id);
            authoring.ConfigureIdentity(id,definition.Value<string>("name"),authoring.LocationKind,region);
            var spawns=(definition["unitySpawns"] as JArray??new JArray()).OfType<JObject>().ToDictionary(s=>s.Value<string>("id"),StringComparer.Ordinal);
            foreach(var spawn in location.GetComponentsInChildren<KromkaSpawnAuthoring>(true))if(spawns.TryGetValue(spawn.SpawnId,out JObject row))spawn.Configure(spawn.SpawnId,spawn.Kind,spawn.TargetLocationId,row.Value<float>("radius"));
        }
    }
}
