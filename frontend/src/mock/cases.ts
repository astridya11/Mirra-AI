/**
 * Mock case data — mirrors backend/mock_data/DISP-001.json, DISP-002.json, DISP-003.json.
 * Used when NEXT_PUBLIC_USE_MOCK=true.
 */

import type {
  CaseListItem,
  CaseResult,
  HumanReviewRequest,
  RawCaseData,
  TripListItem,
} from "@/src/types";

export const mockRawCases: Record<string, RawCaseData> = {
  "DISP-001": {
    case_metadata: {
      case_id: "DISP-001",
      dispute_type: "ROUTE_DEVIATION",
      current_state: "INIT_CLAIM",
      current_round: 1,
      resolution_channel: "FULLY_AUTOMATED",
      trip_id: "TRIP-2026-08112",
      rider_id: "R-1092",
      driver_id: "D-5541",
      created_at: "2026-09-22T14:10:00+08:00",
      updated_at: "2026-09-22T14:10:00+08:00",
    },
    data_sources: {
      trip_data: {
        trip_id: "TRIP-2026-08112",
        rider_id: "R-1092",
        driver_id: "D-5541",
        pickup_location: {
          name: "Marina Bay Sands",
          lat: 1.2838,
          lng: 103.8591,
        },
        dropoff_location: {
          name: "Changi Airport T3",
          lat: 1.3551,
          lng: 103.9872,
        },
        scheduled_time: "2026-09-22T13:30:00+08:00",
      },
      app_events: [
        {
          timestamp: "2026-09-22T13:30:00+08:00",
          event_type: "trip_started",
          details: "Passenger boarded. Trip started.",
        },
        {
          timestamp: "2026-09-22T13:42:00+08:00",
          event_type: "route_deviation_detected",
          details: "Vehicle departed from optimal ECP route onto PIE.",
        },
        {
          timestamp: "2026-09-22T14:05:00+08:00",
          event_type: "trip_completed",
          details: "Passenger dropped off at Changi T3.",
        },
      ],
      gps_telemetry: {
        actual_route: [
          {
            latitude: 1.2838,
            longitude: 103.8591,
            timestamp: "2026-09-22T13:30:00+08:00",
            speed_kmh: 0,
            status: "en_route",
          },
          {
            latitude: 1.312,
            longitude: 103.882,
            timestamp: "2026-09-22T13:42:00+08:00",
            speed_kmh: 65,
            status: "en_route",
          },
          {
            latitude: 1.3551,
            longitude: 103.9872,
            timestamp: "2026-09-22T14:05:00+08:00",
            speed_kmh: 0,
            status: "completed",
          },
        ],
        optimal_route: [
          {
            latitude: 1.2838,
            longitude: 103.8591,
            timestamp: "2026-09-22T13:30:00+08:00",
            speed_kmh: 0,
          },
          {
            latitude: 1.3551,
            longitude: 103.9872,
            timestamp: "2026-09-22T13:58:00+08:00",
            speed_kmh: 0,
          },
        ],
        deviation_distance_km: 2.3,
        unexpected_stops: [],
        trip_duration_seconds: 2100,
        optimal_duration_seconds: 1680,
      },
      chat_communication: {
        transcript: [
          {
            message_id: "MSG-001",
            sender: "rider",
            content: "Why are we taking PIE? ECP is usually much faster.",
            timestamp: "2026-09-22T13:43:00+08:00",
            sentiment_score: -0.4,
            type: "message",
            safety_threat_keywords: [],
          },
          {
            message_id: "MSG-002",
            sender: "driver",
            content: "Sorry, my GPS auto-rerouted me.",
            timestamp: "2026-09-22T13:43:30+08:00",
            sentiment_score: 0.0,
            type: "message",
            safety_threat_keywords: [],
          },
        ],
        overall_sentiment_score: -0.2,
        safety_threat_keywords_detected: false,
      },
      payment_fare_data: {
        original_fare: {
          base_fare: 3.0,
          distance_fare: 12.5,
          time_fare: 3.0,
          surge_multiplier: 1.0,
          total_fare: 18.5,
          currency: "SGD",
        },
        disputed_amount: 3.25,
        disputed_amount_currency: "SGD",
        payment_method: "credit_card",
      },
      historical_profiles: [
        {
          party: "RIDER",
          party_id: "R-1092",
          name: "Sarah Chen",
          account_age_days: 420,
          total_trips: 112,
          avg_rating: 4.8,
          risk_score: 0.05,
          dispute_history_30d: 0,
          dispute_history_90d: 0,
          bad_faith_flag: false,
        },
        {
          party: "DRIVER",
          party_id: "D-5541",
          name: "Tan Ah Kow",
          account_age_days: 600,
          total_trips: 1420,
          avg_rating: 4.7,
          risk_score: 0.12,
          dispute_history_30d: 1,
          dispute_history_90d: 2,
          bad_faith_flag: false,
        },
      ],
    },
  },
  "DISP-002": {
    case_metadata: {
      case_id: "DISP-002",
      dispute_type: "NO_SHOW_CHARGE",
      current_state: "INIT_CLAIM",
      current_round: 1,
      resolution_channel: "FULLY_AUTOMATED",
      trip_id: "TRIP-2026-09945",
      rider_id: "R-7823",
      driver_id: "D-2398",
      created_at: "2026-09-13T09:20:00+08:00",
      updated_at: "2026-09-13T09:20:00+08:00",
    },
    data_sources: {
      trip_data: {
        trip_id: "TRIP-2026-09945",
        rider_id: "R-7823",
        driver_id: "D-2398",
        pickup_location: {
          name: "Tiong Bahru Plaza",
          lat: 1.2847,
          lng: 103.8382,
        },
        dropoff_location: {
          name: "VivoCity",
          lat: 1.2648,
          lng: 103.8223,
        },
        scheduled_time: "2026-09-13T08:45:00+08:00",
        driver_arrival_time: "2026-09-13T08:43:00+08:00",
        driver_wait_start: "2026-09-13T08:43:00+08:00",
        cancellation_time: "2026-09-13T08:51:00+08:00",
        cancellation_fee: 5.0,
        cancellation_reason: "rider_no_show",
      },
      app_events: [
        {
          timestamp: "2026-09-13T08:48:10+08:00",
          event_type: "wait_timer_expired",
          details:
            "Free 5-min wait period expired. Rider had not boarded. Cancellation fee now applicable per policy.",
        },
        {
          timestamp: "2026-09-13T08:51:00+08:00",
          event_type: "cancellation_fee_applied",
          details:
            "No-show threshold (8 min) reached. $5.00 cancellation fee charged to rider payment method (e-wallet).",
        },
      ],
      gps_telemetry: {
        actual_route: [
          {
            latitude: 1.2847,
            longitude: 103.8382,
            timestamp: "2026-09-13T08:43:00+08:00",
            speed_kmh: 0,
            status: "arrived",
          },
          {
            latitude: 1.2847,
            longitude: 103.8382,
            timestamp: "2026-09-13T08:51:00+08:00",
            speed_kmh: 0,
            status: "cancelled",
          },
        ],
        optimal_route: [
          {
            latitude: 1.292,
            longitude: 103.845,
            timestamp: "2026-09-13T08:31:00+08:00",
            speed_kmh: 42,
          },
          {
            latitude: 1.2847,
            longitude: 103.8382,
            timestamp: "2026-09-13T08:43:00+08:00",
            speed_kmh: 0,
          },
        ],
        deviation_distance_km: 0,
        unexpected_stops: [],
        trip_duration_seconds: 1200,
        optimal_duration_seconds: 1200,
      },
      chat_communication: {
        transcript: [
          {
            message_id: "CHAT-001",
            sender: "driver",
            content: "I've arrived at the pickup point, I'm at the lobby area.",
            timestamp: "2026-09-13T08:43:00+08:00",
            sentiment_score: 0.1,
            type: "message",
            safety_threat_keywords: [],
          },
          {
            message_id: "CHAT-003",
            sender: "driver",
            content: "Outgoing call to rider — not answered (rang 22s, no response).",
            timestamp: "2026-09-13T08:47:05+08:00",
            sentiment_score: 0.0,
            type: "call",
            safety_threat_keywords: [],
          },
          {
            message_id: "CHAT-006",
            sender: "system",
            content:
              "Trip cancelled by driver. Reason: rider_no_show. Cancellation fee of $5.00 applied.",
            timestamp: "2026-09-13T08:51:00+08:00",
            sentiment_score: 0.0,
            type: "system",
            safety_threat_keywords: [],
          },
        ],
        overall_sentiment_score: -0.04,
        safety_threat_keywords_detected: false,
      },
      payment_fare_data: {
        original_fare: {
          base_fare: 0.0,
          distance_fare: 0.0,
          time_fare: 0.0,
          surge_multiplier: 1.0,
          total_fare: 5.0,
          currency: "SGD",
        },
        disputed_amount: 5.0,
        disputed_amount_currency: "SGD",
        payment_method: "e-wallet",
      },
      historical_profiles: [
        {
          party: "RIDER",
          party_id: "R-7823",
          name: "Michael Wong",
          account_age_days: 210,
          total_trips: 34,
          avg_rating: 3.9,
          risk_score: 0.65,
          dispute_history_30d: 2,
          dispute_history_90d: 4,
          bad_faith_flag: true,
          bad_faith_reason: "flagged_for_frequent_late_cancellations",
        },
        {
          party: "DRIVER",
          party_id: "D-2398",
          name: "Lim Wei Ming",
          account_age_days: 900,
          total_trips: 3201,
          avg_rating: 4.9,
          risk_score: 0.02,
          dispute_history_30d: 0,
          dispute_history_90d: 1,
          bad_faith_flag: false,
        },
      ],
    },
  },
  "DISP-003": {
    case_metadata: {
      case_id: "DISP-003",
      dispute_type: "CLEANING_FEE",
      current_state: "INIT_CLAIM",
      current_round: 1,
      resolution_channel: "FULLY_AUTOMATED",
      trip_id: "TRIP-2026-09102",
      rider_id: "R-8831",
      driver_id: "D-9012",
      created_at: "2026-09-22T16:00:00+08:00",
      updated_at: "2026-09-22T16:00:00+08:00",
    },
    data_sources: {
      trip_data: {
        trip_id: "TRIP-2026-09102",
        rider_id: "R-8831",
        driver_id: "D-9012",
        pickup_location: {
          name: "Clarke Quay",
          lat: 1.2905,
          lng: 103.8462,
        },
        dropoff_location: {
          name: "Jurong West St 61",
          lat: 1.3402,
          lng: 103.698,
        },
        scheduled_time: "2026-09-22T02:15:00+08:00",
      },
      app_events: [
        {
          timestamp: "2026-09-22T02:45:00+08:00",
          event_type: "trip_completed",
          details: "Trip ended normally at Jurong West.",
        },
      ],
      gps_telemetry: {
        actual_route: [
          {
            latitude: 1.2905,
            longitude: 103.8462,
            timestamp: "2026-09-22T02:15:00+08:00",
            speed_kmh: 0,
            status: "en_route",
          },
          {
            latitude: 1.3402,
            longitude: 103.698,
            timestamp: "2026-09-22T02:45:00+08:00",
            speed_kmh: 0,
            status: "completed",
          },
        ],
        optimal_route: [
          {
            latitude: 1.2905,
            longitude: 103.8462,
            timestamp: "2026-09-22T02:15:00+08:00",
            speed_kmh: 0,
          },
          {
            latitude: 1.3402,
            longitude: 103.698,
            timestamp: "2026-09-22T02:45:00+08:00",
            speed_kmh: 0,
          },
        ],
        deviation_distance_km: 0,
        unexpected_stops: [],
        trip_duration_seconds: 1800,
      },
      chat_communication: {
        transcript: [
          {
            message_id: "MSG-101",
            sender: "driver",
            content: "You made a mess in my back seat!",
            timestamp: "2026-09-22T02:46:00+08:00",
            sentiment_score: -0.8,
            type: "message",
            safety_threat_keywords: [],
          },
          {
            message_id: "MSG-102",
            sender: "rider",
            content: "I did not vomit at all, I was sober and drank water only.",
            timestamp: "2026-09-22T02:47:00+08:00",
            sentiment_score: -0.3,
            type: "message",
            safety_threat_keywords: [],
          },
        ],
        overall_sentiment_score: -0.55,
        safety_threat_keywords_detected: false,
      },
      payment_fare_data: {
        original_fare: {
          base_fare: 4.0,
          distance_fare: 22.0,
          time_fare: 5.0,
          surge_multiplier: 1.5,
          total_fare: 46.5,
          currency: "SGD",
        },
        disputed_amount: 100.0,
        disputed_amount_currency: "SGD",
        payment_method: "e-wallet",
      },
      historical_profiles: [
        {
          party: "RIDER",
          party_id: "R-8831",
          name: "Jason Lee",
          account_age_days: 510,
          total_trips: 88,
          avg_rating: 4.9,
          risk_score: 0.02,
          dispute_history_30d: 0,
          dispute_history_90d: 0,
          bad_faith_flag: false,
        },
        {
          party: "DRIVER",
          party_id: "D-9012",
          name: "Ahmad Bin Rosli",
          account_age_days: 180,
          total_trips: 210,
          avg_rating: 4.2,
          risk_score: 0.78,
          dispute_history_30d: 3,
          dispute_history_90d: 5,
          bad_faith_flag: true,
          bad_faith_reason: "Prior suspicious cleaning fee claims",
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Mock completed results (what the pipeline would produce)
// ---------------------------------------------------------------------------

export const mockCompletedResults: Record<string, CaseResult> = {
  "DISP-001": {
    case_metadata: {
      case_id: "DISP-001",
      dispute_type: "ROUTE_DEVIATION",
      current_state: "EXECUTION_ROUTER",
      current_round: 2,
      resolution_channel: "FULLY_AUTOMATED",
      trip_id: "TRIP-2026-08112",
      rider_id: "R-1092",
      driver_id: "D-5541",
      created_at: "2026-09-22T14:10:00+08:00",
      updated_at: "2026-09-22T14:20:00+08:00",
    },
    data_sources: mockRawCases["DISP-001"].data_sources,
    round_1_statements: {
      rider_statement: {
        party: "RIDER",
        agent_role: "RIDER_ADVOCATE",
        argument_summary:
          "Driver deviated from the optimal ECP route to PIE without a valid reason, adding 2.3km and 7 extra minutes to the trip. Rider requests a refund for the excess fare charged.",
        requested_outcome: "PARTIAL_REFUND",
        requested_amount: 3.25,
        currency: "SGD",
        evidence_references: [
          {
            evidence_id: "GPS-001",
            source_type: "GPS_TELEMETRY",
            description: "Actual route shows detour via PIE instead of ECP.",
          },
          {
            evidence_id: "CHAT-001",
            source_type: "CHAT_LOG",
            description: "Rider questioned the route during the trip.",
          },
        ],
        submitted_at: "2026-09-22T14:11:00+08:00",
      },
      driver_statement: {
        party: "DRIVER",
        agent_role: "DRIVER_ADVOCATE",
        argument_summary:
          "The GPS navigation app auto-rerouted to PIE. No road closure was detected on ECP, but the reroute was triggered by the navigation system. Driver had no intention to deviate.",
        requested_outcome: "NO_PENALTY",
        requested_amount: 0,
        currency: "SGD",
        evidence_references: [
          {
            evidence_id: "CHAT-002",
            source_type: "CHAT_LOG",
            description: "Driver explained GPS auto-rerouted.",
          },
        ],
        submitted_at: "2026-09-22T14:12:00+08:00",
      },
    },
    round_2_cross_exam: {
      targeted_questions: [
        {
          question_id: "Q-001",
          directed_to: "DRIVER",
          question_text:
            "Driver, can you explain why the GPS rerouted to PIE? Was there a road closure on ECP?",
          evidence_context: "GPS-001: deviation_distance_km 2.3",
          category: "GPS_DEVIATION",
          asked_at: "2026-09-22T14:13:00+08:00",
        },
      ],
      targeted_responses: [
        {
          response_id: "R-001",
          question_id: "Q-001",
          responding_party: "DRIVER",
          response_text:
            "My Google Maps rerouted me to PIE. I did not see any road closure sign on ECP. I followed the navigation.",
          responded_at: "2026-09-22T14:13:30+08:00",
        },
      ],
      round2_completed: true,
      completed_at: "2026-09-22T14:14:00+08:00",
    },
    bonus_modules: {
      fraud_assessment: {
        fraud_risk_score: 0.05,
        risk_factors: [],
        collusion_warning_flag: false,
        abuse_pattern_detected: false,
      },
      escalation_protocol: {
        safety_threat_detected: false,
        fraud_risk_level: "LOW",
        escalation_reasons: [],
        is_escalated: false,
        priority_level: "STANDARD",
      },
    },
    prosecutor_findings: {
      verified_facts: [
        {
          fact_id: "F-VER-001",
          description:
            "Actual route deviated from optimal ECP route to PIE, adding 2.3km to the trip.",
          supporting_evidence: [
            {
              evidence_id: "GPS-003",
              source_type: "GPS_TELEMETRY",
              description: "GPS telemetry shows deviation from optimal route.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-2",
          confidence_level: 0.95,
        },
        {
          fact_id: "F-VER-002",
          description:
            "No verified road closure or incident on ECP at the time of the trip.",
          supporting_evidence: [
            {
              evidence_id: "GPS-001",
              source_type: "GPS_TELEMETRY",
              description: "Optimal route was clear.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-2",
          confidence_level: 0.88,
        },
        {
          fact_id: "F-VER-003",
          description:
            "Trip duration was 2100s vs optimal 1680s, an increase of 420s (7 minutes).",
          supporting_evidence: [
            {
              evidence_id: "GPS-002",
              source_type: "GPS_TELEMETRY",
              description: "Trip duration exceeded optimal by 25%.",
            },
          ],
          party_relevance: "NEUTRAL",
          policy_clause_reference: "POL-2",
          confidence_level: 0.99,
        },
      ],
      disputed_facts: [
        {
          fact_id: "F-DIS-001",
          description:
            "Driver claims GPS auto-rerouted; however, no road closure was verified to justify the reroute.",
          supporting_evidence: [
            {
              evidence_id: "CHAT-002",
              source_type: "CHAT_LOG",
              description: "Driver stated GPS auto-rerouted.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-2",
          confidence_level: 0.5,
        },
      ],
      missing_facts: [],
      prosecutor_summary:
        "GPS telemetry confirms a 2.3km route deviation from ECP to PIE with no verified road closure. Driver's explanation of GPS auto-reroute is recorded but does not constitute a valid reason under POL-2. The deviation caused an excess fare of $3.25 SGD.",
      report_submitted_at: "2026-09-22T14:14:30+08:00",
    },
    policy_consultation: {
      request: {
        request_id: "PCR-001",
        dispute_type: "ROUTE_DEVIATION",
        verified_fact_ids: ["F-VER-001", "F-VER-002", "F-VER-003"],
        prosecutor_summary:
          "GPS telemetry confirms a 2.3km route deviation from ECP to PIE with no verified road closure.",
        requested_at: "2026-09-22T14:15:00+08:00",
      },
      suggestion: {
        suggestion_id: "PS-001",
        request_id: "PCR-001",
        applicable_clauses: [
          {
            clause_id: "POL-2",
            clause_title: "Route Deviation and Fare Adjustment",
            clause_text_summary:
              "A trip is reviewed for route deviation when the actual route exceeds the optimal route by more than the distance threshold. If no valid reason is verified, the rider is refunded the extra distance and extra time.",
            relevance_summary:
              "GPS confirms 2.3km deviation with no valid reason. Refund formula applies.",
          },
          {
            clause_id: "POL-6",
            clause_title: "Execution Gate and Escalation",
            clause_text_summary:
              "Auto-execution requires confidence >= 0.75, no safety/fraud flags, and amount <= $20.",
            relevance_summary: "Refund amount $3.25 is within auto-execution threshold.",
          },
        ],
        matched_precedents: [],
        suggested_ruling_type: "PARTIAL_REFUND",
        suggested_recommended_action: {
          action_type: "PARTIAL_REFUND",
          refund_amount: 3.25,
          cleaning_fee_amount: 0,
          currency: "SGD",
          penalty_target: "NONE",
          account_action: "NONE",
        },
        policy_confidence: 0.92,
        rationale:
          "POL-2 applies: deviation 2.3km exceeds 1.0km threshold. No valid reason verified. Refund = round(2.3*0.5 + 7*0.3, 2) = $3.25. Amount under $20 auto threshold.",
        suggested_at: "2026-09-22T14:15:30+08:00",
      },
    },
    judge_verdict: {
      ruling_type: "PARTIAL_REFUND",
      confidence_score: 0.94,
      reasoning_summary:
        "Verified GPS telemetry confirms a 2.3km route deviation with no road closure. POL-2 refund formula yields $3.25 SGD. Driver's GPS-reroute explanation does not constitute a valid reason. No fraud or safety flags. Case qualifies for FULLY_AUTOMATED execution.",
      verified_fact_references: ["F-VER-001", "F-VER-002", "F-VER-003"],
      policy_clauses_applied: ["POL-2", "POL-6"],
      precedent_references: [],
      recommended_action: {
        action_type: "PARTIAL_REFUND",
        refund_amount: 3.25,
        cleaning_fee_amount: 0,
        currency: "SGD",
        penalty_target: "NONE",
        account_action: "NONE",
      },
      explanations: {
        explanation_for_rider:
          "We reviewed your trip and confirmed the driver took a longer route than necessary. A refund of $3.25 SGD has been credited to your payment method. You may appeal or request a human review within 7 days if you disagree.",
        explanation_for_driver:
          "We reviewed the trip and found that the route taken was longer than the optimal route. The system has issued a partial refund to the rider. In future, please verify reroutes with road closure information. You may appeal within 7 days.",
      },
      execution_payload: {
        execution_status: "AUTO_EXECUTED",
        transaction_id: "TXN-RYDE-2026-A1B2C3D4",
        auto_executed_at: "2026-09-22T14:20:00+08:00",
        case_final_status: "AUTO_RESOLVED",
        resolved_at: "2026-09-22T14:20:00+08:00",
      },
      deliberated_at: "2026-09-22T14:16:00+08:00",
    },
    policy_kb_update: null,
  },

  "DISP-002": {
    case_metadata: {
      case_id: "DISP-002",
      dispute_type: "NO_SHOW_CHARGE",
      current_state: "EXECUTION_ROUTER",
      current_round: 2,
      resolution_channel: "FULLY_AUTOMATED",
      trip_id: "TRIP-2026-09945",
      rider_id: "R-7823",
      driver_id: "D-2398",
      created_at: "2026-09-13T09:20:00+08:00",
      updated_at: "2026-09-13T09:30:00+08:00",
    },
    data_sources: mockRawCases["DISP-002"].data_sources,
    round_1_statements: {
      rider_statement: {
        party: "RIDER",
        agent_role: "RIDER_ADVOCATE",
        argument_summary:
          "I arrived at the pickup point within the free waiting period but the driver had already left. The $5.00 cancellation fee should be reversed.",
        requested_outcome: "FULL_REFUND",
        requested_amount: 5.0,
        currency: "SGD",
        evidence_references: [],
        submitted_at: "2026-09-13T09:21:00+08:00",
      },
      driver_statement: {
        party: "DRIVER",
        agent_role: "DRIVER_ADVOCATE",
        argument_summary:
          "I arrived at 08:43, waited 8+ minutes, called the rider who did not answer. The no-show threshold was met and the cancellation fee was correctly applied.",
        requested_outcome: "NO_PENALTY",
        requested_amount: 0,
        currency: "SGD",
        evidence_references: [
          {
            evidence_id: "CHAT-003",
            source_type: "CHAT_LOG",
            description: "Driver called rider, no answer.",
          },
        ],
        submitted_at: "2026-09-13T09:22:00+08:00",
      },
    },
    round_2_cross_exam: {
      targeted_questions: [
        {
          question_id: "Q-001",
          directed_to: "RIDER",
          question_text:
            "Rider, you claim you arrived within the free waiting period. Can you provide GPS evidence of your arrival time?",
          evidence_context: "APP-EVENT: wait_timer_expired at 08:48",
          category: "TIME_WINDOW",
          asked_at: "2026-09-13T09:23:00+08:00",
        },
      ],
      targeted_responses: [
        {
          response_id: "R-001",
          question_id: "Q-001",
          responding_party: "RIDER",
          response_text:
            "I don't have GPS evidence but I was running late. I got to the lobby around 08:50 but the driver had already left.",
          responded_at: "2026-09-13T09:23:30+08:00",
        },
      ],
      round2_completed: true,
      completed_at: "2026-09-13T09:24:00+08:00",
    },
    bonus_modules: {
      fraud_assessment: {
        fraud_risk_score: 0.65,
        risk_factors: ["Rider has 4 disputes in 90 days", "Bad-faith flag active"],
        collusion_warning_flag: false,
        abuse_pattern_detected: true,
        abuse_pattern_description: "Frequent late cancellations pattern detected.",
      },
      escalation_protocol: {
        safety_threat_detected: false,
        fraud_risk_level: "MEDIUM",
        escalation_reasons: [],
        is_escalated: false,
        priority_level: "STANDARD",
      },
    },
    prosecutor_findings: {
      verified_facts: [
        {
          fact_id: "F-VER-001",
          description:
            "Driver GPS was within 10m of pickup point at 08:43 (arrival confirmed).",
          supporting_evidence: [
            {
              evidence_id: "GPS-001",
              source_type: "GPS_TELEMETRY",
              description: "Driver speed 0 at pickup coordinates.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-3",
          confidence_level: 0.99,
        },
        {
          fact_id: "F-VER-002",
          description:
            "Driver stayed at pickup point until cancellation at 08:51 (stationary throughout).",
          supporting_evidence: [
            {
              evidence_id: "GPS-002",
              source_type: "GPS_TELEMETRY",
              description: "GPS shows 0 speed from 08:43 to 08:51.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-3",
          confidence_level: 0.99,
        },
        {
          fact_id: "F-VER-003",
          description:
            "Rider was notified of arrival (push notification sent at 08:43:05).",
          supporting_evidence: [
            {
              evidence_id: "APP-001",
              source_type: "APP_EVENT",
              description: "rider_notified event recorded.",
            },
          ],
          party_relevance: "RIDER",
          policy_clause_reference: "POL-3",
          confidence_level: 1.0,
        },
        {
          fact_id: "F-VER-004",
          description:
            "Driver made a contact attempt (call at 08:47:05, rang 22s, no answer).",
          supporting_evidence: [
            {
              evidence_id: "CHAT-003",
              source_type: "CHAT_LOG",
              description: "Outgoing call to rider, no answer.",
            },
          ],
          party_relevance: "RIDER",
          policy_clause_reference: "POL-3",
          confidence_level: 1.0,
        },
        {
          fact_id: "F-VER-005",
          description:
            "Cancellation happened at 08:51, after the no-show threshold of 8 minutes from 08:43 arrival.",
          supporting_evidence: [
            {
              evidence_id: "APP-002",
              source_type: "APP_EVENT",
              description: "cancellation_fee_applied event at 08:51.",
            },
          ],
          party_relevance: "NEUTRAL",
          policy_clause_reference: "POL-3",
          confidence_level: 1.0,
        },
      ],
      disputed_facts: [],
      missing_facts: [],
      prosecutor_summary:
        "All 5 required conditions under POL-3 are verified: driver within arrival radius, stationary until cancellation, rider notified, contact attempted, cancelled after threshold. No-show fee is upheld.",
      report_submitted_at: "2026-09-13T09:25:00+08:00",
    },
    policy_consultation: {
      request: {
        request_id: "PCR-002",
        dispute_type: "NO_SHOW_CHARGE",
        verified_fact_ids: ["F-VER-001", "F-VER-002", "F-VER-003", "F-VER-004", "F-VER-005"],
        prosecutor_summary:
          "All 5 required conditions under POL-3 are verified. No-show fee is upheld.",
        requested_at: "2026-09-13T09:25:30+08:00",
      },
      suggestion: {
        suggestion_id: "PS-002",
        request_id: "PCR-002",
        applicable_clauses: [
          {
            clause_id: "POL-3",
            clause_title: "No-Show Cancellation Charge",
            clause_text_summary:
              "Cancellation fee upheld only if ALL conditions are verified: driver GPS within arrival radius, stationary until cancellation, rider notified, contact attempted, cancelled after threshold.",
            relevance_summary: "All 5 conditions verified. Fee is upheld.",
          },
          {
            clause_id: "POL-6",
            clause_title: "Execution Gate and Escalation",
            clause_text_summary:
              "Auto-execution requires confidence >= 0.75, no safety/fraud flags, amount <= $20.",
            relevance_summary: "$5 fee is within auto threshold. No HIGH fraud risk.",
          },
        ],
        matched_precedents: [],
        suggested_ruling_type: "REJECTED",
        suggested_recommended_action: {
          action_type: "NO_REFUND",
          refund_amount: 0,
          cleaning_fee_amount: 0,
          currency: "SGD",
          penalty_target: "NONE",
          account_action: "NONE",
        },
        policy_confidence: 0.95,
        rationale:
          "POL-3: All 5 conditions verified. The $5.00 no-show fee is correctly applied and upheld. Rider's claim is rejected.",
        suggested_at: "2026-09-13T09:26:00+08:00",
      },
    },
    judge_verdict: {
      ruling_type: "REJECTED",
      confidence_score: 0.92,
      reasoning_summary:
        "All 5 required conditions under POL-3 are verified by system records. The $5.00 cancellation fee is correctly applied. Rider's claim of arriving within the free waiting period is not substantiated by GPS evidence. Fee is upheld.",
      verified_fact_references: ["F-VER-001", "F-VER-002", "F-VER-003", "F-VER-004", "F-VER-005"],
      policy_clauses_applied: ["POL-3", "POL-6"],
      precedent_references: [],
      recommended_action: {
        action_type: "NO_REFUND",
        refund_amount: 0,
        cleaning_fee_amount: 0,
        currency: "SGD",
        penalty_target: "NONE",
        account_action: "NONE",
      },
      explanations: {
        explanation_for_rider:
          "We reviewed your case carefully. Our system records confirm your driver arrived on time and waited beyond the free waiting period. The cancellation fee will remain on your account. You can appeal within 7 days if you have additional evidence, such as location data showing your arrival time.",
        explanation_for_driver:
          "We reviewed the trip and confirmed you followed the correct procedure. The cancellation fee will be credited to your account. Thank you for your patience. You may appeal within 7 days if you have concerns.",
      },
      execution_payload: {
        execution_status: "AUTO_EXECUTED",
        transaction_id: "TXN-RYDE-2026-E5F6G7H8",
        auto_executed_at: "2026-09-13T09:30:00+08:00",
        case_final_status: "AUTO_RESOLVED",
        resolved_at: "2026-09-13T09:30:00+08:00",
      },
      deliberated_at: "2026-09-13T09:27:00+08:00",
    },
    policy_kb_update: null,
  },

  "DISP-003": {
    case_metadata: {
      case_id: "DISP-003",
      dispute_type: "CLEANING_FEE",
      current_state: "EXECUTION_ROUTER",
      current_round: 2,
      resolution_channel: "ESCALATED_HUMAN_REVIEW",
      trip_id: "TRIP-2026-09102",
      rider_id: "R-8831",
      driver_id: "D-9012",
      created_at: "2026-09-22T16:00:00+08:00",
      updated_at: "2026-09-22T16:15:00+08:00",
    },
    data_sources: mockRawCases["DISP-003"].data_sources,
    round_1_statements: {
      rider_statement: {
        party: "RIDER",
        agent_role: "RIDER_ADVOCATE",
        argument_summary:
          "I did not vomit or make any mess in the vehicle. I was sober and only drank water. The cleaning fee claim of $100 is fraudulent.",
        requested_outcome: "CASE_DISMISSED",
        requested_amount: 0,
        currency: "SGD",
        evidence_references: [],
        submitted_at: "2026-09-22T16:01:00+08:00",
      },
      driver_statement: {
        party: "DRIVER",
        agent_role: "DRIVER_ADVOCATE",
        argument_summary:
          "Rider vomited in the back seat. I have submitted a photo as evidence and am claiming $100 cleaning fee.",
        requested_outcome: "CLEANING_FEE_CHARGE",
        requested_amount: 100,
        currency: "SGD",
        evidence_references: [
          {
            evidence_id: "PHOTO-001",
            source_type: "IMAGE",
            description: "Photo of vomit in back seat.",
          },
        ],
        submitted_at: "2026-09-22T16:02:00+08:00",
      },
    },
    round_2_cross_exam: {
      targeted_questions: [
        {
          question_id: "Q-001",
          directed_to: "DRIVER",
          question_text:
            "Driver, the photo's EXIF timestamp shows it was taken at 04:05, which is 1 hour 20 minutes after the trip ended at 02:45. Can you explain this delay?",
          evidence_context: "EXIF-001: timestamp 04:05 vs trip_end 02:45",
          category: "IMAGE_AUTHENTICITY",
          asked_at: "2026-09-22T16:03:00+08:00",
        },
        {
          question_id: "Q-002",
          directed_to: "DRIVER",
          question_text:
            "Driver, your historical profile shows 3 cleaning fee claims in the last 30 days and a bad-faith flag for prior suspicious claims. Can you explain?",
          evidence_context: "PROFILE-001: bad_faith_flag true",
          category: "HISTORICAL_PATTERN",
          asked_at: "2026-09-22T16:04:00+08:00",
        },
      ],
      targeted_responses: [
        {
          response_id: "R-001",
          question_id: "Q-001",
          responding_party: "DRIVER",
          response_text:
            "I was busy driving other passengers after this trip. I took the photo when I had a chance to stop safely.",
          responded_at: "2026-09-22T16:03:30+08:00",
        },
        {
          response_id: "R-002",
          question_id: "Q-002",
          responding_party: "DRIVER",
          response_text:
            "Those were legitimate cleaning claims from different passengers. Each one was real.",
          responded_at: "2026-09-22T16:04:30+08:00",
        },
      ],
      round2_completed: true,
      completed_at: "2026-09-22T16:05:00+08:00",
    },
    bonus_modules: {
      image_exif_analyses: [
        {
          image_id: "PHOTO-001",
          exif_timestamp: "2026-09-22T04:05:00+08:00",
          is_ai_generated: false,
          ai_generated_confidence: 0.12,
          stain_damage_classification: "VOMIT",
          damage_severity: "SEVERE",
          exif_consistent_with_trip: false,
          recycled_image_detected: true,
          recycled_image_match_case_id: "DISP-2026-0715",
        },
      ],
      fraud_assessment: {
        fraud_risk_score: 0.85,
        risk_factors: [
          "EXIF timestamp 80 min after trip end",
          "Recycled image detected (matched DISP-2026-0715)",
          "Driver bad-faith flag: Prior suspicious cleaning fee claims",
          "3 cleaning fee claims in 30 days",
        ],
        collusion_warning_flag: false,
        abuse_pattern_detected: true,
        abuse_pattern_description: "Repeated suspicious cleaning fee claims with recycled photos.",
        recommended_fraud_action: "REFER_TO_FRAUD_TEAM",
      },
      escalation_protocol: {
        safety_threat_detected: false,
        fraud_risk_level: "HIGH",
        escalation_reasons: [
          "深度调查组件标记为高欺诈风险",
          "EXIF timestamp mismatch (80 min after trip end)",
          "Recycled image detected (matched DISP-2026-0715)",
          "金额超过自动执行阈值，需要人工审核",
          "金额超过高优先级阈值 (50)",
        ],
        is_escalated: true,
        priority_level: "HIGH_PRIORITY",
        missing_crucial_evidence: false,
      },
    },
    prosecutor_findings: {
      verified_facts: [
        {
          fact_id: "F-VER-001",
          description:
            "Photo EXIF timestamp (04:05) is 1 hour 20 minutes after trip completion (02:45), outside the 30-minute photo window.",
          supporting_evidence: [
            {
              evidence_id: "EXIF-001",
              source_type: "EXIF_METADATA",
              description: "EXIF timestamp 04:05 vs trip end 02:45.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-4",
          confidence_level: 1.0,
        },
        {
          fact_id: "F-VER-002",
          description:
            "Image hash matches a prior case (DISP-2026-0715), indicating a recycled photo.",
          supporting_evidence: [
            {
              evidence_id: "IMG-001",
              source_type: "IMAGE",
              description: "Perceptual hash match to DISP-2026-0715.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-4",
          confidence_level: 0.98,
        },
        {
          fact_id: "F-VER-003",
          description:
            "Driver historical profile shows 3 cleaning fee claims in 30 days and a bad-faith flag.",
          supporting_evidence: [
            {
              evidence_id: "PROFILE-001",
              source_type: "HISTORICAL_PROFILE",
              description: "Driver D-9012: dispute_history_30d=3, bad_faith_flag=true.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-10",
          confidence_level: 1.0,
        },
      ],
      disputed_facts: [
        {
          fact_id: "F-DIS-001",
          description:
            "Driver claims the photo was taken late because he was driving other passengers; however, the 80-minute delay exceeds the 30-minute window.",
          supporting_evidence: [
            {
              evidence_id: "CHAT-001",
              source_type: "CHAT_LOG",
              description: "Driver's explanation for the delay.",
            },
          ],
          party_relevance: "DRIVER",
          policy_clause_reference: "POL-4",
          confidence_level: 0.3,
        },
      ],
      missing_facts: [],
      prosecutor_summary:
        "EXIF timestamp is 80 minutes after trip end, exceeding the 30-minute photo window under POL-4. The image is a recycled photo from a prior case (DISP-2026-0715). Driver has a bad-faith flag and 3 prior cleaning fee claims in 30 days. Fraud risk is HIGH. The cleaning fee claim appears fabricated.",
      report_submitted_at: "2026-09-22T16:06:00+08:00",
    },
    policy_consultation: {
      request: {
        request_id: "PCR-003",
        dispute_type: "CLEANING_FEE",
        verified_fact_ids: ["F-VER-001", "F-VER-002", "F-VER-003"],
        prosecutor_summary:
          "EXIF timestamp outside window. Recycled photo detected. Driver bad-faith flag. Fraud risk HIGH.",
        requested_at: "2026-09-22T16:06:30+08:00",
      },
      suggestion: {
        suggestion_id: "PS-003",
        request_id: "PCR-003",
        applicable_clauses: [
          {
            clause_id: "POL-4",
            clause_title: "Cleaning Fee Claims",
            clause_text_summary:
              "Photo must be taken within 30 min after trip end. Recycled images and EXIF inconsistencies must be recorded as contradicted facts. Cleaning fees always require human confirmation.",
            relevance_summary: "EXIF timestamp 80 min after trip end. Recycled image detected.",
          },
          {
            clause_id: "POL-6",
            clause_title: "Execution Gate and Escalation",
            clause_text_summary:
              "Cases with fraud_risk_level HIGH are escalated. Amounts over $50 require human review.",
            relevance_summary: "Fraud risk HIGH and $100 amount both trigger escalation.",
          },
          {
            clause_id: "POL-10",
            clause_title: "Account Actions for Confirmed Misconduct",
            clause_text_summary:
              "Fabricated or recycled evidence may result in a warning. All account actions require human confirmation.",
            relevance_summary: "Recycled photo evidence may warrant account action.",
          },
        ],
        matched_precedents: [],
        suggested_ruling_type: "ESCALATED",
        suggested_recommended_action: {
          action_type: "ESCALATED_NO_ACTION",
          refund_amount: 0,
          cleaning_fee_amount: 0,
          currency: "SGD",
          penalty_target: "NONE",
          account_action: "NONE",
        },
        policy_confidence: 0.85,
        rationale:
          "POL-4: EXIF timestamp outside 30-min window and recycled image detected. POL-6: Fraud risk HIGH and $100 amount triggers escalation. POL-10: Recycled evidence may warrant account action. Case must be escalated for human review.",
        suggested_at: "2026-09-22T16:07:00+08:00",
      },
    },
    judge_verdict: {
      ruling_type: "ESCALATED",
      confidence_score: 0.15,
      reasoning_summary:
        "Prosecutor verified EXIF timestamp 80 min after trip end, recycled photo from prior case, and driver bad-faith flag. Fraud risk is HIGH. Under POL-4, the photo evidence is contradicted. Under POL-6, the $100 amount and HIGH fraud risk require escalation. The cleaning fee claim appears fabricated and is rejected, but the case is escalated for human review to determine account action under POL-10.",
      verified_fact_references: ["F-VER-001", "F-VER-002", "F-VER-003"],
      policy_clauses_applied: ["POL-4", "POL-6", "POL-10"],
      precedent_references: [],
      recommended_action: {
        action_type: "ESCALATED_NO_ACTION",
        refund_amount: 0,
        cleaning_fee_amount: 0,
        currency: "SGD",
        penalty_target: "NONE",
        account_action: "NONE",
      },
      explanations: {
        explanation_for_rider:
          "We reviewed the cleaning fee claim and found evidence that the photo may have been reused from a previous case. The $100 cleaning fee will not be charged to your account. A human reviewer will examine the driver's account for possible policy violations. You may appeal within 7 days.",
        explanation_for_driver:
          "We reviewed the cleaning fee claim and found that the photo evidence does not meet our submission requirements. The claim has been escalated for human review. A support agent will contact you. You may appeal within 7 days.",
      },
      execution_payload: {
        execution_status: "PENDING_HUMAN_APPROVAL",
        transaction_id: null,
        auto_executed_at: null,
        case_final_status: "PENDING",
        resolved_at: "2026-09-22T16:15:00+08:00",
      },
      deliberated_at: "2026-09-22T16:08:00+08:00",
    },
    policy_kb_update: null,
  },
};

// ---------------------------------------------------------------------------
// Mock API functions
// ---------------------------------------------------------------------------

export function mockListTrips(): TripListItem[] {
  return Object.values(mockRawCases).map((c) => ({
    case_id: c.case_metadata.case_id,
    trip_id: c.case_metadata.trip_id!,
    trip_data: c.data_sources.trip_data!,
    historical_profiles: c.data_sources.historical_profiles,
    payment_fare_data: c.data_sources.payment_fare_data
  }));
}

export function mockListCases(): CaseListItem[] {
  return Object.values(mockRawCases).map((c) => ({
    case_id: c.case_metadata.case_id,
    dispute_type: c.case_metadata.dispute_type,
    current_state: c.case_metadata.current_state,
    trip_id: c.case_metadata.trip_id,
    rider_id: c.case_metadata.rider_id,
    driver_id: c.case_metadata.driver_id,
    has_completed_result: c.case_metadata.case_id in mockCompletedResults,
  }));
}

export function mockGetCaseResult(id: string): CaseResult {
  if (id in mockCompletedResults) return mockCompletedResults[id];
  if (id in mockRawCases) {
    return {
      case_metadata: mockRawCases[id].case_metadata,
      data_sources: mockRawCases[id].data_sources,
    };
  }
  throw new Error(`Case ${id} not found`);
}

export async function mockSubmitHumanReview(
  id: string,
  review: HumanReviewRequest
): Promise<CaseResult> {
  const result = mockCompletedResults[id];
  if (!result) throw new Error(`Case ${id} not found`);
  // In mock mode, just return the result with human confirmation appended
  if (result.judge_verdict?.execution_payload) {
    result.judge_verdict.execution_payload.execution_status =
      review.approval_decision === "CONFIRMED_AUTO" ? "HUMAN_CONFIRMED" : "HUMAN_OVERRIDDEN";
    result.judge_verdict.execution_payload.human_confirmation_details = {
      reviewer_id: review.reviewer_id,
      approval_timestamp: new Date().toISOString(),
      approval_decision: review.approval_decision,
      override_reason: review.override_reason || review.review_notes,
      modified_action: review.modified_action ?? null,
    };
    result.judge_verdict.execution_payload.case_final_status =
      review.approval_decision === "CONFIRMED_AUTO" ? "HUMAN_RESOLVED" : "HUMAN_OVERRIDDEN";
  }
  return result;
}
