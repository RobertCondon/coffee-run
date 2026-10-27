// A short tick on Android. iPhones have no vibrate API, and silent mode turns
// it off, so it's only ever extra: every swipe also shows what happened.
export function tick() {
  try {
    navigator.vibrate?.(10)
  } catch {
    // Some browsers throw instead of ignoring it.
  }
}
