"""
state_machine.py - Multi-Agent Dispute Resolution Pipeline State Machine Engine.

Handles the full lifecycle of a dispute case using real agent invocations:
1. INIT_CLAIM: Case initialization & evidence freezing
2. ROUND_1_PLEADINGS: Rider & Driver Advocate Agents
3. ROUND_2_PROSECUTOR_AUDIT: Prosecutor/Investigator Agent & Fraud Tools
4. POLICY_CONSULTATION: Policy & Precedent Matching Agent
5. JUDGE_DELIBERATION: Judge Agent Decision
6. EXECUTION_ROUTER: Confidence Gate & Execution Routing

This is the **framework** that defines how agents exchange information.
All agents are called as if they are production-ready. Teammates implementing
the not-yet-written agents (rider_advocate_agent, driver_advocate_agent,
prosecutor_agent) need only:
  1. Create the module at backend/agents/<name>.py
  2. Expose the expected async entry point (see _lazy_import below)
  3. Return a dict matching the corresponding $defs in shared/schemas.json

Schema reference: shared/schemas.json
"""

import uuid
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, AsyncGenerator

# ----------------------------------------------------------------------
# Implemented agents (top-level imports — these exist now)
# ----------------------------------------------------------------------
from backend.agents.judge_agent import run_judge
from backend.agents import precedent_store
# ----------------------------------------------------------------------
# Timezone & constants
# ----------------------------------------------------------------------

_SGT = timezone(timedelta(hours=8))

CONFIDENCE_THRESHOLD = 0.75
SAFETY_KEYWORDS = [
    "safety", "assault", "harassment", "threat",
    "accident", "weapon", "police",
]

# ----------------------------------------------------------------------
# Lazy agent loader
# ----------------------------------------------------------------------


def _lazy_import(module_path: str, function_name: str):
    """
    Dynamically import an agent function.

    Not-yet-implemented agents are loaded this way so that the framework
    is complete: the import happens at call time, not at module load time.
    If a teammate hasn't created the module yet, the error message clearly
    states what needs to be created.
    """
    import importlib

    try:
        mod = importlib.import_module(module_path)
    except ModuleNotFoundError as exc:
        raise ImportError(
            f"Agent module '{module_path}' not found. "
            f"To enable this phase, create the module at "
            f"backend/agents/{module_path.split('.')[-1]}.py "
            f"exposing an async function '{function_name}'. "
            f"Original error: {exc}"
        ) from exc

    if not hasattr(mod, function_name):
        raise ImportError(
            f"Agent module '{module_path}' is missing the expected "
            f"async entry point '{function_name}'. Please implement it."
        )

    return getattr(mod, function_name)


# ----------------------------------------------------------------------
# State constants (mirrors CaseMetadata.current_state in schema)
# ----------------------------------------------------------------------


class State:
    INIT_CLAIM = "INIT_CLAIM"
    ROUND_1_PLEADINGS = "ROUND_1_PLEADINGS"
    ROUND_2_PROSECUTOR_AUDIT = "ROUND_2_PROSECUTOR_AUDIT"
    POLICY_CONSULTATION = "POLICY_CONSULTATION"
    JUDGE_DELIBERATION = "JUDGE_DELIBERATION"
    EXECUTION_ROUTER = "EXECUTION_ROUTER"


# ----------------------------------------------------------------------
# Enums (defined locally to avoid circular import with main.py)
# ----------------------------------------------------------------------


class ExecutionRoute(str, Enum):
    """Execution routing decision produced by the EXECUTION_ROUTER gate."""

    FULLY_AUTOMATED = "FULLY_AUTOMATED"
    ESCALATED_HUMAN_REVIEW = "ESCALATED_HUMAN_REVIEW"


class HumanReviewDecision(str, Enum):
    """Human reviewer's decision during ESCALATED_HUMAN_REVIEW."""

    CONFIRMED_AUTO = "CONFIRMED_AUTO"
    MODIFIED = "MODIFIED"
    OVERRIDDEN = "OVERRIDDEN"
    REJECTED_AUTO = "REJECTED_AUTO"


