import { ko } from './i18n/ko'

export function App() {
  return (
    <main className="flex h-screen items-center justify-center">
      <h1 className="text-3xl font-semibold">{ko.appTitle}</h1>
    </main>
  )
}
