import type { DateRange, Video } from '../../shared/ipc'
export interface Fingerprint {
  size: number
  mtimeMs: number
  dev: number
  ino: number
}
export interface ScannedVideo extends Video {
  id: string
  fingerprint: Fingerprint
}
export interface Scan {
  id: string
  source: string
  files: ScannedVideo[]
  dateRange: DateRange | null
}
export interface MoveItem {
  source: string
  destination: string
  fingerprint: Fingerprint
}
export interface MovePlan {
  target: string
  items: MoveItem[]
}

export type PublicVideo = Omit<ScannedVideo, 'fingerprint'>
export type PublicScan = Omit<Scan, 'files'> & { files: PublicVideo[] }
export interface ScanPage {
  id: string
  files: PublicVideo[]
  total: number
  offset: number
  nextOffset: number | null
}
