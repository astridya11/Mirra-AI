## 🏛️ System Architecture & Agent Roles

```
                      +---------------------------------+
                      |     INIT_CLAIM / Case Ingestion  |
                      |   (Evidence Frozen at Filing)   |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |    ROUND 1: Advocate Pleadings  |
                      |  (Rider Agent & Driver Agent)   |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |  ROUND 2: Prosecutor Audit      |
                      |  (Telemetry/EXIF/Fraud Checks)  |
                      +----------------+----------------+
                                       |
                   +-------------------+-------------------+
                   | Targeted Questions & Responses        |
                   | (single pass, no follow-up)           |
                   +-------------------+-------------------+
                                       |
                                       v
                      +---------------------------------+
                      |  ProsecutorReport Emission      |
                      |  (Verified/Disputed/Missing     |
                      |   Facts + Summary)              |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |  POLICY_CONSULTATION            |
                      |  (PolicyConsultantAgent)                  |
                      |  Clause Retrieval & Precedent   |
                      |  Match -> Suggested Ruling      |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |  JUDGE_DELIBERATION             |
                      |  (Weighs Prosecutor Facts vs.   |
                      |   Policy Suggestion -> Verdict) |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |  EXECUTION_ROUTER Gate          |
                      +--------+----------------+-------+
                               |                |
             +-----------------+                +-----------------+
             |                                                    |
             v                                                    v
+-----------------------------+                        +--------------------------------------------------+
| Path A: FULLY_AUTOMATED     |                        | Path B: HUMAN_ESCALATION                         |
| (High Confidence / Standard)|                        | (Safety/Fraud/Low Conf./                         |
|                             |                        |   Missing crucial evidence/Exceed amt. threshold/|
|                             |                        |   Acc related penalty/Human requested)           |
| -> Instant API Refund       |                        | -> Human 1-Click Dashboard                       |
+-----------------------------+                        +-------------------------+------------------------+
                                                                                 |
                                                                  Human decision differs
                                                                  from Judge's ruling?
                                                                                 |
                                                                                 v
                                                                  +---------------------------+
                                                                  |   PolicyConsultantAgent Knowledge   |
                                                                  |   Base Update (Feedback)  |
                                                                  +---------------------------+
```

### Agent Roles & Responsibilities

| Role | Agent Identifier | Primary Functions |
| :--- | :--- | :--- |
| **Rider Advocate** | `RiderAgent` | Extracts passenger claim, sentiment, requested refund amount, and initial supporting narrative. Answers the Prosecutor's targeted questions in Round 2, using only evidence already in the case record. |
| **Driver Advocate** | `DriverAgent` | Extracts driver response, situational context (e.g., road obstruction, passenger behavior), and counter-evidence. Answers the Prosecutor's targeted questions in Round 2, using only evidence already in the case record. |
| **Prosecutor / Investigator** | `ProsecutorAgent` | **The Truth Engine.** Queries external APIs (GPS telemetry, traffic events, EXIF metadata, chat logs, fraud history) to construct an immutable fact sheet. Issues targeted questions and emits the final `ProsecutorReport` (verified facts, disputed facts, missing facts, summary). Does not emit its own confidence score. |
| **Policy Advisor** | `PolicyConsultantAgent` | **The Legal Reference Engine.** Runs as its own state-machine phase, `POLICY_CONSULTATION`, which `StateEngine` triggers automatically as soon as `ROUND_2_PROSECUTOR_AUDIT` completes and before `JUDGE_DELIBERATION` begins. Takes the `ProsecutorReport`'s verified facts and summary, retrieves the relevant clauses from the Ryde Policy library and matching past precedents, and emits a `PolicySuggestion` (suggested `ruling_type` / `recommended_action`, with supporting clauses/precedents cited) for `JudgeAgent` to weigh. After `EXECUTION_ROUTER` resolves a human-escalated case, if the human reviewer's decision differs from the Judge's ruling, `PolicyConsultantAgent` updates its knowledge base (retrieval index / precedent store) with the corrected outcome so future cases benefit from it. |
| **Adjudicator / Judge** | `JudgeAgent` | Receives the `ProsecutorReport` and the `PolicySuggestion` as inputs (rather than invoking `PolicyConsultantAgent` itself) and weighs the Prosecutor's verified facts against the Policy suggestion to produce the final `ruling_type`, `confidence_score`, `recommended_action`, and natural language explanations. `JudgeAgent` is the sole source of `confidence_score` in the pipeline. |
| **Workflow Orchestrator** | `StateEngine` | (Powered by WorkBuddy / CodeBuddy backend) Controls state transitions across all five phases, enforces the fixed 2-round limit, and controls execution routing gates. |

