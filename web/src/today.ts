// The office's date, the same as s.today() on the server, whatever
// timezone the phone is set to. en-CA formats dates as YYYY-MM-DD.
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
}

// OrderID in internal/server/upload.go, so the phone and server agree offline.
export function orderID(day: string, personID: string): string {
  return `${day}:${personID}`
}

// "Tue 27 Oct" for a YYYY-MM-DD day. Noon UTC is the same date everywhere.
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`))
}
