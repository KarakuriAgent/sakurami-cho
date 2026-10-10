/**
 * 建物の外壁の型（GLSL）。建物のシェーダー（townMaterials.ts の createTownBuildingMaterial）と遠くの窓明かりの点が使う。
 *
 * 外壁の型（FACADE_TYPE）は、インスタンスの値（外壁の種類・用途・印・階数・町並みの型・種）から頂点のシェーダーで 1 棟ごとに決める:
 * 0 木造の家（板張り・雨戸）/ 1 モルタルの家 / 2 （予備）/ 3 煉瓦（縦長の窓・アーチ・石の帯・軒蛇腹）/ 4 石造（1 階の目地・窓まわり・帯・軒蛇腹）/
 * 5 RC の集合住宅（正面のベランダ・掃き出し窓・隣との仕切り）/ 6 事務所（腰壁と連窓・縦の柱形）/ 7 カーテンウォール（方立てと腰のガラス）/
 * 8 工場・倉庫（波板・高い窓・シャッター）/ 9 学校（連窓・正面の廊下のベランダ）。1 階の店（印 shop）は、どの型でも正面の 1 階を店先にする。
 *
 * 窓は「階 × 間口」の格子。窓の中は部屋の奥行きを描く（インテリアマッピング: 窓の額縁の奥行き（見込み）→ ガラス → 部屋の箱（奥の壁・横の壁・床・天井・家具の影）、
 * カーテン・レース・ブラインド・閉めた雨戸）。昼は暗い部屋と空の映り込み、夜は点いた部屋が電球色に光る（点き方は WINDOW_RULES。遠くの窓明かりの点と同じ答え）。
 * 窓が画素より小さい遠くでは、窓の面積と点いている割合の平均で描く（ちらつかない）。
 * 外壁は CC0 の実写の質感（townTextures.ts）をデータの色で染め、汚れ（足元・窓の下の雨だれ・上端の筋・まだら）と色あせを建物ごとにばらつかせる。
 */

/** 外壁の型の番号（GLSL の facadeType と同じ） */
export const FACADE_TYPE = { woodHouse: 0, mortarHouse: 1, brick: 3, stone: 4, apartment: 5, office: 6, curtainWall: 7, factory: 8, school: 9 } as const

/**
 * 窓の並びと、点いているかの決め方（建物のシェーダーと遠くの窓明かりの点が同じ答えを出す）。
 * use: 0 住宅・1 併用・2 商業・3 事務所・4 港・5 工房・6 公共・7 ラボ・8 学校・9 宗教。flags: 2 高架下・4 屋上緑化・8 花・16 店・32 倉庫・64 高い・128 生け垣
 */
export const WINDOW_RULES = /* glsl */ `
uniform float uWindows;
uniform float uOffice;
uniform float uShop;
/** 印のビットが立っているか（補間された値は整数から少しずれるので、丸めてから） */
bool hasFlag(float flags, float bit) {
  return mod(floor((floor(flags + 0.5) + 0.5) / bit), 2.0) > 0.5;
}
bool near(float a, float b) {
  return abs(a - b) < 0.5;
}
/** 外壁の型（1 棟ごと。facades.ts の FACADE_TYPE） */
float facadeType(float facade, float use, float flags, float floors, float style, float seed) {
  if (near(facade, 4.0)) return 7.0;
  if (hasFlag(flags, 32.0) || near(facade, 6.0)) return 8.0;
  if (near(use, 8.0) && floors > 1.5) return 9.0;
  bool oldTown = near(style, 2.0) || near(style, 7.0) || near(style, 1.0);
  if ((near(facade, 3.0) || near(facade, 7.0)) && (oldTown || floors < 4.5 || fract(seed * 5.7) < 0.5)) return 3.0;
  // 石の外壁は、古い町（洋風・島・和）と低い建物だけ石造。中層の町の「石のような色」の壁は RC の集合住宅・事務所にする
  if (near(facade, 2.0) && (oldTown || floors < 2.5 || near(use, 6.0) || near(use, 9.0))) return 4.0;
  bool officeUse = near(use, 3.0) || near(use, 6.0) || near(use, 7.0) || (near(use, 2.0) && floors > 4.5);
  if (officeUse && floors > 2.5) return 6.0;
  if ((use < 2.5) && floors > 2.5 && (floors > 3.5 || fract(seed * 7.31) < 0.6 || near(style, 3.0) || near(style, 4.0))) return 5.0;
  if (near(facade, 2.0) || near(facade, 3.0)) return near(facade, 3.0) ? 3.0 : 1.0;
  if (near(facade, 0.0)) return 0.0;
  return 1.0;
}
/** 窓の間口の目安（m） */
float bayTarget(float type, float use, float flags) {
  if (near(type, 7.0)) return 1.5;
  if (near(type, 8.0)) return 6.0;
  if (near(type, 9.0)) return 3.6;
  if (near(type, 6.0)) return 3.0;
  if (near(type, 5.0)) return 3.3;
  if (near(type, 3.0)) return 3.1;
  if (near(type, 4.0)) return 3.0;
  return 2.9;
}
/** その用途・階の窓が点いている割合 */
float occupancy(float use, float flags, float floorIndex, bool front, float type) {
  if (hasFlag(flags, 16.0) && floorIndex < 0.5 && front) return uShop;
  if (near(type, 8.0)) return uOffice * 0.35;
  if (near(use, 3.0) || (use > 5.5 && use < 9.5)) return uOffice;
  if (use > 3.5 && use < 5.5) return uOffice * 0.5;
  return uWindows;
}
/** 窓ごとの乱数（窓の列 bi・階 fi・壁の向き side・建物の種 seed） */
float windowHash(float bi, float fi, float side, float seed) {
  return oHash(vec2(bi + side * 37.0 + seed * 311.0, fi + seed * 71.0));
}
`

