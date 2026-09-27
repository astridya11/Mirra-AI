def _create_case(client, case_id="DISP-100", rider_id="R-1", driver_id="D-1"):
    return client.post(
        "/api/v1/cases",
        json={
            "case_id": case_id,
            "dispute_type": "ROUTE_DEVIATION",
            "trip_id": "TRIP-1",
            "rider_id": rider_id,
            "driver_id": driver_id,
        },
    )


def test_create_case(client):
    response = _create_case(client)
    assert response.status_code == 201
    body = response.json()
    assert body["case_id"] == "DISP-100"
    assert body["current_state"] == "INIT_CLAIM"
    assert body["current_round"] == 1
    assert body["resolution_channel"] is None


def test_create_case_duplicate_conflicts(client):
    _create_case(client)
    response = _create_case(client)
    assert response.status_code == 409


def test_rider_can_read_own_case(client):
    _create_case(client)
    response = client.get("/api/v1/cases/DISP-100", headers={"X-Party-Id": "R-1"})
    assert response.status_code == 200
    assert response.json()["case_id"] == "DISP-100"


def test_driver_can_read_own_case(client):
    _create_case(client)
    response = client.get("/api/v1/cases/DISP-100", headers={"X-Party-Id": "D-1"})
    assert response.status_code == 200


def test_stranger_cannot_read_case(client):
    _create_case(client)
    response = client.get("/api/v1/cases/DISP-100", headers={"X-Party-Id": "R-999"})
    assert response.status_code == 403


def test_missing_party_header_is_unauthorized(client):
    _create_case(client)
    response = client.get("/api/v1/cases/DISP-100")
    assert response.status_code == 422  # FastAPI header validation error


def test_unknown_case_is_not_found(client):
    response = client.get("/api/v1/cases/NOPE", headers={"X-Party-Id": "R-1"})
    assert response.status_code == 404


def test_list_my_cases_scopes_to_party(client):
    _create_case(client, case_id="DISP-100", rider_id="R-1", driver_id="D-1")
    _create_case(client, case_id="DISP-200", rider_id="R-2", driver_id="D-2")

    response = client.get("/api/v1/cases", headers={"X-Party-Id": "R-1"})
    assert response.status_code == 200
    case_ids = [c["case_id"] for c in response.json()]
    assert case_ids == ["DISP-100"]
