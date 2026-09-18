import {
  buildDevelopmentPortfolioRow,
  findNextPortfolioGate,
  type DevelopmentPortfolioRow,
} from "../lib/develop/developmentPortfolio";
import {
  getCaseBenefitsScreen,
  getCaseOperationalReadiness,
  getCasePerformance,
  getDevelopmentCase,
  getGateReadiness,
  listDevelopmentCases,
} from "./developService";

export interface DevelopmentPortfolioResult {
  rows: DevelopmentPortfolioRow[];
  caseCount: number;
  limitations: string[];
  decisionBoundary: string;
}

async function loadRow(caseId: string): Promise<DevelopmentPortfolioRow> {
  const workspace = await getDevelopmentCase(caseId);
  if (!workspace) throw new Error(`Development case ${caseId} was not found`);
  const nextGate = findNextPortfolioGate(workspace);
  const [gateReadiness, performance, operationalReadiness, benefits] =
    await Promise.all([
      nextGate ? getGateReadiness(caseId, nextGate.id) : Promise.resolve(null),
      getCasePerformance(caseId),
      getCaseOperationalReadiness(caseId),
      getCaseBenefitsScreen(caseId),
    ]);
  return buildDevelopmentPortfolioRow({
    workspace,
    nextGate,
    gateReadiness,
    performance,
    operationalReadiness,
    benefits: benefits.benefits,
  });
}

export async function getDevelopmentPortfolio(): Promise<DevelopmentPortfolioResult> {
  const cases = await listDevelopmentCases();
  const rows = await Promise.all(cases.map((item) => loadRow(item.id)));
  return {
    rows,
    caseCount: rows.length,
    limitations: [
      "Portfolio columns preserve each case's recorded units and refusals; they are not normalized into a cross-project score.",
      "A row with no returned High/Critical risks is not evidence that risk is absent.",
    ],
    decisionBoundary:
      "This portfolio is decision support. Gate passage, funding, risk acceptance and operational handover remain separate named human decisions under their existing authority controls.",
  };
}
