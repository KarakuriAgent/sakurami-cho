import * as THREE from 'three'
import { SITE } from '../../../core/town'
import { sharedTime } from '../../materials/shared'
import { COMMON, SKY, TONE, outdoorUniforms } from '../materials'
import { FACADE_KIND, INTERIOR, TOWN_LIGHT, WINDOW_RULES } from './facades'
import { TOWN_SHADOW, depthMaterial, townShadowUniforms } from './shadows'
import { SITE_LIGHT, siteUniforms } from '../site/siteMaterial'
import { TEXTURE_DECL, townTextureUniforms } from './townTextures'
import { TOWN_LAMPS, lampUniforms } from './lamps'

/**
 * 町のシェーダー（地面・海と川・建物・遠くの窓明かり）。光と空気遠近は materials.ts の共有 uniform（outdoorUniforms）と
 * GLSL の outdoorShade()・outdoorHaze() を使うので、空・木・灯りと同じ光で描ける。
 *
 * 地面の色は `pnpm sync:town` が塗った画像（中心 1m/画素・全体 5m/画素。A = 陸か海か）と補助の画像（R 街灯の照り返し・G 植生・B 舗装・A 川・運河・池でないか）。
 * 建物は「型（屋根の形）× インスタンス（大きさ・向き・色・外壁の種類・用途）」で組み立て、窓・外壁の模様・夜の窓明かりはこのシェーダーが描く。
 * 段階 2（質を上げる）で、外壁の型・窓の奥の部屋・汚れをここに足す（docs/design/town.md）。
 */

const DEFINES = { LAB_FLOOR: SITE.labFloorElevation.toFixed(2) }

/* -------------------------------------------------------------------------- */
/* 地面の画像                                                                    */
/* -------------------------------------------------------------------------- */

/** 地面の画像の uniform（地面・海の両方が使う。Landscape が画像と範囲を入れる） */
export const groundUniforms = {
  uGroundC: { value: null as THREE.Texture | null },
  uAuxC: { value: null as THREE.Texture | null },
  uGroundO: { value: null as THREE.Texture | null },
  uAuxO: { value: null as THREE.Texture | null },
  /** 範囲（西端 x・北端 y・東西の幅 m・南北の幅 m） */
  uExtC: { value: new THREE.Vector4(0, 0, 1, 1) },
  uExtO: { value: new THREE.Vector4(0, 0, 1, 1) },
}

/**
 * ラボの前のセットで作り直した広場（ひらき見晴らし台）: 地図の広場の石畳（地面の画像に塗ってある）を、作った台の外では芝に戻す。
 * uUnpave = 地図の広場の中心（シーンの x, z）・半径、uKeep = 作った台の中心・半径（Landscape が入れる）
 */
export const siteGroundUniforms = {
  uUnpave: { value: new THREE.Vector4(0, 0, 0, 0) },
  uKeep: { value: new THREE.Vector3(0, 0, 0) },
}

export const GROUND = /* glsl */ `
uniform sampler2D uGroundC;
uniform sampler2D uAuxC;
uniform sampler2D uGroundO;
uniform sampler2D uAuxO;
uniform vec4 uExtC;
uniform vec4 uExtO;

vec2 groundUv(vec4 ext, vec2 plan) {
  return vec2((plan.x - ext.x) / ext.z, (ext.y - plan.y) / ext.w);
}

/** 平面座標の点の地面の色（A = 陸）と補助の値。中心の画像の中は中心、縁は全体の画像とまぜる。全体の外は端の画素 */
void sampleGround(vec2 plan, out vec4 g, out vec4 aux) {
  vec2 uo = clamp(groundUv(uExtO, plan), vec2(0.0002), vec2(0.9998));
  g = texture2D(uGroundO, uo);
  aux = texture2D(uAuxO, uo);
  vec2 uc = groundUv(uExtC, plan);
  vec2 e = min(uc, 1.0 - uc);
  float wc = smoothstep(0.0, 0.008, min(e.x, e.y));
  if (wc > 0.0) {
    g = mix(g, texture2D(uGroundC, uc), wc);
    aux = mix(aux, texture2D(uAuxC, uc), wc);
  }
}
`

/** 地面の画像のテクスチャ（ImageBitmap から。sRGB の色・A は陸の印。ミップマップと異方性フィルタで遠くの斜めの地面もちらつかない） */
export function groundTexture(image: ImageBitmap, color: boolean, anisotropy: number) {
  const t = new THREE.Texture(image)
  t.flipY = false
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.anisotropy = anisotropy
  t.needsUpdate = true
  return t
}

/* -------------------------------------------------------------------------- */
/* 地面                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 地形を描かない円（シーンの x, z・半径・使うか）。ガラスの温室（ガーデンドーム）の中を作っている間、ドームの中の地形を描かない
 * （中の床・池・地下への階段の穴を、地形の面が隠さないように。interior/interiors.ts が書く）
 */
export const groundHole = { value: new THREE.Vector4(0, 0, 0, 0) }