/** 型ごとの質感の層と汚れやすさ（頂点のシェーダー。1 棟ごとに同じ値） */
export const FACADE_KIND = /* glsl */ `
/** 外壁の質感の層（townTextures.ts の BUILDING_LAYER） */
float wallLayer(float facade, float type, float seed) {
  if (near(facade, 0.0)) return 0.0;
  if (near(facade, 2.0) && near(type, 4.0)) return 2.0;
  if (near(facade, 2.0)) return fract(seed * 3.77) < 0.45 ? 6.0 : 1.0;
  if (near(facade, 3.0) || near(facade, 7.0)) return 3.0;
  if (near(facade, 6.0)) return 5.0;
  if (near(facade, 4.0)) return 4.0;
  if (near(type, 8.0)) return 5.0;
  if ((near(type, 5.0) || near(type, 6.0)) && fract(seed * 3.77) < 0.38) return 6.0;
  if (near(facade, 5.0)) return 4.0;
  return 1.0;
}
/** 汚れやすさ（町並みの型と種から。古い町ほど汚れ、新しい高層はきれい） */
float dirtOf(float style, float seed) {
  float b = near(style, 1.0) ? 0.65 : near(style, 2.0) ? 0.75 : near(style, 3.0) ? 0.5 : near(style, 4.0) ? 0.18 : near(style, 5.0) ? 0.32 : near(style, 6.0) ? 0.85 : near(style, 7.0) ? 0.7 : 0.45;
  return b * (0.55 + 0.9 * fract(seed * 91.7));
}
`

/** 光（太陽・空・照り返し・環境光の遮り）と、町の影（shadows.ts が townShadow を入れる） */
export const TOWN_LIGHT = /* glsl */ `
/** 太陽の直射（影 sh）と空の光（環境光の遮り ao）と、地面の照り返し（下を向くほど・太陽が高いほど暖色） */
vec3 townLight(vec3 albedo, vec3 N, float ao, float sh) {
  float ndl = max(dot(N, uSunDir), 0.0);
  float up = N.y * 0.5 + 0.5;
  vec3 sky = uSkyLight * (0.22 + 0.5 * up);
  vec3 bounce = uSunLight * vec3(0.95, 0.82, 0.66) * (0.06 + 0.16 * max(uSunDir.y, 0.0)) * (1.0 - 0.6 * up);
  return albedo * (uSunLight * ndl * sh + (sky + bounce) * ao);
}
`

/**
 * 窓の奥の部屋（インテリアマッピング）。p = 開口の中の位置（m。左下が 0）、sz = 開口の大きさ、rd = 接空間の視線（x 壁に沿って・y 上・z 壁の奥へ）、
 * reveal = 額縁の見込み（m）、yF・yC = 開口の下端から床・天井まで（m）、D = 部屋の奥行き、rs = 部屋の乱数、lit = 点いているか、lamp = 灯りの色。
 * 戻り値は光を当てたあとの色。見込みに当たったら hitR = 1 と見込みの面の向き（接空間）
 */
