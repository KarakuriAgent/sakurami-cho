import * as THREE from 'three'
import { outdoor } from '../../environment/daylight'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { INTERIOR, TOWN_LIGHT } from '../town/facades'
import { TOWN_SHADOW, townShadowUniforms } from '../town/shadows'
import { TEXTURE_DECL, townTextureUniforms } from '../town/townTextures'
import { TOWN_LAMPS, lampUniforms } from '../town/lamps'

/**
 * 名前のある建物の細かい形のシェーダー（町の建物・ラボの外観と同じ光: 太陽・空の光・町の太陽の影・空気遠近）。
 *
 * - 質感（createNamedMaterial）: 質感の種類（NM）ごとに町の写真の質感（煉瓦・石・漆喰・板・コンクリート・波板・タイル・瓦・スレート）と、
 *   手で描く模様（下見板・縦の板・格子・銅板の継ぎ目と緑青の筋・切石の目地・タイル張り・布の縞・朱塗りのはげ）。足元のはね返りと汚れ、
 *   夜は入口の灯り（いちばん近い MAX_NAMED_LAMPS 個）が壁と地面を照らす
 * - 窓のガラス（createNamedGlassMaterial）: 窓ごとに開口の大きさ・部屋の奥行き・種類（住まい・事務所・店・喫茶・ステンドグラス・障子など）を持ち、
 *   部屋の奥（facades.ts の roomInterior）・カーテン・桟・映り込み。点き方は町の窓明かりと同じ uniform（窓・事務所・店）
 * - 看板（createNamedSignMaterial）: canvas に描いた文字の絵（signs.ts のアトラス）。夜は光る看板・照らされる看板
 * - 光る物（createNamedGlowMaterial）: 灯具・提灯・時計の文字盤の明かり
 */

/** 質感の種類（kit の形の aMat.x と同じ番号） */
export const NM = {
  /** 煉瓦（町の質感の煉瓦）。aux = 目地の明るさ（0〜1） */
  brick: 0,
  /** 切石（石の質感と横の目地）。aux = 段の高さ m（0 なら目地なし） */
  stone: 1,
  /** 漆喰・モルタル */
  plaster: 2,
  /** 下見板（横の板の重なりの陰）。aux = 板の幅 m */
  siding: 3,
  /** 縦の板張り（和の家の焦げ茶の板）。aux = 板の幅 m */
  boardV: 4,
  /** コンクリート */
  concrete: 5,
  /** 塗装（木・鉄の枠や柱）。aux = つや 0〜1 */
  paint: 6,
  /** 和瓦（黒瓦・銀鼠・茶色の瓦） */
  kawara: 7,
  /** 洋瓦（赤茶・茶色） */
  tileRoof: 8,
  /** スレート */
  slate: 9,
  /** 銅板の緑青（縦の継ぎ目と雨の筋）。aux = 継ぎ目の間隔 m */
  copper: 10,
  /** 金属の屋根・波板。aux = 波の間隔 m（0 なら平らな瓦棒） */
  metalRoof: 11,
  /** 濃いガラス（遠くの窓・天窓・カーテンウォールの面） */
  glassDark: 12,
  /** 御影石（段・基壇・笠石） */
  granite: 13,
  /** 木（板の床・柱・ベンチ）。aux = 板の向き（0 横・1 縦） */
  wood: 14,
  /** 布（日よけ・暖簾）。aux = 縞の数（0 なら無地） */
  cloth: 15,
  /** 格子（細い縦の桟と暗いすき間）。aux = 桟の間隔 m */
  lattice: 16,
  /** 金色・真鍮 */
  gold: 17,
  /** 葉（蔦・生け垣・植え込み） */
  leaf: 18,
  /** 石畳・敷石 */
  paving: 19,
  /** 屋上の防水 */
  membrane: 20,
  /** 朱塗り（はげ・色あせ） */
  lacquer: 21,
  /** タイル張り（細かい目地）。aux = タイルの大きさ m */
  tileClad: 22,
  /** 土・砂利 */
  soil: 23,
  /** 暗い奥（開口の奥・すき間） */
  dark: 24,
  /** 鉄（黒い鉄・手すり・街灯）。aux = つや */
  iron: 25,
  /** ステンレス・亜鉛めっき・アルミ（手すり・方立て・観測機器） */
  steel: 26,
} as const

/** 入口の灯りの数の上限（uniform の配列） */
export const MAX_NAMED_LAMPS = 48

export const namedUniforms = {
  uNLamps: { value: Array.from({ length: MAX_NAMED_LAMPS }, () => new THREE.Vector4(0, -1e5, 0, 0)) },
  uNLampC: { value: Array.from({ length: MAX_NAMED_LAMPS }, () => new THREE.Vector3()) },
  uNLampCount: { value: 0 },
  /** 灯りの点き具合（0〜1） */
  uNLampOn: { value: 0 },
  /** 町の窓明かり（建物のシェーダーと同じ値） */
  uWindows: { value: 0 },
  uOffice: { value: 0 },
  uShop: { value: 0 },
  /** 店が開いている時間（昼も店の中の灯りが点く。0〜1） */
  uOpen: { value: 0 },
  uLightGain: { value: 1 },
  /** 時計の文字盤の明かり */
  uClock: { value: 0 },
}

