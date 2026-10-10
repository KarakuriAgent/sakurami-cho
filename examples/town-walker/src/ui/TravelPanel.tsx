import { useState, useSyncExternalStore } from 'react'
import {
  alightWheel,
  boardWheel,
  DESTINATION_GROUPS,
  openTravel,
  reachable,
  ROUTE_CHOICES,
  setTravelOptions,
  stopTravel,
  subscribeTravel,
  TIME_CHOICES,
  travelTo,
  travelUi,
  VIA_CHOICES,
  type TravelOptions,
  type TravelUi,
} from '../travel'
import { subscribeTownStatus, townStatus } from '../town'
import { WarpList } from './WarpList'

/**
 * 行き先の一覧と旅程の様子（右上）。動かすのは travel.ts。
 * - 上: 町の時刻・今の移動（行き先・道のり・今の区間・乗っている乗り物・足した時間）・結果（着いた・取り消した・だめだった理由）・取り消す
 * - 札（仮）: 「行き先の一覧」（下の進め方・観覧車・行き先の組）と「ワープ」（ui/WarpList.tsx。6-5）を切り替える。案内から組を開いたときは行き先の一覧へ
 * - 進め方（たたむ）: 道順・乗り物・時間（カットの仕方・早送りの長さ）・乗っている間と待つ間・座るか立つか
 * - 観覧車ソラノワの乗り場にいるとき: 乗る・降りる
 * - 行き先: ゾーンごとの組（たたむ。クリックの案内から開いたときは、その組を開く）。確かめの道具は data-walker="dest-<名前>" で押す
 * - 出来事: 乗り降り・着いた・置き直した（新しい順）
 */
