import * as THREE from 'three'
import { COMMON, SKY, TONE, outdoorUniforms } from '../../materials'

/**
 * ガーデンドームの透けるガラスの半球（中を作っている間、町の不透明なドームの形の代わり）。
 * 主な骨（大アーチ 16・輪 5）は外観の白い鋼管（named/kits/observatory.ts）が作るので、ここはその間の細い斜めの格子（ダイヤグリッド）と
 * 合わせガラスの継ぎ目、ガラスの映り込み（外から: 空と太陽・中から: 部屋の明るさのうっすらした映り込み）。夕方からは格子が金緑色にほのかに光る
 * （外のドームの葉脈ライティングの骨の光と同じ）。両面・透ける
 */
export function createDomeGlassMaterial(ribs = 16, rings = 5) {
  return new THREE.ShaderMaterial({
    name: 'domeGlass',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, uDome: { value: 0 }, uRibs: { value: ribs }, uRings: { value: rings }, uInner: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vUnit;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vUnit = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      uniform float uDome;
      uniform float uRibs;
      uniform float uRings;
      uniform vec3 uInner;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vUnit;
      void main() {
        // 基壇（床から 3m）より下と、入口の張り出しの中はガラスが無い（局所: s = x、t = -z、高さ = y × 48 − 0.5）
        float hLocal = vUnit.y * 48.0 - 0.5;
        if (hLocal < 3.0) discard;
        float ang = atan(-vUnit.z, vUnit.x);
        float dS = abs(ang + 1.5707963);
        float dN = abs(ang - 1.5707963);
        float dW = 3.14159265 - abs(ang);
        if ((dS < 0.095 && hLocal < 9.6) || ((dN < 0.058 || dW < 0.058) && hLocal < 5.6)) discard;
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        bool outside = dot(N, V) > 0.0;
        vec3 Nf = outside ? N : -N;
        float az = atan(vUnit.z, vUnit.x) / 6.2831853 * uRibs;
        float el = asin(clamp(vUnit.y, 0.0, 1.0)) / 1.5707963 * (uRings + 1.0);
        // 斜めの格子（外のドームのシェーダーと同じ式。緯度で間隔を広げる）
        float cosEl = sqrt(max(1.0 - vUnit.y * vUnit.y, 0.04));
        float g1 = az * 2.0 + el * 2.4 / max(cosEl, 0.35);
        float g2 = az * 2.0 - el * 2.4 / max(cosEl, 0.35);
        float wg = fwidth(g1) * 0.9 + 0.012;
        float lattice = max(smoothstep(0.5 - wg, 0.5, abs(fract(g1) - 0.5)), smoothstep(0.5 - wg, 0.5, abs(fract(g2) - 0.5)));
        // 合わせガラスの継ぎ目（格子の間を 2 つに分ける細い線）
        float g3 = az * 4.0;
        float wj = fwidth(g3) * 0.7 + 0.006;
        float joint = smoothstep(0.5 - wj, 0.5, abs(fract(g3) - 0.5)) * 0.5;
        float fade = 1.0 - smoothstep(0.12, 0.3, fwidth(g1));
        float bar = max(lattice, joint) * fade;
        // ガラス: 外からは空を映し、中からはうっすらと部屋の明るさ
        float ndv = abs(dot(N, V));
        float fres = 0.04 + 0.96 * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
        vec3 col;
        float a;
        if (outside) {
          vec3 R = reflect(-V, Nf);
          vec3 refl = skyColor(vec3(R.x, max(R.y, 0.02), R.z)) * vec3(0.92, 0.97, 1.0);
          float spec = pow(max(dot(R, uSunDir), 0.0), 220.0) * 6.0 * smoothstep(-0.02, 0.06, uSunDir.y);
          col = refl + uSunLight * spec;
          a = clamp(fres * 0.9 + 0.07, 0.0, 0.92);
        } else {
          col = uInner + skyColor(V * -1.0) * 0.06;
          a = clamp(fres * 0.45 + 0.03, 0.0, 0.6);
        }
        float smudge = oNoise(vUnit.xz * 60.0) * 0.5 + oNoise(vUnit.xz * 190.0) * 0.5;
        a += 0.02 * smudge;
        // 白い鋼の格子（不透明）。夕方は金緑色にほのかに光る
        vec3 steel = vec3(0.8, 0.8, 0.78) * (uSunLight * max(dot(Nf, uSunDir), 0.0) * 0.8 + uSkyLight * 0.9 + uInner * 1.5);
        float breath = 0.62 + 0.38 * sin(uTime * 0.55);
        steel += vec3(0.7, 0.9, 0.5) * uDome * 0.25 * breath;
        col = mix(col, steel, bar);
        a = mix(a, 1.0, bar);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, a);
        ${TONE}
      }
    `,
  })
}

/** 半球の形（単位球の上半分。scale で半径と高さ） */
export function domeGlassGeometry() {
  return new THREE.SphereGeometry(1, 128, 40, 0, Math.PI * 2, 0, Math.PI / 2)
}
