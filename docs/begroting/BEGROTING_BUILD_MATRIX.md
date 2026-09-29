# BEGROTING_BUILD_MATRIX

Bijgewerkt: 29 september 2026  
Geaccepteerde HEAD: `5125289`  
Volgende tranche: 9 — §8.10 Servicekosten leegstand + Niet verrekenbare BTW.

| Module | Begroting | Werkelijk | Estimated | P&L-integratie | Productie/UI | Resterend gat |
|---|---|---|---|---|---|---|
| Huur | GEREED | GEREED | GEREED | GEREED | UI niet gebouwd | refreshed-contract-state forecast; aanvullende belast/onbelast UX |
| Beheersvergoeding | GEREED | GEREED | GEREED | GEREED | UI niet gebouwd | geen functioneel gat |
| Managementvergoeding | GEREED | BRONGAT 070 | GEREED, onbekend zonder mapping | GEREED | UI niet gebouwd | Actual-mapping 070 |
| Onderhoud totaal | GEREED | GEREED totaal | GEREED totaal | GEREED | UI niet gebouwd | presentatie/rule-key alignment |
| Verzekeringen | GEREED | GEREED module / BRONGAT per polis | GEREED | GEREED | UI niet gebouwd | presentatie-alignment; Actual per polis |
| Gemeentelijke lasten / WOZ | GEREED | GEREED | GEREED | GEREED | service voor UI aanwezig | geen domeingat |
| Algemene kosten | GEREED | 070: Overige/Makelaar/Bank GEREED; Accountant/Juridisch BRONGAT | GEREED | GEREED | UI niet gebouwd | mappings Accountant/Juridisch |
| Leegstandskosten totaal | GEREED | BRONGAT behalve expliciet bewezen servicekostenmapping na Tranche 9 | GEREED | GEREED één post | UI niet gebouwd | mappings Nuts/Overige/overige admins |
| └ Nuts | GEREED | BRONGAT | GEREED | onderbouwing | UI niet gebouwd | bewezen mapping |
| └ Servicekosten | GEREED | 070 GL4350+OGB4319 bewezen; technische routing Tranche 9 | GEREED | besluit vastgesteld | UI niet gebouwd | overige mappings |
| └ Overige | GEREED | BRONGAT | GEREED | onderbouwing | UI niet gebouwd | bewezen mapping |
| Niet verrekenbare BTW | VOLGENDE TRANCHE | 070 GL4903 eerder bewezen, te verifiëren | HOLD / BUSINESSBESLISSING tenzij contract inmiddels eenduidig | te bouwen | UI niet gebouwd | Estimated-methode |
| Canon erfpacht | HOLD | HOLD | HOLD | HOLD | HOLD | uit scope |
| Opbrengst rente | niet gestart | niet gestart | niet gestart | niet gestart | niet gestart | eigen tranche |
| Rente leningen | niet gestart | niet gestart | niet gestart | niet gestart | niet gestart | bronmodel |
| Geplande verkoop | HOLD | HOLD | n.v.t./afhankelijk | HOLD | HOLD | UX/integratiebesluit |

## Geaccepteerde tranchehistorie

- Tranche 4: `d77b90e` — Gemeentelijke lasten per GL.
- Tranche 5: `44a9731` — Algemene kosten.
- Tranche 6: `650607f` — ketenintegratie en unknown≠zero fixes.
- Tranche 7: `de2ae0e` — Estimated Huur/Beheer/Management.
- Tranche 8: `5125289` — Leegstandskosten Budget/Werkelijk/Estimated/P&L.

## Besluit §8.10 — 29-09-2026

Expliciet bewezen `070 / GL4350 + OGB4319` mag economisch worden gepresenteerd als `Leegstandskosten → Servicekosten` via een expliciete GL+OGB-presentatiemapping. Bron-hoofddomein blijft Servicekosten eigenaar. Geen volledige GL4350-herclassificatie; geen omschrijvingsclassificatie; geen overerving naar andere administraties; Actual exact één keer.

## Open beslissingen

- Estimated-methode Niet verrekenbare BTW.
- startflow.
- aanvullende huur-UX.
- autosave/locking.
- algemene export/reporting.
- versiebeheer-UX na vaststelling.
- nog niet ontworpen module-UX.
- toekomstige mappings uitsluitend na bronbewijs.
