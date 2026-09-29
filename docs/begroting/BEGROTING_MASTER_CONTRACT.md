# BEGROTING_MASTER_CONTRACT

Status: leidend uitvoeringscontract voor de Exploitatiebegroting  
Bijgewerkt: 29 september 2026  
Repository: `Sethos21/BVC-rapportage`

## 1. Bron van waarheid

Vanaf 29-09-2026 is de contractset in deze repository de leidende bouwwaarheid voor de begrotingsmodule.

Volgorde:
1. FO + addendum;
2. vastgestelde UX-documentatie;
3. expliciet later geaccepteerde business-/architectuurbesluiten in deze contractset;
4. bewezen technische architectuur;
5. code.

Google Drive blijft projectarchief/bronmateriaal, maar een oudere Drive-kopie overschrijft deze GitHub-contractset niet. Bij echte strijd: `CONTRACTCONFLICT`.

## 2. Harde invarianten

- EUR; bestaande Decimal/money-conventies; geen floating-point businesslogica.
- null/onbekend ≠ €0; bewust €0 is expliciet geldig.
- bronfeiten en aannames gescheiden.
- rekenen in rekenlaag, niet renderer.
- GL is leidend bron-hoofddomein; OGB is verfijning.
- stabiele codes/IDs, geen vrije-tekstclassificatie.
- geen hardcoded administratie 070 als generieke waarheid.
- geen kunstmatige Actual-verdeling of verzonnen CAPEX-classificatie.
- Actual exact één keer.
- vastgestelde Budget-versie immutable; Estimated muteert Budget niet.
- geaccepteerde fases niet heropenen zonder concrete regressie/contractconflict.

## 3. Lifecycle en Estimated

Flow: Nieuwe begroting → invullen → controleren → vaststellen → terugkijken.

Generiek: `Estimated = Werkelijk t/m afgesloten periode + verwachting resterende periode`.

De module bepaalt hoe resterende verwachting wordt opgebouwd. Als dat niet contractueel is vastgesteld: `BUSINESSBESLISSING`.

## 4. P&L-canon

Boven EBITDA: Huuropbrengst belast/onbelast; huurkorting zichtbaar in netto-opbouw; Beheersvergoeding; Managementvergoeding; Onderhoud; Leegstandskosten; Verzekeringen; Gemeentelijke lasten pand; Niet verrekenbare BTW; Accountantkosten; Juridische kosten; Makelaar- en taxatiekosten; Overige algemene kosten; Bankkosten. EBITDA is afgeleid.

Onder EBITDA: Rente leningen; Opbrengst rente; Verkoopresultaat; Zonnestroom waar van toepassing. Herwaardering/Goodwill standaard verborgen.

Canon/Erfpacht is expliciet HOLD/uit scope.

## 5. Geaccepteerde implementatiestand

Geaccepteerde tranche-HEADs:
- Tranche 4: `d77b90e`.
- Tranche 5: `44a9731`.
- Tranche 6: `650607f`.
- Tranche 7: `de2ae0e`.
- Tranche 8: `5125289`.
- **Tranche 9: `aaca9c7` — geaccepteerd 29-09-2026.**

### Huur
Budget/Werkelijk/Estimated/P&L gereed. Estimated gebruikt frozen Budget-contractsnapshot + Actual; refreshed-contract-state forecast is toekomstig werk.

### Beheersvergoeding
Budget/Werkelijk/Estimated/P&L gereed.

### Managementvergoeding
Budget/Estimated/P&L gereed; Actual 070 blijft `BRONGAT`.

### Onderhoud
Budget gereed; Actual en Estimated op totaalniveau; Actual nooit splitsen in gepland/correctief. Werkelijk kan boekhouddimensies Gebouwen/Terrein/Installaties behouden.

### Verzekeringen
Budget/Estimated/P&L gereed. Actual module-niveau gereed; per polis geaccepteerd `BRONGAT`.

