using System;
using System.Linq;
using Kromka.Authoring;
using UnityEngine;

namespace RealmOfAshes.World
{
    /// <summary>Visual well equipment beside the preserved authoritative oil controller.</summary>
    public sealed class RoaOilExtraction : MonoBehaviour
    {
        public const string ResourceKey="Kromka/FieldOilExtraction";
        public string StableObjectId;
        public string LocationId;
        public Vector3 SoilContact;
        public Mesh UnitCube;
        public Material HousingMaterial;
        public Material PanelMaterial;
        public Material TrimMaterial;
        private readonly System.Collections.Generic.List<Mesh> _ownedMeshes=new System.Collections.Generic.List<Mesh>();
        public static bool IsOilController(KromkaPlacedObjectAuthoring marker)
            =>marker!=null&&marker.GameplayTags.Contains("resource")&&marker.GameplayTags.Contains("oil");

        public static void Ensure(LocationDefinition definition,Renderer ground)
        {
            if(definition?.Objects==null||ground==null)return;
            Transform owner=ground.GetComponentInParent<RoaUnityLocationScene>()?.transform??ground.transform.root;
            if(owner==null)return;
            var rows=definition.Objects.Where(r=>r!=null&&r.Model=="oilPumpJack"&&r.ResourceType=="oil").ToArray();
            if(rows.Length==0)return;
            var template=Resources.Load<GameObject>(ResourceKey);
            if(template==null)return;
            if(template.GetComponent<RoaOilExtraction>()?.UnitCube==null)return;
            foreach(var old in owner.GetComponentsInChildren<RoaOilExtraction>(true))
                if(old.LocationId==definition.Id){old.gameObject.SetActive(false);Remove(old.gameObject);}
            var markers=owner.GetComponentsInChildren<KromkaPlacedObjectAuthoring>(true);
            foreach(var row in rows)
            {
                var marker=markers.SingleOrDefault(m=>m.StableObjectId==row.Id&&m.gameObject.activeInHierarchy);
                if(marker==null)continue;
                // An already finished full-size walking-beam pump remains its own visual reference.
                if(marker.GetComponentsInChildren<Transform>(true).Any(t=>t.name.Contains("Horsehead")||t.name.Contains("HorseHead")||t.name.Contains("WalkingBeam")))continue;
                var vertices=marker.GetComponentsInChildren<MeshFilter>(true)
                    .Where(f=>f.sharedMesh!=null&&f.GetComponent<MeshRenderer>()!=null&&f.GetComponent<MeshRenderer>().enabled&&f.gameObject.activeInHierarchy)
                    .SelectMany(f=>f.sharedMesh.vertices.Select(v=>f.transform.TransformPoint(v))).ToArray();
                if(vertices.Length==0)continue;
                float bottom=vertices.Min(v=>v.y);
                float side=vertices.Where(v=>v.y<bottom+.08f)
                    .Min(v=>(Quaternion.Inverse(marker.transform.rotation)*(v-marker.transform.position)).x);
                // Use the real support hull in the source yaw frame. The cabinet is offset
                // towards +X; its opposite side retains the compact extraction equipment.
                Quaternion rotation=marker.transform.rotation*Quaternion.Euler(0,180,0);
                Vector3 origin=marker.transform.position+marker.transform.rotation*new Vector3(side+.35f,0,0);
                // A cantilever motor mount is supported by the well casing. Its lower envelope
                // clears the actual nearby hillside without regrading or moving the controller.
                foreach(var point in new[]{new Vector3(.37f,0,-.83f),new Vector3(1.09f,0,-.83f),new Vector3(.37f,0,.03f),new Vector3(1.09f,0,.03f),new Vector3(.73f,0,.55f),new Vector3(1.04f,0,.55f)})
                    origin.y=Mathf.Max(origin.y,SoilHeight(ground,origin+rotation*point));
                var root=Instantiate(template,origin,rotation,owner);
                root.name="OilExtraction_"+row.Id;
                root.transform.localScale=Vector3.one;
                var equipment=root.GetComponent<RoaOilExtraction>()??root.AddComponent<RoaOilExtraction>();
                equipment.StableObjectId=row.Id;equipment.LocationId=definition.Id;
                Physics.SyncTransforms();
                AddSoilCasing(equipment,ground);
                AddIndustrialHousing(equipment,marker,vertices);
            }
        }
        private static void AddIndustrialHousing(RoaOilExtraction equipment,KromkaPlacedObjectAuthoring marker,Vector3[] vertices)
        {
            var points=vertices.Select(v=>Quaternion.Inverse(marker.transform.rotation)*(v-marker.transform.position)).ToArray();
            var bounds=new Bounds(points[0],Vector3.zero);foreach(var p in points)bounds.Encapsulate(p);
            float wall=.024f;
            var parts=new System.Collections.Generic.List<CombineInstance>();
            Matrix4x4 toAssembly=equipment.transform.worldToLocalMatrix*Matrix4x4.TRS(marker.transform.position,marker.transform.rotation,Vector3.one);
            void Panel(Vector3 position,Vector3 size)=>parts.Add(new CombineInstance{mesh=equipment.UnitCube,transform=toAssembly*Matrix4x4.TRS(position,Quaternion.identity,size)});
            foreach(int s in new[]{-1,1})
            {
                Panel(bounds.center+Vector3.right*s*(bounds.extents.x+wall*.5f),new Vector3(wall,bounds.size.y,bounds.size.z+wall*2));
                Panel(bounds.center+Vector3.forward*s*(bounds.extents.z+wall*.5f),new Vector3(bounds.size.x, bounds.size.y,wall));
            }
            Panel(new Vector3(bounds.center.x,bounds.max.y+wall*.5f,bounds.center.z),new Vector3(bounds.size.x+wall*2,wall,bounds.size.z+wall*2));
            var mesh=new Mesh{name="RuntimeOilHousing_"+marker.StableObjectId};mesh.CombineMeshes(parts.ToArray(),true,true);equipment._ownedMeshes.Add(mesh);
            var shell=new GameObject("IndustrialControllerHousing");shell.transform.SetParent(equipment.transform,false);
            shell.AddComponent<MeshFilter>().sharedMesh=mesh;shell.AddComponent<MeshRenderer>().sharedMaterial=equipment.HousingMaterial;
            parts.Clear();
            // Service doors, panel seams and paired cooling banks remain visible from
            // either approach. All details stay within the authoritative footprint.
            foreach(int s in new[]{-1,1})
            {
                float front=bounds.center.z+s*(bounds.extents.z+wall*1.5f);
                float doorW=bounds.size.x*.62f,doorH=bounds.size.y*.63f;
                foreach(int edge in new[]{-1,1})
                {
                    Panel(new Vector3(bounds.center.x+edge*doorW*.5f,bounds.center.y-.13f,front),new Vector3(.025f,doorH,.018f));
                    Panel(new Vector3(bounds.center.x,bounds.center.y-.13f+edge*doorH*.5f,front),new Vector3(doorW,.025f,.018f));
                }
                for(int i=0;i<7;i++)Panel(new Vector3(bounds.center.x,bounds.max.y-.40f-i*.068f,front),new Vector3(doorW*.88f,.022f,.018f));
                Panel(new Vector3(bounds.center.x+doorW*.36f,bounds.center.y-.16f,front),new Vector3(.036f,.17f,.036f));
                Panel(new Vector3(bounds.center.x,bounds.min.y+.09f,front),new Vector3(bounds.size.x,.11f,.018f));
                float side=bounds.center.x+s*(bounds.extents.x+wall*1.5f);
                Panel(new Vector3(side,bounds.center.y,bounds.center.z),new Vector3(.018f,bounds.size.y*.86f,.025f));
                foreach(float y in new[]{bounds.min.y+.12f,bounds.center.y+.30f,bounds.max.y-.12f})
                    Panel(new Vector3(side,y,bounds.center.z),new Vector3(.018f,.035f,bounds.size.z*.92f));
                for(int i=0;i<6;i++)Panel(new Vector3(side,bounds.max.y-.38f-i*.085f,bounds.center.z),new Vector3(.018f,.026f,bounds.size.z*.56f));
            }
            for(int i=0;i<5;i++)Panel(new Vector3(bounds.center.x+(i-2)*bounds.size.x*.12f,bounds.max.y+wall*1.5f,bounds.center.z),new Vector3(.035f,.018f,bounds.size.z*.75f));
            var detail=new Mesh{name="RuntimeOilHousingPanel_"+marker.StableObjectId};detail.CombineMeshes(parts.ToArray(),true,true);equipment._ownedMeshes.Add(detail);
            var grille=new GameObject("ControllerVentGrille");grille.transform.SetParent(equipment.transform,false);
            grille.AddComponent<MeshFilter>().sharedMesh=detail;grille.AddComponent<MeshRenderer>().sharedMaterial=equipment.TrimMaterial??equipment.PanelMaterial;
            parts.Clear();
            foreach(int s in new[]{-1,1})
            {
                float face=bounds.center.z+s*(bounds.extents.z+wall*1.6f);
                Panel(new Vector3(bounds.center.x-bounds.size.x*.25f,bounds.max.y-.22f,face),new Vector3(bounds.size.x*.24f,.09f,.018f));
                for(int i=0;i<4;i++)Panel(new Vector3(bounds.center.x-bounds.size.x*.28f+i*.08f,bounds.min.y+.07f,face),new Vector3(.045f,.05f,.018f));
            }
            var accents=new Mesh{name="RuntimeOilControllerAccents_"+marker.StableObjectId};accents.CombineMeshes(parts.ToArray(),true,true);equipment._ownedMeshes.Add(accents);
            var labels=new GameObject("ControllerServiceLabels");labels.transform.SetParent(equipment.transform,false);
            labels.AddComponent<MeshFilter>().sharedMesh=accents;labels.AddComponent<MeshRenderer>().sharedMaterial=equipment.PanelMaterial;
        }
        private void OnDestroy(){if(Application.isPlaying)foreach(var mesh in _ownedMeshes)if(mesh!=null)Destroy(mesh);}

