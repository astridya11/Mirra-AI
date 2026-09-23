# orchestrator/state_machine.py

async def run_dispute_pipeline(case_id: str):
    # 第一步：只读取原始数据（相当于 Ryde 官方原版 JSON）
    raw_case_data = load_raw_mock_json(case_id) 
    
    # 构建运行时的 State Context 内存对象
    context = {
        "case_metadata": raw_case_data["case_metadata"],
        "data_sources": raw_case_data["data_sources"],
        "round_1_statements": {},
        "round_2_cross_exam": {"targeted_questions": [], "targeted_responses": [], "round2_completed": False},
        "round_3_rebuttal": {"is_triggered": False, "new_evidence_provided": False, "substantive_claim_change": False, "rebuttals": []},
        "bonus_modules": {"image_exif_analyses": [], "fraud_assessment": {}, "escalation_protocol": {}},
        "prosecutor_findings": {},
        "judge_verdict": {}
    }
    
    # 第二步：Stage 1 - 调用 Rider/Driver Advocate Agent 生成 Round 1 申诉
    context["round_1_statements"]["rider_statement"] = await run_rider_advocate(context)
    context["round_1_statements"]["driver_statement"] = await run_driver_advocate(context)
    # 通过 WebSocket 推送 ROUND_1 结果给前端 ...

    # 第三步：Stage 2 - 调用 Prosecutor Agent 审计并提问
    context["round_2_cross_exam"] = await run_prosecutor_audit(context)
    # 通过 WebSocket 推送 ROUND_2 结果给前端 ...

    # 第四步：Stage 3 - 判断是否触发 Round 3，并调用 Judge Agent
    # ... 依此类推，动态填充整张大表！