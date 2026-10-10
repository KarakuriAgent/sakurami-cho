import * as THREE from 'three'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { NAMED_SURFACE_HELPERS, NAMED_SURFACE_MAIN } from '../named/namedMaterial'
import { TOWN_SHADOW, townShadowUniforms } from '../town/shadows'
import { TEXTURE_DECL, townTextureUniforms } from '../town/townTextures'

/**
 * 中のある建物の中のシェーダー（町の段階 4 の後半）。
 *
 * - 面の質感は外観と同じ（namedMaterial の NAMED_SURFACE。NM の 0〜26）に、中の質感（IM の 27〜）を足したもの
 * - 光（建物ごとに uniform を持つ。interiors.ts が毎コマ書く）:
 *   1. 窓の光: 窓（長方形）ごとの「面光源」。画素から見た窓の形の立体角（ランバートの多角形の式）× 窓の明るさ（空の光。太陽の側の窓は明るい）。
 *      同じ組（部屋）の窓だけ（壁の向こうの部屋の窓の光は入らない）
 *   2. 太陽の直射: 窓から差し込む日なた。花音のまわりの細かい影の地図（town/shadows.ts の local。建物の外観と中の形が影を落とす）で
 *      日なたかを見る（地図の外は日なたにしない）
 *   3. 部屋の灯り: 灯りごとの点光源（距離の 2 乗で弱まる・傘の向き・スポットの向き）。同じ組の灯りだけ。つやのある面にはハイライト
 *   4. まわりの明るさ: 組ごとの照り返し（窓の光・日なた・灯りの合計から。interiors.ts が計算）
 * - 外から窓越しに見たときも同じ光（夜は点いた部屋が電球色に光る）。遠くはかすむ（outdoorHaze）
 */

/** 中の質感の番号（NM の続き。kitBuilder の aMat.x） */
export const IM = {
  /** 布（ソファ・椅子の張り地）。aux = 柄（0 無地・1 チェック・2 縞） */
  fabric: 27,
  /** 敷物（ラグ）。aux = 柄（0 無地・1 縞・2 縁取り） */
  rug: 28,
  /** 本の背（棚の本の列。面の横の向きに背が並ぶ）。aux = 色の種 */
  books: 29,
  /** 画面のガラス（黒くつやがある。消えた画面・テレビ） */
  screen: 30,
  /** 樹脂（つやのある・ない）。aux = つや */
  plastic: 31,
  /** 天井の星図（藍色の地に金の星と星座線。律の手描き） */
  starmap: 32,
  /** 板の床（フローリング）。aux = 板の幅 m（向きは面の横） */
  woodFloor: 33,
  /** 革（椅子の座面・ソファ） */
  leather: 34,
  /** 段ボール（屋根裏の箱） */
  cardboard: 35,
  /** 塗り壁（中の壁。ローラーの跡のごく薄いむら） */
  paintWall: 36,
  /** 陶器（洗面台・便器・浴槽・カップ） */
  ceramic: 37,
  /** 寝具（布団・枕。しわ） */
  bedding: 38,
  /** 黒い鉄のフレーム（ロフトベッド・照明） */
  steelBlack: 39,
} as const

/** 窓・灯り・組の数の上限 */
export const MAX_IWIN = 28
export const MAX_ILAMP = 28
export const MAX_IGROUP = 16

