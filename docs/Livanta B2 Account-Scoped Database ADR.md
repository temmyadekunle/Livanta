# ADR 0002 — B2 Account-Scoped Database Integration

| Field | Value |
|---|---|
| Status | **Accepted** — D1–D7 approved as B2 policy. Additional product and architecture boundaries A–F approved 2026-11-13. B2.1 readiness findings B-1 (B2.1/B2.2 boundary), B-2 (`livanta.intro.v1` completion marker) and B-3 (store/surface contract) reconciled in documentation 2026-11-13. No approval authorises implementation; implementation has not started. |
| Date | 2026-11-05 (amended 2026-11-13) |
| Project | Livanta (`temmyadekunle/Livanta`) |
| Baseline commit | `b348b95` — `feat: make authentication compulsory` |
| Scope | B2 architecture: local account isolation, lifecycle, legacy adoption, sync activation policy |
| Supersedes | None |
| Related work | `434f0e7` (account-scoped local data isolation), `b3c8ea7` (account-scoped cloud sync hardening), `b348b95` (B1 compulsory authentication gate) |
| This document | Documentation only. It does not implement, test or migrate anything. |

---

## 1. Context and purpose

B1 made authentication compulsory, but the application still binds every screen to the
anonymous `lifedesk` database: `components/LivantaApp.tsx:93` calls `useLivanta()` with no
store, and `useLivanta` falls back to `anonymousStore` (`lib/useLivanta.ts:82`). The
storage layer, however, already supports account scopes:

- `LocalStore` is constructed for one `LocalScope` and can only address that database
  (`lib/db.ts:319`).
- Account database names are `lifedesk:user:<lower-case-uuid>`, derived only from a
  validated Supabase UUID (`lib/db.ts:52`, `lib/db.ts:70`).
- Sync refuses anonymous stores and foreign owners (`lib/sync/storeMeta.ts:32`,
  `lib/sync/suspension.ts:58–68`).
- `useLivanta` has generation tokens so a delayed read/write cannot cross scopes
  (`lib/useLivanta.ts:154`), covered by `tests/hooksStore.test.tsx`.

B2 connects that foundation to the application, defines how identity reaches storage,
and constrains legacy adoption and cloud sync. This ADR records the decisions and the
implementation boundaries; it deliberately contains no code.

### 1.1 Goals

1. One IndexedDB database per authenticated Supabase user.
2. No authenticated session may read or write the anonymous database.
3. No anonymous data is deleted, moved or adopted without an explicit user action.
4. Account switching and sign-out cannot show one account's data in another session,
   including across browser tabs. The cross-tab element is met in B2.2; B2.1 provides
   the render-time owner guard and keyed subtree that B2.2 relies on (D5).
5. Cloud sync cannot activate as a side effect of wiring account stores.

### 1.2 Non-goals

- Cloud sync activation, reliability claims or Supabase resource changes.
- Merge/import design for a non-empty destination (deferred by D2).
- Deletion or cleanup of the anonymous dataset.
- Server schema changes (deferred by D7).
- IndexedDB encryption (not implemented; never claimed).

---

## 2. Decision summary

| ID | Decision | Enforcement stage |
|---|---|---|
| **D1** | Retain fail-closed offline behaviour. No grace period for expired, invalid or unresolved sessions. | B2.1, B2.2 |
| **D2** | Never automatically copy into a non-empty account. A separate explicit import/merge decision is required. | B2.3 (planner), future merge work |
| **D3** | The anonymous dataset may be explicitly claimed by exactly one account on a device. Never copy it into multiple accounts. Preserve the source. | B2.3 |
| **D4** | Demo/sample data must never enter a real account. Remove the signed-in demo path or isolate it completely. | B2.1 |
| **D5** | Detect identity changes across tabs; a tab must not keep displaying the previous account. Serialise transitions and reminders with Web Locks only; fail closed if unavailable. | B2.2 |
| **D6** | Cloud sync is explicitly disabled by default. B2 store wiring must not activate uploads. | B2.1, B2.4 |
| **D7** | Defer schema changes. Design and run an integration test for global `things.id` collisions before deciding on a composite key. | B2.4 |

### 2.1 B2.1 approved decisions (2026-11-13)

D1–D7 above are the accepted B2 policy decisions. A–F below are additional product and
architecture boundaries approved alongside them, each with the stage boundary shown in
the table; they sit within D1–D7 and neither replace nor amend them. All of them are
boundaries, not implementation instructions: approving a product behaviour or an
architecture does not authorise its implementation. Each stage starts only on its own
explicit authorisation, so A–F do not authorise B2.1, B2.2, B2.3 or B2.4 work.

| ID | Approved decision | Stage boundary |
|---|---|---|
| **A** | First-time users see presentation-only introductory onboarding, then the authentication welcome screen (Create an Account / Log In). The introduction does not create an account, open `lifedesk`, or read or write personal records, settings, onboarding data or account data. It may retain only a device-level language preference and the device-level completion marker `livanta.intro.v1`. The marker lives in `localStorage`, records only that the introduction was completed, contains no personal information, is not account data, and is never copied into an account database or adopted through B2.3. A completed marker leads to the authentication welcome screen on subsequent launches; clearing browser or device storage may cause the introduction to appear again. Signed-out users never reach the dashboard. No guest, demo bypass or anonymous production account exists. | B2.1 |
| **B** | Account setup belongs to the authenticated account store. Optional categories and first-record creation may be skipped, but skipping still completes setup and persists `onboarded: true`. Notification permission is not a setup requirement. Existing records are never treated as an empty account and are never overwritten or duplicated. The completion marker is written only after required setup writes succeed, through an idempotent sequence. | B2.1 |
| **C** | Preserve the existing `lifedesk` database. B2.1 must not automatically migrate, delete, overwrite or use it as the production account store. B2.1 introduces no adoption flow. B2.3 owns a separate adoption design and approval. Before external release, users must receive clear, accurate information about existing device data and the adoption process. | B2.1 (preserve/no use), B2.3 (adoption) |
| **D** | Production authentication fails closed when Supabase configuration is missing, invalid or contradictory. There is no anonymous fallback when authentication is required. `resolveLocalScope` must be connected to the production app flow. B2.1 owns account-store activation, the store/surface contract (§4.4), nullable `useLivanta`, render-time owner checks and the keyed account subtree. Signed-out, loading, error and invalid-identity states never expose account records. | B2.1 |
| **E** | B2.1 does not implement the identity-transition barrier and does not claim to solve native reminder cancellation or cross-tab transition safety. B2.1 may open an account-scoped database without requiring Web Locks, BroadcastChannel or storage-event transport, `crypto.subtle`, or cancellation-before-activation; it must not implement or simulate those B2.2 mechanisms. B2.2 owns the transition barrier, Web Locks, reminder ownership, unconditional cancellation, the coordinator and native/in-session delivery routing, together with those runtime capability requirements. An auth-enabled B2.1 build is internal-only and must not be released externally until B2.2 has passed its required acceptance criteria; no external beta or public release before B2.2 reminder privacy requirements are satisfied. This is an explicit stage boundary, not an accidental deviation from D5. A localStorage lease is never a substitute for Web Locks. | B2.1 (boundary only), B2.2 |
| **F** | Cloud sync remains disabled. B2.1 does not introduce an activation flag or enable network synchronisation. B2.4 remains separately gated and requires explicit approval. | B2.1 (no flag), B2.4 (activation) |

Only A–F in the table above are the additional approvals. B2.3 adoption mechanics
and B2.4 activation detail in the Clarifications document remain **draft
recommendations**; they are not accepted merely because A–F are.
Unresolved items are listed in §11.3.

---

## 3. Approved decisions

### D1 — Offline access remains fail-closed

**Decision.** An account store may be opened only after the auth state resolves to
`signed-in` with a valid Supabase UUID and a successful session read. Loading, error,
signed-out, expired, invalid or unresolved states never open a database and never fall
back to `lifedesk`.

**Rationale.** A session read failure is not evidence of being signed out, and it is not
permission to expose device data (`lib/useAuth.ts:189`). A grace period would create a
second authentication path that B1 deliberately removed.

**Constraints.**
- `getSession` remains bounded by `withTimeout` (10 s, `lib/sessionTimeout.ts:8`).
- A timeout or error produces the auth-error surface with explicit retry, not the app.
- No "last signed-in user" cache may be used to open an account store.
- Revisiting this decision requires dedicated security and usability testing, an
  explicit threat model, and a new ADR amendment. It must never apply after a
  successful sign-out or to an explicitly invalid token.

**Consequence accepted.** A previously authenticated user whose refresh fails while
offline cannot reach local records. That is preferable to an unauthenticated data path.

### D2 — Adoption into a non-empty account is deferred

**Decision.** The B2 adoption workflow copies only when the destination account database
is empty and undecided. A non-empty destination produces a `destination-not-empty`
planner result and no automatic write. Import/merge into a populated account is a
separate product decision with its own conflict rules.

