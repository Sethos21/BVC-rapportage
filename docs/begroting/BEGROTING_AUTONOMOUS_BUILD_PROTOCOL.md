# BEGROTING_AUTONOMOUS_BUILD_PROTOCOL

Status: leidend bouwprotocol  
Bijgewerkt: 30 september 2026  
Behoort bij `BEGROTING_MASTER_CONTRACT.md`.

## 1. Bron
Claude leest vóór iedere tranche de contractset in `docs/begroting/` op de geaccepteerde branch/HEAD. Deze GitHub-versie is leidend. Oudere Drive-kopieën zijn archief.

Vanaf UX-overdracht commit `5379798` leest Claude voor UI-/workflowwerk ook `docs/begroting/ux/README.md`, de relevante secties van `09_Begrotingsmodule_UX_Vastgesteld.md`, de UX-index en alleen de relevante ontwerpen/prototypebron. Prototype en JPG's zijn visuele/interactiereferentie, geen zelfstandige businesslogica. Latere expliciete Master-Contractbesluiten gaan voor.

## 2. Gates
A Functioneel → ontbreekt: `BUSINESSBESLISSING`.  
B Contract → echte strijd: `CONTRACTCONFLICT`.  
C Architectuur → invariantwijziging nodig: `ARCHITECTUURPUNT`.  
D Bron → betrouwbare bron ontbreekt: `BRONGAT`.

Geen gate met aannames omzeilen.

## 3. Delta Build
Inspecteer relevante contractsectie en bestaande code; bewijs wat al bestaat; Gate A-D; kleinste correcte delta; migrations volgens bestaand patroon; targeted tests; regressie; worker-tests indien geraakt; typecheck; `git diff --check`; logische commits; acceptatierapport.

Geen unrelated cleanup. `.vscode/` en `AGENTS.md` niet meenemen tenzij expliciet opgedragen.

## 4. Harde bouwregels
Geen financiële definities wijzigen; geen mapping raden; onbekend niet naar €0; geen vrije-tekstclassificatie; 070 niet als generieke waarheid hardcoden; Actual niet dubbel tellen; niet kunstmatig verdelen; geen open UX ontwerpen; geaccepteerde fases niet opnieuw ontwerpen; Estimated muteert Budget niet.

## 5. Cross-domain P&L-presentatie
Expliciet bewezen GL+OGB mag via aparte P&L-presentatiemapping worden gerouteerd zonder het bron-hoofddomein te wijzigen. Exact één keer in de P&L.

Bewezen eerste mapping:
`070 / GL4350 + OGB4319 → Leegstandskosten / Servicekosten`.

Tranche 9 implementeerde dit mechanisme; §8.10 is gesloten.

## 6. Tranche 9 — geaccepteerd
Start code-HEAD `5125289`; eind-HEAD **`cda3baf`**.

Gebouwd:
- generiek P&L-presentatiemechanisme + bewezen 070 Servicekosten-leegstand-routing;
- Niet verrekenbare BTW Budget;
- Niet verrekenbare BTW Werkelijk;
- Niet verrekenbare BTW P&L;
- persistence/lifecycle, migratie 38;
- Estimated Niet verrekenbare BTW volledig gebouwd in `cda3baf`, migratie 39.

Tests/regressies/typecheck/diff-check volgens acceptatierapport groen.

De oorspronkelijke STOP voor Estimated BTW is op 29-09-2026 door de opdrachtgever opgelost.

## 7. Vastgestelde Estimated Niet verrekenbare BTW
Formule:
`Estimated = Werkelijk t/m afgesloten periode + handmatige resterende verwachting`.

Contract:
- één resterend bedrag op moduleniveau;
- leeg = onbekend;
- expliciet €0 = geldig;
- geen automatische extrapolatie;
- geen Budget-minus-Werkelijk;
- geen vorig-jaar-formule;
- geen percentage van huur/omzet/kosten;
- geen pro-rata;
- geen maand-/kwartaalverdeling;
- Budget blijft immutable.

## 8. Tranche 9 gesloten

