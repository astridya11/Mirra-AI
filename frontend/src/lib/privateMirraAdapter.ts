import type { Locale } from "@/src/i18n/config";
import type { DemoId, Party, PrivateChat } from "@/src/types/session";

export interface MirraInput {
  demoId: DemoId;
  party: Party;
  message: string;
  locale: Locale;
  chat: PrivateChat;
  tripStatus?: string;
}

export interface MirraOutput {
  response: string;
  suggestions: string[];
  action?: "draft_complaint" | "file_complaint" | "none";
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/[?!.]+$/, "");
}

function containsAny(text: string, keywords: string[]): boolean {
  const n = normalize(text);
  return keywords.some((k) => n.includes(k.toLowerCase()));
}

const responses: Record<
  DemoId,
  Record<
    Party,
    Array<{
      match: string[];
      responseEn: string;
      responseZh: string;
      suggestionsEn: string[];
      suggestionsZh: string[];
      action?: MirraOutput["action"];
    }>
  >
> = {
  "1": {
    passenger: [
      {
        match: ["comparison", "compare", "gps", "view route", "轨迹", "对比"],
        responseEn:
          "The trip shows a 35-minute actual duration versus a 28-minute estimated route. GPS confirms a 2.3 km deviation onto PIE. The fare is S$18.50. Would you like to understand the charge breakdown or proceed with a formal complaint?",
        responseZh:
          "行程显示实际用时 35 分钟，而预估路线为 28 分钟。GPS 确认偏离了 2.3 公里进入 PIE。车费为 S$18.50。您希望了解费用明细，还是继续提交正式投诉？",
        suggestionsEn: ["Understand the charge", "Submit formal complaint"],
        suggestionsZh: ["了解费用构成", "提交正式投诉"],
      },
      {
        match: ["route", "longer", "detour", "unnecessary", "绕路", "路线", "远"],
        responseEn:
          "I understand your concern about the route taken. I can privately review the GPS trajectory and fare breakdown with you before any formal action.",
        responseZh:
          "我理解您对行驶路线的担忧。在采取任何正式行动之前，我可以私下为您查看 GPS 轨迹和车费明细。",
        suggestionsEn: ["View route comparison", "Understand the charge"],
        suggestionsZh: ["查看路线对比", "了解费用构成"],
      },
      {
        match: ["charge", "breakdown", "fare", "cost", "费用", "车费", "构成"],
        responseEn:
          "The fare includes a S$3.00 base charge, S$12.50 distance rate and S$3.00 time rate. The disputed amount is S$3.25 from the extra 7 minutes and 2.3 km of deviation. I cannot confirm fault from the trip record alone — a formal complaint would trigger an evidence review.",
        responseZh:
          "车费包含 S$3.00 基础费、S$12.50 里程费和 S$3.00 时间费。争议金额是额外 7 分钟和 2.3 公里偏离产生的 S$3.25。仅凭行程记录我无法确认责任——正式投诉将触发证据审查。",
        suggestionsEn: ["Submit formal complaint", "Back to trip details"],
        suggestionsZh: ["提交正式投诉", "返回行程详情"],
      },
      {
        match: ["complaint", "formal", "dispute", "投诉", "纠纷"],
        responseEn:
          "I can help you draft a formal complaint. This will be shared with the driver and Ryde for review. Your private chat history will remain private. Would you like to proceed?",
        responseZh:
          "我可以协助您起草正式投诉。该投诉将与司机和 Ryde 共享以供审查。您的私人聊天记录将保持私密。您是否希望继续？",
        suggestionsEn: ["Proceed with complaint", "Not yet"],
        suggestionsZh: ["继续投诉", "暂时不"],
        action: "draft_complaint",
      },
    ],
    driver: [
      {
        match: ["route", "followed", "recommended", "路线", "推荐"],
        responseEn:
          "I can see the trip record for this ride. If the passenger raises a concern, the GPS record will be compared with the recommended route and you will be able to explain your route choice. Is there anything else about this trip you'd like to clarify?",
        responseZh:
          "我可以看到本次行程的记录。如果乘客提出异议，GPS 记录将与推荐路线进行对比，您也将有机会说明路线选择。关于本次行程，您还有其他需要澄清的吗？",
        suggestionsEn: ["View my route record", "Help with passenger issue"],
        suggestionsZh: ["查看我的路线记录", "协助处理乘客问题"],
      },
      {
        match: ["passenger", "issue", "concern", "乘客", "问题"],
        responseEn:
          "If the passenger files a formal complaint, you will be notified and given a chance to respond. Your private conversation with me remains confidential. Would you like to review your route or trip details?",
        responseZh:
          "如果乘客提交正式投诉，您将收到通知并有机会回应。您与我的私人对话将保密。您希望查看路线或行程详情吗？",
        suggestionsEn: ["View my route record", "What happens next?"],
        suggestionsZh: ["查看我的路线记录", "接下来会发生什么？"],
      },
    ],
  },
  "2": {
    passenger: [
      {
        match: ["policy", "政策"],
        responseEn:
          "Ryde's no-show policy: once the driver arrives and the rider is notified, a free waiting period runs. If the rider has not arrived when it ends, the driver may cancel and a S$5 no-show fee applies. You can still file a formal dispute if you think the record is wrong.",
        responseZh:
          "Ryde 未到场政策：司机到达并通知乘客后，会开始免费等候期。如果等候期结束时乘客仍未到达，司机可以取消行程，并收取 S$5 未到场费。如果您认为记录有误，仍可提交正式争议。",
        suggestionsEn: ["Check waiting timeline", "Submit formal complaint"],
        suggestionsZh: ["查看等候时间线", "提交正式投诉"],
      },
      {
        match: ["cancel", "cancellation", "fee", "charged", "why", "取消费", "费用", "为什么"],
        responseEn:
          "I can see a S$5 cancellation fee was applied. The driver arrived at the pickup point and waited for the allocated timer. I can privately review the waiting timeline and app notifications with you.",
        responseZh:
          "我看到一笔 S$5 的取消费已产生。司机到达接车点并等待了规定的计时时间。我可以私下为您查看等候时间线和应用通知记录。",
        suggestionsEn: ["Check waiting timeline", "Understand cancellation policy"],
        suggestionsZh: ["查看等候时间线", "了解取消政策"],
      },
      {
        match: ["waiting", "timer", "timeline", "wait", "等候", "计时"],
        responseEn:
          "The record shows the driver arrived at 08:43. You were notified at 08:43:05 and the waiting timer started at 08:43:10. The driver called you at 08:47:05. The free waiting period ended at 08:48:10 and the trip was cancelled at 08:51, with the S$5 no-show fee. Would you like to proceed with a formal dispute?",
        responseZh:
          "记录显示司机于 08:43 到达。您在 08:43:05 收到通知，等候计时器于 08:43:10 开始。司机在 08:47:05 致电给您。免费等候期于 08:48:10 结束，行程于 08:51 取消，并收取 S$5 未到场费。您是否希望继续提交正式争议？",
        suggestionsEn: ["Submit formal complaint", "Back to trip details"],
        suggestionsZh: ["提交正式投诉", "返回行程详情"],
      },
    ],
    driver: [
      {
        match: ["rider", "arrive", "hasn't", "waiting", "乘客", "没到", "等候"],
        responseEn:
          "I understand you waited for the rider. The record shows you arrived at 08:43, the rider was notified at 08:43:05 and the free waiting period ended at 08:48:10. If the rider disputes the S$5 no-show fee, this timeline will be reviewed.",
        responseZh:
          "我理解您等候了乘客。记录显示您于 08:43 到达，乘客于 08:43:05 收到通知，免费等候期于 08:48:10 结束。如果乘客对 S$5 未到场费提出异议，将审查这一时间线。",
        suggestionsEn: ["Check waiting timer", "Help me contact the rider"],
        suggestionsZh: ["查看等候计时器", "协助联系乘客"],
      },
      {
        match: ["contact", "message", "call", "联系", "消息"],
        responseEn:
          "You can use the in-app chat or call button to reach the rider. Please note that any communication may be reviewed if a dispute is filed later. Is there anything else I can help with?",
        responseZh:
          "您可以使用应用内聊天或通话按钮联系乘客。请注意，如果之后产生争议，相关通讯记录可能会被审查。还有其他我可以帮助的吗？",
        suggestionsEn: ["Check waiting timer", "Back to trip"],
        suggestionsZh: ["查看等候计时器", "返回行程"],
      },
    ],
  },
  "3": {
    passenger: [
      {
        match: ["policy", "政策"],
        responseEn:
          "Ryde's cleaning-fee policy: a driver must provide a photo of the affected area and a cleaning receipt. MIRRA checks photo timestamps and receipts, and a human reviewer approves any fee before it is charged.",
        responseZh:
          "Ryde 清洁费政策：司机必须提供受影响区域的照片和清洁收据。MIRRA 会核查照片时间戳和收据，任何费用在扣取前都需经人工审核员批准。",
        suggestionsEn: ["Review submitted evidence", "Submit formal complaint"],
        suggestionsZh: ["查看已提交的证据", "提交正式投诉"],
      },
      {
        match: ["extra", "charge", "cleaning", "what", "清洁费", "额外", "费用"],
        responseEn:
          "The driver may file a S$60 cleaning-fee claim for this trip. Nothing has been charged: any cleaning fee needs evidence review and human approval first. I can privately explain how this works.",
        responseZh:
          "司机可能会就本次行程提交 S$60 清洁费索赔。目前没有任何扣费：任何清洁费都需要先经过证据审查和人工批准。我可以私下为您说明流程。",
        suggestionsEn: ["Review submitted evidence", "Understand cleaning policy"],
        suggestionsZh: ["查看已提交的证据", "了解清洁政策"],
      },
      {
        match: ["evidence", "photo", "receipt", "证据", "照片", "收据"],
        responseEn:
          "A cleaning-fee claim must include evidence. If one is filed, it goes through a full evidence review, including photo EXIF checks and receipt OCR, and a human reviewer decides before anything is charged.",
        responseZh:
          "清洁费索赔必须附带证据。一旦提交，将进行完整的证据审查，包括照片 EXIF 检查和收据 OCR，并由人工审核员在任何扣费前做出决定。",
        suggestionsEn: ["Submit formal complaint", "Understand cleaning policy"],
        suggestionsZh: ["提交正式投诉", "了解清洁政策"],
      },
    ],
    driver: [
      {
        match: ["mess", "clean", "vomit", "spill", "stain", "污渍", "脏", "清洁"],
        responseEn:
          "I understand there was a cleaning incident. To support a cleaning-fee claim, you will need a photo of the affected area and ideally a professional cleaning receipt. I can guide you through the evidence requirements.",
        responseZh:
          "我理解发生了清洁事件。为了支持清洁费索赔，您需要提供受影响区域的照片，最好还有专业清洁收据。我可以指导您了解证据要求。",
        suggestionsEn: ["What evidence is required?", "Start cleaning-fee claim"],
        suggestionsZh: ["需要什么证据？", "开始清洁费索赔"],
      },
      {
        match: ["evidence", "required", "photo", "receipt", "证据", "照片", "收据"],
        responseEn:
          "Required evidence: (1) Clear photo of the affected area with timestamp, (2) Professional cleaning receipt with service details. Optional: EXIF data from the photo to verify it was taken at the correct time and location. Would you like to start the claim process?",
        responseZh:
          "所需证据：(1) 受影响区域的清晰照片及时间戳，(2) 包含服务详情的专业清洁收据。可选：照片的 EXIF 数据，以验证拍摄时间和地点是否正确。您是否希望开始索赔流程？",
        suggestionsEn: ["Start cleaning-fee claim", "Back to trip"],
        suggestionsZh: ["开始清洁费索赔", "返回行程"],
      },
    ],
  },
};