/** 毎コマ: 外の時刻の光から uniform を写す */
export function syncNamedUniforms() {
  const o = outdoor
  const u = namedUniforms
  u.uNLampOn.value = o.lights.path
  u.uWindows.value = o.lights.window
  u.uOffice.value = o.lights.office
  u.uShop.value = o.lights.shop
  const h = o.time.hours
  const open = THREE.MathUtils.smoothstep(h, 9.5, 10.2) * (1 - THREE.MathUtils.smoothstep(h, 20.5, 21.2))
  u.uOpen.value = Math.max(open, o.lights.shop)
  u.uLightGain.value = o.lightGain
  u.uClock.value = o.clockFace
}

/** GLSL: 入口の灯り（照度。albedo を掛ける前） */
const NAMED_LAMPS = /* glsl */ `
#define MAX_NAMED_LAMPS ${MAX_NAMED_LAMPS}
uniform vec4 uNLamps[MAX_NAMED_LAMPS];
uniform vec3 uNLampC[MAX_NAMED_LAMPS];
uniform int uNLampCount;
uniform float uNLampOn;
vec3 namedLamps(vec3 wp, vec3 N) {
  vec3 acc = vec3(0.0);
  if (uNLampOn < 0.001) return acc;
  for (int i = 0; i < MAX_NAMED_LAMPS; i++) {
    if (i >= uNLampCount) break;
    vec3 L = uNLamps[i].xyz - wp;
    float w = uNLamps[i].w;
    float r = abs(w);
    float d2 = dot(L, L);
    if (d2 > r * r) continue;
    float d = sqrt(d2);
    if (w < 0.0) {
      // 投光器（建物の正面を下から照らす。遠くまで届き、光の向きの面だけ）
      float ndl = max(dot(N, L / max(d, 1e-3)), 0.0);
      acc += uNLampC[i] * ndl * (1.0 - smoothstep(r * 0.5, r, d)) / (1.0 + d2 * 0.012);
    } else {
      float ndl = max(dot(N, L / max(d, 1e-3)), 0.0) * 0.85 + 0.15;
      acc += uNLampC[i] * ndl * (1.0 - smoothstep(r * 0.35, r, d)) / (1.0 + d2 * 0.45);
    }
  }
  return acc * uNLampOn;
}
`

