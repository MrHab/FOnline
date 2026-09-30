Shader "RealmOfAshes/Storm Dust"
{
    // Частица бури: мягкое пятно с рваным краем. Вытянутая частица (Stretched
    // Billboard) превращает его в штрих летящего песка. Цвет — в цвете частицы.
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "Queue"="Transparent+12" "RenderType"="Transparent" "IgnoreProjector"="True" }
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
            struct Attributes { float4 positionOS:POSITION; float2 uv:TEXCOORD0; half4 color:COLOR; };
            struct Varyings { float4 positionCS:SV_POSITION; float2 uv:TEXCOORD0; half4 color:COLOR; float fog:TEXCOORD1; };
            Varyings vert(Attributes v)
            {
                Varyings o; o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.uv = v.uv; o.color = v.color; o.fog = ComputeFogFactor(o.positionCS.z); return o;
            }
            half4 frag(Varyings i):SV_Target
            {
                float2 p = i.uv*2. - 1.;
                float ragged = sin(p.x*9. + sin(p.y*7.)*1.7) * sin(p.y*11. + p.x*3.) * 0.14;
                float mask = saturate(1. - dot(p,p) + ragged);
                return half4(MixFog(i.color.rgb, i.fog), i.color.a * mask * mask);
            }
            ENDHLSL
        }
    }
}