const COMPLAINT_PROCEED = ["proceed with complaint", "继续投诉"];
const START_CLEANING_CLAIM = ["start cleaning-fee claim", "start cleaning fee claim", "开始清洁费索赔"];
const COMPLAINT_INTENT = ["complaint", "formal", "dispute", "投诉", "争议", "纠纷"];
const NOT_YET = ["not yet", "暂时不"];

/**
 * Private MIRRA → formal complaint boundary:
 *   "Submit formal complaint" → MIRRA explains what is and is not shared (draft_complaint)
 *   "Proceed with complaint"  → the complaint form opens directly (file_complaint)
 * Demo 3 driver: "Start cleaning-fee claim" opens Evidence Intake directly.
 */
function complaintFlow(demoId: DemoId, party: Party, message: string, locale: Locale): MirraOutput | null {
  const zh = locale === "zh";
  const other = party === "passenger" ? (zh ? "司机" : "the driver") : zh ? "乘客" : "the rider";
  if (demoId === "3" && party === "driver" && containsAny(message, START_CLEANING_CLAIM)) {
    return {
      response: zh ? "好的，正在打开证据提交。请上传照片和清洁收据。" : "Opening Evidence Intake. Please add a photo and the cleaning receipt.",
      suggestions: [],
      action: "file_complaint",
    };
  }
  if (containsAny(message, COMPLAINT_PROCEED)) {
    return {
      response: zh ? "好的，正在打开正式投诉表单。" : "Opening the formal complaint form.",
      suggestions: [],
      action: "file_complaint",
    };
  }
  if (containsAny(message, NOT_YET)) {
    return {
      response: zh
        ? "没问题。我们的对话不会被分享。您准备好时随时告诉我。"
        : "No problem. Nothing from this conversation has been shared. Let me know when you're ready.",
      suggestions: zh ? ["提交正式投诉", "返回行程详情"] : ["Submit formal complaint", "Back to trip details"],
      action: "none",
    };
  }
  if (containsAny(message, COMPLAINT_INTENT)) {
    return {
      response: zh
        ? `在继续之前请注意：正式投诉将与${other}和 Ryde 共享以供审查。我们的私人对话不会被分享。您是否希望继续？`
        : `Before you continue: a formal complaint is shared with ${other} and Ryde for review. Our private conversation is not shared. Would you like to proceed?`,
      suggestions: zh ? ["继续投诉", "暂时不"] : ["Proceed with complaint", "Not yet"],
      action: "draft_complaint",
    };
  }
  return null;
}

