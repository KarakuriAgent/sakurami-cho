import * as THREE from 'three'
import { DOOR, SHELL } from '../../../core/site'
import { ENTRANCE, ROOM } from '../../../core/lab/plan'
import { townOptions } from '../../townHost'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { TOWN_LIGHT } from '../town/facades'
import { TOWN_SHADOW, townShadowUniforms } from '../town/shadows'
import { TEXTURE_DECL, townTextureUniforms } from '../town/townTextures'

/**
 * ラボの外観とまわりのセットのシェーダー（町と同じ光の決まり: 太陽の直射・空の光・町の太陽の影・空気遠近。materials.ts の COMMON・townLight）。
 *
 * - 質感の種類（builder.ts の MAT）ごとに、写真の質感（打ち放しはアセットの根の textures/lab_exterior/、ほかは町の質感の層）と法線の凹凸を選ぶ
 * - 打ち放しのコンクリート: 型枠の継ぎ目・P コンの穴・笠木の下からの雨だれ・足元のはね返りと苔（北の面）
 * - 夜の光（SITE_LIGHT。地面のシェーダーも使う）: 街灯（電球色）・ガラス壁からこぼれるラボの光・ガラス壁の枠のシアンのネオンの照り返し
 * - 鏡面: 太陽のハイライトと、金属・ガラスへの空の映り込み
 */

/** 街灯の数の上限（uniform の配列の長さ） */
export const MAX_LAMPS = 40

export const siteUniforms = {
  /** 街灯の灯具の位置（シーンの座標）と強さ（w） */
  uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
  uLampCount: { value: 0 },
  /** 街灯の点き具合（0〜1。夜の小径の灯りと同じ）と色（明るさ込み） */
  uLampOn: { value: 0 },
  uLampColor: { value: new THREE.Color('#ffb46b').multiplyScalar(2.6) },
  /** ガラス壁からこぼれるラボの光（色 × 強さ） */
  uSpill: { value: new THREE.Color(0, 0, 0) },
  /** 外のシアンのネオンの照り返し（強さ） */
  uNeon: { value: 0 },
  /** 打ち放しの質感（色・法線） */
  uLabCon: { value: null as THREE.Texture | null },
  uLabConN: { value: null as THREE.Texture | null },
}

const GLASS_X0 = ENTRANCE.glassFrom
const GLASS_X1 = ROOM.halfWidth - 0.4

/** GLSL: 夜の光（街灯・ラボの窓の光・ネオンの照り返し）。返り値は照度（albedo を掛ける前） */
export const SITE_LIGHT = /* glsl */ `
#define MAX_LAMPS ${MAX_LAMPS}
uniform vec4 uLamps[MAX_LAMPS];
uniform int uLampCount;
uniform float uLampOn;
uniform vec3 uLampColor;
uniform vec3 uSpill;
uniform float uNeon;
float segDist(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - (a + ab * t));
}
vec3 siteLight(vec3 wp, vec3 N) {
  vec3 acc = vec3(0.0);
  if (wp.x < -120.0 || wp.x > 200.0 || wp.z < -120.0 || wp.z > 200.0) return acc;
  if (uLampOn > 0.001) {
    for (int i = 0; i < MAX_LAMPS; i++) {
      if (i >= uLampCount) break;
      vec3 L = uLamps[i].xyz - wp;
      float d2 = dot(L, L);
      if (d2 > 484.0) continue;
      float d = sqrt(d2);
      float ndl = max(dot(N, L / d), 0.0) * 0.85 + 0.15;
      acc += uLampColor * uLamps[i].w * ndl * (1.0 - smoothstep(9.0, 22.0, d)) / (1.0 + d2 * 0.28);
    }
    acc *= uLampOn;
  }
  // ラボの窓の光: ガラス壁（南の面）を面の光とみなし、いちばん近い点からの光（ガラスの前の面だけ）
  if (wp.z > ${SHELL.glassZ.toFixed(2)} - 0.05 && dot(uSpill, uSpill) > 1e-6) {
    vec3 q = vec3(clamp(wp.x, ${(GLASS_X0 + 0.2).toFixed(2)}, ${(GLASS_X1 - 0.2).toFixed(2)}), clamp(wp.y, 0.4, 4.8), ${SHELL.glassZ.toFixed(2)});
    vec3 L = q - wp;
    float d2 = max(dot(L, L), 0.04);
    float d = sqrt(d2);
    float facing = clamp((wp.z - ${SHELL.glassZ.toFixed(2)}) / d, 0.0, 1.0);
    acc += uSpill * (max(dot(N, L / d), 0.0) * 0.8 + 0.2) * (0.35 + 0.65 * facing) / (1.0 + d2 * 0.22);
  }
  // 外のネオン（ガラス壁の枠と屋上の縁）の照り返し
  if (uNeon > 0.001) {
    vec3 cyan = vec3(0.1, 0.75, 1.0);
    float dn = min(min(segDist(wp, vec3(${(GLASS_X0 + 0.06).toFixed(2)}, 0.05, ${(SHELL.portalZ - 0.02).toFixed(2)}), vec3(${(GLASS_X0 + 0.06).toFixed(2)}, 6.4, ${(SHELL.portalZ - 0.02).toFixed(2)})),
                       segDist(wp, vec3(${(GLASS_X1 - 0.06).toFixed(2)}, 0.05, ${(SHELL.portalZ - 0.02).toFixed(2)}), vec3(${(GLASS_X1 - 0.06).toFixed(2)}, 6.4, ${(SHELL.portalZ - 0.02).toFixed(2)}))),
                   segDist(wp, vec3(${(GLASS_X0 + 0.06).toFixed(2)}, 6.42, ${(SHELL.portalZ - 0.02).toFixed(2)}), vec3(${(GLASS_X1 - 0.06).toFixed(2)}, 6.42, ${(SHELL.portalZ - 0.02).toFixed(2)})));
    acc += cyan * uNeon / (1.0 + dn * dn * 9.0);
  }
  return acc;
}
`

