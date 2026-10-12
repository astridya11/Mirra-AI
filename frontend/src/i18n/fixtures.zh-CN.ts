/**
 * Offline Demo Mode fixtures (DISP-001 / DISP-002 mock CaseResults): curated Chinese for the
 * agent texts, evidence, facts and explanations, keyed by the exact English source string.
 * Applied to fixtures only — live backend text is never translated.
 */
export const FIXTURE_TEXT_ZH: Record<string, string> = {
  "Fixture · src/mock/cases.ts (CaseResult) — live Judge output connects in Milestone 4": "演示数据 · src/mock/cases.ts（CaseResult）",

  // DISP-001 — route deviation
  "GPS telemetry shows deviation from optimal route.": "GPS 轨迹显示偏离了最优路线。",
  "Optimal route was clear.": "最优路线当时畅通。",
  "Trip duration exceeded optimal by 25%.": "行程时长比最优时长多 25%。",
  "Driver stated GPS auto-rerouted.": "司机称 GPS 自动改道。",
  "Actual route deviated from optimal ECP route to PIE, adding 2.3km to the trip.": "实际路线从最优的 ECP 偏离到 PIE，行程多出 2.3 km。",
  "No verified road closure or incident on ECP at the time of the trip.": "行程期间 ECP 上没有经核实的封路或事故。",
  "Trip duration was 2100s vs optimal 1680s, an increase of 420s (7 minutes).": "行程时长 2100 秒，最优为 1680 秒，多出 420 秒（7 分钟）。",
  "Driver claims GPS auto-rerouted; however, no road closure was verified to justify the reroute.": "司机称 GPS 自动改道，但没有经核实的封路信息可以证明改道合理。",
  "Driver, can you explain why the GPS rerouted to PIE? Was there a road closure on ECP?": "司机，请解释 GPS 为什么改道到 PIE？当时 ECP 上有封路吗？",
  "My Google Maps rerouted me to PIE. I did not see any road closure sign on ECP. I followed the navigation.":
    "我的 Google 地图把我改道到 PIE。我在 ECP 上没有看到任何封路标志，我只是按导航行驶。",
  "Route Deviation and Fare Adjustment": "路线偏离与车费调整",
  "A trip is reviewed for route deviation when the actual route exceeds the optimal route by more than the distance threshold. If no valid reason is verified, the rider is refunded the extra distance and extra time.":
    "当实际路线超出最优路线的距离阈值时，行程会接受路线偏离审查。如果没有经核实的正当理由，将向乘客退还多出的里程和时间费用。",
  "Execution Gate and Escalation": "执行关口与升级",
  "Auto-execution requires confidence >= 0.75, no safety/fraud flags, and amount <= $20.": "自动执行需满足：置信度 >= 0.75、无安全/欺诈标记，且金额 <= $20。",
  "Auto-execution requires confidence >= 0.75, no safety/fraud flags, amount <= $20.": "自动执行需满足：置信度 >= 0.75、无安全/欺诈标记，且金额 <= $20。",
  "Verified GPS telemetry confirms a 2.3km route deviation with no road closure. POL-2 refund formula yields $3.25 SGD. Driver's GPS-reroute explanation does not constitute a valid reason. No fraud or safety flags. Case qualifies for FULLY_AUTOMATED execution.":
    "经核实的 GPS 轨迹确认存在 2.3 km 的路线偏离，且没有封路。按 POL-2 退款公式计算为 $3.25 SGD。司机关于 GPS 改道的说明不构成正当理由。无欺诈或安全标记。本案符合全自动执行条件。",
  "We reviewed your trip and confirmed the driver took a longer route than necessary. A refund of $3.25 SGD has been credited to your payment method. You may appeal or request a human review within 7 days if you disagree.":
    "我们审查了您的行程，确认司机走了比必要更远的路线。$3.25 SGD 退款已退回您的付款方式。如有异议，您可在 7 天内申诉或申请人工复核。",
  "We reviewed the trip and found that the route taken was longer than the optimal route. The system has issued a partial refund to the rider. In future, please verify reroutes with road closure information. You may appeal within 7 days.":
    "我们审查了此次行程，发现实际路线比最优路线更长。系统已向乘客发放部分退款。今后请结合封路信息确认改道。您可在 7 天内申诉。",
  "Driver deviated from the optimal ECP route to PIE without a valid reason, adding 2.3km and 7 extra minutes to the trip. Rider requests a refund for the excess fare charged.":
    "司机在没有正当理由的情况下从最优的 ECP 路线偏离到 PIE，使行程多出 2.3 km 和 7 分钟。乘客要求退还多收的车费。",
  "The GPS navigation app auto-rerouted to PIE. No road closure was detected on ECP, but the reroute was triggered by the navigation system. Driver had no intention to deviate.":
    "GPS 导航 App 自动改道到 PIE。ECP 上未检测到封路，但改道是由导航系统触发的。司机并无意偏离路线。",
  "GPS telemetry confirms a 2.3km route deviation from ECP to PIE with no verified road closure. Driver's explanation of GPS auto-reroute is recorded but does not constitute a valid reason under POL-2. The deviation caused an excess fare of $3.25 SGD.":
    "GPS 轨迹确认从 ECP 到 PIE 存在 2.3 km 的路线偏离，且没有经核实的封路。司机关于 GPS 自动改道的说明已记录，但依据 POL-2 不构成正当理由。该偏离导致多收车费 $3.25 SGD。",
  "POL-2 applies: deviation 2.3km exceeds 1.0km threshold. No valid reason verified. Refund = round(2.3*0.5 + 7*0.3, 2) = $3.25. Amount under $20 auto threshold.":
    "适用 POL-2：偏离 2.3 km，超过 1.0 km 阈值。没有经核实的正当理由。退款 = round(2.3*0.5 + 7*0.3, 2) = $3.25。金额低于 $20 自动执行阈值。",

  // DISP-002 — no-show charge
  "Driver speed 0 at pickup coordinates.": "司机在上车点坐标处速度为 0。",
  "GPS shows 0 speed from 08:43 to 08:51.": "GPS 显示 08:43 至 08:51 速度为 0。",
  "rider_notified event recorded.": "已记录 rider_notified（已通知乘客）事件。",
  "Outgoing call to rider, no answer.": "已致电乘客，无人接听。",
  "cancellation_fee_applied event at 08:51.": "08:51 记录 cancellation_fee_applied（收取取消费）事件。",
  "Driver GPS was within 10m of pickup point at 08:43 (arrival confirmed).": "08:43 司机 GPS 位于上车点 10 米范围内（确认到达）。",
  "Driver stayed at pickup point until cancellation at 08:51 (stationary throughout).": "司机一直停留在上车点，直到 08:51 取消（全程静止）。",
  "Rider was notified of arrival (push notification sent at 08:43:05).": "已通知乘客司机到达（08:43:05 发送推送通知）。",
  "Driver made a contact attempt (call at 08:47:05, rang 22s, no answer).": "司机尝试联系乘客（08:47:05 致电，响铃 22 秒，无人接听）。",
  "Cancellation happened at 08:51, after the no-show threshold of 8 minutes from 08:43 arrival.": "取消发生在 08:51，已超过自 08:43 到达起 8 分钟的未出现时限。",
  "Rider, you claim you arrived within the free waiting period. Can you provide GPS evidence of your arrival time?":
    "乘客，您称自己在免费等候时间内到达。您能提供到达时间的 GPS 证据吗？",
  "I don't have GPS evidence but I was running late. I got to the lobby around 08:50 but the driver had already left.":
    "我没有 GPS 证据，但我当时迟到了。我大约 08:50 到达大堂，但司机已经走了。",
  "No-Show Cancellation Charge": "乘客未出现取消费",
  "Cancellation fee upheld only if ALL conditions are verified: driver GPS within arrival radius, stationary until cancellation, rider notified, contact attempted, cancelled after threshold.":
    "只有全部条件均经核实，取消费才予维持：司机 GPS 在到达半径内、取消前保持静止、已通知乘客、已尝试联系、在时限后取消。",
  "All 5 required conditions under POL-3 are verified by system records. The $5.00 cancellation fee is correctly applied. Rider's claim of arriving within the free waiting period is not substantiated by GPS evidence. Fee is upheld.":
    "POL-3 规定的 5 项条件均已由系统记录核实。$5.00 取消费收取正确。乘客关于在免费等候时间内到达的说法没有 GPS 证据支持。维持收费。",
  "We reviewed your case carefully. Our system records confirm your driver arrived on time and waited beyond the free waiting period. The cancellation fee will remain on your account. You can appeal within 7 days if you have additional evidence, such as location data showing your arrival time.":
    "我们仔细审查了您的案件。系统记录确认司机准时到达，并等候超过了免费等候时间。取消费将保留在您的账户中。如果您有其他证据（例如显示到达时间的位置数据），可在 7 天内申诉。",
  "We reviewed the trip and confirmed you followed the correct procedure. The cancellation fee will be credited to your account. Thank you for your patience. You may appeal within 7 days if you have concerns.":
    "我们审查了此次行程，确认您遵循了正确流程。取消费将计入您的账户。感谢您的耐心。如有疑问，可在 7 天内申诉。",
  "I arrived at the pickup point within the free waiting period but the driver had already left. The $5.00 cancellation fee should be reversed.":
    "我在免费等候时间内到达了上车点，但司机已经离开。$5.00 取消费应予撤销。",
  "I arrived at 08:43, waited 8+ minutes, called the rider who did not answer. The no-show threshold was met and the cancellation fee was correctly applied.":
    "我 08:43 到达，等了 8 分钟以上，并致电乘客但无人接听。已达到未出现时限，取消费收取正确。",
  "All 5 required conditions under POL-3 are verified: driver within arrival radius, stationary until cancellation, rider notified, contact attempted, cancelled after threshold. No-show fee is upheld.":
    "POL-3 规定的 5 项条件均已核实：司机在到达半径内、取消前保持静止、已通知乘客、已尝试联系、在时限后取消。维持未出现费用。",
  "POL-3: All 5 conditions verified. The $5.00 no-show fee is correctly applied and upheld. Rider's claim is rejected.":
    "POL-3：5 项条件全部核实。$5.00 未出现费用收取正确并予维持。乘客的申诉被驳回。",
};
