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

Google Drive blijft projectarchief/bronmateriaal, maar een oudere Drive-kopie overschrijft deze GitHub-contractset niet.

Bij echte strijd: `CONTRACTCONFLICT`. Geen stille reconciliatie.

## 2. Harde invarianten

- EUR; bestaande Decimal/money-conventies; geen floating-point businesslogica.
- null/onbekend ≠ €0; bewust €0 is expliciet geldig.
- bronfeiten en aannames gescheiden.
- rekenen in rekenlaag, niet renderer.
- GL is leidend bron-hoofddomein; OGB is verfijning.
- stabiele codes/IDs, geen vrije-tekstclassificatie.
- geen hardcoded administratie 070 als generieke waarheid.
- geen kunstmatige Actual-verdeling.
- geen verzonnen CAPEX-classificatie.
- Actual exact één keer.
- vastgestelde Budget-versie immutable; Estimated muteert Budget niet.
- geaccepteerde fases niet heropenen zonder concrete regressie/contractconflict.

## 3. Lifecycle en Estimated

Flow: Nieuwe begroting → invullen → controleren → vaststellen → terugkijken.

Generiek: `Estimated = Werkelijk t/m afgesloten periode + verwachting resterende periode`.

De module bepaalt hoe resterende verwachting wordt opgebouwd. Als dat niet contractueel is vastgesteld: `BUSINESSBESLISSING`.

## 4. P&L-canon

Boven EBITDA:
- Huuropbrengst belast / onbelast; huurkorting zichtbaar in netto-opbouw.
- Beheersvergoeding; Managementvergoeding.
- Onderhoud.
- Leegstandskosten.
- Verzekeringen.
- Gemeentelijke lasten pand.
- Niet verrekenbare BTW.
- Accountantkosten; Juridische kosten; Makelaar- en taxatiekosten; Overige algemene kosten; Bankkosten.
- EBITDA afgeleid.

Onder EBITDA:
- Rente leningen; Opbrengst rente; Verkoopresultaat; Zonnestroom waar van toepassing.
- Herwaardering/Goodwill standaard verborgen.

Canon/Erfpacht is expliciet HOLD/uit scope.

## 5. Geaccepteerde implementatiestand

Geaccepteerde tranche-HEADs:
- Tranche 4 Gemeentelijke lasten/WOZ: `d77b90e`.
- Tranche 5 Algemene kosten: `44a9731`.
- Tranche 6 integratie: `650607f`.
- Tranche 7 Estimated Huur/Beheer/Management: `de2ae0e`.
- Tranche 8 Leegstandskosten: `5125289`.

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
Budget per relevante GL, Actual, Estimated en P&L gereed. WOZ-voorstel is referentie.
- exact één relevante GL: bewuste `Voorstel overnemen` toegestaan;
- meerdere GL's: handmatig per GL, geen verdeling;
- toon voorstel | GL-budget | verschil; verschil niet-blokkerend;
- onbevestigde WOZ-set blokkeert vaststellen;
- P&L/Estimated gebruikt GL-regelsom, niet WOZ-voorstel.

### Algemene kosten
Accountant/Juridisch/Makelaar-taxatie/Overige/Bank: Budget/Estimated/P&L gereed.
070 Actual: Makelaar/Overige/Bank bewezen; Accountant/Juridisch `BRONGAT`.

### Leegstandskosten
Tranche 8 geaccepteerd op `5125289`.
- één P&L-post met Nuts / Servicekosten / Overige als onderbouwing;
- Budget Q1-Q4, complex optioneel/NTB;
- Estimated = Actual exact één keer + handmatige resterende verwachting;
- zonder bewezen mapping blijft Actual onbekend;
- Nuts/Overige en overige niet-bewezen leegstandsmappings blijven `BRONGAT`.

## 6. HARD BESLUIT §8.10 — cross-domain P&L-presentatie

Besluit 29-09-2026:

Een OGB verandert het bron-hoofddomein niet. Een expliciet bewezen combinatie GL+OGB mag echter via een afzonderlijke expliciete P&L-presentatiemapping economisch onder een andere canonieke P&L-post worden gepresenteerd, mits:
1. GL+OGB uit bron/mapping bewezen is;
2. economische betekenis ondubbelzinnig bewezen is;
3. mapping expliciet wordt vastgelegd;
4. geen omschrijvingsherkenning/fuzzy matching wordt gebruikt;
5. geen bedrag wordt verdeeld of geschat;
6. bronboeking niet wordt gemuteerd;
7. de boeking in de uiteindelijke P&L exact één keer voorkomt.

Concrete bewezen situatie 070:
`GL4350 + OGB4319 → Leegstandskosten → Servicekosten`.

Dus NIET heel GL4350. De bron blijft onder Servicekosten eigenaar; uitsluitend de economische P&L-presentatie wordt gerouteerd. Dezelfde boeking mag niet tevens in de andere P&L-presentatie blijven meetellen.

Andere administraties/OGB's erven dit niet automatisch. Iedere nieuwe cross-domain presentatiemapping moet afzonderlijk bewezen worden.

Hiermee is het eerdere ARCHITECTUURPUNT §8.10 voor deze combinatie inhoudelijk opgelost.

## 7. Niet verrekenbare BTW — volgende module

Contract:
- zelfstandige P&L-post boven EBITDA;
- geen automatische btw-pro-rata;
- Budget: voorstel op basis van Werkelijk vorig jaar indien betrouwbaar beschikbaar, handmatig aanpasbaar;
- ontbrekende historie = onbekend, nooit €0;
- 070: GL4903 eerder bewezen, opnieuw verifiëren tegen repo/mapping;
- andere administraties uitsluitend via bewezen mapping;
- exacte Estimated-methode is OPEN.

Voor Estimated Niet verrekenbare BTW geldt daarom: eerst contractgate. Indien geen eenduidige latere beslissing bestaat → `BUSINESSBESLISSING`; geen eigen forecastmethode kiezen.

## 8. Nog niet starten

- Canon/Erfpacht.
- Rente leningen zonder bewezen bronmodel.
- Opbrengst rente tot eigen tranche.
- Geplande verkoop tot UX/integratiebesluit.
- nieuwe versieflow.
- autosave/locking.
- algemene UI/export.
- refreshed-contract-state huurforecast.
- bronmappings Management/Accountant/Juridisch tenzij afzonderlijk opgedragen.

## 9. STOP-codes

Exact:
- `BUSINESSBESLISSING`
- `CONTRACTCONFLICT`
- `BRONGAT`
- `ARCHITECTUURPUNT`

STOP is een geldige gate-uitkomst.

## 10. Volgende tranche

Tranche 9:
1. implementeer het besluit uit §6 voor bewezen `070 / GL4350 + OGB4319` met Actual exact één keer;
2. bouw Niet verrekenbare BTW voor alle groene gates;
3. Estimated BTW alleen bouwen indien Gate A-D contractueel groen is; anders gericht `BUSINESSBESLISSING`;
4. geen andere module starten.