const VERTEX = /* glsl */ `
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
    vExt = aExt;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

/**
 * GLSL: 名前のある建物の細かい形の面（質感の種類 NM ごとの色・法線・環境光の遮り・つや・金属）。外観（createNamedMaterial）と、
 * 中のある建物の中（interior/interiorMaterial.ts）が使う。使う側で varying（vWorld・vNormal・vColor・vMat・vExt）と、
 * 町の質感（TEXTURE_DECL）を先に宣言する。NAMED_INTERIOR_SURFACES を定義すると、中の質感（27 番から。interiorSurface を先に書く）も使える
 */
export const NAMED_SURFACE_HELPERS = /* glsl */ `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 bAlb(vec2 uv, float layer) { return pow(max(texture(uBldAlb, vec3(uv, layer)).rgb * 2.0, 0.0), vec3(2.2)); }
vec3 bNrm(vec2 uv, float layer) { return texture(uBldNrm, vec3(uv, layer)).xyz * 2.0 - 1.0; }
vec3 gAlb(vec2 uv, float layer) { return pow(max(texture(uGndAlb, vec3(uv, layer)).rgb * 2.0, 0.0), vec3(2.2)); }
vec3 gNrm(vec2 uv, float layer) { return texture(uGndNrm, vec3(uv, layer)).xyz * 2.0 - 1.0; }
float lineAA(float x, float w, float fw) { return 1.0 - smoothstep(w - fw, w + fw, x); }
`

/** GLSL: 面の本体（NAMED_SURFACE_HELPERS の後に。NAMED_INTERIOR_SURFACES なら、間に interiorSurface を書く） */
export const NAMED_SURFACE_MAIN = /* glsl */ `
void namedSurface(out vec3 N, out vec3 Nd, out vec3 albedo, out float ao, out float gloss, out float metal, out float emit) {
  N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float id = floor(vMat.x + 0.5);
  float aux = vMat.y;
  float seed = vExt.z;
  float dirt = vExt.w;
  float dist = length(cameraPosition - vWorld);
  // 面に沿った座標: 水平の面は x・-z、ほかは水平の向き T（見て右）と、面に沿って上へ B
  vec3 T;
  vec3 B;
  vec2 uv;
  if (abs(N.y) > 0.97) {
    T = vec3(1.0, 0.0, 0.0);
    B = vec3(0.0, 0.0, -1.0);
    uv = vec2(vWorld.x, -vWorld.z);
  } else {
    T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
    B = normalize(cross(N, T));
    uv = vec2(dot(vWorld, T), dot(vWorld, B));
  }
  vec2 fw = max(fwidth(uv), vec2(1e-4));
  float px = max(fw.x, fw.y);
  albedo = vColor;
  vec3 tn = vec3(0.0, 0.0, 1.0);
  ao = vExt.x;
  gloss = 0.06;
  metal = 0.0;
  float nk = 1.0 - smoothstep(25.0, 150.0, dist);
  float n1 = oNoise(uv * 0.8 + seed * 31.0);
  float n2 = oNoise(uv * 0.17 + seed * 7.0);
  vec2 suv = uv + seed * vec2(13.0, 7.0);
  if (id < 0.5) {
    // 煉瓦
    vec3 t = bAlb(suv / 2.0, 3.0);
    albedo *= mix(vec3(dot(t, LUMA)), t, 0.35) * 1.05;
    tn = bNrm(suv / 2.0, 3.0);
    albedo *= 0.88 + 0.24 * n2;
    gloss = 0.05;
  } else if (id < 1.5) {
    // 切石（横の目地と、段ごとにずらした縦の目地）
    vec3 t = bAlb(suv / 2.6, 2.0);
    albedo *= mix(vec3(1.0), mix(vec3(dot(t, LUMA)), t, 0.4), 0.7);
    tn = bNrm(suv / 2.6, 2.0) * vec3(0.6, 0.6, 1.0);
    if (aux > 0.01) {
      float row = floor(uv.y / aux);
      float ux = uv.x / (aux * 2.2) + fract(row * 0.5) ;
      float gy = abs(fract(uv.y / aux + 0.5) - 0.5) * aux;
      float gx = abs(fract(ux + 0.5) - 0.5) * aux * 2.2;
      float joint = max(lineAA(gy, 0.008, fw.y), lineAA(gx, 0.008, fw.x)) * (1.0 - smoothstep(0.02, 0.06, px));
      albedo *= 1.0 - 0.32 * joint;
      tn.y += (lineAA(abs(fract(uv.y / aux) - 0.02), 0.02, fw.y / aux) - lineAA(abs(fract(uv.y / aux) - 0.98), 0.02, fw.y / aux)) * 0.5 * nk;
      albedo *= 0.94 + 0.12 * oHash(vec2(floor(ux), row) + seed);
    }
    albedo *= 0.9 + 0.2 * n2;
    gloss = 0.07;
  } else if (id < 2.5) {
    // 漆喰・モルタル
    vec3 t = bAlb(suv / 3.0, 1.0);
    albedo *= mix(vec3(1.0), vec3(dot(t, LUMA)), 0.8);
    tn = bNrm(suv / 3.0, 1.0) * vec3(0.7, 0.7, 1.0);
    albedo *= 0.92 + 0.14 * n2;
    gloss = 0.05;
  } else if (id < 3.5) {
    // 下見板: 板の下端の影（重なり）と、板ごとの色むら
    float bw = max(aux, 0.08);
    float f = fract(uv.y / bw);
    float board = floor(uv.y / bw);
    float lap = smoothstep(0.0, 0.18, f);
    albedo *= mix(0.62, 1.0, lap) * (0.94 + 0.1 * oHash(vec2(board, floor(uv.x / 3.6 + oHash(vec2(board, 1.0))))));
    tn.y -= (1.0 - lap) * 0.9 * nk;
    vec3 t = bAlb(vec2(uv.x / 2.4, f * 0.08 + board * 0.13), 0.0);
    albedo *= mix(vec3(1.0), vec3(dot(t, LUMA)), 0.35);
    // 継ぎ目（縦）
    float j = lineAA(abs(fract(uv.x / 3.6 + oHash(vec2(board, 1.0))) - 0.5) * 3.6, 0.006, fw.x);
    albedo *= 1.0 - 0.25 * j * (1.0 - smoothstep(0.02, 0.05, px));
    gloss = 0.1;
  } else if (id < 4.5) {
    // 縦の板張り
    float bw = max(aux, 0.08);
    float f = fract(uv.x / bw);
    float plank = floor(uv.x / bw);
    vec3 t = bAlb(vec2(uv.y / 2.4, f * 0.1 + plank * 0.17), 0.0);
    albedo *= mix(vec3(1.0), t, 0.6) * (0.88 + 0.2 * oHash(vec2(plank, seed)));
    float gap = lineAA(abs(f - 0.5) * bw, bw * 0.5 - 0.006, fw.x);
    albedo *= mix(0.55, 1.0, gap);
    tn.x += (smoothstep(0.0, 0.12, f) - smoothstep(0.88, 1.0, f)) * 0.4 * nk;
    gloss = 0.06;
  } else if (id < 5.5) {
    // コンクリート
    vec3 t = bAlb(suv / 3.2, 4.0);
    albedo *= mix(vec3(1.0), vec3(dot(t, LUMA)), 0.8);
    tn = bNrm(suv / 3.2, 4.0) * vec3(0.6, 0.6, 1.0);
    albedo *= 0.9 + 0.2 * n2;
    gloss = 0.06;
  } else if (id < 6.5) {
    // 塗装（木・鉄）。少しの色むらと、はげ
    albedo *= 0.92 + 0.12 * n1;
    float chip = smoothstep(0.8, 0.9, oNoise(uv * 6.0 + seed * 3.0)) * (1.0 - aux) * dirt;
    albedo = mix(albedo, albedo * 0.55 + vec3(0.03, 0.025, 0.02), chip * 0.6);
    gloss = 0.12 + 0.55 * aux;
  } else if (id < 7.5) {
    // 和瓦（瓦の列は斜面に沿って。質感の瓦）
    vec3 t = bAlb(suv / 2.2, 7.0);
    albedo *= mix(vec3(dot(t, LUMA)), t, 0.15);
    tn = bNrm(suv / 2.2, 7.0);
    albedo *= 0.86 + 0.26 * n2;
    gloss = 0.16;
  } else if (id < 8.5) {
    // 洋瓦
    vec3 t = bAlb(suv / 2.0, 6.0);
    albedo *= mix(vec3(dot(t, LUMA)), t, 0.3);
    tn = bNrm(suv / 2.0, 6.0);
    albedo *= 0.86 + 0.26 * n2;
    gloss = 0.1;
  } else if (id < 9.5) {
    // スレート
    vec3 t = bAlb(suv / 2.0, 8.0);
    albedo *= mix(vec3(dot(t, LUMA)), t, 0.2);
    tn = bNrm(suv / 2.0, 8.0);
    albedo *= 0.88 + 0.22 * n2;
    gloss = 0.14;
  } else if (id < 10.5) {
    // 銅板の緑青: 縦の継ぎ目（はぜ）、雨の筋、所々の茶色い銅の地
    float sp = max(aux, 0.3);
    float f = fract(uv.x / sp);
    float seam = lineAA(abs(f - 0.5) * sp, 0.012, fw.x);
    float streak = oNoise(vec2(uv.x * 2.7, uv.y * 0.12) + seed) * 0.7 + oNoise(vec2(uv.x * 9.0, uv.y * 0.5)) * 0.3;
    vec3 patina = mix(albedo * 0.82, albedo * vec3(1.08, 1.12, 1.05), smoothstep(0.3, 0.75, streak));
    float bare = smoothstep(0.78, 0.92, oNoise(uv * 0.9 + seed * 4.0)) * 0.6;
    albedo = mix(patina, vec3(0.16, 0.09, 0.05), bare);
    albedo *= 1.0 - 0.25 * seam;
    tn.x += (smoothstep(0.42, 0.5, f) - smoothstep(0.5, 0.58, f)) * 0.8 * nk;
    gloss = 0.12;
  } else if (id < 11.5) {
    // 金属の屋根・波板
    vec3 t = bAlb(suv / 2.4, 5.0);
    albedo *= mix(vec3(1.0), vec3(dot(t, LUMA)), 0.7);
    tn = bNrm(suv / 2.4, 5.0);
    if (abs(aux) > 0.01) {
      // aux > 0 は縦の波（波板の屋根）、aux < 0 は横の筋（シャッター）
      float w = sin((aux > 0.0 ? uv.x : uv.y) / abs(aux) * 6.2832);
      if (aux > 0.0) tn.x += w * 0.5 * nk;
      else tn.y += w * 0.5 * nk;
      albedo *= 0.92 + 0.08 * w;
    }
    float rust = smoothstep(0.7, 0.9, oNoise(uv * 0.6 + seed * 5.0)) * dirt;
    albedo = mix(albedo, vec3(0.2, 0.1, 0.05), rust * 0.5);
    gloss = 0.3;
    metal = 0.3;
  } else if (id < 12.5) {
    // 濃いガラス
    albedo = vec3(0.02, 0.025, 0.03);
    gloss = 0.9;
    metal = 0.0;
  } else if (id < 13.5) {
    // 御影石
    vec3 t = bAlb(suv / 1.2, 2.0);
    albedo *= mix(vec3(1.0), vec3(dot(t, LUMA)), 0.6);
    albedo *= 0.86 + 0.28 * oHash(floor(uv * 160.0));
    tn = bNrm(suv / 1.2, 2.0) * vec3(0.4, 0.4, 1.0);
    gloss = 0.18;
  } else if (id < 14.5) {
    // 木（板）
    vec2 wuv = aux > 0.5 ? vec2(uv.y, uv.x) : uv;
    vec3 t = bAlb(wuv / 2.4, 0.0);
    albedo *= mix(vec3(1.0), t, 0.75);
    tn = bNrm(wuv / 2.4, 0.0) * vec3(0.5, 0.5, 1.0);
    gloss = 0.1;
  } else if (id < 15.5) {
    // 布（縞は面の横の向き）
    if (aux > 0.5) {
      float st = step(0.5, fract(uv.x * aux * 0.5));
      albedo = mix(albedo, vec3(0.78, 0.76, 0.7), st * 0.85);
    }
    albedo *= 0.9 + 0.12 * oNoise(uv * 3.0);
    // 布の裏から日が透ける
    gloss = 0.03;
  } else if (id < 16.5) {
    // 格子（細い縦の桟と暗いすき間）
    float sp = max(aux, 0.03);
    float f = abs(fract(uv.x / sp) - 0.5) * sp;
    float bar = lineAA(f, sp * 0.32, fw.x);
    float fade = smoothstep(0.004, 0.02, px);
    albedo = mix(albedo * mix(0.12, 1.0, bar), albedo * 0.5, fade);
    tn.x += (bar < 0.5 ? 0.0 : (fract(uv.x / sp) - 0.5) * 1.2) * (1.0 - fade);
    gloss = 0.08;
  } else if (id < 17.5) {
    // 金色・真鍮
    metal = 1.0;
    gloss = 0.6;
    albedo *= 0.9 + 0.15 * n1;
  } else if (id < 18.5) {
    // 葉（蔦・生け垣）: 葉の粒と、すき間の暗さ
    float l1 = oNoise(uv * 7.0 + seed * 9.0);
    float l2 = oNoise(uv * 19.0 + seed * 3.0);
    float leaf = smoothstep(0.35, 0.7, l1 * 0.6 + l2 * 0.4);
    albedo = mix(albedo * 0.35, albedo * (0.85 + 0.35 * l2), leaf);
    tn.xy += (vec2(oNoise(uv * 23.0), oNoise(uv * 23.0 + 5.0)) - 0.5) * 1.6 * nk;
    ao *= 0.75 + 0.25 * leaf;
    gloss = 0.08;
  } else if (id < 19.5) {
    // 石畳
    vec3 t = gAlb(suv / 1.8, 3.0);
    albedo *= mix(vec3(1.0), mix(vec3(dot(t, LUMA)), t, 0.5), 0.85);
    tn = gNrm(suv / 1.8, 3.0);
    gloss = 0.08;
  } else if (id < 20.5) {
    // 屋上の防水
    vec3 t = bAlb(suv / 3.2, 4.0);
    albedo *= mix(vec3(1.0), vec3(dot(t, LUMA)), 0.4);
    float lap = lineAA(abs(fract(uv.x) - 0.5), 0.004, fw.x);
    albedo *= (0.82 + 0.28 * n2) * (1.0 - 0.12 * lap);
    gloss = 0.08;
  } else if (id < 21.5) {
    // 朱塗り（色あせ・はげて白木が見える所）
    float fade = n2 * 0.5 + 0.25;
    albedo = mix(albedo, albedo * vec3(1.15, 0.85, 0.8) + 0.03, fade * 0.35);
    float peel = smoothstep(0.78, 0.9, oNoise(uv * 4.0 + seed * 6.0)) * dirt;
    albedo = mix(albedo, vec3(0.42, 0.32, 0.22), peel);
    gloss = 0.22;
  } else if (id < 22.5) {
    // タイル張り
    float ts = max(aux, 0.05);
    vec2 g = abs(fract(uv / vec2(ts * 2.0, ts) + 0.5) - 0.5) * vec2(ts * 2.0, ts);
    float joint = max(lineAA(g.x, 0.004, fw.x), lineAA(g.y, 0.004, fw.y)) * (1.0 - smoothstep(0.01, 0.03, px));
    albedo *= (0.9 + 0.16 * oHash(floor(uv / vec2(ts * 2.0, ts)) + seed)) * (1.0 - 0.3 * joint);
    gloss = 0.2;
  } else if (id < 23.5) {
    // 土・砂利
    vec3 t = gAlb(suv / 1.5, 2.0);
    albedo *= mix(vec3(1.0), t, 0.9);
    tn = gNrm(suv / 1.5, 2.0);
    gloss = 0.03;
  } else if (id < 24.5) {
    // 暗い奥
    albedo *= 0.25;
    ao *= 0.5;
  } else if (id > 25.5) {
    // ステンレス・アルミ
    metal = 1.0;
    gloss = 0.55;
    albedo *= 0.92 + 0.12 * oNoise(uv * 14.0);
  } else {
    // 鉄（黒い鉄）
    albedo *= 0.9 + 0.1 * n1;
    float rust = smoothstep(0.75, 0.92, oNoise(uv * 3.0 + seed * 2.0)) * dirt;
    albedo = mix(albedo, vec3(0.16, 0.07, 0.03), rust * 0.6);
    gloss = 0.2 + 0.4 * aux;
    metal = 0.4;
  }
  emit = 0.0;
  #ifdef NAMED_INTERIOR_SURFACES
  if (id > 26.5) interiorSurface(id, aux, uv, fw, px, seed, nk, n1, n2, T, B, N, albedo, tn, ao, gloss, metal, emit);
  #endif
  // 汚れ: 足元のはね返り（地面から 0.9m）、まだら、色あせ
  float hg = vWorld.y - vExt.y;
  if (abs(N.y) < 0.9 && id != 24.0) {
    float foot = 1.0 - smoothstep(-0.2, 0.9 + 0.5 * n2, hg);
    albedo *= 1.0 - dirt * 0.35 * foot * (0.6 + 0.4 * n1);
    float blot = smoothstep(0.55, 0.85, oNoise(uv * 0.35 + seed * 17.0) * 0.6 + n1 * 0.4);
    albedo *= 1.0 - dirt * 0.16 * blot;
  }
  albedo = mix(albedo, vec3(dot(albedo, LUMA)), dirt * 0.12);
  // 法線の凹凸（遠くは弱く）
  tn.xy *= nk;
  Nd = normalize(T * tn.x + B * tn.y + N * max(tn.z, 0.3));
}
`

export const NAMED_SURFACE = NAMED_SURFACE_HELPERS + NAMED_SURFACE_MAIN

/** 名前のある建物の細かい形のシェーダー */
export function createNamedMaterial() {
  return new THREE.ShaderMaterial({
    name: 'namedSurfaces',
    vertexColors: true,
    side: THREE.DoubleSide,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...townTextureUniforms, ...namedUniforms, ...lampUniforms },
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      ${TOWN_LIGHT}
      ${TOWN_SHADOW}
      ${TEXTURE_DECL}
      ${NAMED_LAMPS}
      ${TOWN_LAMPS}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec2 vMat;
      varying vec4 vExt;
      ${NAMED_SURFACE}
      void main() {
        vec3 N;
        vec3 Nd;
        vec3 albedo;
        float ao;
        float gloss;
        float metal;
        float emit;
        namedSurface(N, Nd, albedo, ao, gloss, metal, emit);
        float sh = townShadow(vWorld, N);
        vec3 col = townLight(albedo * (1.0 - metal * 0.6), Nd, ao, sh);
        // 鏡面: 太陽のハイライトと空の映り込み
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 H = normalize(V + uSunDir);
        float pw = mix(8.0, 160.0, gloss);
        float f0 = mix(0.04, 0.7, metal);
        // pow の底は clamp する（正面から見た画素では内積がわずかに 1 を超え、負の底の pow は NaN になって Bloom で大きな黒い四角に広がる）
        float fres = f0 + (1.0 - f0) * pow(clamp(1.0 - dot(Nd, V), 0.0, 1.0), 5.0);
        col += uSunLight * pow(max(dot(Nd, H), 0.0), pw) * (pw + 2.0) / 8.0 * fres * sh * max(dot(Nd, uSunDir), 0.0) * gloss;
        vec3 R = reflect(-V, Nd);
        vec3 env = R.y > 0.0 ? skyColor(normalize(R)) * (1.0 - 0.6 * uNight) : (uSkyLight * 0.18 + uSunLight * 0.03);
        col += env * fres * mix(gloss * 0.4, 0.9, metal) * mix(vec3(1.0), albedo * 2.5, metal) * ao;
        // 夜の入口の灯り
        col += albedo * namedLamps(vWorld, Nd);
        // 町の街灯・店先の灯り（灯りの表。名前のある建物の灯具は namedLamps で照らすので除く）
        col += albedo * townLampsEx(vWorld, Nd, 1.0, 0.08) * ao;
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 窓のガラス                                                                    */
/* -------------------------------------------------------------------------- */

/** 窓の種類（GlassBuilder の kind） */
export const GLASS = {
  /** 住まい（カーテン・レース） */
  house: 0,
  /** 事務所（ブラインド・天井の照明の列） */
  office: 1,
  /** 店のショーウィンドウ（明るい棚） */
  shop: 2,
  /** 喫茶・食堂（電球色のペンダント） */
  cafe: 3,
  /** ステンドグラス（色の小片と鉛の線） */
  stained: 4,
  /** 奥の見えないガラス（倉庫・階段室） */
  dark: 5,
  /** 障子（紙と組子。夜は光る） */
  shoji: 6,
  /** すりガラス（浴室・銭湯） */
  frosted: 7,
  /** 工房・工場（高い天井と蛍光灯） */
  workshop: 8,
} as const

/** 窓の明かりの決め方（GlassBuilder の cls）: 0 住まいの窓・1 事務所・2 店（開いている時間は昼も）・3 夜はいつも・4 点かない */
export const LIGHT_CLASS = { window: 0, office: 1, shop: 2, night: 3, none: 4 } as const

/** 窓のガラスのシェーダー（部屋の奥・カーテン・桟・映り込み） */
export function createNamedGlassMaterial() {
  return new THREE.ShaderMaterial({
    name: 'namedGlass',
    vertexColors: true,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...namedUniforms },
    vertexShader: /* glsl */ `
      attribute vec4 aWin;
      attribute vec4 aInfo;
      attribute vec4 aGrid;
      attribute vec4 aRoom;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec4 vWin;
      varying vec4 vInfo;
      varying vec4 vGrid;
      varying vec4 vRoom;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = color;
        vWin = aWin;
        vInfo = aInfo;
        vGrid = aGrid;
        vRoom = aRoom;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      ${TOWN_LIGHT}
      ${TOWN_SHADOW}
      ${INTERIOR}
      uniform float uWindows;
      uniform float uOffice;
      uniform float uShop;
      uniform float uOpen;
      uniform float uLightGain;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vColor;
      varying vec4 vWin;
      varying vec4 vInfo;
      varying vec4 vGrid;
      varying vec4 vRoom;
      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
      float bandAA(float x, float a, float b, float fw) { return smoothstep(a - fw, a + fw, x) - smoothstep(b - fw, b + fw, x); }
      vec3 envRefl(vec3 R) {
        vec3 town = uSkyLight * 0.16 + uSunLight * 0.035;
        vec3 c = R.y > 0.0 ? mix(skyColor(R), town * 1.4, (1.0 - smoothstep(0.02, 0.35, R.y)) * 0.7) : town;
        return c * (1.0 - 0.6 * uNight);
      }
      void main() {
        vec3 N = normalize(vNormal);
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec3 U = vec3(0.0, 1.0, 0.0);
        vec3 T = abs(N.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : normalize(cross(U, N));
        U = normalize(cross(N, T));
        vec2 p = vWin.xy;
        vec2 sz = max(vWin.zw, vec2(0.05));
        float seed = vInfo.x;
        float kind = floor(vInfo.y + 0.5);
        float D = vInfo.z;
        float cls = floor(vInfo.w + 0.5);
        vec2 fwp = max(fwidth(p), vec2(1e-4));
        float px = max(fwp.x, fwp.y);
        // 点いているか
        float occ = cls < 0.5 ? uWindows : cls < 1.5 ? uOffice : cls < 2.5 ? uOpen : cls < 3.5 ? max(uShop, uWindows) : 0.0;
        float wh = oHash(vec2(seed * 97.0, seed * 13.0 + 3.1));
        float lit = cls > 1.5 && cls < 3.5 ? occ : step(wh, occ);
        float warm = fract(seed * 7.7);
        vec3 lamp = mix(vec3(1.0, 0.66, 0.36), vec3(1.0, 0.84, 0.62), warm);
        if (kind > 0.5 && kind < 1.5) lamp = mix(lamp, vec3(0.95, 0.95, 0.92), 0.6);
        if (kind > 7.5) lamp = vec3(0.92, 0.95, 1.0);
        float bright = 0.75 + 0.5 * fract(seed * 3.3);
        if (kind > 1.5 && kind < 3.5) bright = 1.6;
        vec3 rd = vec3(dot(-V, T), dot(-V, U), max(dot(V, N), 0.0));
        vec3 R = reflect(-V, N);
        float fres = 0.04 + 0.96 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
        vec3 refl = envRefl(R);
        float sh = townShadow(vWorld, N);
        vec3 room;
        if (kind > 3.5 && kind < 4.5) {
          // ステンドグラス: 色の小片（昼は外から暗く、点くと透けて光る）
          vec2 cell = floor(p / vec2(sz.x / 6.0, 0.35));
          float h = oHash(cell + seed * 11.0);
          vec3 tint = h < 0.25 ? vec3(0.55, 0.12, 0.1) : h < 0.5 ? vec3(0.12, 0.22, 0.55) : h < 0.7 ? vec3(0.62, 0.5, 0.15) : h < 0.85 ? vec3(0.16, 0.42, 0.22) : vec3(0.7, 0.68, 0.6);
          vec2 g = abs(fract(p / vec2(sz.x / 6.0, 0.35)) - 0.5);
          float lead = 1.0 - step(max(g.x, g.y), 0.44);
          room = mix(tint * (0.06 + 0.04 * dot(uSkyLight, LUMA)) + tint * lamp * lit * 1.4, vec3(0.02), lead);
        } else if (kind > 5.5 && kind < 7.5) {
          // 障子・すりガラス: 紙の白さ（昼は外の光、夜は中の灯りで光る）と組子
          vec3 paper = kind < 6.5 ? vec3(0.78, 0.74, 0.64) : vec3(0.55, 0.62, 0.6);
          room = paper * (uSkyLight * 0.35 + uSunLight * 0.05 * sh) + paper * lamp * lit * 0.9;
          if (kind < 6.5) {
            vec2 g = abs(fract(p / vec2(0.3, 0.28)) - 0.5) * vec2(0.3, 0.28);
            float k = 1.0 - (1.0 - smoothstep(0.008 - fwp.x, 0.008 + fwp.x, g.x)) * 0.0;
            float kumiko = max(1.0 - smoothstep(0.007, 0.007 + fwp.x, g.x), 1.0 - smoothstep(0.007, 0.007 + fwp.y, g.y));
            room = mix(room, vec3(0.16, 0.11, 0.07) * (uSkyLight * 0.6 + lamp * lit * 0.4), kumiko * k);
          }
          fres *= 0.3;
        } else if (kind > 4.5 && kind < 5.5) {
          room = vec3(0.012, 0.012, 0.014) + lamp * lit * 0.15;
        } else {
          float hitR;
          vec2 rn;
          float office = kind > 0.5 && kind < 1.5 || kind > 7.5 ? 1.0 : 0.0;
          room = roomInterior(p, sz, rd, 0.03, vRoom.x, vRoom.y, D, fract(seed * 5.31), lit, lamp * bright, office, hitR, rn);
          if (hitR > 0.5) room = vColor * 0.4 * (uSkyLight * 0.5 + uSunLight * 0.1);
          // 店・喫茶: 奥の棚の明るい点（商品・瓶・時計）と、ペンダントの灯り
          if (kind > 1.5 && kind < 3.5) {
            vec2 q = p + rd.xy * (1.2 / max(rd.z, 0.05));
            float shelf = step(0.55, fract(q.y / 0.42)) * step(0.15, q.y) * step(q.y, sz.y * 0.85);
            float items = step(0.45, oHash(floor(q * vec2(6.0, 2.4)) + seed * 5.0)) * shelf;
            vec3 itemC = mix(vec3(0.7, 0.55, 0.35), vec3(0.6, 0.62, 0.66), oHash(floor(q * vec2(6.0, 2.4)) + 3.0));
            room += itemC * items * (lamp * lit * 0.5 + uSkyLight * 0.08);
            if (kind > 2.5) {
              // 喫茶: 窓の近くの天井から下がる電球
              vec2 bp = vec2(fract(p.x / 1.6) * 1.6 - 0.8, p.y - sz.y * 0.82);
              vec2 q2 = bp + rd.xy * (0.9 / max(rd.z, 0.05));
              float bulb = exp(-dot(q2, q2) * 60.0);
              room += lamp * bulb * lit * 3.0;
            }
          }
          // 住まい: カーテン・レース
          if (kind < 0.5) {
            vec2 pc = p + rd.xy * (0.08 / max(rd.z, 0.05));
            float cv = fract(seed * 31.7);
            vec3 curtainC = mix(vec3(0.72, 0.68, 0.58), mix(vec3(0.45, 0.52, 0.6), vec3(0.6, 0.45, 0.36), fract(seed * 3.0)), step(0.6, fract(seed * 9.1)));
            float cl = 0.12 + 0.3 * fract(seed * 4.1);
            float cr = 0.12 + 0.3 * fract(seed * 6.7);
            float sideC = 1.0 - step(cl * sz.x, pc.x) * step(pc.x, sz.x * (1.0 - cr));
            vec3 clothLit = curtainC * (1.0 - 0.15 * (0.5 + 0.5 * sin(pc.x * 28.0 + seed * 10.0))) * (uSkyLight * 0.3 + uSunLight * 0.04 + lamp * lit * bright * 0.75);
            float a = cv < 0.6 ? sideC : cv < 0.8 ? 0.55 : 0.0;
            room = mix(room, cv < 0.6 || cv >= 0.8 ? clothLit : vec3(0.8, 0.79, 0.76) * (uSkyLight * 0.35 + lamp * lit * 0.6), a);
          } else if (kind > 0.5 && kind < 1.5 && fract(seed * 17.3) < 0.5) {
            // 事務所: ブラインド
            vec2 pc = p + rd.xy * (0.06 / max(rd.z, 0.05));
            float level = sz.y * (0.3 + 0.7 * fract(seed * 2.3));
            float slat = 1.0 - 0.2 * smoothstep(0.2, 0.5, abs(fract(pc.y / 0.04) - 0.5)) * (1.0 - smoothstep(0.01, 0.03, px));
            room = mix(room, vec3(0.7, 0.71, 0.7) * slat * (uSkyLight * 0.35 + lamp * lit * 0.6), step(sz.y - level, pc.y));
          }
        }
        // ガラスの映り込みと太陽のきらめき（事務所・工房の大きなガラスは少し青灰色に染めて、浅い角度でも空が透けて見えないように）
        if (kind > 0.5 && kind < 1.5 || kind > 7.5) refl *= vec3(0.62, 0.68, 0.72);
        vec3 col = mix(room, refl * 0.75, clamp(fres * 0.75 + 0.05, 0.0, 0.8));
        col += uSunLight * pow(max(dot(R, uSunDir), 0.0), 400.0) * 2.5 * sh;
        // 桟（縦 cols・横 rows の格子と枠。アーチの所は放射の桟）
        float cols = vGrid.x;
        float rows = vGrid.y;
        float bar = vGrid.z;
        float archV = vGrid.w;
        float frame = 0.0;
        if (bar > 0.0) {
          float edge = min(min(p.x, sz.x - p.x), min(p.y, sz.y - p.y));
          frame = 1.0 - smoothstep(bar * 1.2 - px, bar * 1.2 + px, edge);
          if (archV > 0.0 && p.y > archV) {
            vec2 c = vec2(sz.x * 0.5, archV);
            vec2 d = p - c;
            float ang = atan(d.y, d.x);
            float spokes = max(cols, 2.0) + 1.0;
            float a = abs(fract(ang / 3.14159 * spokes) - 0.5) * 3.14159 / spokes * length(d);
            frame = max(frame, 1.0 - smoothstep(bar * 0.5 - px, bar * 0.5 + px, a));
            float rr = abs(length(d) - (sz.x * 0.5) * 0.45);
            frame = max(frame, 1.0 - smoothstep(bar * 0.5 - px, bar * 0.5 + px, rr));
          } else {
            if (cols > 1.5) {
              float fx = abs(fract(p.x / (sz.x / cols) + 0.5) - 0.5) * (sz.x / cols);
              frame = max(frame, 1.0 - smoothstep(bar * 0.5 - px, bar * 0.5 + px, fx));
            }
            float top = archV > 0.0 ? archV : sz.y;
            if (rows > 1.5) {
              float fy = abs(fract(p.y / (top / rows) + 0.5) - 0.5) * (top / rows);
              frame = max(frame, (1.0 - smoothstep(bar * 0.5 - px, bar * 0.5 + px, fy)) * step(p.y, top + bar));
            }
            if (archV > 0.0) frame = max(frame, 1.0 - smoothstep(bar * 0.6 - px, bar * 0.6 + px, abs(p.y - archV)));
          }
          frame *= 1.0 - smoothstep(0.03, 0.08, px);
        }
        col = mix(col, townLight(vColor, N, 0.9, sh), frame);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 看板・光る物                                                                   */
/* -------------------------------------------------------------------------- */

/** 看板の文字の絵（signs.ts のアトラス）を貼る面。aSign.x = 光り方（0 光らない・1 内から光る（店の時間）・2 夜は上から照らす・3 時計の文字盤） */
export function createNamedSignMaterial(atlas: THREE.Texture) {
  return new THREE.ShaderMaterial({
    name: 'namedSigns',
    side: THREE.DoubleSide,
    transparent: false,
    uniforms: { ...outdoorUniforms, ...townShadowUniforms, ...namedUniforms, uAtlas: { value: atlas } },
    vertexShader: /* glsl */ `
      attribute vec2 aUv;
      attribute vec2 aSign;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying vec2 vSign;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vUv = aUv;
        vSign = aSign;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${TOWN_LIGHT}
      ${TOWN_SHADOW}
      ${NAMED_LAMPS}
      uniform sampler2D uAtlas;
      uniform float uShop;
      uniform float uOpen;
      uniform float uLightGain;
      uniform float uClock;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying vec2 vSign;
      void main() {
        vec3 N = normalize(vNormal);
        if (!gl_FrontFacing) N = -N;
        vec4 t = texture(uAtlas, vUv);
        if (t.a < 0.5) discard;
        vec3 albedo = pow(t.rgb, vec3(2.2)) * 0.9;
        float sh = townShadow(vWorld, N);
        vec3 col = townLight(albedo, N, 1.0, sh);
        col += albedo * namedLamps(vWorld, N);
        float mode = floor(vSign.x + 0.5);
        float dist = length(cameraPosition - vWorld);
        if (mode > 0.5 && mode < 1.5) col += albedo * uShop * 2.2 * uLightGain;
        else if (mode > 1.5 && mode < 2.5) col += albedo * vec3(1.0, 0.82, 0.6) * uShop * 0.9;
        else if (mode > 2.5) col += albedo * vec3(1.0, 0.93, 0.8) * uClock * 1.4;
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/** 光る物（灯具・提灯・行灯・星の看板ランプ）。頂点の色 × 強さ。aMat.x = 点き方（0 夜の灯り・1 店の時間・2 窓の明かり・3 時計）、aMat.y = 強さ（kit の glow） */
export function createNamedGlowMaterial() {
  return new THREE.ShaderMaterial({
    name: 'namedGlow',
    vertexColors: true,
    uniforms: { ...outdoorUniforms, ...namedUniforms },
    vertexShader: /* glsl */ `
      attribute vec2 aMat;
      varying vec3 vColor;
      varying vec2 vGlow;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vColor = color;
        vGlow = aMat;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uNLampOn;
      uniform float uShop;
      uniform float uWindows;
      uniform float uClock;
      uniform float uLightGain;
      varying vec3 vColor;
      varying vec2 vGlow;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        float k = floor(vGlow.x + 0.5);
        float on = k < 0.5 ? uNLampOn : k < 1.5 ? uShop : k < 2.5 ? uWindows : uClock;
        vec3 N = normalize(vNormal);
        // 昼は乳白のガラス・紙の色（空の光）、夜は光る
        vec3 day = vColor * 0.55 * (uSkyLight * 0.7 + uSunLight * 0.12 * max(dot(N, uSunDir), 0.0) + 0.02);
        vec3 col = mix(day, vColor * vGlow.y * uLightGain, on);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}
