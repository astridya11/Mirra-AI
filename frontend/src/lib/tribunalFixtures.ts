import type { TribunalFixture, TribunalEvent, EvidenceItem, FraudSignal } from "@/src/types/tribunal";

function ev(
  id: string,
  role: TribunalEvent["role"],
  type: TribunalEvent["type"],
  titleEn: string,
  titleZh: string,
  contentEn: string,
  contentZh: string,
  status: TribunalEvent["status"]
): TribunalEvent {
  return {
    id,
    role,
    type,
    title: titleEn,
    content: contentEn,
    titleZh,
    contentZh,
    timestamp: Date.now(),
    status,
  };
}

const demo1Events: TribunalEvent[] = [
  ev("e1", "rider_advocate", "statement", "Rider Advocate Statement", "乘客代理陈述", "The rider reports a 2.3 km detour and an additional S$3.25 fare.", "乘客报告了 2.3 公里的绕路以及额外的 S$3.25 车费。", "complete"),
  ev("e2", "driver_advocate", "statement", "Driver Advocate Statement", "司机代理陈述", "The driver followed the app's recommended route. GPS confirms the path taken.", "司机按照应用推荐的路线行驶。GPS 确认了行驶路径。", "complete"),
  ev("e3", "initial_prosecutor", "evidence_audit", "Evidence Audit", "证据审查", "GPS: 35 min actual vs 28 min estimated. Fare: S$18.50 with S$3.25 disputed.", "GPS：实际 35 分钟 vs 预估 28 分钟。车费：S$18.50，争议金额 S$3.25。", "complete"),
  ev("e4", "cross_examination", "targeted_question", "Targeted Question", "针对性提问", "Was the detour caused by traffic or by driver choice?", "绕路是由交通状况还是司机选择导致的？", "complete"),
  ev("e4b", "cross_examination", "claim_response", "Driver Response", "司机回应", "Driver: \"There was heavy traffic on the ECP, so I took another road.\" Recorded as a CLAIM. No traffic data confirms it.", "司机：“ECP 交通拥堵，所以我改走了另一条路。”记录为 CLAIM，没有交通数据证实。", "complete"),
  ev("e5", "final_prosecutor", "verified_summary", "Verified Summary", "核实摘要", "Verified: extra 2.3 km driven. Disputed: reason for detour. No evidence of malicious intent.", "已核实：多行驶了 2.3 公里。争议：绕路原因。无恶意证据。", "complete"),
  ev("e6", "policy_consultant", "policy_application", "Applicable Policy", "适用政策", "Ryde Policy 4.2: route deviation refunds apply when GPS confirms unnecessary extra distance.", "Ryde 政策 4.2：当 GPS 确认存在不必要额外距离时，适用路线偏离退款。", "complete"),
  ev("e7", "ai_judge", "decision", "AI Judge Decision", "AI 法官裁决", "Partial refund of S$3.25 approved. Route deviation verified by GPS.", "批准部分退款 S$3.25。GPS 已核实路线偏离。", "complete"),
  ev("e8", "execution_router", "execution_route", "Execution Route", "执行路径", "Automated execution: refund S$3.25 to rider.", "自动执行：向乘客退款 S$3.25。", "complete"),
];

const demo1Evidence: EvidenceItem[] = [
  { id: "ev1", label: "GPS route recorded", category: "verified", detail: "35 min actual / 28 min estimated", labelZh: "GPS 路线已记录", detailZh: "实际 35 分钟 / 预估 28 分钟" },
  { id: "ev2", label: "Fare S$18.50", category: "verified", detail: "2.3 km deviation · S$3.25 disputed", labelZh: "车费 S$18.50", detailZh: "偏离 2.3 公里 · 争议 S$3.25" },
  { id: "ev3", label: "Reason for detour", category: "disputed", detail: "Traffic vs driver choice", labelZh: "绕路原因", detailZh: "交通状况还是司机选择" },
  { id: "ev4", label: "Driver intent", category: "missing", detail: "No supporting communication", labelZh: "司机意图", detailZh: "没有相关沟通记录" },
];