/** 1 棟ぶんの中の光の uniform（interiors.ts が毎コマ書く） */
export function createInteriorUniforms() {
  return {
    uIWinA: { value: Array.from({ length: MAX_IWIN }, () => new THREE.Vector4(0, -1e5, 0, -1)) },
    uIWinU: { value: Array.from({ length: MAX_IWIN }, () => new THREE.Vector4()) },
    uIWinV: { value: Array.from({ length: MAX_IWIN }, () => new THREE.Vector4()) },
    uIWinL: { value: Array.from({ length: MAX_IWIN }, () => new THREE.Vector3()) },
    uIWinN: { value: 0 },
    uILampP: { value: Array.from({ length: MAX_ILAMP }, () => new THREE.Vector4(0, -1e5, 0, -1)) },
    uILampC: { value: Array.from({ length: MAX_ILAMP }, () => new THREE.Vector4()) },
    uILampD: { value: Array.from({ length: MAX_ILAMP }, () => new THREE.Vector4(0, -1, 0, 0.1)) },
    uILampR: { value: Array.from({ length: MAX_ILAMP }, () => 1) },
    uILampOn: { value: Array.from({ length: MAX_ILAMP }, () => 0) },
    uILampN: { value: 0 },
    uIAmb: { value: Array.from({ length: MAX_IGROUP }, () => new THREE.Vector3()) },
    /** 窓ガラス越しの太陽の強さ（0〜1） */
    uISun: { value: 0.85 },
    /** 中から見たガラスの映り込みの色（部屋の明るさ） */
    uIRefl: { value: new THREE.Vector3() },
    /** 画面の明るさ */
    uIScreen: { value: 1.6 },
    /** ガラスの温室（1 = 太陽と空の光が町の影の地図ごと入る。ガーデンドーム） */
    uIGlass: { value: 0 },
  }
}

export type InteriorUniforms = ReturnType<typeof createInteriorUniforms>