# ----------------------------------------------------------------------
# Phase Event
# ----------------------------------------------------------------------


class PhaseEvent:
    """Captures a single phase transition for event streaming."""

    def __init__(self, phase: str, label: str, data: Dict[str, Any]):
        self.phase = phase
        self.label = label
        self.data = data
        self.timestamp = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "phase": self.phase,
            "label": self.label,
            "data": self.data,
            "timestamp": self.timestamp,
        }


# ----------------------------------------------------------------------
# Case Context — holds the full case state across all pipeline phases
# ----------------------------------------------------------------------


class CaseContext:
    """
    Holds the full case state across all pipeline phases.

    Field names align with shared/schemas.json top-level properties:
      case_metadata, data_sources, round_1_statements, round_2_cross_exam,
      bonus_modules, prosecutor_findings, policy_consultation,
      judge_verdict, policy_kb_update
    """

    def __init__(self, case_id: str, case_data: Dict[str, Any]):
        self.case_id = case_id
        self.raw_case_data = case_data

        meta = case_data.get("case_metadata", {})
        self.case_metadata: Dict[str, Any] = {
            "case_id": case_id,
            "dispute_type": meta.get("dispute_type", "UNKNOWN"),
            "current_state": State.INIT_CLAIM,
            "current_round": 1,
            "resolution_channel": meta.get("resolution_channel", "FULLY_AUTOMATED"),
            "trip_id": meta.get("trip_id"),
            "rider_id": meta.get("rider_id"),
            "driver_id": meta.get("driver_id"),
            "created_at": meta.get("created_at", datetime.now(_SGT).isoformat()),
            "updated_at": datetime.now(_SGT).isoformat(),
        }

        # Schema-aligned phase outputs
        self.data_sources: Dict[str, Any] = {}
        self.round_1_statements: Dict[str, Any] = {}
        self.round_2_cross_exam: Dict[str, Any] = {}
        self.bonus_modules: Dict[str, Any] = {}
        self.prosecutor_findings: Dict[str, Any] = {}
        self.policy_consultation: Dict[str, Any] = {}
        self.judge_verdict: Dict[str, Any] = {}
        self.policy_kb_update: Optional[Dict[str, Any]] = None

    def update_timestamp(self) -> None:
        self.case_metadata["updated_at"] = datetime.now(_SGT).isoformat()

    def set_state(self, state: str, round_num: Optional[int] = None) -> None:
        self.case_metadata["current_state"] = state
        if round_num is not None:
            self.case_metadata["current_round"] = round_num
        self.update_timestamp()

    def assemble_result(self) -> Dict[str, Any]:
        """Assemble the full schema-compliant result dict."""
        return {
            "case_metadata": self.case_metadata,
            "data_sources": self.data_sources,
            "round_1_statements": self.round_1_statements,
            "round_2_cross_exam": self.round_2_cross_exam,
            "bonus_modules": self.bonus_modules,
            "prosecutor_findings": self.prosecutor_findings,
            "policy_consultation": self.policy_consultation,
            "judge_verdict": self.judge_verdict,
            "policy_kb_update": self.policy_kb_update,
        }

    def to_context_dict(self) -> Dict[str, Any]:
        """
        Build a flat dict suitable for passing to agents that expect
        a context dict (e.g., run_judge, run_prosecutor_audit).

        This is the **information exchange contract** between the state
        machine and the agents: every agent receives the accumulated
        case state via this dict.
        """
        return {
            "case_metadata": self.case_metadata,
            "data_sources": self.data_sources,
            "round_1_statements": self.round_1_statements,
            "round_2_cross_exam": self.round_2_cross_exam,
            "bonus_modules": self.bonus_modules,
            "prosecutor_findings": self.prosecutor_findings,
            "policy_consultation": self.policy_consultation,
        }


# ----------------------------------------------------------------------
# Case persistence helpers (deferred import to avoid circular dependency)
# ----------------------------------------------------------------------


