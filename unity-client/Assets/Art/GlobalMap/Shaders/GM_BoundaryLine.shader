Shader "Universal Render Pipeline/Realm of Ashes/Global Map Boundary Line"
{
    // Пунктир границы мира: штрихи медленно бегут вдоль периметра и мягко
    // пульсируют — «живой» карантинный периметр перед стеной бури. Клик за
    // границу поджигает красную вспышку в ближайшей точке линии: рантайм
    // ставит _FlashCenter/_FlashStart через MaterialPropertyBlock, затухание
    // шейдер считает сам от _Time — обновлений по кадрам не нужно.
    Properties
    {
        _BaseMap ("Dash", 2D) = "white" {}
        _BaseColor ("Color", Color) = (1, 0.72, 0.22, 0.85)
        _ScrollSpeed ("Scroll (штрихов/сек)", Float) = 0.5
        _PulseSpeed ("Pulse speed", Float) = 0.9
        _PulseAmount ("Pulse amount", Range(0, 1)) = 0.28
        _FlashColor ("Flash color", Color) = (1, 0.22, 0.12, 1)
        _FlashCenter ("Flash center (мир)", Vector) = (0, 0, 0, 0)
        _FlashStart ("Flash start time", Float) = -100
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "Queue" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
        }

        Pass
        {
            Name "Unlit"
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #pragma multi_compile_fog

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                float _ScrollSpeed;
                float _PulseSpeed;
                half _PulseAmount;
                half4 _FlashColor;
                float4 _FlashCenter;
                float _FlashStart;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                half fogFactor : TEXCOORD2;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs positions = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = positions.positionCS;
                output.positionWS = positions.positionWS;
                output.uv = input.uv;
                output.fogFactor = ComputeFogFactor(positions.positionCS.z);
                return output;
            }

            half4 Frag(Varyings input) : SV_Target
            {
                float2 uv = input.uv;
                uv.x += _Time.y * _ScrollSpeed;
                half dash = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, uv).a;

                half pulse = 1.0h - _PulseAmount
                    * (0.5h + 0.5h * sin(_Time.y * _PulseSpeed * 6.2831853h));

                // Вспышка отказа: локальная по месту клика, гаснет за ~0.9 с.
                float flashAge = _Time.y - _FlashStart;
                float distance2 = dot(input.positionWS.xz - _FlashCenter.xz,
                    input.positionWS.xz - _FlashCenter.xz);
                half flash = saturate(1.0h - flashAge / 0.9h)
                    * saturate(1.0h - distance2 / 64.0h);

                half3 color = lerp(_BaseColor.rgb, _FlashColor.rgb,
                    saturate(flash * 1.4h));
                half alpha = dash * saturate(_BaseColor.a * pulse + flash);
                color = MixFog(color, input.fogFactor);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
