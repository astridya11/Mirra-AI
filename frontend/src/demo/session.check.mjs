// Privacy selector check. Run: node src/demo/session.check.mjs  (Node >= 23.6 strips TS types natively)
import assert from "node:assert/strict";
import { driverView, initialSession, internalView, passengerView, reduce, sessionKey } from "./session.ts";

const fresh = () => initialSession({ demoId: "1", caseId: "DISP-001", sessionId: "t", tripStatus: "COMPLETED" });
const reply = { from: "mirra", text: "fixture reply" };

// A. Passenger private assistance -> driver-visible state unchanged.
{
  let s = fresh();
  const d0 = driverView(s);
  const p0 = passengerView(s);
  s = reduce(s, { type: "openPrivate", party: "passenger", greeting: "hi" });
  s = reduce(s, { type: "privateMessage", party: "passenger", text: "longer route?", reply });
  assert.deepEqual(driverView(s), d0, "driver view changed by passenger private assist");
  assert.notDeepEqual(passengerView(s), p0, "passenger view should reflect own private chat");
  assert.equal(s.stage, "PRIVATE_ASSIST");
  assert.equal(internalView(s).privateSessions[0].label, "PRIVATE SESSION — not visible to the driver");
}

// B. Driver private assistance -> passenger-visible state unchanged.
{
  let s = fresh();
  const p0 = passengerView(s);
  s = reduce(s, { type: "openPrivate", party: "driver", greeting: "hi" });
  s = reduce(s, { type: "privateMessage", party: "driver", text: "rider late?", reply });
  assert.deepEqual(passengerView(s), p0, "passenger view changed by driver private assist");
}

// C. Formal complaint is the first moment the other party learns of the dispute — never the private chat.
{
  let s = fresh();
  s = reduce(s, { type: "openPrivate", party: "passenger", greeting: "hi" });
  s = reduce(s, { type: "privateMessage", party: "passenger", text: "secret", reply });
  s = reduce(s, { type: "submitFormal", party: "passenger" });
  assert.deepEqual(driverView(s).dispute, { role: "respondent", caseId: "DISP-001", phase: "EVIDENCE", submitted: false, evidenceProvided: false, liveCaseId: null });
  assert.equal(driverView(s).chat, null, "passenger private chat leaked to driver");
  assert.equal(passengerView(s).dispute.role, "complainant");
  assert.equal(s.stage, "FORMAL_COMPLAINT");
}

// F. Evidence freeze is enforced in the reducer, not just the UI.
{
  let s = reduce(fresh(), { type: "submitFinal", party: "driver" });
  assert.equal(s.submitted.driver, false, "evidence accepted before a formal complaint exists");
  s = reduce(s, { type: "submitFormal", party: "passenger" });
  s = reduce(s, { type: "submitFinal", party: "passenger" });
  assert.equal(s.submitted.passenger, true);
  assert.equal(s.stage, "EVIDENCE_INTAKE");
  s = reduce(s, { type: "startTribunal" });
  assert.equal(s.frozen, true);
  const frozen = s;
  s = reduce(s, { type: "submitFinal", party: "driver" });
  assert.equal(s, frozen, "evidence mutation accepted after freeze");
  assert.equal(driverView(s).dispute.phase, "FROZEN");

  // Round-2 response -> claims only; submitted evidence untouched.
  s = reduce(s, { type: "reveal", total: 3, escalate: false });
  s = reduce(s, { type: "reveal", total: 3, escalate: false, claim: { party: "driver", text: "GPS rerouted me" } });
  assert.deepEqual(s.claims, [{ party: "driver", text: "GPS rerouted me" }]);
  assert.deepEqual(s.submitted, frozen.submitted, "cross-exam response changed evidence state");
  assert.equal(s.stage, "TRIBUNAL");
  s = reduce(s, { type: "reveal", total: 3, escalate: false });
  assert.equal(s.stage, "DECISION");
  assert.equal(reduce(s, { type: "reveal", total: 3, escalate: false }), s, "reveal past the end");

  const esc = reduce(reduce(frozen, { type: "reveal", total: 1, escalate: true }), { type: "submitFinal", party: "driver" });
  assert.equal(esc.stage, "HUMAN_REVIEW");
  assert.equal(passengerView(esc).dispute.phase, "HUMAN_REVIEW");
  assert.equal(driverView(esc).chat, null);
}

// H. Demo 3 claim evidence: private to the uploader, closed on submission, rejected after freeze.
{
  const d3 = initialSession({ demoId: "3", caseId: "DISP-004", sessionId: "t", tripStatus: "COMPLETED" });
  const p0 = passengerView(d3);
  let s = reduce(d3, { type: "uploadEvidence", party: "driver", kind: "photo", name: "seat.jpg" });
  s = reduce(s, { type: "uploadEvidence", party: "driver", kind: "receipt", name: "receipt.jpg" });
  assert.equal(s.photoUploaded && s.receiptUploaded, true);
  assert.deepEqual(passengerView(s), p0, "passenger view changed by driver evidence preparation");
  assert.deepEqual(driverView(s).uploads, { photo: "seat.jpg", receipt: "receipt.jpg" });
  assert.equal(reduce(s, { type: "uploadEvidence", party: "passenger", kind: "photo", name: "x.jpg" }), s, "second party upload accepted");
  s = reduce(s, { type: "submitFormal", party: "driver" });
  assert.equal(s.evidenceSubmissionCompleted, true);
  assert.equal(passengerView(s).dispute.evidenceProvided, true);
  assert.equal(passengerView(s).uploads, null, "uploads leaked to the other party");
  assert.equal(reduce(s, { type: "uploadEvidence", party: "driver", kind: "photo", name: "late.jpg" }), s, "upload accepted after claim submitted");
  const frozen = reduce(s, { type: "startTribunal" });
  assert.equal(reduce(frozen, { type: "uploadEvidence", party: "driver", kind: "receipt", name: "late.jpg" }), frozen, "upload accepted after freeze");

  // Skip path: claim filed without the required evidence.
  const skipped = reduce(d3, { type: "submitFormal", party: "driver" });
  assert.equal(driverView(skipped).dispute.evidenceProvided, false);
}

// I. Live mode: case id fixed once set; live completion follows the real route, only after freeze.
{
  let s = reduce(fresh(), { type: "live", status: "CREATED", caseId: "DISP-100" });
  s = reduce(s, { type: "live", status: "RUNNING", caseId: "DISP-999" });
  assert.equal(s.liveCaseId, "DISP-100");
  assert.equal(reduce(s, { type: "finishTribunal", escalate: true }), s, "finished before freeze");
  s = reduce(reduce(s, { type: "submitFormal", party: "passenger" }), { type: "startTribunal" });
  assert.equal(reduce(s, { type: "finishTribunal", escalate: true }).stage, "HUMAN_REVIEW");
  assert.equal(reduce(s, { type: "finishTribunal", escalate: false }).stage, "DECISION");
  assert.equal(driverView(s).dispute.liveCaseId, "DISP-100");
}

// G. Tribunal cannot start without a formal complaint.
assert.equal(reduce(fresh(), { type: "startTribunal" }).frozen, false);

// D. Reset returns to the initial state.
{
  const init = fresh();
  const s = reduce(reduce(init, { type: "submitFormal", party: "passenger" }), { type: "reset" }, init);
  assert.deepEqual(s, init);
}

// E. Session keys are namespaced per demo and per session.
assert.notEqual(sessionKey("1", "001"), sessionKey("2", "001"));
assert.notEqual(sessionKey("1", "001"), sessionKey("1", "002"));

console.log("privacy checks passed");
