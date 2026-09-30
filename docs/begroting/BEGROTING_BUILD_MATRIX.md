# BEGROTING_BUILD_MATRIX

Bijgewerkt: 30 september 2026  
Geaccepteerde code-HEAD: `9a3381b`  
Post-Tranche-13 delta: GEACCEPTEERD. Generieke read-only terugblik en toekomstige contractuele huurkortingen gesloten. Product-readiness fix `9a3381b`: GEACCEPTEERD; Geplande Verkoop (HOLD) blokkeert vaststellen niet meer.

| Module | Begroting | Werkelijk | Estimated | P&L-integratie | Productie/UI | Resterend gat |
|---|---|---|---|---|---|---|
| Huur | GEREED | GEREED | GEREED | GEREED | hoofd-P&L + detail-UX; Contracten/RentRoll + optionele contract_prijsregels | geen kernlogica-gat; echt contract_prijsregels-bestand vereist voor productiegebruik toekomstige kortingen |
| Beheersvergoeding | GEREED | GEREED | GEREED | GEREED | hoofd-P&L + detail-UX; contract-afgeleide netto huurbasis | geen kernlogica-gat |
| Managementvergoeding | GEREED | BRONGAT 070 | GEREED, onbekend zonder mapping | GEREED | invoer-UI aangesloten | bestaande Module-3-systematiek; géén percentage-over-huurmechanisme; Actual-mapping 070 blijft BRONGAT |
| Onderhoud totaal | GEREED | GEREED totaal | GEREED totaal | GEREED | Gepland + Correctief/detail-UI aangesloten | Actual blijft uitsluitend totaalniveau |
| Verzekeringen | GEREED | GEREED module / BRONGAT per polis | GEREED | GEREED | detail-UI aangesloten | Actual per polis BRONGAT |
| Gemeentelijke lasten / WOZ | GEREED | GEREED | GEREED | GEREED | detail-UI aangesloten | geen domeingat |
| Algemene kosten | GEREED | 070: Overige/Makelaar/Bank GEREED; Accountant/Juridisch BRONGAT | GEREED | GEREED | detail-UI aangesloten | mappings Accountant/Juridisch |
| Leegstandskosten totaal | GEREED | Servicekosten 070 bewezen; Nuts/Overige BRONGAT | GEREED | GEREED één post | detail-UI aangesloten | mappings Nuts/Overige/overige admins |
| └ Nuts | GEREED | BRONGAT | GEREED | onderbouwing | via aangesloten Leegstand-detailmodule | bewezen mapping |
| └ Servicekosten | GEREED | GEREED voor 070 GL4350+OGB4319 via §8.10 | GEREED | GEREED | via aangesloten Leegstand-detailmodule | overige mappings |
| └ Overige | GEREED | BRONGAT | GEREED | onderbouwing | via aangesloten Leegstand-detailmodule | bewezen mapping |
| Niet verrekenbare BTW | GEREED | GEREED 070 | GEREED | GEREED | invoer-UI aangesloten | geen kernlogica-gat |
| Canon erfpacht | HOLD | HOLD | HOLD | HOLD | HOLD | uit scope |
| Opbrengst rente | GEREED | BRONGAT 070 / bewezen 013 | GEREED | GEREED onder EBITDA | invoer-UI aangesloten | mapping 070 |
| Rente leningen | GEREED | BRONGAT 070 / bewezen 023 | GEREED | GEREED onder EBITDA | invoer-UI aangesloten | mapping 070 |
| Geplande verkoop | HOLD | HOLD | n.v.t./afhankelijk | HOLD | HOLD | vaststel-gate verwijderd in `9a3381b`; geen UI bouwen |

## Geaccepteerde tranchehistorie

- Tranche 4: `d77b90e` — Gemeentelijke lasten per GL.
- Tranche 5: `44a9731` — Algemene kosten.
- Tranche 6: `650607f` — ketenintegratie en unknown≠zero fixes.
- Tranche 7: `de2ae0e` — Estimated Huur/Beheer/Management.
- Tranche 8: `5125289` — Leegstandskosten Budget/Werkelijk/Estimated/P&L.
- Tranche 9: `cda3baf` — TECHNISCH VOLLEDIG GESLOTEN; §8.10 + Niet verrekenbare BTW Budget/Werkelijk/Estimated/P&L.
- Tranche 10: `50121a7` — Rente leningen + Opbrengst rente Budget/Werkelijk/Estimated/P&L; migratie 40.
- Tranche 11: `efb6074` — eerste geïntegreerde `/begroting`-werkomgeving; vergelijkende P&L, Werkelijk/Estimated-koppeling, vijf invoermodules, controle/vaststellen/terugkijken. Geaccepteerd als integratieketen, niet als volledig afgeronde module.
- Tranche 12: `7f09561` — bewezen Contracten/RentRoll-adapter, frozen Module1Snapshot, echte Voorstel/Jouw-begroting-scheiding voor Huur en Huur/Beheer-detailworkflow.
- Tranche 13: `007e89f` — assemblage Gepland onderhoud, Verzekeringen, Gemeentelijke lasten/WOZ, Algemene kosten en Leegstand; databasepad-unificatie.
- Post-Tranche-13 delta: `e150d93` — generieke read-only detailterugblik + deterministische toekomstige contractuele huurkortingen.
- Product-readiness fix: `9a3381b` — Geplande Verkoop (HOLD) uit vaststel-gate + migratie 41; overige gates ongewijzigd.

