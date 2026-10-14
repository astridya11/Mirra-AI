import type { DemoId } from "@/src/types/session";

/**
 * Presentation copy for the Demo Selection and Demo Briefing pages (EN / 中文).
 * Facts mirror the current scenarios (demoScenarios.ts, tribunalFixtures.ts) and the
 * verified LIVE outcomes; prototype values are deliberately not used.
 */
export interface DemoBriefing {
  id: DemoId;
  icon: string;
  title: string;
  theme: string;
  question: string;
  summary: string;
  capabilities: string[];
  scenario: string;
  startsFrom: string;
  proves: string[];
  outcome: { headline: string; tone: "green" | "slate" | "amber"; lines: string[] };
  presenter: { say: string; watch: string; next: string };
}

const EN: Record<DemoId, DemoBriefing> = {
  "1": {
    id: "1",
    icon: "🧭",
    title: "Route Deviation",
    theme: "Automation",
    question: "Did the driver take an unnecessary longer route?",
    summary: "A rider believes the driver took an unnecessary detour from Marina Bay Sands to Changi Airport T3.",
    capabilities: ["GPS trajectory vs optimal route", "Trip duration and fare breakdown", "Chat records", "Automated refund execution"],
    scenario:
      "Marina Bay Sands → Changi Airport T3, fare S$18.50. GPS shows a 2.3 km deviation onto PIE and 35 minutes against a 28-minute estimate. The rider disputes S$3.25.",
    startsFrom: "Passenger",
    proves: [
      "Private MIRRA helps the rider without notifying the driver",
      "Verified GPS evidence supports the outcome",
      "A clear, low-risk case can be executed automatically",
    ],
    outcome: {
      headline: "S$3.25 partial refund · automated",
      tone: "green",
      lines: ["2.3 km deviation verified by GPS", "Refund of the extra distance and time", "Executed automatically by the Execution Router"],
    },
    presenter: {
      say: "A rider thinks the trip was longer than it should have been. Watch MIRRA check the GPS before anyone is blamed.",
      watch: "The driver's phone stays unchanged while the rider talks to MIRRA privately.",
      next: "Begin the Guided Demo and open MIRRA AI on the passenger phone.",
    },
  },
  "2": {
    id: "2",
    icon: "⏱️",
    title: "No-show Charge",
    theme: "Fairness",
    question: "Was the S$5 no-show fee fair?",
    summary: "A rider disputes a S$5 no-show fee after the driver waited at Tiong Bahru Plaza.",
    capabilities: ["Driver arrival verification", "Waiting timer", "App notifications and call log", "Policy-grounded ruling"],
    scenario:
      "Tiong Bahru Plaza → VivoCity. The driver arrived at 08:43, the rider was notified at 08:43:05, the timer started at 08:43:10, the driver called at 08:47:05, the free waiting period ended at 08:48:10 and the trip was cancelled at 08:51 with a S$5 no-show fee.",
    startsFrom: "Passenger",
    proves: [
      "MIRRA does not automatically side with the complainant",
      "Every timeline step is checked against app records",
      "The rider's explanation stays a claim until verified",
    ],
    outcome: {
      headline: "No refund · fee upheld · automated",
      tone: "slate",
      lines: ["Driver followed the no-show procedure", "Rider was notified and called", "Cancellation after the waiting threshold"],
    },
    presenter: {
      say: "Fairness means MIRRA can also tell the complainant no, with the evidence to explain why.",
      watch: "The timeline: 08:43 arrival through 08:51 cancellation.",
      next: "Begin the Guided Demo and ask MIRRA about the waiting timeline on the passenger phone.",
    },
  },
  "3": {
    id: "3",
    icon: "🧽",
    title: "Cleaning Fee",
    theme: "Evidence Intelligence / Responsible AI",
    question: "Should the rider pay a S$60 cleaning fee?",
    summary: "A driver claims a S$60 cleaning fee after a trip from Orchard to Bishan, with photo and receipt evidence.",
    capabilities: ["Image and EXIF analysis", "Receipt OCR", "Recycled-photo detection", "Human review and simulated payment"],
    scenario:
      "Orchard → Bishan, fare S$24.50. The driver files a S$60 cleaning-fee claim through Evidence Intake. MIRRA checks the photo and receipt and stops automation when the evidence is insufficient or suspicious.",
    startsFrom: "Driver",
    proves: [
      "Evidence is collected, then frozen when the tribunal starts",
      "Suspicious evidence is flagged instead of trusted",
      "A human decides before any money moves",
    ],
    outcome: {
      headline: "Human review required",
      tone: "amber",
      lines: [
        "No cleaning fee and no payout while review is pending",
        "Reviewer confirms, modifies or rejects in Human Review",
        "Simulated Ryde payment only after an approved review",
      ],
    },
    presenter: {
      say: "Responsible AI means knowing when not to decide. Here MIRRA hands the money decision to a person.",
      watch: "Automation stops at the Execution Router, then the reviewer's decision reaches both phones.",
      next: "Begin the Guided Demo and start the cleaning-fee claim on the driver phone.",
    },
  },
};