/** GLSL: 中の質感（NAMED_SURFACE の中から呼ばれる） */
const INTERIOR_SURFACE = /* glsl */ `
void interiorSurface(float id, float aux, vec2 uv, vec2 fw, float px, float seed, float nk, float n1, float n2, vec3 T, vec3 B, vec3 N,
  inout vec3 albedo, inout vec3 tn, inout float ao, inout float gloss, inout float metal, inout float emit) {
  albedo = vColor;
  tn = vec3(0.0, 0.0, 1.0);
  metal = 0.0;
  float fine = 1.0 - smoothstep(0.002, 0.01, px);
  if (id < 27.5) {
    // 布: 織り目と、柄（チェック・縞）
    vec2 w = sin(uv * 900.0);
    albedo *= 0.9 + 0.06 * w.x * w.y * fine + 0.08 * (oNoise(uv * 14.0 + seed) - 0.5);
    if (aux > 0.5 && aux < 1.5) {
      vec2 c = step(0.5, fract(uv * 6.0));
      albedo *= 0.82 + 0.18 * abs(c.x - c.y) + 0.08 * c.x * c.y;
    } else if (aux > 1.5) albedo *= 0.85 + 0.15 * step(0.5, fract(uv.x * 7.0));
    gloss = 0.03;
  } else if (id < 28.5) {
    // 敷物: 毛足のざらつき・柄
    float pile = oNoise(uv * 60.0 + seed) * 0.6 + oNoise(uv * 160.0) * 0.4;
    albedo *= 0.78 + 0.32 * pile;
    if (aux > 0.5 && aux < 1.5) albedo *= 0.8 + 0.2 * step(0.5, fract(uv.x * 2.2));
    else if (aux > 1.5) {
      float d = min(fract(uv.x * 0.5), fract(uv.y * 0.5));
      albedo = mix(albedo, albedo * vec3(1.25, 1.05, 0.85), smoothstep(0.02, 0.0, abs(d - 0.06)) * 0.8);
    }
    tn.xy += (vec2(oNoise(uv * 90.0), oNoise(uv * 90.0 + 7.0)) - 0.5) * 0.6 * nk;
    ao *= 0.92 + 0.08 * pile;
    gloss = 0.01;
  } else if (id < 29.5) {
    // 本の背: 背ごとの色・幅・背の帯（題名）・すき間
    float wBook = 0.032;
    float x = uv.x / wBook + oHash(vec2(floor(uv.y / 0.33), aux)) * 7.0;
    float bi = floor(x + 0.4 * sin(floor(x) * 1.7));
    float f = fract(x);
    float h = oHash(vec2(bi, aux * 13.0 + floor(uv.y / 0.33)));
    vec3 pal[6];
    pal[0] = vec3(0.42, 0.1, 0.08); pal[1] = vec3(0.1, 0.15, 0.32); pal[2] = vec3(0.78, 0.72, 0.58);
    pal[3] = vec3(0.14, 0.28, 0.16); pal[4] = vec3(0.62, 0.42, 0.14); pal[5] = vec3(0.08, 0.08, 0.09);
    vec3 c = pal[int(floor(h * 5.99))] * (0.75 + 0.5 * oHash(vec2(bi, 3.0)));
    float row = fract(uv.y / 0.33);
    float band = step(0.62, row) * step(row, 0.7) + step(0.18, row) * step(row, 0.21);
    c = mix(c, vec3(0.85, 0.75, 0.45), band * 0.55 * step(0.45, oHash(vec2(bi, 9.0))));
    float gap = smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.92, f);
    albedo = c * mix(0.35, 1.0, gap * fine + (1.0 - fine) * 0.8);
    gloss = 0.1;
  } else if (id < 30.5) {
    // 消えた画面: 黒いつやのあるガラス
    albedo = vec3(0.012, 0.013, 0.016);
    gloss = 0.85;
  } else if (id < 31.5) {
    // 樹脂
    albedo *= 0.96 + 0.06 * n1;
    gloss = 0.1 + 0.6 * aux;
  } else if (id < 32.5) {
    // 天井の星図（藍色の地に金の星と星座線。刷毛のむら）
    vec2 q = uv * 1.6;
    vec3 base = vec3(0.045, 0.07, 0.19) * (0.85 + 0.3 * oNoise(uv * 0.9 + seed)) * (0.94 + 0.08 * oNoise(vec2(uv.x * 9.0, uv.y * 0.6)));
    vec2 cell = floor(q);
    vec2 fq = fract(q) - 0.5;
    float st = 0.0;
    for (int i = 0; i < 3; i++) {
      vec2 o = vec2(oHash(cell + float(i) * 7.1), oHash(cell + float(i) * 3.3 + 1.9)) - 0.5;
      float r = 0.012 + 0.03 * pow(oHash(cell + float(i) * 5.7), 4.0);
      st = max(st, smoothstep(r, r * 0.3, length(fq - o * 0.9)));
    }
    // 星座線: 大きな格子の星どうしを結ぶ細い金の線
    vec2 big = floor(uv * 0.55);
    vec2 a = (big + vec2(oHash(big), oHash(big + 2.0))) / 0.55;
    vec2 b = (big + vec2(1.0, 0.0) + vec2(oHash(big + vec2(1.0, 0.0)), oHash(big + vec2(1.0, 0.0) + 2.0))) / 0.55;
    vec2 pa = uv - a;
    vec2 ba = b - a;
    float tt = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float ln = length(pa - ba * tt);
    float line = (1.0 - smoothstep(0.004, 0.012, ln)) * step(0.35, oHash(big + 5.0));
    float node = max(smoothstep(0.05, 0.02, length(uv - a)), smoothstep(0.05, 0.02, length(uv - b))) * step(0.35, oHash(big + 5.0));
    vec3 gold = vec3(0.95, 0.72, 0.3);
    albedo = mix(base, gold, clamp(st * 0.9 + line * 0.55 + node, 0.0, 1.0));
    emit = (st + node) * 0.06;
    gloss = 0.05;
    metal = clamp(st * 0.5 + line * 0.4 + node * 0.6, 0.0, 0.6);
  } else if (id < 33.5) {
    // 板の床: 板の幅 aux、長さの違う板の継ぎ目、板ごとの色、木目（質感の木）、つや
    float pw = max(aux, 0.08);
    float row = floor(uv.y / pw);
    float lx = uv.x / 1.2 + oHash(vec2(row, 3.0)) * 3.0;
    float plank = floor(lx);
    vec3 t = bAlb(vec2(uv.x * 0.6, (fract(uv.y / pw) + row * 0.37) * 0.15), 0.0);
    albedo *= mix(vec3(1.0), t * 1.1, 0.8) * (0.82 + 0.3 * oHash(vec2(plank, row)));
    float sy = abs(fract(uv.y / pw) - 0.5) * pw;
    float sx = abs(fract(lx) - 0.5) * 1.2;
    float seam = max(1.0 - smoothstep(pw * 0.5 - 0.0025 - fw.y, pw * 0.5 - 0.0025 + fw.y, sy), 1.0 - smoothstep(0.598 - fw.x, 0.6, sx));
    albedo *= 1.0 - 0.45 * seam * fine;
    tn = bNrm(vec2(uv.x * 0.6, uv.y * 0.15), 0.0) * vec3(0.35, 0.35, 1.0);
    gloss = 0.32;
  } else if (id < 34.5) {
    // 革
    albedo *= 0.88 + 0.16 * oNoise(uv * 40.0 + seed);
    tn.xy += (vec2(oNoise(uv * 70.0), oNoise(uv * 70.0 + 3.0)) - 0.5) * 0.3 * nk;
    gloss = 0.35;
  } else if (id < 35.5) {
    // 段ボール（テープの帯）
    albedo *= 0.88 + 0.14 * oNoise(uv * 8.0 + seed);
    float tape = 1.0 - smoothstep(0.022, 0.026, abs(fract(uv.x * 2.0 + seed) - 0.5) * 0.5);
    albedo = mix(albedo, vec3(0.72, 0.62, 0.42), tape * 0.6);
    gloss = 0.04;
  } else if (id < 36.5) {
    // 塗り壁（ローラーの跡のごく薄いむら）
    albedo *= 0.97 + 0.04 * oNoise(vec2(uv.x * 3.0, uv.y * 0.8) + seed) + 0.02 * (oNoise(uv * 40.0) - 0.5);
    if (aux > 0.5) albedo *= 0.96 + 0.04 * step(0.5, fract(uv.x * 4.0));
    gloss = 0.04;
  } else if (id < 37.5) {
    // 陶器
    albedo *= 0.98 + 0.03 * n1;
    gloss = 0.8;
  } else if (id < 38.5) {
    // 寝具（しわ）
    float wr = oNoise(vec2(uv.x * 6.0, uv.y * 2.0) + seed) * 0.6 + oNoise(uv * 15.0) * 0.4;
    albedo *= 0.84 + 0.22 * wr;
    tn.xy += (vec2(oNoise(uv * 8.0), oNoise(uv * 8.0 + 5.0)) - 0.5) * 0.5 * nk;
    gloss = 0.02;
  } else {
    // 黒い鉄のフレーム（粉体塗装）
    albedo *= 0.95 + 0.08 * n1;
    gloss = 0.28;
    metal = 0.25;
  }
}
`

