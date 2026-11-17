#!/usr/bin/env python3
"""Build the controlled SyncAI professional-services Marketplace PDF."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    Image,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "marketplace" / "professional-services-offers.json"
LOGO_PATH = ROOT / "public" / "brand" / "wordmark-ink.png"
DEFAULT_OUTPUT = ROOT / "output" / "pdf" / "syncai-professional-services-and-fde.pdf"

PAGE_WIDTH, PAGE_HEIGHT = LETTER
MARGIN_X = 0.62 * inch
MARGIN_TOP = 0.72 * inch
MARGIN_BOTTOM = 0.62 * inch
CONTENT_WIDTH = PAGE_WIDTH - (2 * MARGIN_X)

BG = colors.HexColor("#071018")
PANEL = colors.HexColor("#0D1A22")
PANEL_ALT = colors.HexColor("#10242A")
TEXT = colors.HexColor("#F4F8FA")
MUTED = colors.HexColor("#A8B7C2")
DIM = colors.HexColor("#748793")
TEAL = colors.HexColor("#61E1D1")
CYAN = colors.HexColor("#45B8E8")
LINE = colors.HexColor("#203841")
AMBER = colors.HexColor("#F2C66D")


def style(
    name: str,
    *,
    size: float,
    leading: float | None = None,
    color=TEXT,
    font: str = "Helvetica",
    space_after: float = 0,
    alignment: int = TA_LEFT,
) -> ParagraphStyle:
    return ParagraphStyle(
        name,
        fontName=font,
        fontSize=size,
        leading=leading or size * 1.35,
        textColor=color,
        spaceAfter=space_after,
        alignment=alignment,
        allowWidows=0,
        allowOrphans=0,
    )


EYEBROW = style(
    "eyebrow", size=8.2, leading=10, color=TEAL, font="Helvetica-Bold", space_after=8
)
TITLE = style(
    "title", size=28, leading=31.5, color=TEXT, font="Helvetica-Bold", space_after=12
)
H1 = style("h1", size=21, leading=24.5, font="Helvetica-Bold", space_after=9)
H2 = style("h2", size=13, leading=16, font="Helvetica-Bold", space_after=5)
BODY = style("body", size=9.2, leading=13.5, color=MUTED, space_after=7)
BODY_WHITE = style("body-white", size=9.2, leading=13.5, color=TEXT, space_after=6)
SMALL = style("small", size=7.7, leading=10.5, color=DIM)
SMALL_WHITE = style("small-white", size=7.9, leading=10.8, color=TEXT)
CENTER_SMALL = style(
    "center-small", size=8.1, leading=10.8, color=MUTED, alignment=TA_CENTER
)
NUMBER = style(
    "number", size=8, leading=10, color=TEAL, font="Helvetica-Bold", space_after=3
)


class RoundedBox(Flowable):
    def __init__(
        self,
        content,
        width: float,
        *,
        background=PANEL,
        border=LINE,
        padding: float = 12,
        radius: float = 9,
    ):
        super().__init__()
        self.content = content
        self.width = width
        self.background = background
        self.border = border
        self.padding = padding
        self.radius = radius
        self._table = Table([[content]], colWidths=[width - 2 * padding])
        self._table.setStyle(
            TableStyle(
                [
                    ("LEFTPADDING", (0, 0), (-1, -1), padding),
                    ("RIGHTPADDING", (0, 0), (-1, -1), padding),
                    ("TOPPADDING", (0, 0), (-1, -1), padding),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), padding),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )

    def wrap(self, avail_width, avail_height):
        _, height = self._table.wrap(self.width, avail_height)
        self.height = height
        return self.width, height

    def draw(self):
        canvas = self.canv
        canvas.saveState()
        canvas.setFillColor(self.background)
        canvas.setStrokeColor(self.border)
        canvas.setLineWidth(0.8)
        canvas.roundRect(0, 0, self.width, self.height, self.radius, fill=1, stroke=1)
        self._table.canv = canvas
        self._table.drawOn(canvas, 0, 0)
        canvas.restoreState()


def bullet(text: str) -> Paragraph:
    return Paragraph(f"<font color='#61E1D1'>&bull;</font>&nbsp;&nbsp;{text}", BODY)


def page_background(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN_X, 0.42 * inch, PAGE_WIDTH - MARGIN_X, 0.42 * inch)
    canvas.setFillColor(DIM)
    canvas.setFont("Helvetica", 7.4)
    canvas.drawString(MARGIN_X, 0.24 * inch, "SYNCAI  |  CONTROLLED MARKETPLACE COLLATERAL")
    page_text = f"{doc.page} / 4"
    canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 0.24 * inch, page_text)
    canvas.restoreState()


def cover_background(canvas, doc):
    page_background(canvas, doc)
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#0A2027"))
    canvas.circle(PAGE_WIDTH - 0.35 * inch, PAGE_HEIGHT - 0.1 * inch, 2.25 * inch, fill=1, stroke=0)
    canvas.setStrokeColor(TEAL)
    canvas.setLineWidth(2)
    canvas.setStrokeAlpha(0.45)
    for offset in (0.2, 0.42, 0.64):
        canvas.line(
            PAGE_WIDTH - (2.6 - offset) * inch,
            PAGE_HEIGHT - (1.1 + offset) * inch,
            PAGE_WIDTH - (0.3 - offset) * inch,
            PAGE_HEIGHT + (0.35 - offset) * inch,
        )
    canvas.restoreState()


def offer_card(number: str, offer: dict, outcome: str) -> RoundedBox:
    price = offer["pricing"]["referenceAmountUsd"]
    price_text = "US$35,000 standard scope" if price == 35000 else "Customer-specific private offer"
    content = [
        Paragraph(number, NUMBER),
        Paragraph(offer["name"], H2),
        Paragraph(outcome, BODY),
        Spacer(1, 2),
        Paragraph(f"<b>{offer['category']}</b>  |  {price_text}", SMALL_WHITE),
    ]
    return RoundedBox(content, CONTENT_WIDTH)


def stage_cell(number: str, name: str, detail: str):
    return [
        Paragraph(number, NUMBER),
        Paragraph(name, H2),
        Paragraph(detail, SMALL),
    ]


def two_column_boxes(left_title, left_items, right_title, right_items):
    column_width = (CONTENT_WIDTH - 12) / 2
    left = [Paragraph(left_title, H2)] + [bullet(item) for item in left_items]
    right = [Paragraph(right_title, H2)] + [bullet(item) for item in right_items]
    table = Table(
        [[RoundedBox(left, column_width), RoundedBox(right, column_width)]],
        colWidths=[column_width, column_width],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def build_story(manifest: dict):
    offers = {offer["key"]: offer for offer in manifest["offers"]}
    story = []

    logo = Image(str(LOGO_PATH), width=2.2 * inch, height=(2.2 / 2.8145) * inch)
    logo.hAlign = "LEFT"
    story.extend(
        [
            logo,
            Spacer(1, 0.28 * inch),
            Paragraph("PROFESSIONAL SERVICES + FORWARD-DEPLOYED ENGINEERING", EYEBROW),
            Paragraph("From first evidence to enterprise operating capability", TITLE),
            Paragraph(
                "A governed path for industrial asset, reliability, and maintenance teams to assess, prove, implement, and scale SyncAI - without surrendering engineering authority to AI.",
                style("cover-sub", size=12.2, leading=18, color=MUTED, space_after=18),
            ),
            HRFlowable(width="100%", thickness=0.7, color=LINE, spaceBefore=2, spaceAfter=15),
            offer_card(
                "01  ASSESS",
                offers["ria_assessment"],
                "Establish what current evidence proves, expose material gaps, and prioritize a governed 90-day action plan.",
            ),
            Spacer(1, 9),
            offer_card(
                "02  PROVE",
                offers["bounded_proof_of_concept"],
                "Test SyncAI on a bounded decision, fleet, or site using agreed evidence, controls, acceptance criteria, and stop criteria.",
            ),
            Spacer(1, 9),
            offer_card(
                "03  IMPLEMENT + SCALE",
                offers["implementation_and_scale"],
                "Operationalize authorized data, governed workflows, customer ownership, and accepted handoff in production.",
            ),
            Spacer(1, 14),
            Paragraph(
                "Each scope closes with a customer-owned decision: go, change, hold, or stop. There is no automatic expansion.",
                style("cover-note", size=9.4, leading=13.5, color=TEAL, font="Helvetica-Bold"),
            ),
            NextPageTemplate("content"),
            PageBreak(),
        ]
    )

    story.extend(
        [
            Paragraph("VALUE ARCHITECTURE", EYEBROW),
            Paragraph("One governed ladder. One decision loop at every scope.", H1),
            Paragraph(
                "The commercial adoption ladder describes how customer scope expands. The product decision loop describes how work is governed inside every scope. They are connected, but they are not the same thing.",
                BODY,
            ),
            Spacer(1, 10),
        ]
    )
    stage_width = (CONTENT_WIDTH - 20) / 3
    stages = [
        stage_cell("01", "First Decision", "Make one real question understandable, evidence-backed, and saveable."),
        stage_cell("02", "RIA when needed", "Establish readiness and evidence when the baseline is not already defensible."),
        stage_cell("03", "Bounded proof", "Prove fit and value against agreed acceptance and stop criteria."),
        stage_cell("04", "Fleet or site", "Move accepted workflows into a governed production scope."),
        stage_cell("05", "Multi-site", "Federate proven controls, methods, and learning without erasing local authority."),
        stage_cell("06", "Enterprise", "Standardize the operating model while preserving accountable decisions."),
    ]
    rows = []
    for start in (0, 3):
        row = []
        for stage in stages[start : start + 3]:
            row.append(RoundedBox(stage, stage_width, background=PANEL))
        rows.append(row)
    ladder_table = Table(rows, colWidths=[stage_width] * 3, hAlign="LEFT")
    ladder_table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (2, 0), (2, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.extend(
        [
            ladder_table,
            Spacer(1, 8),
            RoundedBox(
                [
                    Paragraph("AT EVERY SCOPE", EYEBROW),
                    Paragraph(
                        "Ask  ->  Understand  ->  Save  ->  Prove  ->  Recommend  ->  Decide  ->  Approve  ->  Verify  ->  Collaborate  ->  Learn",
                        style("loop", size=9.2, leading=14, color=TEXT, font="Helvetica-Bold", alignment=TA_CENTER),
                    ),
                ],
                CONTENT_WIDTH,
                background=PANEL_ALT,
                border=colors.HexColor("#2B6463"),
            ),
            Spacer(1, 10),
            RoundedBox(
                [
                    Paragraph("THE EXPANSION DECISION", H2),
                    Paragraph(
                        "No usage level, enthusiasm signal, account activity, service milestone, or AI recommendation advances scope. A named customer authority records <b>go, change, hold, or stop</b> against accepted evidence, unresolved risks, and verification obligations.",
                        BODY,
                    ),
                    Paragraph(
                        "RIA may be bypassed only when a validated baseline and counterfactual, named owners, authorized data, acceptance and stop criteria, and an approved governance/security boundary already exist.",
                        SMALL,
                    ),
                ],
                CONTENT_WIDTH,
                background=PANEL,
                border=AMBER,
            ),
            PageBreak(),
        ]
    )

    story.extend(
        [
            Paragraph("IMPLEMENTATION DELIVERY", EYEBROW),
            Paragraph("Forward-Deployed Engineering, productized", H1),
            Paragraph(
                "SyncAI Forward-Deployed Engineering is the bounded Implementation offer. Named SyncAI practitioners work virtually with customer owners to configure an accepted operating capability. FDE is not a separate adoption rung and is not open-ended staff augmentation.",
                BODY,
            ),
            Spacer(1, 10),
            two_column_boxes(
                "What the FDE team does",
                [
                    "Defines the approved solution and authority boundary.",
                    "Connects authorized sources and preserves provenance.",
                    "Configures tenant roles, workflows, and specialist roles.",
                    "Establishes acceptance and verification methods.",
                    "Supports adoption, training, and operating-runbook completion.",
                    "Prepares evidence for the next Expansion Decision.",
                ],
                "Authority the customer retains",
                [
                    "Engineering and engineer-of-record authority.",
                    "Investment and risk-acceptance authority.",
                    "Operating, maintenance, and work-execution authority.",
                    "Safety, regulatory, and environmental accountability.",
                    "Production credential, change, and release authority.",
                    "Approval of consequential recommendations.",
                ],
            ),
            Spacer(1, 12),
            RoundedBox(
                [
                    Paragraph("ACCEPTED FDE OUTCOME", H2),
                    Paragraph(
                        "An accepted engagement has an approved tenant, role, data, and authority boundary; governed integrations; configured workflows; measurable acceptance evidence; a customer-owned runbook and support route; training and handover evidence; unresolved obligations; and a recorded decision for the next scope.",
                        BODY_WHITE,
                    ),
                ],
                CONTENT_WIDTH,
                background=PANEL_ALT,
                border=TEAL,
            ),
            Spacer(1, 12),
            Paragraph("FDE WILL NOT", EYEBROW),
            two_column_boxes(
                "No transferred authority",
                [
                    "Approve customer recommendations or accept customer risk.",
                    "Act as the customer engineer of record.",
                    "Change equipment, operating limits, or protection settings.",
                ],
                "No uncontrolled execution",
                [
                    "Issue or close customer work orders.",
                    "Operate or isolate customer equipment.",
                    "Use data or credentials outside the authorized scope.",
                ],
            ),
            PageBreak(),
        ]
    )

    deliverables = [
        ("Evidence stays attributable", "Facts retain source, provenance, freshness, approval, and verification status."),
        ("Recommendations stay advisory", "Rationale, assumptions, uncertainty, consequences, and missing evidence remain visible."),
        ("Approvals stay human", "Customer authority is named; service activity and AI output cannot approve consequential action."),
        ("Value stays honest", "Hypotheses are distinct from observed and verified value, with baseline and method attached."),
        ("Handover stays operational", "Runbook, support route, ownership, unresolved obligations, and continuity are accepted."),
        ("Learning stays reusable", "Verified outcomes and accepted lessons can inform the next decision and scope."),
    ]
    deliverable_rows = []
    cell_width = (CONTENT_WIDTH - 10) / 2
    for start in (0, 2, 4):
        row = []
        for title, detail in deliverables[start : start + 2]:
            row.append(RoundedBox([Paragraph(title, H2), Paragraph(detail, SMALL)], cell_width))
        deliverable_rows.append(row)
    deliverable_table = Table(deliverable_rows, colWidths=[cell_width, cell_width], hAlign="LEFT")
    deliverable_table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (1, 0), (1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.extend(
        [
            Paragraph("CUSTOMER OUTCOMES", EYEBROW),
            Paragraph("What accepted implementation leaves behind", H1),
            Paragraph(
                "Services use the same governed product records as the operating platform. They do not create a shadow evidence, decision, approval, value, or audit system.",
                BODY,
            ),
            Spacer(1, 9),
            deliverable_table,
            Spacer(1, 6),
            RoundedBox(
                [
                    Paragraph("COMMERCIAL PATH", H2),
                    Paragraph(
                        "Professional services are delivered virtually through customer-specific Microsoft Marketplace private offers when available. The recurring SyncAI SaaS subscription remains the platform anchor. The private offer and signed agreement control price, markets, schedule, scope, data handling, responsibilities, acceptance, and exclusions.",
                        BODY,
                    ),
                    Paragraph(
                        "The Reliability Intelligence Assessment has a US$35,000 standard-scope reference and normally runs 6-8 weeks. Proof-of-concept and implementation pricing is customer-specific. Final terms always come from the approved order and private offer.",
                        SMALL_WHITE,
                    ),
                ],
                CONTENT_WIDTH,
                background=PANEL_ALT,
                border=CYAN,
            ),
            Spacer(1, 12),
            Paragraph("IMPORTANT", EYEBROW),
            Paragraph(
                "SyncAI does not guarantee savings, uptime, accuracy, failure avoidance, or return on investment. Results depend on authorized data, customer decisions, operating conditions, implementation, and verified observation. Marketplace availability is confirmed only by a live Microsoft listing and the applicable customer private offer.",
                BODY,
            ),
            Spacer(1, 10),
            HRFlowable(width="100%", thickness=0.7, color=LINE, spaceBefore=4, spaceAfter=10),
            Paragraph(
                "To discuss a bounded engagement: <font color='#61E1D1'>support@syncai.ca</font>",
                style("contact", size=11, leading=14, color=TEXT, font="Helvetica-Bold"),
            ),
            Spacer(1, 5),
            Paragraph(
                "Controlled draft | Prepared 2026-10-05 | Professional-service publication, private-offer purchase, delivery acceptance, and business value are separate evidence gates.",
                SMALL,
            ),
        ]
    )
    return story


def main() -> int:
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_OUTPUT
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if manifest.get("overallStatus") != "controlled_draft":
        raise SystemExit("Refusing to build from an uncontrolled professional-services manifest")
    if any(manifest.get("claims", {}).values()):
        raise SystemExit("Refusing to build collateral that overstates external completion")
    if len(manifest.get("offers", [])) != 3:
        raise SystemExit("Expected exactly three controlled professional-service offers")
    if not LOGO_PATH.exists():
        raise SystemExit(f"Brand wordmark not found: {LOGO_PATH}")

    output.parent.mkdir(parents=True, exist_ok=True)
    document = BaseDocTemplate(
        str(output),
        pagesize=LETTER,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title="SyncAI Professional Services and Forward-Deployed Engineering",
        author="Stigg Technologies",
        subject="Controlled Microsoft Marketplace professional-services collateral",
        creator="SyncAI controlled collateral builder",
        keywords="SyncAI, professional services, Forward-Deployed Engineering, reliability, Microsoft Marketplace",
        pageCompression=1,
    )
    frame = Frame(
        MARGIN_X,
        MARGIN_BOTTOM,
        CONTENT_WIDTH,
        PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="content-frame",
    )
    document.addPageTemplates(
        [
            PageTemplate(id="cover", frames=[frame], onPage=cover_background),
            PageTemplate(id="content", frames=[frame], onPage=page_background),
        ]
    )
    document.build(build_story(manifest))
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