---

## 🔄 End-to-End 5-Phase Workflow Specification

The dispute is handled entirely by agents in the background once a Rider or Driver files it. The protocol runs **exactly two advocate rounds** (Round 1: Pleadings, Round 2: Prosecutor Audit), followed by a Policy Agent consultation, judge deliberation, and execution routing — five phases in a strict pipeline, each with a single hand-off to the next. The evidence set is fixed when the dispute is filed: agents never ask the Rider or Driver for additional evidence during the debate.

### Phase 1: Case Ingestion (`INIT_CLAIM`)
- User (Rider or Driver) submits a dispute via Miora UI.
- Context initialization: System generates `case_id`, loads historical user profiles, and attaches raw telemetry.
- All evidence (telemetry, chat log, payment records, photos, historical profiles) is collected and frozen at this point.

### Phase 2: First-Round Advocate Pleadings (`ROUND_1_PLEADINGS`)
1. **Rider Advocate Submission**: Generates structured `PleadingCard` detailing initial narrative and requested financial outcome.
2. **Driver Advocate Submission**: Generates structured `PleadingCard` with driver counter-statement.
3. Both statements are normalized into JSON schema and added to `DisputeContext`.

### Phase 3: Prosecutor Audit & Cross-Examination (`ROUND_2_PROSECUTOR_AUDIT`)
1. **Tool Ingestion & Verification**:
   - **GPS Analysis**: Compares actual vs. optimal route, measures detour distance and stationary delays.
   - **Multimodal Photo/EXIF Verification**: Validates photo metadata (`timestamp`, `gps_location`), checks for AI generation/tampering, and classifies stain/damage type.
   - **Chat & Sentiment Log**: Scans transcript for verbal agreements, threats, or harassment keywords.
   - **Fraud & Bad-Faith Check**: Calculates `fraud_risk_score` based on historical claim frequency and recycled evidence detection.
2. **Targeted Questioning**:
   - `ProsecutorAgent` identifies gaps/discrepancies and issues specific, targeted queries to `RiderAgent` or `DriverAgent`.
   - Advocates submit **one** targeted response per question, based solely on the existing case record. Questions are asked once; there are no follow-up questions or further rebuttals.
3. **Prosecutor Report Emission**:
   - Once Round 2 is completed (`round2_completed = true`), `ProsecutorAgent` generates the immutable lists of `verified_facts`, `disputed_facts`, and `missing_facts`, plus a case summary.
   - The fact record is locked. `StateEngine` advances to `POLICY_CONSULTATION`.

### Phase 4: Policy Consultation (`POLICY_CONSULTATION`)
1. `StateEngine` triggers `PolicyConsultantAgent` automatically as soon as `ROUND_2_PROSECUTOR_AUDIT` completes — this is a pipeline hand-off, not a call made by `JudgeAgent`.
2. `PolicyConsultantAgent` receives a `PolicyConsultationRequest` carrying the Prosecutor's `verified_fact_ids` and `prosecutor_summary`.
3. `PolicyConsultantAgent` retrieves the relevant clauses from the Ryde Policy library and any matching past precedents.
4. `PolicyConsultantAgent` emits a `PolicySuggestion`: a suggested `ruling_type` and `recommended_action`, with the supporting clauses/precedents cited.
5. `StateEngine` advances to `JUDGE_DELIBERATION`, handing `JudgeAgent` both the `ProsecutorReport` and the `PolicySuggestion`.

