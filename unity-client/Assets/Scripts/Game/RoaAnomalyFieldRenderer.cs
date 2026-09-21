using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using RealmOfAshes.Net;
using RealmOfAshes.World;
using UnityEngine;
using UnityEngine.Rendering;

namespace RealmOfAshes.Game
{
    /// <summary>
    /// Layered, bounded world VFX. The detector is
    /// intentionally irrelevant here: the exact hazard footprint remains readable
    /// without bloom, depth textures, compute shaders or high particle settings.
    /// Gameplay and discharge deadlines come exclusively from the server.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed partial class RoaAnomalyFieldRenderer : MonoBehaviour
    {
        private sealed partial class FieldView
        {
            public string Id, Type;
            public Transform Root;
            public float Radius, Seed, Activity = 1f, ActiveAgainAt, MotionTime, PulseAt = -100f;
            public bool Active, PermanentlyDischarged;
            public long Revision = -1, ServerStamp = -1;
            public Material Surface, MistMaterial, SparkMaterial;
            public MeshRenderer Ground;
            public ParticleSystem Mist, Sparks, Debris;
            public ParticleSystemRenderer MistRenderer, SparkRenderer, DebrisRenderer;
            public ParticleSystem.Particle[] MistBuffer, SparkBuffer, DebrisBuffer;
            public readonly List<LineRenderer> Arcs = new List<LineRenderer>();
            public readonly Vector3[] ArcPoints = new Vector3[19];
            public AudioSource Audio;
            public int ArcFrame = -1;
            public bool Low;
        }

        public struct FieldDiagnostics
        {
            public Vector3 Position;
            public float Radius, ReactivatesAt;
            public bool Active, Permanent;
            public int ParticleBudget, Layers;
            public long Revision;
        }

        private readonly Dictionary<string, FieldView> _fields = new Dictionary<string, FieldView>(StringComparer.Ordinal);
        private readonly Dictionary<string, AudioClip> _clips = new Dictionary<string, AudioClip>(StringComparer.Ordinal);
        private RoaSocketClient _socket;
        private Transform _worldRoot;
        private Mesh _groundMesh, _shardMesh;
        private Material _arcMaterial, _debrisMaterial;
        private Shader _shader;
        private string _roomId = string.Empty, _locationId = string.Empty;
        private long _lastServerNow;
        private Camera _camera;
        private bool _localWorldActive = true;
        public bool ForceLowQuality { get; set; }
        public int VisibleFieldCount => _fields.Count;
        public string RoomId => _roomId;
        public bool ShaderReady => _shader != null && _shader.isSupported;
        public int ReactionCount { get; private set; }
        private bool LowQuality => ForceLowQuality || Application.isMobilePlatform || QualitySettings.GetQualityLevel() <= 1;

        public bool TryGetField(string id, out FieldDiagnostics result)
        {
            result = default;
            if (!_fields.TryGetValue(id, out FieldView v)) return false;
            result = new FieldDiagnostics { Position = v.Root.position, Radius = v.Radius, Active = v.Active,
                Permanent = v.PermanentlyDischarged, Revision = v.Revision,
                ReactivatesAt = v.ActiveAgainAt,
                ParticleBudget = v.MistBuffer.Length + v.SparkBuffer.Length + v.DebrisBuffer.Length,
                Layers = 1 + 3 + v.Arcs.Count + 2 };
            return true;
        }

        public void Configure(RoaSocketClient socket)
        {
            Unsubscribe();
            _socket = socket;
            if (_socket != null)
            {
                _socket.OnAnomalyState += ApplyAnomalyState;
                _socket.OnPlayerDamaged += ApplyExposure;
            }
            EnsureResources();
        }

        public void ApplyWorldState(JObject state) { ApplyAnomalyState(state?["anomalies"] as JObject); }

        public void SetLocalWorldActive(bool active)
        {
            _localWorldActive=active;
            bool visible=active && isActiveAndEnabled;
            if(_worldRoot!=null)_worldRoot.gameObject.SetActive(visible);
            if(!visible) { ReleaseCameraBuffers(); ActiveSpillLights=0; ActiveVolumeCount=0; }
            else foreach(FieldView v in _fields.Values) {
                if(v.Audio!=null && !v.Audio.isPlaying) v.Audio.Play();
                // These manually populated systems deliberately have playOnAwake
                // disabled; reactivating the root alone does not restart them.
                if(v.Mist!=null && !v.Mist.isPlaying)v.Mist.Play();
                if(v.Sparks!=null && !v.Sparks.isPlaying)v.Sparks.Play();
                if(v.Debris!=null && !v.Debris.isPlaying)v.Debris.Play();
            }
        }

        public void ApplyAnomalyState(JObject state)
        {
            if (state == null) return;
            string roomId = state["roomId"]?.ToString() ?? string.Empty;
            string locationId = state["locationId"]?.ToString() ?? string.Empty;
            long serverNow = state["serverNow"]?.Value<long?>() ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            // Also reject late packets from a room that was already left.
            if (serverNow < _lastServerNow) return;
            if (roomId != _roomId || locationId != _locationId)
            {
                ClearFields(); _roomId = roomId; _locationId = locationId; _lastServerNow = 0;
            }
            // An ack and a broadcast can deliver the same snapshot. Older data must
            // not revive a field or replay a discharge burst.
            _lastServerNow = serverNow;
            EnsureResources();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (state["fields"] is JArray fields)
            {
                foreach (JToken token in fields)
                {
                    if (!(token is JObject row)) continue;
                    string id = row["id"]?.ToString() ?? "";
                    string type = row["type"]?.ToString() ?? "pull";
                    if (string.IsNullOrWhiteSpace(id)) continue;
                    seen.Add(id);
                    float radius = Mathf.Clamp(Value(row, "radius", 2.5f), 0.75f, 60f);
                    bool existing = _fields.TryGetValue(id, out FieldView v);
                    long revision = row["revision"]?.Value<long?>() ?? 0;
                    if (existing && revision < v.Revision) continue;
                    if (existing && revision == v.Revision && serverNow == v.ServerStamp) continue;
                    if (existing && (v.Type != type || Mathf.Abs(v.Radius - radius) > 0.001f))
                    { DestroyField(id); existing = false; }
                    if (!existing) { v = BuildField(id, type, radius); _fields[id] = v; }
                    // Server coordinates are the scene's own: the shared adapter passes
                    // them through, exactly like collision and player movement.
                    v.Root.position = RoaCoords.ToUnity(Value(row, "x"), Value(row, "y", 0f) + 0.075f, Value(row, "z"));
                    long until = row["dischargedUntil"]?.Value<long?>() ?? 0;
                    bool permanent = row["permanentlyDischarged"]?.Value<bool?>() == true;
                    bool active = !permanent && until <= serverNow && row["active"]?.Value<bool?>() != false;
                    if (existing && revision > v.Revision && !active) React(v, Time.unscaledTime);
                    v.Revision = revision;
                    v.ServerStamp = serverNow;
                    v.PermanentlyDischarged = permanent;
                    // Explicit inactive with no deadline stays inactive; never invent
                    // a reactivation when the server omitted its timer.
                    v.ActiveAgainAt = permanent || (!active && until <= serverNow)
                        ? float.PositiveInfinity : Time.unscaledTime + Mathf.Max(0f, (until - serverNow) / 1000f);
                    v.Active = active;
                    if (!existing) v.Activity = active ? 1f : 0f;
                }
            }
            var stale = new List<string>();
            foreach (string id in _fields.Keys) if (!seen.Contains(id)) stale.Add(id);
            foreach (string id in stale) DestroyField(id);
        }

        public void ApplyExposure(JObject payload)
        {
            if (payload == null || payload["roomId"]?.ToString() != _roomId) return;
            string id = payload["anomalyId"]?.ToString() ?? "";
            if (_fields.TryGetValue(id, out FieldView v) && v.Active && Time.unscaledTime - v.PulseAt > 0.45f)
                React(v, Time.unscaledTime);
        }

        private void React(FieldView view, float time)
        {
            view.PulseAt = time; ReactionCount++;
            if (view.Audio != null && view.Audio.isActiveAndEnabled) view.Audio.PlayOneShot(view.Audio.clip, 0.65f);
        }

        private void Update()
        {
            if(!_localWorldActive)return;
            if (_camera == null) _camera = Camera.main;
            UpdatePresentationBudget();
            float now = Time.unscaledTime;
            foreach (FieldView v in _fields.Values)
            {
                if (!v.Active && !v.PermanentlyDischarged && now >= v.ActiveAgainAt) v.Active = true;
                if (v.Low != LowQuality) RebuildParticleBudget(v);
                v.Activity = Mathf.MoveTowards(v.Activity, v.Active ? 1f : 0f, Time.unscaledDeltaTime * 3f);
                v.MotionTime += Time.unscaledDeltaTime * v.Activity;
                Animate(v, now);
            }
        }

        private FieldView BuildField(string id, string type, float radius)
        {
            var root = new GameObject("Anomaly_" + id).transform; root.SetParent(_worldRoot, false);
            var v = new FieldView { Id = id, Type = type, Radius = radius, Root = root,
                Seed = StableHash(id) % 10000 / 100f, Active = true };
            Color tint = TypeColor(type);
            v.Surface = FieldMaterial(type, 0, tint);
            v.Surface.SetFloat("_Seed", v.Seed);
            v.MistMaterial = FieldMaterial(type, 1, AtmosphereColor(type));
            v.SparkMaterial = FieldMaterial(type, 2, tint * 1.6f);
            var floor = new GameObject("HazardBoundary_PermanentCue_GroundScarring");
            floor.transform.SetParent(root, false); floor.transform.localScale = new Vector3(radius, 1, radius);
            floor.AddComponent<MeshFilter>().sharedMesh = _groundMesh;
            v.Ground = floor.AddComponent<MeshRenderer>(); v.Ground.sharedMaterial = v.Surface;
            ConfigureRenderer(v.Ground);
            v.Mist = CreateParticles(root, "AdvectedAtmosphere", v.MistMaterial, false);
            v.Sparks = CreateParticles(root, "EmbersAndDischarge", v.SparkMaterial, false);
            v.Debris = CreateParticles(root, "PermanentCue_LevitatingShards", _debrisMaterial, true);
            v.MistRenderer = v.Mist.GetComponent<ParticleSystemRenderer>();
            v.SparkRenderer = v.Sparks.GetComponent<ParticleSystemRenderer>();
            v.DebrisRenderer = v.Debris.GetComponent<ParticleSystemRenderer>();
            RebuildParticleBudget(v);
            if (type == "chime" || type == "seam")
            {
                int branches = type == "chime" ? 6 : 2;
                for (int i = 0; i < branches * 2; i++)
                {
                    var line = new GameObject(i % 2 == 0 ? "ArcCorona" : "ArcFilament").AddComponent<LineRenderer>();
                    line.transform.SetParent(root, false); line.useWorldSpace = false;
                    line.positionCount = v.ArcPoints.Length; line.sharedMaterial = _arcMaterial;
                    line.numCornerVertices = 2; line.numCapVertices = 2;
                    ConfigureRenderer(line); v.Arcs.Add(line);
                }
            }
            BuildAudio(v);
            BuildVolume(v);
            return v;
        }

        private void RebuildParticleBudget(FieldView v)
        {
            v.Low = LowQuality;
            v.MistBuffer = new ParticleSystem.Particle[v.Low ? 24 : 64];
            v.SparkBuffer = new ParticleSystem.Particle[v.Low ? 14 : 36];
            v.DebrisBuffer = new ParticleSystem.Particle[v.Low ? 5 : 10];
            foreach (ParticleSystem ps in new[] { v.Mist, v.Sparks, v.Debris })
            { var main = ps.main; main.maxParticles = v.Low ? 48 : 100; }
        }

        private void Animate(FieldView v, float time)
        {
            float t = time + v.Seed;
            float pulseAge = time - v.PulseAt;
            float pulse = Mathf.Exp(-Mathf.Max(0, pulseAge) * 4f);
            float energy = v.Activity + pulse * 1.6f;
            v.Surface.SetFloat("_Activity", v.Activity); v.Surface.SetFloat("_Pulse", pulse);
            v.Surface.SetFloat("_PulseAge", Mathf.Max(0, pulseAge));
            bool near = _camera == null || Vector3.SqrMagnitude(_camera.transform.position - v.Root.position) < (v.Low ? 2500f : 6400f);
            AnimateVolume(v, time, pulse, pulseAge, near);
            v.MistRenderer.enabled = near; v.SparkRenderer.enabled = near; v.DebrisRenderer.enabled = near;
            foreach (var arc in v.Arcs) arc.enabled = near;
            float hearing = RoaAudio.Active != null ? RoaAudio.Active.HearingMultiplier : 1f;
            v.Audio.maxDistance = Mathf.Max(10f, v.Radius * 5f) * hearing;
            v.Audio.volume = Mathf.Lerp(0.004f, v.Type == "mute" ? 0.026f : 0.065f, v.Activity);
            v.Audio.pitch = Mathf.Lerp(0.62f, 1f, v.Activity) + pulse * 0.12f;
            if (!near) return;
            for (int i = 0; i < v.MistBuffer.Length; i++)
            {
                float seed = i * 2.399963f + v.Seed;
                float u = Mathf.Repeat(t * (v.Type == "pull" ? .24f : .10f) + i * .618034f, 1f);
                float angle = seed + t * .12f;
                float r = Mathf.Sqrt(Mathf.Repeat(i * .618034f, 1f)) * v.Radius * .84f;
                float height = .14f + u * .8f;
                float size = v.Radius * .48f;
                float alpha = .3f * Mathf.Sin(u * Mathf.PI) * energy * (v.Low ? 2.1f : .85f);
                switch (v.Type)
                {
                    case "pull": r = v.Radius * (1f-u) * .86f; angle = seed - u * 3.8f; height = .12f + u*u*1.45f; size *= .8f; break;
                    case "seam": r *= .25f; height = .15f + u*.45f; size *= .34f; alpha *= .7f; break;
                    case "carousel": angle = seed + t*.95f - u*5f; r = v.Radius * (.22f+u*.53f); height = .2f + u*2.1f; size *= .85f; break;
                    case "glass": height = .15f + u*1.35f; size *= .55f; alpha *= .75f; break;
                    case "dew": height = .15f + u*.9f; size *= 1.15f; alpha *= 1.1f; break;
                    case "sink": r = v.Radius*(1f-u)*.87f; height = .1f+(1-u)*.25f; size *= .8f; break;
                    case "chime": height = .13f+u*.55f; size *= .4f; alpha *= .5f; break;
                    case "mute": angle = seed-t*.5f; r *= .72f; height = .1f+u*1.9f; size *= 1.1f; alpha *= 1.2f; break;
                }
                Vector3 pos = new Vector3(Mathf.Cos(angle)*r, height, Mathf.Sin(angle)*r);
                if (v.Type == "seam") pos = new Vector3((Mathf.Repeat(i*.618f,1f)*2-1)*v.Radius*.9f, height, Mathf.Sin(seed)*.16f);
                float shade = v.Type == "mute" && i % 3 != 0 ? .13f : .78f + .22f*Mathf.Sin(seed);
                Color color = new Color(shade,shade,shade,alpha);
                SetParticle(ref v.MistBuffer[i], pos, size*(v.Low ? 1.12f : 1f), color, seed*50f + t*8f);
            }
            v.Mist.SetParticles(v.MistBuffer, v.MistBuffer.Length);
            for (int i = 0; i < v.SparkBuffer.Length; i++)
            {
                float seed = i*2.399963f+v.Seed, u = Mathf.Repeat(t*.28f + i*.618034f,1f);
                float angle = seed+t*.3f, r=v.Radius*Mathf.Sqrt(Mathf.Repeat(i*.37f,1f))*.85f;
                float y = .2f + u * (v.Type=="glass" ? 2.1f : 1.2f);
                if (v.Type=="pull" || v.Type=="sink") { r=v.Radius*(1-u)*.9f; y=.13f; }
                if (v.Type=="carousel") { angle=seed+t*1.3f; y=.2f+u*1.5f; }
                if (v.Type=="mute") { angle=seed-t*.6f; y=1.5f-u*1.3f; }
                Vector3 position = new Vector3(Mathf.Cos(angle)*r,y,Mathf.Sin(angle)*r);
                if (v.Type=="seam") position = new Vector3(Mathf.Sin(seed)*v.Radius*.9f,y*.4f,Mathf.Cos(seed)*.12f);
                // Half the motes become an actual expanding/inward transient, not
                // an unrelated pulse at the requested bolt endpoint.
                if (pulseAge >= 0 && pulseAge < 1.1f && i % 2 == 0) {
                    float flight = pulseAge, speed = 1.8f + Mathf.Repeat(seed, 1f)*2.5f;
                    float travel = flight*speed;
                    float burstRadius = v.Type=="pull" || v.Type=="sink" || v.Type=="mute"
                        ? Mathf.Max(0, v.Radius*.85f-travel) : Mathf.Min(v.Radius*.95f, .15f+travel);
                    position = new Vector3(Mathf.Cos(seed)*burstRadius,
                        .12f + Mathf.Max(0, flight*(v.Type=="dew" ? 3.2f : 5f)-flight*flight*4f), Mathf.Sin(seed)*burstRadius);
                    if (v.Type=="seam") position.z *= .12f;
                }
                float opacity = Mathf.Sin(u*Mathf.PI) * (.7f*v.Activity + pulse);
                float size = v.Type=="dew" ? .085f : v.Type=="mute" ? .08f : .055f;
                Color color = v.Type=="mute" ? new Color(.4f,.46f,.58f,opacity) : new Color(1,1,1,opacity);
                SetParticle(ref v.SparkBuffer[i],position,size*(1+pulse*1.7f),color,seed*25f);
            }
            v.Sparks.SetParticles(v.SparkBuffer,v.SparkBuffer.Length);
            bool shards = v.Type=="pull" || v.Type=="carousel" || v.Type=="glass" || v.Type=="chime";
            for (int i=0;i<v.DebrisBuffer.Length;i++)
            {
                float seed = i*2.399963f+v.Seed, angle = seed + v.MotionTime*(v.Type=="carousel" ? .9f : -.15f);
                float r=v.Radius*(.48f+.22f*Mathf.Sin(seed));
                float y = .14f+v.Activity*(.15f+.75f*(.5f+.5f*Mathf.Sin(t+i)));
                if (v.Type=="chime") { angle=seed; y=.1f; }
                SetParticle(ref v.DebrisBuffer[i],new Vector3(Mathf.Cos(angle)*r,y,Mathf.Sin(angle)*r),
                    shards ? .15f + i%3*.06f : 0f, new Color(.65f,.67f,.63f,1), seed*57f+v.MotionTime*25f);
                v.DebrisBuffer[i].rotation3D=new Vector3(seed*57f+v.MotionTime*25f,seed*31f+v.MotionTime*17f,seed*77f);
            }
            v.Debris.SetParticles(v.DebrisBuffer,v.DebrisBuffer.Length);
            int frame = Mathf.FloorToInt(t*(v.Low ? 9 : 16));
            if (frame != v.ArcFrame) { v.ArcFrame=frame; AnimateArcs(v,t,frame,energy); }
        }

        private void AnimateArcs(FieldView v, float t, int frame, float energy)
        {
            for (int branch=0;branch<v.Arcs.Count/2;branch++)
            {
                Vector3 from, to;
                if (v.Type=="seam") { from=new Vector3(-v.Radius*.92f,.13f,branch*.14f); to=new Vector3(v.Radius*.92f,.13f,-branch*.14f); }
                else {
                    float a=branch*2.1f + v.Seed + Mathf.Floor(frame/5f)*.67f;
                    from = new Vector3(Mathf.Sin(t*.7f)*.2f,.9f+Mathf.Sin(t)*.17f,Mathf.Cos(t*.4f)*.2f);
                    to = new Vector3(Mathf.Cos(a)*v.Radius*.8f,.15f,Mathf.Sin(a)*v.Radius*.8f);
                    if(branch>=4) from=Vector3.Lerp(from,to,.45f)+Vector3.up*.25f;
                }
                for(int i=0;i<v.ArcPoints.Length;i++) {
                    float u=i/(float)(v.ArcPoints.Length-1);
                    float jitter=Mathf.Sin(i*12.9898f+frame*4.14f+branch*8.3f)*Mathf.Sin(u*Mathf.PI);
                    v.ArcPoints[i]=Vector3.Lerp(from,to,u)+new Vector3(jitter*.13f,Mathf.Sin(u*Mathf.PI)*(.25f+Mathf.Abs(jitter)*.42f),jitter*.2f);
                }
                for(int layer=0;layer<2;layer++) {
                    var arc=v.Arcs[branch*2+layer]; arc.SetPositions(v.ArcPoints);
                    float blink=v.Type=="chime" && (frame+branch*3)%11>6 ? .12f : 1f;
                    Color c=layer==0 ? TypeColor(v.Type)*1.7f : new Color(2.8f,2.9f,3.1f,1);
                    c.a=(layer==0 ? .27f : .87f)*Mathf.Clamp01(energy)*blink;
                    arc.startColor=arc.endColor=c;
                    arc.startWidth=arc.endWidth=(layer==0 ? .11f : .012f)*(1+Mathf.Max(0,energy-1));
                }
            }
        }

        private static void SetParticle(ref ParticleSystem.Particle p,Vector3 pos,float size,Color color,float rotation)
        { p.position=pos; p.startSize=size; p.startColor=color; p.rotation=rotation; p.startLifetime=10; p.remainingLifetime=10; }

        private ParticleSystem CreateParticles(Transform root,string name,Material mat,bool mesh)
        {
            var ps=new GameObject(name).AddComponent<ParticleSystem>(); ps.transform.SetParent(root,false);
            ps.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
            var main=ps.main; main.playOnAwake=false; main.loop=true; main.startSpeed=0;
            main.startLifetime=10; main.simulationSpace=ParticleSystemSimulationSpace.Local; main.useUnscaledTime=true;
            var emission=ps.emission; emission.enabled=false; var shape=ps.shape; shape.enabled=false;
            var render=ps.GetComponent<ParticleSystemRenderer>(); render.sharedMaterial=mat;
            render.renderMode=mesh ? ParticleSystemRenderMode.Mesh : ParticleSystemRenderMode.Billboard;
            if(mesh) { render.mesh=_shardMesh; main.startRotation3D=true; }
            render.maxParticleSize=.3f; ConfigureRenderer(render); ps.Play();
            return ps;
        }

        private Material FieldMaterial(string type,int layer,Color tint)
        {
            Material template=layer==1 ? Resources.Load<Material>("RealmOfAshes/AnomalyMistTemplate") : null;
            var mat=template!=null ? new Material(template) : new Material(_shader);
            mat.name="Anomaly_"+type+"_Layer"+layer;
            mat.SetColor("_Tint",tint); mat.SetFloat("_Layer",layer); mat.SetFloat("_Kind",Kind(type));
            mat.SetFloat("_Seed",StableHash(type)%1000*.01f); return mat;
        }

        private void EnsureResources()
        {
            if (_worldRoot==null) { _worldRoot=new GameObject("KromkaAnomalyFields_Runtime").transform; _worldRoot.SetParent(transform,false); _worldRoot.gameObject.SetActive(_localWorldActive && isActiveAndEnabled); }
            if (_shader==null) _shader=Resources.Load<Shader>("RealmOfAshes/AnomalyField") ?? Shader.Find("RealmOfAshes/AnomalyField");
            if (_shader==null) throw new InvalidOperationException("AnomalyField shader missing from Resources.");
            EnsureVolumeResources();
            if (_groundMesh==null)
            {
                _groundMesh=new Mesh { name="AnomalyUnitGround" };
                _groundMesh.vertices=new[]{new Vector3(-1,0,-1),new Vector3(1,0,-1),new Vector3(1,0,1),new Vector3(-1,0,1)};
                _groundMesh.uv=new[]{Vector2.zero,Vector2.right,Vector2.one,Vector2.up};
                _groundMesh.colors=new[]{Color.white,Color.white,Color.white,Color.white};
                _groundMesh.triangles=new[]{0,2,1,0,3,2}; _groundMesh.RecalculateNormals();
                _shardMesh=new Mesh { name="AnomalyFracturedStone" };
                _shardMesh.vertices=new[]{new Vector3(-.48f,-.21f,-.4f),new Vector3(.5f,-.24f,-.32f),new Vector3(.4f,.2f,-.31f),new Vector3(-.36f,.26f,-.45f),
                    new Vector3(-.4f,-.17f,.28f),new Vector3(.42f,-.22f,.37f),new Vector3(.38f,.27f,.31f),new Vector3(-.46f,.14f,.36f)};
                _shardMesh.triangles=new[]{0,2,1,0,3,2,1,2,6,1,6,5,5,6,7,5,7,4,4,7,3,4,3,0,3,7,6,3,6,2,4,0,1,4,1,5};
                _shardMesh.RecalculateNormals();
                _arcMaterial=FieldMaterial("chime",4,Color.white); _arcMaterial.name="AnomalyArcHDR"; _arcMaterial.renderQueue=3015;
                _debrisMaterial=new Material(Shader.Find("Universal Render Pipeline/Lit")) { name="AnomalyDebris" };
                _debrisMaterial.color=new Color(.28f,.31f,.29f);
            }
        }

        private static int Kind(string type)
        {
            switch(type) { case "pull":return 0; case "seam":return 1; case "carousel":return 2; case "glass":return 3;
                case "dew":return 4; case "sink":return 5; case "chime":return 6; case "mute":return 7; default:return 0; }
        }
        private static Color TypeColor(string type)
        {
            switch(type) { case "pull":return new Color(.58f,.43f,.25f); case "seam":return new Color(1.9f,.43f,.18f);
                case "carousel":return new Color(.7f,.65f,.46f); case "glass":return new Color(2.0f,.84f,.25f);
                case "dew":return new Color(.36f,.75f,.25f); case "sink":return new Color(.75f,.43f,.21f);
                case "chime":return new Color(.24f,1.25f,2.4f); case "mute":return new Color(.36f,.32f,.65f);
                default:return Color.white; }
        }
        private static Color AtmosphereColor(string type)
        {
            switch (type) {
                case "dew": return new Color(.28f,.57f,.16f);
                case "glass": return new Color(.85f,.53f,.3f);
                case "seam": return new Color(.55f,.27f,.16f);
                case "chime": return new Color(.3f,.65f,.82f);
                case "mute": return new Color(.39f,.44f,.52f);
                default: return new Color(.52f,.48f,.37f);
            }
        }
        private static uint StableHash(string value)
        { uint h=2166136261; foreach(char c in value) h=unchecked((h^c)*16777619); return h; }
        private void BuildAudio(FieldView v)
        {
            if(!_clips.TryGetValue(v.Type,out AudioClip clip))
            {
                const int rate=12000; var data=new float[rate*2]; uint state=StableHash(v.Type); float filtered=0;
                float frequency=v.Type=="chime" ? 120 : v.Type=="seam" ? 85 : 38+Kind(v.Type)*4;
                for(int i=0;i<data.Length;i++) {
                    state=unchecked(state*1664525+1013904223); float n=(state&65535)/32767.5f-1;
                    filtered=Mathf.Lerp(filtered,n,v.Type=="dew" ? .3f : .055f);
                    float t=i/(float)rate, fade=Mathf.Min(1,i/120f,(data.Length-1-i)/120f);
                    data[i]=(filtered*.35f+Mathf.Sin(t*frequency*Mathf.PI*2)*.12f)*fade;
                }
                clip=AudioClip.Create("AnomalyAmbience_"+v.Type,data.Length,1,rate,false); clip.SetData(data,0); _clips[v.Type]=clip;
            }
            var source=v.Root.gameObject.AddComponent<AudioSource>(); source.clip=clip; source.loop=true;
            source.playOnAwake=false; source.spatialBlend=1; source.rolloffMode=AudioRolloffMode.Linear;
            source.minDistance=1.2f; source.maxDistance=Mathf.Max(10,v.Radius*5); source.dopplerLevel=0; source.volume=.06f;
            if(v.Root.gameObject.activeInHierarchy)source.Play(); v.Audio=source;
        }
        private static void ConfigureRenderer(Renderer r)
        { r.shadowCastingMode=ShadowCastingMode.Off; r.receiveShadows=false; r.lightProbeUsage=LightProbeUsage.Off; r.reflectionProbeUsage=ReflectionProbeUsage.Off; }
        private static void Release(UnityEngine.Object obj)
        { if(obj==null)return; if(Application.isPlaying) Destroy(obj); else DestroyImmediate(obj); }
        private void DestroyField(string id)
        {
            if(!_fields.TryGetValue(id,out FieldView v))return;
            if(v.Root!=null) { v.Root.gameObject.SetActive(false); Release(v.Root.gameObject); }
            Release(v.Surface); Release(v.MistMaterial); Release(v.SparkMaterial); _fields.Remove(id);
            ReleaseVolume(v);
        }
        private void ClearFields() { foreach(string id in new List<string>(_fields.Keys))DestroyField(id); }
        private void Unsubscribe()
        { if(_socket==null)return; _socket.OnAnomalyState-=ApplyAnomalyState; _socket.OnPlayerDamaged-=ApplyExposure; }
        private void OnDestroy()
        {
            Unsubscribe(); ClearFields(); foreach(AudioClip clip in _clips.Values)Release(clip); _clips.Clear();
            Release(_groundMesh); Release(_shardMesh); Release(_arcMaterial); Release(_debrisMaterial); Release(_worldRoot!=null ? _worldRoot.gameObject : null);
            ReleaseVolumeResources();
        }
        private static float Value(JObject source,string key,float fallback=0)
        { float value=source?[key]?.Value<float?>()??fallback; return float.IsNaN(value)||float.IsInfinity(value)?fallback:value; }
    }
}
