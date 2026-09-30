Shader "RealmOfAshes/Storm Wall"
{
    // Стена радиационной бури: клубящаяся пыль, у земли — зелёное свечение.
    // uv.x — координата вдоль фронта, привязанная к карте (узор не едет вместе с
    // игроком), uv.y — высота 0..1. Цвет и прозрачность слоя — в цвете вершин.
    // Этим же шейдером рисуется полоса бури на карте мира (uv.y — поперёк полосы).
    Properties
    {
        _DustColor("Dust", Color) = (0.24,0.23,0.16,1)
        _GlowColor("Glow", Color) = (0.55,1,0.32,1)
        _Scroll("Scroll", Vector) = (0.06,0.32,0,0)
        _NoiseScale("Noise scale", Vector) = (3,2.2,0,0)
        _Glow("Glow", Float) = 0.7
        _TopFade("Top fade", Float) = 1
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+10" "RenderType"="Transparent" "IgnoreProjector"="True" }
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
                float4 _DustColor, _GlowColor, _Scroll, _NoiseScale;
                float _Glow, _TopFade;
            CBUFFER_END
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
            float fbm(float2 p) { return noise(p)*.52 + noise(p*2.03+4.1)*.27 + noise(p*4.11-7.6)*.14 + noise(p*8.3+2.7)*.07; }
            half4 frag(Varyings i):SV_Target
            {
                float t = _Time.y;
                float2 p = i.uv * _NoiseScale.xy;
                float n = fbm(p + float2(t*_Scroll.x, -t*_Scroll.y));
                float m = fbm(p*1.87 + float2(-t*_Scroll.x*1.6, -t*_Scroll.y*1.35) + n*1.4);
                float density = saturate(n*0.8 + m*0.6 - 0.05);
                float top = lerp(1., 1. - smoothstep(0.5 + m*0.3, 1., i.uv.y), _TopFade);
                float bottom = smoothstep(0., 0.035, i.uv.y);
                float alpha = saturate(density * 1.75) * top * bottom * i.color.a;
                // Свечение: прожилки в нижней части стены, будто радиация светит сквозь пыль.
                float glow = pow(saturate(m*1.35 - 0.42), 2.) * 3. * saturate(1.15 - i.uv.y) * _Glow;
                float3 dust = _DustColor.rgb * (0.45 + 0.8*n);
                float3 color = lerp(dust, _GlowColor.rgb, saturate(glow)) * i.color.rgb;
                return half4(MixFog(color, i.fog), alpha);
            }
            ENDHLSL
        }
    }
}