### Phase 5: Judge Deliberation & Execution Routing (`JUDGE_DELIBERATION` & `EXECUTION_ROUTER`)
1. **Verdict Generation**: `JudgeAgent` weighs the Prosecutor's verified facts against `PolicyConsultantAgent`'s suggestion and produces the final:
   - `ruling_type` (`APPROVED`, `PARTIAL_REFUND`, `REJECTED`, `ESCALATED`)
   - `confidence_score` (0.00 to 1.00) — produced solely by `JudgeAgent`, after weighing the Policy suggestion
   - `recommended_action` (e.g., refund SGD $3.25)
   - Client-facing natural language summaries for both parties, citing the policy clauses `PolicyConsultantAgent` surfaced.
2. **Execution Gate Evaluation**:
   - **Automatic Execution (`FULLY_AUTOMATED`)**: Triggered when `confidence_score >= 0.75`, `safety_threat_detected == false`, and `fraud_risk_level != HIGH`. Executes API refund instantly.
   - **Human Escalation (`ESCALATED_HUMAN_REVIEW`)**: Triggered when safety issues are flagged, fraud score is elevated, or confidence is low. Missing crucial evidence lowers the `confidence_score`, so it is covered by the confidence threshold. Routes full case summary card (including the Judge's ruling and the Policy clauses it relied on) to a human reviewer for 1-click confirmation.
3. **Policy Knowledge Base Feedback Loop**: For cases routed to human review, if the human reviewer's final decision **overrides** `JudgeAgent`'s ruling (different `ruling_type` and/or `recommended_action`), `PolicyConsultantAgent` updates its knowledge base with the human-corrected outcome — indexing it as a new precedent and, where applicable, flagging the policy clause interpretation that led to the mismatch. This keeps future clause retrieval and ruling suggestions aligned with real human adjudication. Cases resolved via `FULLY_AUTOMATED` execution, or human-escalated cases where the reviewer confirms the Judge's ruling as-is, do not trigger a knowledge base update.

---

## 📝 Design Decisions

### Why There Is No Round 3
- The original Round 3 was a conditional rebuttal that only ran if Round 2 produced **substantive new evidence**.
- Agents run in the background as soon as a dispute is filed, and they do not request new evidence from the Rider or Driver during the debate. The evidence set is therefore fixed at ingestion, so Round 2 responses can never introduce new facts.
- Without new facts, a further rebuttal round would only repeat arguments, so Round 3 could never trigger. Removing it also removes the Dynamic Stopping Engine and the `is_round3_triggered` flag, leaving a shorter and more predictable state machine.
- All facts come from the Prosecutor's tool-based verification of the frozen evidence. Anything the Prosecutor cannot establish is passed to the Judge as a `disputed_fact` or `missing_fact`, which lowers confidence and routes the case to human review.

### Why Policy Consultation Is Its Own Phase
- `PolicyConsultantAgent` is triggered directly by `StateEngine` right after `ROUND_2_PROSECUTOR_AUDIT`, rather than being called out to by `JudgeAgent` mid-deliberation.
- This gives `POLICY_CONSULTATION` a visible, trackable state of its own — useful for the Miora Mock Court UI to show the case progressing through clause retrieval before the Judge weighs in — and keeps `JudgeAgent`'s job strictly to weighing the `ProsecutorReport` and `PolicySuggestion` it's handed, rather than also orchestrating a sub-call.
- `confidence_score` is produced once, by `JudgeAgent`, after both inputs are in hand — neither `ProsecutorAgent` nor `PolicyConsultantAgent` emit their own top-level confidence score (`PolicyConsultantAgent`'s `policy_confidence` on its `PolicySuggestion` reflects only its confidence in the clause match, not the case outcome).

---

## 👥 Team Role Assignment & Execution Responsibilities

- **P1: Workflow & UI Orchestrator**
  - Owns `workflow.md`, state machine orchestration logic, WorkBuddy DAG graph, and Miora Mock Court UI integration.
- **P2: Agent Architect & Decision Engine Lead**
  - Owns prompts/LLM logic for `RiderAgent`, `DriverAgent`, `JudgeAgent`, and `PolicyConsultantAgent`, plus the Ryde Policy RAG integration and its human-override feedback loop.
- **P3: Data, Safety & Multimodal Lead**
  - Owns `ProsecutorAgent` tool execution, GPS detour algorithms, EXIF/Multimodal image verification, and Fraud Risk Agent.