const ZH: Record<DemoId, DemoBriefing> = {
  "1": {
    ...EN["1"],
    title: "路线偏离",
    theme: "自动化",
    question: "司机是否走了不必要的远路？",
    summary: "乘客认为司机从滨海湾金沙到樟宜机场第三航站楼时绕了不必要的远路。",
    capabilities: ["GPS 轨迹与最优路线对比", "行程时长与车费明细", "聊天记录", "自动执行退款"],
    scenario:
      "滨海湾金沙 → 樟宜机场第三航站楼，车费 S$18.50。GPS 显示偏离 2.3 公里进入 PIE，实际 35 分钟，预估 28 分钟。乘客争议金额 S$3.25。",
    startsFrom: "乘客",
    proves: ["私人 MIRRA 协助乘客，不会通知司机", "已核实的 GPS 证据支持结果", "清晰、低风险的案件可以自动执行"],
    outcome: {
      headline: "部分退款 S$3.25 · 自动执行",
      tone: "green",
      lines: ["GPS 核实偏离 2.3 公里", "退还额外里程和时间费用", "由执行路由自动执行"],
    },
    presenter: {
      say: "乘客认为行程比应有的更长。看 MIRRA 在追究任何人之前先核查 GPS。",
      watch: "乘客私下与 MIRRA 对话时，司机手机保持不变。",
      next: "开始引导演示，在乘客手机上打开 MIRRA AI。",
    },
  },
  "2": {
    ...EN["2"],
    title: "未到场费用",
    theme: "公平性",
    question: "S$5 未到场费是否公平？",
    summary: "司机在中峇鲁广场等候后，乘客对 S$5 未到场费提出异议。",
    capabilities: ["司机到达核实", "等候计时", "应用通知与通话记录", "基于政策的裁决"],
    scenario:
      "中峇鲁广场 → 怡丰城。司机 08:43 到达，乘客 08:43:05 收到通知，计时器 08:43:10 开始，司机 08:47:05 致电，免费等候期 08:48:10 结束，行程 08:51 取消并收取 S$5 未到场费。",
    startsFrom: "乘客",
    proves: ["MIRRA 不会自动偏袒投诉方", "时间线的每一步都与应用记录核对", "乘客的解释在核实前始终是 CLAIM"],
    outcome: {
      headline: "不予退款 · 费用维持 · 自动执行",
      tone: "slate",
      lines: ["司机遵循了未到场流程", "乘客已收到通知并接到来电", "在等候阈值之后取消"],
    },
    presenter: {
      say: "公平意味着 MIRRA 也可以对投诉方说不，并用证据解释原因。",
      watch: "时间线：08:43 到达至 08:51 取消。",
      next: "开始引导演示，在乘客手机上询问 MIRRA 等候时间线。",
    },
  },
  "3": {
    ...EN["3"],
    title: "清洁费",
    theme: "证据智能 / 负责任 AI",
    question: "乘客是否应支付 S$60 清洁费？",
    summary: "从乌节路到碧山的行程后，司机凭照片和收据申请 S$60 清洁费。",
    capabilities: ["图像与 EXIF 分析", "收据 OCR", "重复照片检测", "人工审核与模拟支付"],
    scenario:
      "乌节路 → 碧山，车费 S$24.50。司机通过证据提交申请 S$60 清洁费。MIRRA 核查照片和收据，在证据不足或可疑时停止自动执行。",
    startsFrom: "司机",
    proves: ["证据先收集，仲裁开始时冻结", "可疑证据会被标记，而不是直接采信", "任何资金变动前由人工决定"],
    outcome: {
      headline: "需要人工审核",
      tone: "amber",
      lines: ["审核期间不收费、不付款", "审核员在人工审核中确认、修改或拒绝", "仅在审核批准后执行模拟 Ryde 支付"],
    },
    presenter: {
      say: "负责任的 AI 意味着知道何时不该自己决定。这里 MIRRA 把涉及金钱的决定交给人。",
      watch: "自动执行在执行路由处停止，随后审核员的决定同步到双方手机。",
      next: "开始引导演示，在司机手机上开始清洁费索赔。",
    },
  },
};

export function briefingFor(id: string, locale: "en" | "zh"): DemoBriefing | undefined {
  return (locale === "zh" ? ZH : EN)[id as DemoId];
}

export const DEMO_IDS: DemoId[] = ["1", "2", "3"];
