## 🏛️ System Architecture & Agent Roles

```
                      +---------------------------------+
                      |     INIT_CLAIM / Case Ingestion  |
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
                   +-------------------+-------------------+
                                       |
                                       v
                      +---------------------------------+
                      |  ProsecutorReport Emission      |
                      |  (Fact Record Locked)           |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |  JUDGE_DELIBERATION             |
                      |  (Policy Matching & Verdict)    |
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
+--------------------------+                        +---------------------------+
| Path A: FULLY_AUTOMATED  |                        | Path B: HUMAN_ESCALATION  |
| (High Confidence / Standard)|                      | (Safety/Fraud/Low Conf.)  |
| -> Instant API Refund    |                        | -> Human 1-Click Dashboard|
+--------------------------+                        +---------------------------+
```

### Agent Roles & Responsibilities

| Role | Agent Identifier | Primary Functions |
| :--- | :--- | :--- |
| **Rider Advocate** | `RiderAgent` | Extracts passenger claim, sentiment, requested refund amount, and initial supporting narrative. Answers the Prosecutor's targeted questions in Round 2, using only evidence already in the case record. |
| **Driver Advocate** | `DriverAgent` | Extracts driver response, situational context (e.g., road obstruction, passenger behavior), and counter-evidence. Answers the Prosecutor's targeted questions in Round 2, using only evidence already in the case record. |
| **Prosecutor / Investigator** | `ProsecutorAgent` | **The Truth Engine.** Queries external APIs (GPS telemetry, traffic events, EXIF metadata, chat logs, fraud history) to construct an immutable fact sheet. Issues targeted questions and emits the final `ProsecutorReport`. |
| **Adjudicator / Judge** | `JudgeAgent` | Evaluates verified facts against Ryde's official policy library and past precedents. Generates ruling, confidence score, and natural language explanations. |
| **Workflow Orchestrator** | `StateEngine` | (Powered by WorkBuddy / CodeBuddy backend) Controls state transitions, enforces the fixed 2-round limit, and controls execution routing gates. |

---

## 🔄 End-to-End 4-Phase Workflow Specification

The dispute is handled entirely by agents in the background once a Rider or Driver files it. The protocol runs **exactly two advocate rounds** (Round 1: Pleadings, Round 2: Prosecutor Audit), followed by judge deliberation and execution routing. The evidence set is fixed when the dispute is filed: agents never ask the Rider or Driver for additional evidence during the debate.

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
   - Once Round 2 is completed (`round2_completed = true`), `ProsecutorAgent` generates the immutable lists of `verified_facts`, `disputed_facts`, and `missing_facts`.
   - The fact record is locked and handed directly to `JudgeAgent`. `StateEngine` advances to `JUDGE_DELIBERATION`.

### Phase 4: Judge Deliberation & Execution Routing (`JUDGE_DELIBERATION` & `EXECUTION_ROUTER`)
1. `JudgeAgent` ingests the `ProsecutorReport` and evaluates against Ryde Policy.
2. Generates:
   - `ruling_type` (`APPROVED`, `PARTIAL_REFUND`, `REJECTED`, `ESCALATED`)
   - `confidence_score` (0.00 to 1.00)
   - `recommended_action` (e.g., refund SGD $3.25)
   - Client-facing natural language summaries for both parties.
3. **Execution Gate Evaluation**:
   - **Automatic Execution (`FULLY_AUTOMATED`)**: Triggered when `confidence_score >= 0.75`, `safety_threat_detected == false`, and `fraud_risk_level != HIGH`. Executes API refund instantly.
   - **Human Escalation (`ESCALATED_HUMAN_REVIEW`)**: Triggered when safety issues are flagged, fraud score is elevated, or confidence is low. Missing crucial evidence lowers the `confidence_score`, so it is covered by the confidence threshold. Routes full case summary card to human reviewer for 1-click confirmation.

---

## 📝 Design Decision: Why There Is No Round 3

- The original Round 3 was a conditional rebuttal that only ran if Round 2 produced **substantive new evidence**.
- Agents run in the background as soon as a dispute is filed, and they do not request new evidence from the Rider or Driver during the debate. The evidence set is therefore fixed at ingestion, so Round 2 responses can never introduce new facts.
- Without new facts, a further rebuttal round would only repeat arguments, so Round 3 could never trigger. Removing it also removes the Dynamic Stopping Engine and the `is_round3_triggered` flag, leaving a shorter and more predictable state machine.
- All facts come from the Prosecutor's tool-based verification of the frozen evidence. Anything the Prosecutor cannot establish is passed to the Judge as a `disputed_fact` or `missing_fact`, which lowers confidence and routes the case to human review.

---

## 👥 Team Role Assignment & Execution Responsibilities

- **P1: Workflow & UI Orchestrator**
  - Owns `workflow.md`, state machine orchestration logic, WorkBuddy DAG graph, and Miora Mock Court UI integration.
- **P2: Agent Architect & Decision Engine Lead**
  - Owns prompts/LLM logic for `RiderAgent`, `DriverAgent`, and `JudgeAgent`, plus Ryde Policy RAG integration.
- **P3: Data, Safety & Multimodal Lead**
  - Owns `ProsecutorAgent` tool execution, GPS detour algorithms, EXIF/Multimodal image verification, and Fraud Risk Agent.