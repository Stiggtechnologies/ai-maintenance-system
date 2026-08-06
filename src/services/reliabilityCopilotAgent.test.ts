import { describe, expect, it } from "vitest";
import {
  generateReliabilityReport,
  type ReliabilityReport,
} from "../lib/reliability-report-engine";
import { buildLiveAgentQuery } from "./reliabilityCopilotAgent";

const chronicPumpHistory = [
  "work_order_id,asset_id,failure_mode,downtime_hours,repair_hours,maintenance_cost,description",
  "WO-001,P-101,Seal failure,36,8,12000,Seal failed after startup with intermittent solids in process water",
  "WO-002,P-101,Seal failure,34,7,11000,Seal leakage after restart",
  "WO-003,P-101,Seal failure,40,9,14000,Seal faces damaged after startup transient",
  "WO-004,P-101,Seal failure,32,8,10000,Seal leak with solids observed",
  "WO-005,P-101,Seal failure,38,10,15000,Repeat seal failure shortly after startup",
].join("\n");

function buildReport(): ReliabilityReport {
  return generateReliabilityReport({
    mode: "RCA",
    prompt:
      "Analyze pump P-101: 5 seal failures in 9 months, 180 hours downtime, process water with intermittent solids, failures often after startup. Build an RCA/FRACAS starter pack with evidence gaps, likely failure modes, corrective actions, and approval gates.",
    csvText: chronicPumpHistory,
    inputs: {
      operatingHours: 9000,
      failures: 5,
      repairHours: 42,
      repairEvents: 5,
      missionTimeHours: 100,
    },
  });
}

describe("reliabilityCopilotAgent", () => {
  it("asks the live agent to behave like a governed reliability engineer, not a generic chatbot", () => {
    const query = buildLiveAgentQuery({
      mode: "RCA",
      prompt:
        "Analyze pump P-101: 5 seal failures in 9 months, 180 hours downtime, process water with intermittent solids, failures often after startup. Build an RCA/FRACAS starter pack with evidence gaps, likely failure modes, corrective actions, and approval gates.",
      csvText: chronicPumpHistory,
      report: buildReport(),
    });

    expect(query).toContain("Average downtime per event for top bad actor");
    expect(query).toContain("36.00 hours/failure");
    expect(query).toContain("MTBF cannot be calculated");
    expect(query).toContain("Do not convert calendar time to operating time");
    expect(query).toContain("Never label calendar recurrence interval as MTBF");
    expect(query).toContain("RCA/FRACAS starter pack");
    expect(query).toContain("Rank likely failure modes");
    expect(query).toContain("Retrieved reliability knowledge grounding");
    expect(query).toContain("Mechanical equipment reliability prediction");
    expect(query).toContain("Do not invent missing evidence");
    expect(query).toContain("failure investigation reports as report-format");
    expect(query).toContain("approval gates");
    expect(query).toContain("failure review board");
    expect(query).toContain("Do not use emojis");
    expect(query).toContain("under 1,100 words");
    expect(query).toContain(
      "Immediate containment actions should be reversible",
    );
  });
});
