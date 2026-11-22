// @ts-check

/**
 * dev 실행용 환경 변수에서 ELECTRON_RUN_AS_NODE 를 뺀 복사본을 돌려준다.
 * 이 변수가 켜져 있으면 Electron 이 일반 Node 로 떠서 창이 열리지 않는다.
 * Windows 는 환경 변수 이름의 대소문자를 구분하지 않으므로 대소문자 무시로 비교한다.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function cleanElectronEnv(env) {
  /** @type {NodeJS.ProcessEnv} */
  const cleaned = {}
  for (const [name, value] of Object.entries(env)) {
    if (name.toUpperCase() !== 'ELECTRON_RUN_AS_NODE') cleaned[name] = value
  }
  return cleaned
}
