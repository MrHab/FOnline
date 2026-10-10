using System;
using System.Collections.Generic;
using UnityEngine;

namespace RealmOfAshes.World
{
    // The player reads one complete sector, without parsing the authoring world catalog.
    public sealed class RoaRuntimeSectorCatalog
    {
        public const string ResourceFolder="RealmOfAshes/RuntimeSectors";
        [Serializable] private sealed class Index { public RoaSectorSurface.Profile[] profiles; }
        private readonly Dictionary<string,RoaSectorSurface.Profile> _headers=new Dictionary<string,RoaSectorSurface.Profile>(StringComparer.Ordinal);
        private readonly Dictionary<string,RoaSectorSurface.Profile> _loaded=new Dictionary<string,RoaSectorSurface.Profile>(StringComparer.Ordinal);
        public IEnumerable<RoaSectorSurface.Profile> Headers=>_headers.Values;
        public int LoadedCount=>_loaded.Count;
        public void ReleaseProfiles()=>_loaded.Clear();
        public RoaRuntimeSectorCatalog()
        {
            TextAsset asset=Resources.Load<TextAsset>(ResourceFolder+"/index");
            if(asset==null)throw new InvalidOperationException("Missing runtime sector index; rebuild the Unity player.");
            try { foreach(var p in JsonUtility.FromJson<Index>(asset.text).profiles)_headers.Add(p.locationId,p); }
            finally { Resources.UnloadAsset(asset); }
        }
        public RoaSectorSurface.Profile Find(string id)
        {
            if(id==null||!_headers.ContainsKey(id))return null;
            if(_loaded.TryGetValue(id,out var p))return p;
            TextAsset asset=Resources.Load<TextAsset>(ResourceFolder+"/"+id);
            if(asset==null)throw new InvalidOperationException("Missing runtime sector "+id);
            try
            {
                p=JsonUtility.FromJson<RoaSectorSurface.Profile>(asset.text);
                if(p.locationId!=id)throw new InvalidOperationException("Runtime sector identity mismatch "+id);
                _loaded.Add(id,p);return p;
            }
            finally { Resources.UnloadAsset(asset); }
        }
    }
}
