"""Reviewed section map for the supplied Hildesheim budget revision."""

PROJECT_ID = "hildesheim-harbour"
REVISION = "78e8d0f836df424ba14ad710319bc977d4d2953855ae7960b588f9afb5efc0b3"

# The first topic in each stage is its overview route. All topics remain independently searchable.
STAGES = {
    "infrastructure-assessment": ("Infrastructure assessment",
        "The proposal documents the harbour’s maintenance backlog and reviews the condition of quay walls, railway and basin.",
        ("infrastructure-condition", "maintenance")),
    "strategic-alternatives": ("Strategic alternatives",
        "The administration compared four options. The council selected full expansion and renovation as its preferred option in principle.",
        ("strategic-alternatives", "background-objectives")),
    "financial-feasibility": ("Financial feasibility and funding",
        "The proposal separates estimated costs, projected returns and possible grants. Programme eligibility and the availability of funds are separate questions.",
        ("funding-eligibility", "funding-availability", "investment-estimates", "revenue-feasibility")),
    "external-coordination": ("External coordination",
        "The council continued the WSV agreement and backed coordination on the branch canal, sheet-pile wall, B6 relocation and A7 connection.",
        ("wsv-dependencies",)),
    "political-approval": ("Political approval and allocation",
        "The council prioritized the east quay and harbour railway, provided for west quay planning and moved other measures into the investment programme.",
        ("approved-priorities", "budget-allocations")),
    "execution-monitoring": ("Execution and monitoring",
        "The council requires a report after the summer break and immediate notice of material changes or cost deviations over ten percent.",
        ("reporting-monitoring", "ownership-responsibilities")),
}

# Aliases are retrieval vocabulary, never answer text.
TOPICS = {
    "infrastructure-condition": ("infrastructure condition assessment safety quay wall east west railway steht standsicherheit kaimauer spundwand gleise zustand sanierungsstau kaimauer ost eastern quay"),
    "maintenance": ("maintenance repair dredging basin depths renovation sanierung instandhaltung vertiefung entschlammung hafenbecken"),
    "background-objectives": ("background history objectives strategic geography goals logistics stakeholders hintergrund ziele trimodal gewerbepark entwicklung hafen nord"),
    "strategic-alternatives": ("alternatives options preferred comparison closure retain relocate variants alternativen varianten vorzugsvariante aufgabe erhalt vollständige umsetzung"),
    "investment-estimates": ("cost estimate total investment 105 million cost breakdown aggregate requested kostenschätzung kosten aufstellung gesamtkosten millionen"),
    "funding-eligibility": ("funding stage grant apply directly applicant eligible eligibility city hbg private operator who why antrag antragsberechtigt antragsmöglichkeit fördermittel förderung sgffg kombinierten verkehr efre nbank"),
    "funding-availability": ("funds available funding restrictions own contribution cap grant rate cofinancing own share eigenanteil gebunden mittel ausgestattet quote fördersatz fördermittel sgffg efre"),
    "revenue-feasibility": ("revenue returns income financial feasibility taxes 39.2 39,2 payback cash flow direct projected rückflüsse einnahmen pacht ufergeld gewerbesteuern lohnsteuer wirtschaftlichkeit"),
    "wsv-dependencies": ("wsv external coordination agreement federal dependencies cancellation canal transportation a7 b6 uferspundwand stichkanal wasserstraßen vereinbarung kündigen planfeststellung voraussetzung"),
    "ownership-responsibilities": ("ownership department owner staffing responsibilities operator who leads fb15 fb66 hbg responsibility stellenplan zuständig verantwortung wirtschaftsförderung fachbereich projektgesellschaft smart port"),
    "approved-priorities": ("decision approved council vote priority prioritized east railway west rat beschlossen beschluss 25/522 24/194 24/195 priorität vorrang kaimauer gleise"),
    "budget-allocations": ("allocation budget planning funds commitment authorization western quay 2027 2028 hip haushalt haushaltsplanung ansatz verpflichtungsermächtigung kaimauer west 55202"),
    "reporting-monitoring": ("execution monitor monitoring report reporting deviation above ten percent 10% summer oversight reporting after summer break abweichung projektbericht bericht sommerpause sofort fachausschüsse"),
}