**Rationale.** The requirement defines "copy" and "start fresh", not a merge. Silently
overwriting or merging account data risks duplicates and loss, especially once cloud
rows exist.

**Constraints.**
- The planner is the only component that decides eligibility; the executor cannot be
  invoked on `destination-not-empty`.
- No "copy anyway" bypass is exposed in B2. The destination is inspected, not mutated,
  when the result is non-empty.
- Future merge work must define id conflicts, timestamp precedence and tombstone
  handling before any UI is added.

### D3 — One claimant per device, source always preserved

**Decision.** The legacy anonymous dataset may be claimed by exactly one account on a
device, by explicit user action. No second account may copy it, and no automatic copy
may occur. The anonymous database's user records are preserved indefinitely; adoption
never deletes or moves them.

**Rationale.** Anonymous data predates identity. Allowing every account on a shared
device to copy it would disclose one person's records to another. The existing local
claim (`__livanta_sync_data_owner`, `lib/sync/meta.ts:31`) already models exclusive
ownership, although `ensureLocalDataOwner` currently has no production caller
(`lib/sync/meta.ts:201`).

**Constraints.**
- A claim held by another account makes the planner return `claimed-by-other`; the UI
  offers no copy action for that account.
- The D3 claim (`status: "claimed"`) is written only **after** copy verification. If no
  copy is performed ("start fresh"), no claim is taken.
- A `status: "reserved"` metadata record written before copy is **not** an approved D3
  decision. It is a B2.3 **draft recommendation** (Clarifications §2.2), subject to B2.3
  design approval; it is not the claim and authorises nothing.
- Re-running adoption for the same account resumes idempotently; a verified marker
  prevents re-copy.
- "Preserve the source" is defined at record level: `things`, `alerts`, `members` and
  the user `settings` record. The claim metadata key is written only after verification
  and user records are never modified. Under the B2.3 draft, reservation and guard
  metadata may also be written, but they are metadata and never user records.
- Releasing a claim or deleting the anonymous copy is out of scope. It requires a
  separate, explicit user action with its own design.

**Claim record format.** The claim key `__livanta_sync_data_owner` must hold a versioned
record, not an arbitrary string, and a legacy plain-string value is read as a claim for
its named user (`{ status: "claimed", userId: <value> }`). Adoption and sync ownership
must use exactly one parser for this key; no second interpretation is permitted. The v2
object shape in Clarifications §2.2 (`version`, `status`, `userId`, `adoptionId`,
`sourceFingerprint`, `at`) and its `reserved` state are a **B2.3/B2.4 draft
recommendation**, not an approved format; `reserved` is adoption metadata, not a D3
claim, and never authorises sync. The parser is not implemented in this documentation
change.

### D4 — Demo/sample data never touches a real account

**Decision.** Remove the signed-in demo entry point. Anonymous or demo access exists
only in a development build with `auth.enabled === false`. If a demo is required later,
it must run against a completely isolated, disposable store that is not an account scope,
is never synced or adopted, and is not reachable in an `auth.enabled` build even while
signed out.

**Rationale.** The current onboarding demo calls `completeOnboarding` and
`loadSampleData` against the anonymous store while a session exists
(`components/LivantaApp.tsx:327`), contaminating device data and, after B2.1, risking
writes to real account data.

**Constraints.**
- The first-time introduction is presentation-only. It does not create an anonymous
  account, open `lifedesk`, read or write personal records, settings, onboarding data or
  account data, or seed sample data. A device-level language preference is permitted
  because it is not account data. The device-level completion marker `livanta.intro.v1`
  is also permitted: it lives in `localStorage`, records only completion, contains no
  personal information, and is never copied into an account database or adopted. The two
  are separate keys; neither is account data.
- The "Try the demo" action is not rendered on any surface of an `auth.enabled` build,
  whether or not a session is active. There is no production guest path.
- Profile's "load sample data" remains a deliberate user action on the current account
  only; it is not a demo bypass and must write through the scoped store.
- A future demo environment must be labelled, never synced, cleared on exit and
  excluded from adoption. It must not reuse the anonymous scope.
- In an auth-disabled development build (`auth.enabled === false`), legacy anonymous
  behaviour may remain, but it is documented as dev-only. This is the only approved
  anonymous path, including for any future demo.

### D5 — Cross-tab identity changes and the transition barrier

**Decision.** Tabs coordinate identity changes over `BroadcastChannel`, with a
`storage` event on a dedicated non-secret key as fallback. From B2.2, at least one
transport must be available before an account store may be opened; B2.1 does not impose
this requirement (see **Stage boundary** below). A signal is never authority: the
receiving tab re-reads the Supabase session and derives the target user id from it.

Identity transitions and every reminder side effect are serialised by one exclusive Web
Lock, `livanta:identity-and-reminders:v1`. The lock is held across the complete critical
section: session re-validation, teardown, native cancellation, account activation and
native scheduling. `navigator.locks` is the only hard mutex. A localStorage lease is not
a mutex and is not used in any decision, activation or scheduling path.

From B2.2, if Web Locks, `crypto.subtle`, or both identity transports are unavailable, an
auth-enabled build fails closed: no account store is opened, no native reminder is
scheduled, and an explicit unsupported/retry surface is shown. `ifAvailable` and `steal`
are forbidden for the transition lock. Acquisition is bounded; a timeout is a failed
transition, not permission to proceed.

**Stage boundary (B2.1/B2.2).** D5 is effective from B2.2. B2.1 does not implement the
identity-transition barrier, and it may open an account-scoped database without requiring
Web Locks, BroadcastChannel or storage-event transport, `crypto.subtle`, or
cancellation-before-activation. Those runtime capability requirements and the
cancellation coordination in this decision are B2.2 acceptance obligations, not B2.1
preconditions, and B2.1 must not implement or simulate them. An auth-enabled B2.1 build
is internal-only and must not be released externally until B2.2 has passed its required
acceptance criteria. This is an explicit stage boundary, not an accidental deviation from
D5: the decision, the constraints and the fail-closed prerequisites below remain approved
and become binding in B2.2. Specifically, the transport prerequisite, the Web
Locks/`crypto.subtle` fail-closed prerequisite, the hide-before-await rule, the
marker/epoch/`tid` fencing, cancellation-before-activation and the coordinator rules in
this section and in §5.2–§5.3 are all effective from B2.2. B2.1 supplies only the
render-time owner guard, the store/surface contract (§4.4), the nullable desk input and
the keyed account subtree that B2.2 consumes.

**Rationale.** Each tab owns a module-level auth store (`lib/useAuth.ts:161`), while the
Supabase session and IndexedDB are shared by origin. Without coordination, a tab can
keep rendering account A after another tab signs in as B, and two tabs can interleave
adoption or reminder reconciliation. A lease cannot close that race: localStorage has no
atomic compare-and-set, and an expired lease can be stolen while its holder is still
running.

**Constraints.**
- Message shape: `{ type: "identity-changed", at: <epoch ms>, nonce: <random> }`. No
  email, token, user id or record content.
- On receipt, the tab sets a synchronous `hiding` state before any await, then calls a
  quiet session re-read. If the normalised user id is unchanged and no transition is
  pending, no teardown occurs.
- Safety net: re-validate on `visibilitychange` and `focus`, not on a polling timer.
  This is a backstop, not the immediate-hide guarantee.
- Every accepted transition increments a persisted epoch under the lock and receives a
  random transition id. Async work captures both. Results from an earlier transition are
  discarded and cannot publish into the new scope.
- Only the lock holder writes the transition marker or advances the epoch. A tab that
  finds the marker already `active` for the target does not cancel again; it hides its
  old scope and adopts the target.
- Reminder owner marker: `livanta.reminder-owner.v2` stores
  `{ v: 2, phase: "transitioning" | "active", owner: <opaque hash> | null, epoch, tid, at }`.
  `tid` is an opaque random transition identifier, paired with the monotonic epoch; it is
  never a raw user identifier. The marker contains no user id, email, name, token, record
  id or reminder text. It is a hint; the session read remains authoritative.
- (B2.2) The account store is created and passed to the desk only after cancellation
  succeeds and the marker is `active` for the target. B2.1 creates the store without that
  precondition, as stated in the stage boundary above. The account subtree is keyed by
  user id, so React resets navigation and notification state on an owner change (B2.1).
- Native cancellation uses a dedicated primitive that calls `LocalNotifications.cancelAll()`
  without a display-permission gate. `rescheduleReminders([])` is not a cancellation
  primitive.
- Lock ordering: the identity/reminder lock and the adoption source-guard lock are
  **never nested**. Adoption acquires `livanta:anonymous-source-guard` only after
  confirming that no identity transition is pending, and it aborts before copying or
  promotion if one becomes pending. The identity transition never acquires the
  source-guard lock and never waits on it. No code path may hold both locks at once.
- Security boundary: this coordinates privacy and consistency between tabs of the same
  origin. It is not protection against compromised same-origin code, extensions or
  OS-level access.

### D6 — Cloud sync is explicitly disabled by default

