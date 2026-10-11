import { useState, useSyncExternalStore } from 'react'
import { TOWN_DATA } from 'sakurami-cho/core'
import { subscribeTownStatus, townState, townStatus } from '../town'

/**
 * 町の地図データの案内（上の真ん中。持ち主の決め: 出すのは、地図データが無い（missing）・形の版が合わない（outdated）・読めない（error）ときだけ。
 * 待機・歩きの .vrma は地図のパッケージの git に入っているので、無いときの案内は作らない。VRM の案内は左上のつまみ ui/VrmPanel.tsx）。
 * 画面を止めない（押しても下へは通さないが、閉じられる。町が無くても、ラボとそのまわりは歩ける）。状態は地図の onStatus（src/town.ts）
 */
export function TownNotice() {
  const status = useSyncExternalStore(subscribeTownStatus, townStatus)
  // 閉じた状態（同じ状態のあいだは出さない）
  const [closed, setClosed] = useState<string | null>(null)
  if ((status !== 'missing' && status !== 'outdated' && status !== 'error') || closed === status) return null
  const title = status === 'missing' ? '町の地図データがありません' : status === 'outdated' ? '町の地図データの形の版が合いません' : '町の地図データを読めませんでした'
  const where = `${import.meta.env.BASE_URL}${TOWN_DATA.dir}/`
  return (
    <section className="town-notice" role="alert" data-walker="town-notice" data-status={status}>
      <div className="panel-head">
        <h2 className="town-notice-title">{title}</h2>
        <button type="button" className="button secondary small" data-walker="town-notice-close" onClick={() => setClosed(status)}>
          閉じる
        </button>
      </div>
      {status === 'missing' && (
        <p>
          <code>{where}manifest.json</code> を読めませんでした。町の地図データ <code>assets/{TOWN_DATA.dir}/</code> は git に入っているので、clone が途中で止まっていないか・消していないかを確かめてください（<code>git status</code>）。
        </p>
      )}
      {status === 'outdated' && (
        <p>
          地図データの形の版は {townState.message || '?'}、地図のパッケージが読む版は {TOWN_DATA.format} です。道具で書き出し直した地図データとコードの版がずれています。git に入っている地図データに戻すか（<code>git checkout -- assets/{TOWN_DATA.dir}</code>）、今のコードの道具で書き出し直してください。
        </p>
      )}
      {status === 'error' && (
        <p>
          <code>{where}</code> の地図データを読む途中で失敗しました{townState.message ? `（${townState.message}）` : ''}。ページを読み込み直してください。続くときは、地図データが git の物から変わっていないかを確かめてください（<code>git status</code>）。
        </p>
      )}
      <p className="hint">
        町の地図データは git に入っているので、ふつうは書き出し直しません（書き出す道具 <code>tools/sync-town.mjs</code> は docs/tools.md）。直したら、ページを読み込み直してください。
        町が無いあいだも、ラボの中とまわりは歩けます（行き先とワープはラボだけ）
      </p>
    </section>
  )
}