LINKS = {
    "infrastructure-condition": ("maintenance", "approved-priorities", "investment-estimates"),
    "maintenance": ("infrastructure-condition", "budget-allocations", "reporting-monitoring"),
    "background-objectives": ("strategic-alternatives", "wsv-dependencies"),
    "strategic-alternatives": ("background-objectives", "approved-priorities", "revenue-feasibility"),
    "funding-eligibility": ("funding-availability", "ownership-responsibilities", "budget-allocations"),
    "funding-availability": ("funding-eligibility", "investment-estimates", "revenue-feasibility"),
    "investment-estimates": ("budget-allocations", "revenue-feasibility", "funding-availability"),
    "revenue-feasibility": ("investment-estimates", "funding-availability"),
    "wsv-dependencies": ("background-objectives", "approved-priorities", "budget-allocations"),
    "ownership-responsibilities": ("funding-eligibility", "reporting-monitoring", "approved-priorities"),
    "approved-priorities": ("strategic-alternatives", "budget-allocations", "reporting-monitoring"),
    "budget-allocations": ("approved-priorities", "investment-estimates", "funding-availability"),
    "reporting-monitoring": ("ownership-responsibilities", "approved-priorities", "budget-allocations"),
}

# Order matters on pages with several topics. All selected text retains its actual PDF.js range.
SECTIONS = [
    (725, 726, "background-objectives", "Background and regional objectives"),
    (727, 728, "infrastructure-condition", "Condition, safety and maintenance backlog"),
    (729, 732, "wsv-dependencies", "Rail renewal, WSV agreements and connected infrastructure"),
    (733, 737, "background-objectives", "Harbour users, logistics and regional development"),
    (738, 741, "investment-estimates", "Measures and preliminary costs"),
    (742, 743, "ownership-responsibilities", "Organization and delivery responsibilities"),
    (744, 749, "strategic-alternatives", "Four implementation alternatives"),
    (750, 751, "revenue-feasibility", "Operating returns and property revenue"),
    (752, 753, "funding-eligibility", "Funding programmes and applicant rules"),
    (754, 754, "investment-estimates", "Alternatives matrix and preliminary cost estimate"),
    (755, 755, "revenue-feasibility", "Long-term returns and initial proposal"),
    (756, 756, "approved-priorities", "Original proposed implementation decision"),
    (757, 757, "investment-estimates", "October 2025 annual cost schedule"),
    (758, 768, "wsv-dependencies", "12 November 2025 presentation: milestones and agreements"),
    (769, 769, "wsv-dependencies", "Implications of a terminal cancellation"),
    (770, 772, "investment-estimates", "Cost tables and expenditure periods"),
    (773, 778, "strategic-alternatives", "Alternative scenarios and comparison"),
    (779, 779, "funding-availability", "Funding programme summary"),
    (780, 782, "revenue-feasibility", "Throughput and returns to 2095"),
    (783, 783, "background-objectives", "Harbour revitalization"),
    (784, 785, "budget-allocations", "Initial change list and investment programme schedule"),
    (786, 788, "approved-priorities", "Proposed political amendment"),
    (789, 790, "approved-priorities", "Council resolution and vote"),
    (76, 77, "budget-allocations", "Investment plan 2026/2027"),
    (257, 257, "ownership-responsibilities", "Product and organizational index"),
    (266, 266, "ownership-responsibilities", "Budget responsibility index"),
    (293, 293, "budget-allocations", "Product 55202: 2026 finance summary"),
    (299, 299, "budget-allocations", "Product 55202: 2027 finance summary"),
    (448, 449, "ownership-responsibilities", "Product 55201: harbour and property management"),
    (550, 551, "ownership-responsibilities", "Product 55202: harbour infrastructure"),
    (803, 803, "ownership-responsibilities", "Draft staffing change list"),
    (877, 879, "budget-allocations", "Budget proposal 25/499 and product responsibility"),
    (881, 881, "budget-allocations", "Budget proposal amendment 25/499-1"),
    (916, 916, "budget-allocations", "Political budget change list"),
]