## Besluit §8.10 — 29-09-2026

Expliciet bewezen `070 / GL4350 + OGB4319` mag economisch worden gepresenteerd als `Leegstandskosten → Servicekosten` via een expliciete GL+OGB-presentatiemapping. Bron-hoofddomein blijft Servicekosten eigenaar. Geen volledige GL4350-herclassificatie; geen omschrijvingsclassificatie; geen overerving naar andere administraties; Actual exact één keer.

## Definitief besluit Estimated BTW — 29-09-2026

`Estimated = Werkelijk t/m afgesloten periode + handmatige resterende verwachting`.

Eén resterend bedrag; leeg = onbekend; expliciet €0 = geldig. Geen automatische extrapolatie, Budget-minus-Werkelijk, vorig-jaar-formule, pro-rata, percentage van huur/omzet/kosten of maand-/kwartaalverdeling.

## UX-overdracht en volgende bouwfase

Vastgestelde UX-set: `docs/begroting/ux/`, commit `5379798`. De Productie/UI-kolom hierboven betekent dat de financiële motor grotendeels gereed is, maar de daadwerkelijke begrotingswerkflow nog moet worden aangesloten. Tranche 11 bouwt die workflow volgens de vastgestelde UX; niet een managementrapportage. Er is nog geen echte financiële begroting opgesteld, dus historische/nieuwe begrotingswaarden mogen niet worden verzonnen. De vergelijkende P&L ondersteunt het maken van de nieuwe begroting.

## Actuele productstatus / resterende beslissingen
- Startflow: functioneel gebouwd en voldoende voor eerste productieproef; geen redesign nu.
- Aanvullende huur-UX: deels gebouwd; geen blokkade voor eerste productieproef. Alleen uitbreiden bij concreet aangetoond gebruiksgat.
- Autosave/locking: functioneel besloten in Work (autosave concept; één bewerker; overname na 15 minuten inactiviteit), nog niet volledig geïmplementeerd; na eerste single-user productieproef prioriteren.
- Algemene export/reporting: werkelijk open.
- Versiebeheer-UX na vaststelling: werkelijk open; technische lineage-basis bestaat al.
- Geplande verkoop: HOLD en daarom niet toepasselijk voor beoordeling/vaststellen. Historische orphaned gate is gesloten in `9a3381b`.
- Canon/Erfpacht: HOLD.
- Toekomstige mappings: uitsluitend na bronbewijs.

## Eerstvolgende stap

Geen nieuwe financiële tranche. Product-readiness fix `9a3381b` is geaccepteerd. Voer nu eerst een echte single-user BVC-begroting als productacceptatie uit: starten → invullen → controleren → vaststellen → terugkijken. Alleen concrete bevindingen uit deze proef openen eventueel een volgende delta.


## Tranche 12 — eerstvolgende bouwfase

Bouw eerst de ontbrekende echte Contracten/RentRoll → `Module1Snapshot`-adapter. Sluit vervolgens Huur en Beheersvergoeding via de vastgestelde detail-UX aan op de bestaande begrotingsworkflow. De contractbron levert feiten; indexatie/overrides en overige begrotingskeuzes blijven aannames. Managementvergoeding hergebruikt de contract-afgeleide huurbasis conform bestaand contract. Geen refreshed-contract-state forecast in deze tranche.

De Tranche-11 test met €1.200 Werkelijk is een XLSX-fixture door de echte productiecodeketen en mag niet worden geregistreerd als werkelijk financieel resultaat van administratie 070.


## Correctie Beheer/Management — 30-09-2026

De eerdere tekst over een variabele Managementvergoeding was een terminologieverwisseling. Correct is: het **variabele deel van de Beheersvergoeding** gebruikt de netto begrote jaarhuur uit Module 1 als grondslag. Managementvergoeding behoudt de bestaande Module-3-systematiek en krijgt geen percentage-over-huurmechanisme. Actual Management 070 blijft BRONGAT.

## Tranche 13 — eerstvolgende bouwfase

1. Sluit de reeds bewezen toekomstige kortingswijzigingen uit `contract_prijsregels.xlsx` / `contracten_huidig_met_prijzen.xlsx` aan op `BgToekomstigeKortingswijziging` met expliciete kandidaat-resolutie; geen stille keuze bij conflict.
2. Sluit daarna Gepland onderhoud via de vastgestelde UX aan op de bestaande begrotingsworkflow.
3. Actual onderhoud blijft totaalniveau; geen kunstmatige verdeling gepland/correctief.
4. Verzekeringen, Gemeentelijke lasten/WOZ, Algemene kosten en Leegstand blijven buiten Tranche 13.


## Architectuur- en lifecyclebesluit na Tranche 13

- Per administratie één SQLite-bestand voor begrotingsversies/moduledata en P&L-bronmapping. Opnieuw splitsen vereist `ARCHITECTUURPUNT`; bij bestaande historische data tevens een expliciet migratieplan.
- Vastgestelde begrotingen zijn immutable; sinds `e150d93` blijven alle aangesloten detailonderbouwingen generiek via GET leesbaar en zijn schrijfacties geblokkeerd. GESLOTEN.
- Toekomstige kortingswijzigingen uit `contract_prijsregels.xlsx` zijn sinds `e150d93` aangesloten met deterministische resolutie. Conflict per contract/datum = lokaal `BRONGAT`; geen stille kandidaatkeuze. GESLOTEN als softwaredelta.