**Decision.** B2.4 introduces a single explicit activation control that defaults to
**off**. B2.1 wires account stores into the desk but continues to pass no store to sync,
and it does **not** introduce an activation flag or any network-synchronisation path.
Sync may receive an account store only when the B2.4 activation control is enabled, and
only after the acceptance criteria in §7 are met and activation is separately approved.

**Rationale.** Today sync is inert only because `useCloudSync` receives `store: null`
(`components/LivantaApp.tsx:96`), which yields `store-unavailable`
(`lib/sync/suspension.ts:60`). Wiring a store would silently activate uploads. That must
be a deliberate, reviewable change.

**Constraints.**
- B2.1 adds no activation flag, environment variable or engine call. The only permitted
  B2.1 sync state is `store: null` and zero network attempts.
- In B2.4, the control is a compile-time constant or build-time environment flag, default
  `false`. It is not a user setting and cannot be overridden by localStorage.
- Effective sync requires all of: activation enabled, auth `signed-in`, valid user id,
  a store whose scope matches the session owner, and normal suspension checks.
- Existing engine defences remain mandatory regardless of the flag:
  `accountStoreOwner` refuses anonymous/foreign stores (`lib/sync/storeMeta.ts:32`),
  and `requireOwner` re-checks the session before writes (`lib/sync/engine.ts:103`).
- With the flag off, any network attempt is a defect; tests must assert zero
  `from`/`rpc` calls even when a valid account store and session exist.
- No UI text may claim sync is working or reliable while the flag is off.

### D7 — Server key hardening deferred, integration test required

**Decision.** Do not change the Supabase schema in B2. Design and run an integration
test against a disposable project that establishes the real behaviour when two accounts
share a `things.id`. Decide on a composite `(user_id, id)` key only from that evidence.

**Rationale.** `public.things.id` is a global primary key
(`supabase/migrations/0001_cloud_sync.sql:15`). The SQL function fills `user_id` from
`auth.uid()` (`0001_cloud_sync.sql:108`), and RLS is own-row-only
(`0001_cloud_sync.sql:69`, policies at `:75–82`). The expected outcome of a cross-account
id collision is a failed or filtered write, not disclosure, but this has never been
executed. Client UUIDs make collisions unlikely; adoption preserves ids, so the case must
be proven, not assumed.

**Constraints.**
- No migration is written in B2.
- Integration test design (B2.4):
  1. Create disposable users A and B.
  2. A inserts thing id `X`.
  3. B calls `upsert_things_sync` with a row whose `id` is `X` and a `user_id` spoof.
  4. Record whether B receives an error or a silent no-op; assert A's row is unchanged
     and B cannot select it.
  5. Repeat for settings/dismissals to confirm the same ownership boundary.
  6. Record evidence in this ADR's change log and decide on key changes separately.

---

## 4. Identity → scope → LocalStore → application data flow

### 4.1 Pipeline

Before this pipeline runs, a signed-out first-time user sees presentation-only
introduction screens, then the authentication welcome screen. Completing the introduction
writes only the device-level, non-secret completion marker `livanta.intro.v1` in
`localStorage` (alongside the device-level language preference, which is a separate key).
The introduction has no database access and is not part of the account scope, and the
marker is not account data. A later launch with the marker present goes directly to the
authentication welcome screen. This pipeline begins only after the user chooses Create an
Account or Log In.

```
Supabase session                     (lib/supabase/client.ts, lib/useAuth.ts)
   │  user.id  — the only identity input
   ▼
isValidUserId + normalise            (lib/db.ts:39, lib/db.ts:52 — lower-case UUID)
   │
   ▼
resolveLocalScope                    (lib/localScope.ts:34 — tightened in B2.1)
   │  pending | unavailable | error | anonymous(dev only) | account
   ▼
useAccountStore  [PROPOSED]          useMemo(() => createLocalStore(userScope(id)), [id])
   │  { store: LocalStore | null, expectedUserId: string | null }
   │  non-null only when the resolved surface is app | setup (§4.4)
   ├──────────────► useLivanta(store, expectedUserId)         (data reads/writes)
   ├──────────────► useCloudSync({ store: null })             (in B2: stays inactive)
   └──────────────► adoption coordinator + UI                 (B2.3)
```

### 4.2 Normative flow rules

1. **Single identity source.** Only `useAuth().user?.id` may seed a scope. No email,
   display name, user metadata, provider id or client-generated value may do so.
2. **Validation before naming.** Every id passes `isValidUserId`; the database name is
   produced only by `databaseNameForScope` (`lib/db.ts:70`). No other code may build a
   database name.
3. **Tightened resolver.** In B2.1, `resolveLocalScope` must behave as follows when
   `enabled`:
   - `loading` → `pending`
   - `error` → `error`
   - `disabled` → `error` (matches the fail-closed surface decision, `lib/authGate.ts:55`)
   - `signed-out` → `unavailable` (a new state; not `anonymous`)
   - `signed-in` + invalid/missing id → `error`
   - `signed-in` + valid id → `account`
   When `!enabled` (development/test builds), `anonymous` remains the explicit legacy
   path. The current signed-out → anonymous and disabled → anonymous branches
   (`lib/localScope.ts:40`, `lib/localScope.ts:44`) are traps and must be removed.
4. **Stable store identity.** `userScope()` returns a fresh frozen object per call.
   Passing it directly to `useLivanta` would re-run its hydrate effect on every render
   (`lib/useLivanta.ts:154`). The store must be memoised on the normalised user id inside
   `useAccountStore`.
5. **Nullable desk input.** `useLivanta` accepts an explicit `LocalStore | null` together
   with the `expectedUserId` returned by `useAccountStore`. `null` means "idle": no
   database is opened, no default anonymous substitution occurs, and every operation is
   idle-safe. An explicit `null` must never select the legacy no-argument anonymous-store
   overload; that overload remains only for auth-disabled builds and existing tests. A
   store exists only when the resolved surface is `app` or `setup` (§4.4).
6. **One surface decision.** Scope state folds into the existing pure decision in
   `lib/authGate.ts:46` (or a wrapper with the same single-answer property). When
   authentication is enabled, the order is: loading → auth-loading; error or
   contradictory `disabled` → auth error; recovery link (`passwordResetReady`) →
   recovery surface, which wins over signed-in (`lib/authGate.ts:71`); signed-out with
   a pending email confirmation → authentication gate showing the pending-confirmation
   state; signed-out before introduction → presentation-only introduction; signed-out
   after introduction → authentication welcome; an expired or invalidated session that
   emits `SIGNED_OUT` → authentication welcome; scope pending → booting; scope error →
   recoverable error screen; signed-in but not set up → account setup; signed-in and set
   up → app. No component makes a second, weaker decision, and none of these states opens
   a database. The same decision is the sole authority for store eligibility (§4.4): no
   component or effect makes an independent auth, recovery or store-eligibility decision.
7. **Introduction is presentation-only.** The first-time introduction may read or write
   a device-level language preference and the device-level completion marker
   `livanta.intro.v1`, and nothing else. Both live in `localStorage` as separate keys;
   neither is account data. The marker records only that the introduction was completed,
   never personal information, and it is never copied into an account database or
   adopted. The introduction must not create an anonymous account, open `lifedesk`, open
   an account store, read or write personal records, settings or onboarding data, seed
   sample data, or set an account `onboarded` flag. Completing the introduction writes
   the marker and advances to the authentication welcome screen; on a later launch a
   present marker goes directly to that screen. Clearing browser or device storage may
   make the introduction appear again, and an absent, corrupt or unreadable marker is
   treated as not completed.
8. **Account setup is account data.** Setup runs only after authentication and reads and
   writes the resolved account store. Optional categories and first-record creation may
   be skipped, but skipping still completes setup and persists `onboarded: true`.
   Notification permission is never a completion requirement. Existing records mean the
   account is not empty: setup must not overwrite them, must not create duplicate starter
   records, and must not present an empty-state flow that ignores them. The completion
   marker is written only after the required setup writes succeed, in an idempotent
   sequence that is safe to retry. A new account must not inherit an anonymous
   `onboarded` flag.
9. **Recovery is data-free.** During `PASSWORD_RECOVERY`/recovery surface, no account
   records are rendered, no account store is created or hydrated, and no store hydration
   is required. The recovery surface wins over signed-in (`lib/authGate.ts:71`) and over
   `app`/`setup` eligibility even when a valid user id exists (§4.4).
10. **Captured-store operations.** Every in-flight read/write continues to target the
    store it started with, and generation tokens prevent late results from publishing
    into a newer scope (`lib/useLivanta.ts:107`). This property is retained and extended
    to lifecycle transitions.
11. **No anonymous access while enabled.** No code path may call `anonymousStore`,
    `openDatabase()` or the free compatibility functions
    (`lib/db.ts:441`, `lib/db.ts:446`) while `auth.enabled` is true, on any surface and
    in any session state. Anonymous access exists only in a development build with
    `auth.enabled === false` (D4, §10 B2.1).

