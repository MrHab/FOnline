using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RealmOfAshes.World;
using UnityEditor;
using UnityEngine;
using Object=UnityEngine.Object;

namespace RealmOfAshes.EditorTools
{
    /// <summary>Purpose-built geometry in metres; imported asset dimensions are never changed.</summary>
    public static class RoaWaterCisternAssets
    {
        private const string Folder="Assets/Art/Kromka/WaterCistern";
        private const string Prefab="Assets/Resources/Kromka/SmallWaterCistern.prefab";
        private static Transform _root;
        private static Mesh _cube,_cylinder;
        public static void Run()
        {
            try{Build();if(Application.isBatchMode)EditorApplication.Exit(0);}
            catch(Exception e){Debug.LogException(e);if(Application.isBatchMode)EditorApplication.Exit(1);else throw;}
        }
        public static void Build()
        {
            Directory.CreateDirectory(Folder);Directory.CreateDirectory("Assets/Resources/Kromka");
            _cube=PrimitiveMesh(PrimitiveType.Cube,"CisternUnitCube");
            _cylinder=PrimitiveMesh(PrimitiveType.Cylinder,"CisternUnitCylinder");
            var steel=Material("PaintedWaterSteel",new Color(.28f,.39f,.37f),.28f);
            var trim=Material("OxidisedTankBands",new Color(.23f,.21f,.17f),.18f);
            var concrete=Material("CisternConcrete",new Color(.39f,.37f,.31f),.03f);
            _root=new GameObject("SmallWaterCistern").transform;
            Cylinder("HorizontalWaterVessel",new Vector3(0,1.10f,0),.60f,2.00f,steel,Quaternion.Euler(0,0,90));
            foreach(int side in new[]{-1,1})
            {
                Cylinder("DishedEndCap_"+side,new Vector3(side*1.03f,1.10f,0),.565f,.10f,steel,Quaternion.Euler(0,0,90));
                Cylinder("EndCapFlange_"+side,new Vector3(side*.99f,1.10f,0),.612f,.025f,trim,Quaternion.Euler(0,0,90));
                Cylinder("SteelSupportBand_"+side,new Vector3(side*.72f,1.10f,0),.615f,.07f,trim,Quaternion.Euler(0,0,90));
                Box("SaddleSeat_"+side,new Vector3(side*.72f,.47f,0),new Vector3(.39f,.07f,1.40f),trim);
                for(int bolt=0;bolt<8;bolt++)
                {
                    float angle=bolt*Mathf.PI*.25f;
                    Cylinder("EndFlangeBolt_"+side+"_"+bolt,new Vector3(side*1.08f,1.10f+Mathf.Cos(angle)*.47f,Mathf.Sin(angle)*.47f),.019f,.028f,trim,Quaternion.Euler(0,0,90));
                }
            }
            Cylinder("TopManholeNeck",new Vector3(-.28f,1.73f,0),.19f,.14f,trim,Quaternion.identity);
            Cylinder("BoltedManholeCover",new Vector3(-.28f,1.81f,0),.23f,.045f,steel,Quaternion.identity);
            Box("ManholeHandle",new Vector3(-.28f,1.865f,0),new Vector3(.22f,.05f,.045f),trim);
            Cylinder("LowWaterOutlet",new Vector3(.75f,.71f,.65f),.045f,.20f,trim,Quaternion.Euler(90,0,0));
            Cylinder("ShutoffValveStem",new Vector3(.75f,.83f,.70f),.019f,.19f,trim,Quaternion.identity);
            Cylinder("ValveWheel",new Vector3(.75f,.93f,.70f),.105f,.025f,steel,Quaternion.identity);
            Box("WaterServicePlate",new Vector3(0,1.13f,.607f),new Vector3(.43f,.20f,.018f),trim);
            foreach(var material in new[]{steel,trim})Combine(material);
            var component=_root.gameObject.AddComponent<RoaWaterCistern>();component.UnitCube=_cube;component.Concrete=concrete;
            PrefabUtility.SaveAsPrefabAsset(_root.gameObject,Prefab);Object.DestroyImmediate(_root.gameObject);AssetDatabase.SaveAssets();
            Debug.Log("[WATER CISTERN] Built compact 2.19 x 1.65 m vessel without gameplay colliders or native asset resizing.");
        }
        private static Mesh PrimitiveMesh(PrimitiveType type,string name)
        {
            string path=Folder+"/"+name+".asset";var mesh=AssetDatabase.LoadAssetAtPath<Mesh>(path);if(mesh!=null)return mesh;
            var primitive=GameObject.CreatePrimitive(type);mesh=Object.Instantiate(primitive.GetComponent<MeshFilter>().sharedMesh);mesh.name=name;
            Object.DestroyImmediate(primitive);AssetDatabase.CreateAsset(mesh,path);return mesh;
        }
        private static Material Material(string name,Color color,float smoothness)
        {
            string path=Folder+"/"+name+".mat";var material=AssetDatabase.LoadAssetAtPath<Material>(path);
            if(material==null){material=new Material(Shader.Find("Universal Render Pipeline/Lit"));AssetDatabase.CreateAsset(material,path);}
            material.name=name;material.SetColor("_BaseColor",color);material.SetFloat("_Smoothness",smoothness);return material;
        }
        private static void Box(string name,Vector3 position,Vector3 size,Material material)=>Part(name,position,size,Quaternion.identity,_cube,material);
        private static void Cylinder(string name,Vector3 position,float radius,float height,Material material,Quaternion rotation)
            =>Part(name,position,new Vector3(radius*2,height*.5f,radius*2),rotation,_cylinder,material);
        private static void Part(string name,Vector3 position,Vector3 size,Quaternion rotation,Mesh mesh,Material material)
        {var go=new GameObject(name);go.transform.SetParent(_root,false);go.transform.localPosition=position;go.transform.localRotation=rotation;go.transform.localScale=size;go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;}
        private static void Combine(Material material)
        {
            var parts=_root.GetComponentsInChildren<MeshRenderer>().Where(r=>r.sharedMaterial==material).ToArray();
            string path=Folder+"/"+material.name+".asset";var mesh=AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if(mesh==null){mesh=new Mesh();AssetDatabase.CreateAsset(mesh,path);}mesh.Clear();mesh.name=material.name;
            mesh.CombineMeshes(parts.Select(r=>new CombineInstance{mesh=r.GetComponent<MeshFilter>().sharedMesh,transform=_root.worldToLocalMatrix*r.transform.localToWorldMatrix}).ToArray(),true,true);
            foreach(var part in parts)Object.DestroyImmediate(part.gameObject);
            var go=new GameObject(material.name);go.transform.SetParent(_root,false);go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;
        }
    }
}
