// 개발용 도구 묶음(화면 캡처). index.ts 는 이 파일을 동적 import 로만 부르고, 그 import 는 OCTOPUS_DEV_TOOLS=1 로 빌드할 때만 남는다.
// 여기에 있는 것을 index.ts 가 정적으로 import 하면 배포 빌드에도 들어가므로 정적 import 하지 말 것.
export { cleanupCapture, captureWhenLoaded, prepareCapture } from './capture'
export type { CaptureSession } from './capture'
export { CAPTURE_ARM_VIEWS, createBrokenExampleArm, createCaptureCalendar, createCaptureMcpConnector, createExampleArm, createMemorySecureStore } from './captureArms'
export { createCaptureAdapter, createCaptureKeyStore, createCaptureStreamingAdapter, seedCaptureCommand } from './captureLlm'
export { createSampleData, seedCaptureSettings } from './captureSupport'
