import * as THREE from "three";

export interface RevealUniforms {
  uReveal: { value: number };
}

export function createRevealUniforms(): RevealUniforms {
  return { uReveal: { value: 0 } };
}

/**
 * 向标准物理材质注入拭纹进度。
 *
 * 未拭区域混入土沁色（锈土）并把金属度压到 0、粗糙度抬到接近全漫反射；
 * 已拭区域保留金属本色与沿长度方向拉长的各向异性高光。
 *
 * 扫掠场取「沿剑长推进 + 宽度方向给倾角」，等值线是一条斜线，
 * 与用布斜擦过去的手感一致。剑身局部坐标 y ∈ [0, 0.858]、x ∈ ±0.017，
 * 因此 x 的系数取得大得多，才能让斜角在视觉上成立。
 *
 * 注：改写后的着色器必须与未改写的区分开，否则程序缓存会错误复用。
 */
export function applyReveal(
  material: THREE.MeshPhysicalMaterial,
  uniforms: RevealUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uniforms.uReveal;

    const fragmentBefore = shader.fragmentShader;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocalPosition;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLocalPosition = position;",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uReveal;\nvarying vec3 vLocalPosition;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float sweep = vLocalPosition.y * 3.4 + vLocalPosition.x * 17.0;
        float verge = mix(-0.45, 3.30, clamp(uReveal, 0.0, 1.0));
        float cleaned = 1.0 - smoothstep(verge - 0.30, verge + 0.30, sweep);
        float patina = 1.0 - cleaned;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.470, 0.356, 0.232), patina * 0.92);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, patina);`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.0, patina);`,
      );

    // 诊断：确认替换是否真的命中（Three.js 的 replace 未匹配时静默通过）
    material.userData.revealDebug = {
      compiled: true,
      fragmentChanged: shader.fragmentShader !== fragmentBefore,
      hasPatina: shader.fragmentShader.includes("patina"),
      hasSweep: shader.fragmentShader.includes("sweep"),
      hasVarying: shader.vertexShader.includes("vLocalPosition"),
      hasColorInclude: fragmentBefore.includes("#include <color_fragment>"),
      hasMetalInclude: fragmentBefore.includes("#include <metalnessmap_fragment>"),
      hasRoughInclude: fragmentBefore.includes("#include <roughnessmap_fragment>"),
    };
  };

  material.customProgramCacheKey = () => "kaogong-reveal-v1";
  material.needsUpdate = true;
}
