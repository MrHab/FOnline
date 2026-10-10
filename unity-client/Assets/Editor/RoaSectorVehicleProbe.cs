using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Kromka;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Replays public bridge crossings with the game's real vehicle hull resolver.</summary>
    public static class RoaSectorVehicleProbe
    {
        private static readonly MethodInfo Awake=typeof(RoaPlayerController).GetMethod("Awake",BindingFlags.Instance|BindingFlags.NonPublic);
        private static readonly MethodInfo Resolve=typeof(RoaPlayerController).GetMethod("ResolveHullMotion",BindingFlags.Instance|BindingFlags.NonPublic);
        private static readonly MethodInfo Penetration=typeof(RoaPlayerController).GetMethod("HullPenetration",BindingFlags.Instance|BindingFlags.NonPublic);
        public static void Run()
        {
            try
            {
                if(Awake==null||Resolve==null||Penetration==null)throw new InvalidOperationException("Vehicle movement methods unavailable");
                string repository=Path.GetFullPath(Path.Combine(Application.dataPath,"../.."));
                var vehicles=JObject.Parse(File.ReadAllText(Path.Combine(repository,"data/kromka/vehicles.json")))["vehicles"].OfType<JObject>()
                    .Where(v=>v.Value<string>("itemId")=="motorcycle"||v.Value<string>("itemId")=="armyTruck").ToArray();
                if(vehicles.Length!=2)throw new InvalidOperationException("Missing authored vehicle bodies");
                var serviceWalkways=JObject.Parse(File.ReadAllText(Path.Combine(repository,"data/kromka/sector-engineering.json")))["serviceWalkways"].OfType<JObject>().ToArray();
                var savedWalkway=JObject.Parse(File.ReadAllText(Path.Combine(repository,"data/kromka/sector-surfaces.json")))["profiles"]
                    .OfType<JObject>().Single(row=>row.Value<string>("zoneId")=="z_12_13")["bridges"]
                    .OfType<JObject>().Single(row=>row.Value<string>("id")=="ore_bank_service_walkway");
                if(serviceWalkways.Length!=1
                    || serviceWalkways[0].Value<string>("zone")!="z_12_13"
                    || serviceWalkways[0].Value<string>("id")!="ore_bank_service_walkway"
                    || serviceWalkways[0].Value<string>("road")!="gate_east"
                    || serviceWalkways[0].Value<string>("track")!="resource_ore_walkway"
                    || Math.Abs(serviceWalkways[0].Value<float>("halfWidth")-1.6f)>.0001f
                    || !serviceWalkways[0].Value<string>("purpose").StartsWith("Пешеходный",StringComparison.Ordinal))
                    throw new InvalidOperationException("Pedestrian ore walkway engineering recipe drifted");
                if(savedWalkway.Value<string>("purpose")!=serviceWalkways[0].Value<string>("purpose"))
                    throw new InvalidOperationException("Pedestrian ore walkway purpose drifted in the published profile");
                string requested=Environment.GetEnvironmentVariable("ROA_SECTOR_IDS");
                var selected=string.IsNullOrWhiteSpace(requested)?null:new HashSet<string>(requested.Split(','),StringComparer.Ordinal);
                int crossings=0,roadBridges=0,pedestrianBridges=0,expectedTruckStops=0;
                var completed=new List<string>();var failures=new List<object>();
                bool waterGuards=Environment.GetEnvironmentVariable("ROA_VEHICLE_WATER_GUARDS")=="1";
                var waterGuardCases=new List<object>();var waterGuardExcluded=new List<object>();
                foreach(var p in RoaSectorSurface.AllProfiles.OrderBy(p=>p.zoneId,StringComparer.Ordinal))
                {
                    if(p.legacyDam||selected!=null&&!selected.Contains(p.locationId)||!p.bridges.Any(b=>b.style!="railViaduct"))continue;
                    try
                    {
                        EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                        var location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                        string file=p.locationId==p.zoneId?"data/zones/authored/"+p.zoneId+".json":"data/locations/"+p.locationId+".json";
                        var painter=new GameObject("VehicleProbeTerrain").AddComponent<RoaLocalTerrain>();
                        painter.InitializeAuthoredSurface(JsonConvert.DeserializeObject<LocationDefinition>(File.ReadAllText(Path.Combine(repository,file))),null,location.GroundRenderer);
                        Physics.SyncTransforms();
                        foreach(var bridge in p.bridges.Where(b=>b.style!="railViaduct"))
                        {
                            var points=RoaSectorWalkProbe.Trim(bridge.points?.Length>1?bridge.points:new[]{bridge.a,bridge.b},p,8);
                            if(points.Count<2)throw new InvalidOperationException("Bridge has fewer than two physical route points: "+p.zoneId+"/"+bridge.id);
                            bool pedestrian=p.zoneId=="z_12_13"&&bridge.id=="ore_bank_service_walkway";
                            if(pedestrian)
                            {
                                if(bridge.style!="metalService"
                                    || Math.Abs(bridge.halfWidth-1.6f)>.0001f)
                                    throw new InvalidOperationException("Pedestrian ore walkway profile drifted");
                                pedestrianBridges++;
                            }
                            else roadBridges++;
                            foreach(var vehicle in vehicles)
                            {
                                bool truck=vehicle.Value<string>("itemId")=="armyTruck";
                                if(pedestrian&&truck)
                                {
                                    // The ore shelf landing is a foot-only ledge. A truck cannot be
                                    // spawned there for a reverse test; prove the valid gate-side
                                    // approach meets the authored physical side guard instead.
                                    if(Drive(p,bridge.id,points,vehicle,true))
                                        throw new InvalidOperationException("Army truck crossed the narrow pedestrian ore walkway");
                                    expectedTruckStops++;
                                    continue;
                                }
                                foreach(var route in new[]{points,points.AsEnumerable().Reverse().ToList()})
                                {
                                    if(!Drive(p,bridge.id,route,vehicle,false))
                                        throw new InvalidOperationException("Unexpected vehicle stop at "+p.zoneId+"/"+bridge.id);
                                    crossings++;
                                }
                            }
                        }
                        if(waterGuards&&p.locationId=="sluiceCity")
                        {
                            // The ordinary vehicle terrain painter may project a
                            // preview into transient meshes. Guard acceptance uses
                            // the independently reopened, persisted Native scene.
                            Object.DestroyImmediate(painter.gameObject);
                            EditorSceneManager.OpenScene(KromkaLocationSceneCatalog.ScenePath(p.locationId));
                            location=Object.FindFirstObjectByType<RoaUnityLocationScene>();
                            if(location==null||location.GroundRenderer==null)
                                throw new InvalidOperationException("Saved City guard scene/ground unavailable");
                            Physics.SyncTransforms();
                            foreach(var bridge in p.bridges.Where(b=>b.style!="railViaduct"))
                                waterGuardCases.AddRange(RoaSectorVehicleWaterGuardProbe.Check(p,bridge,vehicles,location.GroundRenderer,waterGuardExcluded));
                        }
                        completed.Add(p.locationId);Debug.Log("[SECTOR VEHICLE] Completed "+p.locationId);
                    }
                    catch(Exception error)
                    {
                        if(Environment.GetEnvironmentVariable("ROA_VEHICLE_COLLECT_FAILURES")!="1")throw;
                        failures.Add(new{zone=p.zoneId,locationId=p.locationId,message=error.Message});
                        Debug.LogError("[SECTOR VEHICLE] Failed "+p.locationId+": "+error.Message);
                    }
                }
                string report=Environment.GetEnvironmentVariable("ROA_VEHICLE_REPORT");
                if(!string.IsNullOrWhiteSpace(report))File.WriteAllText(report,JsonConvert.SerializeObject(new{completed,failures,crossings,roadBridges,pedestrianBridges,expectedTruckStops,reversePedestrianTruckExcluded=true,waterGuards,waterGuardCases,waterGuardExcluded},Formatting.Indented)+"\n");
                if(failures.Count>0)throw new InvalidOperationException("Vehicle bridges failed in "+failures.Count+" zones");
                if(crossings==0)throw new InvalidOperationException("No vehicle crossings selected");
                if(waterGuards&&waterGuardCases.Count==0)throw new InvalidOperationException("No actual City vehicle water guards checked");
                if(selected==null&&(roadBridges!=26||pedestrianBridges!=1||crossings!=106||expectedTruckStops!=1))
                    throw new InvalidOperationException($"Vehicle bridge coverage drifted: roads={roadBridges}, pedestrian={pedestrianBridges}, crossings={crossings}, expectedTruckStops={expectedTruckStops}");
                Debug.Log($"[SECTOR VEHICLE] PASS: {crossings} real hull crossings and {expectedTruckStops} physically guarded gate-side truck stop on the pedestrian walkway; reverse truck spawn excluded.");
                if(Application.isBatchMode)EditorApplication.Exit(0);
            }
            catch(Exception error){Debug.LogException(error);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        // True means the full crossing completed. False is allowed only when the
        // exact pedestrian ore guard physically stops the authored truck hull.
        private static bool Drive(RoaSectorSurface.Profile p,string id,List<Vector2> points,JObject vehicle,bool expectTruckStop)
        {
            var walker=new GameObject("SectorVehicleHull");
            var relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            var hull=RoaVehicleCatalog.Hull.Parse((JObject)vehicle["hull"]);
            Vector2 direction=(points[1]-points[0]).normalized;
            // Centre the authored hull on the carriageway; the cab's driver is off centre.
            Vector2 first=points[0]+new Vector2(-direction.y,direction.x)*hull.OffsetX;
            walker.transform.position=new Vector3(first.x,RoaSectorSurface.Height(p,relief,first.x,first.y,true)+1.05f,first.y);
            var body=walker.AddComponent<CharacterController>();body.height=RoaGameBootstrap.PlayerHeight;body.center=Vector3.zero;
            var player=walker.AddComponent<RoaPlayerController>();Awake.Invoke(player,null);
            player.ApplyVehicleState(new JObject{["itemId"]=vehicle["itemId"],["speed"]=vehicle["tiers"][0]["speed"],["hull"]=vehicle["hull"].DeepClone()});
            try
            {
                for(int settle=0;settle<20;settle++)body.Move(Vector3.down*.04f);
                for(int i=1;i<points.Count;i++)
                {
                    direction=(points[i]-points[i-1]).normalized;
                    Vector2 target=points[i]+new Vector2(-direction.y,direction.x)*hull.OffsetX;
                    walker.transform.rotation=Quaternion.LookRotation(new Vector3(direction.x,0,direction.y));
                    Physics.SyncTransforms();
                    var args=new object[]{walker.transform.position,walker.transform.rotation,Vector3.zero};
                    float overlap=(float)Penetration.Invoke(player,args);
                    if(overlap>.08f)
                    {
                        if(expectTruckStop&&SideGuardPenetration(player,walker,body,hull,id)>.08f)return false;
                        var hullProbe=(BoxCollider)typeof(RoaPlayerController).GetField("_hullProbe",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(player);
                        Vector3 centre=walker.transform.position-Vector3.up*body.height*.5f+walker.transform.rotation*hull.LocalCenter;
                        var contacts=new List<string>();
                        foreach(var contact in Physics.OverlapBox(centre,hull.HalfExtents,walker.transform.rotation,Physics.DefaultRaycastLayers,QueryTriggerInteraction.Ignore).Where(c=>c!=body))
                            if(Physics.ComputePenetration(hullProbe,centre,walker.transform.rotation,contact,contact.transform.position,contact.transform.rotation,out Vector3 push,out float depth))
                                contacts.Add(contact.name+" push "+push+" depth "+depth+" "+contact.bounds);
                        throw new InvalidOperationException($"Vehicle hull intersects bridge at turn {p.zoneId}/{id}/{vehicle["itemId"]}: {walker.transform.position}, overlap {overlap}; contacts "+string.Join("; ",contacts));
                    }
                    int attempts=Mathf.CeilToInt(Vector2.Distance(new Vector2(walker.transform.position.x,walker.transform.position.z),target)/.12f)*3+30;
                    for(int j=0;j<attempts;j++)
                    {
                        Vector2 delta=target-new Vector2(walker.transform.position.x,walker.transform.position.z);
                        if(delta.magnitude<.08f)break;
                        delta=delta.normalized*Mathf.Min(.12f,delta.magnitude);
                        var motion=(Vector3)Resolve.Invoke(player,new object[]{new Vector3(delta.x,0,delta.y),Vector3.zero});
                        motion.y=-.04f;body.Move(motion);
                    }
                    Vector2 reached=new Vector2(walker.transform.position.x,walker.transform.position.z);
                    if(Vector2.Distance(reached,target)>.55f)
                    {
                        if(expectTruckStop&&SideGuardPenetration(player,walker,body,hull,id)>.08f)return false;
                        Vector3 centre=walker.transform.position-Vector3.up*body.height*.5f+walker.transform.rotation*hull.LocalCenter;
                        string contacts=string.Join("; ",Physics.OverlapBox(centre,hull.HalfExtents+Vector3.one*.1f,walker.transform.rotation,Physics.DefaultRaycastLayers,QueryTriggerInteraction.Ignore).Where(c=>c!=body).Select(c=>c.name+" "+c.bounds));
                        throw new InvalidOperationException($"Vehicle blocked {p.zoneId}/{id}/{vehicle["itemId"]}: reached {walker.transform.position}, target {target}; contacts {contacts}");
                    }
                }
                return true;
            }
            finally{Object.DestroyImmediate(walker);}
        }
        private static float SideGuardPenetration(RoaPlayerController player,GameObject walker,CharacterController body,RoaVehicleCatalog.Hull hull,string bridgeId)
        {
            var hullProbe=(BoxCollider)typeof(RoaPlayerController).GetField("_hullProbe",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(player);
            Vector3 centre=walker.transform.position-Vector3.up*body.height*.5f+walker.transform.rotation*hull.LocalCenter;
            float depth=0;
            foreach(var contact in Physics.OverlapBox(centre,hull.HalfExtents,walker.transform.rotation,Physics.DefaultRaycastLayers,QueryTriggerInteraction.Ignore))
            {
                if(contact.name!="BridgeWaterSideGuards_"+bridgeId)continue;
                if(Physics.ComputePenetration(hullProbe,centre,walker.transform.rotation,contact,contact.transform.position,contact.transform.rotation,out _,out float hitDepth))
                    depth=Mathf.Max(depth,hitDepth);
            }
            return depth;
        }
    }
}
