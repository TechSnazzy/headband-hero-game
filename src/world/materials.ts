import * as THREE from 'three';

/**
 * Materials for the static world. A small shader patch adds Minecraft-style
 * "texel" variation (a few shades per 1/8 m pixel) and, on terrain, slightly
 * darker block edges, so flat-colored faces read as dirt, grass, wood and stone
 * instead of plastic. Characters keep the plain voxel material.
 */

export const worldUniforms = {
  uTime: { value: 0 },
};

function patchDetail(mat: THREE.Material, texelsPerMeter: number, blockEdges: boolean): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vDetailPos;\nvarying vec3 vDetailNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDetailNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vDetailPos;
        varying vec3 vDetailNormal;
        float dHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 an = abs(vDetailNormal);
          bool top = an.y > 0.5;
          vec2 uv = top ? vDetailPos.xz : (an.x > 0.5 ? vDetailPos.zy : vDetailPos.xy);
          vec2 cell = floor(uv * ${texelsPerMeter.toFixed(1)} + 0.001);
          float h = dHash(cell);
          float h2 = dHash(floor(uv * ${(texelsPerMeter / 3).toFixed(2)}) + 17.0);
          float shade = 0.88 + 0.15 * h + 0.07 * (h2 - 0.5);
          ${
            blockEdges
              ? `vec2 f = fract(top ? uv : uv * vec2(1.0, 2.0));
          float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          shade *= mix(0.84, 1.0, smoothstep(0.0, 0.07, e));`
              : ''
          }
          diffuseColor.rgb *= shade;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `detail-${texelsPerMeter}-${blockEdges}`;
}

let propMat: THREE.MeshLambertMaterial | null = null;

/** Shared vertex-colored material for props (trees, tents, crates, towers...). */
export function worldMaterial(): THREE.MeshLambertMaterial {
  if (!propMat) {
    propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    patchDetail(propMat, 10, false);
  }
  return propMat;
}

/** Terrain material: texel detail plus darker block edges. */
export function terrainMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchDetail(m, 8, true);
  return m;
}

/** Makes instanced grass blades bend in the wind. */
export function patchGrassWind(mat: THREE.Material): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float gust = sin(uTime * 0.6 + ip.x * 0.05) * 0.5 + 0.5;
          float sway = sin(uTime * 1.9 + ip.x * 0.35 + ip.z * 0.27) * (0.07 + 0.1 * gust)
                     + sin(uTime * 3.3 + ip.z * 0.9) * 0.025;
          transformed.x += sway * position.y;
          transformed.z += sway * 0.6 * position.y;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'grass-wind';
}
