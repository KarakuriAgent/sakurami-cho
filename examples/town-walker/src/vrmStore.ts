/**
 * 選んだ VRM をこのブラウザの中（IndexedDB）にしまう所。入口のページ（src/landing.ts）と、アプリ（src/vrm.ts）の両方が読む
 * （入口を軽くするため、three・React・地図のパッケージは読まない。ほかのモジュールも読まない）。
 *
 * - しまうのはファイル（Blob）と名前・大きさ（キー current）と、身長を合わせるか・設定の身長（キー settings。設定を変えるときはこれだけ書く）。
 *   VRM は 1 つだけ（入れ替えたら上書き）。どこへも送らない
 * - しまっておくのは、入口の「忘れる」か、アプリの「外す」を押すまで
 * - IndexedDB が使えない（プライベートのウィンドウ・サイトのデータを止めたなど）ときは、開くのが失敗する。使う側は、しまわずに今の形で動く
 * - ファイルの確かめ（checkVrmFile）は、名前が .vrm か・頭が glTF の印かだけ。VRM として読めるかはアプリが読んで確かめる
 * - サムネイル（readThumbnail）は、VRM 1.0（VRMC_vrm.meta.thumbnailImage）・0.x（VRM.meta.texture）の画を、ファイルの中から切り出すだけ
 */

/** しまった VRM */
export interface StoredVrm {
  /** ファイルの中身 */
  file: Blob
  /** ファイルの名前 */
  name: string
  /** 大きさ（バイト） */
  size: number
  /** 身長を設定に合わせるか */
  normalize: boolean
  /** 設定の身長（m） */
  height: number
  /** しまった時刻（Date.now()） */
  savedAt: number
}

const DB_NAME = 'town-walker'
const DB_VERSION = 1
const STORE = 'vrm'
/**
 * キー: ファイル（Blob・名前・大きさ・しまった時刻）と、設定（身長を合わせるか・設定の身長）を分ける。設定を変えるたびに大きなファイルの
 * レコードを書き直さないため（すぐページを離れても、小さな設定のレコードは書き終える）。前の形（ファイルのレコードに設定もある物）も読める
 */
const FILE_KEY = 'current'
const SETTINGS_KEY = 'settings'

type FileRecord = Pick<StoredVrm, 'file' | 'name' | 'size' | 'savedAt'>
type SettingsRecord = Pick<StoredVrm, 'normalize' | 'height'>

let opening: Promise<IDBDatabase> | null = null

/** データベースを開く（1 ページに 1 回。失敗したら次に呼んだときに開き直す） */
function openDb(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB がありません')
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB を開けません'))
    req.onblocked = () => reject(new Error('IndexedDB を開けません（ほかのタブが古い形で開いています）'))
  }).catch((e: unknown) => {
    opening = null
    throw e
  })
  return opening
}

/** 1 つのトランザクション（fn が読み書きを出し、終わったときの結果を返す関数を返す。書くときは確かに書けたあとに済む） */
async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => () => T): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const result = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(result())
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB の読み書きに失敗しました'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB の読み書きを取り消しました'))
  })
}

/** IndexedDB が使えるか（開いてみる） */
export async function storeAvailable(): Promise<boolean> {
  try {
    await openDb()
    return true
  } catch {
    return false
  }
}

/** しまった VRM（無ければ null。形が合わない物は無いとみる）。ファイルと設定を 1 つの読むだけのトランザクションで読んで合わせる */
export async function loadStoredVrm(): Promise<StoredVrm | null> {
  const [f, c] = await run('readonly', (s) => {
    const file = s.get(FILE_KEY)
    const settings = s.get(SETTINGS_KEY)
    return () => [file.result as Partial<StoredVrm> | undefined, settings.result as Partial<SettingsRecord> | undefined] as const
  })
  if (!f || !(f.file instanceof Blob) || typeof f.name !== 'string') return null
  // 設定のレコードが無ければ、前の形（ファイルのレコードの中の設定）
  const normalize = c?.normalize ?? f.normalize
  const height = c?.height ?? f.height
  return {
    file: f.file,
    name: f.name,
    size: typeof f.size === 'number' ? f.size : f.file.size,
    normalize: normalize !== false,
    height: typeof height === 'number' && height > 0.3 && height < 3 ? height : 1.65,
    savedAt: typeof f.savedAt === 'number' ? f.savedAt : 0,
  }
}

/** VRM をしまう（前の物は上書き。ファイルと設定を 1 つのトランザクションで書く） */
export async function saveStoredVrm(v: StoredVrm): Promise<void> {
  const file: FileRecord = { file: v.file, name: v.name, size: v.size, savedAt: v.savedAt }
  const settings: SettingsRecord = { normalize: v.normalize, height: v.height }
  await run('readwrite', (s) => {
    s.put(file, FILE_KEY)
    s.put(settings, SETTINGS_KEY)
    return () => undefined
  })
}

