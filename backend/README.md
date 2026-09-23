# Voice of Vrindavan community backend

The Pages Function at `functions/api/community/[[path]].js` uses Cloudflare D1 directly. It does not require a sleeping CPU instance, a Lightning workspace, or a paid AI inference API. Availability still depends on the account's Cloudflare limits; no uptime or unlimited-free-service guarantee is implied.

## Required configuration

- `COMMUNITY_DB`: D1 database binding. Apply `backend/schema.sql` before serving traffic. Use separate production and preview databases.
- `AUTH_PEPPER`: cryptographically random secret, at least 32 characters. Keep it outside source control. Rotating it invalidates password and recovery verification, so plan a recovery migration before rotation.
- `ADMIN_TOKEN`: separate random secret of at least 32 characters for operator moderation. Never expose it in public client source.
- `DATASET_EXPORT_TOKEN`: independent random secret of at least 32 characters. This token works only on `GET /api/community/admin/dataset`.

All timestamps in the database are Unix milliseconds. Regular JSON message timestamps are ISO strings. D1 foreign keys and schema triggers are part of the integrity model; do not disable or remove them.

## Accounts and sessions

Usernames are case-insensitive, with 3–32 ASCII letters, numbers or underscores. Passwords are 12–128 characters. A salted PBKDF2-SHA256 derivation at 100,000 iterations is preceded by an HMAC with the private pepper. The iteration count fits Workers WebCrypto runtime constraints. A future authenticated identity provider or stronger password KDF migration can replace this small application's local authentication.

The server stores only hashes of high-entropy recovery codes and session tokens. Sessions last seven days and use a `__Host-` cookie with `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/`. Recovery rotates the recovery code and revokes existing sessions. Losing both the password and recovery code requires a separate operator identity-verification process; there is no insecure email-less recovery bypass.

Browser mutations must send a same-origin `Origin` header and `Content-Type: application/json`. The API permits no cross-origin browser access. Bodies are read with a 16 KB streaming cap. All database inputs are bound parameters. Authentication, matchmaking, polling, messages and data export have database-backed limits. Cloudflare supplies the client IP used for the hashed authentication limiter; raw IPs are not persisted.

## Browser API

All endpoints below are under `/api/community`. Error responses are `{error,code}` with an appropriate HTTP status. A 429 includes `Retry-After: 60`.

| Endpoint | Body / response |
| --- | --- |
| `GET health` | Database readiness, `accountsReady`, learning description and retention. |
| `GET me` | `{user:null}` or `{user}`. |
| `POST register` | `{username,password,displayName,interests,language,style,learningConsent,datasetConsent,trainingConsent,adult:true}` → `{user,recoveryCode}` and session. |
| `POST login` | `{username,password}` → `{user}` and session. |
| `POST logout` | `{}`; removes current session, cancels waiting and ends active room. |
| `POST recover` | `{username,recoveryCode,password}` → `{user,recoveryCode}` and new session. |
| `POST profile` | Any editable profile fields; `{resetLearning:true}` resets learned topic counts. Returns `{user}`. A profile change cancels an active waiting queue entry. |
| `POST connect` | `{}` → current waiting or matched state. |
| `GET state?after=123` | `{state,room?,messages?}`; `state` is idle, waiting, matched or ended. Poll about every 5 seconds while connected. |
| `POST message` | `{roomId,text}` → `{message}`. Maximum 2,000 characters, 30/minute and 400 per conversation. |
| `POST leave` | `{roomId}` ends room; `{}` cancels waiting and any match created before the browser received its room ID. |
| `POST block` | `{roomId}` ends room and prevents either party from matching again. |
| `POST report` | `{roomId,reason}` ends room and adds a moderation report. |
| `POST feedback` | `{roomId,rating:'good'|'poor'}`; can be changed. |
| `GET export?after=123` | Own account and retained conversations. Up to 1,000 messages per page, `nextCursor` is null on the last page. First-page related account information includes up to 1,000 each of blocks, reports and ratings. |
| `POST delete-account` | `{password}` deletes account, sessions, learning, blocks, reports and its conversations/messages through database cascades. |