### Gemeentelijke lasten / WOZ
Budget per relevante GL, Actual, Estimated en P&L gereed. WOZ-voorstel is referentie. Exact één relevante GL: bewuste `Voorstel overnemen`; meerdere GL's: handmatig per GL. Verschil voorstel versus GL-budget is niet-blokkerend. Onbevestigde WOZ-set blokkeert vaststellen.

### Algemene kosten
Budget/Estimated/P&L gereed. 070 Actual: Makelaar/Overige/Bank bewezen; Accountant/Juridisch `BRONGAT`.

### Leegstandskosten
Budget/Estimated/P&L gereed. Na Tranche 9 is Servicekosten leegstand voor de bewezen 070-combinatie ook Actual/P&L gereed. Nuts, Overige en overige niet-bewezen mappings blijven `BRONGAT`.

## 6. HARD BESLUIT §8.10 — cross-domain P&L-presentatie

Een OGB verandert het bron-hoofddomein niet. Een expliciet bewezen combinatie GL+OGB mag via een afzonderlijke expliciete P&L-presentatiemapping economisch onder een andere canonieke P&L-post worden gepresenteerd als broncombinatie en economische betekenis bewezen zijn.

Harde voorwaarden: expliciete mapping; geen omschrijvingsherkenning/fuzzy matching; geen verdeling/schatting; bronboeking niet muteren; uiteindelijke P&L exact één keer.

Bewezen situatie 070:
`GL4350 + OGB4319 → Leegstandskosten → Servicekosten`.

Tranche 9 implementeerde hiervoor een generiek presentatiemechanisme. Bron-hoofddomein blijft Servicekosten eigenaar. Niet heel GL4350 wordt verplaatst. Andere administraties/OGB's erven de mapping niet automatisch. §8.10 is hiermee gesloten.

## 7. Niet verrekenbare BTW — Tranche 9 geaccepteerd

### Budget
- zelfstandige P&L-post boven EBITDA;
- geen automatische btw-pro-rata;
- voorstel op basis van Werkelijk vorig jaar indien betrouwbaar beschikbaar;
- voorstel is informatief en overschrijft handmatige Budget niet;
- handmatige Budgetregels toegestaan;
- bewust €0 geldig;
- ontbrekende historie = onbekend, nooit €0.

### Werkelijk
- uitsluitend bewezen administratiegebonden mapping;
- 070: GL4903 bewezen;
- geen GL-hardcoding in businesslogica;
- zonder bewezen mapping: onbekend.

### Estimated — definitief businessbesluit 29-09-2026
`Estimated Niet verrekenbare BTW = Werkelijk t/m afgesloten periode + handmatig ingevoerde verwachting resterend jaar`.

Regels:
- één handmatig veld/bedrag voor de resterende verwachting op moduleniveau;
- expliciet €0 is geldig;
- leeg/niet ingevuld = onbekend;
- geen automatische extrapolatie;
- niet `Begroting - Werkelijk`;
- niet vorig jaar automatisch doortrekken;
- geen percentage van huur, omzet of kosten;
- geen btw-pro-rata;
- geen maand- of kwartaalverdeling;
- wijziging van de resterende verwachting muteert de vastgestelde Budget niet.

De eerdere `BUSINESSBESLISSING` voor Estimated BTW is hiermee inhoudelijk opgelost. Technische implementatie hiervan is de eerstvolgende kleine delta.

## 8. Nog niet starten

Canon/Erfpacht; rente leningen zonder bewezen bronmodel; Opbrengst rente tot eigen tranche; Geplande verkoop tot UX/integratiebesluit; nieuwe versieflow; autosave/locking; algemene UI/export; refreshed-contract-state huurforecast; bronmappings Management/Accountant/Juridisch tenzij afzonderlijk opgedragen.

## 9. STOP-codes

Exact: `BUSINESSBESLISSING`, `CONTRACTCONFLICT`, `BRONGAT`, `ARCHITECTUURPUNT`. STOP is een geldige gate-uitkomst.

## 10. Eerstvolgende technische delta

Sluit Tranche 9 volledig technisch af door uitsluitend de nu vastgestelde Estimated-methodiek voor Niet verrekenbare BTW te implementeren. Daarna pas een nieuwe functionele Tranche 10 starten.
