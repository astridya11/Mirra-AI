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
                      |  ROUND 3: Conditional Rebuttal   |
                      |  (Dynamic Stopping Engine Gate) |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |  ROUND 4: Judge Deliberation    |
                      |  (Policy Matching & Verdict)    |
                      +----------------+----------------+
                                       |
                                       v
                      +---------------------------------+
                      |  ROUND 5: Execution Router Gate |
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
| **Rider Advocate** | `RiderAgent` | Extracts passenger claim, sentiment, requested refund amount, and initial supporting narrative. |
| **Driver Advocate** | `DriverAgent` | Extracts driver response, situational context (e.g., road obstruction, passenger behavior), and counter-evidence. |
| **Prosecutor / Investigator** | `ProsecutorAgent` | **The Truth Engine.** Queries external APIs (GPS telemetry, traffic events, EXIF metadata, chat logs, fraud history) to construct an immutable fact sheet. Issues targeted questions. |
| **Adjudicator / Judge** | `JudgeAgent` | Evaluates verified facts against Ryde's official policy library and past precedents. Generates ruling, confidence score, and natural language explanations. |
| **Workflow Orchestrator** | `StateEngine` | (Powered by WorkBuddy / CodeBuddy backend) Controls state transitions, round limits, and execution routing gates. |

---

## 🔄 End-to-End 5-Phase Workflow Specification

### Phase 1: Case Ingestion (`INIT_CLAIM`)
- User (Rider or Driver) submits a dispute via Miora UI.
- Context initialization: System generates `case_id`, loads historical user profiles, and attaches raw telemetry.

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
   - Advocates submit targeted responses addressing these queries.

### Phase 4: Conditional Rebuttal & Dynamic Stopping Engine (`ROUND_3_CONDITIONAL_REBUTTAL`)
- **Stopping Condition Check**:
  - `ProsecutorAgent` evaluates if new responses introduce **substantive new evidence**.
  - **Rule A (No New Facts)**: If responses contain only rhetorical debate or repeated arguments, Round 3 is bypassed immediately (`is_round3_triggered = false`).
  - **Rule B (Substantive Fact Introduced)**: Allows a single focused rebuttal round before locking the fact record.
- **Prosecutor Report Emission**: Generates immutable lists of `verified_facts`, `disputed_facts`, and `missing_facts`.

### Phase 5: Judge Deliberation & Execution Routing (`JUDGE_DELIBERATION` & `EXECUTION_ROUTER`)
1. `JudgeAgent` ingests the `ProsecutorReport` and evaluates against Ryde Policy.
2. Generates:
   - `ruling_type` (`APPROVED`, `PARTIAL_REFUND`, `REJECTED`, `ESCALATED`)
   - `confidence_score` (0.00 to 1.00)
   - `recommended_action` (e.g., refund SGD $3.25)
   - Client-facing natural language summaries for both parties.
3. **Execution Gate Evaluation**:
   - **Automatic Execution (`FULLY_AUTOMATED`)**: Triggered when `confidence_score >= 0.75`, `safety_threat_detected == false`, and `fraud_risk_level != HIGH`. Executes API refund instantly.
   - **Human Escalation (`ESCALATED_HUMAN_REVIEW`)**: Triggered when safety issues are flagged, fraud score is elevated, or confidence is low. Routes full case summary card to human reviewer for 1-click confirmation.

---

## 👥 Team Role Assignment & Execution Responsibilities

- **P1: Workflow & UI Orchestrator**
  - Owns `workflow.md`, state machine orchestration logic, WorkBuddy DAG graph, and Miora Mock Court UI integration.
- **P2: Agent Architect & Decision Engine Lead**
  - Owns prompts/LLM logic for `RiderAgent`, `DriverAgent`, and `JudgeAgent`, plus Ryde Policy RAG integration.
- **P3: Data, Safety & Multimodal Lead**
  - Owns `ProsecutorAgent` tool execution, GPS detour algorithms, EXIF/Multimodal image verification, and Fraud Risk Agent.