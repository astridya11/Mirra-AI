export interface PresenterStep {
  say: string;
  watch: string;
  proves: string;
  expected: string;
  next: string;
}

type Script = Record<string, Record<string, PresenterStep>>;

const EN: Script = {
  "1": {
    none: {
      say: "A passenger has completed a trip from Marina Bay Sands to Changi Airport T3. The fare is S$18.50.",
      watch: "Both Passenger and Driver see the same trip summary.",
      proves: "MIRRA starts from a shared, objective trip record.",
      expected: "No dispute is visible yet.",
      next: "Open MIRRA AI on the Passenger phone.",
    },
    private_support: {
      say: "The passenger is asking MIRRA for help privately. This is not yet a formal complaint.",
      watch: "The Driver phone stays unchanged.",
      proves: "MIRRA protects private pre-dispute support.",
      expected: "No dispute is visible to the Driver yet.",
      next: "Submit formal complaint, then Proceed with complaint.",
    },
    formal_filed: {
      say: "The passenger has filed a formal complaint. The shared dispute is now visible to both parties.",
      watch: "Both phones show the complaint banner; the private chat stays private.",
      proves: "The boundary between private support and a formal dispute is explicit.",
      expected: "Driver sees 'Dispute received'.",
      next: "Start the Tribunal.",
    },
    under_review: {
      say: "The Tribunal is in session. Evidence is frozen and no new evidence can be added.",
      watch: "Agents run in order; the Execution Router is always last.",
      proves: "MIRRA enforces evidence freeze and structured deliberation.",
      expected: "GPS confirms the 2.3 km deviation.",
      next: "Wait for the AI Judge decision.",
    },
    resolved: {
      say: "The AI Judge approved a S$3.25 partial refund and the Execution Router executed it automatically.",
      watch: "Both parties see the same ruling in role-appropriate language.",
      proves: "MIRRA can safely automate low-risk, evidence-backed outcomes.",
      expected: "Passenger: 'S$3.25 refund approved'. Driver: 'S$3.25 refunded to the rider'.",
      next: "Reset and replay, or continue to Demo 2.",
    },
  },
  "2": {
    none: {
      say: "A ride from Tiong Bahru Plaza to VivoCity was cancelled and a S$5 no-show fee was applied.",
      watch: "Both Passenger and Driver see the cancelled trip with the fee.",
      proves: "MIRRA starts from a shared, objective trip record.",
      expected: "No dispute is visible yet.",
      next: "Open MIRRA AI on the Passenger phone.",
    },
    private_support: {
      say: "The passenger privately asks MIRRA about the fee. MIRRA walks through the waiting timeline.",
      watch: "08:43 arrival, 08:43:05 notification, 08:47:05 call, 08:48:10 threshold, 08:51 cancellation.",
      proves: "MIRRA protects private pre-dispute support.",
      expected: "No dispute is visible to the Driver yet.",
      next: "Submit formal complaint, then Proceed with complaint.",
    },
    formal_filed: {
      say: "The passenger has filed a formal dispute. Both parties now see the shared claim.",
      watch: "Both phones show the complaint banner.",
      proves: "The boundary between private support and a formal dispute is explicit.",
      expected: "Driver sees 'Dispute received'.",
      next: "Start the Tribunal.",
    },
    under_review: {
      say: "The Tribunal checks driver arrival, notifications, the call and the waiting timer.",
      watch: "The rider's answer in cross-examination stays a CLAIM.",
      proves: "MIRRA evaluates the evidence, not who complained.",
      expected: "Evidence confirms the driver followed procedure.",
      next: "Wait for the AI Judge decision.",
    },
    resolved: {
      say: "The AI Judge decided no refund: the driver followed procedure and the S$5 fee is valid.",
      watch: "Both parties see the same ruling in role-appropriate language.",
      proves: "MIRRA does not automatically side with the complainant.",
      expected: "Both phones show 'No refund'.",
      next: "Reset and replay, or continue to Demo 3.",
    },
  },
  "3": {
    none: {
      say: "After a trip from Orchard to Bishan, the driver wants to claim a S$60 cleaning fee.",
      watch: "Both phones show the same trip. Nothing has been charged.",
      proves: "MIRRA starts from a shared, objective trip record.",
      expected: "No claim is visible yet.",
      next: "Open MIRRA AI on the Driver phone.",
    },
    private_support: {
      say: "The driver privately asks MIRRA about the claim. MIRRA explains the photo and receipt requirements.",
      watch: "The Passenger phone stays unchanged.",
      proves: "MIRRA protects private pre-dispute support.",
      expected: "No claim is visible to the Passenger yet.",
      next: "Start cleaning-fee claim, add the photo and receipt, then Submit Claim.",
    },
    formal_filed: {
      say: "The driver has filed the S$60 cleaning-fee claim with evidence. Both parties now see it.",
      watch: "The Passenger phone shows 'Dispute received'.",
      proves: "Evidence is collected before deliberation starts.",
      expected: "Evidence is frozen as soon as the Tribunal starts.",
      next: "Start the Tribunal.",
    },
    under_review: {
      say: "The Tribunal examines the photo, receipt, EXIF and OCR. Fraud signals are detected.",
      watch: "Disputed photo evidence and a high reuse risk.",
      proves: "MIRRA understands when evidence is insufficient or suspicious.",
      expected: "Photo shows reuse risk. The S$60 receipt is valid but does not link the mess to this rider.",
      next: "Wait for the AI Judge decision.",
    },
    resolved: {
      say: "MIRRA stopped automation. A human reviewer must decide before any cleaning fee is charged.",
      watch: "Both phones show 'Under human review'; no fee and no payout.",
      proves: "MIRRA knows when NOT to automate.",
      expected: "Human review: Confirm, Modify or Reject.",
      next: "Open Human Review.",
    },
  },
};

