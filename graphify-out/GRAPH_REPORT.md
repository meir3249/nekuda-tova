# Graph Report - day  (2026-11-22)

## Corpus Check
- 150 files · ~77,384 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: (none) 5, .woff2 2, .webmanifest 1)

## Summary
- 770 nodes · 1873 edges · 29 communities (25 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27

## God Nodes (most connected - your core abstractions)
1. `vitest` - 33 edges
2. `startSettingsScreen()` - 26 edges
3. `InMemoryUserRepository` - 23 edges
4. `SupabaseUserRepository` - 18 edges
5. `validateContent()` - 18 edges
6. `StoredPushSubscription` - 18 edges
7. `Subscription` - 18 edges
8. `UserRepository` - 18 edges
9. `nextOccurrenceAfter()` - 17 edges
10. `runSendCycle()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `setup()` --calls--> `SupabaseUserRepository`  [EXTRACTED]
  tests/adapters/supabase/supabase-adapters.test.ts → src/adapters/supabase/supabase-user-repository.ts
- `sender()` --calls--> `WebPushSender`  [EXTRACTED]
  tests/adapters/web-push-sender.test.ts → src/adapters/web-push/web-push-sender.ts
- `errorsOf()` --calls--> `validateContent()`  [EXTRACTED]
  tests/core/content/validate.test.ts → src/core/content/validate.ts
- `FakeClock` --implements--> `Clock`  [EXTRACTED]
  tests/fakes/fake-clock.ts → src/core/ports/clock.ts
- `FakeContentSource` --implements--> `ContentSource`  [EXTRACTED]
  tests/fakes/fake-content-source.ts → src/core/ports/content-source.ts

## Import Cycles
- None detected.

## Communities (29 total, 4 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (33): @supabase/supabase-js, build(), ClientOptions, createServiceClient(), Fetch, RepositoryError, RepositoryUnavailableError, SupabaseErrorLike (+25 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (33): vite@8.3.8, vite, buildPwa(), BuildResult, listFiles(), SW_FILE, contentSecurityPolicy(), escapeHtml() (+25 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (16): SupabaseUserRepository, Subscription, MAX_BATCHES_PER_RUN, cfg(), contentOf(), minutes(), NEXT_DAY_SLOT, setup() (+8 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (34): isExit(), line(), load(), main(), main(), ContentReadError, RepoFileContentSource, diffContent() (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (30): SettingsPatch, SettingsStore, SettingsRow, corsHeaders(), DEFAULT_MAX_SUBSCRIPTIONS, diff(), ErrorCode, failure() (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (37): vitest, assertNonNegativeSafeInteger(), messageIndexFor(), randomStartIndex(), MAX_MS, MIN_MS, nextOccurrenceAfter(), isValidSlot() (+29 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (44): CORE_RESTRICTED_GLOBALS, CORE_RESTRICTED_IMPORTS, dependencies, @supabase/supabase-js@2.119.0, web-push@4.0.0, description, devDependencies, eslint@10.15.0 (+36 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (12): PermissionState, asPermission(), BrowserPushGlobals, createBrowserPushPlatform(), PushManagerLike, PushPlatform, PushSubscriptionLike, SERVICE_WORKER_READY_TIMEOUT_MS (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (24): endpointHash(), planRenewal(), readEndpointHash(), RenewalAction, writeEndpointHash(), serializeSubscription(), subscribePush(), SubscribeResult (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (17): PRODUCT_NAME, StringKey, TOAST_KEYS, handleNotificationClick(), handlePush(), handleSubscriptionChange(), notificationFor(), NotificationOptionsLike (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (20): ContentSource, PushSender, SubscriptionLookup, DEFAULT_MAX_LATE_SECONDS, evaluateDelay(), LocalDate, assertConfig(), forEachLimited() (+12 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (13): EnvState, PublicSettings, SettingsApi, SettingsApiConfig, SettingsApiResult, SettingsPatchInput, MemoryStore, bodyHtml (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.16
Nodes (21): CachedSettings, DEFAULT_TIME, isRecord(), PENDING_KEY, pickStore(), readPending(), readSettings(), safeGet() (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (24): compilerOptions, allowImportingTsExtensions, exactOptionalPropertyTypes, isolatedModules, lib, module, moduleResolution, noEmit (+16 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (15): ENDPOINT_HASH_KEY, KeyValueStore, SaveQueueDeps, strings, createInstallSheet(), INSTALL_HINT_SEEN_KEY, INSTALL_SHEET_CLOSE_MS, INSTALL_SHEET_DELAY_MS (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.20
Nodes (14): BuildPorts, runSender(), SenderIo, formatMarkdownSummary(), formatReport(), ids(), redact(), shortId() (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.26
Nodes (11): isAllowedEndpoint(), mapStatus(), networkErrorCode(), PUSH_REQUEST_TIMEOUT_MS, VapidDetails, PushOptions, PushPayload, PushResult (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (13): SendNotification, WebPushSender, WebPushSenderOptions, DEFAULT_PUSH_ENDPOINT_ALLOWLIST, isAllowedPushHost(), PushEndpointAllowlist, MAX_PUSH_SUBSCRIPTION_BYTES, PushSubscriptionValidation (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (4): SaveQueue, InstallSheet, SettingsScreen, StatusLine

### Community 19 - "Community 19"
Cohesion: 0.21
Nodes (10): detectEnvironment(), EnvInputs, PwaConfig, pwaConfig(), EnvWindow, permissionOf(), readEnvInputs(), readEnvironment() (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (11): BG_BOTTOM, BG_TOP, chunk(), crc32(), CRC_TABLE, DOT, HIGHLIGHT, OUT (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.26
Nodes (6): SystemClock, Clock, buildRealPorts(), CONTENT_PATH, forbiddenPush, realIo

### Community 22 - "Community 22"
Cohesion: 0.28
Nodes (8): SendCycleConfig, ConfigResult, CYCLE_DEFAULTS, Env, NOTIFICATION_TITLE, parseSenderConfig(), SenderConfig, truthy()

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (6): BACKGROUNDS, contrast(), css, luminance(), PAIRS, t

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (5): web-push, PushSubscriptionLike, SendOptions, SendResult, WebPushError

## Knowledge Gaps
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 9`, `Community 11`, `Community 12`, `Community 14`, `Community 15`, `Community 17`, `Community 19`, `Community 21`, `Community 23`?**
  _High betweenness centrality (0.259) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `startSettingsScreen()` (e.g. with `.deviceTimezone()` and `.readEnvironment()`) actually correct?**
  _`startSettingsScreen()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05750658472344162 - nodes in this community are weakly interconnected._
- **Why does `@supabase/supabase-js` connect `Community 0` to `Community 11`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05639097744360902 - nodes in this community are weakly interconnected._
- **Why does `UserRepository` connect `Community 24` to `Community 0`, `Community 2`, `Community 10`, `Community 16`, `Community 21`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06493506493506493 - nodes in this community are weakly interconnected._