### 4.3 Data classes and ownership

| Data | Store | Scope rule |
|---|---|---|
| Things | `things` | Account DB only while enabled |
| Alerts + dismissal flags | `alerts` | Account DB only while enabled |
| Household members (seeded, no UI reader yet) | `members` | Account DB only while enabled |
| User settings (`settings` key) | `settings` | Account DB only while enabled |
| Sync meta (`__livanta_sync_*`) | `settings` | Never copied during adoption; only meaningful to sync |
| Adoption marker (proposed `__livanta_adoption_v1`) | destination `settings` | Destination only |
| Claim (`__livanta_sync_data_owner`) | anonymous `settings` | Versioned record shared with sync; `claimed` only post-verification and for one account; any `reserved` pre-copy metadata is a B2.3 draft recommendation |
| Pending email confirmation | `localStorage` | Device-level boolean (documented) |
| Introduction completion (`livanta.intro.v1`) | `localStorage` | Device-level non-secret completion flag only; no personal information; not account data; never copied into an account DB or adopted |
| Entitlement cache | `localStorage` | Device-level today; must not leak plans across accounts once wired |
| Reminder owner salt (`livanta.install-salt.v1`) | `localStorage` | Device-level random 32-byte salt; non-secret; never an identity |
| Reminder owner marker (`livanta.reminder-owner.v2`) | `localStorage` | Device-level opaque hash + phase/epoch/`tid`/time only; no user id, email, name, token or record data |

### 4.4 B2.1 store and surface contract

This contract is part of the approved B2.1 boundary. It records the store/surface rules
the B2.1 readiness audit found unstated; it adds no product behaviour beyond A–F and does
not authorise implementation. The Clarifications document restates it at §3.6 with its
acceptance tests.

