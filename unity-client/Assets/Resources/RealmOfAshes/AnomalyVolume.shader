Shader "RealmOfAshes/AnomalyVolume"
{
    Properties
    {
        _NoiseVolume("Tileable density", 3D) = "white" {}
        _Tint("Scattering tint", Color) = (.5,.45,.36,1)
        [HDR] _Emission("Inner emission", Color) = (1,.5,.2,1)
        _Kind("Kind", Float) = 0
        _Activity("Activity", Float) = 1
        _Pulse("Impulse", Float) = 0
        _Seed("Phase", Float) = 0
        _Distortion("Refraction", Float) = .009
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent-20" "RenderType"="Transparent" }
        Pass
        {
            // Back faces give one integration per pixel, including a camera inside
            // the proxy. Opaque depth clips the integration, not the proxy shell.
            Cull Front ZWrite Off ZTest Always
            Blend SrcAlpha OneMinusSrcAlpha
            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareOpaqueTexture.hlsl"
            TEXTURE3D(_NoiseVolume); SAMPLER(sampler_NoiseVolume);
            CBUFFER_START(UnityPerMaterial)
                float4 _Tint, _Emission;
                float _Kind, _Activity, _Pulse, _Seed, _Distortion;
            CBUFFER_END
            struct A { float4 positionOS:POSITION; };
            struct V { float4 positionCS:SV_POSITION; float3 positionWS:TEXCOORD0; float fog:TEXCOORD1; };
            V vert(A v) {
                V o; o.positionWS=TransformObjectToWorld(v.positionOS.xyz);
                o.positionCS=TransformWorldToHClip(o.positionWS); o.fog=ComputeFogFactor(o.positionCS.z); return o;
            }
            float4 cloud(float3 p) {
                return SAMPLE_TEXTURE3D_LOD(_NoiseVolume,sampler_NoiseVolume,p,0)*.72
                     + SAMPLE_TEXTURE3D_LOD(_NoiseVolume,sampler_NoiseVolume,p*2.13+7.3,0)*.28;
            }
            float density(float3 p, float t, out float heat, out float2 bend) {
                float h=saturate(p.y*.5+.5), r=length(p.xz), a=atan2(p.z,p.x);
                float twist=a-h*5.+t*.8;
                float3 advect=float3(cos(twist)*r,p.y-t*.2,sin(twist)*r);
                float4 n=cloud(advect*.21+_Seed*.07);
                bend=n.gb-.5; heat=0;
                float envelope=(1.-smoothstep(.8,1.,r))*smoothstep(0.,.09,h)*(1.-smoothstep(.78,1.,h));
                float shape=0., grain=smoothstep(.31,.69,n.r);
                if(_Kind<.5) { // hollow inflow column
                    float width=lerp(.83,.14,h);
                    shape=exp(-abs(r-width)*11.)*(.35+.65*grain);
                    shape*=.55+.45*sin(a*3.+h*15.-t*2.);
                } else if(_Kind<1.5) { // an upright torn thermal curtain
                    shape=exp(-abs(p.z+(n.g-.5)*.5)*8.)*(1.-p.x*p.x)*grain;
                    heat=pow(saturate(1.-h),3.)*1.3 + _Pulse*.8;
                } else if(_Kind<2.5) {
                    float width=.24+h*.48;
                    shape=exp(-abs(r-width)*13.)*(.3+grain*.8);
                    shape*=.65+.35*sin(a*4.-h*18.+t*2.5);
                    heat=.055;
                } else if(_Kind<3.5) { // hot rising air, not a lava decal
                    shape=exp(-r*r*3.)*grain*(1.-h)*.65;
                    heat=pow(1.-h,4.)*.7;
                } else if(_Kind<4.5) {
                    shape=saturate(1.-r*r)*grain*(1.-h)*1.4;
                    heat=.11+_Pulse*.7;
                } else if(_Kind<5.5) {
                    shape=exp(-abs(r-(.18+h*.65))*10.)*grain;
                    heat=.03;
                } else if(_Kind<6.5) {
                    float sphere=length(p*float3(1.,1.2,1.));
                    shape=exp(-sphere*sphere*5.)*grain*.45;
                    heat=exp(-sphere*9.)*(3.+_Pulse*10.);
                } else { // negative-pressure lens with cold, turbulent rim
                    float sphere=length(p*float3(1.,1.05,1.));
                    shape=exp(-abs(sphere-.63)*12.)*(.3+grain*.7) + exp(-sphere*7.)*.35;
                    heat=exp(-abs(sphere-.63)*24.)*.12;
                }
                float shock=exp(-abs(length(p*float3(1.,.8,1.))-(1.-_Pulse)*.95)*18.)*_Pulse;
                shape+=shock*.85; heat+=shock*1.4;
                return max(0.,shape*envelope)*(_Activity+_Pulse*.85);
            }
            half4 frag(V i):SV_Target {
                float2 uv=GetNormalizedScreenSpaceUV(i.positionCS);
                float3 rdWS=-normalize(GetWorldSpaceViewDir(i.positionWS));
                float3 roWS=IsPerspectiveProjection() ? GetCameraPositionWS() : i.positionWS-rdWS*500.;
                float3 ro=TransformWorldToObject(roWS);
                float3 rd=normalize(mul((float3x3)unity_WorldToObject,rdWS));
                float3 inv=rcp(rd+sign(rd)*.000001+float3(.0000001,.0000001,.0000001));
                float3 tb0=(-1.-ro)*inv, tb1=(1.-ro)*inv;
                float3 nearT=min(tb0,tb1), farT=max(tb0,tb1);
                float enter=max(0.,max(nearT.x,max(nearT.y,nearT.z)));
                float leave=min(farT.x,min(farT.y,farT.z));
                float raw=SampleSceneDepth(uv);
                #if !UNITY_REVERSED_Z
                    raw=lerp(UNITY_NEAR_CLIP_VALUE,1.,raw);
                #endif
                float3 sceneWS=ComputeWorldSpacePosition(uv,raw,UNITY_MATRIX_I_VP);
                float sceneT=dot(TransformWorldToObject(sceneWS)-ro,rd);
                leave=min(leave,sceneT);
                clip(leave-enter-.0001);
                const int steps=24;
                float stepSize=(leave-enter)/steps;
                // Stable sub-step jitter breaks integration bands without temporal sparkle.
                float jitter=frac(sin(dot(floor(i.positionCS.xy),float2(12.9898,78.233)))*43758.54);
                float transmittance=1., sumDensity=0.; float3 radiance=0.; float2 warp=0.;
                float t=_Time.y+_Seed;
                [loop] for(int s=0;s<steps;s++) {
                    float3 p=ro+rd*(enter+(s+jitter)*stepSize);
                    float heat; float2 bend;
                    float d=density(p,t,heat,bend);
                    float h2; float2 b2;
                    float lit=saturate(.55+(d-density(p+float3(-.12,.18,-.08),t,h2,b2))*2.3);
                    float alpha=1.-exp(-d*stepSize*4.5);
                    float3 c=_Tint.rgb*(.32+lit*.85) + _Emission.rgb*(heat+_Pulse*.28);
                    radiance+=transmittance*alpha*c;
                    warp+=bend*d*stepSize; sumDensity+=d*stepSize;
                    transmittance*=1.-alpha;
                    if(transmittance<.025) break;
                }
                float opacity=1.-transmittance;
                clip(opacity-.001);
                float edgeFade=saturate(min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y))*24.);
                float2 offset=clamp(warp*_Distortion*8.,-.018,.018)*edgeFade;
                // Reject displaced foreground samples: no silhouettes pulled over the field.
                float rawOffset=SampleSceneDepth(saturate(uv+offset));
                #if !UNITY_REVERSED_Z
                    rawOffset=lerp(UNITY_NEAR_CLIP_VALUE,1.,rawOffset);
                #endif
                float3 offsetWS=ComputeWorldSpacePosition(saturate(uv+offset),rawOffset,UNITY_MATRIX_I_VP);
                if(dot(TransformWorldToObject(offsetWS)-ro,rd)<enter) offset=0.;
                float3 warped=SampleSceneColor(saturate(uv+offset));
                float refraction=saturate(sumDensity*1.8)*.65;
                float alpha=saturate(opacity*.78+refraction*.3);
                float3 cloudColor=radiance/max(opacity,.001);
                float3 color=lerp(warped,cloudColor,saturate(opacity*.8));
                return half4(MixFog(color,i.fog),alpha);
            }
            ENDHLSL
        }
    }
}