export function getPrivateMirraResponse(input: MirraInput): MirraOutput {
  const { demoId, party, message, locale, chat } = input;

  const flow = complaintFlow(demoId, party, message, locale);
  if (flow) return flow;

  // Try keyword matching first
  const demoResponses = responses[demoId]?.[party] ?? [];
  for (const rule of demoResponses) {
    if (containsAny(message, rule.match)) {
      return {
        response: locale === "zh" ? rule.responseZh : rule.responseEn,
        suggestions:
          locale === "zh"
            ? rule.suggestionsZh.slice(0, 2)
            : rule.suggestionsEn.slice(0, 2),
        action: rule.action ?? "none",
      };
    }
  }

  // Fallback: if user said something like "yes" / "proceed" / "继续"
  if (containsAny(message, ["yes", "proceed", "continue", "sure", "ok", "是", "继续", "好的", " proceed"])) {
    const lastMirra = [...chat.messages].reverse().find((m) => m.sender === "mirra");
    if (lastMirra) {
      for (const rule of demoResponses) {
        const expected = locale === "zh" ? rule.responseZh : rule.responseEn;
        if (lastMirra.text.includes(expected.slice(0, 30))) {
          return {
            response:
              locale === "zh"
                ? "好的，我已经记录了您的意向。如果您准备好提交正式投诉，请告诉我，我可以协助您完成。"
                : "Understood. I've noted your intent. When you're ready to submit a formal complaint, let me know and I can guide you through it.",
            suggestions:
              locale === "zh"
                ? ["提交正式投诉", "返回行程详情"].slice(0, 2)
                : ["Submit formal complaint", "Back to trip details"].slice(0, 2),
            action: rule.action ?? "none",
          };
        }
      }
    }
  }

  // Generic fallback
  const genericEn =
    "I can't confirm that from the current trip record yet. I can help you review available trip information or explain the next steps.";
  const genericZh =
    "目前我还无法从现有行程记录中确认这一点。我可以帮您查看可用的行程信息，或解释接下来的步骤。";

  return {
    response: locale === "zh" ? genericZh : genericEn,
    suggestions:
      locale === "zh"
        ? ["查看行程信息", "解释后续步骤"]
        : ["View trip info", "Explain next steps"],
    action: "none",
  };
}
