using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.World;
using UnityEngine;

namespace RealmOfAshes.EditorTools
{
    // A deterministic build input, not a scene bake. The exported bits are
    // shared by the server, playable mesh, retained water and overview mesh.
    public static class RoaSectorGroundLatticeExport
    {
        public static void Run()
        {
            try { Export(); if(Application.isBatchMode)UnityEditor.EditorApplication.Exit(0); }
            catch(Exception error) { Debug.LogException(error); if(Application.isBatchMode)UnityEditor.EditorApplication.Exit(1); else throw; }
        }
        private static string Digest(byte[] bytes)
        {
            using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
        }
        private static void Export()
        {
            string input=Environment.GetEnvironmentVariable("ROA_GROUND_LATTICE_INPUT"),
                output=Environment.GetEnvironmentVariable("ROA_GROUND_LATTICE_OUT"),
                preview=Environment.GetEnvironmentVariable("ROA_SURFACE_PREVIEW_INPUT");
            if(string.IsNullOrEmpty(input)||string.IsNullOrEmpty(output)||string.IsNullOrEmpty(preview)
                ||Path.GetFullPath(input)!=Path.GetFullPath(preview)||Path.GetFullPath(input)==Path.GetFullPath(output))
                throw new InvalidOperationException("Explicit matching ground lattice request/preview and separate output required");
            byte[] bytes=File.ReadAllBytes(input);string before=Digest(bytes);
            JObject request=JObject.Parse(System.Text.Encoding.UTF8.GetString(bytes));
            if(request.Value<string>("schema")!="roa.groundLatticeRequest.v1")throw new InvalidOperationException("Invalid ground lattice request schema");
            foreach(string field in new[]{"inputSha256","geometryHash","codeHash"})
                if(request.Value<string>(field)?.Length!=64)throw new InvalidOperationException("Missing ground lattice request "+field);
            var relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            JObject fieldData=request["relief"] as JObject;
            if(relief==null||!relief.Ready||fieldData==null||fieldData.Value<int>("samplesX")!=relief.SamplesX
                ||fieldData.Value<int>("samplesY")!=relief.SamplesY||(float)fieldData.Value<double>("width")!=relief.WidthPoints
                ||(float)fieldData.Value<double>("depth")!=relief.HeightPoints)
                throw new InvalidOperationException("Request relief dimensions differ from authored Unity relief");
            var heights=fieldData["heights"] as JArray;
            if(heights==null||heights.Count!=relief.Heights.Length)throw new InvalidOperationException("Request relief height count differs");
            for(int i=0;i<heights.Count;i++)if(BitConverter.SingleToInt32Bits((float)heights[i].Value<double>())!=BitConverter.SingleToInt32Bits(relief.Heights[i]))
                throw new InvalidOperationException("Request relief differs at sample "+i);
            string[] zoneIds=(request["zoneIds"] as JArray)?.Values<string>().ToArray();
            var zones=request["zones"] as JArray;
            if(zoneIds==null||zoneIds.Length==0||zoneIds.Distinct().Count()!=zoneIds.Length||zones?.Count!=zoneIds.Length)
                throw new InvalidOperationException("Invalid requested ground lattice zones");
            var profiles=RoaSectorSurface.AllProfiles.ToDictionary(p=>p.zoneId);
            CheckMarkerFixtures(profiles.Values.First(p=>!zoneIds.Contains(p.zoneId)&&!p.legacyDam),relief);
            var rows=new List<object>();
            for(int zi=0;zi<zoneIds.Length;zi++)
            {
                string zone=zoneIds[zi];JObject metadata=zones[zi] as JObject;
                if(metadata?.Value<string>("zoneId")!=zone||!profiles.TryGetValue(zone,out var profile))
                    throw new InvalidOperationException("Missing/misordered requested profile "+zone);
                int n=profile.terrainSegments==256?256:128;
                if(metadata.Value<int>("segments")!=n||metadata.Value<string>("profileGeometryHash")?.Length!=64)
                    throw new InvalidOperationException("Invalid lattice metadata "+zone);
                long[] bits=new long[3*(n+1)*(n+1)];
                for(int iz=0;iz<=n;iz++)for(int ix=0;ix<=n;ix++)
                {
                    Vector3 point=RoaSectorSurface.GridVertex(profile,relief,ix,iz,n,true);
                    int at=3*(iz*(n+1)+ix);
                    float[] components={point.x,point.y,point.z};
                    for(int c=0;c<3;c++)
                    {
                        float value=components[c];
                        if(float.IsNaN(value)||float.IsInfinity(value))throw new InvalidOperationException("Nonfinite native ground "+zone);
                        bits[at+c]=unchecked((uint)BitConverter.SingleToInt32Bits(value));
                    }
                }
                // Exercise the exact JsonUtility import used by the client.
                var cache=new RoaSectorSurface.GroundLattice {schema="roa.groundLattice.v1",zoneId=zone,segments=n,
                    profileGeometryHash=metadata.Value<string>("profileGeometryHash"),geometryHash=request.Value<string>("geometryHash"),
                    codeHash=request.Value<string>("codeHash"),vertexBits=bits};
                profile.groundLattice=JsonUtility.FromJson<RoaSectorSurface.GroundLattice>(JsonUtility.ToJson(cache));
                profile.hasGroundLattice=true;
                for(int iz=0;iz<=n;iz++)for(int ix=0;ix<=n;ix++)
                {
                    Vector3 actual=RoaSectorSurface.GridVertex(profile,relief,ix,iz,n);int at=3*(iz*(n+1)+ix);
                    if(unchecked((uint)BitConverter.SingleToInt32Bits(actual.x))!=bits[at]
                        ||unchecked((uint)BitConverter.SingleToInt32Bits(actual.y))!=bits[at+1]
                        ||unchecked((uint)BitConverter.SingleToInt32Bits(actual.z))!=bits[at+2])
                        throw new InvalidOperationException("Lattice import did not preserve Float32 bits "+zone);
                }
                rows.Add(new{zoneId=zone,segments=n,profileGeometryHash=metadata.Value<string>("profileGeometryHash"),vertexBits=bits});
            }
            if(Digest(File.ReadAllBytes(input))!=before)throw new InvalidOperationException("Ground lattice request changed during export");
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)));
            File.WriteAllText(output,JsonConvert.SerializeObject(new{schema="roa.groundLatticeExport.v1",
                inputSha256=request.Value<string>("inputSha256"),geometryHash=request.Value<string>("geometryHash"),
                codeHash=request.Value<string>("codeHash"),zones=rows},Formatting.None));
            Debug.Log("Canonical ground lattices exported: "+rows.Count+"; native and imported bits identical");
        }
        private static void CheckMarkerFixtures(RoaSectorSurface.Profile dry,RoaGlobalMapRelief relief)
        {
            var original=dry.groundLattice;bool marked=dry.hasGroundLattice;
            int n=dry.terrainSegments==256?256:128;
            try
            {
                dry.hasGroundLattice=false;dry.groundLattice=new RoaSectorSurface.GroundLattice();
                Vector3 absent=RoaSectorSurface.GridVertex(dry,relief,n/2,n/2,n),
                    native=RoaSectorSurface.GridVertex(dry,relief,n/2,n/2,n,true);
                for(int c=0;c<3;c++)if(BitConverter.SingleToInt32Bits(absent[c])!=BitConverter.SingleToInt32Bits(native[c]))
                    throw new InvalidOperationException("Absent dry cache changed native vertex");
                void Reject(string label)
                {
                    bool rejected=false;
                    try { RoaSectorSurface.GridVertex(dry,relief,n/2,n/2,n); }
                    catch(InvalidOperationException) { rejected=true; }
                    if(!rejected)throw new InvalidOperationException("Cache marker fixture accepted "+label);
                }
                dry.hasGroundLattice=true;Reject("empty marked cache");
                dry.groundLattice=null;Reject("missing marked cache");
                dry.hasGroundLattice=false;dry.groundLattice=new RoaSectorSurface.GroundLattice {schema="roa.groundLattice.v1"};
                Reject("unmarked authored cache");
            }
            finally { dry.groundLattice=original;dry.hasGroundLattice=marked; }
        }
    }
}
