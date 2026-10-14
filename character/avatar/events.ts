import type { PlaceId } from '../../core/places'
import type { Car } from '../../world/outdoor/transit/vehicle'

/**
 * キャラクターの出来事（character.on。docs/design/map-split.md §5 の「段 3 の作りの決めごと」）。
 * 状態が変わったその場（同じコマ・同じ関数の中）で、聞いている所をそのまま呼ぶ。聞く側は自分の状態を書くだけにし、
 * 乗る仕組み・動きの状態（ch.ride・ch.rides・ch.motion）を書き換えない（出したあとの計算と順を変えないため）。
 * 出すときに物を作らない（渡すのは今ある Car・立ち寄り先の名前・null）。聞く所が無ければ、名前で引くだけ。
 *
 * 乗り物の出来事（観覧車 character/ride/ride.ts・ケーブル cableRide.ts・緑電と運河バス lineRide.ts・ホバー hoverRide.ts）は、乗り降り 1 回で
 * ride.wait → ride.board → ride.enter → ride.riding → ride.arrived → ride.alight → ride.exit → ride.left の順に 1 回ずつ出る
 * （待つ間に乗る便を決め直したら ride.wait をもう一度出す。途中でやめたら ride.cancel。ホバーを浮く前にやめたときは arrived を出さずに alight から）。
 * 渡すのはその便の車室（Car）。一緒に乗る仲間（character/ride/party.ts）を乗り降りさせる使う側が聞く（kanon-lab の KB-001 は src/kb001/follow.ts）。分かれ目:
 *
 * | 出来事 | 観覧車 | ケーブル | 緑電・運河バス | ホバー |
 * |---|---|---|---|---|
 * | ride.wait | 乗るゴンドラを決めた | 乗る車両を決めた | 乗る便を決めた | 呼んだホバーの横に着いた（来ていれば board と同じコマ） |
 * | ride.board | 乗り込みの道を歩き出した（phase = board） | 同じ | 同じ | 同じ（呼んだホバーが下りてから） |
 * | ride.enter | 扉の内へ入った（KB-001 が続いて入る所） | 扉の内へ入った（KB-001 が並走へ） | 扉の内へ入った（KB-001 が続いて入る所） | 床板の上へ乗った |
 * | ride.riding | 座って扉が閉まった（phase = riding） | 座った・立った（phase = riding） | 同じ | 腰掛けた（ファンを回し始める。KB-001 が並走へ） |
 * | ride.arrived | 下へ戻って降りる扉が開く所（alight と同じコマ） | 着いて扉が開いた（alight と同じコマ） | 同じ | 行き先の近くに下りた（KB-001 の並走が終わる） |
 * | ride.alight | 立ち始めた（phase = alight） | 同じ | 同じ | 同じ |
 * | ride.exit | 扉へ歩き出した（KB-001 が降り始める所） | 扉の外へ出た（KB-001 が並走をやめる所） | 扉まで来た（KB-001 が降り始める所） | 床板から下りた |
 * | ride.left | 降車位置に着いた（phase = none） | ホームに出た（phase = none） | 同じ | ホバーの横の地面に下りた（phase = none） |
 * | ride.cancel | 待つ間にやめた・置き直された | やめた・乗れなかった・置き直された | 同じ | 同じ |
 *
 * ほか: arrive = 歩いて立ち寄り先・町の行き先に着いた（向きを合わせ終えたコマ。立ち寄り先の名前か null）、
 * place = 置き直された（kanon.place・町の中の移動のカットで別の所へ移った。motion.placeSerial が増えたコマ。置いた立ち寄り先の名前か null）
 */
export interface CharacterEventMap {
  'ride.wait': Car
  'ride.board': Car
  'ride.enter': Car
  'ride.riding': Car
  'ride.arrived': Car
  'ride.alight': Car
  'ride.exit': Car
  'ride.left': Car
  'ride.cancel': Car
  arrive: PlaceId | null
  place: PlaceId | null
}
export type CharacterEventName = keyof CharacterEventMap

/** 出来事の名前の一覧（確かめの道具などが全部を聞くとき） */
export const CHARACTER_EVENTS: readonly CharacterEventName[] = [
  'ride.wait',
  'ride.board',
  'ride.enter',
  'ride.riding',
  'ride.arrived',
  'ride.alight',
  'ride.exit',
  'ride.left',
  'ride.cancel',
  'arrive',
  'place',
]

type Listener = (e: never) => void

/** 出来事の入れ物（Character が 1 つずつ持つ。聞く所の一覧は付け外しのたびに作り直すので、呼んでいる途中に外しても崩れない） */
export class CharacterEvents {
  private readonly lists = new Map<CharacterEventName, readonly Listener[]>()

  /** 出来事を聞く（やめる関数を返す） */
  on<K extends CharacterEventName>(name: K, fn: (e: CharacterEventMap[K]) => void): () => void {
    const l = fn as Listener
    this.lists.set(name, [...(this.lists.get(name) ?? []), l])
    return () => {
      const cur = this.lists.get(name)
      if (!cur) return
      const i = cur.indexOf(l)
      if (i < 0) return
      const next = cur.filter((_, j) => j !== i)
      if (next.length) this.lists.set(name, next)
      else this.lists.delete(name)
    }
  }

  /** 出来事を知らせる（キャラクターと乗る仕組みの側が、状態を変えたその場で呼ぶ） */
  emit<K extends CharacterEventName>(name: K, e: CharacterEventMap[K]) {
    const l = this.lists.get(name)
    if (!l) return
    for (let i = 0; i < l.length; i++) (l[i] as (e: CharacterEventMap[K]) => void)(e)
  }
}
