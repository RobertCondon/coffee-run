// Which build this page is. vite.config.ts fills it in and writes the same id
// to /version.json, so the page can tell when the server has a newer one.
declare const __BUILD_ID__: string

let checking: Promise<boolean> = Promise.resolve(true)
let checkedAt = 0

// True if the server still serves this build. If it has a newer one, reload
// into it and answer false, so old code never syncs against a new server.
// One reload per build: if something keeps serving the old page anyway, carry
// on rather than reload forever. Asked again within 10 seconds, the last
// answer stands.
export function isCurrent(): Promise<boolean> {
  if (import.meta.env.DEV) return Promise.resolve(true) // Vite reloads the page itself
  if (Date.now() - checkedAt < 10_000) return checking
  checkedAt = Date.now()
  checking = fetch('/version.json', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() as Promise<{ build?: string }> : null))
    .then((latest) => {
      if (!latest?.build || latest.build === __BUILD_ID__) return true
      const key = `reloaded-for:${latest.build}`
      if (sessionStorage.getItem(key)) return true
      sessionStorage.setItem(key, '1')
      location.reload()
      return false
    })
    .catch(() => true) // offline: carry on, the next check will catch it
  return checking
}
