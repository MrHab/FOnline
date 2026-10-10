using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Game;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Opt-in actual saved-scene attempts to leave protected road decks for native water.</summary>
    internal static class RoaSectorVehicleWaterGuardProbe
    {
        private const BindingFlags Private=BindingFlags.Instance|BindingFlags.NonPublic;
        private static readonly MethodInfo Awake=typeof(RoaPlayerController).GetMethod("Awake",Private),
            Resolve=typeof(RoaPlayerController).GetMethod("ResolveHullMotion",Private),
            Cast=typeof(RoaPlayerController).GetMethod("CastHull",Private),
            Penetration=typeof(RoaPlayerController).GetMethod("HullPenetration",Private),
            OwnContact=typeof(RoaPlayerController).GetMethod("IsOwnHullContact",Private),
            DepthAllowed=typeof(RoaPlayerController).GetMethod("HullDepthAllowed",BindingFlags.Static|BindingFlags.NonPublic),
            Turn=typeof(RoaPlayerController).GetMethod("GuardHullTurn",Private),
            SetYaw=typeof(RoaPlayerController).GetMethod("SetYaw",Private);
        private static readonly FieldInfo Pivot=typeof(RoaPlayerController).GetField("_hullPivotShift",Private),
            Probe=typeof(RoaPlayerController).GetField("_hullProbe",Private),
            Colliding=typeof(RoaPlayerController).GetField("_colliding",Private),
            CollisionNormal=typeof(RoaPlayerController).GetField("_collisionNormal",Private),
            CollisionPressure=typeof(RoaPlayerController).GetField("_collisionPressure",Private),
            Yaw=typeof(RoaPlayerController).GetField("_yawDeg",Private),
            TurnFractions=typeof(RoaPlayerController).GetField("HullTurnFractions",BindingFlags.Static|BindingFlags.NonPublic);

        internal static IEnumerable<object> Check(RoaSectorSurface.Profile p,RoaSectorSurface.Route bridge,
            JObject[] vehicles,Renderer groundRenderer,ICollection<object> excluded)
        {
            if(Awake==null||Resolve==null||Cast==null||Penetration==null||OwnContact==null||DepthAllowed==null
                ||Turn==null||SetYaw==null||Pivot==null||Probe==null||Colliding==null||CollisionNormal==null||CollisionPressure==null
                ||Yaw==null||TurnFractions==null)
                throw new InvalidOperationException("Actual vehicle guard movement API unavailable");
            var parapet=Object.FindObjectsByType<MeshCollider>(FindObjectsSortMode.None)
                .SingleOrDefault(c=>c.name=="BridgeWaterParapets_"+bridge.id);
            if(parapet==null)yield break;
            var visual=parapet.GetComponent<MeshFilter>();
            if(!parapet.enabled||parapet.isTrigger||visual==null||visual.sharedMesh!=parapet.sharedMesh||parapet.GetComponent<MeshRenderer>()==null)
                throw new InvalidOperationException("Water parapet must be visible and physically identical: "+bridge.id);
            // The original flat-plane collider remains disabled on this object.
            // Select the enabled authored MeshCollider, as the native support probe does.
            var ground=groundRenderer.GetComponents<MeshCollider>()
                .SingleOrDefault(c=>c.enabled&&!c.isTrigger&&c.sharedMesh!=null&&c.gameObject.activeInHierarchy);
            var groundVisual=groundRenderer.GetComponent<MeshFilter>();
            if(ground==null||ground.name!="Ground_EDITABLE"||!groundRenderer.enabled||groundVisual==null
                ||groundVisual.sharedMesh!=ground.sharedMesh||!AssetDatabase.Contains(ground.sharedMesh))
                throw new InvalidOperationException("Actual saved Ground_EDITABLE MeshCollider/renderer unavailable");
            var relief=Resources.Load<RoaGlobalMapRelief>(RoaGlobalMapRelief.ResourceKey);
            var decks=new Dictionary<string,MeshCollider>();
            foreach(var route in p.bridges)
            {
                var deck=Object.FindObjectsByType<MeshCollider>(FindObjectsSortMode.None)
                    .SingleOrDefault(c=>c.name=="SectorBridge_"+route.id&&c.enabled&&!c.isTrigger);
                if(deck==null)continue;
                var filter=deck.GetComponent<MeshFilter>();var renderer=deck.GetComponent<MeshRenderer>();
                if(filter==null||renderer==null||!renderer.enabled||!deck.gameObject.activeInHierarchy
                    ||filter.sharedMesh!=deck.sharedMesh||!AssetDatabase.Contains(deck.sharedMesh))
                    throw new InvalidOperationException("Actual saved bridge floor/renderer unavailable: "+route.id);
                for(var t=deck.transform;t!=null;t=t.parent)
                    if(t.localPosition!=Vector3.zero||t.localRotation!=Quaternion.identity||t.localScale!=Vector3.one)
                        throw new InvalidOperationException("Saved bridge floor requires identity parent chain: "+route.id+"/"+t.name);
                decks.Add(route.id,deck);
            }
            var points=bridge.points?.Length>1?bridge.points:new[]{bridge.a,bridge.b};
            int cases=0;
            foreach(float sign in new[]{-1f,1f})
            {
                var stations=new List<(Vector2 point,Vector2 forward,Vector2 target)>();int protectedStations=0;
                for(int i=1;i<points.Length;i++)
                {
                    Vector2 a=new Vector2(points[i-1].x,points[i-1].z),b=new Vector2(points[i].x,points[i].z);
                    if(Vector2.Distance(a,b)<.001f)continue;
                    Vector2 forward=(b-a).normalized,middle=(a+b)*.5f,side=new Vector2(-forward.y,forward.x)*sign;
                    var sideRay=new Ray(new Vector3(middle.x,RoaSectorSurface.BridgeHeight(bridge,middle.x,middle.y)+.2f*p.gain/160,middle.y),
                        new Vector3(side.x,0,side.y));
                    if(!parapet.Raycast(sideRay,out RaycastHit wall,bridge.halfWidth+1)||Mathf.Abs(wall.normal.y)>.1f)continue;
                    protectedStations++;
                    // Select actual wet ground adjacent to this protected face.
                    // A distant river across a dry city bank is not a deck exit.
                    foreach(float offset in new[]{.05f,.1f,.25f,.5f,1f,2f})
                    {
                        Vector2 target=middle+side*(bridge.halfWidth+offset);
                        if(!NativeWet(p,relief,ground,target))continue;
                        stations.Add((middle,forward,target));break;
                    }
                }
                if(stations.Count==0)
                {
                    Debug.Log("[VEHICLE WATER GUARD] DRY SIDE "+bridge.id+"/"+sign+", protected stations "+protectedStations);
                    yield return new{bridge=bridge.id,mode="dry_side",sign,protectedStations,actualEscapeAttempt=false,
                        sourceWetTarget=false,status="NO_ADJACENT_SOURCE_AND_SAVED_GROUND_WET_TARGET"};
                    continue;
                }
                foreach(float heading in new[]{1f,-1f})foreach(var vehicle in vehicles)
                {
                    var hull=RoaVehicleCatalog.Hull.Parse((JObject)vehicle["hull"]);
                    foreach(float witness in new[]{-hull.Length*.5f,0,hull.Length*.5f})
                    {
                        var poses=new List<(int index,Vector3 feet,Quaternion rotation,Vector2 side,JObject receipt)>();
                        var exclusions=new JArray();bool allSceneClipped=true;
                        for(int index=0;index<stations.Count;index++)
                        {
                            var station=stations[index];Vector2 forward=station.forward*heading,side=new Vector2(-station.forward.y,station.forward.x)*sign;
                            Vector2 driver=station.point-forward*(hull.OffsetZ+witness)
                                +new Vector2(-forward.y,forward.x)*hull.OffsetX;
                            Quaternion rotation=Quaternion.LookRotation(new Vector3(forward.x,0,forward.y));
                            Vector3 feet=new Vector3(driver.x,RoaSectorSurface.Height(p,relief,driver.x,driver.y,true),driver.y);
                            var receipt=PoseEligibility(p,relief,ground,decks,hull,feet,rotation,index,station.point,station.target);
                            if(!receipt.Value<bool>("eligible"))
                            {exclusions.Add(receipt);allSceneClipped&=receipt.Value<string>("reason")=="SCENE_FOOTPRINT_CLIPPED";continue;}
                            poses.Add((index,feet,rotation,side,receipt));
                        }
                        if(poses.Count==0&&!allSceneClipped)
                        {
                            throw new InvalidOperationException("No actual safe hull pose for water guard: "+bridge.id+"/"+sign+"/"+vehicle["itemId"]
                                +"/"+heading+"/"+witness+", exclusions "+exclusions.ToString(Newtonsoft.Json.Formatting.None));
                        }
                        foreach(bool turning in new[]{false,true})
                        {
                            string attemptMode=turning?"turn":"lateral";
                            var available=new List<(int index,Vector3 feet,Quaternion rotation,Vector2 side,JObject receipt)>();
                            var modeExclusions=(JArray)exclusions.DeepClone();
                            foreach(var pose in poses)
                            {
                                var eligibility=(JObject)pose.receipt.DeepClone();
                                var sweep=AttemptSceneEligibility(p,relief,ground,hull,vehicle,pose.feet,pose.rotation,pose.side,stations[pose.index].target,turning);
                                eligibility[turning?"turnScenePreflight":"lateralScenePreflight"]=sweep;
                                if(!sweep.Value<bool>("eligible"))
                                {
                                    eligibility["eligible"]=false;
                                    eligibility["reason"]=turning?"SCENE_STEERING_OR_APPROACH_CLIPPED":"SCENE_LATERAL_APPROACH_CLIPPED";
                                    modeExclusions.Add(eligibility);continue;
                                }
                                available.Add((pose.index,pose.feet,pose.rotation,pose.side,eligibility));
                            }
                            var chosen=new[]{0,available.Count/2,available.Count-1}.Where(i=>available.Count>0).Distinct().ToArray();
                            var selection=new{attemptMode,candidateStations=stations.Count,eligibleStations=available.Select(v=>v.index).ToArray(),
                                selectedStations=chosen.Select(i=>available[i].index).ToArray(),excludedCount=modeExclusions.Count};
                            excluded.Add(new{bridge=bridge.id,mode="pose_eligibility",attemptMode,vehicle=vehicle.Value<string>("itemId"),sign,heading,witness,
                                actualEscapeAttempt=false,testPassed=false,candidateStations=stations.Count,
                                eligibleStations=selection.eligibleStations,selectedStations=selection.selectedStations,excludedPoses=modeExclusions,
                                status=available.Count==0?"ALL_POSES_SCENE_CLIPPED":"ELIGIBLE_POSES_SELECTED"});
                            if(available.Count==0&&modeExclusions.Any(e=>e.Value<string>("reason")!="SCENE_FOOTPRINT_CLIPPED"
                                &&e.Value<string>("reason")!="SCENE_STEERING_OR_APPROACH_CLIPPED"
                                &&e.Value<string>("reason")!="SCENE_LATERAL_APPROACH_CLIPPED"))
                                throw new InvalidOperationException("Empty guard family lacks all-scene-clipped proof: "+bridge.id+"/"+attemptMode
                                    +"/"+vehicle["itemId"]+"/"+heading+"/"+witness+", exclusions "+modeExclusions.ToString(Newtonsoft.Json.Formatting.None));
                            foreach(int poseIndex in chosen)
                            {
                                var pose=available[poseIndex];var station=stations[pose.index];
                                yield return Escape(p,bridge,vehicle,hull,parapet,ground,relief,pose.feet,pose.rotation,
                                    pose.side,station.point,station.target,witness,heading,sign,turning,pose.receipt,selection);
                                cases++;
                            }
                        }
                    }
                }
            }
            if(cases==0)throw new InvalidOperationException("Empty actual water guard coverage "+bridge.id);
        }

        private static JArray SceneClippedCorners(RoaSectorSurface.Profile p,Vector3 feet,Quaternion rotation,RoaVehicleCatalog.Hull hull)
        {
            var clipped=new JArray();
            foreach(float x in new[]{-hull.Width*.5f,hull.Width*.5f})foreach(float z in new[]{-hull.Length*.5f,hull.Length*.5f})
            {
                Vector3 corner=feet+rotation*new Vector3(hull.OffsetX+x,0,hull.OffsetZ+z);
                if(Mathf.Abs(corner.x)>p.width/2-.1f||Mathf.Abs(corner.z)>p.depth/2-.1f)clipped.Add(VectorReceipt(corner));
            }
            return clipped;
        }

        // Scope selection only: no collisions, water acceptance, or movement
        // tolerance is inferred from this nominal path. The actual attempt still
        // runs all 220 frames through the production motor and saved colliders.
        private static JObject AttemptSceneEligibility(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Collider ground,
            RoaVehicleCatalog.Hull hull,JObject vehicle,Vector3 initialFeet,Quaternion initialRotation,Vector2 side,Vector2 wetTarget,bool turning)
        {
            Vector3 feet=initialFeet;Quaternion rotation=initialRotation;float yaw=rotation.eulerAngles.y;
            float maxStep=turning?Mathf.Min(2f,vehicle.Value<float>("turnStillDeg")*.02f):0;
            JObject Clip(int frame,string phase,Vector3 candidate,Quaternion candidateRotation,Vector3 shift,float targetYaw)
            {
                Vector3 center=candidate+candidateRotation*new Vector3(hull.OffsetX,0,hull.OffsetZ);
                Vector3 local=Quaternion.Inverse(candidateRotation)*(new Vector3(wetTarget.x,center.y,wetTarget.y)-center);
                bool containsTarget=Mathf.Abs(local.x)<=hull.Width*.5f&&Mathf.Abs(local.z)<=hull.Length*.5f;
                var threat=NominalWetThreat(p,relief,ground,hull,candidate,candidateRotation);
                // Water threat takes precedence over any scope clip in this
                // same nominal pose; such a case must run the actual guard.
                if(containsTarget||threat!=null)
                    return new JObject{["eligible"]=true,["actualEscapeAttempt"]=false,["testPassed"]=false,["checkedFrames"]=frame+1,
                        ["nominalHullReachedWetTarget"]=containsTarget,["wetThreatReachedBeforeClip"]=true,["nominalWetThreat"]=threat,
                        ["maxYawRequest"]=maxStep,["localPivot"]=VectorReceipt(hull.LocalPivot)};
                var corners=SceneClippedCorners(p,candidate,candidateRotation,hull);if(corners.Count==0)return null;
                return new JObject{["eligible"]=false,["actualEscapeAttempt"]=false,["testPassed"]=false,
                    ["reason"]=turning?"SCENE_STEERING_OR_APPROACH_CLIPPED":"SCENE_LATERAL_APPROACH_CLIPPED",["frame"]=frame,["phase"]=phase,
                    ["position"]=VectorReceipt(candidate),["yaw"]=candidateRotation.eulerAngles.y,["targetYaw"]=targetYaw,
                    ["pivot"]=VectorReceipt(shift),["localPivot"]=VectorReceipt(hull.LocalPivot),["outsideSceneCorners"]=corners,
                    ["sceneHalfWidth"]=p.width/2,["sceneHalfDepth"]=p.depth/2,["maxYawRequest"]=maxStep,
                    ["wetThreatReachedBeforeClip"]=false,["nominalHullReachedWetTarget"]=false,["nativeWetPerimeterChecked"]=true,
                    ["wetTarget"]=new JArray(wetTarget.x,wetTarget.y),
                    ["driverGround"]=GroundReceipt(p,relief,ground,new Vector2(candidate.x,candidate.z))};
            }
            for(int frame=0;frame<220;frame++)
            {
                float targetYaw=Mathf.Atan2(side.x,side.y)*Mathf.Rad2Deg;
                if(!turning||frame<20)
                {
                    feet+=new Vector3(side.x,0,side.y)*.12f;
                    var stage=Clip(frame,turning?"LATERAL_STAGE":"LATERAL_TARGET_APPROACH",feet,rotation,Vector3.zero,targetYaw);if(stage!=null)return stage;
                }
                else
                {
                    targetYaw=Mathf.Atan2(wetTarget.x-feet.x,wetTarget.y-feet.z)*Mathf.Rad2Deg;
                    float requestedYaw=Mathf.MoveTowardsAngle(yaw,targetYaw,maxStep),delta=Mathf.DeltaAngle(yaw,requestedYaw);
                    Vector3 oldFeet=feet;Quaternion oldRotation=rotation;
                    // Check endpoints and exact X/Z extrema of every corner's
                    // circular arc about the native axle; 2deg endpoint samples
                    // alone would miss an extremum between them.
                    foreach(float x in new[]{-hull.Width*.5f,hull.Width*.5f})foreach(float z in new[]{-hull.Length*.5f,hull.Length*.5f})
                    {
                        Vector3 relative=new Vector3(hull.OffsetX+x,0,hull.OffsetZ+z)-hull.LocalPivot;
                        foreach(float critical in new[]{Mathf.Atan2(relative.z,relative.x)*Mathf.Rad2Deg,
                            Mathf.Atan2(-relative.x,relative.z)*Mathf.Rad2Deg})foreach(float opposite in new[]{0f,180f})
                        {
                            float angle=critical+opposite,offset=Mathf.DeltaAngle(yaw,angle);
                            if(delta>=0?offset<0||offset>delta:offset>0||offset<delta)continue;
                            Quaternion arcRotation=Quaternion.Euler(0,angle,0);Vector3 arcShift=oldRotation*hull.LocalPivot-arcRotation*hull.LocalPivot;arcShift.y=0;
                            var arc=Clip(frame,"STATIONARY_AXLE_SWEEP_EXTREMUM",oldFeet+arcShift,arcRotation,arcShift,targetYaw);if(arc!=null)return arc;
                        }
                    }
                    rotation=Quaternion.Euler(0,requestedYaw,0);Vector3 pivot=oldRotation*hull.LocalPivot-rotation*hull.LocalPivot;pivot.y=0;
                    feet=oldFeet+pivot;yaw=Mathf.Repeat(requestedYaw,360);
                    var turn=Clip(frame,"STATIONARY_AXLE_SWEEP",feet,rotation,pivot,targetYaw);if(turn!=null)return turn;
                    if(Mathf.Abs(Mathf.DeltaAngle(yaw,targetYaw))<1)
                    {
                        feet+=rotation*Vector3.forward*.12f;
                        var approach=Clip(frame,"TURN_TARGET_APPROACH",feet,rotation,pivot,targetYaw);if(approach!=null)return approach;
                    }
                }
                Vector3 center=feet+rotation*new Vector3(hull.OffsetX,0,hull.OffsetZ);
                Vector3 local=Quaternion.Inverse(rotation)*(new Vector3(wetTarget.x,center.y,wetTarget.y)-center);
                if(Mathf.Abs(local.x)<=hull.Width*.5f&&Mathf.Abs(local.z)<=hull.Length*.5f)
                    return new JObject{["eligible"]=true,["actualEscapeAttempt"]=false,["testPassed"]=false,["checkedFrames"]=frame+1,
                        ["nominalHullReachedWetTarget"]=true,["maxYawRequest"]=maxStep,["localPivot"]=VectorReceipt(hull.LocalPivot)};
            }
            return new JObject{["eligible"]=true,["actualEscapeAttempt"]=false,["testPassed"]=false,["checkedFrames"]=220,
                ["nominalHullReachedWetTarget"]=false,["maxYawRequest"]=maxStep,["localPivot"]=VectorReceipt(hull.LocalPivot)};
        }

        private static JObject NominalWetThreat(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Collider ground,
            RoaVehicleCatalog.Hull hull,Vector3 feet,Quaternion rotation)
        {
            int rows=Mathf.CeilToInt(hull.Length/.5f),columns=Mathf.CeilToInt(hull.Width/.5f);
            for(int i=0;i<=rows;i++)for(int j=0;j<=columns;j++)
            {
                if(i!=0&&i!=rows&&j!=0&&j!=columns)continue;
                Vector3 point=feet+rotation*new Vector3(hull.OffsetX-hull.Width*.5f+hull.Width*j/columns,0,
                    hull.OffsetZ-hull.Length*.5f+hull.Length*i/rows);
                if(RoaSectorSurface.BridgeAt(p,point.x,point.z)!=null||!NativeWet(p,relief,ground,new Vector2(point.x,point.z)))continue;
                return new JObject{["kind"]="HULL_PERIMETER",["point"]=VectorReceipt(point),
                    ["ground"]=GroundReceipt(p,relief,ground,new Vector2(point.x,point.z))};
            }
            if(RoaSectorSurface.BridgeAt(p,feet.x,feet.z,RoaPlayerController.AuthoritativeCollisionRadius)==null
                &&NativeWet(p,relief,ground,new Vector2(feet.x,feet.z)))
                return new JObject{["kind"]="DRIVER_CAPSULE",["point"]=VectorReceipt(feet),
                    ["ground"]=GroundReceipt(p,relief,ground,new Vector2(feet.x,feet.z))};
            return null;
        }

        private static JObject ActualDeckReceipt(RoaSectorSurface.Profile p,Dictionary<string,MeshCollider> decks,Vector2 point)
        {
            var route=RoaSectorSurface.BridgeAt(p,point.x,point.y);
            if(route==null||!decks.TryGetValue(route.id,out var deck)
                ||!deck.Raycast(new Ray(new Vector3(point.x,1000,point.y),Vector3.down),out RaycastHit hit,2000))return null;
            var water=RoaSectorSurface.WaterAt(p,point.x,point.y);float expected=RoaSectorSurface.BridgeHeight(route,point.x,point.y);
            if(Mathf.Abs(hit.point.y-expected)>.001f||hit.normal.y<=HullConstant("HullWalkableNormalY")
                ||hit.point.y<water.Height+.02f*p.gain/160)return null;
            return new JObject{["bridge"]=route.id,["collider"]=deck.name,["meshAsset"]=AssetDatabase.GetAssetPath(deck.sharedMesh),
                ["height"]=hit.point.y,["sourceHeight"]=expected,["normal"]=VectorReceipt(hit.normal),["savedIdentityChain"]=true};
        }

        private static JObject PoseEligibility(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Collider ground,
            Dictionary<string,MeshCollider> decks,RoaVehicleCatalog.Hull hull,Vector3 feet,Quaternion rotation,
            int stationIndex,Vector2 station,Vector2 wetTarget)
        {
            var clipped=new JArray();
            foreach(float x in new[]{-hull.Width*.5f,hull.Width*.5f})foreach(float z in new[]{-hull.Length*.5f,hull.Length*.5f})
            {
                Vector3 corner=feet+rotation*new Vector3(hull.OffsetX+x,0,hull.OffsetZ+z);
                if(Mathf.Abs(corner.x)>p.width/2-.1f||Mathf.Abs(corner.z)>p.depth/2-.1f)clipped.Add(VectorReceipt(corner));
            }
            var driver=new Vector2(feet.x,feet.z);var driverGround=GroundReceipt(p,relief,ground,driver);
            var driverDeck=ActualDeckReceipt(p,decks,driver);var wetOutsideDeck=new JArray();
            if(clipped.Count==0)
            {
                int rows=Mathf.CeilToInt(hull.Length/.5f),columns=Mathf.CeilToInt(hull.Width/.5f);
                for(int i=0;i<=rows;i++)for(int j=0;j<=columns;j++)
                {
                    if(i!=0&&i!=rows&&j!=0&&j!=columns)continue;
                    Vector3 point=feet+rotation*new Vector3(hull.OffsetX-hull.Width*.5f+hull.Width*j/columns,0,
                        hull.OffsetZ-hull.Length*.5f+hull.Length*i/rows);
                    var xz=new Vector2(point.x,point.z);
                    if(NativeWet(p,relief,ground,xz)&&ActualDeckReceipt(p,decks,xz)==null)wetOutsideDeck.Add(GroundReceipt(p,relief,ground,xz));
                }
            }
            string reason=clipped.Count>0?"SCENE_FOOTPRINT_CLIPPED"
                :driverGround.Value<bool>("nativeWet")&&driverDeck==null?"NATIVE_WET_DRIVER_WITHOUT_ACTUAL_DECK"
                :wetOutsideDeck.Count>0?"NATIVE_WET_BODY_WITHOUT_ACTUAL_DECK":null;
            return new JObject{["stationIndex"]=stationIndex,["station"]=new JArray(station.x,station.y),
                ["wetTarget"]=new JArray(wetTarget.x,wetTarget.y),["feet"]=VectorReceipt(feet),["yaw"]=rotation.eulerAngles.y,
                ["eligible"]=reason==null,["reason"]=reason,["outsideSceneCorners"]=clipped,["sceneHalfWidth"]=p.width/2,["sceneHalfDepth"]=p.depth/2,
                ["driverGround"]=driverGround,["actualDriverDeck"]=driverDeck,["nativeWetBodyWithoutActualDeck"]=wetOutsideDeck};
        }

        private static bool NativeWet(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Collider ground,Vector2 point)
        {
            if(Mathf.Abs(point.x)>p.width/2||Mathf.Abs(point.y)>p.depth/2)return false;
            var water=RoaSectorSurface.WaterAt(p,point.x,point.y);
            if(!(water.Inside||water.Distance<=.00001f))return false;
            float threshold=water.Height+.02f*p.gain/160;
            if(RoaSectorSurface.Height(p,relief,point.x,point.y)>=threshold)return false;
            return ground.Raycast(new Ray(new Vector3(point.x,1000,point.y),Vector3.down),out RaycastHit hit,2000)
                &&hit.point.y<threshold;
        }

        private static bool InsideScene(RoaSectorSurface.Profile p,Vector3 feet,Quaternion rotation,RoaVehicleCatalog.Hull hull)
        {
            foreach(float x in new[]{-hull.Width*.5f,hull.Width*.5f})foreach(float z in new[]{-hull.Length*.5f,hull.Length*.5f})
            {
                Vector3 corner=feet+rotation*new Vector3(hull.OffsetX+x,0,hull.OffsetZ+z);
                if(Mathf.Abs(corner.x)>p.width/2-.1f||Mathf.Abs(corner.z)>p.depth/2-.1f)return false;
            }
            return true;
        }

        private static object Escape(RoaSectorSurface.Profile p,RoaSectorSurface.Route bridge,JObject vehicle,
            RoaVehicleCatalog.Hull hull,MeshCollider parapet,Collider ground,RoaGlobalMapRelief relief,
            Vector3 feet,Quaternion rotation,Vector2 side,Vector2 station,Vector2 wetTarget,float witness,float heading,float sign,bool turning,
            JObject startEligibility,object poseSelection)
        {
            var walker=new GameObject("ActualVehicleWaterEscape");walker.transform.position=feet+Vector3.up*1.05f;walker.transform.rotation=rotation;
            var body=walker.AddComponent<CharacterController>();body.height=RoaGameBootstrap.PlayerHeight;body.center=Vector3.zero;
            var player=walker.AddComponent<RoaPlayerController>();Awake.Invoke(player,null);
            player.ApplyVehicleState(new JObject{["itemId"]=vehicle["itemId"],["speed"]=vehicle["tiers"][0]["speed"],["hull"]=vehicle["hull"].DeepClone()});
            string label=p.locationId+"/"+bridge.id+"/"+vehicle["itemId"]+"/"+(turning?"turn":"lateral")+"/side"+sign+"/heading"+heading+"/overhang"+witness;
            try
            {
                for(int i=0;i<20;i++)body.Move(Vector3.down*.04f);
                Physics.SyncTransforms();
                float initial=(float)Penetration.Invoke(player,new object[]{walker.transform.position,walker.transform.rotation,Vector3.zero});
                if(initial>.08f)throw new InvalidOperationException("Water guard initial hull overlaps: "+label+", depth "+initial);
                bool contact=false,hullContact=false,controllerContact=false,nativeBlockerContact=false,blocked=false;
                int turnCuts=0,turnRequests=0,controllerSidesFrames=0;
                float lastInputStep=0,lastRequestedStep=0,lastActualStep=0;
                JObject nativeBlockerReceipt=null,lastRejection=null,nativeTurnReceipt=null,lastTurnRejection=null;
                Vector3 start=walker.transform.position;float targetYaw=Mathf.Atan2(side.x,side.y)*Mathf.Rad2Deg;
                float closestDriverDistance=float.PositiveInfinity,closestFootprintDistance=float.PositiveInfinity;
                var bodyActualTrajectory=new JArray();
                var hullProbe=(BoxCollider)Probe.GetValue(player);
                for(int frame=0;frame<220;frame++)
                {
                    Vector3 framePosition=walker.transform.position;Quaternion frameRotation=walker.transform.rotation;
                    Vector3 pivot=Vector3.zero,motionDirection=new Vector3(side.x,0,side.y);bool throttle=true;
                    if(turning&&frame>=20)
                    {
                        Quaternion oldRotation=walker.transform.rotation;float oldYaw=oldRotation.eulerAngles.y;
                        // An overhang witness starts the driver away from the
                        // selected wet station. After turning, a constant side
                        // vector can run parallel to that wet target on dry land.
                        // Steer the real axle toward the immutable native target.
                        Vector2 targetDirection=wetTarget-new Vector2(walker.transform.position.x,walker.transform.position.z);
                        targetYaw=Mathf.Atan2(targetDirection.x,targetDirection.y)*Mathf.Rad2Deg;
                        float yaw=Mathf.MoveTowardsAngle(oldYaw,targetYaw,Mathf.Min(2f,vehicle.Value<float>("turnStillDeg")*.02f));
                        Quaternion requested=Quaternion.Euler(0,yaw,0);
                        Vector3 requestedShift=oldRotation*hull.LocalPivot-requested*hull.LocalPivot;requestedShift.y=0;
                        hullContact|=ParapetPenetration(hullProbe,hull,body,walker.transform.position+requestedShift,requested,parapet);
                        Pivot.SetValue(player,Vector3.zero);SetYaw.Invoke(player,new object[]{yaw});
                        float requestedYaw=(float)Yaw.GetValue(player);
                        if((bool)Turn.Invoke(player,new object[]{oldYaw,oldRotation}))
                        {
                            turnCuts++;blocked=true;
                            lastTurnRejection=ObserveTurnRejection(player,hullProbe,hull,body,ground,p,relief,
                                oldYaw,oldRotation,requestedYaw,wetTarget,frame);
                            if(lastTurnRejection.Value<bool>("causalNativeBlocker"))
                            {nativeBlockerContact=true;if(nativeTurnReceipt==null)nativeTurnReceipt=lastTurnRejection;}
                        }
                        turnRequests++;pivot=(Vector3)Pivot.GetValue(player);motionDirection=walker.transform.forward;
                        // Steer at rest around the actual axle, then drive
                        // outward. This avoids driving along a clipped edge
                        // while waiting for the ninety-degree turn to finish.
                        throttle=Mathf.Abs(Mathf.DeltaAngle(walker.transform.eulerAngles.y,targetYaw))<1;
                    }
                    var castArgs=new object[]{walker.transform.position+pivot,walker.transform.rotation,motionDirection,.16f,default(RaycastHit)};
                    if((bool)Cast.Invoke(player,castArgs)&&((RaycastHit)castArgs[4]).collider==parapet)hullContact=true;
                    Vector3 input=throttle?motionDirection*.12f:Vector3.zero;
                    // ReadInputAndMove resets these observations immediately before
                    // ResolveHullMotion. Do the same so a receipt cannot be stale.
                    Colliding.SetValue(player,false);CollisionNormal.SetValue(player,Vector3.zero);CollisionPressure.SetValue(player,0f);
                    Vector3 motion=(Vector3)Resolve.Invoke(player,new object[]{input,pivot});
                    lastInputStep=new Vector2(input.x,input.z).magnitude;
                    if(throttle&&new Vector2(motion.x-pivot.x,motion.z-pivot.z).magnitude<.06f)
                    {
                        lastRejection=ObserveHullRejection(player,hullProbe,hull,body,ground,p,relief,input,pivot,motion,wetTarget,frame);
                        if(lastRejection.Value<bool>("causalNativeBlocker"))
                        {nativeBlockerContact=true;if(nativeBlockerReceipt==null)nativeBlockerReceipt=lastRejection;}
                    }
                    if(throttle)blocked|=new Vector2(motion.x-pivot.x,motion.z-pivot.z).magnitude<.06f;
                    motion.y=-.04f;Vector3 before=walker.transform.position;
                    CollisionFlags flags=body.Move(motion);Physics.SyncTransforms();
                    lastRequestedStep=new Vector2(motion.x,motion.z).magnitude;
                    Vector3 actual=walker.transform.position-before;lastActualStep=new Vector2(actual.x,actual.z).magnitude;
                    float driverDistance=Vector2.Distance(new Vector2(walker.transform.position.x,walker.transform.position.z),wetTarget),
                        footprintDistance=FootprintTargetDistance(walker,body,hull,wetTarget);
                    closestDriverDistance=Mathf.Min(closestDriverDistance,driverDistance);
                    closestFootprintDistance=Mathf.Min(closestFootprintDistance,footprintDistance);
                    bodyActualTrajectory.Add(new JArray(frame,walker.transform.position.x,walker.transform.position.y,walker.transform.position.z,
                        (float)Yaw.GetValue(player),targetYaw,throttle,input.x,input.z,actual.x,actual.z,driverDistance,footprintDistance));
                    if((flags&CollisionFlags.Sides)!=0)controllerSidesFrames++;
                    // A motorcycle's hull is narrower than the driver's native
                    // capsule. Observe the real CC rejection as well as the box
                    // resolver; only a matching saved parapet hit qualifies.
                    if(throttle&&lastRequestedStep>=.06f&&lastActualStep<.06f&&(flags&CollisionFlags.Sides)!=0
                        &&ControllerParapetContact(body,before,walker.transform.rotation,motion,parapet))
                    {controllerContact=true;blocked=true;}
                    contact=hullContact||controllerContact||nativeBlockerContact;
                    AssertDryFootprint(p,relief,ground,walker,body,hull,label,frame,framePosition,frameRotation);
                    if(!InsideScene(p,walker.transform.position-Vector3.up*body.height*.5f,walker.transform.rotation,hull))
                        throw new InvalidOperationException("Water escape attempt left captured scene: "+label+", reached "+walker.transform.position);
                }
                if(!contact||!blocked||turning&&turnRequests==0)
                    throw new InvalidOperationException("Native water escape lacked causal actual rejection: "+label+", hullContact "+hullContact
                        +", controllerContact "+controllerContact+", nativeBlockerContact "+nativeBlockerContact+", blocked "+blocked
                        +", input/requested/actual "+lastInputStep+"/"+lastRequestedStep+"/"+lastActualStep+", reached "+walker.transform.position
                        +", resolverReceipt "+lastRejection?.ToString(Newtonsoft.Json.Formatting.None)
                        +", turnReceipt "+lastTurnRejection?.ToString(Newtonsoft.Json.Formatting.None)
                        +", targetAttempt "+new JObject{["wetTarget"]=new JArray(wetTarget.x,wetTarget.y),["currentTargetYaw"]=targetYaw,
                            ["closestDriverDistance"]=closestDriverDistance,["closestFootprintDistance"]=closestFootprintDistance,
                            ["bodyActualTrajectory"]=bodyActualTrajectory}.ToString(Newtonsoft.Json.Formatting.None));
                Debug.Log("[VEHICLE WATER GUARD] PASS "+label+", cuts "+turnCuts+", reached "+walker.transform.position);
                Vector3 reached=walker.transform.position;
                return new{bridge=bridge.id,vehicle=vehicle.Value<string>("itemId"),mode=turning?"turn":"lateral",sign,heading,witness,
                    station=new[]{station.x,station.y},wetTarget=new[]{wetTarget.x,wetTarget.y},start=new[]{start.x,start.y,start.z},reached=new[]{reached.x,reached.y,reached.z},
                    actualSideContact=hullContact||controllerContact,actualNativeRejection=contact,
                    hullSideContact=hullContact,controllerSideContact=controllerContact,controllerSidesFrames,
                    nativeBlockerContact,nativeBlockerReceipt,nativeTurnReceipt,lastInputStep,lastRequestedStep,lastActualStep,blocked,turnRequests,turnCuts,
                    currentTargetYaw=targetYaw,closestDriverDistance,closestFootprintDistance,
                    trajectoryColumns=new[]{"frame","driverX","driverY","driverZ","actualYaw","targetYaw","throttle","inputX","inputZ","actualDeltaX","actualDeltaZ","driverTargetDistance","footprintTargetDistance"},
                    bodyActualTrajectory,
                    startEligibility,poseSelection,sourceWetTarget=true,groundCollider=ground.name,sideCollider=parapet.name};
            }
            finally{Object.DestroyImmediate(walker);}
        }

        private static float FootprintTargetDistance(GameObject walker,CharacterController body,RoaVehicleCatalog.Hull hull,Vector2 target)
        {
            Vector3 feet=walker.transform.position-Vector3.up*body.height*.5f;
            Vector3 center=feet+walker.transform.rotation*new Vector3(hull.OffsetX,0,hull.OffsetZ);
            Vector3 local=Quaternion.Inverse(walker.transform.rotation)*(new Vector3(target.x,center.y,target.y)-center);
            return new Vector2(Mathf.Max(Mathf.Abs(local.x)-hull.Width*.5f,0),Mathf.Max(Mathf.Abs(local.z)-hull.Length*.5f,0)).magnitude;
        }

        private static float HullConstant(string name)=>(float)typeof(RoaPlayerController)
            .GetField(name,BindingFlags.Static|BindingFlags.NonPublic).GetRawConstantValue();

        private static JArray VectorReceipt(Vector3 value)=>new JArray(value.x,value.y,value.z);

        private static bool SavedNativeCollider(RoaPlayerController player,Collider collider,Collider ground)
        {
            return collider!=null&&collider.enabled&&!collider.isTrigger&&collider.gameObject.activeInHierarchy
                &&collider.gameObject.scene==ground.gameObject.scene&&!string.IsNullOrEmpty(collider.gameObject.scene.path)
                &&!(bool)OwnContact.Invoke(player,new object[]{collider})
                &&(!(collider is MeshCollider mesh)||(mesh.sharedMesh!=null&&AssetDatabase.Contains(mesh.sharedMesh)));
        }

        private static JObject ColliderReceipt(Collider collider)
        {
            string path=collider.name;for(var parent=collider.transform.parent;parent!=null;parent=parent.parent)path=parent.name+"/"+path;
            return new JObject{["name"]=collider.name,["hierarchy"]=path,["type"]=collider.GetType().Name,
                ["scene"]=collider.gameObject.scene.path,["boundsMin"]=VectorReceipt(collider.bounds.min),
                ["boundsMax"]=VectorReceipt(collider.bounds.max),
                ["meshAsset"]=collider is MeshCollider mesh?AssetDatabase.GetAssetPath(mesh.sharedMesh):""};
        }

        private static JArray NativePenetrations(RoaPlayerController player,BoxCollider probe,RoaVehicleCatalog.Hull hull,
            CharacterController body,Collider ground,Vector3 position,Quaternion rotation,out float maxDepth)
        {
            var result=new JArray();maxDepth=0;
            Vector3 center=position-Vector3.up*body.height*.5f+rotation*hull.LocalCenter;
            int mask=(int)typeof(RoaPlayerController).GetProperty("HullMask",BindingFlags.Static|BindingFlags.NonPublic).GetValue(null);
            foreach(var collider in Physics.OverlapBox(center,hull.HalfExtents,rotation,mask,QueryTriggerInteraction.Ignore))
            {
                if(!SavedNativeCollider(player,collider,ground))continue;
                if(!Physics.ComputePenetration(probe,center,rotation,collider,collider.transform.position,collider.transform.rotation,
                    out Vector3 push,out float depth)||Mathf.Abs(push.y)>HullConstant("HullWalkableNormalY")
                    ||new Vector2(push.x,push.z).sqrMagnitude<.000001f)continue;
                maxDepth=Mathf.Max(maxDepth,depth);var receipt=ColliderReceipt(collider);
                receipt["depth"]=depth;receipt["direction"]=VectorReceipt(push);result.Add(receipt);
            }
            return result;
        }

        private static JObject GroundReceipt(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Collider ground,Vector2 point)
        {
            var water=RoaSectorSurface.WaterAt(p,point.x,point.y);
            bool hit=ground.Raycast(new Ray(new Vector3(point.x,1000,point.y),Vector3.down),out RaycastHit actual,2000);
            return new JObject{["point"]=new JArray(point.x,point.y),["waterInside"]=water.Inside,["waterDistance"]=water.Distance,
                ["waterHeight"]=water.Height,["sourceGroundHeight"]=RoaSectorSurface.Height(p,relief,point.x,point.y),
                ["actualGroundHit"]=hit,["actualGroundHeight"]=hit?new JValue(actual.point.y):JValue.CreateNull(),
                ["bridge"]=RoaSectorSurface.BridgeAt(p,point.x,point.y)?.id,
                ["nativeWet"]=NativeWet(p,relief,ground,point)};
        }

        private static JObject ObserveTurnRejection(RoaPlayerController player,BoxCollider probe,RoaVehicleCatalog.Hull hull,
            CharacterController body,Collider ground,RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,
            float oldYaw,Quaternion oldRotation,float requestedYaw,Vector2 wetTarget,int frame)
        {
            // GuardHullTurn has already run. Query its same candidate poses with
            // the production penetration/depth predicate and verify the result
            // against the yaw and axle shift that it actually accepted.
            Vector3 position=player.transform.position,actualPivot=(Vector3)Pivot.GetValue(player);
            float actualYaw=(float)Yaw.GetValue(player);
            float before=(float)Penetration.Invoke(player,new object[]{position,oldRotation,Vector3.zero});
            var candidates=new JArray();bool fullRejected=false,allRejectedProven=true;
            float acceptedFraction=0;
            float expectedYaw=oldYaw;Vector3 expectedPivot=Vector3.zero;
            foreach(float fraction in (float[])TurnFractions.GetValue(null))
            {
                float yaw=Mathf.LerpAngle(oldYaw,requestedYaw,fraction);Quaternion rotation=Quaternion.Euler(0,yaw,0);
                Vector3 shift=oldRotation*hull.LocalPivot-rotation*hull.LocalPivot;shift.y=0;
                float depth=(float)Penetration.Invoke(player,new object[]{position+shift,rotation,Vector3.zero});
                bool allowed=(bool)DepthAllowed.Invoke(null,new object[]{before,depth});
                var receipt=new JObject{["fraction"]=fraction,["yaw"]=yaw,["pivot"]=VectorReceipt(shift),
                    ["depth"]=depth,["depthAllowed"]=allowed};
                if(!allowed)
                {
                    var contacts=NativePenetrations(player,probe,hull,body,ground,position+shift,rotation,out float nativeDepth);
                    bool proven=contacts.Count>0&&depth>HullConstant("HullContactDepth")&&Mathf.Abs(nativeDepth-depth)<.0001f;
                    receipt["contacts"]=contacts;receipt["nativeDepthMatches"]=proven;allRejectedProven&=proven;
                    if(fraction==1)fullRejected=true;
                }
                candidates.Add(receipt);
                if(allowed){acceptedFraction=fraction;expectedYaw=yaw;expectedPivot=shift;break;}
            }
            bool matches=Mathf.Abs(Mathf.DeltaAngle(actualYaw,expectedYaw))<.0001f
                &&(actualPivot-expectedPivot).sqrMagnitude<.00000001f;
            bool provenCause=fullRejected&&allRejectedProven&&matches&&Mathf.Abs(Mathf.DeltaAngle(oldYaw,requestedYaw))>=.00001f;
            return new JObject{["frame"]=frame,["causalNativeBlocker"]=provenCause,
                ["rejectionKind"]=provenCause?"GuardHullTurn.HullDepthAllowed":"UNPROVEN",
                ["oldYaw"]=oldYaw,["requestedYaw"]=requestedYaw,["actualYaw"]=actualYaw,["acceptedFraction"]=acceptedFraction,
                ["actualPivot"]=VectorReceipt(actualPivot),["acceptedPoseMatches"]=matches,["depthBefore"]=before,
                ["candidates"]=candidates,["position"]=VectorReceipt(position),
                ["driverGround"]=GroundReceipt(p,relief,ground,new Vector2(position.x,position.z)),
                ["wetTargetGround"]=GroundReceipt(p,relief,ground,wetTarget)};
        }

        // This observes the production methods at the rejected pose. A zero
        // displacement alone cannot pass: it needs a persisted native collider
        // and the actual resolver's fresh collision flag, plus its exact branch.
        private static JObject ObserveHullRejection(RoaPlayerController player,BoxCollider probe,RoaVehicleCatalog.Hull hull,
            CharacterController body,Collider ground,RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,
            Vector3 input,Vector3 pivot,Vector3 resolved,Vector2 wetTarget,int frame)
        {
            Vector3 position=player.transform.position+pivot;Quaternion rotation=player.transform.rotation;
            bool colliding=player.Colliding;Vector3 normal=player.CollisionNormal;
            var beforeArgs=new object[]{position,rotation,Vector3.zero};float before=(float)Penetration.Invoke(player,beforeArgs);
            Vector3 push=before>HullConstant("HullContactDepth")*2
                ?Vector3.ClampMagnitude((Vector3)beforeArgs[2],HullConstant("HullMaxPushPerFrame")):Vector3.zero;
            var castArgs=new object[]{position+push,rotation,input.normalized,input.magnitude+HullConstant("HullSkin"),default(RaycastHit)};
            bool cast=(bool)Cast.Invoke(player,castArgs);RaycastHit first=(RaycastHit)castArgs[4];
            float after=(float)Penetration.Invoke(player,new object[]{position+push+input,rotation,Vector3.zero});
            bool depthAllowed=(bool)DepthAllowed.Invoke(null,new object[]{before,after});
            JArray beforeContacts=NativePenetrations(player,probe,hull,body,ground,position,rotation,out float nativeBefore),
                afterContacts=NativePenetrations(player,probe,hull,body,ground,position+push+input,rotation,out float nativeAfter);
            bool castCause=colliding&&cast&&SavedNativeCollider(player,first.collider,ground)
                &&Mathf.Max(0,first.distance-HullConstant("HullSkin"))<.06f
                &&Vector3.Dot(new Vector3(first.normal.x,0,first.normal.z).normalized,normal)>.999f;
            bool depthCause=colliding&&!cast&&before>HullConstant("HullContactDepth")&&!depthAllowed
                &&(resolved-pivot-push).sqrMagnitude<.00000001f&&beforeContacts.Count>0&&afterContacts.Count>0
                &&Mathf.Abs(nativeBefore-before)<.0001f&&Mathf.Abs(nativeAfter-after)<.0001f;
            JObject hitReceipt=cast&&SavedNativeCollider(player,first.collider,ground)?ColliderReceipt(first.collider):null;
            if(hitReceipt!=null){hitReceipt["point"]=VectorReceipt(first.point);hitReceipt["normal"]=VectorReceipt(first.normal);hitReceipt["distance"]=first.distance;}
            return new JObject{["frame"]=frame,["causalNativeBlocker"]=castCause||depthCause,
                ["rejectionKind"]=castCause?"CastHull":depthCause?"HullDepthAllowed":"UNPROVEN",
                ["sourceColliding"]=colliding,["sourceCollisionNormal"]=VectorReceipt(normal),["position"]=VectorReceipt(position),
                ["input"]=VectorReceipt(input),["resolved"]=VectorReceipt(resolved),["nativePush"]=VectorReceipt(push),
                ["depthBefore"]=before,["attemptedDepthAfter"]=after,["attemptedDepthAllowed"]=depthAllowed,
                ["firstCastHit"]=hitReceipt,["beforeContacts"]=beforeContacts,["attemptedContacts"]=afterContacts,
                ["driverGround"]=GroundReceipt(p,relief,ground,new Vector2(position.x,position.z)),
                ["wetTargetGround"]=GroundReceipt(p,relief,ground,wetTarget)};
        }

        private static bool ParapetPenetration(BoxCollider probe,RoaVehicleCatalog.Hull hull,CharacterController body,
            Vector3 position,Quaternion rotation,Collider parapet)
        {
            Vector3 center=position-Vector3.up*body.height*.5f+rotation*hull.LocalCenter;
            return Physics.ComputePenetration(probe,center,rotation,parapet,parapet.transform.position,parapet.transform.rotation,
                out Vector3 push,out float depth)&&Mathf.Abs(push.y)<=.6f&&depth>0;
        }

        private static bool ControllerParapetContact(CharacterController body,Vector3 position,Quaternion rotation,Vector3 motion,Collider parapet)
        {
            Vector3 center=position+rotation*body.center;
            float halfLine=Mathf.Max(0,body.height*.5f-body.radius);
            foreach(var hit in Physics.CapsuleCastAll(center+Vector3.up*halfLine,center-Vector3.up*halfLine,body.radius,
                motion.normalized,motion.magnitude+body.skinWidth,Physics.DefaultRaycastLayers,QueryTriggerInteraction.Ignore))
                if(hit.collider==parapet&&Mathf.Abs(hit.normal.y)<=.6f)return true;
            return false;
        }

        private static void AssertDryFootprint(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Collider ground,
            GameObject walker,CharacterController body,RoaVehicleCatalog.Hull hull,string label,int frame,Vector3 previousPosition,Quaternion previousRotation)
        {
            Vector3 feet=walker.transform.position-Vector3.up*body.height*.5f;
            // Sample the complete rectangular perimeter at <=.5m spacing.
            int rows=Mathf.CeilToInt(hull.Length/.5f),columns=Mathf.CeilToInt(hull.Width/.5f);
            for(int i=0;i<=rows;i++)for(int j=0;j<=columns;j++)
            {
                if(i!=0&&i!=rows&&j!=0&&j!=columns)continue;
                Vector3 point=feet+walker.transform.rotation*new Vector3(hull.OffsetX-hull.Width*.5f+hull.Width*j/columns,0,
                    hull.OffsetZ-hull.Length*.5f+hull.Length*i/rows);
                if(RoaSectorSurface.BridgeAt(p,point.x,point.z)!=null)continue;
                if(NativeWet(p,relief,ground,new Vector2(point.x,point.z)))
                    throw new InvalidOperationException("Actual vehicle hull escaped into native water: "+label+", footprint "+point+", driver "+walker.transform.position
                        +", escapeReceipt "+WetEscapeReceipt(p,relief,ground,walker,body,hull,point,frame,previousPosition,previousRotation).ToString(Newtonsoft.Json.Formatting.None));
            }
            if(RoaSectorSurface.BridgeAt(p,feet.x,feet.z,body.radius)==null&&NativeWet(p,relief,ground,new Vector2(feet.x,feet.z)))
                throw new InvalidOperationException("Actual driver entered native water: "+label+", feet "+feet);
        }

        private static JObject WetEscapeReceipt(RoaSectorSurface.Profile p,RoaGlobalMapRelief relief,Collider ground,
            GameObject walker,CharacterController body,RoaVehicleCatalog.Hull hull,Vector3 point,int frame,
            Vector3 previousPosition,Quaternion previousRotation)
        {
            var player=walker.GetComponent<RoaPlayerController>();var probe=(BoxCollider)Probe.GetValue(player);
            Vector3 feet=walker.transform.position-Vector3.up*body.height*.5f;
            Vector3 center=feet+walker.transform.rotation*hull.LocalCenter;var contacts=new JArray();
            foreach(var collider in Physics.OverlapBox(center,hull.HalfExtents,walker.transform.rotation,Physics.DefaultRaycastLayers,QueryTriggerInteraction.Ignore))
            {
                if(!SavedNativeCollider(player,collider,ground)||!Physics.ComputePenetration(probe,center,walker.transform.rotation,
                    collider,collider.transform.position,collider.transform.rotation,out Vector3 direction,out float depth))continue;
                var contact=ColliderReceipt(collider);contact["depth"]=depth;contact["direction"]=VectorReceipt(direction);
                contact["ignoredAsVerticalSupport"]=Mathf.Abs(direction.y)>HullConstant("HullWalkableNormalY");contacts.Add(contact);
            }
            return new JObject{["frame"]=frame,["previousPosition"]=VectorReceipt(previousPosition),
                ["previousYaw"]=previousRotation.eulerAngles.y,["position"]=VectorReceipt(walker.transform.position),
                ["yaw"]=(float)Yaw.GetValue(player),["pivot"]=VectorReceipt((Vector3)Pivot.GetValue(player)),
                ["footprint"]=VectorReceipt(point),["hullBottom"]=feet.y+RoaVehicleCatalog.Hull.Bottom,
                ["hullTop"]=feet.y+RoaVehicleCatalog.Hull.Bottom+RoaVehicleCatalog.Hull.Height,["contacts"]=contacts,
                ["productionPenetration"]=(float)Penetration.Invoke(player,new object[]{walker.transform.position,walker.transform.rotation,Vector3.zero}),
                ["wetFootprintGround"]=GroundReceipt(p,relief,ground,new Vector2(point.x,point.z))};
        }
    }
}