/** GLSL: 中の光（窓の光・太陽・灯り・まわりの明るさ） */
export const INTERIOR_LIGHT = /* glsl */ `
#define MAX_IWIN ${MAX_IWIN}
#define MAX_ILAMP ${MAX_ILAMP}
#define MAX_IGROUP ${MAX_IGROUP}
uniform vec4 uIWinA[MAX_IWIN];
uniform vec4 uIWinU[MAX_IWIN];
uniform vec4 uIWinV[MAX_IWIN];
uniform vec3 uIWinL[MAX_IWIN];
uniform int uIWinN;
uniform vec4 uILampP[MAX_ILAMP];
uniform vec4 uILampC[MAX_ILAMP];
uniform vec4 uILampD[MAX_ILAMP];
uniform float uILampR[MAX_ILAMP];
uniform float uILampOn[MAX_ILAMP];
uniform int uILampN;
uniform vec3 uIAmb[MAX_IGROUP];
uniform float uISun;
uniform vec3 uIRefl;
uniform float uIScreen;
uniform float uIGlass;

float edgeFF(vec3 a, vec3 b, vec3 N) {
  vec3 c = cross(a, b);
  float l = length(c);
  if (l < 1e-6) return 0.0;
  return acos(clamp(dot(a, b), -1.0, 1.0)) * dot(c / l, N);
}

/** 窓の光の照度（窓の明るさ × 形の立体角）。group が同じ窓だけ */
vec3 windowLight(vec3 wp, vec3 N, float group) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_IWIN; i++) {
    if (i >= uIWinN) break;
    if (abs(uIWinA[i].w - group) > 0.5) continue;
    vec3 p0 = uIWinA[i].xyz;
    vec3 U = uIWinU[i].xyz;
    vec3 V = uIWinV[i].xyz;
    vec3 r0 = normalize(p0 - wp);
    vec3 r1 = normalize(p0 + U - wp);
    vec3 r2 = normalize(p0 + U + V - wp);
    vec3 r3 = normalize(p0 + V - wp);
    float s = edgeFF(r0, r1, N) + edgeFF(r1, r2, N) + edgeFF(r2, r3, N) + edgeFF(r3, r0, N);
    acc += uIWinL[i] * max(-s, 0.0) * 0.15915;
  }
  return acc;
}

/** 窓から差し込む太陽（花音のまわりの細かい影の地図で日なたか） */
float interiorSun(vec3 wp, vec3 N) {
  if (uShadowLocalInfo.y < 0.5 || uSunDir.y < -0.02) return 0.0;
  float ndl = dot(N, uSunDir);
  if (ndl <= 0.0) return 0.0;
  float slope = clamp(sqrt(max(1.0 - ndl * ndl, 0.0)) / max(ndl, 0.05), 0.0, 6.0);
  float inside;
  vec3 p = wp + N * uShadowLocalInfo.x * (1.5 + slope) + uSunDir * uShadowLocalInfo.x * 1.5;
  float s = shadowTap(uShadowLocal, uShadowM2, p, inside);
  return s * inside * ndl * smoothstep(-0.02, 0.06, uSunDir.y);
}

/** 灯りの照度（拡散）と、つやの照り返し（spec）。group が同じ灯りだけ */
vec3 lampLight(vec3 wp, vec3 N, vec3 V, float group, float gloss, out vec3 spec) {
  vec3 acc = vec3(0.0);
  spec = vec3(0.0);
  float pw = mix(6.0, 120.0, gloss);
  for (int i = 0; i < MAX_ILAMP; i++) {
    if (i >= uILampN) break;
    if (abs(uILampP[i].w - group) > 0.5 || uILampOn[i] < 0.001) continue;
    vec3 L = uILampP[i].xyz - wp;
    float R = uILampR[i];
    float d2 = dot(L, L);
    if (d2 > R * R) continue;
    float d = sqrt(d2);
    vec3 l = L / max(d, 1e-4);
    float kind = uILampC[i].w;
    vec3 D = uILampD[i].xyz;
    float r0 = uILampD[i].w;
    float k = 1.0;
    float down = -l.y;
    if (kind < 0.5) k = 1.0;
    else if (kind < 1.5) k = mix(0.22, 1.0, smoothstep(-0.1, 0.6, down));
    else if (kind < 2.5) k = mix(0.05, 1.0, smoothstep(-0.05, 0.5, down));
    else if (kind < 3.5) k = 0.45 + 0.55 * abs(l.y);
    else if (kind < 4.5) k = smoothstep(0.55, 0.85, dot(-l, D)) + 0.04;
    else if (kind < 5.5) k = 1.0;
    else k = max(dot(-l, D), 0.0) * 0.9 + 0.1;
    float fall = k * (1.0 - smoothstep(R * 0.55, R, d)) / (d2 + r0 * r0);
    vec3 c = uILampC[i].rgb * uILampOn[i];
    acc += c * max(dot(N, l), 0.0) * fall;
    vec3 H = normalize(l + V);
    spec += c * pow(max(dot(N, H), 0.0), pw) * (pw + 2.0) / 8.0 * fall * max(dot(N, l), 0.0);
  }
  return acc;
}

/** 中の光をまとめて（albedo・法線 N・視線 V・環境光の遮り ao・つや・金属・組） */
vec3 interiorShade(vec3 wp, vec3 N, vec3 V, vec3 albedo, float ao, float gloss, float metal, float group) {
  int g = int(clamp(group, 0.0, float(MAX_IGROUP - 1)) + 0.5);
  vec3 amb = uIAmb[g];
  vec3 spec;
  vec3 lamp = lampLight(wp, N, V, group, gloss, spec);
  float up = N.y * 0.5 + 0.5;
  vec3 win;
  vec3 diffuse;
  if (uIGlass > 0.5 && group < 0.5) {
    // ガラスの温室（組 0 = ドームの大きな空間）: 太陽（町の影の地図・花音のまわりの細かい影）と空の光がガラス越しに入る。地面の照り返し
    float sh = townShadow(wp, N);
    float ndl = max(dot(N, uSunDir), 0.0);
    vec3 sky = uSkyLight * (0.3 + 0.55 * up);
    vec3 bounce = uSunLight * vec3(0.85, 0.9, 0.66) * (0.05 + 0.14 * max(uSunDir.y, 0.0)) * (1.0 - 0.6 * up);
    win = sky * 0.6;
    diffuse = uSunLight * ndl * sh * 0.86 + (sky + bounce) * ao + lamp + amb * ao * (0.75 + 0.35 * up);
  } else {
    win = windowLight(wp, N, group);
    float sun = interiorSun(wp, N);
    diffuse = win * mix(0.75, 1.0, ao) + uSunLight * uISun * sun + lamp + amb * ao * (0.75 + 0.35 * up);
  }
  vec3 col = albedo * (1.0 - metal * 0.6) * diffuse;
  float f0 = mix(0.04, 0.7, metal);
  float fres = f0 + (1.0 - f0) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
  col += spec * gloss * fres * 2.0 * mix(vec3(1.0), albedo * 2.0, metal);
  // 映り込み: 窓の光と部屋の明るさをぼんやり
  col += (amb * 1.2 + win * 0.35) * fres * mix(gloss * 0.5, 0.9, metal) * ao * mix(vec3(1.0), albedo * 2.5, metal);
  return col;
}
`

