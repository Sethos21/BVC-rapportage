# BEGROTING_BUILD_MATRIX

Bijgewerkt: 29 september 2026  
Geaccepteerde code-HEAD: `50121a7`  
Tranche 10: TECHNISCH AFGEROND. UX-set geborgd in `5379798`. Volgende: geïntegreerde invulbare exploitatiebegrotingsworkflow + begrotings-P&L.

| Module | Begroting | Werkelijk | Estimated | P&L-integratie | Productie/UI | Resterend gat |
|---|---|---|---|---|---|---|
| Huur | GEREED | GEREED | GEREED | GEREED | UI niet gebouwd | refreshed-contract-state forecast; aanvullende belast/onbelast UX |
| Beheersvergoeding | GEREED | GEREED | GEREED | GEREED | UI niet gebouwd | geen functioneel gat |
| Managementvergoeding | GEREED | BRONGAT 070 | GEREED, onbekend zonder mapping | GEREED | UI niet gebouwd | Actual-mapping 070 |
| Onderhoud totaal | GEREED | GEREED totaal | GEREED totaal | GEREED | UI niet gebouwd | presentatie/rule-key alignment |
| Verzekeringen | GEREED | GEREED module / BRONGAT per polis | GEREED | GEREED | UI niet gebouwd | presentatie-alignment; Actual per polis |
| Gemeentelijke lasten / WOZ | GEREED | GEREED | GEREED | GEREED | service voor UI aanwezig | geen domeingat |
| Algemene kosten | GEREED | 070: Overige/Makelaar/Bank GEREED; Accountant/Juridisch BRONGAT | GEREED | GEREED | UI niet gebouwd | mappings Accountant/Juridisch |
| Leegstandskosten totaal | GEREED | Servicekosten 070 bewezen; Nuts/Overige BRONGAT | GEREED | GEREED één post | UI niet gebouwd | mappings Nuts/Overige/overige admins |
| └ Nuts | GEREED | BRONGAT | GEREED | onderbouwing | UI niet gebouwd | bewezen mapping |
| └ Servicekosten | GEREED | GEREED voor 070 GL4350+OGB4319 via §8.10 | GEREED | GEREED | UI niet gebouwd | overige mappings |
| └ Overige | GEREED | BRONGAT | GEREED | onderbouwing | UI niet gebouwd | bewezen mapping |
| Niet verrekenbare BTW | GEREED | GEREED 070 | GEREED | GEREED | UI niet gebouwd | geen kernlogica-gat |
| Canon erfpacht | HOLD | HOLD | HOLD | HOLD | HOLD | uit scope |
| Opbrengst rente | GEREED | BRONGAT 070 / bewezen 013 | GEREED | GEREED onder EBITDA | UI niet gebouwd | mapping 070; positieve UI-invoer later |
| Rente leningen | GEREED | BRONGAT 070 / bewezen 023 | GEREED | GEREED onder EBITDA | UI niet gebouwd | mapping 070 |
| Geplande verkoop | HOLD | HOLD | n.v.t./afhankelijk | HOLD | HOLD | UX/integratiebesluit |

## Geaccepteerde tranchehistorie

- Tranche 4: `d77b90e` — Gemeentelijke lasten per GL.
- Tranche 5: `44a9731` — Algemene kosten.
- Tranche 6: `650607f` — ketenintegratie en unknown≠zero fixes.
- Tranche 7: `de2ae0e` — Estimated Huur/Beheer/Management.
- Tranche 8: `5125289` — Leegstandskosten Budget/Werkelijk/Estimated/P&L.
- Tranche 9: `cda3baf` — TECHNISCH VOLLEDIG GESLOTEN; §8.10 + Niet verrekenbare BTW Budget/Werkelijk/Estimated/P&L.
- Tranche 10: `50121a7` — Rente leningen + Opbrengst rente Budget/Werkelijk/Estimated/P&L; migratie 40.

## Besluit §8.10 — 29-09-2026

Expliciet bewezen `070 / GL4350 + OGB4319` mag economisch worden gepresenteerd als `Leegstandskosten → Servicekosten` via een expliciete GL+OGB-presentatiemapping. Bron-hoofddomein blijft Servicekosten eigenaar. Geen volledige GL4350-herclassificatie; geen omschrijvingsclassificatie; geen overerving naar andere administraties; Actual exact één keer.

## Definitief besluit Estimated BTW — 29-09-2026

`Estimated = Werkelijk t/m afgesloten periode + handmatige resterende verwachting`.

Eén resterend bedrag; leeg = onbekend; expliciet €0 = geldig. Geen automatische extrapolatie, Budget-minus-Werkelijk, vorig-jaar-formule, pro-rata, percentage van huur/omzet/kosten of maand-/kwartaalverdeling.

## UX-overdracht en volgende bouwfase

Vastgestelde UX-set: `docs/begroting/ux/`, commit `5379798`. De Productie/UI-kolom hierboven betekent dat de financiële motor grotendeels gereed is, maar de daadwerkelijke begrotingswerkflow nog moet worden aangesloten. Tranche 11 bouwt die workflow volgens de vastgestelde UX; niet een managementrapportage. Er is nog geen echte financiële begroting opgesteld, dus historische/nieuwe begrotingswaarden mogen niet worden verzonnen. De vergelijkende P&L ondersteunt het maken van de nieuwe begroting.

## Open beslissingen
- startflow.
- aanvullende huur-UX.
- autosave/locking.
- algemene export/reporting.
- versiebeheer-UX na vaststelling.
- nog niet ontworpen module-UX.
- toekomstige mappings uitsluitend na bronbewijs.
