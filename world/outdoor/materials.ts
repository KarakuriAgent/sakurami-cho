import * as THREE from 'three'
import { outdoor } from '../environment/daylight'
import { sharedTime } from '../materials/shared'
import { TOWN_LIGHT } from './town/facades'
import { TOWN_SHADOW, townShadowUniforms } from './town/shadows'
import { TEXTURE_DECL, townTextureUniforms } from './town/townTextures'
import { TOWN_LAMPS, lampUniforms } from './town/lamps'

/**
 * 遠景（空・地形・海・建物・木・灯り）のシェーダー。
 *
 * - 部屋のライトは使わない（lights: false）。太陽・空の光・空気遠近は下の共有 uniform（outdoorUniforms）で自前に計算する
 *   （部屋の 20 個を超えるライトを遠景の画素ごとに計算しないため。部屋のライトが遠景を照らすこともない）
 * - ラボの霧（fogExp2）はかけない（fog: false。ShaderMaterial の既定）。遠くほど空の色にかすむのは outdoorHaze()
 * - 値は HDR のリニア。最後に EffectComposer のトーンマッピングがかかる
 */

/** 遠景のシェーダーが共有する uniform（OutdoorUniforms が毎コマ outdoor から書き込む） */
export const outdoorUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunLight: { value: new THREE.Color() },
  uSkyLight: { value: new THREE.Color() },
  uHaze: { value: new THREE.Color() },
  uHazeDist: { value: 8000 },
  uZenith: { value: new THREE.Color() },
  uMid: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uHorizonAnti: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uSunDisc: { value: new THREE.Color() },
  uCloudLit: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
  uCloudCover: { value: 0.3 },
  uCityGlow: { value: new THREE.Color() },
  uWater: { value: new THREE.Color() },
  uNight: { value: 0 },
  uDaylight: { value: 1 },
  uTime: sharedTime,
  /** 町の方角（xz の単位ベクトル。夜の地平線の町明かり） */
  uTownDir: { value: new THREE.Vector2(0, 1) },
}

/** outdoor（時刻から計算した外の状態）を共有 uniform へ写す */
export function syncOutdoorUniforms() {
  const u = outdoorUniforms
  const o = outdoor
  u.uSunDir.value.copy(o.sunDir)
  u.uSunLight.value.copy(o.sunLight)
  u.uSkyLight.value.copy(o.skyLight)
  u.uHaze.value.copy(o.haze)
  u.uHazeDist.value = o.hazeDistance
  u.uZenith.value.copy(o.zenith)
  u.uMid.value.copy(o.mid)
  u.uHorizon.value.copy(o.horizon)
  u.uHorizonAnti.value.copy(o.horizonAnti)
  u.uGlow.value.copy(o.glow)
  u.uSunDisc.value.copy(o.sunDisc)
  u.uCloudLit.value.copy(o.cloudLit)
  u.uCloudShade.value.copy(o.cloudShade)
  u.uCloudCover.value = o.cloudCover
  u.uCityGlow.value.copy(o.cityGlow)
  u.uWater.value.copy(o.water)
  u.uNight.value = o.night
  u.uDaylight.value = o.daylight
}

/** 夜の地平線の町明かりの方角（町の中心の平面座標 [東, 北]。町の地図データの目録から Landscape が入れる） */
export function setTownDirection(x: number, y: number) {
  outdoorUniforms.uTownDir.value.set(x, -y).normalize()
}
setTownDirection(-730, -1170)

/* -------------------------------------------------------------------------- */
/* GLSL の部品                                                                   */
/* -------------------------------------------------------------------------- */

export const COMMON = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunLight;
uniform vec3 uSkyLight;
uniform vec3 uHaze;
uniform float uHazeDist;
uniform float uNight;
uniform float uDaylight;
uniform float uTime;

float oHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float oNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(oHash(i), oHash(i + vec2(1.0, 0.0)), u.x), mix(oHash(i + vec2(0.0, 1.0)), oHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

/** 太陽の直射と空の光（ランバート。下向きの面には地面の照り返し） */
vec3 outdoorShade(vec3 albedo, vec3 N) {
  float ndl = max(dot(N, uSunDir), 0.0);
  float up = N.y * 0.5 + 0.5;
  vec3 amb = uSkyLight * (0.42 + 0.58 * up) + uSunLight * 0.07 * (1.0 - up);
  return albedo * (uSunLight * ndl + amb);
}

/** 空気遠近（遠いほど地平線の空の色に溶け込む） */
vec3 outdoorHaze(vec3 col, vec3 wp) {
  vec3 dv = wp - cameraPosition;
  float d = length(dv);
  float f = 1.0 - exp(-d / uHazeDist);
  // 太陽の方を見るほど、かすみは太陽の光を散らして明るく暖かい（前方散乱。逆光の町に奥行きが出る）
  float toSun = max(dot(dv / max(d, 1e-3), uSunDir), 0.0);
  vec3 haze = uHaze + uSunLight * (pow(toSun, 6.0) * 0.12 + pow(toSun, 40.0) * 0.2) * smoothstep(-0.05, 0.1, uSunDir.y);
  return mix(col, haze, f);
}
`

export const SKY = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uHorizonAnti;
uniform vec3 uGlow;
uniform vec3 uCityGlow;
uniform vec2 uTownDir;

/** 空の色（方向 d。地平線 → 中ほど → 天頂の 3 段のグラデーションと、太陽の側の地平線の光、夜の町明かり） */
vec3 skyColor(vec3 d) {
  float h = max(d.y, 0.0);
  // 地平線の色は、太陽の側（朝夕の橙・桃色）と反対側（青紫）で変える
  vec2 sxz = uSunDir.xz;
  float side = dot(normalize(d.xz + vec2(1e-5)), sxz / max(length(sxz), 1e-4)) * 0.5 + 0.5;
  vec3 horizon = mix(uHorizonAnti, uHorizon, smoothstep(0.1, 0.95, side));
  vec3 c = mix(horizon, uMid, smoothstep(0.0, 0.32, pow(h, 0.85)));
  c = mix(c, uZenith, smoothstep(0.2, 0.9, h));
  float sunSide = max(dot(d, uSunDir), 0.0);
  float band = exp(-h * 4.0);
  c += uGlow * (pow(sunSide, 3.0) * band * 1.1 + pow(sunSide, 16.0) * 0.9);
  vec2 dxz = normalize(d.xz + vec2(1e-5));
  c += uCityGlow * smoothstep(0.0, 0.85, dot(dxz, uTownDir)) * exp(-h * 16.0);
  // 地平線より下（海・地面の向こう）は地平線の色を少し暗く
  c = mix(c, horizon * 0.75, smoothstep(0.0, -0.06, d.y));
  return c;
}
`

export const TONE = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

/* -------------------------------------------------------------------------- */
/* 空                                                                           */
/* -------------------------------------------------------------------------- */

/** 空のドーム（大きな球の内側）。雲（ノイズ）と太陽の円盤も描く。深度は書かない */
export function createSkyMaterial(clouds: boolean) {
  return new THREE.ShaderMaterial({
    name: 'outdoorSky',
    side: THREE.BackSide,
    depthWrite: false,
    defines: clouds ? { USE_CLOUDS: '' } : {},
    uniforms: {
      ...outdoorUniforms,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      uniform vec3 uSunDisc;
      uniform vec3 uCloudLit;
      uniform vec3 uCloudShade;
      uniform float uCloudCover;
      varying vec3 vDir;

      float fbm(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          s += oNoise(p) * a;
          p = p * 2.03 + vec2(17.1, 9.2);
          a *= 0.5;
        }
        return s / 0.96875;
      }

      void main() {
        vec3 d = normalize(vDir);
        vec3 col = skyColor(d);
        float cs = dot(d, uSunDir);
        // 太陽の円盤とまわりのにじみ（HDR。Bloom でにじむ）
        float disc = smoothstep(0.99994, 0.99997, cs);
        float halo = pow(max(cs, 0.0), 900.0) * 0.06 + pow(max(cs, 0.0), 90.0) * 0.012;
        col += uSunDisc * (disc + halo) * smoothstep(-0.02, 0.0, d.y);
        #ifdef USE_CLOUDS
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.1) * 1.4 + vec2(uTime * 0.0035, uTime * 0.0012);
          float n = fbm(uv * 1.2);
          float detail = fbm(uv * 4.3 + 3.1);
          float cov = uCloudCover;
          float c = smoothstep(1.0 - cov, 1.0 - cov + 0.3, n * 0.82 + detail * 0.18);
          c *= smoothstep(0.0, 0.12, d.y);
          // 光の当たり方: 太陽の側ほど明るく、縁（薄いところ）は太陽の色で光る（夕方は金に縁取られる）
          float toward = max(cs, 0.0);
          vec3 cloud = mix(uCloudShade, uCloudLit, 0.35 + 0.65 * toward * toward);
          float rim = (1.0 - smoothstep(0.0, 0.55, c)) * pow(toward, 5.0);
          cloud += uCloudLit * rim * 1.4;
          col = mix(col, cloud, c * 0.9);
        }
        #endif
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/** 星（Points。天の北極のまわりを回す）。昼は消える */
export function createStarsMaterial() {
  return new THREE.ShaderMaterial({
    name: 'outdoorStars',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uStars: { value: 0 },
      uPixelRatio: { value: 1 },
      uTime: sharedTime,
    },
    vertexShader: /* glsl */ `
      attribute float aMag;
      attribute float aSeed;
      uniform float uStars;
      uniform float uPixelRatio;
      uniform float uTime;
      varying float vB;
      varying vec3 vTint;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
        vec3 d = normalize(wp.xyz - cameraPosition);
        // 地平線の近くは町の明かりで見えにくい
        float horizon = smoothstep(0.02, 0.3, d.y);
        float twinkle = 0.78 + 0.22 * sin(uTime * (1.3 + aSeed * 3.1) + aSeed * 61.0);
        vB = uStars * aMag * horizon * twinkle;
        vTint = mix(vec3(1.0, 0.86, 0.72), vec3(0.78, 0.86, 1.0), fract(aSeed * 7.3));
        gl_PointSize = vB > 0.003 ? (1.3 + aMag * 1.7) * uPixelRatio : 0.0;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vB;
      varying vec3 vTint;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vTint * vB * exp(-r2 * 3.0) * 1.6, 1.0);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 構造物                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ランドマークの建物（駅・灯台・クレーン・テラス・柵・ケーブルカーの線路・つづら道など）。頂点の色 + aEmit（rgb = 夜に光る色、a = 光の種類）。
 * 光の種類: 1 = 駅の時計（uClock）、2 = 窓明かり（uWindows）、3 = ケーブルカーの車内（uCable）、4 = 小径・石段の足元灯（uPath。town/townStairsMesh.ts）
 */
export function createStructureMaterial() {
  return new THREE.ShaderMaterial({
    name: 'outdoorStructures',
    vertexColors: true,
    // 両面を描く（岸壁・線路・橋などの面の向きをそろえなくてよいように）。法線は見ている側へ向ける
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...townTextureUniforms, ...lampUniforms, uClock: { value: 0 }, uWindows: { value: 0 }, uCable: { value: 0 }, uPath: { value: 0 }, uLightGain: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aEmit;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec4 vEmit;
      void main() {
        #ifdef USE_INSTANCING
        mat4 m = modelMatrix * instanceMatrix;
        #else
        mat4 m = modelMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(m) * normal);
        vColor = color;
        vEmit = aEmit;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${TOWN_LIGHT}
      ${TOWN_SHADOW}
      ${TEXTURE_DECL}
      ${TOWN_LAMPS}
      uniform float uClock;
      uniform float uWindows;
      uniform float uCable;
      uniform float uPath;
      uniform float uLightGain;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec4 vEmit;
      void main() {
        vec3 N = normalize(vNormal);
        if (!gl_FrontFacing) N = -N;
        // 質感（三方向から投影。煉瓦色は煉瓦、ほかはコンクリート）と、雨の筋・足元の汚れ
        vec3 an = abs(N);
        vec2 uv = an.y > 0.7 ? vWorld.xz : an.x > an.z ? vWorld.zy : vWorld.xy;
        float brick = step(vColor.g * 1.3, vColor.r) * step(0.12, vColor.r);
        float layer = brick > 0.5 ? 3.0 : 4.0;
        vec3 t = texture(uBldAlb, vec3(uv / (brick > 0.5 ? 2.0 : 3.2), layer)).rgb * 2.0;
        float dist = length(cameraPosition - vWorld);
        vec3 det = pow(max(mix(vec3(1.0), t, 0.8), 0.0), vec3(2.2));
        vec3 albedo = vColor * mix(vec3(dot(det, vec3(0.2126, 0.7152, 0.0722))), det, 0.3 * brick);
        float streak = smoothstep(0.55, 0.85, oNoise(vec2((uv.x) * 1.7, 0.5))) * (1.0 - an.y);
        albedo *= 1.0 - 0.18 * streak - 0.1 * (1.0 - smoothstep(0.0, 2.0, oNoise(uv * 0.2) * 3.0));
        vec3 col = townLight(albedo, N, 1.0, townShadow(vWorld, N));
        col += albedo * townLamps(vWorld, N);
        float k = vEmit.a < 0.5 ? 0.0 : vEmit.a < 1.5 ? uClock : vEmit.a < 2.5 ? uWindows : vEmit.a < 3.5 ? uCable : uPath;
        col += vEmit.rgb * k * uLightGain;
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* ガーデンドーム                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ガーデンドーム（半球。position は単位球の上半分）。白い鋼管のリブ（放射状 16 本・水平 5 本）・空を映すガラス・中の木々の緑、
 * 夕方からは葉脈ライティング（金緑色。ゆっくり明滅して「ドームが呼吸している」ように見える）
 */
export function createDomeMaterial(ribs: number, rings: number) {
  return new THREE.ShaderMaterial({
    name: 'outdoorDome',
    uniforms: { ...outdoorUniforms, uDome: { value: 0 }, uRibs: { value: ribs }, uRings: { value: rings } },
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
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vUnit;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float az = atan(vUnit.z, vUnit.x) / 6.2831853 * uRibs;
        float el = asin(clamp(vUnit.y, 0.0, 1.0)) / 1.5707963 * (uRings + 1.0);
        float fa = abs(fract(az) - 0.5);
        float fe = abs(fract(el) - 0.5);
        float wa = fwidth(az) * 1.2 + 0.012;
        float we = fwidth(el) * 1.2 + 0.02;
        float rib = max(smoothstep(0.5 - wa, 0.5, fa), smoothstep(0.5 - we, 0.5, fe) * step(0.5, el));
        // 主な骨のあいだの細い斜めの格子（ダイヤグリッド）。上ほど目が細かくならないよう、緯度で間隔を広げる
        float cosEl = sqrt(max(1.0 - vUnit.y * vUnit.y, 0.04));
        float g1 = az * 2.0 + el * 2.4 / max(cosEl, 0.35);
        float g2 = az * 2.0 - el * 2.4 / max(cosEl, 0.35);
        float wg = fwidth(g1) * 0.8 + 0.006;
        float lattice = max(smoothstep(0.5 - wg, 0.5, abs(fract(g1) - 0.5)), smoothstep(0.5 - wg, 0.5, abs(fract(g2) - 0.5)));
        float latticeFade = 1.0 - smoothstep(0.08, 0.25, fwidth(g1));
        rib = max(rib, lattice * 0.75 * latticeFade);
        // ガラス: 空を映し、中の木々（濃い緑）が透ける
        float fres = 0.1 + 0.85 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
        vec3 refl = skyColor(reflect(-V, N)) * vec3(0.92, 0.97, 1.0);
        float leaves = oNoise(vUnit.xz * 9.0 + vUnit.y * 3.0) * 0.6 + oNoise(vUnit.xz * 27.0) * 0.4;
        vec3 inside = outdoorShade(mix(vec3(0.03, 0.07, 0.03), vec3(0.08, 0.14, 0.05), leaves), vec3(0.0, 1.0, 0.0)) * 0.8;
        vec3 col = mix(inside, refl, fres);
        // 太陽の照り返し（夕方はガラスが金に光る）
        float spec = pow(max(dot(reflect(-V, N), uSunDir), 0.0), 60.0);
        col += uSunLight * spec * 1.6;
        // 白い鋼管のリブ
        vec3 ribCol = outdoorShade(vec3(0.8, 0.8, 0.78), N);
        col = mix(col, ribCol, rib * 0.9);
        // 葉脈ライティング（金緑色。ゆっくり呼吸するように明滅し、葉脈のような筋が流れる）
        float breath = 0.62 + 0.38 * sin(uTime * 0.55);
        float veins = smoothstep(0.62, 0.95, oNoise(vUnit.xz * 16.0 + vec2(uTime * 0.05, 0.0)) * 0.7 + oNoise(vUnit.xz * 48.0) * 0.3);
        vec3 glow = vec3(0.55, 1.0, 0.32) * (0.35 + 0.65 * leaves) * breath + vec3(0.9, 1.0, 0.45) * veins * breath * 1.2;
        col += glow * uDome * (1.0 - rib * 0.7) * 1.6;
        col += vec3(0.7, 0.9, 0.5) * rib * uDome * 0.25 * breath;
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 夜の灯り・灯台の光                                                             */
/* -------------------------------------------------------------------------- */

/** 灯りの種類の数（town/lights.ts の LIGHT_KIND） */
export const LIGHT_KINDS = 12

/**
 * 町の灯り（Points）。aKind ごとの点いている割合 uOn[種類] より aSeed が小さい灯りだけ点く。
 * 大きさは m で決め、遠くでは画面の最小の大きさで描く（遠い灯りも消えない）
 */
export function createLightsMaterial() {
  return new THREE.ShaderMaterial({
    name: 'outdoorLights',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOn: { value: new Array(LIGHT_KINDS).fill(0) },
      uKindGain: { value: new Array(LIGHT_KINDS).fill(1) },
      uGain: { value: 1 },
      uPx: { value: 500 },
      uPixelRatio: { value: 1 },
      uTime: sharedTime,
      uHazeDist: outdoorUniforms.uHazeDist,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPower;
      attribute float aSeed;
      attribute float aKind;
      uniform float uOn[${LIGHT_KINDS}];
      uniform float uKindGain[${LIGHT_KINDS}];
      uniform float uGain;
      uniform float uPx;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uHazeDist;
      varying vec3 vCol;
      varying float vCoreR;
      void main() {
        int k = int(aKind + 0.5);
        float on = 0.0;
        float kindGain = 1.0;
        for (int i = 0; i < ${LIGHT_KINDS}; i++) {
          if (i == k) {
            on = uOn[i];
            kindGain = uKindGain[i];
          }
        }
        float lit = k == 10 ? on : smoothstep(aSeed, aSeed + 0.03, on);
        vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = max(-mv.z, 1.0);
        // 光の芯の大きさ（画面の px）。遠くて小さい灯りも、2px の芯で描く（そのぶん少し暗くする）
        float px = aSize * uPx / d;
        float minPx = 2.0 * uPixelRatio;
        float core = max(px, minPx);
        float energy = px < minPx ? mix(1.0, sqrt(px / minPx), 0.6) : 1.0;
        float sprite = min(core * 2.6, 110.0);
        vCoreR = core / sprite;
        float haze = exp(-d / (uHazeDist * 1.4));
        float twinkle = 1.0 + 0.12 * sin(uTime * (2.0 + aSeed * 5.0) + aSeed * 80.0) * smoothstep(1500.0, 4000.0, d);
        // 航空障害灯は 1 秒ごとに点滅、港の灯台の灯（赤・緑）は 4 秒に 1 回の閃光（灯台ごとに位相をずらす）
        float beat = fract(uTime * 0.25 + aSeed);
        // 浮遊レーンのレーン灯は 2 秒ごとにゆっくり点滅（レーンに沿って光が流れるように、種で位相をずらす）
        float blink = k == 6 ? step(0.5, fract(uTime * 0.5 + aSeed)) : k == 9 ? smoothstep(0.0, 0.03, beat) * (1.0 - smoothstep(0.1, 0.16, beat)) : k == 10 ? 0.25 + 0.75 * smoothstep(0.55, 0.9, sin(uTime * 3.14159 - aSeed * 25.0) * 0.5 + 0.5) : 1.0;
        vCol = aColor * aPower * uGain * kindGain * lit * energy * haze * twinkle * blink;
        gl_PointSize = lit > 0.001 && kindGain > 0.001 ? sprite : 0.0;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vCoreR;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0) discard;
        // 芯（Bloom でにじむ明るさ）と、まわりのほのかなにじみ
        float core = 1.0 - smoothstep(vCoreR * 0.45, vCoreR, r);
        float halo = exp(-r * r * 5.0) * 0.28;
        gl_FragColor = vec4(vCol * (core * 2.2 + halo), 1.0);
        ${TONE}
      }
    `,
  })
}

/** 灯台の光の帯（灯台から水平に伸びる細い円錐。加算合成で、灯台に近いほど・光の芯ほど明るい） */
export function createBeamMaterial() {
  return new THREE.ShaderMaterial({
    name: 'outdoorBeam',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uBeam: { value: 0 }, uHazeDist: outdoorUniforms.uHazeDist },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vAlong = 1.0 - uv.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBeam;
      uniform float uHazeDist;
      varying float vAlong;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float d = length(toCam);
        vec3 V = toCam / max(d, 1e-3);
        // 横から見たとき、帯の中ほど（光の中を通る長さが長い所）ほど明るい。細い帯の縁の画素では補間した法線が 0 の長さになることがある
        // （normalize(0) は NaN になり、Bloom で大きな黒い四角に広がる）
        float nl = length(vNormal);
        float thick = nl > 1e-6 ? pow(abs(dot(vNormal / nl, V)), 1.5) : 0.0;
        float fall = exp(-vAlong * 3.2) * smoothstep(0.0, 0.02, vAlong);
        float haze = exp(-d / (uHazeDist * 1.6));
        // カメラの近く（ラボのまわり）を通る帯の殻は描かない。帯がラボの方へ回ってくるとき、近くの殻が町の上に大きな灰色の膜になって
        // 見えるため（ラボの方を向く前後は帯ごと消す。landscape.ts）
        float nearFade = smoothstep(400.0, 2500.0, d);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * thick * fall * haze * nearFade * uBeam * 0.22, 1.0);
        ${TONE}
      }
    `,
  })
}
