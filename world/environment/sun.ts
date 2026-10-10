import * as THREE from 'three'
import { SITE } from '../../core/town'

/**
 * 太陽の位置（高度・方位）。NOAA の簡易式（General Solar Position Calculations）を自前で計算する（依存は増やさない）。
 * 精度は 1 度弱（光と空の色を決めるには十分）。地平線の近くは大気の屈折の分だけ持ち上げる（日の出・日の入りの時刻が合うように）。
 */

const DEG = Math.PI / 180

export interface SunPosition {
  /** 高度（度。地平線が 0、真上が 90。屈折込みの見かけの高度） */
  altitude: number
  /** 方位（度。北から時計回り。東 = 90、南 = 180、西 = 270） */
  azimuth: number
  /** 赤緯（度） */
  declination: number
}

/** UTC のミリ秒から、太陽の高度・方位 */
export function sunPosition(utcMs: number, latitude = SITE.latitude, longitude = SITE.longitude, out?: SunPosition): SunPosition {
  const d = new Date(utcMs)
  const year = d.getUTCFullYear()
  const start = Date.UTC(year, 0, 1)
  const daysInYear = (Date.UTC(year + 1, 0, 1) - start) / 86400_000
  const dayOfYear = Math.floor((utcMs - start) / 86400_000) + 1
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + (d.getUTCSeconds() + d.getUTCMilliseconds() / 1000) / 3600

  // 年の中の位置（ラジアン）
  const g = ((2 * Math.PI) / daysInYear) * (dayOfYear - 1 + (hour - 12) / 24)
  // 均時差（分）と赤緯（ラジアン）
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)

  // 真太陽時（分）→ 時角（度）
  const trueSolarMinutes = hour * 60 + eqTime + 4 * longitude
  const hourAngle = (trueSolarMinutes / 4 - 180) * DEG

  const lat = latitude * DEG
  const cosZenith = THREE.MathUtils.clamp(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle), -1, 1)
  const elevation = 90 - Math.acos(cosZenith) / DEG
  // 方位（南から西回りの角を、北から時計回りに直す）
  const azimuth = (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / DEG + 180 + 360) % 360

  const p = out ?? ({} as SunPosition)
  p.altitude = elevation + refraction(elevation)
  p.azimuth = azimuth
  p.declination = decl / DEG
  return p
}

/** 大気の屈折による持ち上げ（度）。NOAA の近似 */
function refraction(elevation: number): number {
  if (elevation > 85) return 0
  const te = Math.tan(elevation * DEG)
  let arcsec: number
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
  else if (elevation > -0.575) arcsec = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
  else arcsec = -20.772 / te
  return arcsec / 3600
}

/**
 * 高度・方位から、シーンの中の「太陽の方向」（単位ベクトル。ラボから太陽へ向かう向き）。
 * 北 = -z、東 = +x（SITE.northOffsetDeg で回す）
 */
export function directionFromAltAz(altitude: number, azimuth: number, out = new THREE.Vector3()): THREE.Vector3 {
  const alt = altitude * DEG
  const az = (azimuth - SITE.northOffsetDeg) * DEG
  return out.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt))
}