1. **One resolver hook.** A dedicated `useAccountStore` hook resolves the authenticated
   user's normalised id and returns `{ store: LocalStore | null, expectedUserId: string |
   null }`. No component constructs an account store or derives an expected owner
   independently.
2. **Eligibility.** An account store is created only when the resolved surface is `app` or
   `setup`.
3. **No store otherwise.** No account store is created for: loading, introduction,
   signed-out/authentication gate, pending email confirmation, recovery, auth error,
   invalid identity or scope error. In each of those states `store` and `expectedUserId`
   are `null`.
4. **Explicit nullable input.** `useLivanta` accepts an explicit nullable store and the
   expected user id. Passing `null` selects idle behaviour and must never fall through to
   the legacy anonymous-store overload.
5. **Idle-safe null operations.** With a `null` store, every desk operation remains
   idle-safe: it resolves without reading or writing IndexedDB and never substitutes
   `anonymousStore`, `openDatabase()` or a free compatibility function.
6. **Render-time owner guard.** `useLivanta` compares the store's scope with
   `expectedUserId` at render time. A mismatch must expose no account records and must
   produce a recoverable scope-error surface, not idle-in-app, a silent fallback or a
   second account's data.
7. **Scope-error retry.** Retry on the scope-error surface retries store resolution and
   hydration for the current session; it does not retry `getSession`.
8. **Recovery precedence.** Recovery takes precedence over `app`/`setup` eligibility even
   with a valid user id; no account store is created or hydrated behind recovery.
9. **One authoritative decision.** The single-surface decision in §4.2 rule 6 remains the
   only authority for surface, recovery and store eligibility. No component, effect or
   reminder path makes a second, independent auth, recovery or store-eligibility decision.

---

## 5. Account lifecycle and cross-tab security model

### 5.1 Lifecycle events

| Event | Required behaviour | Database effect |
|---|---|---|
| First launch or cleared device storage, no session, `livanta.intro.v1` absent | Presentation-only introduction, then authentication welcome. Completion writes only `livanta.intro.v1` (and any language preference) to `localStorage`. | No DB opened; no anonymous or account store hydrated; only device-level `localStorage` written |
| `livanta.intro.v1` present, still signed out | Authentication welcome (Create an Account / Log In) | No DB opened; marker not rewritten |
| Boot, valid session, not set up | Resolve account scope, open account DB, hydrate, run account setup | Account DB only |
| Boot, valid session, already set up | Resolve account scope, open account DB, hydrate, show app | Account DB only |
| Session present but scope unresolved | Booting / fail closed | No DB opened |
| First registration, confirmation required | Authentication gate showing the pending-confirmation state; no dashboard | No DB opened |
| First registration, immediate session | Account scope → account setup | Account DB created at v2 |
| Returning sign-in, already set up | Account scope → app. No adoption is run by B2.1. | Account DB only |
| Sign-out success | Teardown under the identity lock (B2.2), then authentication welcome. B2.1 performs no lock or cancellation. | No DB deleted; anonymous untouched. Reminder cancellation is B2.2, not B2.1. |
| Sign-out failure | Remain signed in; show error; no teardown | Unchanged |
| Account switch | Full teardown under the identity lock (B2.2); cancel before B activation (B2.2); remount through the B2.1 keyed subtree | A's DB untouched; under B2.2, B's DB opens only after cancellation succeeds. B2.1 does not cancel. |
| Session expiry or invalidated session (`SIGNED_OUT`) | Authentication welcome; fail closed | No DB opened |
| Session read error/timeout | Error surface, retry only | No DB opened |
| Recovery link / password reset | Recovery surface; wins over signed-in and over `app`/`setup` even with a valid user id | No data rendered; no account store created or hydrated |
| Offline, valid session | Account scope works offline | Account DB only |
| Offline, expired/invalid session | Fail closed (D1) | No DB opened |

**Stage boundary.** Under B2.1 these rows are honoured without the B2.2 barrier: account
stores may open without Web Locks, a cross-tab transport, `crypto.subtle` or
cancellation-before-activation, and sign-out or account switching does not cancel native
reminders. The lock, cancellation and coordinator steps annotated B2.2 are B2.2
acceptance obligations. An auth-enabled B2.1 build is internal-only until B2.2 acceptance
passes (§11.3).

### 5.2 Transition sequence (identity change or successful sign-out)

The transition controller is the only writer of identity and reminder state. Step 1
runs synchronously on the signal; step 2 follows immediately, and steps 3–11 run under
`livanta:identity-and-reminders:v1`. If any step after the lock is acquired fails, the
app stays on the hidden transition/error surface, B is not activated, and the marker is
not advanced to `active`. Every step is idempotent.

1. On the auth event or cross-tab signal, set the transition state to `hiding`
   synchronously, before any await. Stop passing the current store to the desk and hide
   the account subtree. The render-time rejection of a store whose scope does not match
   the expected user id is a **B2.1 guarantee** that B2.2 relies on; B2.2 owns the
   transition state and the hiding sequence, not a second owner guard. B2.1 does not
   implement this sequence, the lock or the coordinator: it provides only the render-time
   owner guard, the store/surface contract (§4.4), the nullable desk input and the keyed
   subtree that B2.2 consumes.
2. Re-read the session. Derive the target normalized user id. If the target is the same
   as the current owner and no transition is pending, clear `hiding` and stop; do not
   tear down, cancel or rehydrate.
3. Acquire the identity/reminder lock in exclusive mode with a bounded wait. If Web
   Locks is unavailable or the wait expires, fail closed: no account store, no native
   reminders, retry/reload surface.
4. Under the lock, re-read the session again. If the target changed, release and restart
   at step 2. Read `livanta.reminder-owner.v2` and compute the target owner hash.
5. If the marker is already `phase: "active"` for this target and the session still
   names this target, another tab has completed the cancellation. Skip to step 9
   without calling `cancelAll` and without rewriting the marker; use the epoch and
   transition id already recorded.
6. Otherwise write `phase: "transitioning"` with the target hash (or `null` for
   sign-out), a new epoch and a fresh transition id.
7. Cancel all native reminders through the reminder coordinator, using a dedicated
   unconditional cancellation primitive that does not check display permission, and
   suppress in-session delivery by publishing the new transition id. The coordinator
   re-reads the session, verifies the owner and `tid`, and is the only caller of the
   cancellation primitive. `rescheduleReminders([])` is not a cancellation primitive.
   If cancellation throws, times out or cannot be verified, leave the marker
   `transitioning`, keep the app hidden, show retry, and stop. Do not activate B.
8. Write `phase: "active"` for the target with the same epoch and transition id. Only
   after this write may the cancelling path create and hydrate the target store.
9. Create and hydrate the target store if not already done, then remount the account
   subtree keyed by the normalized user id. This resets navigation, route stack, sheets,
   dialogs, onboarding step, import preview, notification dedupe and `lastScheduled`
   without enumerating component state.
10. Reconcile the new account's reminders through the coordinator while still holding
    the lock. Reconciliation means **full cancellation of all native reminders followed
    by a full reschedule of the target owner's complete plan**; it is never a
    differential add/remove. The coordinator re-reads the session and refuses a plan
    whose owner is not the session owner. After the native call, re-read the marker; if
    the epoch or `tid` changed, cancel again through the coordinator.
11. Release the lock. Do not clear, delete, migrate or claim any database. Optionally
    `closeScope(previous)` only after in-flight operations settle.

### 5.3 Cross-tab model, owner marker and reminder coordinator

**B2.2 scope.** This model is implemented in B2.2. B2.1 does not provide the transport,
lock, marker or coordinator, and may open account stores without them (D5 stage
boundary).

- **Transport.** `BroadcastChannel("livanta.identity.v1")`, falling back to
  `localStorage.setItem("livanta.identity.v1", nonce)` plus a `storage` listener. At
  least one must work before an account store is opened. Messages carry no identity.
- **Authority.** A signal triggers a fresh session read; the resulting user id is
  compared with the tab's current id. The payload is never authority.
- **Immediate hiding.** Hiding is synchronous on signal receipt, before any await. A
  different process cannot hide before it receives a signal, so transport availability is
  a precondition, not an optimisation. Focus/visibility revalidation is only a backstop.
- **Lock.** `navigator.locks.request("livanta:identity-and-reminders:v1", { mode:
  "exclusive", signal }, ...)`, acquired with a bounded wait. No `ifAvailable`, no
  `steal`, no lease. If unavailable, fail closed. The lock is held across session reads,
  marker writes, `cancelAll`, account activation and `schedule`.
- **Transition controller.** One per tab. It coalesces auth events and cross-tab signals
  to a single desired target, runs one transition at a time, re-reads the session under
  the lock and restarts if the target changed. It is the only writer of the marker and
  the only component that requests native cancellation/scheduling; the coordinator
  executes every such request.
- **Epoch and stale work.** The marker carries a monotonic epoch; each transition also
  gets a random transition id. Every async operation captures `(store, generation,
  transitionId, ownerId)`. Late reads/writes from A may complete in A, but may not set
  state, call `refresh`, notify, or schedule for B. `useLivanta`'s generation token and
  render-time owner check enforce this.
- **Reminder owner marker.** Key `livanta.reminder-owner.v2`; value
  `{ v: 2, phase: "transitioning" | "active", owner: <base64url> | null, epoch, tid, at }`.
  `tid` is an opaque random transition identifier; it fences stale asynchronous work and
  is never a raw user identifier.
  `owner` is `base64url(HMAC-SHA-256(salt, "livanta.reminder-owner:v2:" + userId).slice(0, 16))`,
  where `salt` is 32 random bytes stored at `livanta.install-salt.v1`. The salt is
  non-secret; the marker is pseudonymous, not anonymous. It contains no email, name,
  token, record id, counts or reminder text. Never copy it into notification extras or
  logs.
- **Cold start.** Before opening an account store, read the marker. If it is absent,
  corrupt, `transitioning`, or its hash does not match the resolved owner, acquire the
  lock and run the **same reminder coordinator path**: write `transitioning` with a new
  epoch and `tid`, re-read the session, verify the owner, have the coordinator call the
  unconditional cancel primitive, then write `active` for the resolved owner or `null`.
  If auth is unresolved/error, the coordinator cancels and no store is opened. A matching
  `active` marker may skip the transition cancellation only after the coordinator confirms
  owner, session and `tid`; its plan is then scheduled in full through the coordinator. Cold
  start may never call `cancelAll` or `schedule` directly, so it cannot bypass the
  coordinator's ownership and session checks.
- **Reminder coordinator.** All native `cancelAll`/`schedule` calls and all in-session
  `new Notification` deliveries go through one coordinator. Under the lock it re-reads
  the session, rejects a plan/notification whose owner is not the session owner, checks
  the transition id (`tid`), and only then performs the side effect. **Reconciliation**
  is defined precisely as a full `cancelAll` followed by rescheduling the target owner's
  complete reminder plan through the coordinator; it is never a differential
  add/remove. After a native call it re-reads the marker; if the epoch or `tid` changed,
  it cancels again through the coordinator.
- **Cancellation authority, not exactly-once.** There is no global exactly-once
  guarantee. Only the lock holder for the current marker, epoch and `tid` may call the
  cancellation primitive, and only through the coordinator. A tab that observes `active`
  for the target skips cancellation and adopts the target. The holder may cancel again
  after the native call if the epoch or `tid` changed, and a failed attempt leaves
  `transitioning` for an idempotent retry; both are safe because a full cancellation is
  idempotent, and neither creates a second authority. Reconciliation always follows the
  same full-cancel-then-full-reschedule rule.
- **Same-id churn.** Token refreshes that keep the same user id do not tear down,
  rehydrate or remount; only the owner id is the React key.
- **Failure modes.** No Web Locks, no `crypto.subtle`, no transport, a corrupt marker or
  a failed cancellation: fail closed. No anonymous fallback, no B activation, no lease.
  A plugin call that hangs keeps the lock and the hidden surface; the user is offered
  reload rather than releasing the lock early.
- **Threat model.** Same-origin tabs only; not malicious same-origin code, extensions or
  OS-level access.

---

## 6. Legacy data ownership and adoption restrictions

**B2.1 boundary.** B2.1 preserves `lifedesk` exactly as it is. It does not migrate,
delete, overwrite, claim, adopt or use the anonymous database as a production account
store, and it does not run the adoption planner. B2.3 owns the separate adoption design
and its implementation approval. Before any external release, users must be told
clearly and accurately what will happen to existing device data and how adoption will
work.

### 6.1 Source definition

The anonymous database is `lifedesk` (`lib/db.ts:7`), with v2 stores `things`, `alerts`,
`members`, `settings` (`lib/db.ts:10`). User data eligible for adoption:

- all `things`;
- all `alerts` (including dismissal flags — alerts are derived, but dismissal state is
  user data);
- all `members`;
- the `settings` record under key `settings` only.

Explicitly excluded: every `__livanta_*` key, including
`__livanta_sync_meta*`, `__livanta_sync_data_owner` and
`__livanta_sync_settings_fingerprint*` (`lib/sync/meta.ts:24`,
`lib/sync/storeMeta.ts:26`).

### 6.2 Planner outcomes

The planner is pure and runs only when a valid account store is resolved.

| Result | Condition | UI / effect |
|---|---|---|
| `no-source` | Anonymous DB absent or has no eligible records | No prompt |
| `offer` | Source non-empty; destination empty; no marker; no conflicting claim | Explicit copy / start fresh prompt |
| `claimed-by-other` | Claim or reservation names another user | No copy action; source preserved |
| `destination-not-empty` | Destination has records with no attributable same-account resume state | No automatic action (D2); defer to future merge design |
| `finalization-pending` | Verified destination marker but the matching claim is still `reserved` (B2.3 draft) | Re-verify and promote; no copy |
| `already-decided` | Verified destination marker **and** a matching `claimed` record (state pairing per Clarifications §1.3) | No prompt; normal app |
| `invalid` | Corrupt or mispaired claim/marker, or unreadable source | Fail safe: no copy, no deletion; report error |

### 6.3 Executor requirements (B2.3 design constraints)

These are constraints on a future B2.3 design, not approved implementation
instructions. The mechanism in Clarifications §1.6 (guard record, guarded writes and
source revision) remains a draft recommendation.

1. Acquire the adoption/source-guard lock (`livanta:anonymous-source-guard`,
   Clarifications §1.6) only after confirming no identity transition is pending. Do not
   acquire `livanta:identity-and-reminders:v1`; the locks are never nested.
2. While holding the guard, snapshot the source in one readonly transaction across the
   four stores and compute its fingerprint.
3. Re-run the planner against that snapshot; refuse any result other than `offer`,
   `adoption-reserved`, `adoption-in-progress` or `finalization-pending` for the same
   account (Clarifications §1.3–§1.4).
4. Copy into the destination through `LocalStore` only, in this order: `settings` (user
   key) → `members` → `things` → `alerts`. Preserve `id`, `createdAt` and `updatedAt` so
   future cloud conflict rules remain meaningful. Skip all reserved keys.
5. Verify by re-reading the destination: exact id sets and record equality per store,
   settings equality, and counts. No success state before verification passes.
6. Record the destination marker (proposed `__livanta_adoption_v1`) with the attempt
   state and source identity defined in Clarifications §1.2: `in-progress` before the
   first user-data write in step 4, `verified` only after step 5 passes.
7. Only after verification, write the claim in `__livanta_sync_data_owner` for this
   account (Clarifications §2.2–§2.4). Under the B2.3 draft recommendation the claim is a
   promotion of an earlier `reserved` metadata record; that pre-copy reservation is not
   approved by this ADR, is metadata rather than user data, and is not a D3 claim. No
   other source write is permitted.
8. Never delete, clear or move the source. Never call `clearAllStores`,
   `deleteEverything` or `LocalStore.clear` on the anonymous scope as part of adoption.
9. On any failure: leave the source intact, leave the marker unverified, report the
   error, and allow an idempotent retry. Partial destination data is never treated as
   success.
10. "Start fresh" records the decision marker only, creates/uses an empty account DB,
    does not copy and does not claim the source.

### 6.4 Restrictions

- **B2.1:** no adoption, read of anonymous records, migration, deletion or use of
  `lifedesk` as an account store. Preservation is the only B2.1 behaviour.
- **D2:** no copy into a non-empty destination; merge is out of scope.
- **D3:** exactly one claiming account; a claimed source cannot be copied to another.
- **Source preservation:** indefinite; deleting the anonymous copy is a separate future
  action requiring explicit confirmation.
- **No automatic adoption:** no sign-in, onboarding, sync cycle or background task may
  copy data without the user choosing it.
- **Duplicate prevention:** verified markers plus idempotent upserts by id.
- **Resumability:** a retry re-snapshots the source and re-verifies; interrupted copies
  converge to the same record set.
- **Claims are not sync activation.** Writing a claim in B2.3 does not start uploads;
  D6 keeps sync off.
- **Introduction marker is not adoption input.** `livanta.intro.v1` is device-level
  `localStorage` state, not a user record and not in any database. B2.1 writes it, but
  B2.3 never reads, copies or migrates it, and it never appears in an adoption snapshot,
  fingerprint or destination.

---

## 7. Cloud-sync activation policy

### 7.1 Activation control

B2.4 introduces a single explicit control that gates sync, default **off**. B2.1
introduces no control, flag or network path.

- Proposed for B2.4: `lib/sync/activation.ts` exporting `SYNC_ACTIVATION` derived from a
  build-time environment flag (`NEXT_PUBLIC_CLOUD_SYNC`), defaulting to `false`.
- It is independent of Supabase credentials: having credentials does not enable sync.
- It is not user-configurable in B2 and cannot be overridden by localStorage.
- B2.1 continues to pass `store: null` to `useCloudSync`; B2.4 may pass a store only when
  the control is enabled.

### 7.2 Enforcement order

1. Activation control off → no cycle, no network.
2. Auth not `signed-in` → suspended.
3. Missing/invalid user id → suspended.
4. Store absent → suspended.
5. Store scope/database/owner mismatch → suspended (`lib/sync/suspension.ts:62–68`).
6. Engine re-validates store and session around every remote operation
   (`lib/sync/engine.ts:103`, `lib/sync/engine.ts:133`).

### 7.3 Preconditions for enabling sync (future, not B2)

- B2.3 adoption verified and tested, including claim handling.
- D7 integration test executed and its result recorded.
- Cross-account and account-switch tests pass against the real engine.
- Offline/expiry policy accepted (D1).
- Privacy copy updated; no reliability claim made.
- Manual Android checks for reminders, storage and sign-out.
- A new ADR or amendment approving activation.

---

## 8. Deployment and packaging prerequisites

These are release requirements. They document required behaviour; they do not change
build scripts in this documentation task.

### 8.1 Supabase build configuration

A production build requires both of:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

`assertProductionAuthConfig` (`lib/supabase/config.ts`) is called from
`next.config.ts`. When `NODE_ENV === "production"`, a missing, placeholder, non-HTTPS
or otherwise unusable pair fails the build. That failure is the intended fail-closed
behaviour for compulsory authentication. Do not bypass it with dummy values, a local
override or a build that silently drops the auth gate.

Development and tests are exempt so contributors without credentials can run
`next dev` and the test suite. A deployed artifact is not exempt: it must be built with
a usable production configuration.

**Post-deployment smoke test (signed out).** In a fresh browser profile with no stored
session, open the deployed build and verify:

1. With no `livanta.intro.v1` marker, the presentation-only introduction appears; no
   dashboard is reachable.
2. Completing the introduction shows the authentication welcome screen and writes only
   the device-level `livanta.intro.v1` marker and any language preference to
   `localStorage`.
3. Reloading the build shows the authentication welcome screen (the completed marker is
   honoured); clearing site/device storage makes the introduction appear again.
4. No account store is opened and no anonymous `lifedesk` data is read.
5. Signing in reaches account setup or the dashboard according to `onboarded`.
6. Signing out returns to the authentication welcome screen and exposes no account data.

This smoke test verifies the B2.1 gate. It does not verify reminder privacy, which is
B2.2, or sync, which is B2.4. An auth-enabled B2.1 build is internal-only: passing this
smoke test does not qualify it for external release, which the B2.2 acceptance criteria
gate (§11.3).

### 8.2 Android packaging and artifact provenance

Release packaging must not silently reuse stale `out/` contents.

- A release build runs `npm run build` immediately before packaging. `build-android.ps1`
  does this by default, then runs `npx cap sync android` and Gradle.
- `build-android.ps1 -SkipWeb` reuses whatever `out/` already exists. It is permitted
  only for local iteration after a verified build, never for a release artifact.
- After `cap sync`, verify that `android/app/src/main/assets/public/index.html` matches
  the fresh `out/index.html` (hash comparison) and that the packaged asset set belongs
  to the same build. A missing, stale or mismatched asset set is a packaging failure,
  not a warning.
- Record provenance with the artifact: source commit, build timestamp, `versionName`,
  `versionCode` and APK SHA-256. Never reuse or lower a released version code.
- If the fresh build cannot be produced or verified, do not package. There is no
  "reuse the last build" release path.

---

## 9. Dependency order for B2.1–B2.5

```
B2.0 (this ADR)
   └─► B2.1 App scope wiring  ──┬─► B2.2 Lifecycle + cross-tab
                                └─► B2.3 Legacy adoption ──► B2.4 Sync policy + ownership ──► B2.5 Alpha hardening
