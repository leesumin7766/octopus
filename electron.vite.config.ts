import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Google OAuth 클라이언트는 저장소가 아니라 빌드 때 환경 변수로 넣는다(없으면 빈 값 → 이 빌드에서는 Google 연결 불가).
  // 데스크톱 클라이언트의 secret 은 공개 값으로 취급한다.
  main: {
    define: {
      __OCTOPUS_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.OCTOPUS_GOOGLE_CLIENT_ID ?? ''),
      __OCTOPUS_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.OCTOPUS_GOOGLE_CLIENT_SECRET ?? ''),
      __OCTOPUS_DEV_TOOLS__: JSON.stringify(process.env.OCTOPUS_DEV_TOOLS === '1')
    }
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