def _get_case(case_id: str) -> Optional[Dict[str, Any]]:
    from backend.main import get_case
    return get_case(case_id)


def _save_case(result: Dict[str, Any]) -> None:
    from backend.main import save_case
    save_case(result)


# ----------------------------------------------------------------------
# Pipeline Engine
# ----------------------------------------------------------------------


class PipelineEngine:
    """
    Orchestrates the 6-phase dispute resolution pipeline.

    Each phase:
      1. Reads the accumulated case state from self.ctx
      2. Invokes the responsible agent(s)
      3. Writes the agent's output back into self.ctx
      4. Transitions to the next state
    """

    def __init__(self, case_id: str):
        self.case_id = case_id
        self.ctx: Optional[CaseContext] = None

    # -- Phase 1: INIT_CLAIM ------------------------------------------------

    async def _phase_init_claim(self) -> PhaseEvent:
        """
        Phase 1: Case ingestion & evidence freezing.

        Loads the raw case dataset and freezes data_sources. All evidence
        (telemetry, chat, payment, profiles) is collected and frozen here;
        no new evidence is requested or introduced during the agent debate.
        """
        case_data = _get_case(self.case_id)
        if not case_data:
            raise ValueError(f"Case {self.case_id} not found in database.")

        self.ctx = CaseContext(self.case_id, case_data)

        # Freeze data_sources from raw case data (schema: DataSources)
        self.ctx.data_sources = case_data.get("data_sources", {})

        self.ctx.set_state(State.ROUND_1_PLEADINGS, round_num=1)

        return PhaseEvent(
            phase=State.INIT_CLAIM,
            label="1. 案件初始化与证据冻结",
            data={
                "status": "EVIDENCE_FROZEN",
                "dispute_type": self.ctx.case_metadata["dispute_type"],
                "rider_id": self.ctx.case_metadata.get("rider_id"),
                "driver_id": self.ctx.case_metadata.get("driver_id"),
                "frozen_at": datetime.now(_SGT).isoformat(),
            },
        )

    # -- Phase 2: ROUND_1_PLEADINGS -----------------------------------------

    async def _phase_round_1_pleadings(self) -> PhaseEvent:
        """
        Phase 2: First-round advocate pleadings.

        RiderAgent extracts the passenger's claim, sentiment, requested
        refund, and supporting narrative. DriverAgent extracts the driver's
        response and counter-evidence. Both are structured AgentStatement
        objects added to round_1_statements.

        Agent contract:
          run_rider_advocate(context: dict) -> dict  # schema: AgentStatement
          run_driver_advocate(context: dict) -> dict  # schema: AgentStatement
        """
        context = self.ctx.to_context_dict()

        # --- Rider Advocate Agent ---
        run_rider_advocate = _lazy_import(
            "backend.agents.rider_advocate_agent", "run_rider_advocate"
        )
        rider_statement = await run_rider_advocate(context)

        # Ensure party/agent_role are set correctly
        rider_statement.setdefault("party", "RIDER")
        rider_statement.setdefault("agent_role", "RIDER_ADVOCATE")
        rider_statement.setdefault("submitted_at", datetime.now(_SGT).isoformat())

        # --- Driver Advocate Agent ---
        run_driver_advocate = _lazy_import(
            "backend.agents.driver_advocate_agent", "run_driver_advocate"
        )
        driver_statement = await run_driver_advocate(context)

        driver_statement.setdefault("party", "DRIVER")
        driver_statement.setdefault("agent_role", "DRIVER_ADVOCATE")
        driver_statement.setdefault("submitted_at", datetime.now(_SGT).isoformat())

        # Assemble round_1_statements (schema: Round1Statements)
        self.ctx.round_1_statements = {
            "rider_statement": rider_statement,
            "driver_statement": driver_statement,
        }

        self.ctx.set_state(State.ROUND_2_PROSECUTOR_AUDIT, round_num=2)

        return PhaseEvent(
            phase=State.ROUND_1_PLEADINGS,
            label="2. 第一轮辩论（申诉与答辩）",
            data=self.ctx.round_1_statements,
        )

    # -- Phase 3: ROUND_2_PROSECUTOR_AUDIT ---------------------------------

    async def _phase_round_2_prosecutor_audit(self) -> PhaseEvent:
        """
        Phase 3: Prosecutor audit & cross-examination.

        ProsecutorAgent runs tool-based verification (GPS, EXIF, chat, fraud),
        issues targeted questions to advocates, collects responses, and emits
        the immutable ProsecutorReport (verified_facts, disputed_facts,
        missing_facts, prosecutor_summary).

        Agent contract:
          run_prosecutor_audit(context: dict) -> dict with keys:
            round_2_cross_exam  (schema: Round2CrossExam)
            bonus_modules       (schema: BonusModules)
            prosecutor_findings (schema: ProsecutorReport)
        """
        context = self.ctx.to_context_dict()

        run_prosecutor_audit = _lazy_import(
            "backend.agents.prosecutor_agent", "run_prosecutor_audit"
        )
        audit_result = await run_prosecutor_audit(context)

        # Unpack the prosecutor's output into schema-aligned context fields
        self.ctx.round_2_cross_exam = audit_result.get("round_2_cross_exam", {})
        self.ctx.bonus_modules = audit_result.get("bonus_modules", {})
        self.ctx.prosecutor_findings = audit_result.get("prosecutor_findings", {})

        # Ensure round2_completed flag is set
        self.ctx.round_2_cross_exam.setdefault("round2_completed", True)
        self.ctx.round_2_cross_exam.setdefault(
            "completed_at", datetime.now(_SGT).isoformat()
        )

        self.ctx.set_state(State.POLICY_CONSULTATION)

        return PhaseEvent(
            phase=State.ROUND_2_PROSECUTOR_AUDIT,
            label="3. 第二轮调查与交叉质询（公诉审查）",
            data={
                "round_2_cross_exam": self.ctx.round_2_cross_exam,
                "bonus_modules": self.ctx.bonus_modules,
                "prosecutor_findings": self.ctx.prosecutor_findings,
            },
        )

    # -- Phase 4: POLICY_CONSULTATION --------------------------------------

    async def _phase_policy_consultation(self) -> PhaseEvent:
        """
        Phase 4: RAG policy consultation.

        StateEngine triggers PolicyAgent automatically after ROUND_2
        completes. PolicyAgent retrieves applicable clauses from the Ryde
        Policy library and matching precedents, then emits a
        PolicySuggestion (suggested ruling + recommended_action) for
        JudgeAgent to weigh.
        """
        now = datetime.now(_SGT).isoformat()
        dispute_type = self.ctx.case_metadata.get("dispute_type", "UNKNOWN")

        # Build PolicyConsultationRequest (schema: PolicyConsultationRequest)
        verified_fact_ids = [
            f.get("fact_id")
            for f in self.ctx.prosecutor_findings.get("verified_facts", [])
            if f.get("fact_id")
        ]
        prosecutor_summary = self.ctx.prosecutor_findings.get(
            "prosecutor_summary", ""
        )

        request = {
            "request_id": f"PCR-{uuid.uuid4().hex[:8].upper()}",
            "dispute_type": dispute_type,
            "verified_fact_ids": verified_fact_ids,
            "prosecutor_summary": prosecutor_summary,
            "requested_at": now,
        }

        # Try to use a full policy_consultant_agent if it exists.
        # Otherwise, use the deterministic policy_agent helpers.
        try:
            run_policy_consultation = _lazy_import(
                "backend.agents.policy_consultant_agent",
                "run_policy_consultation",
            )
            suggestion = await run_policy_consultation(
                self.ctx.to_context_dict()
            )
        except ImportError:
            # Deterministic fallback: build PolicySuggestion from
            # policy_agent helpers.
            suggestion = self._build_policy_suggestion(
                dispute_type, request, now
            )

        # Assemble policy_consultation (schema: PolicyConsultation)
        self.ctx.policy_consultation = {
            "request": request,
            "suggestion": suggestion,
        }

        self.ctx.set_state(State.JUDGE_DELIBERATION)

        return PhaseEvent(
            phase=State.POLICY_CONSULTATION,
            label="4. 平台条款与历史判例检索",
            data=self.ctx.policy_consultation,
        )

    # -- Phase 5: JUDGE_DELIBERATION ---------------------------------------

    async def _phase_judge_deliberation(self) -> PhaseEvent:
        """
        Phase 5: Judge deliberation.

        JudgeAgent receives the ProsecutorReport (verified/disputed/missing
        facts) and the PolicySuggestion (applicable clauses, suggested
        ruling). It weighs the Prosecutor's verified facts against the
        Policy suggestion and produces the final JudgeVerdict:
        ruling_type, confidence_score, recommended_action, explanations.

        Agent contract:
          run_judge(context: dict) -> dict  # schema: JudgeVerdict (minus execution_payload)
        """
        context = self.ctx.to_context_dict()
        verdict = await run_judge(context)

        self.ctx.judge_verdict = verdict
        # execution_payload will be filled by the execution router

        self.ctx.set_state(State.EXECUTION_ROUTER)

        return PhaseEvent(
            phase=State.JUDGE_DELIBERATION,
            label="5. 大模型法官终审裁决",
            data=self.ctx.judge_verdict,
        )

    # -- Phase 6: EXECUTION_ROUTER -----------------------------------------

    async def _phase_execution_router(self) -> PhaseEvent:
        """
        Phase 6: Execution gate & routing.

        Evaluates confidence_score, safety flags, and fraud risk to
        determine the execution route:
          - FULLY_AUTOMATED: confidence >= 0.75, no safety/fraud flags
            → auto-execute refund, case closed.
          - ESCALATED_HUMAN_REVIEW: confidence < 0.75, or safety/fraud
            flags → route to human reviewer for 1-click confirmation.

        Builds the ExecutionPayload and writes it into judge_verdict.
        """
        gate_decision = self._evaluate_execution_gate()

        # Write execution_payload into judge_verdict (schema: ExecutionPayload)
        self.ctx.judge_verdict["execution_payload"] = gate_decision["execution_payload"]

        # Update case_metadata with final resolution channel
        self.ctx.case_metadata["resolution_channel"] = gate_decision["route"]
        self.ctx.case_metadata["current_state"] = State.EXECUTION_ROUTER
        self.ctx.update_timestamp()

        # Persist final result
        _save_case(self.ctx.assemble_result())

        return PhaseEvent(
            phase=State.EXECUTION_ROUTER,
            label="6. 执行路由与人工审核分流",
            data=gate_decision,
        )

    # -- Execution gate evaluation -----------------------------------------

    def _evaluate_execution_gate(self) -> Dict[str, Any]:
        """
        Evaluate the execution gate to determine FULLY_AUTOMATED vs
        ESCALATED_HUMAN_REVIEW.

        Criteria for escalation:
          1. confidence_score < 0.75
          2. safety_threat_detected == True (from bonus_modules.escalation_protocol)
          3. fraud_risk_level == HIGH (from bonus_modules.escalation_protocol)
          4. safety threat keywords in chat transcript
        """
        verdict = self.ctx.judge_verdict
        confidence = verdict.get("confidence_score", 0.0)
        reasons: List[str] = []
        now = datetime.now(_SGT).isoformat()

        # 1. Confidence threshold check
        if confidence < CONFIDENCE_THRESHOLD:
            reasons.append(
                f"裁决置信度 ({confidence:.2f}) 低于自动执行阈值 ({CONFIDENCE_THRESHOLD})"
            )

        # 2. Safety threat flag from escalation_protocol
        bonus = self.ctx.bonus_modules
        escalation_proto = bonus.get("escalation_protocol", {})
        safety_threat = escalation_proto.get("safety_threat_detected", False)
        if safety_threat:
            reasons.append("安全威胁检测标记为 True")

        # 3. Fraud risk level
        fraud_risk_level = escalation_proto.get("fraud_risk_level", "LOW")
        if fraud_risk_level == "HIGH":
            reasons.append("深度调查组件标记为高欺诈风险")

        # 4. Safety keyword scan in chat transcript
        chat_data = self.ctx.data_sources.get("chat_communication", {})
        transcript = chat_data.get("transcript", [])
        chat_text = " ".join(
            [m.get("content", "") for m in transcript]
        ).lower()
        safety_detected = any(
            keyword in chat_text for keyword in SAFETY_KEYWORDS
        )
        if safety_detected:
            reasons.append("对话记录中触发安全风险关键词，需要人工安全合规审核")

        is_escalated = len(reasons) > 0
        route = (
            ExecutionRoute.ESCALATED_HUMAN_REVIEW
            if is_escalated
            else ExecutionRoute.FULLY_AUTOMATED
        )

        # Build ExecutionPayload (schema: ExecutionPayload)
        if is_escalated:
            execution_status = "PENDING_HUMAN_APPROVAL"
            case_final_status = "PENDING"
            transaction_id = None
            auto_executed_at = None
        else:
            execution_status = "AUTO_EXECUTED"
            case_final_status = "AUTO_RESOLVED"
            transaction_id = f"TXN-RYDE-2026-{uuid.uuid4().hex[:8].upper()}"
            auto_executed_at = now

        execution_payload = {
            "execution_status": execution_status,
            "transaction_id": transaction_id,
            "auto_executed_at": auto_executed_at,
            "case_final_status": case_final_status,
            "resolved_at": now,
        }

        # Update escalation_protocol with final values
        escalation_proto["is_escalated"] = is_escalated
        escalation_proto["escalation_reasons"] = reasons
        escalation_proto["priority_level"] = (
            "URGENT" if safety_detected or fraud_risk_level == "HIGH"
            else "HIGH_PRIORITY" if is_escalated
            else "STANDARD"
        )

        return {
            "route": route.value if hasattr(route, "value") else str(route),
            "confidence_score": confidence,
            "escalation_reasons": reasons,
            "requires_human_signoff": is_escalated,
            "execution_payload": execution_payload,
        }

    # -- Policy suggestion builder (deterministic fallback) ----------------

    def _build_policy_suggestion(
        self,
        dispute_type: str,
        request: Dict[str, Any],
        now: str,
    ) -> Dict[str, Any]:
        """Compatibility fallback if the full policy consultant is absent."""
        context = self.ctx.to_context_dict()
        clauses = precedent_store.retrieve_clauses(dispute_type)
        policy_values = precedent_store.compute_policy_values(dispute_type, context)
        version = precedent_store.policy_version()
        keywords = precedent_store.extract_keywords(
            f"{request.get('prosecutor_summary', '')} "
            f"{' '.join(f.get('description', '') for f in self.ctx.prosecutor_findings.get('verified_facts', []))}"
        )

        applicable_clauses = [
            precedent_store.clause_reference(clause, keywords)
            for clause in clauses
        ]
        suggested_action = _build_suggested_action(dispute_type, policy_values)
        suggested_ruling = _suggest_ruling(dispute_type, policy_values)

        return {
            "suggestion_id": f"PSG-{uuid.uuid4().hex[:8].upper()}",
            "applicable_clauses": applicable_clauses,
            "matched_precedents": [],
            "suggested_ruling_type": suggested_ruling,
            "suggested_recommended_action": suggested_action,
            "policy_confidence": policy_values.get("confidence", 0.3),
            "rationale": (
                f"Policy version {version}. Clauses retrieved: "
                f"{', '.join(c.get('id', '') for c in clauses)}. "
                f"Policy values: {policy_values}"
            ),
            "suggested_at": now,
        }

    # -- Pipeline executor --------------------------------------------------

    async def execute_all(self) -> AsyncGenerator[PhaseEvent, None]:
        """Run all 6 phases in sequence, yielding a PhaseEvent per phase."""
        yield await self._phase_init_claim()
        yield await self._phase_round_1_pleadings()
        yield await self._phase_round_2_prosecutor_audit()
        yield await self._phase_policy_consultation()
        yield await self._phase_judge_deliberation()
        yield await self._phase_execution_router()