Safe user objects contain `id`, `username`, `displayName`, `interests`, `language`, `style`, consent booleans, `learnedInterests` (an object of topic→count) and `consentVersion`.

Room objects are `{id,partner:{displayName},topics,prompt,status}`. Messages are `{id,speaker:'self'|'partner',text,createdAt}`. Message IDs are monotonically increasing integers. Ended room state includes room information and subsequent messages so the UI can finish the conversation and collect feedback.

Allowed topics: `truth`, `consciousness`, `free-will`, `ethics`, `spirituality`, `meaning`. Styles: `explore`, `debate`, `listen`. Language is a 2–32 character label; matches always require the same language, case-insensitively. Display names are 2–48 characters. Consent is optional, explicit and false by default; AI training additionally requires dataset consent.

## Matching and learning

Matching uses chosen topic overlap, preferred conversation style, optional learned topic counts, waiting time, and prior poor feedback between the pair. It never assigns a psychological identity or infers religion, politics, health, sexuality, or other sensitive traits. Optional learning looks only for six openly documented philosophical keyword groups in the user's own messages. It is a simple topic counter, not a language model or a claim to understand someone's personality. Profile controls expose and reset it. Turning learning off clears the learned counts.

The first 100 eligible waiting users are scored. For the first minute a shared chosen topic is required; after both people have waited over a minute, a match on broader philosophy can occur. Blocking in either direction is always honored. A pair is not repeated within ten minutes. Queue and room presence expires after 90 seconds without a poll; rooms also end after two hours. The UI should keep polling during an active conversation.

Atomic room creation uses a single guarded SQL INSERT plus an AFTER INSERT trigger. The trigger claims both members and removes their waiting rows in the same statement. A unique active-members key makes a conflicting assignment fail atomically. Eligibility is rechecked by the guarded INSERT. An ended-room trigger releases both members.

## Administrator API

Send `Authorization: Bearer <ADMIN_TOKEN>`.

- `GET admin/stats` returns `users`, `waiting`, `activeRooms`, `retainedRooms`, `openReports`, `suspendedUsers` and `retentionDays`.
- `GET admin/reports` returns the oldest 100 unresolved reports.
- `GET admin/reported-room?roomId=...` returns a transcript only for a reported room, enabling review before action.
- `POST admin/moderate` with `{reportId,action:'dismiss'|'ban'}` resolves a report. Ban additionally revokes the reported user's sessions, removes waiting entries, ends their conversations and invalidates dataset exports. This MVP does not have an automated toxicity classifier; an operator must review reports.
- `POST admin/maintenance` performs bounded retention and stale-state cleanup.
- `GET admin/dataset` exports consenting retained conversations as described below.

Admin tokens are not cookies. Keep operator UI tokens in page memory, never persistent browser storage. Use a separate export token in Google Apps Script instead of sharing moderation authority.

## Google Drive dataset contract

`GET /api/community/admin/dataset?training=0&after=<cursor>` accepts either the administrator token or the restricted dataset export token. It returns `application/x-ndjson`, with up to 25 ended conversations per page. `X-Next-Cursor` is empty on the final page. An exact full page can be followed by an empty page; continue until the header is empty. `X-Export-Count` reports records on that page.

Use `training=0` for research/match-quality permission. Use `training=1` for the stricter AI-training dataset. Each line has `conversation_id`, `topics`, `language`, `consent_version`, `allowed_use`, a privacy limitation and `messages:[{speaker:'A'|'B',text}]`. There are no account IDs or timestamps in this exported record, but the opaque conversation ID is retained to support synchronization and audit.

Eligibility requires BOTH users' consent when the conversation was created AND their current consent. Withdrawing dataset or training consent permanently invalidates earlier rooms, including when the user later opts in again. Reported rooms, blocked pairs, suspended members, deleted accounts and rooms older than 30 days are excluded. Only ended rooms containing messages are exported. Training consent cannot be inferred from general dataset permission.

