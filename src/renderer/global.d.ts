// preload 가 노출하는 window.octopus 타입.
import type { OctopusApi } from '../shared/api'

export {}

declare global {
  interface Window {
    octopus: OctopusApi
  }
}