export const INTERIOR = /* glsl */ `
vec3 roomInterior(vec2 p, vec2 sz, vec3 rd, float reveal, float yF, float yC, float D, float rs, float lit, vec3 lamp, float office, out float hitR, out vec2 revealN) {
  hitR = 0.0;
  revealN = vec2(0.0);
  rd.z = max(rd.z, 0.03);
  vec2 rxy = vec2(abs(rd.x) < 1e-4 ? 1e-4 : rd.x, abs(rd.y) < 1e-4 ? 1e-4 : rd.y);
  vec2 pg = p + rd.xy * (reveal / rd.z);
  if (pg.x < 0.0 || pg.x > sz.x || pg.y < 0.0 || pg.y > sz.y) {
    vec2 tb = (mix(vec2(0.0), sz, step(0.0, rxy)) - p) / rxy;
    hitR = 1.0;
    revealN = tb.x < tb.y ? vec2(-sign(rxy.x), 0.0) : vec2(0.0, -sign(rxy.y));
    return vec3(0.0);
  }
  vec3 o = vec3(pg, reveal);
  float ex = 0.9 + 1.4 * fract(rs * 5.3);
  vec3 bmin = vec3(-ex, yF, reveal);
  vec3 bmax = vec3(sz.x + ex, yC, reveal + D);
  vec3 r = vec3(rxy, rd.z);
  vec3 tb = (mix(bmin, bmax, step(0.0, r)) - o) / r;
  float t = min(tb.x, min(tb.y, tb.z));
  vec3 h = o + r * t;
  float depth = clamp((h.z - reveal) / D, 0.0, 1.0);
  // 部屋の色（壁は白・生成り・薄い色、床は木・畳・灰色のカーペット、天井は白）
  float k1 = fract(rs * 13.1);
  float k2 = fract(rs * 7.7);
  vec3 wallC = mix(vec3(0.62, 0.58, 0.5), vec3(0.5, 0.52, 0.5), k1) * mix(0.75, 1.05, k2);
  if (k2 > 0.86) wallC = mix(vec3(0.45, 0.5, 0.42), vec3(0.55, 0.45, 0.38), k1);
  vec3 floorC = k1 < 0.35 ? vec3(0.32, 0.2, 0.11) : k1 < 0.6 ? vec3(0.42, 0.4, 0.22) : vec3(0.22, 0.22, 0.23);
  if (office > 0.5) {
    wallC = vec3(0.55, 0.56, 0.55);
    floorC = vec3(0.16, 0.17, 0.19);
  }
  vec3 c;
  vec3 add = vec3(0.0);
  bool back = t == tb.z;
  bool flr = t == tb.y && r.y < 0.0;
  bool ceil = t == tb.y && r.y > 0.0;
  if (back) {
    c = wallC;
    // 家具の影（棚・ソファ・机）と、壁の額
    float fx = fract(h.x * 0.29 + rs * 3.1);
    float fh = mix(0.8, 1.9, step(0.55, fract(rs * 17.3)));
    if (h.y - yF < fh && fx < 0.5) c = mix(vec3(0.16, 0.11, 0.07), vec3(0.3, 0.28, 0.25), fract(rs * 29.0));
    else if (abs(h.y - yF - 1.55) < 0.25 && abs(fract(h.x * 0.21 + rs) - 0.6) < 0.08) c = mix(vec3(0.5, 0.3, 0.2), vec3(0.2, 0.3, 0.45), k1);
    if (office > 0.5 && h.y - yF < 0.75) c = vec3(0.25, 0.25, 0.27);
  } else if (flr) {
    c = floorC;
  } else if (ceil) {
    c = vec3(0.7, 0.69, 0.66);
  } else {
    c = wallC * 0.9;
    // 横の壁の家具
    if (h.y - yF < 0.9 && h.z - reveal > D * 0.35) c = mix(vec3(0.2, 0.14, 0.09), vec3(0.35, 0.33, 0.3), k2);
  }
  // 昼: 窓からの光（奥ほど暗い。床は窓の近くが明るい）
  vec3 dayL = (uSkyLight * 0.7 + uSunLight * 0.09) * mix(1.0, 0.3, depth);
  if (flr) dayL *= 1.0 + 0.8 * (1.0 - depth);
  // 夜: 天井の灯り（点いている部屋だけ）
  vec3 lp = vec3(sz.x * 0.5, yC - 0.1, reveal + D * 0.45);
  vec3 dl = h - lp;
  float lf = 1.0 / (1.0 + dot(dl, dl) * 0.35);
  vec3 nightL = lamp * lit * (0.35 + 1.5 * lf);
  if (ceil) {
    nightL = lamp * lit * (0.4 + 0.8 * lf);
    if (office > 0.5) {
      // 事務所の天井の照明の列
      float rowsZ = abs(fract((h.z - reveal) / 1.8) - 0.5);
      float rowsX = abs(fract(h.x / 2.4) - 0.5);
      add += vec3(2.2) * lit * smoothstep(0.08, 0.02, rowsZ) * smoothstep(0.42, 0.3, rowsX);
    } else {
      add += lamp * 2.4 * lit * smoothstep(0.32, 0.12, length(h.xz - lp.xz));
    }
  }
  return c * (dayL + nightL) + add;
}
`