# Explicit cross-references to 24/194 and 24/195 live in the proposal and adopted resolution.
# The standalone 24/194 and 24/195 documents are not present in this revision.
# Exact anchor ranges add compact claims that can be linked across documents.
# page, topic, start text, exclusive end text (or end of page), label
ANCHORS = {
    "east-wall-assessment": (728, "infrastructure-condition", "Eine erneute Überprüfung", "Seither", "2024 east quay structural assessment"),
    "wsv-agreement-exit": (730, "wsv-dependencies", "Die Stadt hat die Möglichkeit", None, "WSV agreement and exit conditions"),
    "kv-eligibility": (752, "funding-eligibility", "Das Bundesministerium für Verkehr (BMV)", "Darüber hinaus hat das BMV", "Federal KV programme, eligibility and funding"),
    "efre-availability": (752, "funding-availability", "Über das Programm", "Beide Förderprogramme", "EFRE funding, existing commitments and exclusions"),
    "sgffg-eligibility": (753, "funding-eligibility", "Darüber hinaus gibt es eine Förderung für die Erneuerung", "9. Gründung", "SGFFG operator eligibility and HBG matching funds"),
    "hbg-ownership": (753, "ownership-responsibilities", "Der Betrieb des Hafens wird", "Darüber hinaus wurde bereits", "City ownership, HBG operation and lease"),
    "estimate-total": (770, "investment-estimates", "Gesamtkosten 105 Mio.", "12.11.2025", "€105 million estimate over 2026–2040"),
    "long-term-returns": (782, "revenue-feasibility", "2035 bis 2095", "780", "Projected returns and unquantified tax receipts"),
    "adopted-option": (789, "strategic-alternatives", "Für die weitere Hafenentwicklung", "Die Stadtverwaltung unterrichtet", "Adopted option and administrative mandate"),
    "adopted-reporting": (789, "reporting-monitoring", "Die Stadtverwaltung unterrichtet", "Als vorrangige bauliche Projekte", "Reporting after summer break and immediate escalation"),
    "adopted-priorities": (789, "approved-priorities", "Als vorrangige bauliche Projekte", "Für die Planung der Sanierung", "East quay and railway priorities"),
    "adopted-west-planning": (789, "budget-allocations", "Für die Planung der Sanierung", "Die laufenden Planungen", "West quay planning, HIP and funding mandate"),
    "adopted-wsv": (789, "wsv-dependencies", "Die laufenden Planungen", "Für eine effiziente Umsetzung", "Council mandate on WSV and related infrastructure"),
    "adopted-structure": (789, "ownership-responsibilities", "Für eine effiziente Umsetzung", None, "Organizational review and FB 15 staffing"),
    "adopted-vote": (790, "approved-priorities", "Abstimmungsergebnis:", "Für richtigen Auszug", "Council vote"),
    "product-responsibility": (550, "ownership-responsibilities", "Produkt: 55202", "Aufgabenart", "Product 55202 mandate and responsible department"),
}

# Only the harbour rows are extracted from mixed-topic budget pages.
WINDOWS = {
    76: [("552012011002", None)],
    77: [("Investitionsplan", "57102 SUMME")],
    257: [("55201 Hafen", "553 Friedhofs")],
    266: [("5520200 BgA Infrastrukturmaßnahmen Hafen", "5730101")],
    293: [("55202 BgA Infrastrukturmaßnahmen Hafen", "55300")],
    299: [("55202 BgA Infrastrukturmaßnahmen Hafen", "55300")],
    803: [("Schaffung eines zusätzlichen Stellenanteils", "FB 66.4.2")],
    877: [("Ohne Vorlage 25/426", "Hafenausbau).")],
    878: [("4. Neues Produkt", "Beschlussvorschlag")],
    879: [("dem Investitionsprogramm", "Anlagen:")],
    881: [("Produktbeschreibung 55202", None)],
    916: [("40. 55201", None)],
}