/** 地形（頂点は標高を入れたシーンの座標、法線は高さ画像から）。色は地面の画像 */
export function createGroundMaterial() {
  return new THREE.ShaderMaterial({
    name: 'townGround',
    defines: DEFINES,
    uniforms: { ...outdoorUniforms, ...groundUniforms, ...townTextureUniforms, ...townShadowUniforms, ...siteUniforms, ...siteGroundUniforms, ...lampUniforms, uTownGlow: { value: 0 }, uGroundDetail: { value: 200 }, uHole: groundHole },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${GROUND}
      ${TOWN_LIGHT}
      ${TOWN_SHADOW}
      ${TEXTURE_DECL}
      ${SITE_LIGHT}
      ${TOWN_LAMPS}
      uniform vec4 uUnpave;
      uniform vec3 uKeep;
      #define GLY_GRASS 0.0
      #define GLY_DIRT 1.0
      #define GLY_GRAVEL 2.0
      #define GLY_COBBLE 3.0
      #define GLY_SLAB 4.0
      #define GLY_ASPHALT 5.0
      #define GLY_MEADOW 7.0
      uniform float uTownGlow;
      uniform float uGroundDetail;
      uniform vec4 uHole;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        if (uHole.w > 0.5 && length(vWorld.xz - uHole.xy) < uHole.z) discard;
        vec2 plan = vec2(vWorld.x, -vWorld.z);
        vec4 g;
        vec4 aux;
        sampleGround(plan, g, aux);
        float elev = vWorld.y + LAB_FLOOR;
        // 海の画素で海面より少し上に出た所は描かない（下の海の面が見える。海岸線は画像の A のなめらかな境で決まる）
        if (g.a < 0.5 && elev < 3.5) discard;
        // 川・運河・池の所も描かない（地形の格子は川幅より粗いことがあるので、水面の形と岸の壁を見せる）
        if (aux.a < 0.5) discard;
        vec3 N = normalize(vNormal);
        float dist = length(vWorld - cameraPosition);
        float veg = aux.g;
        vec3 albedo = g.rgb;
        // 作り直した広場: 地図の広場の石畳を、作った台の外では芝に
        if (uUnpave.z > 0.0) {
          float un = (1.0 - smoothstep(uUnpave.z - 3.0, uUnpave.z + 1.0, length(vWorld.xz - uUnpave.xy))) * smoothstep(uKeep.z, uKeep.z + 0.8, length(vWorld.xz - uKeep.xy));
          if (un > 0.0) {
            albedo = mix(albedo, vec3(0.072, 0.098, 0.038), un);
            veg = mix(veg, 0.85, un);
            aux.b *= 1.0 - un;
          }
        }
        // 細かいむら（近くは芝・土・木の根元、遠くは森の濃淡）
        float n1 = oNoise(plan * 0.37);
        float n2 = oNoise(plan * 0.083 + 11.0);
        float n3 = oNoise(plan * 0.011 - 4.0);
        float near = 1.0 - smoothstep(120.0, 900.0, dist);
        float detail = mix(0.9 + 0.2 * n3, 0.78 + 0.22 * n1 + 0.22 * n2, near);
        albedo *= mix(0.94 + 0.12 * n3, detail, 0.35 + 0.65 * veg);
        // 森の樹冠のかたまり（植生の多い所ほど、濃い影のまだら）
        float clump = smoothstep(0.42, 0.78, oNoise(plan * 0.055 + 3.7) * 0.7 + n2 * 0.3);
        albedo *= 1.0 - veg * 0.32 * clump;
        // 木の無い急な斜面は土と岩
        float steep = 1.0 - smoothstep(0.6, 0.86, N.y);
        albedo = mix(albedo, vec3(0.12, 0.105, 0.085) * (0.8 + 0.4 * n2), steep * (0.65 - 0.35 * veg));
        vec3 Nd = N;
        float ao = 1.0;
        // 近く: 写真の質感（芝・土・砂利・石畳・敷石・アスファルト）を地面の色で染め、凹凸を足す
        float dk = 1.0 - smoothstep(uGroundDetail * 0.6, uGroundDetail, dist);
        if (dk > 0.001) {
          float lumG = dot(g.rgb, vec3(0.2126, 0.7152, 0.0722));
          float warmth = (g.r - g.b) / max(lumG, 0.01);
          float edge = (oNoise(plan * 1.7) - 0.5) * 0.3 + (oNoise(plan * 6.0) - 0.5) * 0.12;
          float paved = smoothstep(0.42, 0.58, aux.b + edge);
          float grassy = smoothstep(0.35, 0.6, veg + edge) * (1.0 - paved);
          float dirtW = (1.0 - paved) * (1.0 - grassy);
          // 舗装の種類: 暗い灰色はアスファルト、明るい・暖かい色は石畳か敷石
          float pk = lumG < 0.05 ? GLY_ASPHALT : (warmth > 0.35 ? GLY_COBBLE : GLY_SLAB);
          float pScale = pk == GLY_ASPHALT ? 4.0 : pk == GLY_COBBLE ? 1.8 : 1.5;
          vec2 uv = plan;
          vec3 dG = texture(uGndAlb, vec3(uv / 2.6, GLY_GRASS)).rgb * 2.0;
          vec3 dG2 = texture(uGndAlb, vec3(uv / 7.3 + 0.37, GLY_MEADOW)).rgb * 2.0;
          vec3 dD = texture(uGndAlb, vec3(uv / 3.5, GLY_DIRT)).rgb * 2.0;
          vec3 dP = mix(vec3(1.0), texture(uGndAlb, vec3(uv / pScale, pk)).rgb * 2.0, pk == GLY_SLAB ? 0.4 : 0.8);
          vec3 nG = texture(uGndNrm, vec3(uv / 2.6, GLY_GRASS)).xyz * 2.0 - 1.0;
          vec3 nD = texture(uGndNrm, vec3(uv / 3.5, GLY_DIRT)).xyz * 2.0 - 1.0;
          vec3 nP = texture(uGndNrm, vec3(uv / pScale, pk)).xyz * 2.0 - 1.0;
          // 芝は 2 つの大きさの質感をまぜて、繰り返しの模様を消す
          vec3 grassDet = mix(dG, dG * dG2, 0.45 + 0.3 * (oNoise(plan * 0.13) - 0.5));
          vec3 det = grassDet * grassy + dD * dirtW + dP * paved;
          // 舗装の所は、ぼやけた地面の画像の色ではなく、舗装の種類の色（縁がくっきりする）
          vec3 pavedC = pk == GLY_ASPHALT ? vec3(0.07, 0.07, 0.075) : pk == GLY_COBBLE ? vec3(0.2, 0.18, 0.15) : vec3(0.26, 0.25, 0.23);
          albedo = mix(albedo, mix(albedo, pavedC, 0.6) , paved * dk);
          det = pow(max(det, 0.0), vec3(2.2));
          // 芝の色は質感の色合いを少し残す（緑の濃淡）、ほかはデータの色で染める
          float dl = dot(det, vec3(0.2126, 0.7152, 0.0722));
          vec3 tinted = albedo * mix(vec3(dl), det, 0.25 * grassy);
          // 芝の色を少し落ち着かせ、枯れた所・土の見える所のまだらを足す（10 月の芝）
          float dry = smoothstep(0.45, 0.85, oNoise(plan * 0.21 + 5.0) * 0.7 + oNoise(plan * 1.1) * 0.3) * grassy;
          tinted = mix(tinted, vec3(dot(tinted, vec3(0.2126, 0.7152, 0.0722))) * vec3(1.25, 1.05, 0.62), dry * 0.55 + 0.22 * grassy);
          tinted *= 1.0 - 0.18 * grassy;
          // 芝の中の小さな花（白・黄）
          vec2 fc = floor(plan * 7.0);
          vec2 fo = vec2(oHash(fc + 1.3), oHash(fc + 7.1)) * 0.6 + 0.2;
          float fl = step(0.93, oHash(fc)) * grassy * (1.0 - smoothstep(6.0, 22.0, dist)) * (1.0 - smoothstep(0.03, 0.06, length(fract(plan * 7.0) - fo)));
          tinted = mix(tinted, mix(vec3(0.8, 0.78, 0.68), vec3(0.8, 0.62, 0.1), oHash(fc + 3.0)), fl * 0.85);
          albedo = mix(albedo, tinted, dk);
          vec3 tn = nG * grassy + nD * dirtW + nP * paved;
          // 地面の接空間: x = 東、y = 北（シーンの -z）
          vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
          vec3 Bg = cross(N, Tg);
          Nd = normalize(mix(N, normalize(Tg * tn.x + Bg * tn.y + N * max(tn.z, 0.3)), dk * 0.9));
          ao = mix(1.0, 0.85 + 0.15 * dl, dk);
        }
        vec3 col = townLight(albedo, Nd, ao, townShadow(vWorld, N));
        // 夜: 街灯が道と広場の地面を暖色に照らす。近くは灯りの表（灯りの位置と向き）で照らし、地面の画像の照り返しはうすめる
        vec3 lampLit = townLampsEx(vWorld, Nd, 0.0, 0.0);
        float lampNear = uLampInfo.w * (1.0 - smoothstep(uLampFade.x * 0.5, uLampFade.x, dist));
        col += vec3(1.0, 0.6, 0.3) * aux.r * aux.r * uTownGlow * (0.75 + 0.25 * n1) * (1.0 - 0.75 * lampNear);
        col += albedo * lampLit;
        // ラボのまわり: 形のある街灯・ガラス壁からこぼれる光・ネオン
        col += albedo * siteLight(vWorld, Nd);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 海・川・運河・池                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 水面（空を映す。太陽のきらめき・小さな波）。sea = true は海（水平線までの大きな面。陸の所は描かない）、
 * false は川・運河・池（緑がかった色、波は小さく、町の灯りの照り返し）
 */
export function createWaterMaterial(sea: boolean) {
  return new THREE.ShaderMaterial({
    name: sea ? 'townSea' : 'townWater',
    defines: { ...DEFINES, ...(sea ? { SEA: '' } : {}) },
    uniforms: { ...outdoorUniforms, ...groundUniforms, ...lampUniforms, uTownGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${SKY}
      ${GROUND}
      ${TOWN_LAMPS}
      uniform vec3 uWater;
      uniform float uTownGlow;
      varying vec3 vWorld;
      void main() {
        vec2 plan = vec2(vWorld.x, -vWorld.z);
        vec4 g;
        vec4 aux;
        sampleGround(plan, g, aux);
        #ifdef SEA
        if (g.a > 0.5) discard;
        #endif
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        // 小さな波（遠くほど細かさを落とす）
        #ifdef SEA
        vec2 p = vWorld.xz * 0.045;
        float amp = 1.0;
        #else
        vec2 p = vWorld.xz * 0.12;
        float amp = 0.45;
        #endif
        float fade = (1.0 - smoothstep(800.0, 6000.0, dist)) * amp;
        float w1 = oNoise(p + vec2(uTime * 0.05, uTime * 0.03));
        float w2 = oNoise(p * 2.7 - vec2(uTime * 0.04, -uTime * 0.06));
        vec3 N = normalize(vec3((w1 - 0.5) * 0.18 * fade + (w2 - 0.5) * 0.1 * fade, 1.0, (w2 - 0.5) * 0.18 * fade));
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        float fres = 0.02 + 0.98 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
        vec3 refl = skyColor(R);
        #ifdef SEA
        vec3 body = uWater * (uSkyLight * 0.9 + uSunLight * 0.18);
        #else
        vec3 body = uWater * vec3(0.8, 1.15, 0.9) * (uSkyLight * 0.9 + uSunLight * 0.15);
        #endif
        // 夜の映り込み: 海は夜空（地平線の町明かりは控えめ）、川・運河は両岸の暗い建物と木に囲まれているので、空はほとんど映らない
        // （前は空の地平線の色と地面の画像の照り返しをそのまま映して、明るい灰色の板に見えた。段階 5 の色の仕上げ）
        #ifdef SEA
        float nightRefl = 1.0 - 0.45 * uNight;
        #else
        float nightRefl = 1.0 - 0.68 * uNight;
        #endif
        vec3 col = mix(body, refl * nightRefl, clamp(fres * 0.92 + 0.06, 0.0, 1.0));
        // 太陽のきらめき（太陽の側。夕方は道のように伸びる）
        float spec = pow(max(dot(R, uSunDir), 0.0), 220.0);
        float sparkle = smoothstep(0.55, 0.95, oNoise(vWorld.xz * 0.6 + uTime * 0.6));
        col += uSunLight * (spec * 3.5 + spec * sparkle * 6.0) * smoothstep(-0.02, 0.04, uSunDir.y);
        // 夜: 岸の灯りが水面に映る。近くは灯りの表の灯りそのもの（さざ波で揺れて縦に伸びる光の筋）、遠くは地面の画像の照り返しをうすく
        float lampNear = uLampInfo.w * (1.0 - smoothstep(uLampFade.x * 0.5, uLampFade.x, dist));
        col += townLampsMirror(vWorld, R) * (0.75 + 0.5 * w1);
        col += vec3(1.0, 0.62, 0.32) * aux.r * aux.r * uTownGlow * 0.9 * (0.4 + 1.2 * w2 * w1) * (1.0 - 0.85 * lampNear);
        col = outdoorHaze(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }
    `,
  })
}

/* -------------------------------------------------------------------------- */
/* 建物                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 建物の頂点の計算。TOWN_INSTANCED のときは型（屋根の形）の頂点（aV・aK）とインスタンスの値（iPos・iDim・iExt・iWall・iRoof・iMeta）から、
 * そうでないとき（形のある建物）は頂点の値（aFac・aB・aWall・aRoof・aMeta・aTan）をそのまま使う。
 * 型の頂点: position.xz = 幅・奥行きに対する割合（-0.5〜0.5）、aV = (高さの種類, 屋根の高さの割合, 外への張り出し x, z [m])、
 * aK = (中への引っ込み x, z [短い辺の半分に対する割合], 部分, 壁の向き)。
 * 高さの種類: 0 = 基礎の下（地面の下まで）、1 = 軒、2 = 軒 + 割合 ×（棟 - 軒）、3 = 陸屋根の屋上の面（軒 - 0.75m）。
 * 部分: 0 = 壁、1 = 屋根、2 = 妻壁など（壁の色・窓なし）、3 = パラペットの上と内側（壁の色）。
 * 外壁の型・質感の層・汚れやすさ（vKind）と、小物を形で描く範囲の中か（vH.w）は 1 棟ごとにここで決める
 */
const BUILDING_VERTEX = /* glsl */ `
${COMMON}
${WINDOW_RULES}
${FACADE_KIND}
uniform vec3 uPropsCenter;
varying vec3 vWorld;
varying vec4 vFac;
varying vec4 vB;
varying vec4 vWallC;
varying vec4 vRoofC;
varying vec4 vMeta;
varying vec4 vKind;
varying vec4 vH;
varying vec3 vTan;
varying vec2 vAxis;
vec3 srgbToLinear(vec3 c) {
  return pow(max(c, 0.0), vec3(2.2));
}
#ifdef TOWN_INSTANCED
attribute vec4 aV;
attribute vec4 aK;
attribute vec4 iPos;
attribute vec4 iDim;
attribute vec4 iExt;
attribute vec4 iWall;
attribute vec4 iRoof;
attribute vec4 iMeta;
#else
attribute vec4 aFac;
attribute vec4 aB;
attribute vec4 aWall;
attribute vec4 aRoof;
attribute vec4 aMeta;
attribute vec4 aTan;
#endif
void main() {
  #ifdef TOWN_INSTANCED
  // 重なった建物の同じ面の壁がちらつかない（深度の取り合い）ように、建物ごとに数 cm だけ大きさを変える
  float zf = 0.02 + 0.08 * fract((iMeta.z + iMeta.w * 256.0) * 0.6180339);
  float w = iDim.x + zf;
  float d = iDim.y + zf;
  // 高架の下のアーチの店は、店先をアーチの面から少し引っ込める（高架の壁と重ならないように）
  if (abs(iRoof.w - 7.0) < 0.5) {
    w = iDim.x - 0.5;
    d = iDim.y - 0.8;
  }
  float eave = iDim.z;
  float ridge = max(iDim.w, eave);
  float m = 0.5 * min(w, d);
  vec2 sg = sign(position.xz);
  vec2 l = sg * max(abs(position.xz) * vec2(w, d) + aV.zw - aK.xy * m, 0.0);
  float mode = aV.x;
  float h = mode < 0.5 ? -(iExt.x + 1.5) : mode < 1.5 ? eave : mode < 2.5 ? eave + aV.y * (ridge - eave) : eave - 0.75;
  float c = cos(iPos.w);
  float s = sin(iPos.w);
  vec2 p = iPos.xy + vec2(c * l.x - s * l.y, s * l.x + c * l.y);
  vec3 world = vec3(p.x, iPos.z + h - LAB_FLOOR, -p.y);
  float side = aK.w;
  float roofKind = iRoof.w;
  vFac = vec4(side < 1.5 ? l.x : l.y, h, side < 1.5 ? w : d, side);
  float eaveEff = roofKind < 0.5 ? max(eave - 0.9, 2.2) : eave;
  float floors = max(iExt.y, 1.0);
  vB = vec4(eaveEff, floors, abs(side - iExt.z) < 0.5 ? 1.0 : 0.0, aK.z);
  vWallC = vec4(srgbToLinear(iWall.rgb / 255.0), iWall.a);
  vRoofC = vec4(srgbToLinear(iRoof.rgb / 255.0), roofKind);
  float seed = (iMeta.z + iMeta.w * 256.0) / 65536.0;
  vMeta = vec4(iMeta.x, iMeta.y, seed, iExt.w);
  // 壁に沿った位置（vFac.x）の増える向き（シーンの座標）
  vec2 tl = side < 1.5 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vTan = vec3(c * tl.x - s * tl.y, 0.0, -(s * tl.x + c * tl.y));
  vAxis = vec2(c, -s);
  vH = vec4(eave, ridge, h, distance(iPos.xy, uPropsCenter.xy) < uPropsCenter.z ? 1.0 : 0.0);
  #else
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
  vFac = aFac;
  vB = aB;
  vWallC = vec4(srgbToLinear(aWall.rgb / 255.0), aWall.a);
  vRoofC = vec4(srgbToLinear(aRoof.rgb / 255.0), aRoof.a);
  vMeta = aMeta;
  vTan = vec3(aTan.x, 0.0, -aTan.y);
  vAxis = vec2(1.0, 0.0);
  vH = vec4(aB.x, aB.x, aFac.y, 0.0);
  float floors = aB.y;
  float seed = aMeta.z;
  #endif
  float type = facadeType(vWallC.a, vMeta.x, vMeta.y, floors, vMeta.w, seed);
  vKind = vec4(type, wallLayer(vWallC.a, type, seed), dirtOf(vMeta.w, seed), fract(seed * 53.3));
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`

/**
 * 建物の画素の計算（外壁・窓・屋根）。外壁の型ごとの窓・ベランダ・店先・帯は facades.ts の説明のとおり
 */
const BUILDING_FRAGMENT = /* glsl */ `
${COMMON}
${SKY}
${WINDOW_RULES}
${TOWN_LIGHT}
${TOWN_SHADOW}
${INTERIOR}
${TEXTURE_DECL}
${TOWN_LAMPS}
uniform float uLightGain;
uniform float uInterior;
varying vec3 vWorld;
varying vec4 vFac;
varying vec4 vB;
varying vec4 vWallC;
varying vec4 vRoofC;
varying vec4 vMeta;
varying vec4 vKind;
varying vec4 vH;
varying vec3 vTan;
varying vec2 vAxis;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/** x が [a, b] の中なら 1（縁は fw の幅でなめらかに） */
float band(float x, float a, float b, float fw) {
  return smoothstep(a - fw, a + fw, x) - smoothstep(b - fw, b + fw, x);
}
/** 長方形 [o0, o1] の中なら 1 */
float rect(vec2 p, vec2 o0, vec2 o1, vec2 fw) {
  vec2 a = smoothstep(o0 - fw, o0 + fw, p) - smoothstep(o1 - fw, o1 + fw, p);
  return a.x * a.y;
}
/** 質感の層の一辺（m） */
float layerScale(float layer) {
  return layer < 0.5 ? 2.4 : layer < 1.5 ? 3.0 : layer < 2.5 ? 2.6 : layer < 3.5 ? 2.0 : layer < 4.5 ? 3.2 : layer < 5.5 ? 2.4 : layer < 6.5 ? 1.4 : layer < 7.5 ? 2.2 : 2.0;
}
/** 質感（色の倍率・接空間の法線）。uv は m を一辺で割った値 */
void sampleLayer(vec2 uv, float layer, float contrast, out vec3 det, out vec3 tn) {
  vec3 t = texture(uBldAlb, vec3(uv, layer)).rgb;
  det = pow(max(mix(vec3(1.0), t * 2.0, contrast), 0.0), vec3(2.2));
  tn = texture(uBldNrm, vec3(uv, layer)).xyz * 2.0 - 1.0;
}
/** データの色 × 質感（hue = 質感の色合いを残す割合） */
vec3 tintDetail(vec3 base, vec3 det, float hue) {
  return base * mix(vec3(dot(det, LUMA)), det, hue);
}

/** ガラスに映る景色: 上は空（地平線の近くは向かいの建物で暗い）、下は通りと町（暗い） */
vec3 envReflection(vec3 R) {
  vec3 town = uSkyLight * 0.16 + uSunLight * 0.035;
  vec3 c = R.y > 0.0 ? mix(skyColor(R), town * 1.4, (1.0 - smoothstep(0.02, 0.35, R.y)) * 0.75) : town;
  return c * (1.0 - 0.6 * uNight);
}

struct Surf {
  vec3 albedo;
  vec3 n;
  float ao;
  float glass;
  vec3 glassCol;
  vec3 emit;
  float spec;
  float over;
  vec3 overCol;
};

/** 壁の画素 */
void wallSurface(inout Surf s, vec3 V, float dist, float part) {
  // 壁の幅（0 で割らないように）
  float span = max(vFac.z, 0.01);
  vec3 N = s.n;
  vec3 U = vec3(0.0, 1.0, 0.0);
  // 壁に沿った向き（見て右）。水平の面（パラペットの上など）は建物の軸
  vec3 T = abs(N.y) > 0.9 ? vec3(vAxis.x, 0.0, vAxis.y) : normalize(cross(U, N));
  float u = vFac.x + 0.5 * span;
  if (dot(vTan, T) < 0.0) u = span - u;
  float v = vFac.y;
  float type = vKind.x;
  float layer = vKind.y;
  float dirt = vKind.z;
  float use = vMeta.x;
  float flags = vMeta.y;
  float seed = vMeta.z;
  float style = vMeta.w;
  bool nearProps = vH.w > 0.5;
  vec2 fwM = max(fwidth(vec2(u, v)), vec2(1e-4));
  float px = max(fwM.x, fwM.y);

  // 外壁の質感
  float sc = layerScale(layer);
  vec3 det;
  vec3 tn;
  sampleLayer(vec2(u, -v) / sc + seed * vec2(17.0, 5.0), layer, near(layer, 1.0) || near(layer, 4.0) ? 0.8 : near(layer, 2.0) ? 0.6 : 1.0, det, tn);
  float hue = near(layer, 3.0) ? 0.3 : near(layer, 2.0) || near(layer, 0.0) ? 0.25 : 0.0;
  vec3 base = s.albedo;
  vec3 albedo = tintDetail(base, det, hue);
  float nk = 1.0 - smoothstep(30.0, 160.0, dist);
  vec3 tnw = vec3(tn.xy * nk * 0.9, 1.0);
  float ao = 1.0;

  float floorsN = max(vB.y, 1.0);
  float floorH = max(vB.x / floorsN, 0.6);
  bool front = vB.z > 0.5;
  bool shop = hasFlag(flags, 16.0);
  // 細かい模様（カーテンのひだ・ブラインド・看板の文字）は、画素が粗くなる前に消す（ちらつかない）
  float fine = 1.0 - smoothstep(0.012, 0.035, px);

  // 窓の格子
  float nb = max(1.0, floor(span / bayTarget(type, use, flags) + 0.5));
  float bayW = span / nb;
  float cu = u / bayW;
  float cv = (v - 0.15) / floorH;
  float bi = floor(cu);
  float fi = floor(cv);
  vec2 cell = vec2(fract(cu) * bayW, fract(cv) * floorH);
  float inside = step(0.0, cv) * step(cv, floorsN - 0.02) * step(0.3, bayW) * (part < 0.5 ? 1.0 : 0.0);

  // 窓の形（型ごと）: 幅の割合・下端と上端（階の高さに対する割合）・見込み・枠
  float wr = 0.5;
  float hs = 0.3;
  float he = 0.8;
  float reveal = 0.14;
  float frameW = 0.05;
  vec3 frameC = vec3(0.55, 0.56, 0.57);
  float arch = 0.0;
  float muntin = 0.0;
  float office = 0.0;
  float roomD = 4.0;
  if (type < 0.5) { wr = 0.52; hs = 0.3; he = 0.78; reveal = 0.08; frameC = vec3(0.6, 0.6, 0.6); }
  else if (type < 1.5) { wr = 0.5; hs = 0.3; he = 0.78; reveal = 0.1; }
  else if (type < 3.5) { wr = 0.4; hs = 0.2; he = 0.8; reveal = 0.24; frameC = vec3(0.75, 0.73, 0.68); arch = step(0.45, fract(seed * 5.1)) + (near(style, 2.0) ? 1.0 : 0.0); muntin = 1.0; }
  else if (type < 4.5) { wr = 0.44; hs = 0.2; he = 0.8; reveal = 0.28; frameC = vec3(0.2, 0.2, 0.2); muntin = 1.0; }
  else if (type < 5.5) { wr = 0.8; hs = 0.04; he = 0.86; reveal = 0.1; }
  else if (type < 6.5) { wr = 0.96; hs = 0.36; he = 0.94; reveal = 0.12; office = 1.0; roomD = 7.0; frameC = vec3(0.35, 0.37, 0.4); }
  else if (type < 7.5) { wr = 1.0; hs = 0.2; he = 1.0; reveal = 0.04; office = 1.0; roomD = 8.0; frameW = 0.04; frameC = vec3(0.3, 0.32, 0.35); }
  else if (type < 8.5) { wr = 0.82; hs = 0.72; he = 0.9; reveal = 0.06; office = 1.0; roomD = 12.0; }
  else { wr = 0.92; hs = 0.3; he = 0.92; reveal = 0.12; office = 1.0; roomD = 7.0; }
  // 工場は最上階の高い窓だけ
  if (type > 7.5 && type < 8.5 && fi < floorsN - 1.5) inside = 0.0;

  bool shopFront = shop && front && fi < 0.5 && inside > 0.5 && type < 7.5;
  if (shopFront) { wr = 0.88; hs = 0.04; he = 0.74; reveal = 0.12; office = 1.0; roomD = 6.0; frameC = vec3(0.25, 0.25, 0.26); arch = 0.0; muntin = 0.0; }

  float W = min(wr * bayW, type < 1.5 ? 2.6 : 99.0);
  vec2 o0 = vec2(0.5 * (bayW - W), hs * floorH);
  vec2 o1 = vec2(0.5 * (bayW + W), he * floorH);
  vec2 wp = cell - o0;
  vec2 wsz = o1 - o0;
  float open = rect(cell, o0, o1, fwM) * inside;
  // アーチの窓（上端を半円に）
  if (arch > 0.5 && open > 0.0) {
    float r0 = 0.5 * wsz.x;
    vec2 q = wp - vec2(r0, wsz.y - r0);
    if (q.y > 0.0) open *= 1.0 - smoothstep(r0 - fwM.x, r0 + fwM.x, length(q));
  }

  float wh = windowHash(bi, fi, vFac.w, seed);
  float occ = occupancy(use, flags, fi, front, type);
  float tiny = smoothstep(0.05, 0.16, px);
  float lit = mix(step(wh, occ), occ, tiny);
  float warm = oHash(vec2(bi * 1.7 + seed * 19.0, fi * 2.3 + 0.5));
  vec3 lamp = mix(vec3(1.0, 0.68, 0.38), vec3(1.0, 0.86, 0.64), warm);
  if (office > 0.5 && !shopFront) lamp = mix(lamp, vec3(0.95, 0.95, 0.92), 0.6);
  float bright = (0.55 + 0.5 * oHash(vec2(fi * 3.1 + seed * 7.0, bi * 1.3))) * (shopFront ? 1.8 : 1.0);

  // --- 外壁の帯・装飾（窓の外側）---
  float lev = fract(cv);
  if (inside > 0.5 || part < 0.5) {
    if (type < 1.5 && part < 0.5) {
      // 木造・モルタルの家: 雨戸の戸袋（窓の横の箱）と、足元の水切り
      float side = step(0.5, fract(seed * 3.3 + bi * 0.37));
      vec2 b0 = side > 0.5 ? vec2(o1.x + 0.02, o0.y - 0.05) : vec2(o0.x - 0.42, o0.y - 0.05);
      float box = rect(cell, b0, b0 + vec2(0.4, wsz.y + 0.2), fwM) * inside * step(0.45, fract(seed * 11.0 + fi * 0.3));
      albedo = mix(albedo, vec3(0.32, 0.31, 0.29) * (type < 0.5 ? 0.7 : 1.0), box);
      ao *= 1.0 - 0.15 * box;
      float sill = band(v, 0.22, 0.32, fwM.y);
      albedo = mix(albedo, vec3(0.12, 0.12, 0.12), sill);
    } else if (type > 2.5 && type < 4.5) {
      // 煉瓦・石造: 窓台と楣（石の帯）、階ごとの帯（上の縁が明るく、下に陰）
      float sillB = rect(cell, vec2(o0.x - 0.1, o0.y - 0.12), vec2(o1.x + 0.1, o0.y), fwM) * inside;
      float lintel = rect(cell, vec2(o0.x - 0.1, o1.y), vec2(o1.x + 0.1, o1.y + 0.22), fwM) * inside * (arch > 0.5 ? 0.0 : 1.0);
      if (arch > 0.5) {
        float r0 = 0.5 * wsz.x;
        vec2 q = wp - vec2(r0, wsz.y - r0);
        float rr = length(q);
        lintel = step(0.0, q.y) * band(rr, r0, r0 + 0.22, fwM.x) * inside;
        float key = rect(wp, vec2(r0 - 0.1, wsz.y), vec2(r0 + 0.1, wsz.y + 0.26), fwM) * inside;
        lintel = max(lintel, key);
      }
      vec3 stoneC = mix(base, vec3(0.66, 0.6, 0.5), near(type, 3.0) ? 0.85 : 0.35) * (0.9 + 0.2 * det.r);
      albedo = mix(albedo, stoneC, max(sillB, lintel));
      tnw.y += sillB * 0.6;
      float course = band(lev, 0.0, 0.16 / floorH, fwM.y / floorH) * step(0.5, fi) * inside;
      albedo = mix(albedo, stoneC, course);
      tnw.y += course * 0.35;
      ao *= 1.0 - 0.25 * band(lev, -0.04, 0.0, 0.02) * step(0.5, fi);
      if (near(type, 4.0) && fi < 0.5 && part < 0.5) {
        // 石造の 1 階の目地（横の溝）
        float g = smoothstep(0.86, 0.96, fract(v / 0.48));
        ao *= 1.0 - 0.35 * g * (1.0 - open);
        tnw.y -= g * 0.5;
      }
      // 窓まわりの石の額縁（石造）
      if (near(type, 4.0)) {
        float surround = (rect(cell, o0 - vec2(0.16, 0.12), o1 + vec2(0.16, 0.0), fwM) - rect(cell, o0, o1, fwM)) * inside;
        albedo = mix(albedo, stoneC * 1.08, surround);
      }
    } else if (type > 4.5 && type < 5.5 && front && fi > 0.5) {
      // 集合住宅の正面: 各階のベランダ（床の縁・手すり・上の床の下の陰）と、2 間ごとの仕切り。近くは小物の形（props.ts）で描くので、ここは陰だけ
      float slabH = 0.2 / floorH;
      float railH = 1.1 / floorH;
      float under = 1.0 - smoothstep(1.0 - 0.6 / floorH, 1.0, lev);
      ao *= mix(0.62, 1.0, under);
      if (!nearProps) {
        float slab = band(lev, -0.01, slabH, fwM.y / floorH);
        float rail = band(lev, slabH, slabH + railH, fwM.y / floorH);
        float kind = fract(seed * 23.0);
        vec3 slabC = mix(base, vec3(0.7, 0.7, 0.68), 0.6);
        vec3 railC = kind < 0.4 ? vec3(0.5, 0.55, 0.58) : kind < 0.75 ? mix(base, vec3(0.72), 0.3) : vec3(0.18, 0.19, 0.2);
        float bars = kind > 0.75 ? smoothstep(0.35, 0.5, abs(fract(u / 0.12) - 0.5)) * fine : 0.0;
        albedo = mix(albedo, slabC, slab);
        tnw.y += slab * 0.3;
        // 手すりの上の布団・植木（たまに）
        float futon = step(0.92, oHash(vec2(bi * 3.7 + seed * 13.0, fi))) * band(lev, slabH + railH * 0.45, slabH + railH * 1.05, fwM.y / floorH) * band(fract(cu), 0.2, 0.7, fwM.x / bayW);
        vec3 futonC = mix(vec3(0.75, 0.72, 0.65), vec3(0.5, 0.6, 0.75), step(0.5, fract(seed * 41.0 + bi)));
        // 手すり（と布団）は窓の前に重ねる
        float railMask = rail * (1.0 - bars);
        s.over = max(railMask, futon);
        s.overCol = mix(railC, futonC, futon);
      }
      float wall = band(fract(u / (2.0 * bayW)), 0.0, 0.04, fwM.x / (2.0 * bayW));
      albedo = mix(albedo, base * 1.1, wall);
    } else if (type > 5.5 && type < 6.5) {
      // 事務所: 腰壁（パネル）と、縦の柱形（明るい帯）
      float fin = band(fract(cu), 0.0, 0.06, fwM.x / bayW) + band(fract(cu), 0.94, 1.0, fwM.x / bayW);
      albedo = mix(albedo, base * 1.15, fin * inside);
      tnw.x += (band(fract(cu), 0.0, 0.03, fwM.x / bayW) - band(fract(cu), 0.97, 1.0, fwM.x / bayW)) * 0.6;
      float spandrel = band(lev, 0.0, hs, fwM.y / floorH) * inside;
      albedo = mix(albedo, base * vec3(0.92, 0.94, 0.97), spandrel * 0.5);
    } else if (type > 6.5 && type < 7.5) {
      // カーテンウォール: 腰のガラス（不透明の濃い色）
      float spandrel = band(lev, 0.0, hs, fwM.y / floorH) * inside;
      albedo = mix(albedo, vec3(0.05, 0.07, 0.09), spandrel);
      s.spec = spandrel;
    } else if (type > 7.5 && type < 8.5 && front && part < 0.5) {
      // 工場・倉庫の正面: シャッター（横の筋の金属の板）
      float n = max(1.0, floor(span / 9.0));
      float fu2 = fract(u / (span / n));
      float sh = band(fu2, 0.25, 0.75, fwM.x / (span / n)) * band(v, -0.2, min(4.6, vB.x * 0.72), fwM.y);
      float ribs = 0.85 + 0.15 * smoothstep(0.3, 0.7, abs(fract(v / 0.11) - 0.5) * 2.0);
      albedo = mix(albedo, vec3(0.42, 0.43, 0.42) * ribs * mix(1.0, det.g, 0.3), sh);
      tnw.y += sh * (smoothstep(0.4, 0.6, fract(v / 0.11)) - 0.5) * 0.4;
      ao *= 1.0 - 0.2 * sh;
    } else if (type > 8.5 && front && fi > 0.5) {
      // 学校の正面: 廊下のベランダ（白い手すり壁）
      float under = 1.0 - smoothstep(1.0 - 0.5 / floorH, 1.0, lev);
      ao *= mix(0.6, 1.0, under);
      if (!nearProps) {
        float rail = band(lev, 0.0, 1.15 / floorH, fwM.y / floorH);
        s.over = rail;
        s.overCol = mix(base, vec3(0.78, 0.78, 0.76), 0.5);
      }
    }
  }

  // 店先: 看板の帯（ひさしの上）。夜は看板が光る
  if (shopFront) {
    float signB = band(lev, 0.8, 0.97, fwM.y / floorH);
    vec3 signC = vec3(0.0);
    float pal = fract(seed * 61.0 + bi * 0.13);
    signC = pal < 0.2 ? vec3(0.45, 0.08, 0.06) : pal < 0.4 ? vec3(0.08, 0.2, 0.12) : pal < 0.6 ? vec3(0.06, 0.1, 0.25) : pal < 0.8 ? vec3(0.7, 0.66, 0.58) : vec3(0.12, 0.11, 0.1);
    // 文字のような明るい点
    float letters = fine * step(0.55, oHash(floor(vec2(u / 0.32, v / 0.22)) + seed * 9.0)) * band(lev, 0.84, 0.93, fwM.y / floorH) * band(fract(cu), 0.18, 0.82, fwM.x / bayW);
    vec3 letterC = pal > 0.6 && pal < 0.8 ? vec3(0.1) : vec3(0.85, 0.82, 0.72);
    albedo = mix(albedo, mix(signC, letterC, letters), signB);
    s.emit += (signC * 1.6 + letterC * letters * 1.5) * signB * uShop * 0.9;
    ao *= 1.0 - 0.3 * band(lev, 0.74, 0.8, fwM.y / floorH);
  }

  // --- 汚れ・色あせ・雨だれ（建物ごとにばらつく）---
  float blot = oNoise(vec2(u, v) * 0.35 + seed * 31.0) * 0.6 + oNoise(vec2(u, v) * 1.3 + seed * 7.0) * 0.4;
  albedo *= 1.0 - dirt * 0.22 * smoothstep(0.35, 0.8, blot);
  float lumA = dot(albedo, LUMA);
  albedo = mix(albedo, vec3(lumA), dirt * 0.25);
  // 足元のはね返りの汚れ
  albedo *= 1.0 - dirt * 0.3 * (1.0 - smoothstep(0.0, 0.9, v)) * (0.6 + 0.4 * oNoise(vec2(u * 3.0, v)));
  // 窓の下の雨だれ（窓台の両端から下へ）
  if (inside > 0.5 && px < 0.4) {
    float below = o0.y - cell.y;
    float xin = band(cell.x, o0.x - 0.05, o1.x + 0.05, fwM.x);
    float streak = xin * step(0.0, below) * exp(-below * 1.3) * smoothstep(0.45, 0.8, oNoise(vec2(u * 9.0 + seed * 40.0, 0.5)));
    albedo *= 1.0 - dirt * 0.38 * streak;
  }
  // 上端（軒・パラペットの下）から下りる筋
  float fromTop = vB.x - v;
  float topStreak = smoothstep(0.4, 0.75, oNoise(vec2(u * 2.3 + seed * 13.0, 0.5))) * exp(-max(fromTop, 0.0) * 0.35);
  albedo *= 1.0 - dirt * 0.32 * topStreak;

  // 環境光の遮り: 通りの底ほど暗い（向かいの建物で空が狭い）・軒の下
  ao *= mix(0.58, 1.0, smoothstep(-0.5, 6.0, v));
  if (vRoofC.a > 0.5 && part < 0.5) ao *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.9, vH.x - v));

  s.albedo = albedo;
  s.ao = ao;
  vec3 nWorld = normalize(T * tnw.x + U * tnw.y + N * tnw.z);
  s.n = nWorld;

  // --- 窓 ---
  if (open > 0.001) {
    vec3 R = reflect(-V, N);
    float fres = 0.04 + 0.96 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
    vec3 refl = envReflection(R);
    vec3 glassCol;
    vec3 rd = vec3(dot(-V, T), dot(-V, U), dot(V, N));
    // 浅い角度から見る窓は、部屋の奥の形が細かく詰まってちらつくので、平均の色へ（そこは映り込みが強いので目立たない）
    float graze = smoothstep(0.1, 0.32, rd.z);
    float useInterior = uInterior * (1.0 - tiny) * step(0.1, rd.z);
    float rs = fract(wh * 7.13 + seed);
    // 閉めた雨戸・シャッター（家。夜ほど多い）
    float closed = type < 1.5 ? step(fract(wh * 13.7), 0.08 + 0.3 * uNight * (1.0 - lit)) : 0.0;
    vec3 avgRoom = vec3(0.02, 0.019, 0.017) * (1.0 + 2.0 * dot(uSkyLight, LUMA)) + lamp * lit * bright * 0.45;
    if (useInterior > 0.001 && closed < 0.5) {
      float hitR;
      vec2 rn;
      float yF = -(o0.y + 0.15 * 0.0);
      float yC = floorH - o0.y - 0.05;
      vec3 room = roomInterior(wp, wsz, rd, reveal, yF, yC, roomD, rs, lit, lamp * bright, office, hitR, rn);
      if (hitR > 0.5) {
        // 見込み（窓の額縁の奥行き）の面: 外壁の色（開口の縁のなめらかな所は、開口の割合でまぜる）
        s.n = normalize(mix(s.n, normalize(T * rn.x + U * rn.y), open));
        s.ao *= mix(1.0, 0.8, open);
        open = 0.0;
      } else {
        vec2 pg = wp + rd.xy * (reveal / max(rd.z, 0.03));
        // カーテン・レース・ブラインド（ガラスのすぐ奥の面）
        vec2 pc = wp + rd.xy * ((reveal + 0.07) / max(rd.z, 0.03));
        float cv2 = fract(wh * 31.7);
        vec3 curtainC = mix(vec3(0.72, 0.68, 0.58), mix(vec3(0.45, 0.52, 0.6), vec3(0.6, 0.45, 0.36), fract(rs * 3.0)), step(0.6, fract(rs * 9.1)));
        vec3 dayIn = uSkyLight * 0.5 + uSunLight * 0.08;
        vec3 cloth = vec3(0.0);
        float clothA = 0.0;
        if (office < 0.5) {
          float cl = 0.12 + 0.3 * fract(rs * 4.1);
          float cr = 0.12 + 0.3 * fract(rs * 6.7);
          float folds = 1.0 - fine * 0.18 * (0.5 + 0.5 * sin(pc.x * 28.0 + rs * 10.0));
          if (cv2 < 0.6) {
            float sideC = 1.0 - step(cl * wsz.x, pc.x) * step(pc.x, wsz.x * (1.0 - cr));
            cloth = curtainC * folds;
            clothA = sideC;
            if (cv2 < 0.35 && sideC < 0.5) {
              cloth = vec3(0.8, 0.79, 0.76);
              clothA = 0.62;
            }
          } else if (cv2 < 0.72) {
            float level = wsz.y * (0.2 + 0.8 * fract(rs * 2.3));
            float slat = 1.0 - 0.2 * fine * smoothstep(0.2, 0.5, abs(fract(pc.y / 0.035) - 0.5));
            clothA = step(wsz.y - level, pc.y);
            cloth = vec3(0.72, 0.71, 0.68) * slat;
          } else if (cv2 < 0.82) {
            cloth = curtainC * (1.0 - fine * 0.18 * (0.5 + 0.5 * sin(pc.x * 22.0 + rs * 10.0)));
            clothA = 1.0;
          }
        } else if (!shopFront && cv2 < 0.5) {
          float level = wsz.y * (0.3 + 0.7 * fract(rs * 2.3));
          float slat = 1.0 - 0.2 * fine * smoothstep(0.2, 0.5, abs(fract(pc.y / 0.04) - 0.5));
          clothA = step(wsz.y - level, pc.y);
          cloth = vec3(0.7, 0.71, 0.7) * slat;
        }
        vec3 clothLit = cloth * (dayIn * 0.55 + lamp * lit * bright * 0.75);
        room = mix(room, clothLit, clothA);
        // 窓枠（ガラスの面の位置で。縦の召し合わせと、格子の窓は桟）
        float fr = 1.0 - rect(pg, vec2(frameW), wsz - frameW, fwM);
        float mid = office > 0.5 && type > 6.5 ? 0.0 : band(pg.x, wsz.x * 0.5 - 0.03, wsz.x * 0.5 + 0.03, fwM.x);
        if (muntin > 0.5) mid = max(mid, band(fract(pg.y / (wsz.y / 3.0)), 0.0, 0.03 * 3.0 / wsz.y, fwM.y / wsz.y));
        if (shopFront) mid = band(fract(pg.x / max(1.0, wsz.x / 3.0)), 0.0, 0.04, fwM.x);
        float frame = max(fr, mid);
        glassCol = mix(room, refl * 0.7, clamp(fres * 0.85 + 0.04, 0.0, 1.0));
        glassCol += uSunLight * pow(max(dot(R, uSunDir), 0.0), 300.0) * 2.0;
        glassCol = mix(glassCol, townLight(frameC, N, 1.0, townShadow(vWorld, N)), frame);
        glassCol = mix(mix(avgRoom, refl, clamp(fres + 0.06, 0.0, 1.0)), glassCol, graze);
      }
    } else {
      // 遠く（窓が画素より小さい）: 部屋の平均の色と映り込み
      glassCol = mix(avgRoom, refl, clamp(fres + 0.06, 0.0, 1.0));
      if (closed > 0.5) glassCol = townLight(vec3(0.38, 0.38, 0.37) * (0.85 + 0.15 * smoothstep(0.3, 0.7, abs(fract(cell.y / 0.08) - 0.5) * 2.0)), N, 0.9, townShadow(vWorld, N));
    }
    if (open > 0.0) {
      // 遠くは窓の面積の割合で平均（ちらつかない）
      float area = (wsz.x * wsz.y) / (bayW * floorH) * inside;
      float a = mix(open, area, tiny);
      s.glass = max(s.glass, a);
      s.glassCol = glassCol;
    }
  }
}

/** 屋根の画素（瓦・スレート・金属・陸屋根のコンクリートと屋上緑化） */
void roofSurface(inout Surf s, float dist) {
  vec3 N = s.n;
  float seed = vMeta.z;
  float style = vMeta.w;
  float flags = vMeta.y;
  bool flatR = abs(N.y) > 0.985;
  vec3 T = flatR ? vec3(vAxis.x, 0.0, vAxis.y) : normalize(cross(vec3(0.0, 1.0, 0.0), N));
  vec3 Bd = cross(N, T);
  vec2 m = vec2(dot(vWorld, T), dot(vWorld, Bd));
  float layer = 4.0;
  if (!flatR) {
    float r = fract(seed * 17.9);
    bool tinRoof = near(style, 6.0) || hasFlag(flags, 32.0) || near(vRoofC.a, 5.0) || near(vRoofC.a, 4.0) && r < 0.6;
    if (tinRoof || r < 0.12) layer = 5.0;
    else if (near(style, 1.0) || near(style, 7.0) || (near(style, 5.0) && r < 0.65) || near(vRoofC.a, 6.0)) layer = 7.0;
    else layer = 8.0;
  }
  float sc = layerScale(layer);
  vec3 det;
  vec3 tn;
  sampleLayer(vec2(m.x, -m.y) / sc + seed * 23.0, layer, 1.0, det, tn);
  vec3 base = s.albedo;
  vec3 albedo = tintDetail(base, det, layer > 6.5 ? 0.15 : 0.0);
  float nk = 1.0 - smoothstep(40.0, 220.0, dist);
  vec3 tnw = vec3(tn.xy * nk, 1.0);
  vec2 plan = vec2(vWorld.x, -vWorld.z);
  float dirt = vKind.z;
  // 屋根のむら（色あせ・苔・汚れ）
  float rn = oNoise(plan * 0.6 + seed * 50.0) * 0.6 + oNoise(plan * 2.1 + seed * 9.0) * 0.4;
  albedo *= 0.84 + 0.3 * mix(0.5, rn, 1.0 - smoothstep(120.0, 700.0, dist));
  albedo = mix(albedo, vec3(dot(albedo, LUMA)) * vec3(0.95, 1.0, 0.9), dirt * 0.3);
  if (!flatR) {
    // 棟（棟瓦の帯）と軒先（雨樋の陰）
    float hRel = vH.z;
    float tr = (hRel - vH.x) / max(vH.y - vH.x, 0.01);
    float fwT = fwidth(tr);
    float ridgeB = smoothstep(0.965 - fwT, 0.985 + fwT, tr) * step(vH.x + 0.5, vH.y);
    albedo = mix(albedo, albedo * 0.7, ridgeB);
    albedo *= 1.0 - 0.25 * (1.0 - smoothstep(-0.05, 0.12, tr)) * dirt;
    // 雨の筋（棟から下へ）
    albedo *= 1.0 - dirt * 0.18 * smoothstep(0.5, 0.85, oNoise(vec2(m.x * 1.7 + seed * 20.0, m.y * 0.15)));
    s.spec = layer > 4.5 && layer < 5.5 ? 0.25 : layer > 7.5 ? 0.12 : 0.05;
  } else {
    // 陸屋根: 防水の継ぎ目と継ぎはぎ、パラペットの際の陰
    float seams = max(band(fract(m.x / 5.0), 0.0, 0.012, fwidth(m.x / 5.0)), band(fract(m.y / 5.0), 0.0, 0.012, fwidth(m.y / 5.0)));
    albedo *= 1.0 - 0.18 * seams * (1.0 - smoothstep(60.0, 300.0, dist));
    float patchy = step(0.72, oNoise(floor(m / 3.0) + seed * 17.0));
    albedo *= 1.0 - 0.12 * patchy;
    if (hasFlag(flags, 4.0)) {
      float g = oNoise(plan * 0.9 + seed * 9.0) * 0.6 + oNoise(plan * 3.1) * 0.4;
      vec3 green = mix(vec3(0.05, 0.09, 0.035), vec3(0.11, 0.15, 0.06), g);
      float bed = smoothstep(0.35, 0.5, g);
      albedo = mix(albedo, green, mix(0.75, bed, 1.0 - smoothstep(150.0, 700.0, dist)));
    }
  }
  s.albedo = albedo;
  s.n = normalize(T * tnw.x + Bd * tnw.y + N * tnw.z);
}

void main() {
  // 面の向きは画面の微分から。細い三角形の縁などで 0 の長さになったら（normalize(0) は NaN）上向きにする
  vec3 cN = cross(dFdx(vWorld), dFdy(vWorld));
  float cl = dot(cN, cN);
  vec3 N = cl > 1e-24 ? cN * inversesqrt(cl) : vec3(0.0, 1.0, 0.0);
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  if (dot(N, V) < 0.0) N = -N;
  float part = vB.w;
  bool isRoof = part > 0.5 && part < 1.5;
  float seed = vMeta.z;
  vec3 albedo = isRoof ? vRoofC.rgb : vWallC.rgb;
  // データの色は「色の名前」の鮮やかな値なので、実際の外壁・屋根の明るさと彩度に寄せる（屋根は少しくすませ、白い壁は眩しすぎないように）
  float lum = dot(albedo, LUMA);
  if (isRoof) albedo = mix(vec3(lum), albedo, 0.68) * 0.72;
  else albedo = mix(vec3(lum), min(albedo, vec3(0.62)), 0.8) * 0.92;
  // 建物ごとの色のばらつき（色相も少し。隣同士が同じにならないように）
  float v1 = fract(seed * 13.7);
  float v2 = fract(seed * 29.3);
  albedo *= (0.84 + 0.3 * v1) * mix(vec3(1.0), vec3(1.06, 1.0, 0.92), v2 - 0.3);
  // 明るい外壁は、生成り・ベージュ・薄い灰色・薄茶のタイル・淡い桃色などにばらつかせる（白い箱の集まりに見えないように）
  if (!isRoof && lum > 0.25) {
    float pick = fract(seed * 71.3);
    vec3 tone = pick < 0.22 ? vec3(1.04, 0.98, 0.86) : pick < 0.4 ? vec3(0.94, 0.84, 0.7) : pick < 0.58 ? vec3(0.9, 0.93, 0.97) : pick < 0.72 ? vec3(1.0, 0.95, 0.9) : pick < 0.82 ? vec3(1.04, 0.92, 0.88) : pick < 0.92 ? vec3(0.72, 0.62, 0.52) : vec3(0.8, 0.82, 0.8);
    albedo *= mix(vec3(1.0), tone, 0.75);
  }
  Surf s = Surf(albedo, N, 1.0, 0.0, vec3(0.0), vec3(0.0), 0.0, 0.0, vec3(0.0));
  if (!isRoof) wallSurface(s, V, dist, part);
  else roofSurface(s, dist);
  float sh = townShadow(vWorld, N);
  vec3 col = townLight(s.albedo, s.n, s.ao, sh);
  // 照り返し（屋根の金属・スレート、カーテンウォールの腰のガラス）
  col += uSunLight * pow(max(dot(reflect(-V, s.n), uSunDir), 0.0), isRoof ? 40.0 : 200.0) * s.spec * sh * (isRoof ? 1.0 : 2.0);
  if (!isRoof) col += envReflection(reflect(-V, N)) * s.spec * 0.35;
  // 夜: 街灯・店先の灯りが壁を照らす（灯りの表。近くだけ）
  col += s.albedo * townLamps(vWorld, s.n) * s.ao;
  col = mix(col, s.glassCol, s.glass);
  col = mix(col, townLight(s.overCol, N, s.ao, sh), s.over);
  col = outdoorHaze(col, vWorld);
  col += s.emit * uLightGain * exp(-dist / (uHazeDist * 1.5));
  gl_FragColor = vec4(col, 1.0);
  ${TONE}
}
`

/** 建物のシェーダー（instanced = 型 × インスタンス、false = 形のある建物） */
export function createTownBuildingMaterial(instanced: boolean) {
  return new THREE.ShaderMaterial({
    name: instanced ? 'townBuildings' : 'townCustomBuildings',
    defines: { ...DEFINES, ...(instanced ? { TOWN_INSTANCED: '' } : {}) },
    uniforms: {
      ...outdoorUniforms,
      ...townTextureUniforms,
      ...townShadowUniforms,
      ...lampUniforms,
      uWindows: { value: 0 },
      uOffice: { value: 0 },
      uShop: { value: 0 },
      uLightGain: { value: 1 },
      uInterior: { value: 1 },
      uPropsCenter: propsCenter,
    },
    vertexShader: BUILDING_VERTEX,
    fragmentShader: BUILDING_FRAGMENT,
  })
}

/** 建物の影の深さだけのシェーダー（頂点の計算は建物と同じ） */
export function createTownBuildingDepthMaterial(instanced: boolean) {
  return depthMaterial(BUILDING_VERTEX, { defines: { ...DEFINES, ...(instanced ? { TOWN_INSTANCED: '' } : {}) }, uniforms: { uPropsCenter: propsCenter } })
}

/** 小物を形で描く範囲（x, y = 細かさの中心の平面座標、z = 半径 m）。外壁のシェーダーは、この中の建物のベランダの手すりを描かない（props.ts が形で描く） */
export const propsCenter = { value: new THREE.Vector3(0, 0, 0) }

/* -------------------------------------------------------------------------- */
/* 遠くの窓明かり（光の点）                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 遠くの建物の窓明かりを光の点でも描く（夜の町の灯りのきらめき。近くは建物のシェーダーの窓で足りるので、遠いほど出す）。
 * 建物のインスタンスの値をそのまま使い、点の頂点 aP = (壁の向き, 壁に沿った割合, 高さの割合, 順番) を、いちばん近い窓の中心へ寄せる。
 * 点くかどうかは建物のシェーダーと同じ決め方（WINDOW_RULES）
 */
export function createWindowSpriteMaterial() {
  return new THREE.ShaderMaterial({
    name: 'townWindowSprites',
    defines: DEFINES,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uWindows: { value: 0 },
      uOffice: { value: 0 },
      uShop: { value: 0 },
      uLightGain: { value: 1 },
      uPx: { value: 500 },
      uPixelRatio: { value: 1 },
      uTime: sharedTime,
      uHazeDist: outdoorUniforms.uHazeDist,
    },
    vertexShader: /* glsl */ `
      ${COMMON}
      ${WINDOW_RULES}
      attribute vec4 aP;
      attribute vec4 iPos;
      attribute vec4 iDim;
      attribute vec4 iExt;
      attribute vec4 iWall;
      attribute vec4 iRoof;
      attribute vec4 iMeta;
      uniform float uLightGain;
      uniform float uPx;
      uniform float uPixelRatio;
      varying vec3 vCol;
      varying float vCoreR;
      void main() {
        float w = iDim.x;
        float d = iDim.y;
        float eave = iDim.z;
        float roofKind = iRoof.w;
        float eaveEff = roofKind < 0.5 ? max(eave - 0.9, 2.2) : eave;
        float floorsN = max(iExt.y, 1.0);
        float floorH = eaveEff / floorsN;
        float side = aP.x;
        float span = side < 1.5 ? w : d;
        float facade = iWall.a;
        float use = iMeta.x;
        float flags = iMeta.y;
        float seed = (iMeta.z + iMeta.w * 256.0) / 65536.0;
        // 建物の大きさに合わせて点の数を変える（順番 aP.w がこれより小さい点だけ）
        float perimeter = 2.0 * (w + d);
        float count = clamp(floorsN * perimeter / 36.0, 1.0, 16.0);
        float type = facadeType(facade, use, flags, floorsN, iExt.w, seed);
        float nb = max(1.0, floor(span / bayTarget(type, use, flags) + 0.5));
        float bayW = span / nb;
        float bi = min(nb - 1.0, floor(aP.y * nb));
        float fi = min(floorsN - 1.0, floor(aP.z * floorsN));
        bool front = abs(side - iExt.z) < 0.5;
        float occ = occupancy(use, flags, fi, front, type);
        float lit = step(windowHash(bi, fi, side, seed), occ) * step(aP.w, count - 0.5) * step(0.3, bayW);
        // 工場は最上階の窓だけ
        if (near(type, 8.0) && fi < floorsN - 1.5) lit = 0.0;
        // 窓の中心（局所）と壁の外向き
        float along = (bi + 0.5) * bayW - 0.5 * span;
        float up = 0.15 + (fi + 0.55) * floorH;
        vec2 l;
        vec2 n;
        if (side < 0.5) { l = vec2(along, 0.5 * d + 0.15); n = vec2(0.0, 1.0); }
        else if (side < 1.5) { l = vec2(along, -0.5 * d - 0.15); n = vec2(0.0, -1.0); }
        else if (side < 2.5) { l = vec2(0.5 * w + 0.15, along); n = vec2(1.0, 0.0); }
        else { l = vec2(-0.5 * w - 0.15, along); n = vec2(-1.0, 0.0); }
        float c = cos(iPos.w);
        float s = sin(iPos.w);
        vec2 p = iPos.xy + vec2(c * l.x - s * l.y, s * l.x + c * l.y);
        vec2 nw = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
        vec3 world = vec3(p.x, iPos.z + up - LAB_FLOOR, -p.y);
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        float dd = max(-mv.z, 1.0);
        // カメラの側を向いた壁の窓だけ。近くは出さない（建物のシェーダーの窓がある）
        vec3 toCam = normalize(cameraPosition - world);
        float facing = smoothstep(0.0, 0.25, dot(vec3(nw.x, 0.0, -nw.y), toCam));
        float far = smoothstep(350.0, 900.0, dd);
        float px = 1.1 * uPx / dd;
        float minPx = 1.6 * uPixelRatio;
        float core = max(px, minPx);
        float energy = px < minPx ? mix(1.0, sqrt(px / minPx), 0.55) : 1.0;
        float sprite = min(core * 2.4, 24.0);
        vCoreR = core / sprite;
        float warm = oHash(vec2(bi * 1.7 + seed * 19.0, fi * 2.3 + 0.5));
        vec3 lamp = mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.86, 0.66), warm);
        float haze = exp(-dd / (uHazeDist * 1.4));
        float twinkle = 1.0 + 0.1 * sin(uTime * (1.5 + seed * 4.0) + bi * 3.0 + fi * 7.0);
        float k = lit * facing * far;
        vCol = lamp * k * energy * haze * twinkle * uLightGain * 0.75;
        gl_PointSize = k > 0.01 ? sprite : 0.0;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying float vCoreR;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0) discard;
        float core = 1.0 - smoothstep(vCoreR * 0.45, vCoreR, r);
        float halo = exp(-r * r * 5.0) * 0.22;
        gl_FragColor = vec4(vCol * (core * 2.0 + halo), 1.0);
        ${TONE}
      }
    `,
  })
}
