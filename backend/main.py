# backend/main.py
from fastapi import FastAPI, HTTPException
import json
import os

app = FastAPI(title="Ryde Multi-Agent Dispute Resolution System - Mirra AI")

# Mock API: 获取所有可用的争议案件列表 (供前端下拉框选择)
@app.get("/api/disputes")
async def get_dispute_cases():
    return [
        {"dispute_id": "DISP-001", "type": "ROUTE_DEVIATION", "title": "Route Deviation & Extra Charge Claim"},
        {"dispute_id": "DISP-002", "type": "NO_SHOW_CHARGE", "title": "No-Show Cancellation Charge Dispute (Official Sample)"},
        {"dispute_id": "DISP-003", "type": "CLEANING_FEE", "title": "Driver Cleaning Fee Claim (Fraud Alert)"}
    ]

# Mock API: 加载指定 Case 的原始数据 (模拟向 Ryde 数据库拉取)
@app.get("/api/disputes/{dispute_id}")
async def get_dispute_data(dispute_id: str):
    file_path = f"backend/mock_data/{dispute_id}.json"
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dispute dataset not found")
    
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data

# Mock External API: 模拟系统自动退款/发放补偿金的外联接口
@app.post("/api/mock-ryde-pay/refund")
async def execute_mock_refund(payload: dict):
    # 模拟给乘客退款的 API
    return {
        "status": "SUCCESS",
        "transaction_id": f"TXN-RYDE-2026-{os.urandom(4).hex().upper()}",
        "refund_amount": payload.get("amount"),
        "currency": "SGD",
        "executed_at": "2026-09-23T17:00:00Z"
    }