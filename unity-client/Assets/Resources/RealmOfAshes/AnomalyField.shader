Shader "RealmOfAshes/AnomalyField"
{
    Properties
    {
        [HDR] _Tint("Tint", Color) = (0.5,0.8,1,1)
        _Kind("Field kind", Float) = 0
        _Layer("Ground / mist / spark", Float) = 0
        _Activity("Activity", Float) = 1
        _Pulse("Discharge", Float) = 0
        _PulseAge("Discharge age", Float) = 10
        _Seed("Phase", Float) = 0
        _SmokeTex("Authored smoke detail", 2D) = "white" {}
        _UseSmoke("Use authored smoke", Float) = 0
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+5" "RenderType"="Transparent" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            CBUFFER_START(UnityPerMaterial)
                float4 _Tint;
                float _Kind, _Layer, _Activity, _Pulse, _PulseAge, _Seed, _UseSmoke;
            CBUFFER_END
            TEXTURE2D(_SmokeTex); SAMPLER(sampler_SmokeTex);
            struct Attributes { float4 positionOS:POSITION; float2 uv:TEXCOORD0; half4 color:COLOR; };
            struct Varyings { float4 positionCS:SV_POSITION; float2 uv:TEXCOORD0; half4 color:COLOR; float fog:TEXCOORD1; };
            Varyings vert(Attributes v)
            {
                Varyings o; o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.uv = v.uv; o.color = v.color; o.fog = ComputeFogFactor(o.positionCS.z); return o;
            }
            float hash(float2 p) { return frac(sin(dot(p,float2(127.1,311.7))) * 43758.5453); }
            float noise(float2 p)
            {
                float2 i=floor(p), f=frac(p); f=f*f*(3.-2.*f);
                return lerp(lerp(hash(i),hash(i+float2(1,0)),f.x),lerp(hash(i+float2(0,1)),hash(i+1),f.x),f.y);
            }
            float fbm(float2 p) { return noise(p)*.57 + noise(p*2.07+4.1)*.28 + noise(p*4.19-7.6)*.15; }
            half4 frag(Varyings i):SV_Target
            {
                float2 p=i.uv*2.-1.; float r=length(p); float t=_Time.y + _Seed;
                float activity=saturate(_Activity), pulse=saturate(_Pulse);
                if (_Layer > 3.5) { // continuous, soft-edged lightning corona
                    float w=abs(p.y), halo=exp(-w*w*7.), core=exp(-w*24.);
                    return half4(MixFog(_Tint.rgb*i.color.rgb*(.8+core*2.),i.fog),halo*i.color.a*_Tint.a);
                }
                if (_Layer > 2.5) { // UV-aligned, tapered 3D flow ribbon
                    float width=abs(p.y);
                    float grain=fbm(float2(i.uv.x*11.-t*.35, i.uv.y*2.+_Seed));
                    float taper=pow(saturate(sin(i.uv.x*3.14159)),.6);
                    bool hot=(_Kind> .5 && _Kind<1.5) || (_Kind>5.5 && _Kind<6.5);
                    float filaments=pow(saturate(1.-width),hot ? 3. : 1.7)*smoothstep(.26,.68,grain);
                    float core=hot ? exp(-width*24.)*smoothstep(.34,.7,grain) : 0.;
                    half3 color=_Tint.rgb*i.color.rgb*(.5+filaments*1.8)+core*.45;
                    return half4(MixFog(color,i.fog),saturate(filaments*taper*i.color.a*_Tint.a));
                }
                if (_Layer > .5)
                {
                    float soft=pow(saturate(1.-dot(p,p)),1.8);
                    float grain=fbm(p*3.4+float2(t*.13,-t*.09));
                    float smoke=1.-SAMPLE_TEXTURE2D(_SmokeTex,sampler_SmokeTex,i.uv).r;
                    grain=lerp(grain,smoke*(.9+grain*.4),_UseSmoke);
                    float alpha=soft * smoothstep(.16,.8,grain) * i.color.a * _Tint.a;
                    float core=_Layer>1.5 ? pow(saturate(1.-r),5.)*2.5 : 0.;
                    half3 color=_Tint.rgb*i.color.rgb + core;
                    return half4(MixFog(color,i.fog), alpha);
                }
                clip(1.-r);
                float edge=(1.-smoothstep(.68,1.,r));
                float angle=atan2(p.y,p.x);
                float n=fbm(p*5. + _Seed);
                float flow=fbm(p*4. + float2(t*.12,-t*.07));
                float veins=pow(saturate(1.-abs(noise(p*10.+_Seed)-.5)*13.),3.);
                float pattern=0., glow=0.;
                if (_Kind<.5) { // gravitational inflow: dark throat, converging dusty arms
                    pattern=flow*.4+exp(-r*r*8.)*.6;
                    glow=0.;
                } else if (_Kind<1.5) { // seam: narrow unstable cut with scorched branching edges
                    float cut=abs(p.y + (noise(float2(p.x*7.,_Seed))-.5)*.18);
                    glow=exp(-cut*100.)*1.8 + exp(-cut*18.)*.18;
                    pattern=exp(-cut*12.) + veins*.14;
                } else if (_Kind<2.5) {
                    pattern=flow*.45;
                    glow=0.;
                } else if (_Kind<3.5) {
                    pattern=veins*.3 + flow*.25;
                    glow=veins*.18*exp(-r*r*4.);
                } else if (_Kind<4.5) {
                    pattern=smoothstep(.35,.72,flow);
                    glow=pattern*.13;
                } else if (_Kind<5.5) {
                    float cracks=pow(saturate(1.-abs(noise(float2(angle*5.,r*3.)+_Seed)-.5)*17.),4.);
                    pattern=cracks*smoothstep(.2,.6,r) + flow*.15;
                    glow=pattern*.04;
                } else if (_Kind<6.5) {
                    pattern=veins*.14;
                    glow=0.;
                } else {
                    pattern=exp(-r*r*5.)*.45+flow*.18;
                    glow=0.;
                }
                float boundary=exp(-abs(r-.9)*55.)*smoothstep(.45,.72,n)*.14;
                float wave=exp(-abs(r-saturate(_PulseAge*2.8))*28.) * pulse;
                half3 soot=half3(.032,.037,.033)*(1.+n*1.2);
                half3 color=soot + _Tint.rgb*(glow*activity + boundary*(.25+.75*activity) + (wave+pattern*.3)*pulse*2.5);
                float alpha=(.04+pattern*.4+boundary+glow*.35)*edge;
                alpha=saturate(alpha + pulse*edge*.17);
                return half4(MixFog(color,i.fog),alpha);
            }
            ENDHLSL
        }
    }
}
