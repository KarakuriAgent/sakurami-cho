import { useState, useSyncExternalStore } from 'react'
import type { SpotKind } from 'sakurami-cho/core'
import { subscribeWarp, warpTo, warpUi } from '../teleport'

/**
 * ワープの一覧（右上のパネルの「ワープ」の札。動かすのは teleport.ts）。種類ごとの組（建物は開いておき、ほかはたたむ）。
 * 押すと短く暗くして跳ぶ（旅程は取り消す）。緑電の停留所・運河バスの乗り場は、町の地図データを読んでから出る（無ければラボだけ）。
 * 確かめの道具は data-walker="warp-<ワープ先の名前>" で押す
 */
export function WarpList() {
  const ui = useSyncExternalStore(subscribeWarp, warpUi)
  const [open, setOpen] = useState<ReadonlySet<SpotKind>>(() => new Set<SpotKind>(['building']))
  const toggle = (kind: SpotKind) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(kind)) n.delete(kind)
      else n.add(kind)
      return n
    })
  const busy = ui.fade !== 'none'
  return (
    <div className="warp-list" data-walker="warp-list">
      <p className="hint">作り込んだ建物と、乗り物ののりばの手前へ一瞬で移ります（移動中の旅程は取り消し、乗り物からは降ります）</p>
      {ui.message ? (
        <p className="status status-failed">{ui.message}</p>
      ) : (
        ui.last && <p className="status status-arrived">「{ui.last.label}」へワープしました</p>
      )}
      <div className="dest-list">
        {ui.groups.map((g) => {
          const shown = open.has(g.kind)
          return (
            <div key={g.kind} className="dest-group">
              <button type="button" className="dest-group-head" aria-expanded={shown} onClick={() => toggle(g.kind)}>
                {shown ? '▾' : '▸'} {g.label}（{g.items.length}）
              </button>
              {shown && (
                <ul>
                  {g.items.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="dest" data-walker={`warp-${s.id}`} disabled={busy} onClick={() => warpTo(s.id)}>
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {ui.unavailable ? (
        <p className="hint">町の地図データが無いので、ラボのワープ先だけです</p>
      ) : (
        !ui.complete && <p className="hint">緑電の停留所・運河バスの乗り場は、町の地図データを読んでから出ます</p>
      )}
    </div>
  )
}