# ----------------------------------------------------------------------
# Policy suggestion helpers (used by the deterministic fallback)
# ----------------------------------------------------------------------


def _build_suggested_action(
    dispute_type: str, policy_values: Dict[str, Any]
) -> Dict[str, Any]:
    """Build a RecommendedAction (schema: RecommendedAction) from policy values."""
    action: Dict[str, Any] = {
        "action_type": "NO_REFUND",
        "refund_amount": 0,
        "cleaning_fee_amount": 0,
        "currency": "SGD",
        "penalty_points": 0,
        "penalty_target": "NONE",
        "account_action": "NONE",
    }

    if not policy_values.get("computable", False):
        action["action_type"] = "ESCALATED_NO_ACTION"
        return action

    if dispute_type == "ROUTE_DEVIATION":
        refund = policy_values.get("refund_if_no_valid_reason", 0)
        if refund and refund > 0:
            action["action_type"] = "FULL_REFUND"
            action["refund_amount"] = refund

    elif dispute_type == "NO_SHOW_CHARGE":
        refund = policy_values.get("refund_if_fee_reversed", 0)
        if refund and refund > 0:
            action["action_type"] = "FULL_REFUND"
            action["refund_amount"] = refund

    elif dispute_type == "CLEANING_FEE":
        max_chargeable = policy_values.get("max_chargeable")
        if max_chargeable is not None and max_chargeable > 0:
            action["action_type"] = "CLEANING_FEE_CHARGE"
            action["cleaning_fee_amount"] = max_chargeable
        else:
            action["action_type"] = "ESCALATED_NO_ACTION"

    return action


