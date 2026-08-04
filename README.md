# belpa-api-backend

The backend service for Belpa. It holds the server-side Google keys and does
three things:

- `POST /api/geocode` - turns an address into coordinates (Google Geocoding)
- `POST /api/solar` - fetches roof geometry for a location (Google Solar)
- `POST /api/lead` - validates a completed lead and delivers it to the
  configured roofer webhook

There is no product UI in this repository. The frontend (the embeddable quote
bubble and the full quote flow) lives in `belpa-widget-frontend` and calls this API
over HTTP. Every route answers CORS preflights; `BELPA_ALLOWED_ORIGINS` lists
**first-party** origins only (the widget app + localhost). Roofer websites do
not need to be listed — the flow runs inside our iframe. Per-roofer site locks
use `roofers.allowed_origins` with `?host=` from `widget.js` / `launch.js`.

## Run

Copy `.env.example` to `.env.local`, add the Google keys, then:

```bash
npm install
npm run dev   # serves on http://localhost:3001
```

Port 3001 is the default so `belpa-widget-frontend` (port 3000) can point at it
locally via `NEXT_PUBLIC_BELPA_API_URL=http://localhost:3001`.

## Verification script

`npm run verify:solar` exercises the geocode and solar pipeline against a set
of known properties and checks the measurement outputs. It calls the route
handlers directly, so it needs the `.env.local` keys.

## Where this code came from

Split out of `belpa-bubble-frontend-backend` (kept as a backup). The files
`lib/types.ts`, `lib/roof-geometry.ts` and `lib/roof-lines.ts` are copies of
the canonical versions in `belpa-widget-frontend`; they exist here only for the
verification script and the solar route's response typing. If the quote or
measurement logic changes, update `belpa-widget-frontend` first and mirror the change
here.
