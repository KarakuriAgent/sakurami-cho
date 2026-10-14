import { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribeWalk, walkUi } from '../walk'
import { openTravel, travelTo } from '../travel'

/** 案内を出しておく長さ（ミリ秒。近くの行き先を添えたときは長め） */
const NOTICE_MS = 5000
const SUGGEST_MS = 9000

/**
 * 歩き方の案内（下の真ん中）: 操作の説明と、クリックで歩けなかった理由（ゾーンをまたぐ・立てない所など。数秒で消える）。
 * ゾーンをまたぐ移動は行き先の一覧（ui/TravelPanel.tsx）から選んでもらう: クリックした所の近くに行き先があれば「そこへ行く」（旅程）と、
 * 行き先の一覧のその組を開く口を添える（6-4）
 */
export function WalkNotice() {
  const ui = useSyncExternalStore(subscribeWalk, walkUi)
  // 消した案内（出した回数）。同じ字をもう一度出したときは回数が増えるので、また出る
  const [expired, setExpired] = useState(0)
  useEffect(() => {
    if (!ui.notice) return
    const id = setTimeout(() => setExpired(ui.serial), ui.suggest ? SUGGEST_MS : NOTICE_MS)
    return () => clearTimeout(id)
  }, [ui.notice, ui.serial, ui.suggest])
  const shown = ui.notice && expired !== ui.serial
  const suggest = shown ? ui.suggest : null
  return (
    <div className="walk-notice">
      {shown && (
        <p className="notice" role="status" data-walker="notice">
          {ui.notice}
        </p>
      )}
      {suggest && (
        <p className="suggest">
          <button
            type="button"
            className="button"
            data-walker="suggest-go"
            onClick={() => {
              setExpired(ui.serial)
              travelTo(suggest.id)
            }}
          >
            「{suggest.label}」へ行く（約 {suggest.distance}m 先）
          </button>
          <button type="button" className="button secondary" data-walker="suggest-list" onClick={() => openTravel(true, suggest.group)}>
            行き先の一覧
          </button>
        </p>
      )}
      <p className="help">WASD・矢印で歩く（Shift で走る）・Space で跳ぶ・地面をクリックで歩く・ドラッグで回す・ホイールで寄る・右の一覧から行き先を選ぶ・ワープする・小さい地図を押すと全体の地図</p>
    </div>
  )
}
