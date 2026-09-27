# MIRRA AI — P1 Frontend & Orchestrator Integration Handoff

**Audience:** P1 — Frontend, WorkBuddy/Orchestrator, UI/UX, Interaction & Demo Lead
**From:** P3 — Backend Architecture & Evidence Intelligence
**Repository:** `Mirra-AI`
**Branch:** `feature/p3-backend-evidence`
**Latest commit at time of writing:** `8fe1bbc` (pushed, in sync with `origin/feature/p3-backend-evidence`; 0 ahead / 0 behind)
**Status legend:** `IMPLEMENTED` (in source, executable) · `TESTED` (covered by a passing test) · `PLANNED` (described, not built) · `PROPOSED` (recommendation, needs team agreement) · `BLOCKED` (waiting on a dependency/decision) · `TBD` (unverifiable from current repo)

---

## A. Product Context

MIRRA AI (Multi-Agent Intelligent Resolution & Reconciliation Assistant) is the Digital Native Track submission built against Ryde's **Multi-Agent Autonomous Dispute Resolution System** challenge (see the Hackathon Handbook, "5. The Digital Native Track - Ryde").

产品理念（中文说明）：MIRRA AI 的核心目标是让乘客和司机之间的行程纠纷，先通过 **私密 AI 助理（Private AI Assistance）** 尝试非正式解决，只有在必要时才升级为正式的 **AI 法庭（AI Tribunal）**，最终由自动化裁决或人工复核收尾。

The intended end-to-end user journey (product concept, as scoped by the team for this documentation round):

1. **Private AI Assistance first** — a party (rider or driver) opens AI Assistance privately. The other party is **not** notified that assistance was opened. This is a private, single-party conversation.
2. **Conditional neutral contact** — if the private assistant determines the issue needs the other party's input (e.g. confirming a pickup change), it may initiate a *neutral*, non-accusatory contact with the other party — still not a formal complaint.
3. **Formal AI Tribunal** — only when the issue cannot be resolved informally, or a party explicitly files a formal complaint, does the case enter the Tribunal pipeline (`INIT_CLAIM` → `ROUND_1_PLEADINGS` → `ROUND_2_PROSECUTOR_AUDIT` → `JUDGE_DELIBERATION` → `EXECUTION_ROUTER`, per `workflow.md`).
4. **Authorised resolution or human escalation** — automatic execution (`FULLY_AUTOMATED`) or routing to a human reviewer (`ESCALATED_HUMAN_REVIEW`), per `shared/schemas.json`'s `CaseMetadata.resolution_channel`.

> **CRITICAL STATUS NOTE:** Steps 1 and 2 ("Private AI Assistance" as a conversational, pre-Tribunal product feature) are **PROPOSED — NOT IMPLEMENTED and NOT YET MODELED** in `shared/schemas.json`. I grepped `workflow.md`, `README.md`, and `shared/schemas.json` for "Private"/"Assistance" and found **zero matches** — this flow exists only as product intent, not as a documented or coded contract. Do not confuse this with what P3's Milestone 1 calls "Private Assistance" in its own commit messages: that term refers narrowly to **party-scoped access control** (a rider/driver can only read *their own* case via the `X-Party-Id` header — see Section B). It is an access-control mechanism, not a chat/assistance feature. There is currently no backend concept of an assistance *session*, no conversational endpoint, and no state in `CaseMetadata.current_state` for "private assistance in progress." This gap is the single biggest open product-to-schema question for the team (see Section J).

---

## B. Existing P3 Backend Capabilities

All endpoints below are `IMPLEMENTED` and `TESTED` (58/58 tests passing as of commit `8fe1bbc` — see Section D for full verification). Verified by reading `backend/app/api/routes/{cases,evidence,verification}.py` and `backend/app/main.py` directly, and by running `cd backend && ./venv/Scripts/python -m pytest -q`.

