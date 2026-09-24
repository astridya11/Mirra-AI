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


def _add_evidence(client, case_id, party_id, evidence_id="GPS-001"):
    return client.post(
        f"/api/v1/cases/{case_id}/evidence",
        headers={"X-Party-Id": party_id},
        json={
            "evidence_id": evidence_id,
            "source_type": "GPS_TELEMETRY",
            "description": "Route deviated 2.3km from optimal path",
            "payload": {"deviation_distance_km": 2.3},
        },
    )


def test_party_can_add_and_list_evidence(client):
    _create_case(client)

    add_response = _add_evidence(client, "DISP-100", "R-1")
    assert add_response.status_code == 201
    assert add_response.json()["evidence_id"] == "GPS-001"

    list_response = client.get(
        "/api/v1/cases/DISP-100/evidence", headers={"X-Party-Id": "D-1"}
    )
    assert list_response.status_code == 200
    records = list_response.json()
    assert len(records) == 1
    assert records[0]["payload"]["deviation_distance_km"] == 2.3


def test_stranger_cannot_add_evidence(client):
    _create_case(client)
    response = _add_evidence(client, "DISP-100", "R-999")
    assert response.status_code == 403


def test_evidence_for_unknown_case_is_not_found(client):
    response = _add_evidence(client, "NOPE", "R-1")
    assert response.status_code == 404
