import { useState } from "react";
import type { DecisionCase, DecisionEvidence } from "../../lib/decision-case";

/** Presentation of the existing crusher example, never a customer analysis engine. */
export function DecisionComparison({
  active,
  onEvidence,
}: {
  active: DecisionCase;
  onEvidence: (evidence: DecisionEvidence) => void;
}) {
  const [selected, setSelected] = useState("verify");
  const options = [
    {
      id: "verify",
      name: "Controlled verification",
      position: "Recommended next step",
      tradeoff: active.recommendationDetail,
      condition:
        "Resolve the pressure-chain conflict before committing capital.",
      evidence: active.evidence.filter((item) => item.quality === "conflict"),
    },
    {
      id: "replace",
      name: "Bearing replacement",
      position: "Evidence required",
      tradeoff:
        "Component replacement remains a capital decision; bearing distress has not been verified.",
      condition:
        active.evidence.find((item) => item.id === "ev-cr01-inspection")
          ?.finding ?? "Post-trip inspection evidence is missing.",
      evidence: active.evidence.filter(
        (item) => item.id === "ev-cr01-inspection",
      ),
    },
    {
      id: "protection",
      name: "Protection-setpoint change",
      position: "Hold existing protection",
      tradeoff: "The example does not establish a new protection limit.",
      condition:
        "The pressure-chain conflict remains unresolved. Retain the existing trip protection.",
      evidence: active.evidence.filter((item) => item.quality === "conflict"),
    },
  ];
  const option = options.find((item) => item.id === selected)!;
  return (
    <section
      className="journey-comparison"
      aria-labelledby="comparison-heading"
    >
      <p className="journey-eyebrow">Decision comparison · sample data</p>
      <h2 id="comparison-heading">Compare the next intervention</h2>
      <p>
        Inspect the trade-offs in this crusher example. Costs, probabilities and
        outcomes remain unquantified.
      </p>
      <div
        className="journey-comparison-options"
        role="group"
        aria-label="Compare interventions"
      >
        {options.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={`Inspect ${item.name.toLowerCase()}`}
            aria-pressed={selected === item.id}
            onClick={() => setSelected(item.id)}
          >
            <span>{item.position}</span>
            <strong>{item.name}</strong>
          </button>
        ))}
      </div>
      <div
        className="journey-comparison-table"
        tabIndex={0}
        aria-label="Intervention comparison"
      >
        <table>
          <caption>
            Evidence and decision boundaries for the three example options
          </caption>
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col">Trade-off</th>
              <th scope="col">Decision condition</th>
            </tr>
          </thead>
          <tbody>
            {options.map((item) => (
              <tr key={item.id} data-selected={selected === item.id}>
                <th scope="row">{item.name}</th>
                <td>{item.tradeoff}</td>
                <td>{item.condition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="journey-comparison-detail" aria-live="polite">
        <strong>{option.name} · inspect the evidence</strong>
        <p>{option.condition}</p>
        {option.evidence.map((item) => (
          <button key={item.id} type="button" onClick={() => onEvidence(item)}>
            {item.title} <span>View sample evidence ↗</span>
          </button>
        ))}
        <small>
          Required authority: {active.authorityRole}. Selecting an option does
          not approve work.
        </small>
      </div>
    </section>
  );
}
