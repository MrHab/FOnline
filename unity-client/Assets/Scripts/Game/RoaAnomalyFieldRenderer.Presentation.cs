using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace RealmOfAshes.Game
{
    public sealed partial class RoaAnomalyFieldRenderer
    {
        private sealed partial class FieldView
        {
            public Material VolumeMaterial, FlowMaterial;
            public MeshRenderer VolumeRenderer, FlowRenderer;
            public Mesh FlowMesh;
            public Vector3[] FlowVertices;
            public Color[] FlowColors;
            public Light SpillLight;
            public float VolumeHeight;
            public int FlowSegments, FlowBranches;
        }

        private Shader _volumeShader;
        private Texture3D _densityNoise;
        private Mesh _volumeProxy;
        private UniversalAdditionalCameraData _bufferCamera;
        private CameraOverrideOption _previousColorOption, _previousDepthOption;
        private readonly List<FieldView> _lightCandidates = new List<FieldView>();
        private System.Comparison<FieldView> _lightComparison;
        public int ActiveSpillLights { get; private set; }
        public bool RefractionBuffersRequested => _bufferCamera != null;
        public int ActiveVolumeCount { get; private set; }
        public const int MaximumSpillLights = 2;
        public const int MaximumVolumeSteps = 24;

        private void EnsureVolumeResources()
        {
            if(_volumeShader!=null) return;
            _volumeShader=Resources.Load<Shader>("RealmOfAshes/AnomalyVolume");
            if(_volumeShader==null) throw new System.InvalidOperationException("AnomalyVolume shader is missing.");
            const int size=32;
            _densityNoise=new Texture3D(size,size,size,TextureFormat.RGBA32,false) {
                name="AnomalyTileableDensity32", filterMode=FilterMode.Bilinear, wrapMode=TextureWrapMode.Repeat
            };
            var pixels=new Color32[size*size*size]; uint hash=0x831d27;
            for(int i=0;i<pixels.Length;i++) {
                hash=unchecked(hash*1664525+1013904223); byte r=(byte)(hash>>24);
                hash=unchecked(hash*1664525+1013904223); byte g=(byte)(hash>>24);
                hash=unchecked(hash*1664525+1013904223); byte b=(byte)(hash>>24);
                pixels[i]=new Color32(r,g,b,255);
            }
            var smooth=new Color32[pixels.Length];
            for(int z=0;z<size;z++)for(int y=0;y<size;y++)for(int x=0;x<size;x++) {
                int i=(z*size+y)*size+x;
                Color c=(Color)pixels[i]*.4f;
                c+=(Color)pixels[(z*size+y)*size+(x+1)%size]*.1f;
                c+=(Color)pixels[(z*size+y)*size+(x+size-1)%size]*.1f;
                c+=(Color)pixels[(z*size+(y+1)%size)*size+x]*.1f;
                c+=(Color)pixels[(z*size+(y+size-1)%size)*size+x]*.1f;
                c+=(Color)pixels[(((z+1)%size)*size+y)*size+x]*.1f;
                c+=(Color)pixels[(((z+size-1)%size)*size+y)*size+x]*.1f;
                smooth[i]=new Color(Mathf.Clamp01((c.r-.5f)*1.6f+.5f),Mathf.Clamp01((c.g-.5f)*1.6f+.5f),Mathf.Clamp01((c.b-.5f)*1.6f+.5f),1);
            }
            _densityNoise.SetPixels32(smooth); _densityNoise.Apply(false,true);
            _volumeProxy=new Mesh { name="AnomalyVolumeProxy" };
            _volumeProxy.vertices=new[] {
                new Vector3(-1,-1,-1),new Vector3(1,-1,-1),new Vector3(1,1,-1),new Vector3(-1,1,-1),
                new Vector3(-1,-1,1),new Vector3(1,-1,1),new Vector3(1,1,1),new Vector3(-1,1,1)
            };
            _volumeProxy.triangles=new[]{0,2,1,0,3,2,1,2,6,1,6,5,5,6,7,5,7,4,4,7,3,4,3,0,3,7,6,3,6,2,4,0,1,4,1,5};
            _volumeProxy.RecalculateBounds();
        }

        private static float FieldHeight(string type)
        {
            switch(type) { case "pull":return 2.8f; case "carousel":return 3.2f;
                case "seam":return 1.9f; case "glass":return 2.5f; case "dew":return 1.6f;
                case "sink":return 1.3f; case "mute":return 2.8f; default:return 2.1f; }
        }

        private void BuildVolume(FieldView v)
        {
            v.VolumeHeight=FieldHeight(v.Type)*Mathf.Clamp(v.Radius/2.65f,.7f,1.7f);
            v.VolumeMaterial=new Material(_volumeShader) { name="Volume_"+v.Type };
            v.VolumeMaterial.SetTexture("_NoiseVolume",_densityNoise);
            v.VolumeMaterial.SetColor("_Tint",AtmosphereColor(v.Type));
            v.VolumeMaterial.SetColor("_Emission",TypeColor(v.Type));
            v.VolumeMaterial.SetFloat("_Kind",Kind(v.Type)); v.VolumeMaterial.SetFloat("_Seed",v.Seed);
            v.VolumeMaterial.SetFloat("_Distortion",v.Type=="glass" || v.Type=="mute" || v.Type=="pull" ? .016f : .008f);
            var volume=new GameObject("RefractiveDensityVolume"); volume.transform.SetParent(v.Root,false);
            volume.transform.localPosition=Vector3.up*(v.VolumeHeight*.5f);
            volume.transform.localScale=new Vector3(v.Radius,v.VolumeHeight*.5f,v.Radius*(v.Type=="seam" ? .32f : 1f));
            volume.AddComponent<MeshFilter>().sharedMesh=_volumeProxy;
            v.VolumeRenderer=volume.AddComponent<MeshRenderer>(); v.VolumeRenderer.sharedMaterial=v.VolumeMaterial;
            ConfigureRenderer(v.VolumeRenderer);
            v.FlowMaterial=FieldMaterial(v.Type,3,TypeColor(v.Type));
            v.FlowMaterial.renderQueue=3010;
            var flow=new GameObject("SpatialFlowRibbons"); flow.transform.SetParent(v.Root,false);
            v.FlowMesh=new Mesh { name="AnomalyFlow_"+v.Id }; v.FlowMesh.MarkDynamic();
            flow.AddComponent<MeshFilter>().sharedMesh=v.FlowMesh;
            v.FlowRenderer=flow.AddComponent<MeshRenderer>(); v.FlowRenderer.sharedMaterial=v.FlowMaterial;
            ConfigureRenderer(v.FlowRenderer); RebuildFlow(v);
            var light=new GameObject("AnomalyLightSpill").AddComponent<Light>(); light.transform.SetParent(v.Root,false);
            light.transform.localPosition=Vector3.up*.8f; light.type=LightType.Point;
            Color tint=TypeColor(v.Type); float maximum=Mathf.Max(tint.r,tint.g,tint.b);
            light.color=new Color(tint.r/maximum,tint.g/maximum,tint.b/maximum);
            light.range=v.Radius*2.3f; light.shadows=LightShadows.None;
            light.renderMode=LightRenderMode.ForcePixel; light.enabled=false; v.SpillLight=light;
        }

        private void RebuildFlow(FieldView v)
        {
            v.FlowSegments=v.Low ? 24 : 48;
            v.FlowBranches=v.Low ? 2 : (v.Type=="chime" ? 2 : 4);
            int points=v.FlowSegments+1, vertices=points*v.FlowBranches*2;
            v.FlowVertices=new Vector3[vertices]; v.FlowColors=new Color[vertices];
            var uv=new Vector2[vertices]; var triangles=new int[v.FlowBranches*v.FlowSegments*6]; int at=0;
            for(int b=0;b<v.FlowBranches;b++) for(int s=0;s<points;s++) {
                int i=(b*points+s)*2; float u=s/(float)v.FlowSegments;
                uv[i]=new Vector2(u,0); uv[i+1]=new Vector2(u,1);
                if(s==v.FlowSegments)continue;
                triangles[at++]=i; triangles[at++]=i+2; triangles[at++]=i+1;
                triangles[at++]=i+1; triangles[at++]=i+2; triangles[at++]=i+3;
            }
            v.FlowMesh.Clear(); v.FlowMesh.vertices=v.FlowVertices; v.FlowMesh.uv=uv;
            v.FlowMesh.colors=v.FlowColors; v.FlowMesh.triangles=triangles;
            v.FlowMesh.bounds=new Bounds(Vector3.up*v.VolumeHeight*.5f,new Vector3(v.Radius*2.5f,v.VolumeHeight*2,v.Radius*2.5f));
        }

        private Vector3 FlowPoint(FieldView v,int branch,float u,float time)
        {
            float phase=branch*2.399963f+v.Seed, a=phase+u*5f-time*.5f;
            float r=v.Radius*(1f-u)*.85f, y=.1f+Mathf.Pow(u,1.7f)*v.VolumeHeight*.88f;
            switch(v.Type) {
                case "carousel": a=phase+u*7.5f+time*.9f; r=v.Radius*(.22f+u*.5f); y=.1f+u*v.VolumeHeight*.82f; break;
                case "sink": a=phase+u*4f+time*.35f; y=.1f+(1-u)*(1-u)*.65f; break;
                case "glass": a=phase+u*3f-time*.25f; r=v.Radius*(.12f+u*.36f); y=.15f+u*v.VolumeHeight*.9f; break;
                case "dew": a=phase+u*5f-time*.35f; r=v.Radius*(.3f+.3f*Mathf.Sin(phase)); y=.15f+u*.95f; break;
                case "chime": a=phase+u*6f+time*.6f; r=v.Radius*.22f; y=.75f+Mathf.Sin(u*Mathf.PI*2+phase)*.45f; break;
                case "mute":
                    a=phase+u*4.8f+time*.2f; r=v.Radius*(.42f+.03f*Mathf.Sin(time+u*8));
                    return new Vector3(Mathf.Cos(a)*r,1.2f+Mathf.Sin(a)*r*.72f,Mathf.Sin(u*3f+phase)*r*.7f);
                case "seam": return new Vector3((u*2-1)*v.Radius*.86f,
                    .15f+Mathf.Sin(u*Mathf.PI)*(.25f+branch*.17f)+Mathf.Sin(u*19f+time*2+phase)*.05f,Mathf.Sin(u*8f+phase)*.1f);
            }
            float turbulence=Mathf.PerlinNoise(u*5f+phase,time*.12f)-.5f;
            a+=turbulence*.4f; r*=1+turbulence*.32f;
            y+=Mathf.Sin(u*Mathf.PI)*turbulence*.23f;
            return new Vector3(Mathf.Cos(a)*r,y,Mathf.Sin(a)*r);
        }

        private void AnimateVolume(FieldView v,float time,float pulse,float age,bool near)
        {
            if(v.VolumeRenderer==null)return;
            bool detailed=!v.Low && RefractionBuffersRequested && (_camera==null
                || Vector3.SqrMagnitude(_camera.transform.position-v.Root.position)<2025f);
            v.VolumeRenderer.enabled=near && detailed && (v.Activity+pulse>.008f);
            if(v.VolumeRenderer.enabled) ActiveVolumeCount++;
            v.VolumeMaterial.SetFloat("_Activity",v.Activity); v.VolumeMaterial.SetFloat("_Pulse",pulse);
            v.FlowRenderer.enabled=near && v.Activity+pulse>.008f && v.Type!="chime";
            v.SpillLight.intensity=(v.Type=="chime" ? 5f : v.Type=="seam" ? 3.5f : v.Type=="glass" ? 2.8f : .8f)*v.Activity
                +pulse*(v.Type=="chime" ? 16f : 9f);
            if(!near)return;
            if(v.FlowSegments!=(v.Low ? 24 : 48))RebuildFlow(v);
            float width=v.Type=="seam" ? .11f : v.Type=="chime" ? .045f : v.Type=="glass" ? .16f : .48f;
            float opacity=v.Type=="seam" ? .7f : v.Type=="chime" ? .4f : v.Type=="glass" ? .28f : .32f;
            if(v.Low) { width*=1.3f; opacity*=1.3f; }
            for(int b=0;b<v.FlowBranches;b++) {
              Vector3 previousSide=Vector3.zero;
              for(int s=0;s<=v.FlowSegments;s++) {
                float u=s/(float)v.FlowSegments; Vector3 p=FlowPoint(v,b,u,time+v.Seed);
                Vector3 next=FlowPoint(v,b,u+.003f,time+v.Seed);
                // Use a physical radial frame, not a camera-facing billboard frame.
                // Camera-facing wide strips fold when a helix turns towards the eye.
                Vector3 radial=v.Type=="seam" ? Vector3.forward : v.Type=="mute"
                    ? (p-Vector3.up*1.2f).normalized : new Vector3(p.x,0,p.z).normalized;
                Vector3 direction=Vector3.Cross(radial,next-p).normalized;
                if(direction.sqrMagnitude<.01f)direction=previousSide.sqrMagnitude>.01f ? previousSide : Vector3.right;
                if(s>0) {
                    if(Vector3.Dot(previousSide,direction)<0)direction=-direction;
                }
                previousSide=direction;
                float halfWidth=width*(.35f+.65f*Mathf.Sin(u*Mathf.PI));
                Vector3 side=direction*halfWidth;
                // Inward collapse / outward pressure changes the 3D shape, not just brightness.
                if(age>=0 && age<.85f) {
                    float expansion=1+pulse*(v.Type=="pull" || v.Type=="sink" || v.Type=="mute" ? -.22f : .18f);
                    p.x*=expansion; p.z*=expansion; p.y+=pulse*.2f;
                }
                int i=(b*(v.FlowSegments+1)+s)*2;
                v.FlowVertices[i]=p-side; v.FlowVertices[i+1]=p+side;
                Color c=new Color(1,1,1,Mathf.Clamp01(opacity*(v.Activity+pulse*2)));
                v.FlowColors[i]=v.FlowColors[i+1]=c;
              }
            }
            v.FlowMesh.vertices=v.FlowVertices; v.FlowMesh.colors=v.FlowColors;
        }

        private void UpdatePresentationBudget()
        {
            ActiveVolumeCount=0; ActiveSpillLights=0; _lightCandidates.Clear();
            bool needBuffers=false;
            foreach(FieldView v in _fields.Values) {
                float distance=_camera==null ? 0 : Vector3.SqrMagnitude(_camera.transform.position-v.Root.position);
                if(distance<2025f && !LowQuality && _volumeShader!=null && _volumeShader.isSupported
                    && (v.Active || v.Activity>.01f || Time.unscaledTime-v.PulseAt<1.5f)) needBuffers=true;
                if(v.SpillLight!=null) {
                    v.SpillLight.enabled=false;
                    if(distance<900f && (v.Active || Time.unscaledTime-v.PulseAt<1.2f)) _lightCandidates.Add(v);
                }
            }
            // Closest fields get lighting; an actual contact temporarily takes priority.
            if(_lightComparison==null)_lightComparison=CompareLightPriority;
            _lightCandidates.Sort(_lightComparison);
            int count=Mathf.Min(_lightCandidates.Count,LowQuality ? 1 : MaximumSpillLights);
            for(int i=0;i<count;i++) { _lightCandidates[i].SpillLight.enabled=true; ActiveSpillLights++; }
            if(_bufferCamera!=null && (_camera==null || _bufferCamera.gameObject!=_camera.gameObject || !needBuffers)) ReleaseCameraBuffers();
            if(needBuffers && _camera!=null && _bufferCamera==null) {
                _bufferCamera=_camera.GetUniversalAdditionalCameraData();
                _previousColorOption=_bufferCamera.requiresColorOption; _previousDepthOption=_bufferCamera.requiresDepthOption;
                _bufferCamera.requiresColorOption=CameraOverrideOption.On;
                _bufferCamera.requiresDepthOption=CameraOverrideOption.On;
            }
        }

        private int CompareLightPriority(FieldView a,FieldView b)
        {
            float da=_camera==null ? 0 : Vector3.SqrMagnitude(_camera.transform.position-a.Root.position);
            float db=_camera==null ? 0 : Vector3.SqrMagnitude(_camera.transform.position-b.Root.position);
            da-=Mathf.Max(0,1-(Time.unscaledTime-a.PulseAt))*1000;
            db-=Mathf.Max(0,1-(Time.unscaledTime-b.PulseAt))*1000;
            return da.CompareTo(db);
        }

        private void ReleaseCameraBuffers()
        {
            if(_bufferCamera!=null) {
                _bufferCamera.requiresColorOption=_previousColorOption;
                _bufferCamera.requiresDepthOption=_previousDepthOption;
            }
            _bufferCamera=null;
        }
        private void OnEnable() { SetLocalWorldActive(_localWorldActive); }
        private void OnDisable() {
            ReleaseCameraBuffers(); ActiveSpillLights=0; ActiveVolumeCount=0;
            if(_worldRoot!=null) _worldRoot.gameObject.SetActive(false);
        }
        private void ReleaseVolume(FieldView v) { Release(v.VolumeMaterial); Release(v.FlowMaterial); Release(v.FlowMesh); }
        private void ReleaseVolumeResources() { ReleaseCameraBuffers(); Release(_volumeProxy); Release(_densityNoise); }
    }
}