```

| Stage | Scope | Hard dependencies |
|---|---|---|
| **B2.0** | Decisions D1–D7; flow, lifecycle, adoption and sync policy documented | None |
| **B2.1** | `useAccountStore` returning `{ store, expectedUserId }` with store creation limited to `app`/`setup`, tightened `resolveLocalScope`, nullable `useLivanta` with idle-safe `null`, recoverable scope-error surface, render-time owner guard, keyed account subtree, presentation-only introduction with the device-level `livanta.intro.v1` marker, account setup and skip semantics, demo removal, preservation of `lifedesk`, no sync flag or network path, internal-only auth-enabled build without B2.2 runtime prerequisites | B2.0 |
| **B2.2** | Transition controller and barrier, BroadcastChannel + storage fallback, Web Locks-only serialisation with fail-closed prerequisites, hashed reminder owner marker with epoch and `tid`, unconditional cancellation, reminder coordinator and full reconciliation, native/in-session delivery routing. Consumes the B2.1 owner guard and keyed subtree; it does not reimplement them. | B2.1 |
| **B2.3** | Planner, executor, verifier, claim, marker, adoption UI and locale copy. Implementation remains blocked until its own architecture review and clarifications §1.6 prerequisites are satisfied. | B2.0, B2.1, B2.2 (lock), B2.3 architecture review, clarifications §1.6 |
| **B2.4** | Explicit sync activation control, ownership/claim integration, D7 integration test execution, activation decision | B2.1–B2.3, disposable server project |
| **B2.5** | Privacy/copy updates, storage-quota review, manual Android/PWA checks, alpha checklist | B2.1–B2.4 |

**Why this order.** Scope wiring must exist before lifecycle resets are meaningful, and
before adoption has a destination. Adoption must be verified before sync ownership can
rely on claims. Activation must be explicit before any store reaches the engine. No
external beta or public release occurs before the B2.2 reminder privacy acceptance is
met; B2.1 is not a release gate for reminder leakage. An auth-enabled B2.1 build may
exist for internal testing only: it may open account stores without Web Locks, transport,
`crypto.subtle` or cancellation, because those are B2.2 prerequisites (D5 stage boundary).

---

## 10. Acceptance criteria by stage

### B2.0 — Decisions (this document)

- D1–D7 recorded with rationale, constraints and enforcement stage.
- Flow, lifecycle, cross-tab, adoption and sync policies documented.
- No application, test, migration or configuration change.
- Document reviewed and approved.

### B2.1 — App scope wiring

- With `auth.enabled`, no anonymous database is opened at any time: introduction,
  sign-out, loading, error, registration, recovery, account setup and app surfaces all
  verified with spy tests. The only anonymous path is a dev build with
  `auth.enabled === false`.
- Pending email confirmation, signed-out, auth error, invalid identity, expired/
  invalidated session, recovery and scope error each render a non-dashboard surface,
  create no account store and expose no account records. Recovery does so even when a
  valid user id exists.
- A signed-in user's records live in `lifedesk:user:<uuid>`; a second account on the
  same device sees none of them in UI, storage or sync.
- `resolveLocalScope` no longer returns `anonymous` for signed-out or contradictory
  disabled states when auth is enabled; tests are updated accordingly.
- The store is memoised: no hydration loop, no new `LocalStore` per render.
- `useAccountStore` returns `{ store, expectedUserId }`, and `store` is non-null only on
  the `app` and `setup` surfaces. Every other surface listed above is test-asserted to
  return `store === null` and `expectedUserId === null`.
- `useLivanta(store, expectedUserId)` with an explicit `null` store is idle-safe: no
  IndexedDB read or write, no anonymous substitution, and the explicit `null` never
  selects the legacy no-argument overload. In-flight operations remain bound to their
  original store.
- `useLivanta` rejects a store whose scope does not match `expectedUserId` at render
  time; a mismatch exposes no account records and shows the recoverable scope-error
  surface. Retry re-runs store resolution and hydration for the current session, not
  `getSession`.
- The single-surface decision is the only authority for auth, recovery and store
  eligibility; no component or effect makes a competing decision.
- The account subtree is keyed by the normalised user id; an owner change resets
  navigation, sheets, dialogs, onboarding step, import preview and notification dedupe.
- A signed-out first-time user sees presentation-only introduction, then the
  authentication welcome screen. The introduction opens no database, reads or writes no
  personal records, settings or onboarding data, and cannot reach the dashboard.
  Completion is recorded only by the device-level, non-secret `livanta.intro.v1` marker
  in `localStorage`, which is separate from the language preference. A subsequent launch
  with the marker goes to the authentication welcome screen; clearing browser or device
  storage may show the introduction again. The marker is never written into, copied into
  or adopted from an account database and contains no personal information.
- Account setup and settings write to that account's DB; an anonymous `onboarded: true`
  cannot steer a new account into the app. Skipping optional categories and first-record
  creation still completes setup and persists `onboarded: true`; notification permission
  is not required to complete.
- Existing account records are detected as non-empty. Setup does not overwrite them,
  create duplicate starter records, or show an empty-state flow that ignores them. The
  setup completion marker is written only after required writes succeed and is
  idempotent on retry.
- B2.1 neither reads nor writes `lifedesk` as a production store, and it runs no adoption
  planner or migration. The existing anonymous database is preserved untouched.
- The signed-in demo entry is absent; sample data remains an explicit action on the
  current account.
- `useCloudSync` still receives no store; B2.1 adds no activation flag; a test asserts
  zero network calls.
- B2.1 does not claim reminder privacy. Resetting in-memory notification deduplication
  on an owner change does not cancel native reminders already scheduled. Native
  cancellation, ownership and cross-tab reminder routing are B2.2 acceptance items.
- An auth-enabled B2.1 build is internal-only and is not an external release. It may open
  account stores without Web Locks, BroadcastChannel/storage transport, `crypto.subtle` or
  cancellation-before-activation, and it must not implement or simulate those B2.2
  mechanisms. External release requires the B2.2 acceptance criteria to pass.

### B2.2 — Lifecycle, transition barrier and cross-tab

- **Immediate hide.** Given Tab1 on A and Tab2 signing out then in as B, on receipt of
  the auth event or cross-tab signal each tab enters `hiding` before any await; A is
  absent from state and DOM. Transport latency is excluded; at least one transport is
  required.
- **One transition, one cancellation authority.** Both tabs may request the transition,
  but only the lock holder for the current epoch/`tid` performs cancellation, through the
  coordinator, and advances the marker; the other observes `active` and does not call
  `cancelAll`. Exactly-once delivery is not claimed: the holder may cancel again after
  the native call if the epoch or `tid` changed, and failed attempts are retried
  idempotently.
- **Cancel before activate.** B's store is not created, hydrated or rendered until the
  unconditional cancellation resolves successfully and the marker is `active` for B. A
  cancellation failure leaves the app hidden and retryable, never on B.
- **No stale publish.** An A read or write that completes during B's activation cannot
  update B's UI. B2.2 relies on the B2.1 generation tokens, render-time owner check and
  keyed remount; it does not reimplement them. A write may finish in A's database only.
- **No stale reminder.** No A native schedule or web notification can occur after B is
  active. Native calls run only under the lock and are canceled by the transition; web
  delivery re-reads the session under the lock and aborts if the owner is not A.
- **Prerequisites.** With Web Locks, `crypto.subtle`, or both transports unavailable, no
  account store is opened and no native reminder is scheduled; an unsupported/retry
  surface is shown.
- **Cancellation primitive.** With display permission denied, teardown still calls
  `cancelAll`; a plugin error/timeout blocks B activation.
- **Marker privacy.** The marker contains only version, phase, opaque owner hash, epoch,
  opaque `tid` and timestamp; no UUID, email, name, token, record id, counts or reminder
  text.
- **Cold start.** A missing, corrupt, transitioning or mismatched marker cancels before
  any account store is opened. It uses the coordinator path, not a direct `cancelAll`. A
  matching marker may skip the transition cancellation only after owner, session and
  `tid` checks, then schedules the plan through the coordinator.
- **Reconciliation.** Reminder reconciliation is a full cancellation followed by a full
  reschedule of the target owner's complete plan, through the coordinator, under the
  lock and ownership checks. It is never a differential update.
- **No mutation.** Teardown deletes, clears, migrates or claims no database.
- **Same user.** A token refresh for the same user id causes no teardown or remount.
- **Sign-out failure.** A failed sign-out leaves the session and data in place and shows
  the error; no teardown.
- **Transport fallback.** BroadcastChannel works; with it unavailable, the storage
  fallback works; with both unavailable, the build fails closed rather than showing a
  stale account indefinitely.
- Recovery surface renders no account records.

### B2.3 — Legacy adoption

- No prompt when the source is empty; prompt only for `offer`.
- Copy: destination equals source for eligible records (ids, timestamps, settings);
  source unchanged; marker verified; claim written only after verification.
- Start fresh: destination empty, marker set, source unchanged, no claim.
- Partial failure: source intact, marker unverified, retry completes without duplicates.
- Verification failure: no success marker, source intact, user informed.
- Non-empty destination: no automatic copy (D2).
- Claimed by another account: no copy action (D3).
- Reserved `__livanta_*` keys never appear in the destination.
- Adoption performs no network call while D6 is off.

### B2.4 — Sync policy and ownership

- Activation control exists, defaults off and cannot be changed by localStorage.
- With activation off, a signed-in user with a valid account store produces zero
  `from`/`rpc` calls (test-asserted).
- With activation on in a test harness, only a matching account store may sync; an
  anonymous, foreign or tampered store is refused before any I/O.
- Claim behaviour is consistent: adoption claim and sync ownership cannot disagree.
- D7 integration test executed on a disposable project; evidence recorded; decision on
  the composite key documented. No schema change without that decision.

### B2.5 — Alpha hardening

- Privacy and user-facing copy updated: compulsory sign-in, per-account database
  naming, no encryption claim, sync still unverified.
- Manual checks on Android APK and web PWA: sign-in, switch, sign-out, offline, reminders,
  adoption, storage quota behaviour.
- No regression in existing test suites; no build/type errors.
- Alpha checklist signed off.

---

## 11. Outstanding risks and assumptions

### 11.1 Risks carried into implementation

| Risk | Severity | Mitigation / owner stage |
|---|---|---|
| Wiring a store accidentally activates sync | High | D6 explicit flag; B2.1 passes `null`; zero-network tests (B2.1/B2.4) |
| Missed teardown leaves previous account visible | High | Ordered teardown, store detach before render, generation tokens (B2.2) |
| Account store created behind recovery or another ineligible surface | High | Single-surface decision; `useAccountStore` returns `null` outside `app`/`setup`; per-surface tests (§4.4) |
| Introduction marker treated as account data or adopted | Medium | Device-level `localStorage` key outside every database; excluded from adoption snapshots; test (§4.3, §6.4) |
| LocalStorage lease used as a mutex | Critical | Remove it from identity/reminder paths; Web Locks only; fail closed (B2.2) |
| Permission-gated teardown skips `cancelAll` | Critical | Dedicated unconditional cancel primitive; test with permission denied (B2.2) |
| Raw UUID in reminder marker | Major (privacy) | Device-salted hash only; no raw identifiers (B2.2) |
| Web Locks unavailable on a beta target | Major (availability) | Detect; fail closed with supported-browser message (B2.2/B2.5) |
| Plugin cancel/schedule hangs or fails | Major | Bounded acquisition; no B activation on cancel failure; reload/retry (B2.2) |
| No cross-tab transport | Major | Require BroadcastChannel or storage; fail closed if neither (B2.2) |
| Cold-start stale alarms | High on shared devices | Cold-start cancellation under lock before store activation (B2.2) |
| Capacitor WebView lock/transport behaviour unverified | Major | On-device test in B2.5; fail closed if absent |
| Adoption duplicates or loses data | High | Empty-destination rule, verification, idempotency, source preservation (B2.3) |
| Reserved sync keys copied into an account | Medium | Whitelist/blacklist in executor; test (B2.3) |
| Second account copies first user's anonymous data | High | One-claim rule (D3/B2.3) |
| Stale tab schedules or shows A after B is active | Critical | Single lock across schedule/cancel/activation; session re-read; epoch; keyed remount (B2.2) |
| Marker/salt cleared or corrupt | Medium | Treat as mismatch; cancel; rewrite; transition id fences stale work |
| Keyed remount loses unsaved UI state | Low | Remount only on owner id change, not token refresh |
| Native id collision / notification extras | Low | Accept; no owner data in extras; test |
| Offline users blocked after token expiry | Medium (accepted) | D1 fail-closed; revisit with dedicated testing |
| Global `things.id` collision across accounts | Low–Medium | D7 integration test before any schema decision (B2.4) |
| Device-level entitlement cache later leaks plans | Medium (future) | Namespace or clear on identity change before wiring entitlements |
| IndexedDB quota shared across account databases | Low–Medium | Monitor; multiple accounts increase pressure; no persistence request today (B2.5) |
| No encryption at rest | Informational | Never claim encryption; privacy page already says device security only; keep accurate (B2.5) |
| Privacy copy stale ("signing in is optional", single DB name) | Low | B2.5 documentation update |
| Production build ships with auth disabled | Critical | Production build fails without usable Supabase config (8.1) |
| Android release packages a stale `out/` | High | Fresh build, asset hash verification and provenance record; never use `-SkipWeb` for release (8.2) |
| B2.1 mistaken for reminder privacy completion | High | B2.1 acceptance explicitly excludes native cancellation and cross-tab delivery; B2.2 gates external release |

### 11.2 Assumptions

1. Supabase `user.id` is a stable UUID across sessions and devices and is JWT-validated
   server-side. Client validation is for storage safety, not server authority.
2. `getSession()` is authoritative for the local session; a failed read is treated as
   unresolved (D1).
3. Beta targets provide IndexedDB, Web Locks, `crypto.subtle`, BroadcastChannel or storage
   events. B2.2 verifies them at runtime; if any required capability is absent, an
   auth-enabled build fails closed rather than falling back to a lease or anonymous data.
4. Users may share a device; isolation is required between accounts, not just between
   devices.
5. Anonymous data is valuable user data and must survive all B2 flows.
6. Existing engine guards remain correct while sync is off and are not weakened by B2.
7. The anonymous dataset's user records are never written during adoption. If the B2.3
   draft reservation/guard metadata is adopted, the only non-user writes are those
   metadata keys and the post-verification claim; all user records remain read-only.
8. `LocalNotifications.cancelAll()` can be called without display permission; B2.2
   verifies this on-device. If it cannot, account switching fails closed until an
   equivalent cancellation path exists.

### 11.3 Open items (not blocking B2.1/B2.2)

- Merge/import design for a non-empty destination (D2).
- Claim release and anonymous-data deletion UX (D3).
- Alternative to the signed-in demo, if product still wants one (D4).
- Server key decision after the D7 integration test.
- Cross-tab behaviour in the Capacitor WebView, to be measured on-device.
- Entitlement cache scoping before subscription UI is enabled.
- B2.2 acceptance evidence for the transition barrier, the Web Locks/transport/
  `crypto.subtle` prerequisites and reminder privacy. It blocks neither B2.1 nor B2.2
  implementation, but it blocks any external release of an auth-enabled build
  (D5 stage boundary).

---

## 12. References

| Area | File / symbol |
|---|---|
| Auth state, session read, sign-out | `lib/useAuth.ts` — `AuthStatus`, `applySession`, `onAuthStateChange`, `signOut` |
| Bounded session read | `lib/sessionTimeout.ts` — `withTimeout`, `createSessionAttempts` |
| Sign-out boundary | `lib/signOut.ts` — `performSignOut` |
| Surface decision | `lib/authGate.ts` — `resolveAppSurface`, `isAuthSurface` |
| Scope resolver | `lib/localScope.ts` — `resolveLocalScope` |
| Storage boundary | `lib/db.ts` — `LocalScope`, `userScope`, `isValidUserId`, `databaseNameForScope`, `openDatabaseByName`, `closeScope`, `LocalStore`, `anonymousStore` |
| Desk hook | `lib/useLivanta.ts` — default anonymous store, generation tokens, all mutations |
| App wiring | `components/LivantaApp.tsx` — `useLivanta()`, `useCloudSync`, onboarding/demo, reminder scheduling, delete-all |
| Sync suspension | `lib/sync/suspension.ts` — `resolveSyncSuspension` |
| Sync ownership | `lib/sync/meta.ts` — `SYNC_DATA_OWNER_KEY`, `ensureLocalDataOwner`, `recordDeletion`, `recordDismissal`; `lib/sync/storeMeta.ts` — `accountStoreOwner`, `assertAccountStore` |
| Sync engine | `lib/sync/engine.ts` — `runSync`, `requireOwner`, pull/push |
| Server schema | `supabase/migrations/0001_cloud_sync.sql` — RLS policies, `upsert_things_sync`, `things.id` primary key |
| Implementation clarifications | `docs/LIVANTA_B2_ADR_0002_IMPLEMENTATION_CLARIFICATIONS.md` — adoption retry, claim format, demo boundary, sync authority, D5 detail |
| Production auth build guard | `lib/supabase/config.ts` — `hasUsableCloudConfig`, `assertProductionAuthConfig`; `next.config.ts` call site |
| Android release packaging | `build-android.ps1` — fresh web build, `cap sync`, Gradle; `capacitor.config.ts` — `webDir: "out"`; `android/app/src/main/assets/public` packaged asset directory |
| Isolation tests | `tests/localStore.test.ts`, `tests/localScope.test.ts`, `tests/hooksStore.test.tsx`, `tests/settingsSeed.test.ts`, `tests/mutationStore.test.ts` |
| Sync tests | `tests/syncEngine.test.ts`, `tests/syncSuspension.test.ts`, `tests/syncMeta.test.ts` |
| Gate tests | `tests/authGate.test.ts`, `tests/components.test.tsx`, `tests/components.dom.test.tsx` |
| Privacy wording | `app/privacy/page.tsx` — storage description and device-security limitation |
| Identity transition controller [proposed] | `lib/identity/transition.ts` — target, phase, epoch, transition id |
| Identity lock [proposed] | `lib/identity/lock.ts` — Web Locks, bounded acquisition, fail-closed |
| Reminder owner marker [proposed] | `lib/reminders/ownerMarker.ts` — salt, hash, read/write, cold start |
| Reminder coordinator [proposed] | `lib/reminders/coordinator.ts` — cancel/schedule/notify under lock |
| Reminder bridge (split) | `lib/schedule.ts` — `cancelScheduledReminders`, `scheduleReminders` |

---

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-11-05 | Initial accepted ADR: D1–D7, identity/scope flow, lifecycle and cross-tab model, adoption restrictions, sync activation policy, stage order and acceptance criteria. No code changes. | B2 architecture review |
| 2026-11-13 | Corrected D5: Web Locks is the only mutex; lease removed from identity/reminder paths; added transition barrier, hashed owner marker, unconditional cancellation, fail-closed prerequisites and B2.2 proof obligations. No code changes. | B2 architecture review |
| 2026-11-13 | Approved and recorded B2.1 decisions A–F: introduction-before-auth journey, account-scoped setup and skip semantics, preservation of `lifedesk`, fail-closed production auth, B2.1/B2.2 reminder boundary, and sync remaining inert. Reconciled onboarding, claim format, lock non-nesting, reminder `tid`, reconciliation and cold-start wording, stage scopes and acceptance criteria. Added deployment and Android packaging prerequisites. No code changes. B2.3/B2.4 mechanics remain draft recommendations; unresolved items remain in §11.3. | B2 architecture review |
| 2026-11-13 | Documentation correction: separated accepted D1–D7 policy from the additional A–F boundaries and stated that neither authorises implementation; marked the pre-copy `reserved` write and v2 claim shape as B2.3 drafts; replaced the exactly-once cancellation claim with a single-authority rule that permits idempotent repeat cancellation; added pending-confirmation, expired-session and recovery states to the surface order and lifecycle; restricted anonymous/demo access to `auth.enabled === false`; attributed the transition controller, lock and reminder coordination to B2.2; corrected stale code references. No code changes. | B2 architecture review |
| 2026-11-13 | Reconciled the B2.1 readiness audit findings without changing stage scope. **B-1:** recorded that B2.1 does not implement or simulate the transition barrier and may open account stores without Web Locks, cross-tab transport, `crypto.subtle` or cancellation-before-activation; those runtime prerequisites and cancellation coordination are B2.2 requirements, and an auth-enabled B2.1 build is internal-only until B2.2 acceptance (D5, §2.1 E, §5.1, §8.1, §9, §10, §11.3). **B-2:** approved the device-level `livanta.intro.v1` completion marker as `localStorage`-only, non-secret, non-account data that is never copied or adopted (A, D4, §4.1–§4.3, §5.1, §6.4, §8.1, §10). **B-3:** recorded the `useAccountStore` `{ store, expectedUserId }` and surface-eligibility contract, idle-safe explicit `null`, recoverable scope-error surface and retry, and recovery precedence (§4.1, §4.2, §4.4, §5.1, §9, §10). B2.3/B2.4 mechanics remain draft recommendations; no implementation. | B2 architecture review |
