using System;
using System.Collections.Generic;
using System.Linq;
using Kromka.Authoring;
using RealmOfAshes.Game;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Small authored water reserves, separate from full-sized facility reservoirs.</summary>
    public sealed class RoaWaterCistern : MonoBehaviour
    {
        public const string ResourceKey="Kromka/SmallWaterCistern";
        public string StableObjectId;
        public Mesh UnitCube;
        public Material Concrete;
        public Vector3[] SoilContacts;
        private readonly List<Mesh> _owned=new List<Mesh>();
        public static bool Supports(LocationObject row)=>row!=null&&row.Model=="waterTank"
            &&row.Tags.Contains("zone-kit")&&row.Footprint!=null
            &&row.Footprint.X>=2.2f&&row.Footprint.X<=3.5f&&row.Footprint.Z>=1.65f&&row.Footprint.Z<=2.7f;
        public static void Ensure(LocationDefinition definition,Renderer ground)
        {
            if(definition?.Objects==null||ground==null)return;
            // The completed dam sector is the accepted reference. Its original
            // equipment is outside the ordinary-sector cistern replacement.
            if(RoaZoneReliefProjection.Supports(definition.Id))return;
            var rows=definition.Objects.Where(Supports).ToArray();if(rows.Length==0)return;
            var template=Resources.Load<GameObject>(ResourceKey);if(template==null)return;
            var owner=ground.GetComponentInParent<RoaUnityLocationScene>()?.transform??ground.transform.root;
            var markers=owner.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
            foreach(var row in rows)
            {
                var marker=markers.SingleOrDefault(m=>m.StableObjectId==row.Id&&m.gameObject.activeInHierarchy);
                if(marker==null)continue;
                foreach(var old in marker.GetComponentsInChildren<RoaWaterCistern>(true))
                {old.gameObject.SetActive(false);if(Application.isPlaying)Destroy(old.gameObject);else DestroyImmediate(old.gameObject);}
                // Preserve native assets and authority/collision components. Only their unsuitable
                // building-sized visual is replaced by an independently authored small reservoir.
                foreach(var renderer in marker.GetComponentsInChildren<MeshRenderer>(true))renderer.enabled=false;
                var cistern=Instantiate(template,marker.transform,false);
                cistern.name="SmallWaterCistern_"+row.Id;
                RoaApocalypseVisuals.SetNativeWorldScale(cistern.transform,Vector3.one);
                cistern.transform.localPosition=Vector3.zero;cistern.transform.localRotation=Quaternion.identity;
                var component=cistern.GetComponent<RoaWaterCistern>();component.StableObjectId=row.Id;
                var samples=new List<Vector3>();
                foreach(float x in new[]{-.72f,.72f})foreach(float dx in new[]{-.16f,.16f})foreach(float z in new[]{-.70f,.70f})
                {var at=cistern.transform.TransformPoint(new Vector3(x+dx,0,z));at.y=Soil(ground,at);samples.Add(at);}
                float rise=Mathf.Max(0,samples.Max(v=>v.y)-cistern.transform.position.y);
                cistern.transform.position+=Vector3.up*rise;
                component.SoilContacts=samples.ToArray();
                foreach(float x in new[]{-.72f,.72f})component.Support(ground,x);
            }
        }
        private void Support(Renderer ground,float x)
        {
            var points=new Vector3[8];
            var corners=new[]{new Vector3(x-.16f,0,-.70f),new Vector3(x+.16f,0,-.70f),new Vector3(x+.16f,0,.70f),new Vector3(x-.16f,0,.70f)};
            for(int i=0;i<4;i++)
            {
                var at=transform.TransformPoint(corners[i]);at.y=Soil(ground,at)-.035f;
                points[i]=transform.InverseTransformPoint(at);points[i+4]=corners[i]+Vector3.up*.44f;
            }
            var indices=new[]{0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7};
            var vertices=indices.Select(i=>points[i]).ToArray();
            var mesh=new Mesh{name="WaterCisternSoilSaddle_"+StableObjectId+"_"+x};
            mesh.vertices=vertices;mesh.triangles=Enumerable.Range(0,vertices.Length/3).SelectMany(i=>new[]{i*3,i*3+2,i*3+1}).ToArray();mesh.RecalculateNormals();mesh.RecalculateBounds();_owned.Add(mesh);
            var part=new GameObject("GroundedConcreteSaddle_"+x);part.transform.SetParent(transform,false);
            part.AddComponent<MeshFilter>().sharedMesh=mesh;part.AddComponent<MeshRenderer>().sharedMaterial=Concrete;
        }
        private static float Soil(Renderer ground,Vector3 at)
        {
            foreach(var collider in ground.GetComponents<Collider>())
                if(collider.enabled&&collider.Raycast(new Ray(at+Vector3.up*1000,Vector3.down),out var hit,2500))return hit.point.y;
            throw new InvalidOperationException("Missing cistern ground at "+at);
        }
        private void OnDestroy(){if(Application.isPlaying)foreach(var mesh in _owned)if(mesh!=null)Destroy(mesh);}
    }
}