Exports redact the two known account/display names, common emails, URLs, handles and phone-like numeric sequences. This is **pseudonymization**, not guaranteed anonymization: addresses, third-party names, intimate narratives and identifying context can remain. Restricted access and human review remain necessary. Exported conversations are unverified opinions, not ground-truth philosophical answers.

The Drive synchronizer MUST fetch all pages successfully before replacing the corresponding complete managed snapshot file. Replace; do not append. Maintain separate research and AI-training snapshot files with private access. If an export fails, leave the last known file intact and report failure. Run synchronization at least hourly to drop withdrawn/deleted records, and revalidate the latest eligible snapshot immediately before downstream use. Do not accumulate permanent dated backups of withdrawn data. Google Drive's own revision/trash retention is an additional provider-side deletion consideration; overwriting a file does not promise immediate removal of provider revisions or copies already downloaded. Consent revocation cannot undo a completed model-training run.

Each first dataset page runs bounded cleanup: up to 100 expired rooms, 100 stale waiting entries and 500 expired sessions/rate buckets per invocation. Explicit maintenance and Connect also perform it. The separate `backend/maintenance-worker.js` provides the same cleanup through a scheduled handler, importing the shared SQL from `backend/maintenance.js`. Deploy it with the same production `COMMUNITY_DB` binding and an hourly cron, with `workers_dev: false`, no routes, and no public fetch handler. No secrets or Drive authorization are needed. For a busy deployment, schedule additional maintenance so backlogs cannot grow. All chat/export reads enforce the 30-day window even before physical cleanup. Moderation reports are deleted with their associated expired room; review them promptly.

## Verification

Run `node --test backend/community.test.mjs` using Node 24 or another Node version with `node:sqlite` and WebCrypto. The harness adapts actual SQLite transactions and the production SQL to D1's interface; it exercises real handler requests and cookies. Tests cover accounts and recovery, room access control, concurrent pairing, unique-member atomicity, blocking, reports/moderation, consent snapshots/current consent, redaction, restricted token scope, learning, deletion cascades, rate/origin/body limits and retention.

These tests do not certify a Cloudflare deployment. After deploying, verify health, two independent real browser accounts, matching and bidirectional messaging, recovery, report handling, deletion, an authenticated empty/consented export, and a successful Drive synchronization. Free-tier request/database quotas and actual user load need ongoing observation.

## Friends and direct conversations

Apply `backend/friends.sql` to both preview and production D1 before deploying this version. It only adds tables/indexes; existing accounts and conversations are preserved. Fresh installations use the complete `backend/schema.sql`.

- `GET friends` lists accepted friends and incoming/outgoing requests (up to 200).
- `POST friends/request {roomId}` requires a retained conversation with that person. Requests are bounded to 20/day; declined or removed connections cannot be requested again for seven days.
- `POST friends/respond {id,action}` accepts a recipient's pending request, removes a connection, or blocks it (`accept`, `remove`, `block`).
- `GET friends/messages?id=...&after=...` retrieves new messages; `before` retrieves older pages. Only accepted, unblocked, nonsuspended members can access a thread.
- `POST friends/send {id,text}` stores a direct message without queueing or reserving random-match slots. Offline recipients receive it when they next open Friends. The shared message rate limit applies.
- `POST friends/report {id,roomId,reason}` feeds existing moderation without cancelling an unrelated matching queue.

Messages are retained in bounded room segments (up to 400 messages each) through the same 30-day cleanup, consent-gated backup and account-data export paths. Friendship records survive message expiry. Account deletion cascades friendship records. Blocking either direction denies further direct history/message access and revokes exports. No email, push notification or online-status promise is made. Friends polls only while its dialog is open and the page is visible; it checks the open conversation every four seconds and the list every fifteen seconds.
