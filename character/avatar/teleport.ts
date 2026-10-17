import { zoneOfPoint, type ZoneId } from '../../core/interiors'
import { townPlaces, type PlaceId } from '../../core/places'
import { PLACE_SPOTS, type SpotKind } from '../../core/spots'
import { SITE } from '../../core/town'
import { interiors } from '../../world/outdoor/interior/interiors'
import { site } from '../../world/outdoor/site/siteModel'
import { townSolids } from '../../world/walk/townSolids'
import { boatLandings, LANDING, landingPoint, topA } from '../../world/outdoor/transit/landings'
import { TRAM_PLATFORM, tramNet, tramPlatformTop, type TramPlatform } from '../../world/outdoor/transit/trams'
import { terrainHeight } from '../../world/outdoor/town/terrain'
import { cancelWarp } from '../ride/warp'
import { stopDirect } from './direct'
import { groundHeight, placeAt } from './locomotion'
import { cancelTravel } from './travel'
import type { Character } from './character'
import { releaseTurnStep } from './turnStep'

/**
 * ワープ（コードでは teleport。warp は時刻の早送り・カットの名前。docs/design/map-split.md §8 の段 6-5。例のアプリ town-walker が使う。kanon-lab は読まない）。
 * 作り込んだ建物の手前と、乗り物ののりばの手前へ一瞬で移る。
 *
 * - ワープ先の一覧 townSpots(): 地図の core の名前の表（core/spots.ts の立ち寄り先）と、町を組み立てたあとの地図データの
 *   緑電の停留所（ホームの上）・運河バスの乗り場（石段の上の陸の側の敷石）。地図データを読むまでは、緑電・運河バスは入らない。
 *   緑電はホームのある停留所だけ（データの停留所の点が系統の線から遠く、ホームを置かない停留所は、緑電も止まらないので入れない）
 * - teleport(ch, spot): 町の中の移動（旅程）を取り消し、乗り物の早送り・カットをやめ、旅程の早送りの倍率と歩幅を戻し、WASD・クリックの歩きをやめてから、
 *   立ち寄り先なら placeAt（locomotion。kanon.place と同じ）、点なら placeAtPoint で置く。どちらも motion.placeSerial を増やして 'place' を出す
 * - 乗り物に乗っている途中（緑電・運河バス・ケーブル・観覧車のゴンドラ・ホバー）でも置ける。乗る仕組みは placeSerial が変わったのを次のコマの
 *   updateRiders（歩きを進める前）で見て、乗るのをやめる（降りたことにする: ride.car = null・phase = none。ホバーは飛ぶ途中なら、その下の地面に下ろして置く）
 */

export interface TownSpot {
  /** 名前（<種類>:<立ち寄り先・乗り場の名前>。一覧と teleport で引く） */
  id: string
  kind: SpotKind
  /** 一覧の字 */
  label: string
  /** 立ち寄り先へ置くワープ先は立ち寄り先の名前（placeAt）。ほかは null（x, z, heading の点へ placeAtPoint） */
  place: PlaceId | null
  /** 立つ所（シーンの x, z）と向き（0 = +z） */
  x: number
  z: number
  heading: number
  /** 足元の面を選ぶ高さの目安（シーンの y。ホーム・乗り場の高さ。橋の上と下を分ける）。null なら地形の高さ */
  refY: number | null
  /** 立つ所のゾーン */
  zone: ZoneId
}

/** 緑電の停留所のワープ先: ホームの + の端から内へ（m。仮） */
const TRAM_SPOT_FROM_END = 4
/**
 * 緑電のホームの上の点のうち、地形がホームの面よりこの高さ（m）を越えて上にある所と、町の当たり（ホームにかかる木など）の中には立たせない（6-7。仮）。
 * 坂の停留所のホームが土手に埋まっていたのは、ホームの面を線路に沿わせ、まわりの地形を下げて直した（world/outdoor/transit/trams.ts の tramPlatformGrade）。
 * + の端から TRAM_SPOT_FROM_END の点から − の端の方へ TRAM_SPOT_STEP ずつ、ホームを 1 つめから順に探す（どこもだめなら 1 つめのホームの初めの点）
 */
const TRAM_BURIED = 0.1
const TRAM_SPOT_STEP = 2
/** 運河バスの乗り場のワープ先: 上の踊り場の真ん中から札の柱の反対へ（m）と、陸の側の敷石の奥行きの割合（仮） */
const WATERBUS_SPOT_A = 0.6
const WATERBUS_SPOT_B = 0.6

/** 町の平面座標（x, y）→ シーンの x, z */
const scene = (p: readonly [number, number]): [number, number] => [p[0], -p[1]]

/**
 * ワープ先の一覧（並びは種類の並び（core/spots.ts の SPOT_KINDS）の中で、表・地図データの並び。呼ぶたびに作る）
 */