const SURFACE_VERTEX = /* glsl */ `
  attribute vec2 aMat;
  attribute vec4 aExt;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec2 vMat;
  varying vec4 vExt;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vColor = color;
    vMat = aMat;
    vExt = vec4(aExt.x, aExt.y, aExt.z, 0.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

/** 中の面と家具 */
export function createInteriorSurfaceMaterial(u: InteriorUniforms) {
  return new THREE.ShaderMaterial({
    name: 'interiorSurfaces',
    vertexColors: true,
    side: THREE.FrontSide,
    defines: { NAMED_INTERIOR_SURFACES: '' },
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...townTextureUniforms, ...u },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${TOWN_SHADOW}
      ${TEXTURE_DECL}
      ${INTERIOR_LIGHT}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec2 vMat;
      varying vec4 vExt;
      ${NAMED_SURFACE_HELPERS}
      ${INTERIOR_SURFACE}
      ${NAMED_SURFACE_MAIN}
      void main() {
        vec3 N;
        vec3 Nd;
        vec3 albedo;
        float ao;
        float gloss;
        float metal;
        float emit;
        namedSurface(N, Nd, albedo, ao, gloss, metal, emit);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 col = interiorShade(vWorld, Nd, V, albedo, ao, gloss, metal, vExt.y);
        col += albedo * emit * 4.0 + vec3(1.0, 0.85, 0.55) * emit * 0.5;
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/** 光る物（電球・傘・画面の縁の光）。aMat = (灯りの番号, 強さ)。消えているときは昼の色（まわりの明るさ） */
export function createInteriorGlowMaterial(u: InteriorUniforms) {
  return new THREE.ShaderMaterial({
    name: 'interiorGlow',
    vertexColors: true,
    uniforms: { ...outdoorUniforms, ...u },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uILampOn[${MAX_ILAMP}];
      uniform vec3 uIAmb[${MAX_IGROUP}];
      uniform float uIGlass;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec2 vMat;
      varying vec4 vExt;
      void main() {
        int li = int(clamp(vMat.x, 0.0, float(${MAX_ILAMP - 1})) + 0.5);
        float on = uILampOn[li];
        int g = int(clamp(vExt.y, 0.0, float(${MAX_IGROUP - 1})) + 0.5);
        vec3 day = vColor * 0.65 * (uIAmb[g] * 1.6 + 0.01);
        // ガラスの温室（組 0）は、消えた灯具も空の光で見える
        if (uIGlass > 0.5 && g == 0) day += vColor * (uSkyLight * 0.55 + uSunLight * max(normalize(vNormal).y, 0.0) * 0.12);
        vec3 col = mix(day, vColor * vMat.y, clamp(on, 0.0, 1.0));
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/** 絵の板（アトラス）。aPic = (光り方, 組, 環境光の遮り) */
export function createInteriorPictureMaterial(u: InteriorUniforms, atlas: THREE.Texture) {
  return new THREE.ShaderMaterial({
    name: 'interiorPictures',
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...u, uAtlas: { value: atlas } },
    vertexShader: /* glsl */ `
      attribute vec2 aUv;
      attribute vec3 aPic;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying vec3 vPic;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vUv = aUv;
        vPic = aPic;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${TOWN_SHADOW}
      ${INTERIOR_LIGHT}
      uniform sampler2D uAtlas;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying vec3 vPic;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 albedo = pow(texture(uAtlas, vUv).rgb, vec3(2.2));
        float mode = floor(vPic.x + 0.5);
        vec3 col;
        if (mode > 0.5 && mode < 1.5) {
          // 画面: 灯りに関係なく光る。少しの映り込み
          col = albedo * uIScreen + interiorShade(vWorld, N, V, vec3(0.02), 1.0, 0.8, 0.0, vPic.y) * 0.5;
        } else {
          col = interiorShade(vWorld, N, V, albedo * 0.92, vPic.z, mode > 1.5 ? 0.3 : 0.12, 0.0, vPic.y);
        }
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/**
 * 透けるガラス（窓・扉・棚）。外から見ると空と町を映し（ラボの外のガラスと同じ）、中から見ると部屋の明るさをうっすら映す
 * （夜は外が暗いので、中の映り込みが強い）。法線は外向き（中から見ると裏）
 */
