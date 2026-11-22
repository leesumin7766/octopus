// preload 가 노출하는 window.octopus 타입.
export {}

declare global {
  interface Window {
    octopus: {
      getAppVersion: () => Promise<string>
    }
  }
}