Estimated BTW is technisch gereed. Migratie 39 bewaart uitsluitend de handmatige resterende verwachting; geen rij = onbekend, expliciet €0 geldig. De P&L Estimated-adapter is actief en Actual wordt exact één keer toegevoegd. Vastgestelde Budget blijft immutable.

Start geen verdere Tranche-9-delta. De volgende opdracht is Tranche 10 conform de actuele Build Matrix.

## 9. Tranche 10 — geaccepteerd

Eind-HEAD `50121a7`. Rente leningen + Opbrengst rente zijn aangesloten op Budget/Werkelijk/Estimated/P&L; migratie 40 bewaart Estimated resterende verwachting. Geen renteberekeningsengine. 070 Actual blijft BRONGAT. Toekomstige UI voor renteopbrengst gebruikt positieve gebruikersinvoer en vertaalt intern naar de ruwe boekhoudconventie.

## 10. Tranche 11 — geaccepteerd

Eind-HEAD `efb6074`. Geaccepteerd als eerste geïntegreerde begrotingswerkomgeving en technisch gesloten integratieketen; niet als volledig afgeronde begrotingsmodule. `/begroting` draait voorlopig op de bestaande Worker serve-server. De HTTP-acceptatietest bewijst de productiecodepaden met XLSX-fixture + echte SQLite/mappingketen, maar is geen bewijs van een werkelijk financieel bedrag uit BVC-productiedata.

## 11. Tranche 12 — geaccepteerd

Eind-HEAD `7f09561`. Contracten + RentRoll zijn gekoppeld aan `BgContractFeiten[]` en frozen `Module1Snapshot`; Huur en Beheersvergoeding hebben detail-UX binnen de bestaande `/begroting`-workflow. De 070-productieproef is read-only uitgevoerd en reproduceert eerder bewezen contracttotalen. Toekomstige kortingswijzigingen uit `contract_prijsregels.xlsx` zijn nog niet ingelezen.

Correctie na Tranche 13: de netto begrote jaarhuur uit Module 1 is de grondslag voor het **variabele deel van de Beheersvergoeding**. Dit mechanisme hoort niet bij Managementvergoeding. Managementvergoeding behoudt de bestaande Module-3-systematiek; voeg daar geen percentage-over-huurmechanisme aan toe. Actual Management 070 blijft BRONGAT.

## 12. Eerstvolgende build — Tranche 13

Bouw eerst de reeds bronmatig bewezen ingestie/resolutie van toekomstige kortingswijzigingen naar `BgToekomstigeKortingswijziging`. Sluit daarna Gepland onderhoud via de vastgestelde UX aan op de bestaande begrotingsworkflow. Hergebruik bestaande onderhoudslogica; Actual onderhoud blijft totaalniveau en wordt nooit kunstmatig gesplitst. Geen verbreding naar Verzekeringen, Gemeentelijke lasten/WOZ, Algemene kosten of Leegstand in deze tranche.


## 13. Tranche 13 — geaccepteerd

Eind-HEAD `007e89f`. De vijf bestaande modules Gepland onderhoud, Verzekeringen, Gemeentelijke lasten/WOZ, Algemene kosten en Leegstand zijn door assemblage aangesloten op `/begroting`; geen financiële motor is opnieuw gebouwd.

Bouwregels vanaf deze acceptatie:
- Beheersvergoeding: bestaand vast + variabel; variabel = percentage × netto begrote jaarhuur Module 1.
- Managementvergoeding: bestaande Module-3-systematiek; geen percentage-over-huurmechanisme.
- Per administratie één SQLite-bestand voor begrotingsversies/moduledata én P&L-bronmapping. Opnieuw splitsen vereist `ARCHITECTUURPUNT`; bij bestaande historische data tevens expliciete migratie.
- Vastgesteld = immutable, maar alle detailonderbouwingen blijven via GET leesbaar. POST/schrijven blijft geblokkeerd.
- De huidige GET-read-only-dekking is nog niet generiek voor alle detailmodules; dat is een kleine lifecycle-restdelta.