export function townSpots(): TownSpot[] {
  const out: TownSpot[] = []
  const places = townPlaces()
  for (const s of PLACE_SPOTS) {
    const p = places[s.place]
    if (!p) continue
    out.push({ id: `${s.kind}:${s.place}`, kind: s.kind, label: p.label, place: s.place, x: p.position[0], z: p.position[2], heading: p.heading, refY: null, zone: p.zone ?? 'lab' })
  }
  // 緑電の停留所: ホームの上の、線の向き（+）の端寄り（えきもりが立つ − の端の反対。スロープの下の道は、線路が道の外を通る停留所では
  // 歩ける所でないため）。幅の真ん中で、線路の方を向いて立つ
  // 立つ点は、地形に埋まっていない・町の当たりの中でない所（上の TRAM_BURIED。6-7）
  const end = TRAM_PLATFORM.length / 2 - TRAM_SPOT_FROM_END
  const free = (q: TramPlatform, a: number) => {
    const top = tramPlatformTop(q, a)
    const [x, z] = scene([q.x + q.dx * a, q.y + q.dy * a])
    return terrainHeight(q.x + q.dx * a, q.y + q.dy * a) <= top + TRAM_BURIED && !townSolids.blocker(x, top - SITE.labFloorElevation + 0.3, z, 0.2)
  }
  for (const st of tramNet.stops) {
    let pf: TramPlatform | undefined = st.platforms[0]
    let a = end
    search: for (const q of st.platforms) {
      for (let b = end; b >= -end; b -= TRAM_SPOT_STEP) {
        if (!free(q, b)) continue
        pf = q
        a = b
        break search
      }
    }
    if (!pf) continue
    const [x, z] = scene([pf.x + pf.dx * a, pf.y + pf.dy * a])
    // ホームの外の向き（線路から離れる向き）は (−dy, dx)·side。線路の方はその逆
    const heading = Math.atan2(pf.dy * pf.side, pf.dx * pf.side)
    out.push({ id: `tram:${st.name}`, kind: 'tram', label: `${st.name}（${st.lines.join('・')} 系統）`, place: null, x, z, heading, refY: tramPlatformTop(pf, a) - SITE.labFloorElevation, zone: zoneOfPoint(x, z) })
  }
  // 運河バスの乗り場: 石段の上の陸の側の敷石（乗り場の歩ける面。札の柱とえきもりの反対の端寄り。町の道を歩いて来る点（landingTown）は
  // 道の外の芝・岸の地面のことが多く、歩ける所でないため）。水の方を向く
  for (const l of boatLandings.list) {
    const [x, z] = scene(landingPoint(l, topA(l) - l.sgn * WATERBUS_SPOT_A, -LANDING.apron * WATERBUS_SPOT_B))
    out.push({ id: `waterbus:${l.id}`, kind: 'waterbus', label: `${l.name}（${l.routes.join('・')} 航路）`, place: null, x, z, heading: Math.atan2(l.wx, -l.wy), refY: l.top - SITE.labFloorElevation, zone: zoneOfPoint(x, z) })
  }
  return out
}

/**
 * 人を点（シーンの x, z）にすぐ置く（歩かない）。足元は refY（省けば地形の高さ）にいちばん近い地面・床（橋・ホーム・中のある建物の床）。
 * ゾーンは点から、階は中のある建物の決まりがあれば足元の高さから。立ち寄り先にはいない（stopId = null）・行動なし。
 * motion.placeSerial を増やし、'place'（null）を出す（乗っている乗り物は次のコマで降りたことになる。追うカメラ・付き添いが一緒に移る合図）
 */
export function placeAtPoint(ch: Character, x: number, z: number, heading: number, refY: number | null = null) {
  const m = ch.motion
  const nav = ch.nav
  nav.pending = null
  nav.curve = null
  const ground = groundHeight(ch, x, z, false, refY ?? site.groundY(x, z))
  const zone = zoneOfPoint(x, z)
  const model = zone === 'lab' || zone === 'town' ? null : interiors.models.get(zone)
  m.position.set(x, ground, z)
  m.ground = ground
  m.heading = heading
  m.moveDir.set(Math.sin(heading), 0, Math.cos(heading))
  m.speed = 0
  m.turnRate = 0
  releaseTurnStep(m.step)
  m.walk = 0
  m.phase = 'idle'
  m.stopId = null
  m.targetId = null
  m.action = null
  m.actionBlend = 0
  m.activityHeld = false
  m.seat = null
  m.zone = zone
  m.level = model ? model.levelAt(x, z, ground) : 0
  m.arrivedAt = nav.lastT
  m.placeSerial++
  nav.snapPending = false
  ch.errors.unreachable = null
  ch.errors.reason = null
  nav.dwellUntil = nav.lastT + 8 + ch.rnd() * 12
  ch.events.emit('place', null)
}

/**
 * ワープ先 spot へ一瞬で移る。旅程を取り消し（cancelTravel）、乗り物の早送り・カットをやめ（cancelWarp。町の時刻の早送りが止まる）、
 * 旅程の早送りの倍率と歩幅を戻し、WASD・クリックの歩きをやめてから置く（立ち寄り先は placeAt を行動なしで、点は placeAtPoint）。
 * 乗っている途中なら、乗る仕組みが次のコマで降りたことにする
 */
export function teleport(ch: Character, spot: TownSpot) {
  cancelTravel(ch, 'ワープ')
  cancelWarp(ch)
  ch.motion.timeScale = 1
  ch.motion.stride = null
  stopDirect(ch)
  if (spot.place) placeAt(ch, spot.place, false)
  else placeAtPoint(ch, spot.x, spot.z, spot.heading, spot.refY)
}
