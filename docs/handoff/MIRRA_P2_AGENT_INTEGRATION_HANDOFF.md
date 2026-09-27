# MIRRA AI — P2 Multi-Agent & Judge Integration Handoff

**Audience:** P2 — Passenger Advocate, Driver Advocate, Judge Agent & Policy Reasoning
**From:** P3 — Backend Architecture & Evidence Intelligence
**Repository:** `Mirra-AI` · **Branch:** `feature/p3-backend-evidence` · **Latest commit:** `8fe1bbc` (pushed, in sync with origin)
**Status legend:** `IMPLEMENTED` (in source, executable) · `TESTED` (covered by a passing test) · `PLANNED` (described, not built) · `PROPOSED` (recommendation, needs team agreement) · `BLOCKED` · `TBD`

---

## A. Multi-Agent Architecture

角色说明（中文）：五个角色构成裁决流水线——乘客代理人（为乘客立场陈述）、司机代理人（为司机立场陈述）、检控/证据代理人（核实客观事实）、政策解释组件（判断是否符合退款条件）、法官代理人（综合裁决）。目前**只有证据核实部分是真实代码**，其余全部是设计中的角色，尚未实现。

| Role | Intended behaviour (from `workflow.md` / Handbook) | Current implementation status |
|---|---|---|
| Passenger (Rider) Advocate Agent | Extracts rider claim, sentiment, requested outcome; answers Prosecutor's Round 2 questions using only evidence already in the case record | **PLANNED — NOT IMPLEMENTED.** `backend/orchestrator/state_machine.py` calls `run_rider_advocate(context)`; this function is not defined anywhere in the repository (confirmed via `grep -rn "run_rider_advocate"` — the only hit is the call site itself). |
| Driver Advocate Agent | Same, driver side | **PLANNED — NOT IMPLEMENTED.** `run_driver_advocate` — same situation. |
| Prosecutor / Evidence Agent | "The Truth Engine" — queries GPS/EXIF/chat/fraud-history tools, issues targeted questions, emits `ProsecutorReport` | **The evidence-verification portion is IMPLEMENTED & TESTED as deterministic Python, not an LLM agent.** `run_prosecutor_audit` (the orchestrator's expected async agent call) is **not defined**; what exists instead is `backend/app/services/verification/` — a rule-based engine with no LLM/agent-framework dependency at all. There is no targeted-question/cross-examination behaviour implemented (`Round2CrossExam.targeted_questions/targeted_responses` — schema exists, nothing populates it). |
| Policy interpretation | Apply Ryde policy library to facts | **NOT IMPLEMENTED.** `backend/app/services/verification/policy.py` defines the integration point (a registry keyed by `dispute_type`) but the registry is **empty** — confirmed by reading the file: `_POLICY_REGISTRY: dict[str, PolicyThresholds] = {}`. |
| Judge Agent | Evaluate `ProsecutorReport` against policy, produce `JudgeVerdict` | **PLANNED — NOT IMPLEMENTED.** No code anywhere constructs a `JudgeVerdict`-shaped object. |

**Do not assume the real Agent pipeline is operational.** Every dispute-resolution demo today can only show the Prosecutor/Evidence stage; everything downstream of it is a schema definition, not running code.

---

## B. Current P3 Evidence Engine

Verified by direct inspection of `backend/app/services/verification/{ingestion,checks,report,policy}.py` and by running `cd backend && ./venv/Scripts/python -m pytest -q` (58 passed, 2 warnings — reproduced independently for this document).

- **Supported dispute type:** `NO_SHOW_CHARGE` is the only type with dedicated, purpose-built checks (`check_waiting_duration`, `check_policy_eligibility`, etc. all assume `trip_data.driver_arrival_time`/`cancellation_time` semantics specific to no-show). The engine *runs* against `DISP-001` (`ROUTE_DEVIATION`) and `DISP-003` (`CLEANING_FEE`) too (they're in the fixture allowlist), but several checks will report `MISSING` for those (e.g. `driver_arrival_time`/`cancellation_time` don't exist in the `ROUTE_DEVIATION`/`CLEANING_FEE` fixtures) rather than producing meaningful route-deviation or cleaning-fee-specific findings. **Route deviation and image/EXIF verification logic do not exist** — confirmed no code reads `deviation_distance_km`, `optimal_route` comparison, or `image_exif_analyses` anywhere in `checks.py`.
- **Input data format:** raw JSON matching `shared/schemas.json`'s `data_sources` shape (not the full master schema — see Section C caveat).
- **Data ingestion:** `backend/app/services/verification/ingestion.py::load_case_data(case_id)` reads `backend/mock_data/{case_id}.json` directly from disk. **Hardcoded allowlist**: only `DISP-001`, `DISP-002`, `DISP-003` are loadable — any other `case_id`, including well-formed ones, raises `FixtureAccessError` → HTTP `404`. This is a deliberate security control (fixed after a path-traversal finding), not a temporary limitation P2 should expect lifted casually — a new demo fixture requires a code change to the allowlist, not just a new file.
- **Deterministic verification functions** (`checks.py`, 9 functions, none use an LLM):
  `check_arrival_time_verification`, `check_waiting_duration`, `check_pickup_gps_consistency` (haversine distance, 50m tolerance), `check_communication_attempts`, `check_cancellation_timestamp`, `check_event_ordering`, `check_missing_gps_records` (flags >120s gaps), `check_contradictory_timestamps`, `check_policy_eligibility`.
- **Provenance tracking:** `ingestion.py::normalize_evidence()` injects synthetic `evidence_id`s (`GPS-000`, `EVT-000`, ...) into GPS points and app events that don't have one; chat messages keep their existing `message_id`. **Known limitation:** several checks fall back to a generic literal `"TRIP-DATA"` evidence_id (with `source_type: "APP_EVENT"`) when a fact is derived directly from `trip_data` fields, which have no per-field IDs — this is not a true generated/traceable reference (see Section C example — `F-VER-002`, `F-VER-003`, `F-MIS-002` all cite `"TRIP-DATA"`). Documented as open technical debt, not fixed in Milestone 2A.
- **`ProsecutorReport` generation:** `report.py::generate_prosecutor_report(data)` — takes **no policy or threshold parameter** (this was a fixed security issue; policy comes only from the registry). Runs all 9 checks plus one supplementary check (flags if no rider chat messages exist at all) and buckets results into `verified_facts`/`disputed_facts`/`missing_facts`.
- **Missing/disputed evidence:** every check function returns one of `VERIFIED`/`DISPUTED`/`MISSING` — never silently omits a finding. Malformed or missing timestamps degrade to `MISSING`/`DISPUTED` (never crash — confirmed by dedicated regression tests for malformed arrival/GPS/app-event timestamps and mixed timezone-aware/naive values).
- **Known limitations (confirmed, not hypothetical):**
  1. Policy registry is empty — `check_policy_eligibility` always returns `MISSING` today (see Section F).
  2. Reports are **stateless** — `POST /api/v1/cases/{id}/verify` recomputes from the fixture file on every call; nothing is persisted to the database. There is no "get the last report" endpoint.
  3. `Fact.confidence_level` is a hardcoded constant (`1.0` for deterministic timestamp/GPS matches, `0.8` for one-sided communication evidence) — **not calibrated from any real uncertainty signal.** Do not treat it as meaningful probabilistic confidence.
  4. `"TRIP-DATA"` evidence_id issue (above).
  5. No route-deviation or image/EXIF checks exist.

**Python call interface** (for direct use, e.g. from a test or a future agent tool wrapper):
```python
from app.services.verification.ingestion import load_case_data, normalize_evidence
from app.services.verification.report import generate_prosecutor_report

data = normalize_evidence(load_case_data("DISP-002"))
report = generate_prosecutor_report(data)  # dict, ProsecutorReport-shaped
```

**HTTP endpoint:** `POST /api/v1/cases/{case_id}/verify`, header `X-Party-Id: <rider_id|driver_id>`, no request body. See `MIRRA_P1_INTEGRATION_HANDOFF.md` Section B.7 for full contract (not duplicated here to avoid drift between documents).

---

## C. ProsecutorReport Contract

Source: `shared/schemas.json` → `$defs.ProsecutorReport`, `$defs.Fact`, `$defs.EvidenceReference`. This is the **only** contract P3's engine targets — verified field-for-field against `backend/app/schemas/verification.py`; no divergence found.

**`ProsecutorReport` — required:** `verified_facts` (array), `disputed_facts` (array), `missing_facts` (array), `report_submitted_at` (string, date-time). **Optional:** `prosecutor_summary` (string). `additionalProperties: false` in the master schema — do not add fields.

**`Fact` — required:** `fact_id`, `description`, `supporting_evidence` (array of `EvidenceReference`). **Optional:** `party_relevance` (`RIDER | DRIVER | BOTH | NEUTRAL`), `policy_clause_reference` (string), `confidence_level` (number, 0.0–1.0).

**`EvidenceReference` — required:** `evidence_id`, `source_type`, `description`. `source_type` enum (exact, 10 values): `GPS_TELEMETRY | CHAT_LOG | RECEIPT | ROUTE_TRAJECTORY | PAYMENT_RECORD | IMAGE | EXIF_METADATA | HISTORICAL_PROFILE | APP_EVENT | OTHER`.

**Timestamp format:** ISO 8601 with explicit UTC offset, e.g. `2026-09-13T08:43:00+08:00`. `report_submitted_at` is generated server-side via `datetime.now(timezone.utc).isoformat()`.

**Policy references:** `Fact.policy_clause_reference`, populated only when `policy.py`'s registry has an entry (currently: never — see Section F). When present, P3's convention is `"{source} v{version}"` (e.g. `"RYDE-NOSHOW-POLICY v1"`) — this is a P3 convention, not mandated by the schema, open to discussion.

**Confidence semantics:** `Fact.confidence_level` is **evidence-strength**, not a responsibility/fault judgment. Confirmed by code review: no check ever sets a confidence value based on which party is "more likely at fault" — it reflects how certain the *fact itself* is (today: always a hardcoded 1.0 or 0.8, see Section B limitation #3). **Do not conflate this with `JudgeVerdict.confidence_score`** (a completely different, unimplemented field — see Section E).

### Schema-valid example (real output, `DISP-002`, generated 2026-09-24 by re-running the current code — not hand-written)

```json
{
  "verified_facts": [
    {
      "fact_id": "F-VER-001",
      "description": "Driver arrival time 2026-09-13T08:43:00+08:00 is consistent across trip data, app events, GPS telemetry, and chat records.",
      "supporting_evidence": [
        {"evidence_id": "EVT-003", "source_type": "APP_EVENT", "description": "App event driver_arrived at 2026-09-13T08:43:00+08:00"},
        {"evidence_id": "GPS-004", "source_type": "GPS_TELEMETRY", "description": "GPS arrival point at 2026-09-13T08:43:00+08:00"},
        {"evidence_id": "CHAT-001", "source_type": "CHAT_LOG", "description": "First driver chat message at 2026-09-13T08:43:00+08:00"}
      ],
      "confidence_level": 1.0
    },
    {
      "fact_id": "F-VER-002",
      "description": "Actual driver waiting duration calculated as 480 seconds (8 minutes 0 seconds).",
      "supporting_evidence": [
        {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "Trip data: arrival 2026-09-13T08:43:00+08:00, cancellation 2026-09-13T08:51:00+08:00"}
      ],
      "party_relevance": "NEUTRAL",
      "confidence_level": 1.0
    }
  ],
  "disputed_facts": [],
  "missing_facts": [
    {
      "fact_id": "F-MIS-001",
      "description": "GPS coverage gaps detected during wait period: 2 gap(s) exceeding 120 seconds.",
      "supporting_evidence": [
        {"evidence_id": "GPS-004", "source_type": "GPS_TELEMETRY", "description": "GPS point at 2026-09-13T08:43:00+08:00"},
        {"evidence_id": "GPS-007", "source_type": "GPS_TELEMETRY", "description": "GPS point at 2026-09-13T08:51:00+08:00"}
      ],
      "party_relevance": "NEUTRAL",
      "confidence_level": 1.0
    },
    {
      "fact_id": "F-MIS-002",
      "description": "No authoritative policy parameters are available for dispute type 'NO_SHOW_CHARGE'; policy eligibility cannot be assessed. Actual waiting duration was 480 seconds (8 minutes).",
      "supporting_evidence": [
        {"evidence_id": "TRIP-DATA", "source_type": "APP_EVENT", "description": "Waiting duration (2026-09-13T08:43:00+08:00 to 2026-09-13T08:51:00+08:00)"}
      ],
      "party_relevance": "NEUTRAL",
      "confidence_level": 1.0
    },
    {
      "fact_id": "F-MIS-003",
      "description": "No rider communication or response is recorded in the evidence. The rider's perspective is absent from the case record.",
      "supporting_evidence": [],
      "party_relevance": "RIDER"
    }
  ],
  "prosecutor_summary": "Prosecutor audit completed for no-show cancellation dispute. 7 of 9 evidentiary checks verified. 3 item(s) missing or unresolved.",
  "report_submitted_at": "2026-09-24T17:37:03.352520+00:00"
}
```
(Full run: 7 verified, 0 disputed, 3 missing — two verified facts omitted above for brevity; full set available by running the Python snippet in Section B.)

---

## D. Agent Input and Output Contracts

**All contracts in this section are `PROPOSED` unless explicitly marked otherwise** — none of them exist in code today. P2 should build against `shared/schemas.json`'s existing types (`AgentStatement`, `TargetedQuestion`, `TargetedResponse`, `JudgeVerdict`) rather than inventing parallel shapes, since those are already the agreed master contract.

| Agent | Input (proposed) | Output (existing schema type) | Required evidence references | Validation | Failure handling |
|---|---|---|---|---|---|
| Rider Advocate | Frozen `data_sources` for the case (same shape P3's engine consumes) + `dispute_type` | `AgentStatement` (`shared/schemas.json`) — `party: "RIDER"`, `agent_role: "RIDER_ADVOCATE"`, `argument_summary`, `requested_outcome`, `requested_amount`, `evidence_references[]`, `submitted_at` | `evidence_references` must cite `evidence_id`s that actually exist in the case's evidence (P3's `normalize_evidence()` output, or the DB `EvidenceRecord` table — **these are two different sources today, unresolved**, see roadmap doc §H) | `requested_outcome` must be one of the 6 enum values; `argument_summary` 10–2000 chars per schema | PLANNED — not specified. Recommend: on agent failure/timeout, do not silently omit the statement — mark case as `MISSING` rider input for the Judge to see |
| Driver Advocate | Same shape, driver side | `AgentStatement`, `party: "DRIVER"`, `agent_role: "DRIVER_ADVOCATE"` | same | same | same |
| Prosecutor / Evidence Agent | **This is what P3 already implements deterministically** — no LLM call needed for the checks that exist. If P2 wants an LLM-based prosecutor for cross-examination (`TargetedQuestion`/`TargetedResponse`), input would be `ProsecutorReport` + advocate statements | `ProsecutorReport` (IMPLEMENTED, Section C) + `TargetedQuestion[]`/`TargetedResponse[]` (schema exists, generation logic PLANNED) | n/a — this agent produces evidence references, doesn't consume them | Schema in Section C | Already handled — deterministic checks never throw; see Section B |
| Judge Agent | `ProsecutorReport` + both `AgentStatement`s + policy source (Section F) | `JudgeVerdict` (`shared/schemas.json`) | `verified_fact_references[]` should cite `Fact.fact_id`s from the actual `ProsecutorReport` | See Section E | PLANNED — must define what happens if `ProsecutorReport` has no verified facts, or if advocate statements are missing |

**P2 should not create incompatible parallel schemas** for any of the above — `AgentStatement`, `TargetedQuestion`, `TargetedResponse`, `Fact`, `EvidenceReference`, `JudgeVerdict`, `RecommendedAction`, `ExecutionPayload` are all already defined in `shared/schemas.json`. If a field is missing for what P2 needs, that's a "propose a schema change to the team" conversation, not a local workaround.

---

## E. Judge Agent Responsibilities

Per `shared/schemas.json` → `$defs.JudgeVerdict` (exact contract, not invented) and the instructions given for this document:

The Judge Agent should:
- Review both parties' `AgentStatement`s (`round_1_statements`).
- Use `ProsecutorReport.verified_facts` (not disputed/missing facts) as its primary factual basis.
- Identify unresolved facts (`disputed_facts`/`missing_facts`) and factor them into `confidence_score`, not ignore them.
- Apply an approved, versioned policy source — reflected via `verified_fact_references`/`policy_clauses_applied` pointing back at facts that actually carry a `policy_clause_reference` (Section C/F). **Today, no fact will ever carry a policy reference because the registry is empty** — the Judge cannot yet cite policy for `NO_SHOW_CHARGE` cases.
- Produce a structured `JudgeVerdict`: `ruling_type` (`APPROVED | PARTIAL_REFUND | REJECTED | ESCALATED`), `confidence_score` (0.0–1.0), `reasoning_summary`, `recommended_action` (`RecommendedAction` object), `explanations.{explanation_for_rider, explanation_for_driver}`, `execution_payload` (`ExecutionPayload`), `deliberated_at`.
- Identify when human review is required — reflected in `ruling_type: "ESCALATED"` and `execution_payload.execution_status: "PENDING_HUMAN_APPROVAL"`.

**This entire object type exists only as a schema definition.** No code anywhere constructs a `JudgeVerdict`. **Do not invent an alternative verdict format** — the master schema is authoritative; if it's insufficient, raise a schema-change proposal to the team rather than diverging.

**Do not use historical risk flags alone to determine responsibility.** `HistoricalProfile.bad_faith_flag`/`risk_score` exist in the mock data (e.g. `DISP-002`'s rider `R-7823` has `bad_faith_flag: true, risk_score: 0.65`; `DISP-003`'s driver `D-9012` has `bad_faith_flag: true, risk_score: 0.78`) and are tempting shortcuts, but the Handbook's design intent (and the schema's separation of `historical_profiles` from `verified_facts`) is that responsibility comes from verified evidence, with historical risk as at most a contributing signal for escalation/fraud checks — not a substitute for evidence-based fact-finding.

**Do not treat evidence confidence as equivalent to verdict confidence.** `Fact.confidence_level` (Section C) is per-fact evidence strength (currently hardcoded, see B.3); `JudgeVerdict.confidence_score` is a holistic ruling confidence that should integrate *all* facts' states (verified/disputed/missing) plus policy applicability. These are different numbers with different meanings — do not pipe one directly into the other.

---

## F. Policy Source and Versioning

**Actual current status (verified by reading `backend/app/services/verification/policy.py` directly):**
```python
@dataclass(frozen=True)
class PolicyThresholds:
    free_wait_period_seconds: int
    no_show_threshold_seconds: int
    source: str
    version: str

_POLICY_REGISTRY: dict[str, PolicyThresholds] = {}  # EMPTY

def get_policy_params(dispute_type: str | None) -> PolicyThresholds | None:
    if not dispute_type:
        return None
    return _POLICY_REGISTRY.get(dispute_type)
```
The registry is **empty for every `dispute_type`.** This was a deliberate decision during the Milestone 2A security fix round: no invented Ryde policy numbers were hardcoded. **Consequence: automatic no-show-fee eligibility cannot currently be evaluated for any case** — `check_policy_eligibility` always returns `status: "MISSING"` (confirmed in the Section C example, `F-MIS-002`).

**What P2 must provide before this can change:**
1. An **approved demo policy dataset** — explicitly a test/demo policy, not claimed as Ryde's real policy, per the instruction constraint "do not invent official Ryde policies."
2. `source` and `version` strings (e.g. `"MIRRA-DEMO-POLICY"`, `"1"`) — these get echoed into `Fact.policy_clause_reference` and the fact description verbatim when applied (Section C convention).
3. Which `dispute_type`(s) it applies to (the registry is keyed by dispute type — currently only `NO_SHOW_CHARGE` has matching check logic ready to consume `free_wait_period_seconds`/`no_show_threshold_seconds`).
4. The policy's conditions in a form P3 can encode as a `PolicyThresholds` dataclass (or an extended version of it, subject to team agreement — do not assume the current two-field shape is final).
5. What evidence is required for the policy to apply (e.g. does it require GPS confirmation of arrival, or is trip_data's timestamp sufficient?).
6. Which resolution actions are permitted under this policy (maps to `RecommendedAction.action_type`).
7. Conditions under which this policy's application should be overridden by human review regardless of the computed eligibility.

If P2 supplies a synthetic demo policy, it must be **explicitly labeled as a proposed test policy requiring team approval** before P3 wires it into `_POLICY_REGISTRY` — this is a product/legal-adjacent decision, not a unilateral P2 or P3 call.

---

## G. Confidence and Execution Routing

Per `workflow.md` ("Phase 4: Judge Deliberation & Execution Routing") and `shared/schemas.json`:

- **`FULLY_AUTOMATED`** execution is triggered when `confidence_score >= 0.75` **AND** `safety_threat_detected == false` **AND** `fraud_risk_level != "HIGH"`.
- **`ESCALATED_HUMAN_REVIEW`** otherwise (low confidence, safety flag, or high fraud risk). Missing crucial evidence is explicitly documented in `workflow.md` as lowering `confidence_score` rather than being an independent trigger — it escalates *through* the confidence threshold, not around it.

**This `0.75` threshold is a project default documented in `workflow.md` and mirrored in `shared/schemas.json`'s `JudgeVerdict.confidence_score` description ("Scores >= 0.75 qualify for FULLY_AUTOMATED execution") and `EscalationProtocol.escalation_threshold_confidence` (default `0.75`). It is NOT confirmed as an official Tencent/Ryde competition requirement — it is the team's own documented default in this repository.** Treat it as the current project default, changeable by team agreement, not as an externally-mandated number.

**Distinct concepts — do not conflate:**
- **Fact-level confidence** (`Fact.confidence_level`) — evidence strength, IMPLEMENTED (hardcoded today, Section B.3).
- **Evidence completeness** — whether `missing_facts` is empty; IMPLEMENTED as a byproduct of the checks (a case can be inspected for how many `missing_facts` it has).
- **Judge verdict confidence** (`JudgeVerdict.confidence_score`) — NOT IMPLEMENTED, P2-owned.
- **Fraud risk** (`FraudAssessment.fraud_risk_score`, `EscalationProtocol.fraud_risk_level`) — schema exists, **no code computes it**. `HistoricalProfile.risk_score` exists in mock data but is not consumed by any fraud-scoring logic today.
- **Safety risk** (`EscalationProtocol.safety_threat_detected`, `ChatMessage.safety_threat_keywords`) — schema exists; mock data has empty `safety_threat_keywords: []` everywhere; no keyword-detection code exists.
- **Policy eligibility** (`check_policy_eligibility`'s `VERIFIED`/`DISPUTED`/`MISSING`) — IMPLEMENTED, currently always `MISSING` (Section F).

**Do not implement an automated refund based solely on a single confidence score.** The threshold above is a three-way AND (confidence + safety + fraud), and per `workflow.md`, missing evidence must already have lowered confidence before that check even applies — a single number in isolation is not sufficient per the documented design.

**What P3's future Execution Router needs from the Judge Agent** (for `MIRRA_P3_BACKEND_STATUS_AND_ROADMAP.md` Milestone M6): a complete `JudgeVerdict` object as defined in the schema, with `recommended_action`, `confidence_score`, and enough of `execution_payload` populated to decide `FULLY_AUTOMATED` vs. `PENDING_HUMAN_APPROVAL` deterministically — P3 should not have to re-derive the three-way AND itself from raw agent internals.

---

## H. Agent Workflow / Tribunal Rounds

Per `workflow.md`'s "End-to-End 4-Phase Workflow Specification" (the authoritative source — confirmed no contradicting version exists elsewhere):

```
Phase 1: INIT_CLAIM              — case ingestion, evidence frozen
Phase 2: ROUND_1_PLEADINGS       — Rider Advocate + Driver Advocate submit PleadingCard/AgentStatement
Phase 3: ROUND_2_PROSECUTOR_AUDIT — tool-based verification (P3's engine) + targeted cross-examination
Phase 4: JUDGE_DELIBERATION → EXECUTION_ROUTER
```

**The protocol is fixed at exactly 2 advocate rounds. Round 3 was explicitly removed** — `workflow.md`'s own "Design Decision: Why There Is No Round 3" section explains: since evidence is frozen at intake and advocates never introduce new facts, a third round could never trigger new information, so it was cut along with the "Dynamic Stopping Engine" and `is_round3_triggered` flag. **Do not reintroduce Round 3 logic.** Note: `backend/orchestrator/state_machine.py`'s stub still has a leftover `round_3_rebuttal` dict key in its in-memory context — this is stale scaffolding from before the design decision, not a requirement to honor.

**Structured cross-examination support that exists in the contract:** `Round2CrossExam.targeted_questions[]` (`TargetedQuestion`: `question_id`, `directed_to`, `question_text`, `evidence_context`, `category`, `asked_at`) and `targeted_responses[]` (`TargetedResponse`). **No code generates or consumes these today** — P3's Prosecutor engine produces `Fact`s directly without an intermediate question/response exchange. If P2's Prosecutor/cross-examination design wants to use this, it's building on schema that exists but is currently unpopulated by anything.

**New evidence triggering re-verification:** per `workflow.md`, evidence is **frozen at `INIT_CLAIM`** — "agents never ask the Rider or Driver for additional evidence during the debate." This means the intended design is that P3's `POST /api/v1/cases/{id}/verify` should be idempotent/re-runnable against the same frozen evidence set (confirmed: it is — it recomputes from the same fixture file every call, no state accumulates). If the product later needs an "additional evidence submitted → re-run Judge" flow outside the frozen-evidence model, that's a deviation from the documented design requiring explicit team agreement, not an assumption to build against silently.

---

## I. Missing Evidence and Contradictions

Expected agent behaviour, cross-referenced against what P3's engine already does at the evidence layer:

| Situation | P3 engine behaviour today (IMPLEMENTED) | Expected Agent/Judge behaviour (PLANNED) |
|---|---|---|
| GPS evidence missing | `check_missing_gps_records` / `check_pickup_gps_consistency` return `MISSING` with a description | Judge should factor `MISSING` facts into lower confidence, not treat absence as neutral |
| Timestamps conflict | `check_arrival_time_verification`, `check_cancellation_timestamp`, `check_event_ordering`, `check_contradictory_timestamps` all return `DISPUTED` with both conflicting values cited | Judge should not resolve a `DISPUTED` fact by guessing — either it's resolved by cross-examination (not yet built) or it lowers confidence and may trigger escalation |
| Party statements disagree | Not evaluated by P3's engine at all (it only sees objective evidence, not `AgentStatement`s) | Advocate/Judge layer's responsibility entirely — PLANNED |
| Photo metadata unavailable | Not applicable — no EXIF/image checks exist in P3's engine (Section B) | Out of scope until M5 (roadmap doc) |
| Policy conditions unknown | `check_policy_eligibility` returns `MISSING` (Section F) | Judge must not silently substitute a guessed threshold — should escalate or explicitly state policy could not be applied |
| Evidence insufficient for automatic decision | Reflected as a non-empty `missing_facts` array | Should push toward `ESCALATED` per Section G's threshold logic, not toward a forced `APPROVED`/`REJECTED` |

**When to request additional evidence vs. escalate:** per `workflow.md`, agents do **not** request additional evidence mid-debate (evidence is frozen). So the only two outcomes for insufficient evidence are: (a) the Judge rules with appropriately lowered confidence based on what exists, or (b) escalates to human review. There is no third "ask for more evidence" agent behaviour in the documented design — if P2's design needs one, it's a deviation to raise with the team, not an assumption.

---

## J. P3 → P2 Deliverables (verified available now)

- Evidence verification functions — `backend/app/services/verification/checks.py`, 9 functions, all IMPLEMENTED & TESTED.
- Structured `ProsecutorReport` generation — `report.py::generate_prosecutor_report(data)`, IMPLEMENTED & TESTED.
- HTTP endpoint — `POST /api/v1/cases/{id}/verify`, IMPLEMENTED & TESTED.
- `DISP-002` fixture (`NO_SHOW_CHARGE`) — the only fixture with per-check test assertions; `DISP-001` (`ROUTE_DEVIATION`) and `DISP-003` (`CLEANING_FEE`) fixtures exist and load, but expect mostly `MISSING` facts from them today (their dispute-specific fields aren't handled by any check).
- A real, schema-valid `ProsecutorReport` example (Section C) — freshly generated for this document, not hand-written.

---

## K. P2 → P3 Required Deliverables (critical section)

| # | Item | Currently exists? | Notes |
|---|---|---|---|
| 1 | Agent input/output contracts (concrete JSON, not prose) | NO | Section D is P3's proposal starting point |
| 2 | Passenger Advocate output example | NO | Must conform to `AgentStatement` |
| 3 | Driver Advocate output example | NO | Must conform to `AgentStatement` |
| 4 | `JudgeVerdict` JSON example | NO | Must conform to the exact schema in Section E |
| 5 | Approved policy dataset + version | NO | Section F — must be explicitly labeled demo/proposed if synthetic |
| 6 | Model/provider and invocation interface | TBD | Not specified anywhere in the repo; P3's backend is explicitly LLM-agnostic (`app/main.py`'s own description: "Evidence/Judge agents integrate through this HTTP API, not by importing this codebase") — P2's agent framework choice doesn't need to match P3's stack, but the *interface* needs defining |
| 7 | Agent error and timeout behaviour | NO | Needed before orchestrator integration (see P1 handoff doc §G) |
| 8 | Confidence interpretation | PARTIAL | Section E/G define the *distinctions* that must be respected; the actual computation is P2's to design |
| 9 | Human escalation triggers | PARTIAL | The 3-way AND threshold exists in docs (Section G) but nothing computes `fraud_risk_level`/`safety_threat_detected` yet — P2 must decide who computes these |
| 10 | New-evidence re-evaluation protocol | NO | Section H notes this deviates from the documented frozen-evidence design if introduced — needs explicit team agreement first |

---

## L. Integration Tests (required, not yet written — P2/P3 joint responsibility once agent code exists)

- Original `DISP-002` (regression baseline — already covered on the evidence side, needs Advocate/Judge coverage added).
- Contradictory evidence (P3 already has `DISPUTED`-producing fixtures via test mutations, e.g. `test_cancellation_event_out_of_order` — Judge-side test needed to confirm it doesn't get ruled `APPROVED` with high confidence).
- Missing evidence (same — `test_missing_gps_records_severe` exists at evidence layer; Judge-side equivalent needed).
- Unknown policy (trivially true today for every case — `test_policy_eligibility_unresolved_without_backend_policy` exists; Judge must be tested for correct behaviour when it receives a `MISSING` policy fact).
- High-confidence eligible case (requires a populated policy registry — currently impossible to construct without a demo policy from P2).
- Low-confidence case.
- New evidence changing findings — only testable once/if the re-evaluation protocol (Section I) is agreed upon.
- Invalid Judge output (malformed/incomplete `JudgeVerdict` — P3 needs to know how strictly to validate before trusting a verdict for execution).
- Human escalation path end-to-end.

**Do not hardcode expected rulings into Agent inference inputs** — i.e. don't build a test fixture where the "correct" verdict is baked into the data the agent reads (this was explicitly checked for and confirmed absent from P3's evidence fixtures during the Milestone 2A review: `DISP-002.json` contains no `judge_verdict`/`prosecutor_findings` keys at all).

---

## M. P2 Completion/Handoff Report — what P2 must send back to P3

1. **Branch and commit ID** (verified via `git log`, not assumed).
2. **Agent implementation paths** — exact files, e.g. if `backend/orchestrator/state_machine.py`'s undefined functions get implemented, where.
3. **Invocation interface** — how P3 (or the orchestrator) is meant to call each agent.
4. **JSON input/output examples** — real, generated output (per this document's own standard in Section C), not hand-written samples.
5. **Model/provider configuration** — whatever P2 chooses, documented so P3 knows it's not a P3 dependency to install.
6. **Policy dataset and version** — per Section F, explicitly labeled if synthetic.
7. **Test results** — exact command + pass/fail count.
8. **Integration blockers** — anything from Section K still unresolved.
9. **Pending P3 API requirements** — anything P2 discovers is needed from P3 while building (e.g. a way to persist/retrieve a `ProsecutorReport`, currently stateless per Section B).
