# Voice of Vrindavan

A minimal black-and-gold philosophy chat website on Cloudflare Pages. Accounts, interest matching, moderation, saved messages and consent-based dataset exports use D1. The original logo is rendered as an animated 3D mesh.

## Live chat

- `backend/live-worker.js` exports SQLite-backed `ChatRoom` and `ChatLobby` Durable Objects. Rooms are isolated by room ID; waiting lobbies are separated by language. Only private Cloudflare bindings can call the objects; the Worker has no public route.
- Pages binds `CHAT_ROOMS` and `CHAT_LOBBIES` to the corresponding namespaces. Production and preview must use separate namespaces and databases.
- The same-origin `/api/community/live` upgrade authenticates the existing secure session cookie and verifies room membership. Sessions are rechecked before pushing private content.
- WebSockets push saved messages immediately. Sends use the existing authenticated HTTP API, so acknowledgement follows durable storage. Message metadata updates are batched in D1. The hourly consent-aware dataset exporter still reads these saved records.
- Presence pings are answered automatically by the hibernating runtime, without waking JavaScript or updating D1. A one-time bounded room/queue lease replaces frequent D1 heartbeat updates. Alarms check inactive connections and enforce room expiry.
- A connection can reconnect within a 90-second grace window (cleanup runs every minute). Waiting and active rooms have a two-hour maximum. Each person can keep two room tabs connected.
- Browsers reconcile saved state once a minute and on reconnect, instead of polling every four seconds. This recovers messages if a push fails. Old polling remains a fallback only when live bindings are absent.
- Lobbies accept at most 1,000 sockets per language. Each alarm handles at most 100 waiting users in a rotating pass; new arrivals attempt matching immediately. These are safety bounds, not load-tested capacity promises.

## Deployment

Deploy `backend/wrangler.jsonc` for the isolated preview worker. For production use a distinct Worker name and production D1 ID. Preserve the `v1` migration tag and its SQLite classes. Add the resulting namespace IDs to the matching Pages environment, deploy the Pages branch, and verify `health.realtime` is true. Keep workers.dev and preview URLs disabled for the live Worker.

Existing Pages secrets: `AUTH_PEPPER`, `ADMIN_TOKEN`, `DATASET_EXPORT_TOKEN`. Never put their values in source, URLs, or browser storage. Existing model-service settings support legacy pages and are separate from person-to-person chat.

## Verification

Run `node --test backend/community.test.mjs` for API, concurrency, moderation, consent, expiry, and saved-message recovery checks.

For local Workers integration tests, install `miniflare@4` and `esbuild` into a development tools directory. Bundle `backend/live-test-entry.js` as ESM with `cloudflare:workers` external. Set `VOV_TOOLS` to the tools directory and `VOV_TEST_BUNDLE` to the bundle path, then run `node backend/live.runtime-test.cjs`. That harness uses only temporary local data. Its compatibility date reflects the stable local runtime; deployed workers use the date in the deployment config.

The development load exercise used 100 connected clients, 50 rooms, and 1,000 saved messages. This is a local test, not a production capacity or monthly-cost guarantee. Track request, CPU, Durable Object duration/storage, D1 usage and retention backlog on the paid account before expanding traffic.

Run the local load exercise with the same tool/bundle environment variables using node backend/live.load-test.cjs. It holds 100 simulated connections and sends 1,000 messages; it never targets a cloud account.


## Primary domain

The public website is https://voiceofvrindavan.com/. Both .in hostnames and www.voiceofvrindavan.com redirect to the corresponding path on the .com apex, preserving query strings. All hostnames use the same Pages project, D1 database and live-room namespaces. Users sign in again on .com with their existing credentials because session cookies are host-specific. The old authenticated dataset endpoint remains compatible with the existing private Google Apps Script while new script installations use .com. The legacy APK download subdomain is independent.

Registration asks only for a name, password and acceptance of the adult terms. Users choose exactly one philosopher or spiritual teacher and English or Hindi inside the room before finding a match. Optional learning, dataset and training permissions remain off unless enabled in Settings.

The room and Settings include a searchable catalogue of 75 philosophers and spiritual teachers plus Others. Exactly one choice is saved. Matching requires the same choice and language, with no cross-teacher fallback. Legacy multi-topic profiles must choose again before queueing. Account registration is unchanged.