const demo2Events: TribunalEvent[] = [
  ev("e1", "rider_advocate", "statement", "Rider Advocate Statement", "乘客代理陈述", "The rider disputes the S$5 cancellation fee. Claims they were not properly notified.", "乘客对 S$5 取消费提出异议。声称未收到适当通知。", "complete"),
  ev("e2", "driver_advocate", "statement", "Driver Advocate Statement", "司机代理陈述", "Driver arrived at 08:43, waited the full timer, attempted contact at 08:47.", "司机于 08:43 到达，等待了完整计时时间，于 08:47 尝试联系。", "complete"),
  ev("e3", "initial_prosecutor", "evidence_audit", "Evidence Audit", "证据审查", "Driver arrival: 08:43:00. Notification sent: 08:43:05. Timer expiry: 08:48:10. Cancellation: 08:51:00.", "司机到达：08:43:00。通知发送：08:43:05。计时器到期：08:48:10。取消：08:51:00。", "complete"),
  ev("e4", "cross_examination", "targeted_question", "Targeted Question", "针对性提问", "Did the rider receive the app notification at 08:43:05?", "乘客是否在 08:43:05 收到了应用通知？", "complete"),
  ev("e4b", "cross_examination", "claim_response", "Rider Response", "乘客回应", "Rider: \"I never got a notification that the driver had arrived.\" Recorded as a CLAIM. The app log shows the notification was delivered at 08:43:05.", "乘客：“我从未收到司机已到达的通知。”记录为 CLAIM。应用日志显示通知已于 08:43:05 送达。", "complete"),
  ev("e5", "final_prosecutor", "verified_summary", "Verified Summary", "核实摘要", "Verified: driver waited allocated time. Verified: notification sent. No evidence rider was prevented from arriving.", "已核实：司机等待了规定时间。已核实：通知已发送。无证据表明乘客被阻止到达。", "complete"),
  ev("e6", "policy_consultant", "policy_application", "Applicable Policy", "适用政策", "Ryde Policy 3.1: no-show fee applies when driver arrives and waits the full allocated timer.", "Ryde 政策 3.1：当司机到达并等待了完整规定时间时，适用未到场费用。", "complete"),
  ev("e7", "ai_judge", "decision", "AI Judge Decision", "AI 法官裁决", "No refund. Driver followed procedure. Fee is valid.", "不予退款。司机遵循了流程。费用有效。", "complete"),
  ev("e8", "execution_router", "execution_route", "Execution Route", "执行路径", "Automated execution: no refund issued. Fee stands.", "自动执行：不予退款。费用维持。", "complete"),
];

const demo2Evidence: EvidenceItem[] = [
  { id: "ev1", label: "Driver arrival time", category: "verified", detail: "08:43:00", labelZh: "司机到达时间" },
  { id: "ev2", label: "App notification sent", category: "verified", detail: "08:43:05", labelZh: "应用通知已发送" },
  { id: "ev3", label: "Waiting timer completed", category: "verified", detail: "Started 08:43:10 · threshold 08:48:10", labelZh: "等待计时完成", detailZh: "08:43:10 开始 · 08:48:10 达到阈值" },
  { id: "ev4", label: "Rider explanation", category: "disputed", detail: "No evidence of prevented arrival", labelZh: "乘客解释", detailZh: "没有证据表明乘客被阻止到达" },
];

const demo3Events: TribunalEvent[] = [
  ev("e1", "rider_advocate", "statement", "Rider Advocate Statement", "乘客代理陈述", "The rider disputes the S$60 cleaning fee. They claim the car was clean when they exited.", "乘客对 S$60 清洁费提出异议。声称下车时车辆是干净的。", "complete"),
  ev("e2", "driver_advocate", "statement", "Driver Advocate Statement", "司机代理陈述", "Driver reports a mess in the back seat. Submitted photo and cleaning receipt.", "司机报告后座有污渍。提交了照片和清洁收据。", "complete"),
  ev("e3", "initial_prosecutor", "evidence_audit", "Evidence Audit", "证据审查", "Photo: inconsistent lighting / possible reuse. Receipt: valid, S$60. EXIF: timestamp mismatch with trip end.", "照片：光线不一致 / 可能重复使用。收据：有效，S$60。EXIF：时间戳与行程结束时间不匹配。", "complete"),
  ev("e4", "cross_examination", "targeted_question", "Targeted Question", "针对性提问", "Can the driver explain the EXIF timestamp mismatch?", "司机能否解释 EXIF 时间戳不匹配的问题？", "complete"),
  ev("e4b", "cross_examination", "claim_response", "Driver Response", "司机回应", "Driver: \"I took the photo right after drop-off. My phone clock may be wrong.\" Recorded as a CLAIM. Not verified.", "司机：“我在乘客下车后立即拍了照片，可能是手机时间不准。”记录为 CLAIM，未经核实。", "complete"),
  ev("e5", "final_prosecutor", "verified_summary", "Verified Summary", "核实摘要", "Verified: receipt is genuine. Disputed: photo appears reused. Missing: direct evidence linking mess to this rider.", "已核实：收据真实。争议：照片疑似重复使用。缺失：直接证据将该污渍与本次乘客关联。", "complete"),
  ev("e6", "policy_consultant", "policy_application", "Applicable Policy", "适用政策", "Ryde Policy 5.3: cleaning fees require photo + receipt with correct timestamp linkage.", "Ryde 政策 5.3：清洁费要求照片 + 收据，且时间戳正确关联。", "complete"),
  ev("e7", "ai_judge", "decision", "AI Judge Decision", "AI 法官裁决", "Human review required. Evidence is insufficient and photo shows reuse risk.", "需要人工审查。证据不足，且照片显示重复使用风险。", "complete"),
  ev("e8", "execution_router", "execution_route", "Execution Route", "执行路径", "Automation stopped. Human review required before any payout.", "自动化已停止。任何付款前需要人工审查。", "complete"),
];