export function createInteriorGlassMaterial(u: InteriorUniforms) {
  return new THREE.ShaderMaterial({
    name: 'interiorGlass',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, ...u },
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
      uniform vec3 uIRefl;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = dot(N, V);
        float fres = 0.05 + 0.95 * pow(clamp(1.0 - abs(ndv), 0.0, 1.0), 5.0);
        float smudge = oNoise(vWorld.xy * 2.3 + vWorld.z) * 0.5 + oNoise(vWorld.zy * 9.0) * 0.5;
        vec3 col;
        float a;
        if (ndv > 0.0) {
          vec3 R = reflect(-V, N);
          vec3 refl = R.y > 0.0 ? skyColor(R) : mix(skyColor(vec3(R.x, 0.02, R.z)) * 0.45, uSkyLight * 0.25 + uSunLight * 0.03, smoothstep(0.0, -0.25, R.y));
          float spec = pow(max(dot(R, uSunDir), 0.0), 900.0) * 30.0 * smoothstep(-0.02, 0.05, uSunDir.y);
          col = refl + uSunLight * spec;
          a = clamp(fres * 0.85 + 0.05 + 0.03 * smudge, 0.0, 0.9);
        } else {
          // 中から: 部屋の明るさの映り込み（外が暗いほど強く見える）
          col = uIRefl;
          float dark = 1.0 - smoothstep(0.02, 0.4, dot(uSkyLight, vec3(0.33)));
          a = clamp(fres * 0.7 + 0.03 + 0.1 * dark + 0.03 * smudge, 0.0, 0.85);
        }
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, a);
        ${TONE}
      }
    `,
  })
}