export function TravelPanel() {
  const ui = useSyncExternalStore(subscribeTravel, travelUi)
  // 開いた組（押して開いた物と、案内から開いた組 focus）
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const isOpen = (id: string) => expanded.has(id) || ui.focus === id
  // 札（行き先の一覧・ワープ）。クリックの案内から組を開いたときは行き先の一覧へ戻す
  const [tab, setTab] = useState<'travel' | 'warp'>('travel')
  const [seenFocus, setSeenFocus] = useState(ui.focus)
  if (ui.focus !== seenFocus) {
    setSeenFocus(ui.focus)
    if (ui.focus) setTab('travel')
  }
  if (!ui.open) {
    return (
      <section className="panel travel-panel closed" aria-label="行き先">
        <button type="button" className="button" data-walker="travel-open" onClick={() => openTravel(true)}>
          行き先 ・ {ui.townTime}
        </button>
        <RunStatus ui={ui} />
      </section>
    )
  }
  const toggle = (id: string) => {
    const now = isOpen(id)
    if (ui.focus === id) openTravel(true, null)
    setExpanded((s) => {
      const n = new Set(s)
      if (now) n.delete(id)
      else n.add(id)
      return n
    })
  }
  return (
    <section className="panel travel-panel" aria-label="行き先">
      <div className="panel-head">
        <h2 className="panel-title">行き先</h2>
        <span className="clock" data-walker="town-time" title="町の時刻">
          {ui.townTime}
        </span>
        <button type="button" className="button secondary small" onClick={() => openTravel(false)}>
          たたむ
        </button>
      </div>
      <RunStatus ui={ui} />
      <div className="tabs" role="tablist" aria-label="移り方">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'travel'} data-walker="tab-travel" onClick={() => setTab('travel')}>
          行き先の一覧
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'warp'} data-walker="tab-warp" onClick={() => setTab('warp')}>
          ワープ
        </button>
      </div>
      {tab === 'warp' ? <WarpList /> : <TravelList ui={ui} isOpen={isOpen} toggle={toggle} />}
      {ui.events.length > 0 && (
        <ol className="events" aria-label="出来事">
          {ui.events.slice(0, 6).map((e, i) => (
            <li key={`${ui.events.length - i}`}>
              {e.townTime} {e.label}
              {e.detail ? `（${e.detail}）` : ''}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** 行き先の一覧の札: 進め方・観覧車・行き先の組（町の地図データが無いときは、ラボの中とまわりの組だけ） */
function TravelList({ ui, isOpen, toggle }: { ui: TravelUi; isOpen: (id: string) => boolean; toggle: (id: string) => void }) {
  // 町の地図データの状態が変わったら描き直す（無い・読めないと分かったら、町の行き先の組を隠す）
  useSyncExternalStore(subscribeTownStatus, townStatus)
  const groups = DESTINATION_GROUPS.filter((g) => g.items.every(reachable))
  return (
    <>
      <Options o={ui.options} />
      {ui.wheel.here && <Wheel ui={ui} />}
      {groups.length < DESTINATION_GROUPS.length && <p className="hint">町の地図データが無いので、行き先はラボの中とまわりだけです</p>}
      <div className="dest-list">
        {groups.map((g) => {
          const open = isOpen(g.id)
          return (
            <div key={g.id} className={`dest-group${ui.focus === g.id ? ' focus' : ''}`}>
              <button type="button" className="dest-group-head" aria-expanded={open} onClick={() => toggle(g.id)}>
                {open ? '▾' : '▸'} {g.label}（{g.items.length}）
              </button>
              {open && (
                <ul>
                  {g.items.map((d) => (
                    <li key={d.id}>
                      <button type="button" className="dest" data-walker={`dest-${d.id}`} onClick={() => travelTo(d.id)}>
                        {d.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

/** 今の移動と結果、取り消す */
function RunStatus({ ui }: { ui: TravelUi }) {
  const run = ui.run
  const moving = ui.status === 'moving'
  return (
    <div className="run" data-walker="travel-status" aria-live="polite">
      {moving && run && (
        <>
          <p className="run-to">
            {run.kind === 'travel' ? '旅程' : '歩く'}: {run.label}
          </p>
          {run.kind === 'travel' && (
            <p className="hint">
              道順 {run.route}・約 {run.minutes} 分・{run.length}m
            </p>
          )}
          {ui.leg && (
            <p className="hint">
              区間 {ui.leg.index}/{ui.leg.count}: {ui.leg.label ?? '—'}
            </p>
          )}
        </>
      )}
      {ui.ride && (
        <p className="hint">
          {ui.ride.vehicle}: {ui.ride.phase}
        </p>
      )}
      {ui.added > 0 && (moving || ui.status === 'arrived') && <p className="hint">町の時刻を {Math.round(ui.added / 60)} 分進めた</p>}
      {ui.message && <p className={`status status-${ui.status}`}>{ui.message}</p>}
      {moving && (
        <button type="button" className="button secondary" data-walker="travel-cancel" onClick={() => stopTravel()}>
          取り消す
        </button>
      )}
    </div>
  )
}

/** 進め方（たたんでおく） */
function Options({ o }: { o: TravelOptions }) {
  return (
    <details className="options">
      <summary>
        進め方: {ROUTE_CHOICES.find((r) => r.id === o.route)?.id}・{VIA_CHOICES.find((v) => v.id === o.via)?.label}・{TIME_CHOICES.find((t) => t.id === o.time)?.label}
        {o.time === 'fast' ? ` ${o.fastSec}秒` : o.time === 'cut' ? (o.cut === 'none' ? '（一度に）' : '（区間ごと）') : ''}
      </summary>
      <label className="row">
        道順
        <select value={o.route} onChange={(e) => setTravelOptions({ route: e.target.value as TravelOptions['route'] })} data-walker="opt-route">
          {ROUTE_CHOICES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        乗り物
        <select value={o.via} disabled={o.route !== 'auto'} onChange={(e) => setTravelOptions({ via: e.target.value as TravelOptions['via'] })} data-walker="opt-via">
          {VIA_CHOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        時間
        <select value={o.time} onChange={(e) => setTravelOptions({ time: e.target.value as TravelOptions['time'] })} data-walker="opt-time">
          {TIME_CHOICES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {o.time === 'cut' && (
          <select value={o.cut} onChange={(e) => setTravelOptions({ cut: e.target.value as TravelOptions['cut'] })} data-walker="opt-cut">
            <option value="leg">区間ごとに少し見せる</option>
            <option value="none">一度に着く</option>
          </select>
        )}
        {o.time === 'fast' && (
          <>
            <input type="number" min={5} max={600} step={5} value={o.fastSec} onChange={(e) => setTravelOptions({ fastSec: Math.max(5, Number(e.target.value) || 30) })} data-walker="opt-fast" />
            秒
          </>
        )}
      </label>
      <label className="row">
        乗っている間
        <select value={o.rideTime} onChange={(e) => setTravelOptions({ rideTime: e.target.value as TravelOptions['rideTime'] })} data-walker="opt-ride">
          <option value="same">時間と同じ</option>
          {TIME_CHOICES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        便を待つ間
        <select value={o.waitTime} onChange={(e) => setTravelOptions({ waitTime: e.target.value as TravelOptions['waitTime'] })} data-walker="opt-wait">
          <option value="same">時間と同じ</option>
          {TIME_CHOICES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        乗り物の中で
        <select value={o.pose} onChange={(e) => setTravelOptions({ pose: e.target.value as TravelOptions['pose'] })} data-walker="opt-pose">
          <option value="sit">座る</option>
          <option value="stand">立つ</option>
        </select>
      </label>
    </details>
  )
}

/** 観覧車ソラノワ（乗り場のゾーンにいるとき） */
function Wheel({ ui }: { ui: TravelUi }) {
  const onWheel = ui.ride?.vehicle !== undefined
  return (
    <div className="wheel">
      <span>観覧車ソラノワ</span>
      {!onWheel && ui.wheel.pending !== 'board' && (
        <button type="button" className="button small" data-walker="wheel-board" onClick={() => boardWheel()}>
          乗る
        </button>
      )}
      {onWheel && (
        <button type="button" className="button small" data-walker="wheel-alight" onClick={() => alightWheel()}>
          降りる（{TIME_CHOICES.find((t) => t.id === ui.options.time)?.label}）
        </button>
      )}
    </div>
  )
}
