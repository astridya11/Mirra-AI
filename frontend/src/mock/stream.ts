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

  // Phase 1: INIT_CLAIM
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
  });

  // Phase 2: ROUND_1_PLEADINGS — Rider statement
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

  // Phase 2: ROUND_1_PLEADINGS — Driver statement
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

  // Phase 2: ROUND_1_PLEADINGS — Phase event
  events.push({
    phase: "ROUND_1_PLEADINGS",
    label: "2. 第一轮辩论（申诉与答辩）",
    data: r1,
    timestamp: now(),
  });

  // Phase 3: ROUND_2_PROSECUTOR_AUDIT — Initial audit
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "3a. 检察官初始证据审计与欺诈筛查",
    data: {
      prosecutor_findings: prosecutor,
      bonus_modules: bonus,
    },
    timestamp: now(),
  });

  // Phase 3: Q&A pairs
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
        agent_output: q,
        timestamp: now(),
      },
      event_type: "AGENT_CONVERSATION",
      speaker: "PROSECUTOR",
      message_type: "QUESTION",
      timestamp: now(),
    });

    if (responses[i]) {
      const r = responses[i];
      const target = r.responding_party === "RIDER" ? "RIDER_ADVOCATE" : "DRIVER_ADVOCATE";
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
          agent_output: r,
          timestamp: now(),
        },
        event_type: "AGENT_CONVERSATION",
        speaker: target,
        message_type: "RESPONSE",
        timestamp: now(),
      });
    }
  }

  // Phase 3: Final prosecutor report
  events.push({
    phase: "ROUND_2_PROSECUTOR_AUDIT",
    label: "3b. 第二轮调查质询完成与检察官报告(Prosecutor Report)出具",
    data: {
      round_2_cross_exam: r2,
      prosecutor_findings: prosecutor,
      bonus_modules: bonus,
    },
    timestamp: now(),
  });

  // Phase 4: POLICY_CONSULTATION
  events.push({
    phase: "POLICY_CONSULTATION",
    label: "4. 平台条款与历史判例检索",
    data: policy,
    timestamp: now(),
  });

  // Phase 5: JUDGE_DELIBERATION
  events.push({
    phase: "JUDGE_DELIBERATION",
    label: "5. 大模型法官终审裁决",
    data: verdict,
    timestamp: now(),
  });

  // Phase 6: EXECUTION_ROUTER
  const execVerdict = verdict as Record<string, unknown>;
  events.push({
    phase: "EXECUTION_ROUTER",
    label: "6. 执行路由与人工审核分流",
    data: {
      route: result.case_metadata.resolution_channel,
      confidence_score: (execVerdict.confidence_score as number) ?? 0,
      escalation_reasons: bonus.escalation_protocol?.escalation_reasons || [],
      requires_human_signoff: result.case_metadata.resolution_channel === "ESCALATED_HUMAN_REVIEW",
      execution_payload: execVerdict.execution_payload,
    } as Record<string, unknown>,
    timestamp: now(),
  });

  return events;
}
