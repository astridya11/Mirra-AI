"""
state_machine.py - Multi-Agent Dispute Resolution Pipeline State Machine Engine.

Handles the full lifecycle of a dispute case using real agent invocations via
event-driven real-time streaming (SSE / WebSocket ready):
1. INIT_CLAIM: Case initialization & evidence freezing
2. ROUND_1_PLEADINGS: Rider & Driver Advocate Agents (Live Streaming)
3. ROUND_2_PROSECUTOR_AUDIT: Prosecutor/Investigator Agent & Fraud Tools (Live Cross-Exam Streaming)
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
from backend.policy import precedent_store

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
# Enums
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
# Phase & Conversation Events
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
# Agent Conversation Event
# ----------------------------------------------------------------------


class AgentConversationEvent(PhaseEvent):
    """
    Transport event emitted immediately after an agent message completes.
    Used by WebSocket/SSE layer to display real-time conversations.
    """

    def __init__(
        self,
        phase: str,
        speaker: str,
        message_type: str,
        data: Dict[str, Any],
    ):
        super().__init__(phase, "AGENT_CONVERSATION", data)
        self.speaker = speaker
        self.message_type = message_type

    def to_dict(self) -> Dict[str, Any]:
        event = super().to_dict()
        event["event_type"] = "AGENT_CONVERSATION"
        event["speaker"] = self.speaker
        event["message_type"] = self.message_type
        return event


# ----------------------------------------------------------------------
# Case Context — holds the full case state across all pipeline phases
# ----------------------------------------------------------------------


class CaseContext:
    """
    Holds the full case state across all pipeline phases.

    Field names align with shared/schemas.json top-level properties:
      case_metadata, data_sources, round_1_statements, round_2_cross_exam,
      bonus_modules, prosecutor_findings, policy_consultation,
      judge_verdict, policy_kb_update, agent_conversation
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

        # Chronological transcript shared by realtime UI and case storage.
        self.agent_conversation: List[Dict[str, Any]] = []

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
            "agent_conversation": self.agent_conversation,
            "bonus_modules": self.bonus_modules,
            "prosecutor_findings": self.prosecutor_findings,
            "policy_consultation": self.policy_consultation,
            "judge_verdict": self.judge_verdict,
            "policy_kb_update": self.policy_kb_update,
        }

    def to_context_dict(self) -> Dict[str, Any]:
        """
        Build a flat dict suitable for passing to agents that expect
        a context dict.

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

    def to_live_context_dict(self) -> Dict[str, Any]:
        """Return normal agent context plus the live agent conversation."""
        context = self.to_context_dict()
        context["conversation"] = list(self.agent_conversation)
        return context


# ----------------------------------------------------------------------
# Case persistence helpers
# ----------------------------------------------------------------------


def _get_case(case_id: str) -> Optional[Dict[str, Any]]:
    from backend.main import get_case
    return get_case(case_id)


def _save_case(result: Dict[str, Any]) -> None:
    from backend.main import save_case
    save_case(result)


# ----------------------------------------------------------------------
# Real-Time Pipeline Engine
# ----------------------------------------------------------------------


class PipelineEngine:
    """
    Orchestrates the 6-phase dispute resolution pipeline with real-time event streaming.

    Each phase:
      1. Reads the accumulated case state from self.ctx
      2. Invokes the responsible agent(s)
      3. Writes the agent's output back into self.ctx
      4. Transitions to the next state
    """

    def __init__(self, case_id: str):
        self.case_id = case_id
        self.ctx: Optional[CaseContext] = None
        # Runtime alias retained for compatibility with callers that inspect
        # Round 2 conversation events before serialization.
        self._round_2_agent_conversation: List[Dict[str, Any]] = []

    def _record_conversation_event(
        self,
        phase: str,
        speaker: str,
        message_type: str,
        target: str,
        response: Any,
        turn: int,
    ) -> AgentConversationEvent:
        """Normalize an agent response into a UI-streamable conversation event."""
        if isinstance(response, dict):
            content = (
                response.get("content")
                or response.get("message")
                or response.get("response_text")
                or response.get("response")
                or response.get("question_text")
                or response.get("question")
                or response.get("text")
                or ""
            )
            agent_output = response
        else:
            content = str(response)
            agent_output = {"content": content}

        event_data = {
            "message_id": f"MSG-{uuid.uuid4().hex[:10].upper()}",
            "speaker": speaker,
            "message_type": message_type,
            "target": target,
            "content": content,
            "turn": turn,
            "status": "COMPLETED",
            "agent_output": agent_output,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        self.ctx.agent_conversation.append(event_data)
        return AgentConversationEvent(
            phase=phase,
            speaker=speaker,
            message_type=message_type,
            data=event_data,
        )

    # -- Phase 1: INIT_CLAIM -----------------------------------------------

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

    # -- Phase 2: ROUND_1_PLEADINGS (Streaming) ----------------------------

    async def _stream_round_1_pleadings(self) -> AsyncGenerator[PhaseEvent, None]:
        """Real-time streaming for ROUND_1_PLEADINGS.

        Agent contract:
          rider_advocate_agent.generateResponse(context: dict, target: str) -> dict
          driver_advocate_agent.generateResponse(context: dict, target: str) -> dict

        Each response is yielded immediately and also becomes the corresponding
        schema-aligned AgentStatement. No second advocate invocation is made.
        """
        rider_generate_response = _lazy_import(
            "backend.agents.rider_advocate_agent", "generateResponse"
        )
        driver_generate_response = _lazy_import(
            "backend.agents.driver_advocate_agent", "generateResponse"
        )

        # Rider Advocate Response
        rider_response = await rider_generate_response(
            context=self.ctx.to_live_context_dict(),
            target="DRIVER_ADVOCATE",
        )
        rider_statement = dict(rider_response) if isinstance(rider_response, dict) else {"content": str(rider_response)}
        rider_statement.setdefault("party", "RIDER")
        rider_statement.setdefault("agent_role", "RIDER_ADVOCATE")
        rider_statement.setdefault("submitted_at", datetime.now(_SGT).isoformat())
        self.ctx.round_1_statements["rider_statement"] = rider_statement

        yield self._record_conversation_event(
            State.ROUND_1_PLEADINGS,
            "RIDER_ADVOCATE",
            "STATEMENT",
            "DRIVER_ADVOCATE",
            rider_response,
            1,
        )

        # Driver Advocate Response
        driver_response = await driver_generate_response(
            context=self.ctx.to_live_context_dict(),
            target="RIDER_ADVOCATE",
        )
        driver_statement = dict(driver_response) if isinstance(driver_response, dict) else {"content": str(driver_response)}
        driver_statement.setdefault("party", "DRIVER")
        driver_statement.setdefault("agent_role", "DRIVER_ADVOCATE")
        driver_statement.setdefault("submitted_at", datetime.now(_SGT).isoformat())
        self.ctx.round_1_statements["driver_statement"] = driver_statement

        yield self._record_conversation_event(
            State.ROUND_1_PLEADINGS,
            "DRIVER_ADVOCATE",
            "STATEMENT",
            "RIDER_ADVOCATE",
            driver_response,
            2,
        )

        self.ctx.set_state(State.ROUND_2_PROSECUTOR_AUDIT, round_num=2)
        yield PhaseEvent(
            phase=State.ROUND_1_PLEADINGS,
            label="2. 第一轮辩论（申诉与答辩）",
            data=self.ctx.round_1_statements,
        )

    # -- Phase 3: ROUND_2_PROSECUTOR_AUDIT (Streaming) --------------------

    @staticmethod
    def _normalize_live_question(question: Any, turn: int) -> Dict[str, Any]:
        raw = dict(question) if isinstance(question, dict) else {"question": str(question)}
        return {
            "question_id": raw.get("question_id") or f"Q-{uuid.uuid4().hex[:10].upper()}",
            "directed_to": raw.get("directed_to") or raw.get("target") or "BOTH",
            "question_text": (
                raw.get("question_text")
                or raw.get("question")
                or raw.get("content")
                or raw.get("text")
                or ""
            ),
            "evidence_context": raw.get("evidence_context", ""),
            "category": raw.get("category", "OTHER"),
            "asked_at": raw.get("asked_at") or datetime.now(_SGT).isoformat(),
        }

    @staticmethod
    def _normalize_live_response(
        response: Any, question: Dict[str, Any], target: str, turn: int
    ) -> Dict[str, Any]:
        raw = dict(response) if isinstance(response, dict) else {"response": str(response)}
        responding_party = (
            "RIDER" if target == "RIDER_ADVOCATE" else
            "DRIVER" if target == "DRIVER_ADVOCATE" else
            raw.get("responding_party", "UNKNOWN")
        )
        return {
            "question_id": raw.get("question_id") or question["question_id"],
            "response_id": raw.get("response_id") or f"R-{uuid.uuid4().hex[:10].upper()}",
            "responding_party": responding_party,
            "response_text": (
                raw.get("response_text")
                or raw.get("response")
                or raw.get("content")
                or raw.get("message")
                or raw.get("text")
                or ""
            ),
            "responded_at": raw.get("responded_at") or datetime.now(_SGT).isoformat(),
        }

    async def _stream_round_2_prosecutor_audit(self) -> AsyncGenerator[PhaseEvent, None]:
        """Real-time streaming for ROUND_2_PROSECUTOR_AUDIT cross-examination.

        Agent contract:
          prosecutor_agent.generateQuestion(context: dict, turn: int) -> dict
          rider_advocate_agent.generateResponse(context: dict, question: dict) -> dict
          driver_advocate_agent.generateResponse(context: dict, question: dict) -> dict

        The state machine yields the prosecutor question immediately, then
        yields the targeted advocate response immediately. There are no
        follow-up questions after the configured single pass.
        """
        prosecutor_generate_question = _lazy_import(
            "backend.agents.prosecutor_agent", "generateQuestion"
        )
        rider_generate_response = _lazy_import(
            "backend.agents.rider_advocate_agent", "generateResponse"
        )
        driver_generate_response = _lazy_import(
            "backend.agents.driver_advocate_agent", "generateResponse"
        )
        run_prosecutor_audit = _lazy_import(
            "backend.agents.prosecutor_agent", "run_prosecutor_audit"
        )

        # ------------------------------------------------------------------
        # Step 1: 质询前 - 执行初始证据审计 (Initial Evidence Audit)
        # 检察官先运行工具分析 telemetry, EXIF, Chat logs, Fraud score
        # ------------------------------------------------------------------
        initial_audit_result = await run_prosecutor_audit(self.ctx.to_live_context_dict())
        self.ctx.bonus_modules = initial_audit_result.get("bonus_modules", {})
        self.ctx.prosecutor_findings = initial_audit_result.get("prosecutor_findings", {})

        yield PhaseEvent(
            phase=State.ROUND_2_PROSECUTOR_AUDIT,
            label="3a. 检察官初始证据审计与欺诈筛查",
            data={
                "prosecutor_findings": self.ctx.prosecutor_findings,
                "bonus_modules": self.ctx.bonus_modules,
            },
        )

        # ------------------------------------------------------------------
        # Step 2: 质询中 - 基于已核查的证据进行交叉质询 (Cross-Examination)
        # ------------------------------------------------------------------
        max_turns = 10
        for turn in range(1, max_turns + 1):
            # 此时 generateQuestion 上下文中已经包含初始的 prosecutor_findings 证据分析
            question = await prosecutor_generate_question(
                context=self.ctx.to_live_context_dict(),
                turn=turn,
            )
            if isinstance(question, dict) and question.get("done"):
                break

            default_target = "RIDER_ADVOCATE" if turn % 2 else "DRIVER_ADVOCATE"
            target = question.get("target", question.get("directed_to", default_target)) if isinstance(question, dict) else default_target
            if target not in {"RIDER_ADVOCATE", "DRIVER_ADVOCATE"}:
                raise ValueError(
                    f"generateQuestion() returned invalid target '{target}'. "
                    "Expected RIDER_ADVOCATE or DRIVER_ADVOCATE."
                )

            normalized_question = self._normalize_live_question(question, turn)
            self.ctx.round_2_cross_exam.setdefault("targeted_questions", []).append(
                normalized_question
            )

            yield self._record_conversation_event(
                State.ROUND_2_PROSECUTOR_AUDIT,
                "PROSECUTOR",
                "QUESTION",
                target,
                normalized_question,
                turn,
            )

            advocate_generate_response = (
                rider_generate_response
                if target == "RIDER_ADVOCATE"
                else driver_generate_response
            )
            response = await advocate_generate_response(
                context=self.ctx.to_live_context_dict(),
                question=normalized_question,
            )

            normalized_response = self._normalize_live_response(
                response, normalized_question, target, turn
            )
            self.ctx.round_2_cross_exam.setdefault("targeted_responses", []).append(
                normalized_response
            )

            yield self._record_conversation_event(
                State.ROUND_2_PROSECUTOR_AUDIT,
                target,
                "RESPONSE",
                "PROSECUTOR",
                normalized_response,
                turn,
            )

        # ------------------------------------------------------------------
        # Step 3: 质询后 - 综合双方说辞与最终证据，生成终审 Prosecutor Report
        # ------------------------------------------------------------------
        final_audit_result = await run_prosecutor_audit(self.ctx.to_live_context_dict())

        self.ctx.bonus_modules = final_audit_result.get("bonus_modules", {})
        self.ctx.prosecutor_findings = final_audit_result.get("prosecutor_findings", {})
        self.ctx.round_2_cross_exam.setdefault("round2_completed", True)
        self.ctx.round_2_cross_exam.setdefault(
            "completed_at", datetime.now(_SGT).isoformat()
        )

        self.ctx.set_state(State.POLICY_CONSULTATION)

        yield PhaseEvent(
            phase=State.ROUND_2_PROSECUTOR_AUDIT,
            label="3b. 第二轮调查质询完成与检察官报告(Prosecutor Report)出具",
            data={
                "round_2_cross_exam": self.ctx.round_2_cross_exam,
                "agent_conversation": self.ctx.agent_conversation,
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

            suggestion.setdefault(
                "request_id",
                request["request_id"],
            )

            self.ctx.policy_consultation = {
                "request": request,
                "suggestion": suggestion,
            }
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

        # Save final state to storage
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
        #   4. safety threat keywords in chat transcript
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

        # 4. Missing crucial evidence
        missing_crucial_evidence = escalation_proto.get("missing_crucial_evidence", False)
        if missing_crucial_evidence:
            reasons.append("缺少关键证据")

        # 5. Amount threshold check, if > 20, escalate to human review. if > 50, escalate to human review and mark as HIGH_PRIORITY
        AMOUNT_THRESHOLD = 20
        HIGH_PRIORITY_THRESHOLD = 50
        recommended_action = verdict.get("recommended_action", {})
        refund_amount = recommended_action.get("refund_amount", 0)
        cleaning_fee_amount = recommended_action.get("cleaning_fee_amount", 0)
        if refund_amount > AMOUNT_THRESHOLD or cleaning_fee_amount > AMOUNT_THRESHOLD:
            reasons.append("金额超过自动执行阈值，需要人工审核")
        if refund_amount > HIGH_PRIORITY_THRESHOLD or cleaning_fee_amount > HIGH_PRIORITY_THRESHOLD:
            reasons.append(f"金额超过高优先级阈值 ({HIGH_PRIORITY_THRESHOLD})")

        # 6. If the recommended action is to suspend or ban the account / add penalty points, escalate to human review
        account_action = recommended_action.get("account_action", "NONE")
        penalty_points = recommended_action.get("penalty_points", 0)
        if account_action != "NONE" or penalty_points > 0:
            reasons.append("建议采取账户冻结、扣分等惩罚措施，需人工审核")

        # 7. If the party has requested human review
        party_requested_human = escalation_proto.get("party_requested_human", False)
        if party_requested_human:
            reasons.append("当事人不满意自动决策，请求人工审核")

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
            "URGENT" if safety_threat or fraud_risk_level == "HIGH"
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

    # -- Policy suggestion fallback ----------------------------------------

    def _build_policy_suggestion(
        self,
        dispute_type: str,
        request: Dict[str, Any],
        now: str,
    ) -> Dict[str, Any]:
        """Fallback policy builder."""
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

    # -- Real-Time Pipeline Executor ---------------------------------------

    async def execute_all_realtime(self) -> AsyncGenerator[PhaseEvent, None]:
        """Run the full pipeline while yielding each live conversation & phase event."""
        yield await self._phase_init_claim()

        async for event in self._stream_round_1_pleadings():
            yield event

        async for event in self._stream_round_2_prosecutor_audit():
            yield event

        yield await self._phase_policy_consultation()
        yield await self._phase_judge_deliberation()
        yield await self._phase_execution_router()


# ----------------------------------------------------------------------
# Helper Functions (used by the deterministic fallback)
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
# Public API Entry Points (Pure Real-Time)
# ----------------------------------------------------------------------


async def run_dispute_pipeline_realtime(
    case_id: str,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Stream UI-ready pipeline and agent-conversation events in real time.
    This is the primary transport entry point for SSE or WebSocket layers.
    """
    engine = PipelineEngine(case_id)
    async for event in engine.execute_all_realtime():
        yield event.to_dict()


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