const demo3Evidence: EvidenceItem[] = [
  { id: "ev1", label: "Cleaning receipt", category: "verified", detail: "Valid, S$60, OCR confidence 0.93", labelZh: "清洁收据", detailZh: "有效，S$60，OCR 置信度 0.93" },
  { id: "ev2", label: "Photo timestamp", category: "disputed", detail: "EXIF mismatch with trip end", labelZh: "照片时间戳", detailZh: "EXIF 与行程结束时间不符" },
  { id: "ev3", label: "Photo authenticity", category: "disputed", detail: "Inconsistent lighting, possible reuse", labelZh: "照片真实性", detailZh: "光线不一致，可能重复使用" },
  { id: "ev4", label: "Mess linked to rider", category: "missing", detail: "No direct evidence", labelZh: "污渍与乘客的关联", detailZh: "没有直接证据" },
];

const demo3Fraud: FraudSignal[] = [
  { id: "f1", label: "Recycled photo risk", risk: "high", detail: "EXIF timestamp mismatch", labelZh: "照片重复使用风险", detailZh: "EXIF 时间戳不符" },
  { id: "f2", label: "Receipt amount vs claim", risk: "medium", detail: "Receipt S$60, claimed S$60", labelZh: "收据金额与索赔", detailZh: "收据 S$60，索赔 S$60" },
];

export const tribunalFixtures: Record<string, TribunalFixture> = {
  "DISP-001": {
    demoId: "1",
    caseId: "DISP-001",
    titleEn: "Route Deviation",
    titleZh: "路线偏离",
    events: demo1Events,
    evidence: demo1Evidence,
    policyClause: "Ryde Policy 4.2: route deviation refunds apply when GPS confirms unnecessary extra distance.",
    policyClauseZh: "Ryde 政策 4.2：当 GPS 确认存在不必要额外距离时，适用路线偏离退款。",
    judgeConfidence: 0.89,
    executionRoute: "automated",
  },
  "DISP-002": {
    demoId: "2",
    caseId: "DISP-002",
    titleEn: "No-show Charge",
    titleZh: "未到场费用",
    events: demo2Events,
    evidence: demo2Evidence,
    policyClause: "Ryde Policy 3.1: no-show fee applies when driver arrives and waits the full allocated timer.",
    policyClauseZh: "Ryde 政策 3.1：当司机到达并等待了完整规定时间时，适用未到场费用。",
    judgeConfidence: 0.94,
    executionRoute: "automated",
  },
  "DISP-004": {
    demoId: "3",
    caseId: "DISP-004",
    titleEn: "Cleaning Fee",
    titleZh: "清洁费",
    events: demo3Events,
    evidence: demo3Evidence,
    fraudSignals: demo3Fraud,
    policyClause: "Ryde Policy 5.3: cleaning fees require photo + receipt with correct timestamp linkage.",
    policyClauseZh: "Ryde 政策 5.3：清洁费要求照片 + 收据，且时间戳正确关联。",
    judgeConfidence: 0.62,
    executionRoute: "human_review",
  },
};

export function getTribunalFixture(caseId: string): TribunalFixture | undefined {
  return tribunalFixtures[caseId];
}

export function getFixtureByDemoId(demoId: "1" | "2" | "3"): TribunalFixture | undefined {
  return Object.values(tribunalFixtures).find((f) => f.demoId === demoId);
}