def _suggest_ruling(
    dispute_type: str, policy_values: Dict[str, Any]
) -> str:
    """Determine a suggested ruling_type from policy values."""
    if not policy_values.get("computable", False):
        return "ESCALATED"

    if dispute_type == "ROUTE_DEVIATION":
        refund = policy_values.get("refund_if_no_valid_reason", 0)
        return "APPROVED" if refund and refund > 0 else "REJECTED"

    if dispute_type == "NO_SHOW_CHARGE":
        threshold_met = policy_values.get("threshold_met", False)
        return "REJECTED" if threshold_met else "APPROVED"

    if dispute_type == "CLEANING_FEE":
        max_chargeable = policy_values.get("max_chargeable")
        return "APPROVED" if max_chargeable is not None and max_chargeable > 0 else "ESCALATED"

    return "ESCALATED"


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------


async def run_dispute_pipeline_with_events(
    case_id: str,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Run the full dispute resolution pipeline, returning the final result
    and the complete phase event stream.
    """
    engine = PipelineEngine(case_id)
    events: List[Dict[str, Any]] = []

    async for event in engine.execute_all():
        events.append(event.to_dict())

    return engine.ctx.assemble_result(), events


async def run_dispute_pipeline(case_id: str) -> Dict[str, Any]:
    """
    Run the full dispute resolution pipeline and return only the assembled
    final result.
    """
    result, _ = await run_dispute_pipeline_with_events(case_id)
    return result


async def apply_human_review(
    case_id: str,
    reviewer_id: str,
    decision: HumanReviewDecision,
    adjusted_verdict: Optional[Dict[str, Any]] = None,
    review_notes: str = "",
) -> Dict[str, Any]:
    """
    Apply a human reviewer's decision to an escalated case.

    If the decision overrides the Judge's ruling (MODIFIED, OVERRIDDEN,
    REJECTED_AUTO), generates a PolicyKnowledgeBaseUpdate record (schema:
    PolicyKnowledgeBaseUpdate) that indexes this case as a new precedent
    for future PolicyAgent retrieval.

    Schema reference: HumanConfirmationDetails and PolicyKnowledgeBaseUpdate.
    """
    case_data = _get_case(case_id)
    if not case_data:
        raise ValueError(f"Case {case_id} not found.")

    judge_verdict = case_data.get("judge_verdict", {})
    policy_consultation = case_data.get("policy_consultation", {})
    now = datetime.now(_SGT).isoformat()

    decision_value = decision.value if hasattr(decision, "value") else str(decision)

    # Build HumanConfirmationDetails (schema: HumanConfirmationDetails)
    human_confirmation = {
        "reviewer_id": reviewer_id,
        "approval_timestamp": now,
        "approval_decision": decision_value,
        "override_reason": review_notes,
        "modified_action": adjusted_verdict,
    }

    # Update execution_payload
    judge_verdict.setdefault("execution_payload", {})
    judge_verdict["execution_payload"]["execution_status"] = (
        "HUMAN_CONFIRMED"
        if decision == HumanReviewDecision.CONFIRMED_AUTO
        else "HUMAN_OVERRIDDEN"
    )
    judge_verdict["execution_payload"]["human_confirmation_details"] = human_confirmation
    judge_verdict["execution_payload"]["resolved_at"] = now

    if decision == HumanReviewDecision.CONFIRMED_AUTO:
        # Confirmed as-is: no knowledge-base update.
        judge_verdict["execution_payload"]["case_final_status"] = "HUMAN_RESOLVED"
        case_data["policy_kb_update"] = None
    else:
        # Override: trigger PolicyKnowledgeBaseUpdate
        judge_verdict["execution_payload"]["case_final_status"] = "HUMAN_OVERRIDDEN"

        original_action = judge_verdict.get("recommended_action", {})
        final_action = adjusted_verdict or original_action

        # Extract clause_ids from policy_consultation.suggestion
        suggestion = policy_consultation.get("suggestion", {})
        applicable_clauses = suggestion.get("applicable_clauses", [])
        clauses_flagged = [
            c.get("clause_id") for c in applicable_clauses if c.get("clause_id")
        ]

        dispute_type = (
            case_data.get("case_metadata", {}).get("dispute_type", "UNKNOWN")
        )

        # Use the updated policy consultant's public learning API. This is
        # the actual persistence path into the precedent knowledge base.
        run_policy_module = _lazy_import(
            "backend.agents.policy_consultant_agent",
            "learn_from_human_override",
        )

        human_ruling_type = None
        if isinstance(adjusted_verdict, dict):
            human_ruling_type = adjusted_verdict.get("ruling_type")

        # Prefer the policy-consultant's case keywords if they are stored;
        # otherwise derive them from the prosecutor evidence available here.
        prosecutor_findings = case_data.get("prosecutor_findings", {})
        fact_text = " ".join(
            f.get("description", "")
            for f in prosecutor_findings.get("verified_facts", [])
        )
        keywords = precedent_store.extract_keywords(
            f"{prosecutor_findings.get('prosecutor_summary', '')} {fact_text}"
        )

        kb_update = run_policy_module(
            dispute_type=dispute_type,
            judge_ruling_type=judge_verdict.get("ruling_type", "ESCALATED"),
            judge_recommended_action=original_action,
            human_final_action=final_action,
            human_ruling_type=human_ruling_type,
            clauses_flagged=clauses_flagged,
            mismatch_summary=(
                review_notes or "Human reviewer overrode the Judge's ruling."
            ),
            keywords=keywords,
            trigger=decision_value,
        )
        case_data["policy_kb_update"] = kb_update

    case_data.setdefault("case_metadata", {})
    case_data["case_metadata"]["resolution_channel"] = "ESCALATED_HUMAN_REVIEW"
    case_data["case_metadata"]["updated_at"] = now
    case_data["judge_verdict"] = judge_verdict

    _save_case(case_data)
    return case_data
