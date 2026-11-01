# RoundSEO Intelligence API

Every collection is scoped to one website and runs on RoundSEO's own collectors,
stored observations, and analysis. No third-party search-data provider is
used. A metric that no configured source can supply is returned as `null` and
listed in the run's `unavailable` array; it is never estimated silently.

The contract is also published as [OpenAPI 3.1](openapi/intelligence.yaml).

## Authentication and roles

- Every endpoint except the signed asset URL requires `Authorization: Bearer <token>`.
- Reading requires access to the website. Starting a run, refreshing a crawl, or
  cancelling one requires an organization owner, admin, or manager.
- Writes require an `Idempotency-Key` header of 8 to 128 URL-safe characters.
  Replaying the same key with the same body returns the stored run (`200`). The
  same key with a different body returns `409`.

## Availability

`GET /api/v2/intelligence/status` reports availability per action. Partial
availability is explained in `reason`, for example keyword discovery still
returns related searches and questions when the keyword-metrics source is absent.

| Action | Available when | Source |
| --- | --- | --- |
| `keyword_discovery` | Always (SERP terms); ideas and metrics with the keyword-metrics source | Google results page; Google Ads Keyword Plan |
| `keyword_overview`, `keyword_metrics` (google), `keyword_trends` | Keyword-metrics source configured | Google Ads Keyword Plan |
| `keyword_metrics` (bing) | Never on this deployment | Refused with `503` until a Microsoft Advertising source exists |
| `domain_rankings`, `domain_competitors`, `market_categories` | Always; empty until SERP observations exist | RoundSEO SERP observations |
| `app_competitors`, `app_rankings` | Always | Apple iTunes Search API; Google Play store pages |
| `serp_snapshot` | Always; blocked pages are reported | Search results pages |
| `answer_response`, `answer_snapshot` | At least one answer-engine API key | Anthropic, OpenAI, Gemini, Perplexity |
| `answer_demand` | Never | No public source for AI query volume exists |
| `page_inspection`, `content_extraction` | Always | Native fetch |
| `content_extraction` with `renderJavascript`, `page_inspection` with `renderJavascript` | Browser runner configured | Browser runner; HTML is saved otherwise, and the run says so |
| `page_screenshot` | Browser runner and screenshot storage configured | Browser runner; R2 |
| `site_crawl` | Always; capped by `maximumPages` | Native fetch with robots rules |

An unavailable action returns `503 INTELLIGENCE_SOURCE_UNAVAILABLE` with the
reason, and no run is created.

## Runs

`POST /api/v2/websites/{websiteId}/intelligence/runs` takes one action object.

- Single-shot actions run inline and return `201` with the completed run.
- `site_crawl` returns `202` with a `queued` run. Poll
  `GET /api/v2/websites/{websiteId}/intelligence/runs/{runId}` while it is
  `queued` or `running`. `progress` reports `completed` and `total`.
- `POST .../runs/{runId}/refresh` starts a new crawl linked to a finished one
  through `parentRunId`. A running crawl returns `409`.
- `POST .../runs/{runId}/cancel` stops a queued or running crawl. Pages already
  saved remain. The run finishes as `cancelled`.

Run statuses: `queued`, `running`, `complete`, `partial`, `failed`, `cancelled`.
`partial` means some data was saved and gaps are listed in `unavailable`.
`failed` runs carry `error.code` and `error.message`.

Each run includes `source` (origin, label, method version, observation time, and
limitations), `coverage` for SERP runs (`complete`, `partial`, `blocked`, or
`unparsed`, with the features seen), and `summary`.

## Actions

Market fields are `countryCode` (two letters, such as `US`) and `languageCode`
(such as `en`). Domains must be the website's own domain.

- `keyword_discovery`: `seeds` (1–20), `limit` (1–1000, default 100)
- `keyword_overview`: `keywords` (1–50)
- `keyword_metrics`: `source` (`google`), `keywords` (1–50)
- `keyword_trends`: `keywords` (1–20). Returns the last twelve months per keyword.
- `domain_rankings`: `domain`, `limit`. Built from stored SERP observations.
- `domain_competitors`: `domain`, `limit`. Shared keywords are counted per snapshot.
- `market_categories`: `domain`, `limit`. Keyword-lexicon categories with shares.
- `app_competitors`: `marketplace` (`google_play` or `apple_app_store`), `appId`, `limit`
- `app_rankings`: `marketplace`, `appId`, `keywords` (1–20), `limit`
- `serp_snapshot`: `surface` (`google`, `google_maps`, `google_ai`, `bing`,
  `youtube`), `query` (≤200), `device`, `resultLimit` (1–100), optional `targetDomain`
- `answer_response`: `engine` (`chatgpt`, `gemini`, `claude`, `perplexity`),
  `prompt` (≤2000), `model`, optional `targetDomain`, `useWeb`, `systemInstruction`