/** しまった VRM の設定（身長を合わせるか・設定の身長）だけを書く（小さな設定のレコードだけ。しまった物が無ければ書かない） */
export async function updateStoredSettings(normalize: boolean, height: number): Promise<void> {
  const settings: SettingsRecord = { normalize, height }
  await run('readwrite', (s) => {
    // ファイルの中身は読まず、あるかだけを数える
    const count = s.count(FILE_KEY)
    count.onsuccess = () => {
      if (count.result > 0) s.put(settings, SETTINGS_KEY)
    }
    return () => undefined
  })
}

/** しまった VRM を消す（ファイルと設定の両方） */
export async function clearStoredVrm(): Promise<void> {
  await run('readwrite', (s) => {
    s.delete(FILE_KEY)
    s.delete(SETTINGS_KEY)
    return () => undefined
  })
}

/* -------------------------------------------------------------------------- */
/* ファイルの確かめとサムネイル（GLB の形を読むだけ）                                */
/* -------------------------------------------------------------------------- */

/** GLB の頭の印（'glTF' の 4 バイトを little endian で読んだ数）と、JSON・BIN の塊の種類 */
const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

async function bytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer())
}

/** 選んだファイルを確かめる（名前が .vrm か・頭が glTF の印か）。よければ null、違えば断る理由 */
export async function checkVrmFile(file: Blob & { name: string }): Promise<string | null> {
  if (!/\.vrm$/i.test(file.name)) return `「${file.name}」は VRM（.vrm）のファイルではありません`
  if (file.size < 12) return `「${file.name}」は VRM のファイルとして短すぎます（壊れているかもしれません）`
  const head = await bytes(file, 0, 4)
  if (head.getUint32(0, true) !== GLB_MAGIC) return `「${file.name}」は VRM（glTF のバイナリ）の形ではありません（壊れているかもしれません）`
  return null
}

/** glTF の JSON のうち、サムネイルを探すのに使う所 */
interface GltfJson {
  extensions?: {
    VRMC_vrm?: { meta?: { thumbnailImage?: number } }
    VRM?: { meta?: { texture?: number } }
  }
  textures?: { source?: number }[]
  images?: { bufferView?: number; mimeType?: string }[]
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number }[]
}

/** 出せる画の形 */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/**
 * VRM のファイルの中のサムネイルの画を切り出す（VRM 1.0 は VRMC_vrm.meta.thumbnailImage、0.x は VRM.meta.texture。無い・読めなければ null）。
 * 読むのは頭・JSON の塊・画の所だけ（ファイル全体は読まない）
 */
export async function readThumbnail(file: Blob): Promise<Blob | null> {
  try {
    if (file.size < 20) return null
    const head = await bytes(file, 0, 20)
    if (head.getUint32(0, true) !== GLB_MAGIC) return null
    const jsonLength = head.getUint32(12, true)
    if (head.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength > file.size) return null
    const json = JSON.parse(await file.slice(20, 20 + jsonLength).text()) as GltfJson
    let image: number | undefined
    const v1 = json.extensions?.VRMC_vrm?.meta?.thumbnailImage
    const v0 = json.extensions?.VRM?.meta?.texture
    if (typeof v1 === 'number') image = v1
    else if (typeof v0 === 'number' && v0 >= 0) image = json.textures?.[v0]?.source
    if (typeof image !== 'number') return null
    const img = json.images?.[image]
    if (!img || typeof img.bufferView !== 'number' || !img.mimeType || !IMAGE_TYPES.has(img.mimeType)) return null
    const view = json.bufferViews?.[img.bufferView]
    if (!view || (view.buffer ?? 0) !== 0 || typeof view.byteLength !== 'number') return null
    // BIN の塊は JSON の塊のすぐあと（JSON の塊は 4 バイトにそろえてある）
    const binHeadAt = 20 + jsonLength
    if (binHeadAt + 8 > file.size) return null
    const binHead = await bytes(file, binHeadAt, binHeadAt + 8)
    if (binHead.getUint32(4, true) !== CHUNK_BIN) return null
    const binLength = binHead.getUint32(0, true)
    const offset = view.byteOffset ?? 0
    if (offset + view.byteLength > binLength) return null
    const start = binHeadAt + 8 + offset
    return file.slice(start, start + view.byteLength, img.mimeType)
  } catch {
    return null
  }
}

/** ファイルの大きさの字（MB か KB） */
export function formatSize(size: number): string {
  return size >= 1e6 ? `${(size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1e3))} KB`
}
