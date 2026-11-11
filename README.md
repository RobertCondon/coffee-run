# Coffee Run

The app my team uses to sort out the daily coffee run. Everyone puts their order in on their phone, and whoever is walking to the café gets one docket with the lot tallied up, plus the loyalty card QR to scan at the till.

I'm a Rails dev and had never written Go, so this was my excuse to learn it.

## What's a bit different about it

It works offline. Each phone has its own SQLite database (sqlite-wasm in a worker), and the server has one too. Your order saves on your phone straight away and syncs when it can, so it doesn't matter if you're in the lift.

I wrote the sync myself instead of pulling in a library, mostly to understand how it works:

- Every write on the server bumps one version counter. Phones remember the last version they saw and ask for anything newer.
- Changes made on a phone go into an outbox and get sent up in a batch. A rejected change comes back with a reason for the person, not an HTTP error, so the phone never retries something that will never work.
- Deletes are tombstones, and the server pings open phones over SSE when something changes.

The rest is deliberately small. The server is the Go standard library plus a SQLite driver, with no framework and no ORM. The frontend is a React PWA made to look like a café docket.

## Running it

```sh
go run ./cmd/server        # API on :8080
cd web && npm install && npm run dev
```

The loyalty card needs a few settings. Copy `.env.example` to `.env.local` and fill it in. Everything else works without it.

## Layout

- `cmd/server` starts everything
- `internal/server` is the HTTP handlers and sync
- `internal/auth0` keeps the loyalty card's token refreshed
- `db` is the migrations and the SQL both ends share
- `web` is the phone app

Pushing to master deploys it to a small server at my house through a self-hosted GitHub runner.
