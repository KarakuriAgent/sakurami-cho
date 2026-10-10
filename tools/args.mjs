// tools の引数を読む（sync-town・sync-anim・check-walk が使う）。
// 根（--root）は、このファイルの置き場所（import.meta.url）からではなく、使う側の作業ディレクトリ（既定）か --root で決める。
// 書き出し先・読み元（--out・--src など）も使う側が渡す（パッケージの中に、使う側の置き場所を書かない）。相対のパスは根からにする。
// 知らない引数は誤りにして止める（書き出し先の取り違えを防ぐ）。pnpm の `pnpm <script> -- --all` の `--` は読み飛ばす。
import { isAbsolute, resolve } from 'node:path'
import { parseArgs } from 'node:util'

/**
 * 引数を読む。--root はどの道具も受ける。
 * - name: ログの頭（sync:town など）
 * - usage: 使い方（誤りのときに出す）
 * - options: 道具ごとの引数（node:util の parseArgs の形）
 * - required: 必ず渡す引数の名前
 * 返す物: root（根の絶対パス）・values（読んだ引数）・at(p)（根からの相対のパスを絶対パスに。絶対パスはそのまま）
 */
export function toolArgs(name, usage, options, required = []) {
  const fail = (msg) => {
    console.error(`[${name}] ${msg}`)
    console.error(`  使い方: ${usage}`)
    process.exit(1)
  }
  let values
  try {
    ;({ values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== '--'), options: { root: { type: 'string' }, ...options }, strict: true }))
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }
  for (const k of required) if (values[k] === undefined || values[k] === '') fail(`--${k} がありません`)
  const root = resolve(values.root ?? process.cwd())
  const at = (p) => (isAbsolute(p) ? p : resolve(root, p))
  return { root, values, at }
}
