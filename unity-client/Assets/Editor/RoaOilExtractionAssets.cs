using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Native motor and purpose-built compact extraction head; no palette replacement.</summary>
    public static class RoaOilExtractionAssets
    {
        public const string Path="Assets/Resources/Kromka/FieldOilExtraction.prefab";
        static Transform _root;static Material _steel,_rust,_brass;
        public static void Run()
        {
            try{Build();if(Application.isBatchMode)EditorApplication.Exit(0);}
            catch(Exception e){Debug.LogException(e);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        public static void Build()
        {
            Directory.CreateDirectory("Assets/Art/Kromka/OilExtraction");Directory.CreateDirectory("Assets/Resources/Kromka");
            _steel=Material("WellSteel",new Color(.19f,.23f,.22f));
            _rust=Material("WellOxide",new Color(.38f,.22f,.10f));
            _brass=Material("WellValve",new Color(.58f,.43f,.17f));
            _root=new GameObject("FieldOilExtraction").transform;
            Box("MotorMount",new Vector3(.73f,.11f,-.4f),new Vector3(.72f,.12f,.86f),_steel);
            Box("ControllerMountBracket",new Vector3(.52f,.11f,.02f),new Vector3(.40f,.12f,.12f),_steel);
            Box("WellheadMotorFrame",new Vector3(.73f,.11f,.06f),new Vector3(.11f,.12f,1.04f),_steel);
            Cylinder("WellheadFlange",new Vector3(.73f,.24f,.55f),.17f,.10f,_rust);
            Cylinder("SealHousing",new Vector3(.73f,.46f,.55f),.12f,.34f,_steel);
            Box("ElectricDrive",new Vector3(.73f,.40f,-.35f),new Vector3(.48f,.42f,.46f),_steel);
            Box("GearReduction",new Vector3(.73f,.81f,-.35f),new Vector3(.44f,.40f,.40f),_rust);
            Cylinder("CrankShaft",new Vector3(.73f,1.10f,-.35f),.055f,.54f,_steel,Quaternion.Euler(0,0,90));
            foreach(int side in new[]{-1,1})
            {
                Cylinder("CrankWheel"+side,new Vector3(.73f+side*.27f,1.10f,-.35f),.24f,.045f,_rust,Quaternion.Euler(0,0,90));
                Box("Counterweight"+side,new Vector3(.73f+side*.27f,.99f,-.45f),new Vector3(.07f,.23f,.24f),_steel);
                Beam("PitmanRod"+side,new Vector3(.73f+side*.27f,1.22f,-.22f),new Vector3(.73f+side*.27f,2.31f,-.42f),.035f,_brass);
                Beam("AFrameFront"+side,new Vector3(.73f+side*.18f,.17f,.18f),new Vector3(.73f+side*.18f,2.38f,-.08f),.045f,_steel);
                Beam("AFrameRear"+side,new Vector3(.73f+side*.18f,.17f,-.70f),new Vector3(.73f+side*.18f,2.38f,-.08f),.045f,_steel);
            }
            Cylinder("SaddleBearing",new Vector3(.73f,2.38f,-.08f),.11f,.46f,_rust,Quaternion.Euler(0,0,90));
            Box("WalkingBeam",new Vector3(.73f,2.43f,.10f),new Vector3(.15f,.13f,1.08f),_steel);
            Box("PitmanCrossbar",new Vector3(.73f,2.36f,-.42f),new Vector3(.64f,.10f,.10f),_steel);
            Horsehead();
            Cylinder("PolishedRod",new Vector3(.73f,1.32f,.55f),.034f,1.85f,_brass);
            Box("RodCarrier",new Vector3(.73f,2.23f,.55f),new Vector3(.16f,.03f,.035f),_steel);
            foreach(float x in new[]{.68f,.78f})Beam("HorseheadBridle",new Vector3(x,2.29f,.77f),new Vector3(x,2.23f,.55f),.014f,_steel);
            Cylinder("FlowOutlet",new Vector3(.91f,.45f,.55f),.045f,.30f,_steel,Quaternion.Euler(0,0,90));
            Cylinder("ShutoffWheel",new Vector3(.99f,.64f,.55f),.105f,.035f,_brass,Quaternion.Euler(0,0,90));
            Cylinder("ValveRiser",new Vector3(.87f,.545f,.55f),.03f,.19f,_steel);
            Cylinder("ValveStem",new Vector3(.93f,.64f,.55f),.014f,.12f,_steel,Quaternion.Euler(0,0,90));
            Beam("CabinetPowerConduit",new Vector3(.32f,.35f,.02f),new Vector3(.73f,.35f,.02f),.03f,_steel);
            Beam("DrivePowerConduit",new Vector3(.73f,.35f,.02f),new Vector3(.73f,.35f,-.25f),.03f,_steel);
            for(int i=0;i<6;i++)
            {float a=i*Mathf.PI/3;Cylinder("FlangeBolt"+i,new Vector3(.73f+Mathf.Cos(a)*.135f,.302f,.55f+Mathf.Sin(a)*.135f),.014f,.025f,_brass);}
            var geometry=_root.gameObject.AddComponent<RealmOfAshes.World.RoaOilExtraction>();
            geometry.UnitCube=_root.Find("MotorMount").GetComponent<MeshFilter>().sharedMesh;
            geometry.HousingMaterial=_steel;geometry.PanelMaterial=_brass;geometry.TrimMaterial=_rust;
            foreach(var material in new[]{_steel,_rust,_brass})CombineOwned(material);
            PrefabUtility.SaveAsPrefabAsset(_root.gameObject,Path);Object.DestroyImmediate(_root.gameObject);AssetDatabase.SaveAssets();
            Debug.Log("[OIL EXTRACTION ASSETS] Compact authored A-frame/walking-beam/crank/horsehead persisted; original cabinet is preserved separately; no gameplay colliders.");
        }
        static void Horsehead()
        {
            var yz=new[]{new Vector2(.44f,2.56f),new Vector2(.64f,2.61f),new Vector2(.77f,2.52f),new Vector2(.79f,2.29f),new Vector2(.68f,2.15f),new Vector2(.55f,2.16f),new Vector2(.57f,2.37f),new Vector2(.44f,2.38f)};
            var vertices=yz.Select(p=>new Vector3(.64f,p.y,p.x)).Concat(yz.Select(p=>new Vector3(.82f,p.y,p.x))).ToArray();
            var triangles=new System.Collections.Generic.List<int>();
            // The profile is star-shaped around its middle: explicit face fans and closed edges.
            for(int i=1;i<yz.Length-1;i++){triangles.AddRange(new[]{0,i+1,i,8,8+i,8+i+1});}
            for(int i=0;i<yz.Length;i++){int j=(i+1)%yz.Length;triangles.AddRange(new[]{i,j,8+j,i,8+j,8+i});}
            var mesh=new Mesh{name="WellHorsehead"};mesh.vertices=vertices;mesh.triangles=triangles.ToArray();mesh.RecalculateNormals();mesh.RecalculateBounds();
            string path="Assets/Art/Kromka/OilExtraction/WellHorsehead.asset";var stored=AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if(stored==null){stored=mesh;AssetDatabase.CreateAsset(stored,path);}else{EditorUtility.CopySerialized(mesh,stored);Object.DestroyImmediate(mesh);}
            var part=new GameObject("Horsehead");part.transform.SetParent(_root,false);part.AddComponent<MeshFilter>().sharedMesh=stored;part.AddComponent<MeshRenderer>().sharedMaterial=_rust;
        }
        static void CombineOwned(Material material)
        {
            var parts=_root.GetComponentsInChildren<MeshRenderer>().Where(r=>r.transform.parent==_root&&r.name!="WellheadFlange"&&r.sharedMaterial==material).ToArray();
            var mesh=new Mesh{name=material.name+"Geometry"};
            mesh.CombineMeshes(parts.Select(r=>new CombineInstance{mesh=r.GetComponent<MeshFilter>().sharedMesh,transform=_root.worldToLocalMatrix*r.transform.localToWorldMatrix}).ToArray(),true,true);
            string path="Assets/Art/Kromka/OilExtraction/"+mesh.name+".asset";
            var stored=AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if(stored==null){stored=mesh;AssetDatabase.CreateAsset(stored,path);}else{EditorUtility.CopySerialized(mesh,stored);Object.DestroyImmediate(mesh);}
            var group=new GameObject(stored.name);group.transform.SetParent(_root,false);
            group.AddComponent<MeshFilter>().sharedMesh=stored;group.AddComponent<MeshRenderer>().sharedMaterial=material;
            foreach(var part in parts)Object.DestroyImmediate(part.gameObject);
        }
        static Material Material(string name,Color color)
        {
            string path="Assets/Art/Kromka/OilExtraction/"+name+".mat";
            var mat=AssetDatabase.LoadAssetAtPath<Material>(path);
            if(mat==null){mat=new Material(Shader.Find("Universal Render Pipeline/Lit"));AssetDatabase.CreateAsset(mat,path);}
            mat.color=color;if(mat.HasProperty("_Smoothness"))mat.SetFloat("_Smoothness",.26f);EditorUtility.SetDirty(mat);return mat;
        }
        static GameObject Shape(string name,PrimitiveType type,Vector3 at,Vector3 size,Material mat,Quaternion rotation)
        {
            var obj=GameObject.CreatePrimitive(type);obj.name=name;obj.transform.SetParent(_root,false);
            obj.transform.localPosition=at;obj.transform.localRotation=rotation;obj.transform.localScale=size;
            Object.DestroyImmediate(obj.GetComponent<Collider>());obj.GetComponent<MeshRenderer>().sharedMaterial=mat;return obj;
        }
        static void Box(string name,Vector3 at,Vector3 size,Material mat)=>Shape(name,PrimitiveType.Cube,at,size,mat,Quaternion.identity);
        static void Cylinder(string name,Vector3 at,float radius,float height,Material mat,Quaternion? rotation=null)
            =>Shape(name,PrimitiveType.Cylinder,at,new Vector3(radius*2,height*.5f,radius*2),mat,rotation??Quaternion.identity);
        static void Beam(string name,Vector3 a,Vector3 b,float radius,Material mat)
            =>Shape(name,PrimitiveType.Cylinder,(a+b)*.5f,new Vector3(radius*2,Vector3.Distance(a,b)*.5f,radius*2),mat,Quaternion.FromToRotation(Vector3.up,b-a));
    }
}
