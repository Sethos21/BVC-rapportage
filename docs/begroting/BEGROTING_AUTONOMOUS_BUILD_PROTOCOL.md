# BEGROTING_AUTONOMOUS_BUILD_PROTOCOL

Status: leidend bouwprotocol  
Bijgewerkt: 29 september 2026  
Behoort bij `BEGROTING_MASTER_CONTRACT.md`.

## 1. Bron

Claude leest vóór iedere tranche de contractset in `docs/begroting/` op de geaccepteerde branch/HEAD. Deze GitHub-versie is leidend voor implementatie. Oudere Drive-kopieën zijn archief en mogen GitHub niet overschrijven.

## 2. Gates per module

A Functioneel: ontbrekende businessregel → `BUSINESSBESLISSING`.  
B Contract: echte strijd → `CONTRACTCONFLICT`.  
C Architectuur: wijziging bewezen invariant nodig → `ARCHITECTUURPUNT`.  
D Bron: betrouwbare bron ontbreekt → `BRONGAT`.

Geen gate met aannames omzeilen. Een STOP op één onderdeel blokkeert andere groene onderdelen niet automatisch.

## 3. Delta Build

Per module:
1. inspecteer relevante contractsectie + bestaande code;
2. bewijs wat al bestaat;
3. voer Gate A-D uit;
4. bouw kleinste correcte delta;
5. migrations alleen volgens bestaand patroon;
6. targeted tests;
7. package/integratieregressie;
8. worker-tests indien geraakt;
9. `pnpm -r typecheck`;
10. `git diff --check`;
11. logische commits;
12. tranche-acceptatierapport.

Geen unrelated cleanup. `.vscode/` en `AGENTS.md` niet meenemen tenzij expliciet opgedragen.

## 4. Harde bouwregels

Claude mag technische namen/helpers/teststructuur zelfstandig kiezen binnen bestaande conventies.

Claude mag NIET:
- financiële definities wijzigen;
- mappings of bronbetekenis raden;
- onbekend naar €0 converteren;
- vrije tekst/omschrijving classificeren;
- 070 hardcoden als generieke waarheid;
- Actual dubbel tellen;
- kunstmatig verdelen;
- nieuwe UX ontwerpen waar die open is;
- een geaccepteerde fase opnieuw ontwerpen;
- Estimated Budget laten muteren.

## 5. Cross-domain P&L-presentatie

Vanaf besluit 29-09-2026 is cross-domain economische P&L-presentatie uitsluitend toegestaan via een expliciet bewezen GL+OGB-presentatiemapping conform Master Contract §6.

Dit verandert het bron-hoofddomein niet. De boeking moet exact één keer in de uiteindelijke P&L voorkomen.

Bewezen eerste mapping:
`070 / GL4350 + OGB4319 → Leegstandskosten / Servicekosten`.

Geen generieke afleiding naar andere administraties of OGB's.

## 6. Tranche 9

Start vanaf geaccepteerde HEAD `5125289`.

Deel A:
- sluit §8.10 technisch af voor de bewezen 070-combinatie;
- geen heel-GL4350-herclassificatie;
- bewijs geen dubbeltelling en onveranderd Actual-totaal.

Deel B: Niet verrekenbare BTW.
- Gate A-D;
- Budget: voorstel vorig Werkelijk waar betrouwbaar + handmatige override + bewust €0;
- Werkelijk via bewezen administratiegebonden mapping; 070/GL4903 verifiëren;
- geen btw-pro-rata;
- ontbrekende historie/mapping = onbekend;
- Estimated is OPEN: zonder eenduidig contract STOP `BUSINESSBESLISSING`;
- P&L één zelfstandige post boven EBITDA;
- geen andere module starten.

## 7. Acceptatierapport

Rapporteer:
- start/eind-HEAD en commits;
- gates;
- bronbewijs;
- persistence/migrations;
- Begroting/Werkelijk/Estimated/P&L;
- STOPs;
- tests/regressies/typecheck/diff-check;
- bijgewerkte integratiematrix;
- expliciet: geen verzonnen mapping/businesslogica, onbekend ≠ €0, Actual exact één keer.
