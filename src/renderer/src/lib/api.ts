import type { PtmApi } from '../../../shared/ipc.ts'

declare global {
  interface Window {
    ptm: PtmApi
  }
}

export const api: PtmApi = window.ptm