Base URL prefix: `/api/v1` (configured in `backend/app/core/config.py::Settings.api_v1_prefix`). App entrypoint: `backend/app/main.py` (run via `uvicorn app.main:app` from `backend/`). **This is a separate FastAPI app from the pre-existing `backend/main.py`** (root-level, P1/P2's mock dispute-list endpoints) — the two are not wired together. See Section G for why this matters.

### B.1 `GET /health`
- **Purpose:** Liveness check.
- **Headers:** none.
- **Request:** none.
- **Response `200`:** `{"status": "ok"}`
- **Status:** IMPLEMENTED, not covered by an automated test (trivial).

### B.2 `POST /api/v1/cases`
- **Purpose:** Create a case record (Case Intake / `INIT_CLAIM`).
- **Headers:** `Content-Type: application/json`. No party header required (this is intake, before a caller can be authenticated against an existing case).
- **Request schema** (`app/schemas/case.py::CaseCreate`):
  ```json
  {
    "case_id": "DISP-002",
    "dispute_type": "NO_SHOW_CHARGE",
    "trip_id": "TRIP-2026-09945",
    "rider_id": "R-7823",
    "driver_id": "D-2398"
  }
  ```
  `dispute_type` must be one of `ROUTE_DEVIATION | CLEANING_FEE | SAFETY_ALERT | NO_SHOW_CHARGE` (exact enum from `shared/schemas.json`). `trip_id` optional.
- **Response `201`** (`CaseRead`):
  ```json
  {
    "case_id": "DISP-002",
    "dispute_type": "NO_SHOW_CHARGE",
    "current_state": "INIT_CLAIM",
    "current_round": 1,
    "resolution_channel": null,
    "trip_id": "TRIP-2026-09945",
    "rider_id": "R-7823",
    "driver_id": "D-2398",
    "created_at": "2026-09-25T00:00:00Z",
    "updated_at": "2026-09-25T00:00:00Z"
  }
  ```
- **Errors:** `409 Conflict` if `case_id` already exists.
- **Access control:** none — anyone can create a case with any `rider_id`/`driver_id`, including impersonating identities that aren't theirs. **This is a known gap** — see Section C.
- **Status:** IMPLEMENTED, TESTED (`backend/tests/test_cases.py`).

### B.3 `GET /api/v1/cases`
- **Purpose:** "Private Assistance" list — returns only cases where the caller is the rider or driver.
- **Headers:** `X-Party-Id: <rider_id or driver_id>` **required**.
- **Response `200`:** `list[CaseRead]`, filtered server-side to `rider_id == party_id OR driver_id == party_id`, ordered newest-first.
- **Errors:** `422` if `X-Party-Id` header missing.
- **Status:** IMPLEMENTED, TESTED.

### B.4 `GET /api/v1/cases/{case_id}`
- **Purpose:** Read a single case.
- **Headers:** `X-Party-Id` required.
- **Response `200`:** `CaseRead` (same shape as B.2).
- **Errors:** `404` if case doesn't exist; `403` if the caller's `X-Party-Id` is neither the case's `rider_id` nor `driver_id`; `422` if header missing.
- **Status:** IMPLEMENTED, TESTED.

### B.5 `POST /api/v1/cases/{case_id}/evidence`
- **Purpose:** Attach a basic evidence record to a case.
- **Headers:** `X-Party-Id` required (must be a party to the case).
- **Request schema** (`app/schemas/evidence.py::EvidenceCreate`):
  ```json
  {
    "evidence_id": "GPS-001",
    "source_type": "GPS_TELEMETRY",
    "description": "Route deviated 2.3km from optimal path",
    "payload": {"deviation_distance_km": 2.3}
  }
  ```
  `source_type` enum matches `shared/schemas.json`'s `EvidenceReference.source_type` exactly: `GPS_TELEMETRY | CHAT_LOG | RECEIPT | ROUTE_TRAJECTORY | PAYMENT_RECORD | IMAGE | EXIF_METADATA | HISTORICAL_PROFILE | APP_EVENT | OTHER`.
- **Response `201`:** `EvidenceRead` (adds `id`, `case_id`, `created_at`).
- **Errors:** `404` case not found; `403` not a party; `422` missing header.
- **Status:** IMPLEMENTED, TESTED. Note: this is a manual/basic evidence store (a DB table), **separate** from the DISP-00x fixture-driven verification engine in B.6 — nothing currently links them.

### B.6 `GET /api/v1/cases/{case_id}/evidence`
- **Purpose:** List basic evidence records for a case (from B.5's table, not the fixture engine).
- **Headers:** `X-Party-Id` required.
- **Response `200`:** `list[EvidenceRead]`.
- **Errors:** same as B.5.
- **Status:** IMPLEMENTED, TESTED.

### B.7 `POST /api/v1/cases/{case_id}/verify`
- **Purpose:** Run deterministic evidence verification and return a `ProsecutorReport`-shaped result. **Currently only works for `case_id`s in a hardcoded allowlist: `DISP-001`, `DISP-002`, `DISP-003`** (see `backend/app/services/verification/ingestion.py::_ALLOWED_DEMO_FIXTURES`). Only `DISP-002` (`NO_SHOW_CHARGE`) has full test coverage; `DISP-001`/`DISP-003` load but their check outcomes are not individually asserted by tests.
- **Headers:** `X-Party-Id` required (must be a party to the case, and the case must already exist as a `Case` row — created via B.2 first).
- **Request body:** **none accepted.** The route takes no policy/threshold parameters by design (see `MIRRA_P3_BACKEND_STATUS_AND_ROADMAP.md` Section D/H for why). Any JSON body a client sends is silently ignored.
- **Response `200`** (`ProsecutorReportResponse`): see full example in `MIRRA_P2_AGENT_INTEGRATION_HANDOFF.md` Section C — identical shape, reused here to avoid duplication. Top-level keys: `verified_facts`, `disputed_facts`, `missing_facts` (each a list of `Fact` objects with `fact_id`, `description`, `supporting_evidence[]`, optional `party_relevance`/`policy_clause_reference`/`confidence_level`), `prosecutor_summary`, `report_submitted_at`.
- **Errors:** `404` case not found in DB, or `case_id` not in the fixture allowlist (both return the *same* generic 404 message — no filesystem/allowlist detail is leaked); `403` not a party; `422` if the fixture's internal `case_metadata.case_id` doesn't match the URL (defensive check, not currently reachable with the shipped fixtures).
- **Status:** IMPLEMENTED, TESTED (`backend/tests/test_verification.py`, 47 of the 58 total tests target this module).

### B.8 OpenAPI
Auto-generated at `/openapi.json` and interactive docs at `/docs` (FastAPI default, confirmed working — `app.openapi()` was invoked directly during M1 and returns all paths above). **Status: IMPLEMENTED.**

---

## C. How P1 Should Use the Backend

1. **Create or retrieve a Case** — `POST /api/v1/cases` at intake time (when a rider/driver formally files, per the product flow in Section A). For an already-existing case, use `GET /api/v1/cases/{case_id}` or list via `GET /api/v1/cases`.
2. **Load case details** — `GET /api/v1/cases/{case_id}` with the current user's ID in `X-Party-Id`.
3. **Read evidence** — `GET /api/v1/cases/{case_id}/evidence` for manually-attached records (B.5/B.6). Note this is *not* the same data the verification engine reads (B.7 reads `backend/mock_data/{case_id}.json` directly, bypassing the DB evidence table entirely — see `MIRRA_P3_BACKEND_STATUS_AND_ROADMAP.md` Section H, "duplicate evidence sources").
4. **Request evidence verification** — `POST /api/v1/cases/{case_id}/verify`, no body.
5. **Display verified/disputed/missing facts** — iterate the three arrays in the response; each `Fact` has a human-readable `description` and `supporting_evidence` you can render as citations (evidence_id + source_type + description).
6. **Handle loading and error states:**
   - `403` → "You don't have access to this case" (do not reveal case existence details beyond that).
   - `404` → "Case not found" (this now also covers "not verifiable yet" for cases outside the fixture allowlist — display a generic "verification unavailable for this case" message, not a technical error).
   - `422` → missing `X-Party-Id` header (a frontend bug if seen in production — always send it) or a case/fixture ID mismatch (rare, defensive).
7. **Support passenger and driver identities** — send whichever ID (`rider_id` or `driver_id`) belongs to the logged-in user as `X-Party-Id` on every case-scoped call.

### Limitations of `X-Party-Id` mock authentication
This is **explicitly a mock** (see `backend/app/api/deps.py` docstring: "identity comes from a plain header instead of JWT/OAuth"). It is a placeholder acknowledged as acceptable for this MVP (the Handbook's DBS DCTA challenge explicitly permits mock auth/gateway services). Concretely:
- **Anyone can claim to be anyone** — the header value is trusted as-is, with no signature, session, or login check behind it. A malicious client can set `X-Party-Id: R-7823` and read that rider's cases without being R-7823.
- **No session/login flow exists.** P1 must decide how the frontend obtains the correct ID to put in this header (e.g. from a mock login screen, a hardcoded demo user switcher, etc.) — this is `PLANNED`, not specified anywhere yet.
- **Case creation (`POST /api/v1/cases`) has no identity check at all** — anyone can create a case naming arbitrary `rider_id`/`driver_id` values (see Section J, API Gap Analysis).
- Do not build production security assumptions on this header. It exists to make party-scoping testable and demoable, not to be secure.

---

## D. Passenger UI Flow

**Status of this entire section: PLANNED — NOT IMPLEMENTED.** `frontend/app/page.tsx` is still the default `create-next-app` scaffold (verified by reading it directly) — zero custom screens, zero API calls exist in the frontend today.

| # | Screen | What passenger sees | Backend data required | Endpoint that exists | Endpoint still missing | Triggers next state |
|---|--------|---------------------|------------------------|----------------------|--------------------------|----------------------|
| 1 | Order context | Trip summary (pickup/dropoff, fare, driver) | Trip/case metadata | `GET /api/v1/cases/{id}` (if a case already exists) | **Trip-level lookup by `trip_id` alone** (no case yet) — PLANNED — NOT IMPLEMENTED | Tap "Get Help" |
| 2 | AI Assistance button | Entry point into private assistance | none | — | — | Opens private assistance |
| 3 | Private Assistance | 1:1 chat with AI about the issue, **not visible to driver** | Conversation state, case draft | none | **Assistance session API** — PLANNED — NOT IMPLEMENTED (see Section A) | AI proposes 2 choices |
| 4 | Two primary assistance choices | e.g. "Request refund" vs "File formal complaint" | Assistance recommendation | none | **Dynamic choice/action API** — PLANNED — NOT IMPLEMENTED | Selects a path |
| 5 | Conditional driver contact | Neutral message sent to driver (if AI decides it's needed) | Notification/contact event | none | **Notification API** — PLANNED — NOT IMPLEMENTED | Driver responds or times out |
| 6 | Pickup confirmation | Confirm/deny a proposed change | Case + proposed change | none | PLANNED — NOT IMPLEMENTED | Both-party confirmation |
| 7 | Alternative arrangements | Reschedule / alternative offer | Case state | none | PLANNED — NOT IMPLEMENTED | Accept/reject |
| 8 | Cancellation preview | Shows fee impact before formal filing | Case + fare data (`payment_fare_data`, present in mock fixtures) | Partially: `GET /api/v1/cases/{id}` has no fare fields exposed today (`CaseRead` doesn't include `payment_fare_data`) | **Fare/preview endpoint** — PLANNED — NOT IMPLEMENTED | Confirm cancellation |
| 9 | Post-trip follow-up | "Was this resolved?" prompt | Case status | `GET /api/v1/cases/{id}` (status only: `current_state`) | Resolution detail — PLANNED | Escalate or close |
| 10 | Formal complaint | Submits a case into the Tribunal pipeline | Creates/updates case | `POST /api/v1/cases` creates the row; **no endpoint transitions `current_state` from `INIT_CLAIM` onward** | **State-transition API** — PLANNED — NOT IMPLEMENTED (owned by orchestrator, see Section G) | Enters `ROUND_1_PLEADINGS` |
| 11 | AI Tribunal | See Section F | `ProsecutorReport` | `POST /api/v1/cases/{id}/verify` (evidence only — no Rider/Driver Advocate statements or Judge verdict exist yet) | **Advocate statement API, JudgeVerdict API** — PLANNED — NOT IMPLEMENTED, owned by P2 | Judge deliberation |
| 12 | Resolution / human escalation | Final outcome or "under human review" | `resolution_channel`, `ExecutionPayload` | none | **Execution Router** — PLANNED — NOT IMPLEMENTED | Case closed |

---

## E. Driver UI Flow

**Status: PLANNED — NOT IMPLEMENTED** (same basis as Section D).

| # | Screen | What driver sees | Backend data | Existing endpoint | Missing endpoint |
|---|--------|-------------------|---------------|--------------------|-------------------|
| 1 | Neutral pickup coordination request | A non-accusatory prompt from the rider's assistant | Notification event | none | PLANNED |
| 2 | Safe interaction while driving | Voice/large-button minimal UI, no typing while moving | — | none | PLANNED (product/UX requirement, not a backend concern) |
| 3 | Confirm/reject pickup change | Accept/decline a proposed change | Case state | none | PLANNED |
| 4 | Alternative arrangements | Counter-offer | Case state | none | PLANNED |
| 5 | Driver-initiated cleaning fee case | Start a claim (mirrors DISP-003 fixture: `CLEANING_FEE`, `$100` disputed) | `POST /api/v1/cases` (dispute_type=`CLEANING_FEE`) | IMPLEMENTED for case creation only | Claim-specific fields (amount, photo) not in `CaseCreate` — PLANNED |
| 6 | Private assistance before formal filing | Same private-assistance gap as Section D | — | none | PLANNED |
| 7 | Formal notification of cleaning fee claim | Rider is told a claim was filed | Notification | none | PLANNED |
| 8 | Evidence upload (photo) | Attach a cleaning-fee photo | `POST /api/v1/cases/{id}/evidence` with `source_type: "IMAGE"` | IMPLEMENTED (generic evidence store; **no file upload — `payload` is JSON only, no binary/image handling exists anywhere in the backend**) | **Actual image upload/storage** — PLANNED — NOT IMPLEMENTED. EXIF verification is entirely out of Milestone 2A scope (confirmed: no `image_exif_analyses` handling in `backend/app/services/verification/`) |
| 9 | Driver response to formal case | Submit a defense statement | — | none | **Driver Advocate output API** — P2-owned, PLANNED |
| 10 | Resolution & follow-up | Outcome display | `resolution_channel` | none exposing full outcome | PLANNED |

**Important:** rider and driver views must **not** show identical data. Confirmed the backend already enforces case-level party-scoping (only a party can read *the case at all*), but there is **no field-level redaction** implemented — e.g. `GET /api/v1/cases/{id}` currently returns the same full `CaseRead` object to both rider and driver (it contains no private-conversation fields today, so this hasn't mattered yet, but once an assistance-session concept exists, P1 and P3 must agree on which fields are rider-only vs driver-only vs shared). This is a `PROPOSED` design point, not yet a problem in the current schema.

---

## F. AI Tribunal UI

**Status: mostly PLANNED.** Only the Prosecutor/evidence portion has real backend data today.

| Element | Source | Status |
|---|---|---|
| Rider Advocate statement | `shared/schemas.json` → `Round1Statements.rider_statement` (`AgentStatement`) | **PLANNED — NOT IMPLEMENTED.** No P2 agent exists; `backend/orchestrator/state_machine.py` calls `run_rider_advocate(context)`, a function that is **not defined anywhere in the repository** (confirmed via repo-wide grep). Calling the orchestrator today raises `NameError`. |
| Driver Advocate statement | `Round1Statements.driver_statement` | Same as above — PLANNED, not implemented. |
| Evidence / Prosecutor findings | `ProsecutorReport` | **IMPLEMENTED & TESTED** — `POST /api/v1/cases/{id}/verify` (Section B.7). This is real, working data for `DISP-001/002/003` today. |
| Policy references | `Fact.policy_clause_reference` | Field exists in the contract and is populated **only when a backend policy is registered** (`backend/app/services/verification/policy.py`). The registry is currently **empty** — no dispute type has a trusted policy yet, so this field will be absent from every fact until P2 supplies one (see `MIRRA_P2_AGENT_INTEGRATION_HANDOFF.md` Section F). |
| Judge Verdict | `shared/schemas.json` → `JudgeVerdict` | **PLANNED — NOT IMPLEMENTED.** No code produces this object anywhere in the repo. |
| Agent execution timeline | — | PLANNED — no event/audit log exists (see roadmap doc, Section H). |
| Confidence & escalation state | `JudgeVerdict.confidence_score`, `EscalationProtocol` | PLANNED — not implemented. Do not confuse with `Fact.confidence_level` (evidence-level, already implemented, see Section G note below). |
| Human review state | `ExecutionPayload.execution_status` | PLANNED — no Execution Router exists. |

**Separation of public vs. private data:** the Tribunal is meant to be a shared, both-parties-visible view once a formal case exists — but private-assistance conversations (Section A) that happened *before* formal filing must **not** be shown to the other party or become part of the Tribunal record automatically. There is currently no backend mechanism enforcing this separation because there is no assistance-session data model yet. **This is a required design decision before P1 builds the Tribunal screen** — flagged in Section J.

The Handbook explicitly allows a **company dashboard with additional role-authorised access** (internal reviewers) — this is `PROPOSED`, no role model beyond party-scoping (rider/driver) exists in the backend today.

---

## G. State Machine and Workflow

Source inspected directly: `backend/orchestrator/state_machine.py`, `workflow.md`, `shared/schemas.json`.

**Current implementation status: skeleton only, non-functional.** `backend/orchestrator/state_machine.py` contains one async function, `run_dispute_pipeline(case_id)`, which:
1. Calls `load_raw_mock_json(case_id)` — **not defined anywhere in the repo.**
2. Builds an in-memory `context` dict shaped like the master schema (`case_metadata`, `data_sources`, `round_1_statements`, `round_2_cross_exam`, `round_3_rebuttal`, `bonus_modules`, `prosecutor_findings`, `judge_verdict`).
3. Calls `run_rider_advocate`, `run_driver_advocate`, `run_prosecutor_audit` — **none defined anywhere in the repo.**
4. Ends with a comment: `# 依此类推，动态填充整张大表！` ("and so on, dynamically fill in the whole table") — i.e. the function is explicitly incomplete past Round 2.

Running this function today would raise `NameError` on the first undefined call. **It has zero integration with P3's backend** — it does not call any `/api/v1/*` endpoint, does not use SQLAlchemy models, and does not import anything from `backend/app/`.

Note also: the in-memory `context` still includes a `round_3_rebuttal` key even though `workflow.md`'s own "Design Decision: Why There Is No Round 3" section (and the master schema, which has no `Round3` type) explicitly removed Round 3. **Do not implement Round 3 logic** — this stray dict key in the stub should be treated as leftover scaffolding, not a requirement. Per `shared/schemas.json`, `CaseMetadata.current_round` is constrained to the enum `[1, 2]` only.

**Existing states/transitions** (from `shared/schemas.json` → `CaseMetadata.current_state`, exact enum): `INIT_CLAIM → ROUND_1_PLEADINGS → ROUND_2_PROSECUTOR_AUDIT → JUDGE_DELIBERATION → EXECUTION_ROUTER`. No code anywhere transitions a `Case` row through these states — `backend/app/models/case.py::Case.current_state` defaults to `INIT_CLAIM` at creation and is **never updated by any existing endpoint.**

**Who owns which state — must not be silently redefined:**
- **P3's backend** owns: the `Case` row's persistence (`case_id`, `dispute_type`, `rider_id`, `driver_id`, timestamps) and, when invoked, the deterministic Evidence/Prosecutor computation (`ProsecutorReport`) for the fixture-backed dispute types.
- **P1's orchestrator** is expected to own: the `current_state`/`current_round` transition logic itself, and the sequencing of calls to P2's agents and P3's verification endpoint. Today, nothing calls anything — this integration does not exist yet.
- **P2's agents** own: `round_1_statements`, `round_2_cross_exam.targeted_questions/responses`, `judge_verdict` — none implemented.

**Missing orchestration functionality (all PLANNED):** the four undefined functions above; any HTTP-level state-transition endpoint on P3's side for the orchestrator to call after each phase; wiring `POST /api/v1/cases/{id}/verify`'s output into `round_2_cross_exam`/`prosecutor_findings`.

---

## H. P3 → P1 Deliverables (available now)

Only items verified to exist:

- The 7 endpoints in Section B — implemented, tested, running.
- OpenAPI spec at `/openapi.json` (auto-generated, always current with the code).
- `ProsecutorReport`-shaped JSON from `POST /api/v1/cases/{id}/verify` for `DISP-001`, `DISP-002`, `DISP-003` (DISP-002 has the deepest test coverage).
- The three mock case fixtures themselves: `backend/mock_data/DISP-001.json` (`ROUTE_DEVIATION`), `DISP-002.json` (`NO_SHOW_CHARGE`), `DISP-003.json` (`CLEANING_FEE`) — useful for building UI mocks against realistic data shapes.
- `shared/schemas.json` / `shared/types.ts` — the master contract, already the single source of truth for both frontend types and backend enums (confirmed field-for-field identical by direct inspection).

**Not available (do not build against these as if they existed):** any assistance-session, notification, state-transition, advocate-statement, or Judge-verdict endpoint.

---

## I. P1 → P3 Required Deliverables

P3 needs the following **before** backend integration for the orchestrated flow can proceed. None of these currently exist as agreed contracts — they are open questions, not implemented interfaces:

1. **Required frontend actions** — the exact list of user actions that must trigger a backend write (e.g. "file formal complaint" → what payload, to what endpoint).
2. **State transition expectations** — who calls the (not-yet-built) transition endpoint, and when (after Round 1? After Prosecutor audit?).
3. **Orchestrator input/output contract** — what `run_dispute_pipeline` (or its replacement) is expected to read from and write to P3's API, concretely (request/response JSON, not prose).
4. **Agent execution event format** — if P1's orchestrator emits progress events (e.g. for a live Tribunal timeline UI), the exact event schema P3 should expect to receive or store.
5. **Required API changes** — anything from Section D/E/F's "missing endpoint" columns that P1 needs P3 to build, prioritized.
6. **Notification event requirements** — payload/timing for driver-contact and rider-notification events.
7. **UI-visible vs. private data separation rules** — which fields are safe to expose to both parties vs. rider-only/driver-only (Section F).
8. **Case completion and escalation events** — what signals a case is "done" from the frontend's perspective, and what triggers human escalation UI.
9. **Demo interaction requirements** — the exact click-path for the 3 demo scenarios (see `MIRRA_P3_BACKEND_STATUS_AND_ROADMAP.md` Section N) so P3 can prioritize matching API work.

---

## J. API Gap Analysis

| Feature | Existing API | Missing API | Owner | Priority | Integration Dependency |
|---|---|---|---|---|---|
| Case creation | `POST /api/v1/cases` | Identity verification on creation (currently anyone can claim any `rider_id`/`driver_id`) | P3 | Medium | Needs a real auth decision from the team |
| Case read (party-scoped) | `GET /api/v1/cases/{id}`, `GET /api/v1/cases` | — | P3 | — | Done |
| Basic evidence store | `POST`/`GET /api/v1/cases/{id}/evidence` | Link to fixture-driven verification (two separate evidence sources today) | P3 | Medium | See roadmap doc §H |
| Evidence verification | `POST /api/v1/cases/{id}/verify` | File/image upload for `IMAGE`/`EXIF_METADATA` evidence | P3 | Low (M5 scope) | Not started |
| Assistance session | none | Full CRUD for a private assistance conversation | P1+P3 (joint) | **High** | Blocks Section D screens 3–4 entirely |
| Dynamic two-choice actions | none | Endpoint to record which of the AI's proposed actions the user picked | P1+P3 | High | Depends on assistance session existing first |
| Notifications | none | Driver-contact / rider-notification events | P1+P3 | Medium | Depends on assistance session |
| Order/trip events | none | Trip-level lookup independent of a filed case | P3 | Medium | Needed for Section D screen 1 |
| State transitions | none (current_state is set once at creation, never updated) | Orchestrator-facing transition endpoint(s) | P1 (orchestrator) + P3 (persistence) | **High** | Blocks the entire Tribunal pipeline |
| Tribunal events (advocate statements) | none | P2's agent output persisted/exposed via API | P2+P3 | High | See P2 handoff doc |
| Case resolution / Execution Router | none | Endpoint reflecting `ExecutionPayload` | P3 | Medium | Depends on Judge Agent existing (P2) |
| Human review | none | Reviewer-facing endpoint(s), role model | P3 | Medium | Needs role/auth decision |

---

## K. P1 Acceptance Checklist

- [ ] Frontend sends `X-Party-Id` on every case-scoped request, sourced from whatever identity mechanism P1 chooses (document it).
- [ ] Frontend calls `POST /api/v1/cases` exactly once per new case, handles `409` gracefully (case already exists → fetch instead).
- [ ] Frontend distinguishes `403` (not your case — do not leak details) from `404` (case truly doesn't exist / not yet verifiable) from `422` (client bug — missing header).
- [ ] Frontend renders `verified_facts`/`disputed_facts`/`missing_facts` from `POST /api/v1/cases/{id}/verify` with their `supporting_evidence` citations, for at least `DISP-002`.
- [ ] Frontend does **not** attempt to call any endpoint from the "missing" column of Section J — those don't exist yet; use static/mock data for those screens until P3 confirms the contract.
- [ ] Frontend does not assume `resolution_channel`/Judge verdict data is available — it isn't.
- [ ] Any new state-transition or assistance-session requirement is written up per Section I *before* P1 starts building against an assumed contract.

---

## L. P1 Completion/Handoff Report — what P1 must send back to P3

When P1's integration work is ready for P3 to review, P1 must provide:

1. **Branch and commit ID** actually pushed (verified via `git log`/`git status`, not assumed).
2. **Implemented screens** — list matching Section D/E/F table rows, with actual file paths.
3. **API endpoints consumed** — exact routes called, from Section B only (flag anything called that isn't in Section B — that's a bug).
4. **State-machine changes** — if P1 modifies or replaces `backend/orchestrator/state_machine.py`, document exactly what changed and why.
5. **Remaining backend dependencies** — updated version of Section J's "Missing API" column, from P1's actual experience building against it.
6. **Example requests/responses** actually exercised (curl or HTTP client output), not hypothetical ones.
7. **Test results** — exact command run and pass/fail count, same rigor as this document applies to P3's own claims.
8. **Unresolved integration questions** — anything Section A/F/I raised that the team hasn't decided yet.
