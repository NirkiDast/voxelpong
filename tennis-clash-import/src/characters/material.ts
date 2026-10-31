import * as THREE from 'three';

/**
 * The characters' material (character remake): a standard material with three additions
 * that give the soft, toy-like look of the reference render instead of flat plastic:
 *
 * - occlusion baked per vertex from the sculpt (`ao`), darkening creases, the skin under
 *   the skirt and visor, between fingers;
 * - light wrapping round skin and bleeding warm red at the shadow edge (`sss`: 1 on skin,
 *   less on hair and cloth), so skin glows rather than looking like painted wood;
 * - a soft cool rim at grazing angles, which separates the figure from the background;
 * - a soft shoulder on highlights so lit white kit never crosses into bloom.
 */
export function characterMaterial({ voxel = false, ...opts }: THREE.MeshStandardMaterialParameters & { voxel?: boolean } = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0, ...opts });
  // Voxel figures: each block face has coordinates across it (fuv) for a soft bevel.
  if (voxel) mat.defines = { VOXEL: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: new THREE.Color(0x1a2a5a) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nattribute float sss;\nvarying float vAo;\nvarying float vSss;\n#ifdef VOXEL\nattribute vec2 fuv;\nvarying vec2 vFuv;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = ao;\nvSss = sss;\n#ifdef VOXEL\nvFuv = fuv;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAo;\nvarying float vSss;\nuniform vec3 uRim;\n#ifdef VOXEL\nvarying vec2 vFuv;\n#endif')
      .replace('#include <lights_physical_pars_fragment>', PHYSICAL_PARS)
      // Creases in skin read warmer, as in the reference.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef VOXEL
{
  // Soft bevelled block edges: a slight darkening in the seams, a lighter lip inside them.
  vec2 e2 = min(vFuv, 1.0 - vFuv);
  float e = min(e2.x, e2.y);
  // Fades out where blocks are only a few pixels across, so small figures don't shimmer.
  float px = max(fwidth(vFuv.x), fwidth(vFuv.y));
  float k = 1.0 - smoothstep(0.1, 0.3, px);
  float seam = 1.0 - smoothstep(0.0, max(0.07, px * 1.2), e);
  float lip = smoothstep(0.04, 0.1, e) * (1.0 - smoothstep(0.1, 0.2, e));
  diffuseColor.rgb *= 1.0 - k * (0.3 * seam - 0.07 * lip);
}
#endif
diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.72, 0.6), (1.0 - vAo) * vSss);`,
      )
      // Skin turns deeper and warmer toward the silhouette, as in a soft toy render.
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  float facing = saturate(dot(normal, normalize(vViewPosition)));
  float skin = step(0.9, vSss);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.7, 0.6), skin * pow(1.0 - facing, 2.0));
}`,
      )
      // Hair is glossier than skin, cloth the most matte.
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, step(0.3, vSss) * step(vSss, 0.4));',
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vAo;
reflectedLight.indirectSpecular *= vAo;
reflectedLight.directDiffuse *= mix(1.0, vAo, 0.55);
reflectedLight.directSpecular *= mix(1.0, vAo, 0.8);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
  float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0) * (1.0 - 0.8 * vSss);
  outgoingLight += uRim * fres * vAo;
  // Highlights roll off softly below the bloom threshold: white kit under a high sun or
  // floodlights reads bright, never as a glowing blob.
  float peak = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
  if (peak > 0.82) outgoingLight *= (0.82 + 0.16 * (1.0 - exp(-(peak - 0.82) * 3.0))) / peak;
}
#include <opaque_fragment>`,
      );
  };
  // One program for every character material (the shader text is the same).
  mat.customProgramCacheKey = () => (voxel ? 'character-voxel' : 'character');
  return mat;
}

/** The physical lighting functions with wrapped, warm-edged diffuse for skin. */
const PHYSICAL_PARS = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/,
  `float dotNLraw = dot( geometryNormal, directLight.direction );
	// Hair wraps light the most, so a ponytail turned from the key never goes muddy.
	float wrapK = vSss > 0.3 && vSss < 0.4 ? 0.7 : 0.5 * vSss;
	float dotNL = saturate( ( dotNLraw + wrapK ) / ( 1.0 + wrapK ) );
	vec3 irradiance = dotNL * directLight.color;
	// Light scattering under the skin: a warm band along the shadow edge.
	float edge = smoothstep( -0.5, 0.05, dotNLraw ) * ( 1.0 - smoothstep( 0.05, 0.55, dotNLraw ) );
	irradiance += vSss * edge * vec3( 0.32, 0.12, 0.04 ) * directLight.color;`,
);
if (PHYSICAL_PARS === THREE.ShaderChunk.lights_physical_pars_fragment) console.warn('character material: lighting patch did not apply');
