/**
 * Mock SSE pipeline events — mirrors the backend's run_dispute_pipeline_realtime()
 * event generator. Each event matches PhaseEvent.to_dict() or
 * AgentConversationEvent.to_dict() from state_machine.py.
 */

import type { PipelineEvent } from "@/src/types";
import { mockCompletedResults } from "./cases";

function now(): string {
  return new Date().toISOString();
}

/**
 * Build the sequence of pipeline events for a given case.
 * The structure mirrors execute_all_realtime():
 *   1. INIT_CLAIM phase event
 *   2. ROUND_1_PLEADINGS: rider statement, driver statement, phase event
 *   3. ROUND_2_PROSECUTOR_AUDIT: initial audit, Q&A pairs, final report
 *   4. POLICY_CONSULTATION phase event
 *   5. JUDGE_DELIBERATION phase event
 *   6. EXECUTION_ROUTER phase event
 *
 * Events include proper event_type and sub_phase fields to match the backend
 * PhaseEvent.to_dict() and AgentConversationEvent.to_dict() structure.
 */
export function getMockPipelineEvents(caseId: string): PipelineEvent[] {
  const result = mockCompletedResults[caseId];
  if (!result) return [];

  const events: PipelineEvent[] = [];
  const r1 = result.round_1_statements || {};
  const r2 = result.round_2_cross_exam || {};
  const prosecutor = result.prosecutor_findings || {};
  const policy = result.policy_consultation || {};
  const verdict = result.judge_verdict || {};
  const bonus = result.bonus_modules || {};

  // Phase 1: INIT_CLAIM — PHASE_STARTED + PHASE_COMPLETED
  events.push({
    phase: "INIT_CLAIM",
    label: "案件初始化与证据冻结",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
  });
  events.push({
    phase: "INIT_CLAIM",
    label: "1. 案件初始化与证据冻结",
    data: {
      status: "EVIDENCE_FROZEN",
      dispute_type: result.case_metadata.dispute_type,
      rider_id: result.case_metadata.rider_id,
      driver_id: result.case_metadata.driver_id,
      frozen_at: now(),
    },
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
  });

  // Phase 2: ROUND_1_PLEADINGS — PHASE_STARTED
  events.push({
    phase: "ROUND_1_PLEADINGS",
    label: "开始第一轮辩论（申诉与答辩）",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
  });

  // Phase 2: ROUND_1_PLEADINGS — Rider statement (AGENT_CONVERSATION)
  if (r1.rider_statement) {
    events.push({
      phase: "ROUND_1_PLEADINGS",
      label: "AGENT_CONVERSATION",
      data: {
        message_id: "MSG-R1-RIDER",
        speaker: "RIDER_ADVOCATE",
        message_type: "STATEMENT",
        target: "DRIVER_ADVOCATE",
        content: r1.rider_statement.argument_summary || "",
        turn: 1,
        status: "COMPLETED",
        agent_output: r1.rider_statement,
        timestamp: now(),
      },
      event_type: "AGENT_CONVERSATION",
      speaker: "RIDER_ADVOCATE",
      message_type: "STATEMENT",
      timestamp: now(),
    });
  }

  // Phase 2: ROUND_1_PLEADINGS — Driver statement (AGENT_CONVERSATION)
  if (r1.driver_statement) {
    events.push({
      phase: "ROUND_1_PLEADINGS",
      label: "AGENT_CONVERSATION",
      data: {
        message_id: "MSG-R1-DRIVER",
        speaker: "DRIVER_ADVOCATE",
        message_type: "STATEMENT",
        target: "RIDER_ADVOCATE",
        content: r1.driver_statement.argument_summary || "",
        turn: 2,
        status: "COMPLETED",
        agent_output: r1.driver_statement,
        timestamp: now(),
      },
      event_type: "AGENT_CONVERSATION",
      speaker: "DRIVER_ADVOCATE",
      message_type: "STATEMENT",
      timestamp: now(),
    });
  }

  // Phase 2: ROUND_1_PLEADINGS — PHASE_COMPLETED
  events.push({
    phase: "ROUND_1_PLEADINGS",
    label: "2. 第一轮辩论（申诉与答辩）",
    data: r1 as Record<string, unknown>,
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
  });

  // Phase 3a: ROUND_2_PROSECUTOR_AUDIT — PHASE_STARTED (INITIAL_AUDIT)
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "检察官开始初始证据审计与欺诈筛查",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
    sub_phase: "INITIAL_AUDIT",
  } as PipelineEvent);

  // Phase 3a: PHASE_COMPLETED (INITIAL_AUDIT) — prosecutor summary
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "3a. 检察官初始证据审计与欺诈筛查",
    data: {
      prosecutor_findings: prosecutor,
      bonus_modules: bonus,
    } as Record<string, unknown>,
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
    sub_phase: "INITIAL_AUDIT",
  } as PipelineEvent);

  // Phase 3b: PHASE_STARTED (CROSS_EXAM)
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "检察官开始交叉质询",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
    sub_phase: "CROSS_EXAM",
  } as PipelineEvent);

  // Phase 3b: Q&A pairs (AGENT_CONVERSATION)
  const questions = r2.targeted_questions || [];
  const responses = r2.targeted_responses || [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    events.push({
      phase: "ROUND_2_PROSECUTOR_AUDIT",
      label: "AGENT_CONVERSATION",
      data: {
        message_id: `MSG-Q-${i + 1}`,
        speaker: "PROSECUTOR",
        message_type: "QUESTION",
        target: q.directed_to === "RIDER" ? "RIDER_ADVOCATE" : "DRIVER_ADVOCATE",
        content: q.question_text,
        turn: i + 1,
        status: "COMPLETED",
        agent_output: q as unknown as Record<string, unknown>,
        timestamp: now(),
      },
      event_type: "AGENT_CONVERSATION",
      speaker: "PROSECUTOR",
      message_type: "QUESTION",
      timestamp: now(),
    } as PipelineEvent);

    if (responses[i]) {
      const r = responses[i];
      const target =
        r.responding_party === "RIDER" ? "RIDER_ADVOCATE" : "DRIVER_ADVOCATE";
      events.push({
        phase: "ROUND_2_PROSECUTOR_AUDIT",
        label: "AGENT_CONVERSATION",
        data: {
          message_id: `MSG-R-${i + 1}`,
          speaker: target,
          message_type: "RESPONSE",
          target: "PROSECUTOR",
          content: r.response_text,
          turn: i + 1,
          status: "COMPLETED",
          agent_output: r as unknown as Record<string, unknown>,
          timestamp: now(),
        },
        event_type: "AGENT_CONVERSATION",
        speaker: target,
        message_type: "RESPONSE",
        timestamp: now(),
      } as PipelineEvent);
    }
  }

  // Phase 3b: PHASE_COMPLETED (CROSS_EXAM)
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "3b. 交叉质询结束",
    data: {
      questions_asked: questions.length,
      targeted_questions: questions,
      targeted_responses: responses,
    } as Record<string, unknown>,
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
    sub_phase: "CROSS_EXAM",
  } as PipelineEvent);

  // Phase 3c: PHASE_STARTED (FINAL_REPORT)
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "开始第二轮调查",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
    sub_phase: "FINAL_REPORT",
  } as PipelineEvent);

  // Phase 3c: PHASE_COMPLETED (FINAL_REPORT) — final prosecutor summary
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "3c. 第二轮调查完成，检察官报告已出具",
    data: {
      round_2_cross_exam: r2 as unknown,
      prosecutor_findings: prosecutor,
      bonus_modules: bonus,
    } as Record<string, unknown>,
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
    sub_phase: "FINAL_REPORT",
  } as PipelineEvent);

  // Phase 4: POLICY_CONSULTATION — PHASE_STARTED + PHASE_COMPLETED
  events.push({
    phase: "POLICY_CONSULTATION",
    label: "平台条款与历史判例检索",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
  });
  events.push({
    phase: "POLICY_CONSULTATION",
    label: "4. 平台条款与历史判例检索完成",
    data: policy as unknown as Record<string, unknown>,
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
  });

  // Phase 5: JUDGE_DELIBERATION — PHASE_STARTED + PHASE_COMPLETED
  events.push({
    phase: "JUDGE_DELIBERATION",
    label: "法官审议中",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
  });
  events.push({
    phase: "JUDGE_DELIBERATION",
    label: "5. 大模型法官终审裁决",
    data: verdict as unknown as Record<string, unknown>,
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
  });

  // Phase 6: EXECUTION_ROUTER — PHASE_STARTED + PHASE_COMPLETED
  events.push({
    phase: "EXECUTION_ROUTER",
    label: "执行路由分配",
    data: { status: "STARTED" },
    timestamp: now(),
    event_type: "PHASE_STARTED",
  });
  const execVerdict = verdict as Record<string, unknown>;
  events.push({
    phase: "EXECUTION_ROUTER",
    label: "6. 执行路由与人工审核分流",
    data: {
      route: result.case_metadata.resolution_channel,
      confidence_score: (execVerdict.confidence_score as number) ?? 0,
      escalation_reasons:
        bonus.escalation_protocol?.escalation_reasons || [],
      requires_human_signoff:
        result.case_metadata.resolution_channel === "ESCALATED_HUMAN_REVIEW",
      execution_payload: execVerdict.execution_payload,
    } as Record<string, unknown>,
    timestamp: now(),
    event_type: "PHASE_COMPLETED",
  });

  return events;
}
