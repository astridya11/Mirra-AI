from unittest.mock import patch
import pytest
from httpx import ASGITransport, AsyncClient
from httpx_sse import aconnect_sse
from backend.main import app, _completed_results


# Mock 工厂函数定义 (模拟 Agent 行为)
def mock_agent_factory(function_name: str):
    async def mock_generate_response(*args, **kwargs):
        return {"content": "Mocked response statement", "party": "RIDER"}

    async def mock_generate_question(*args, **kwargs):
        turn = kwargs.get("turn", 1)
        if turn > 1:
            return {"done": True}
        return {
            "question_id": "Q-101",
            "directed_to": "RIDER_ADVOCATE",
            "question_text": "Did you check the route?",
        }

    async def mock_run_prosecutor_audit(*args, **kwargs):
        return {
            "bonus_modules": {"fraud_score": 0.1},
            "prosecutor_findings": {
                "prosecutor_summary": "No fraud detected",
                "verified_facts": [],
            },
        }

    async def mock_run_policy_consultation(*args, **kwargs):
        return {
            "applicable_clauses": [],
            "suggested_ruling": "APPROVED",
            "recommended_action": {"refund_amount": 15.0},
        }

    async def mock_learn_from_human_override(*args, **kwargs):
        return {"status": "updated"}

    mapping = {
        "generateResponse": mock_generate_response,
        "generateQuestion": mock_generate_question,
        "run_prosecutor_audit": mock_run_prosecutor_audit,
        "run_policy_consultation": mock_run_policy_consultation,
        "learn_from_human_override": mock_learn_from_human_override,
    }

    return mapping.get(function_name, mock_generate_response)


@pytest.mark.anyio
async def test_run_realtime_sse_stream():
    """
    测试 SSE 流式推演接口 /api/disputes/{dispute_id}/stream
    验证 Agent 事件、Prosecutor 审计以及 Judge 判决是否以流式事件按顺序推送到前端。
    """
    dispute_id = "DISP-001"

    async def mock_run_judge(context):
        return {
            "ruling_type": "APPROVED",
            "confidence_score": 0.85,
            "recommended_action": {
                "action_type": "FULL_REFUND",
                "refund_amount": 15.0,
                "currency": "SGD",
            },
            "explanations": "Mocked judge decision based on evidence.",
        }

    # Patch Agent 逻辑与 Judge 阶段
    with (
        patch(
            "backend.orchestrator.state_machine._lazy_import",
            side_effect=lambda mod, fn: mock_agent_factory(fn),
        ),
        patch(
            "backend.orchestrator.state_machine.run_judge",
            side_effect=mock_run_judge,
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # 建立 SSE 长连接流式监听
            async with aconnect_sse(
                client, "GET", f"/api/disputes/{dispute_id}/stream"
            ) as event_source:
                # 校验 HTTP 响应 Header 包含 text/event-stream
                response = event_source.response
                assert response.status_code == 200
                assert "text/event-stream" in response.headers.get("content-type", "")

                received_events = []
                # 实时遍历收集推送过来的事件流
                async for sse_event in event_source.aiter_sse():
                    received_events.append({
                        "event": sse_event.event,
                        "data": sse_event.json(),
                    })

                # 1. 验证是否收到了数据流
                assert len(received_events) > 0, "没有接收到任何 SSE 事件"

                # 2. 验证事件流中是否包含过程事件 (pipeline_event) 和完成事件 (pipeline_complete)
                event_types = [e["event"] for e in received_events]
                assert "pipeline_event" in event_types
                assert "pipeline_complete" in event_types

                # 3. 校验最后一个完成事件中的完整 result 数据
                complete_event = next(
                    e for e in received_events if e["event"] == "pipeline_complete"
                )
                final_result = complete_event["data"]["result"]

                assert "judge_verdict" in final_result
                assert final_result["judge_verdict"]["ruling_type"] == "APPROVED"
                assert final_result["judge_verdict"]["confidence_score"] == 0.85

                # 4. 验证全局状态是否成功保存
                assert dispute_id in _completed_results