        private static void AddSoilCasing(RoaOilExtraction equipment,Renderer ground)
        {
            Vector3 at=equipment.transform.TransformPoint(new Vector3(.73f,.24f,.55f));
            float height=SoilHeight(ground,at);
            equipment.SoilContact=new Vector3(at.x,height,at.z);
            float bottom=equipment.transform.InverseTransformPoint(equipment.SoilContact).y-.22f;
            float top=.24f;
            // Owned geometry, deliberately outside the controller hierarchy and without a collider.
            var source=equipment.GetComponentsInChildren<MeshRenderer>().FirstOrDefault(r=>r.name=="WellheadFlange");
            if(source==null)throw new InvalidOperationException("Extraction template has no wellhead flange");
            var casing=new GameObject("WellCasing_GroundContact");
            casing.name="WellCasing_GroundContact";casing.transform.SetParent(equipment.transform,false);
            casing.transform.localPosition=new Vector3(.73f,(top+bottom)*.5f,.55f);
            casing.transform.localScale=new Vector3(.23f,Mathf.Max(.01f,(top-bottom)*.5f),.23f);
            casing.AddComponent<MeshFilter>().sharedMesh=source.GetComponent<MeshFilter>().sharedMesh;
            casing.AddComponent<MeshRenderer>().sharedMaterial=source.sharedMaterial;
            Vector3 outletAt=equipment.transform.TransformPoint(new Vector3(1.04f,.45f,.55f));
            float outletBottom=equipment.transform.InverseTransformPoint(new Vector3(outletAt.x,SoilHeight(ground,outletAt)-.22f,outletAt.z)).y;
            var outlet=new GameObject("Discharge_GroundContact");outlet.transform.SetParent(equipment.transform,false);
            outlet.transform.localPosition=new Vector3(1.04f,(.45f+outletBottom)*.5f,.55f);
            outlet.transform.localScale=new Vector3(.09f,(.45f-outletBottom)*.5f,.09f);
            outlet.AddComponent<MeshFilter>().sharedMesh=source.GetComponent<MeshFilter>().sharedMesh;
            outlet.AddComponent<MeshRenderer>().sharedMaterial=source.sharedMaterial;
        }
        private static float SoilHeight(Renderer ground,Vector3 at)
        {
            Ray ray=new Ray(new Vector3(at.x,at.y+1000,at.z),Vector3.down);
            foreach(var collider in ground.GetComponents<Collider>())
                if(collider.enabled&&collider.Raycast(ray,out var hit,2500))return hit.point.y;
            throw new InvalidOperationException("Oil extraction has no actual ground at "+at);
        }
        private static void Remove(UnityEngine.Object value)
        {if(Application.isPlaying)Destroy(value);else DestroyImmediate(value);}
    }
}