- `answer_snapshot`: `engine`, `prompt`, optional `targetDomain`. Web-grounded.
- `page_inspection`: `url`, `browserProfile`, `renderJavascript`
- `content_extraction`: `url`, `renderJavascript`. Returns markdown.
- `page_screenshot`: `url`, `browserProfile`, `fullPage`
- `site_crawl`: `domain`, `maximumPages` (1 to the deployment cap), optional
  `startUrl`, `extractContent`. Returns `202`.

Page URLs must be public HTTP or HTTPS addresses. Private, loopback, and
credentialed addresses are refused, and every redirect hop is checked.

## Evidence

`GET /api/v2/websites/{websiteId}/intelligence/evidence?capability=&kind=&limit=&offset=`
pages through evidence (`limit` 1–1000). Each record carries its `source`, so
every value can be traced to its origin and observation time.

Search volume, CPC, and competition are source-reported monthly averages for the
selected market. Estimated traffic is a modeled click share (position-based)
applied to that volume, labeled as `derived_estimate`. Sentiment is a keyword
heuristic and is labeled `lexicon_heuristic`.

## Screenshots

Screenshot bytes are stored in R2 and never exposed directly. A run's page
evidence carries a signed URL that expires after five minutes:
`/api/v2/websites/{websiteId}/intelligence/assets/{assetId}?expires=…&sig=…`.
Tampered, expired, or unknown signatures return `404`.

## Errors

| Code | Status | Meaning |
| --- | --- | --- |
| `INVALID_INTELLIGENCE_REQUEST` | 400 | Request body is invalid or out of scope |
| `INVALID_INTELLIGENCE_QUERY` | 400 | Query bound is invalid |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | `Idempotency-Key` missing |
| `INVALID_IDEMPOTENCY_KEY` | 400 | Key format is invalid |
| `PUBLIC_URL_REQUIRED` | 400 | URL is private, credentialed, or not HTTP(S) |
| `UNSUPPORTED_MARKET` | 400 | No keyword-metrics market for this country or language |
| `INVALID_MODEL` / `INVALID_PROMPT` | 400 | Answer request is invalid |
| `INVALID_APP_ID` | 400 | App ID does not match the marketplace format |
| `INTELLIGENCE_ROLE_REQUIRED` | 403 | Caller cannot start collection |
| `APP_NOT_FOUND` | 404 | App is not listed in that market |
| `IDEMPOTENCY_CONFLICT` | 409 | Key reused with a different body |
| `INTELLIGENCE_RUN_ACTIVE` / `INTELLIGENCE_RUN_INACTIVE` | 409 | Run is in the wrong state for the action |
| `INTELLIGENCE_SOURCE_UNAVAILABLE` | 503 | Source is not configured on this deployment |
| `INTELLIGENCE_DAILY_LIMIT` | 429 | Website reached the daily live-request ceiling |
| `ANSWER_ENGINE_RATE_LIMITED` | 429 | Answer engine is rate-limiting |
| `ANSWER_ENGINE_REJECTED` / `ANSWER_ENGINE_UNAVAILABLE` | 502 | Answer engine refused or failed |
| `SEARCH_METRICS_AUTH_FAILED` / `SEARCH_METRICS_UNAVAILABLE` | 502 | Keyword-metrics source failed |
| `INTELLIGENCE_RUNNER_FAILED` | 502 | Browser runner failed |
| `INTELLIGENCE_UNREACHABLE` / `INTELLIGENCE_TIMEOUT` | 502 / 504 | Public source did not respond |

Run-level error codes include `SERP_BLOCKED`, `SERP_UNPARSED`,
`APP_STORE_UNAVAILABLE`, and `SITE_CRAWL_FAILED`.

## Deployment configuration

Set these as secrets with `wrangler secret put <NAME>` for deployed Workers, or in
`.env` for local development. Leave a value empty to keep its actions unavailable.

- Keyword metrics: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`,
  `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (optional), `GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`. Calls use API version
  `v20`; confirm it is still current before deploying.
- Answer engines: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`
- Browser runner: `ROUNDSEO_PERFORMANCE_RUNNER_URL` and `ROUNDSEO_RUNNER_TOKEN`
  (at least 24 characters). The runner exposes `/render` and `/screenshot` as
  well as `/audit`.
- Screenshots: an R2 binding (`R2`) and, optionally, `INTELLIGENCE_ASSET_SECRET`
  (falls back to `JWT_SECRET`).
- Ceilings: `INTELLIGENCE_DAILY_REQUEST_LIMIT` (default 500 per website per UTC day)
  and `INTELLIGENCE_MAX_SITE_CRAWL_PAGES` (default 500, hard limit 2000).

Migration `011_native_intelligence.sql` adds the native tables and columns. Apply
it once. It is not idempotent because it uses `ALTER TABLE`.
