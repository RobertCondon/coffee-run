// These mirror the Go structs in internal/server, field for field.

export type Person = { id: string; name: string }

export type SyncPerson = Person & { version: number }

export type SyncMenuItem = {
  id: string
  name: string
  version: number
  deleted_at: string | null
}

export type SyncOrder = {
  id: string
  day: string
  person_id: string
  menu_item_id: string
  size: string
  milk: string | null
  extras: string // JSON text, e.g. '["extra shot"]'
  note: string | null
  status: string
  updated_at: string
  version: number
  deleted_at: string | null
}

export type SyncResponse = {
  cursor: number
  people: SyncPerson[]
  menu_items: SyncMenuItem[]
  orders: SyncOrder[]
}

export type OrderInput = {
  day: string
  menu_item_id: string
  size: string
  milk: string | null
  extras: string[]
  note: string | null
}

export type Op =
  | { id: string; type: 'put_order'; order: OrderInput }
  | { id: string; type: 'delete_order'; order: { day: string; person_id?: string; version?: number } }

export type OpResult = { id: string; ok: boolean; error?: string }

export type UploadResponse = { results: OpResult[] }
