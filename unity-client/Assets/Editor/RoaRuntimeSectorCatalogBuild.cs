using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using RealmOfAshes.World;

namespace RealmOfAshes.EditorTools
{
    public sealed class RoaRuntimeSectorCatalogBuild : IDisposable
    {
        private const string Authoring="Assets/Resources/RealmOfAshes/SectorSurfaces.json";
        private const string Staged="Assets/Art/Kromka/BuildOnlySectorSurfaces.json";
        private const string Folder="Assets/Resources/RealmOfAshes/RuntimeSectors";
        [Serializable] private sealed class Catalog { public RoaSectorSurface.Profile[] profiles; }
        public static void RestoreAuthoringCatalog()
        {
            if(!File.Exists(Authoring)&&File.Exists(Staged))Move(Staged,Authoring);
            if(!File.Exists(Authoring)||File.Exists(Staged))throw new InvalidOperationException("Sector authoring catalog recovery failed.");
        }
        public RoaRuntimeSectorCatalogBuild()
        {
            // Recover the owned move if a previous editor process was terminated.
            RestoreAuthoringCatalog();
            if(File.Exists(Staged))throw new InvalidOperationException("Unexpected staged sector catalog; preserve it before rebuilding.");
            var expectedProfiles=ReadExpectedProfiles();
            var expectedFiles=expectedProfiles.Keys.Select(id=>id+".json").Append("index.json").ToHashSet(StringComparer.Ordinal);
            Directory.CreateDirectory(Folder);
            foreach(string file in Directory.GetFiles(Folder,"*.json"))
                if(!expectedFiles.Contains(Path.GetFileName(file)))throw new InvalidOperationException("Unexpected generated runtime sector file "+file);
            JArray headers=new JArray();
            // Keep only one JSON token tree in memory. The complete authoring
            // document's token tree otherwise competes with the WebGL compiler.
            using(var stream=new StreamReader(Authoring))
            using(var reader=new JsonTextReader(stream))
            {
                while(reader.Read())
                {
                    if(reader.TokenType!=JsonToken.PropertyName||reader.Depth!=1||(string)reader.Value!="profiles")continue;
                    if(!reader.Read()||reader.TokenType!=JsonToken.StartArray)throw new InvalidOperationException("Missing sector profile array");
                    while(reader.Read()&&reader.TokenType!=JsonToken.EndArray)
                    {
                        JObject p=JObject.Load(reader);
                        string id=p.Value<string>("locationId");
                        if(string.IsNullOrEmpty(id)||id.IndexOfAny(new[]{'/','\\'})>=0)throw new InvalidOperationException("Invalid sector identity");
                        File.WriteAllText(Folder+"/"+id+".json",p.ToString(Formatting.None));
                        JObject header=new JObject();
                        foreach(string field in new[]{"zoneId","locationId","mapMinX","mapMinY","mapSpan","width","depth","gain","datum"})header[field]=p[field]?.DeepClone();
                        headers.Add(header);
                    }
                    break;
                }
            }
            if(headers.Count!=expectedProfiles.Count)throw new InvalidOperationException("Generated sector coverage mismatch");
            File.WriteAllText(Folder+"/index.json",new JObject{["profiles"]=headers}.ToString(Formatting.None));
            AssetDatabase.Refresh();
            // Exercise the exact player loader, comparing every deserialized field.
            var runtime=new RoaRuntimeSectorCatalog();
            int verified=0;
            foreach(var expected in expectedProfiles.Values)
            {
                var actual=runtime.Find(expected.locationId);
                if(JsonUtility.ToJson(expected)!=JsonUtility.ToJson(actual))throw new InvalidOperationException("Runtime sector data changed "+expected.locationId);
                var header=runtime.Headers.Single(h=>h.locationId==expected.locationId);
                if(header.zoneId!=expected.zoneId||header.mapMinX!=expected.mapMinX||header.mapMinY!=expected.mapMinY||header.mapSpan!=expected.mapSpan||header.width!=expected.width||header.depth!=expected.depth||header.gain!=expected.gain||header.datum!=expected.datum)
                    throw new InvalidOperationException("Runtime sector bounds changed "+expected.locationId);
                runtime.ReleaseProfiles();
                verified++;
            }
            if(verified!=headers.Count||runtime.LoadedCount!=0)throw new InvalidOperationException("Runtime sector coverage mismatch");
            Debug.Log("[RUNTIME SECTORS] PASS: "+headers.Count+" exact sector profiles; player loads selected profiles lazily.");
            Move(Authoring,Staged);
        }
        private static System.Collections.Generic.Dictionary<string,RoaSectorSurface.Profile> ReadExpectedProfiles()
            => JsonUtility.FromJson<Catalog>(File.ReadAllText(Authoring)).profiles.ToDictionary(p=>p.locationId,StringComparer.Ordinal);
        private static void Move(string from,string to)
        {
            string error=AssetDatabase.MoveAsset(from,to);
            if(!string.IsNullOrEmpty(error))throw new InvalidOperationException(error);
        }
        public void Dispose()
        {
            if(File.Exists(Staged))Move(Staged,Authoring);
        }
    }
}