const ZH: Script = {
  "1": {
    none: {
      say: "乘客完成了从滨海湾金沙到樟宜机场第三航站楼的行程，车费 S$18.50。",
      watch: "乘客和司机看到同一份行程摘要。",
      proves: "MIRRA 从共享、客观的行程记录出发。",
      expected: "目前还没有纠纷。",
      next: "在乘客手机上打开 MIRRA AI。",
    },
    private_support: {
      say: "乘客正在私下向 MIRRA 求助，这还不是正式投诉。",
      watch: "司机手机保持不变。",
      proves: "MIRRA 保护纠纷前的私人协助。",
      expected: "司机还看不到任何纠纷。",
      next: "提交正式投诉，然后继续投诉。",
    },
    formal_filed: {
      say: "乘客已提交正式投诉，双方现在都能看到共享的纠纷。",
      watch: "双方手机显示投诉横幅；私人对话仍然保密。",
      proves: "私人协助与正式纠纷之间的界限是明确的。",
      expected: "司机看到“已收到纠纷”。",
      next: "开始仲裁。",
    },
    under_review: {
      say: "仲裁开始，证据已冻结，不能再添加新证据。",
      watch: "智能体按顺序运行，执行路由始终最后。",
      proves: "MIRRA 强制证据冻结和结构化审议。",
      expected: "GPS 证实偏离 2.3 公里。",
      next: "等待 AI 法官裁决。",
    },
    resolved: {
      say: "AI 法官批准部分退款 S$3.25，执行路由已自动执行。",
      watch: "双方用各自适合的措辞看到同一裁决。",
      proves: "MIRRA 可以安全地自动执行低风险、有证据支持的结果。",
      expected: "乘客：“已批准退款 S$3.25”。司机：“已向乘客退款 S$3.25”。",
      next: "重置重播，或继续演示 2。",
    },
  },
  "2": {
    none: {
      say: "从中峇鲁广场到怡丰城的行程被取消，并收取了 S$5 未到场费。",
      watch: "乘客和司机都看到已取消的行程及费用。",
      proves: "MIRRA 从共享、客观的行程记录出发。",
      expected: "目前还没有纠纷。",
      next: "在乘客手机上打开 MIRRA AI。",
    },
    private_support: {
      say: "乘客私下询问 MIRRA 这笔费用，MIRRA 逐步说明等候时间线。",
      watch: "08:43 到达、08:43:05 通知、08:47:05 来电、08:48:10 阈值、08:51 取消。",
      proves: "MIRRA 保护纠纷前的私人协助。",
      expected: "司机还看不到任何纠纷。",
      next: "提交正式投诉，然后继续投诉。",
    },
    formal_filed: {
      say: "乘客已提交正式争议，双方现在都能看到共享的诉求。",
      watch: "双方手机显示投诉横幅。",
      proves: "私人协助与正式纠纷之间的界限是明确的。",
      expected: "司机看到“已收到纠纷”。",
      next: "开始仲裁。",
    },
    under_review: {
      say: "仲裁核查司机到达、通知、来电和等候计时。",
      watch: "乘客在交叉质询中的回答始终是 CLAIM。",
      proves: "MIRRA 评估证据，而不是看谁投诉。",
      expected: "证据确认司机遵循了流程。",
      next: "等待 AI 法官裁决。",
    },
    resolved: {
      say: "AI 法官裁定不予退款：司机遵循了流程，S$5 费用有效。",
      watch: "双方用各自适合的措辞看到同一裁决。",
      proves: "MIRRA 不会自动偏袒投诉方。",
      expected: "双方手机都显示“不予退款”。",
      next: "重置重播，或继续演示 3。",
    },
  },
  "3": {
    none: {
      say: "从乌节路到碧山的行程结束后，司机想申请 S$60 清洁费。",
      watch: "双方手机显示同一行程，目前没有任何扣费。",
      proves: "MIRRA 从共享、客观的行程记录出发。",
      expected: "目前还没有索赔。",
      next: "在司机手机上打开 MIRRA AI。",
    },
    private_support: {
      say: "司机私下向 MIRRA 咨询索赔，MIRRA 说明照片和收据要求。",
      watch: "乘客手机保持不变。",
      proves: "MIRRA 保护纠纷前的私人协助。",
      expected: "乘客还看不到任何索赔。",
      next: "开始清洁费索赔，添加照片和收据，然后提交索赔。",
    },
    formal_filed: {
      say: "司机已凭证据提交 S$60 清洁费索赔，双方现在都能看到。",
      watch: "乘客手机显示“已收到纠纷”。",
      proves: "证据在审议开始前收集。",
      expected: "仲裁一开始证据即被冻结。",
      next: "开始仲裁。",
    },
    under_review: {
      say: "仲裁检查照片、收据、EXIF 和 OCR，并发现欺诈信号。",
      watch: "有争议的照片证据和高重复使用风险。",
      proves: "MIRRA 能识别证据不足或可疑的情况。",
      expected: "照片存在重复使用风险。S$60 收据有效，但无法证明污渍与该乘客有关。",
      next: "等待 AI 法官裁决。",
    },
    resolved: {
      say: "MIRRA 停止了自动执行。在收取任何清洁费之前，必须由人工审核员决定。",
      watch: "双方手机显示“正在人工审核”：不收费、不付款。",
      proves: "MIRRA 知道何时不应自动执行。",
      expected: "人工审核：确认、修改或拒绝。",
      next: "打开人工审核。",
    },
  },
};

export function getPresenterStep(demoId: string, stage: string, locale: "en" | "zh" = "en"): PresenterStep | undefined {
  return (locale === "zh" ? ZH : EN)[demoId]?.[stage];
}