/** 打ち放しの質感を読む（読めなければ 1 色のまま）。置き場は地図の引数 assetBase の下の textures/lab_exterior/（初めて読むときに決める） */
function loadLabTextures(anisotropy: number) {
  if (siteUniforms.uLabCon.value) return
  const loader = new THREE.TextureLoader()
  const base = `${townOptions().assetBase}textures/lab_exterior/`
  const setup = (t: THREE.Texture, color: boolean) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = anisotropy
    t.needsUpdate = true
    return t
  }
  const fallback = (rgb: [number, number, number]) => setup(new THREE.DataTexture(new Uint8Array([...rgb, 255]), 1, 1), false)
  siteUniforms.uLabCon.value = fallback([104, 104, 104])
  siteUniforms.uLabConN.value = fallback([128, 128, 255])
  loader.load(`${base}concrete-color.webp`, (t) => (siteUniforms.uLabCon.value = setup(t, true)), undefined, () => console.warn('[sakurami-cho] ラボの外壁の質感を読めませんでした（1 色で代わりにします）'))
  loader.load(`${base}concrete-normal.webp`, (t) => (siteUniforms.uLabConN.value = setup(t, false)))
}

const VERTEX = /* glsl */ `
  attribute vec2 aMat;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vColor = color;
    vMat = aMat;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

/** ラボの外観とセットの形のシェーダー（1 つ。質感の種類は頂点の aMat） */
export function createSiteMaterial(anisotropy = 8) {
  loadLabTextures(anisotropy)
  return new THREE.ShaderMaterial({
    name: 'siteSurfaces',
    vertexColors: true,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...townTextureUniforms, ...siteUniforms },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      ${TOWN_LIGHT}
      ${TOWN_SHADOW}
      ${TEXTURE_DECL}
      ${SITE_LIGHT}
      uniform sampler2D uLabCon;
      uniform sampler2D uLabConN;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec2 vMat;
      float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      vec3 layerAlb(highp sampler2DArray s, vec2 uv, float layer) { return pow(max(texture(s, vec3(uv, layer)).rgb * 2.0, 0.0), vec3(2.2)); }
      vec3 layerNrm(highp sampler2DArray s, vec2 uv, float layer) { return texture(s, vec3(uv, layer)).xyz * 2.0 - 1.0; }
      void main() {
        vec3 N = normalize(vNormal);
        float id = floor(vMat.x + 0.5);
        float aux = vMat.y;
        vec3 an = abs(N);
        float dist = length(cameraPosition - vWorld);
        // 面の向きで平面に投影（上下の面は x・-z、東西の面は z・y、南北の面は x・y）
        vec2 uv;
        vec3 T;
        vec3 B;
        if (an.y > 0.7) { uv = vec2(vWorld.x, -vWorld.z); T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, -1.0); }
        else if (an.x > an.z) { uv = vec2(-vWorld.z * sign(N.x), vWorld.y); T = vec3(0.0, 0.0, -sign(N.x)); B = vec3(0.0, 1.0, 0.0); }
        else { uv = vec2(vWorld.x * sign(N.z), vWorld.y); T = vec3(sign(N.z), 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); }
        vec3 albedo = vColor;
        vec3 tn = vec3(0.0, 0.0, 1.0);
        float nk = 1.0 - smoothstep(30.0, 140.0, dist);
        float ao = 1.0;
        float gloss = 0.08;
        float metal = 0.0;
        float n1 = oNoise(uv * 0.9);
        float n2 = oNoise(uv * 0.21 + 7.0);
        if (id < 0.5) {
          // 打ち放し: 写真の質感（4m 四方）を灰色に寄せ、データの色で染める
          vec3 t = texture(uLabCon, uv / 4.0).rgb;
          t = mix(vec3(lum(t)), t, 0.3) / 0.15;
          albedo *= mix(vec3(1.0), t, 0.85);
          tn = texture(uLabConN, uv / 4.0).xyz * 2.0 - 1.0;
          // 型枠の横の継ぎ目（1.82m ごと）と P コンの穴（横 0.6m・縦 0.45m）
          float fw = max(fwidth(uv.y), 1e-4);
          float seam = 1.0 - smoothstep(0.0, 0.004 + fw, abs(fract(uv.y / 1.82 + 0.5) - 0.5) * 1.82);
          albedo *= 1.0 - 0.28 * seam * nk;
          vec2 hp = (fract(vec2(uv.x / 0.6, (uv.y - 0.225) / 0.45)) - 0.5) * vec2(0.6, 0.45);
          float hd = length(hp);
          float hfw = max(fwidth(hd), 1e-4);
          float ring = smoothstep(0.011 - hfw, 0.011 + hfw, hd) * (1.0 - smoothstep(0.016 - hfw, 0.016 + hfw, hd));
          float plug = 1.0 - smoothstep(0.011 - hfw, 0.011 + hfw, hd);
          float holeFade = 1.0 - smoothstep(18.0, 40.0, dist);
          albedo *= 1.0 - holeFade * (0.45 * ring + 0.12 * plug);
          tn.xy += holeFade * ring * normalize(hp + 1e-5) * -0.8;
          // 笠木・窓台（aux = その面の上の水切りの高さ）の下からの雨だれ、上ほど濃い全体のくすみ
          float below = aux - vWorld.y;
          float streak = smoothstep(0.45, 0.85, oNoise(vec2(uv.x * 3.1, 0.0)) * 0.75 + oNoise(vec2(uv.x * 11.0, vWorld.y * 0.15)) * 0.25);
          float sk = smoothstep(-0.05, 0.25, below) * exp(-max(below, 0.0) / 2.6);
          albedo *= 1.0 - 0.38 * streak * sk - 0.08 * sk;
          // 白い吹き出し（少し）
          albedo += vec3(0.05) * smoothstep(0.82, 0.95, oNoise(vec2(uv.x * 1.7, vWorld.y * 0.6))) * sk;
          // 足元のはね返りと、北の面の苔
          float foot = 1.0 - smoothstep(-0.4, 0.9 + 0.4 * n2, vWorld.y);
          albedo *= 1.0 - 0.3 * foot * (0.7 + 0.3 * n1);
          float north = smoothstep(0.3, 0.8, -N.z) * (1.0 - smoothstep(-0.6, 1.6, vWorld.y)) * smoothstep(0.35, 0.7, n2);
          albedo = mix(albedo, albedo * vec3(0.62, 0.78, 0.5), north * 0.7);
          // 全体の色むら（打ち継ぎ・打設のむら）
          albedo *= 0.9 + 0.2 * n2;
          gloss = 0.06;
        } else if (id < 1.5) {
          // なめらかなコンクリート（町の質感のコンクリート）と、目地（aux m ごと）
          albedo *= mix(vec3(1.0), vec3(lum(layerAlb(uBldAlb, uv / 3.2, 4.0))), 0.75);
          tn = layerNrm(uBldNrm, uv / 3.2, 4.0) * vec3(0.6, 0.6, 1.0);
          if (aux > 0.01) {
            vec2 g = abs(fract(uv / aux + 0.5) - 0.5) * aux;
            float fw = max(fwidth(uv.x), 1e-4) + 0.002;
            float joint = 1.0 - smoothstep(0.003, 0.003 + fw, min(g.x, g.y));
            albedo *= 1.0 - 0.4 * joint * nk;
          }
          albedo *= 0.88 + 0.24 * n2;
          // 縦の面は上からの雨の筋
          albedo *= 1.0 - 0.14 * smoothstep(0.6, 0.9, oNoise(vec2(uv.x * 2.3, 0.0))) * (1.0 - an.y);
          gloss = 0.07;
        } else if (id < 2.5 || (id > 5.5 && id < 6.5)) {
          // 敷石・石畳
          float layer = id < 2.5 ? 4.0 : 3.0;
          float sc = id < 2.5 ? 1.5 : 1.8;
          vec3 t = layerAlb(uGndAlb, uv / sc, layer);
          albedo *= mix(vec3(1.0), mix(vec3(lum(t)), t, 0.5), 0.85);
          tn = layerNrm(uGndNrm, uv / sc, layer);
          albedo *= 0.85 + 0.3 * n2;
          // 道の縁ほど落ち葉と泥
          gloss = 0.07;
        } else if (id < 3.5) {
          // 御影石（縁石・笠石・石段の踏み面）
          vec3 t = layerAlb(uBldAlb, uv / 1.2, 2.0);
          albedo *= mix(vec3(1.0), vec3(lum(t)), 0.6);
          // 細かい粒（黒雲母）
          albedo *= 0.85 + 0.3 * oHash(floor(uv * 180.0));
          tn = layerNrm(uBldNrm, uv / 1.2, 2.0) * vec3(0.4, 0.4, 1.0);
          gloss = 0.16;
        } else if (id < 4.5) {
          // 砂利
          vec3 t = layerAlb(uGndAlb, uv / 1.2, 2.0);
          albedo *= mix(vec3(1.0), t, 0.9);
          tn = layerNrm(uGndNrm, uv / 1.2, 2.0);
          gloss = 0.04;
        } else if (id < 5.5) {
          // アスファルト
          vec3 t = layerAlb(uGndAlb, uv / 4.0, 5.0);
          albedo *= mix(vec3(1.0), vec3(lum(t)), 0.9);
          tn = layerNrm(uGndNrm, uv / 4.0, 5.0) * vec3(0.5, 0.5, 1.0);
          gloss = 0.05;
        } else if (id < 7.5) {
          // 塗装した鉄（aux = つや）。端の方は少し錆
          albedo *= 0.9 + 0.15 * n1;
          albedo = mix(albedo, vec3(0.16, 0.08, 0.04), 0.25 * smoothstep(0.72, 0.95, oNoise(uv * 3.0 + 2.0)) * (1.0 - aux));
          gloss = 0.15 + 0.5 * aux;
        } else if (id < 8.5) {
          // ステンレス・亜鉛めっき
          metal = 1.0;
          gloss = 0.55;
          albedo *= 0.92 + 0.12 * oNoise(uv * 14.0);
        } else if (id < 9.5) {
          // 木（板の筋）
          vec3 t = layerAlb(uBldAlb, vec2(uv.x * 0.6, uv.y * 0.6), 0.0);
          albedo *= mix(vec3(1.0), t, 0.7);
          albedo *= 0.85 + 0.3 * oNoise(vec2(uv.x * 0.5, uv.y * 30.0));
          gloss = 0.1;
        } else if (id < 10.5) {
          // 屋上の防水シート（継ぎ目と汚れ）
          albedo *= mix(vec3(1.0), vec3(lum(layerAlb(uBldAlb, uv / 3.2, 4.0))), 0.4);
          float lap = 1.0 - smoothstep(0.0, 0.02, abs(fract(uv.x / 1.0) - 0.5) * 1.0 - 0.48);
          albedo *= (0.8 + 0.3 * n2) * (1.0 - 0.15 * lap);
          gloss = 0.1;
        } else if (id < 11.5) {
          // ファンの格子（暗い穴と細い枠）
          vec2 g = abs(fract(uv * 28.0) - 0.5);
          albedo *= mix(0.15, 1.0, step(0.42, max(g.x, g.y)));
          gloss = 0.2;
        } else if (id > 12.5) {
          // はげた白い塗装と錆（aux = 錆の多さ）: 塗装のはげた所は赤茶の錆、その下へ錆の筋
          float pn = oNoise(uv * 0.9 + 3.0) * 0.55 + oNoise(uv * 3.7) * 0.3 + oNoise(uv * 13.0) * 0.15;
          float peel = smoothstep(0.74 - 0.3 * aux, 0.8 - 0.3 * aux, pn);
          float run = smoothstep(0.62, 0.92, oNoise(vec2(uv.x * 5.0, uv.y * 0.3))) * aux * (0.6 + 0.4 * oNoise(uv * 2.0));
          vec3 rust = mix(vec3(0.12, 0.06, 0.03), vec3(0.24, 0.11, 0.05), oNoise(uv * 9.0));
          // 錆の筋は塗装を茶色く染めるだけ（はげた所ほど濃くない）
          albedo = mix(albedo * (0.82 + 0.18 * n1), rust, peel);
          albedo = mix(albedo, albedo * vec3(0.72, 0.55, 0.42), clamp(run, 0.0, 1.0));
          gloss = mix(0.18, 0.05, peel);
        } else {
          // 土
          vec3 t = layerAlb(uGndAlb, uv / 2.0, 1.0);
          albedo *= mix(vec3(1.0), t, 0.9);
          tn = layerNrm(uGndNrm, uv / 2.0, 1.0);
          gloss = 0.03;
        }
        // 法線の凹凸（遠くは弱く）
        tn.xy *= nk;
        vec3 Nd = normalize(T * tn.x + B * tn.y + N * max(tn.z, 0.25));
        float sh = townShadow(vWorld, N);
        vec3 col = townLight(albedo * (1.0 - metal * 0.7), Nd, ao, sh);
        // 鏡面: 太陽のハイライトと空の映り込み（金属は強く）
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 H = normalize(V + uSunDir);
        float ndh = max(dot(Nd, H), 0.0);
        float pw = mix(8.0, 140.0, gloss);
        float fres = mix(0.04, 1.0, metal) + (1.0 - mix(0.04, 1.0, metal)) * pow(clamp(1.0 - dot(Nd, V), 0.0, 1.0), 5.0);
        col += uSunLight * pow(ndh, pw) * (pw + 2.0) / 8.0 * fres * sh * max(dot(Nd, uSunDir), 0.0) * gloss;
        vec3 R = reflect(-V, Nd);
        R.y = abs(R.y) * 0.6 + 0.02;
        col += skyColor(normalize(R)) * fres * mix(gloss * 0.35, 0.85, metal) * mix(vec3(1.0), albedo * 2.0, metal);
        // 夜の光（街灯・窓の光・ネオン）
        col += albedo * siteLight(vWorld, Nd);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/**
 * 外から見たガラス（南のガラス壁・ハイサイドの窓の外の面）。空を映す（フレネル）。中は透けて見える。
 * 部屋の中からは裏なので描かない（片面）
 */
export function createSiteGlassMaterial() {
  return new THREE.ShaderMaterial({
    name: 'siteGlass',
    transparent: true,
    depthWrite: false,
    uniforms: { ...outdoorUniforms, ...siteUniforms },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        // 両面のガラス（中のある建物の開く扉・大庇）の裏から見るときは、裏の面の向きで（前は裏が真っ白な映り込みになっていた）
        float back = dot(N, V) < 0.0 ? 1.0 : 0.0;
        if (back > 0.5) N = -N;
        float ndv = max(dot(N, V), 0.0);
        float fres = 0.05 + 0.95 * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
        vec3 R = reflect(-V, N);
        // 地平線より下の映り込みは、地面と町の暗い色（遠くの町は空の色に溶ける）
        vec3 refl = R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.25 + uSunLight * 0.03, smoothstep(0.0, -0.25, R.y));
        float spec = pow(max(dot(R, uSunDir), 0.0), 900.0) * 30.0 * smoothstep(-0.02, 0.05, uSunDir.y);
        vec3 col = refl + uSunLight * spec;
        // ほこり・指紋のくもり（少し）
        float smudge = oNoise(vWorld.xy * 2.3 + vWorld.z) * 0.5 + oNoise(vWorld.xy * 9.0) * 0.5;
        float a = clamp(fres * mix(0.9, 0.6, back) + mix(0.08, 0.04, back) + 0.04 * smudge, 0.0, 0.92);
        col *= mix(1.0, 0.7, back);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, a);
        ${TONE}
      }
    `,
  })
}

/** 光る物（外のネオン・街灯の灯具・足元灯）の色。strength は毎コマ変える（夜に強く） */
export function createSiteGlowMaterial(color: THREE.ColorRepresentation) {
  const m = new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: false })
  m.userData.base = new THREE.Color(color)
  return m
}

/** 扉の外の位置（夜にガラス壁の光が強く見えるかの目安などで使う） */
export const DOOR_OUTSIDE = new THREE.Vector3(DOOR.x, 0, SHELL.portalZ + 0.5)
