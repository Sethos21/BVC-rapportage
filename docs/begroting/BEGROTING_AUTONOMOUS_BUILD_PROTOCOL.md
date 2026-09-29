# BEGROTING_AUTONOMOUS_BUILD_PROTOCOL

Status: leidend bouwprotocol  
Bijgewerkt: 29 september 2026  
Behoort bij `BEGROTING_MASTER_CONTRACT.md`.

## 1. Bron
Claude leest vóór iedere tranche de contractset in `docs/begroting/` op de geaccepteerde branch/HEAD. Deze GitHub-versie is leidend. Oudere Drive-kopieën zijn archief.

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
Start code-HEAD `5125289`; eind-HEAD `aaca9c7`.

Gebouwd:
- generiek P&L-presentatiemechanisme + bewezen 070 Servicekosten-leegstand-routing;
- Niet verrekenbare BTW Budget;
- Niet verrekenbare BTW Werkelijk;
- Niet verrekenbare BTW P&L;
- persistence/lifecycle, migratie 38.

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

## 8. Eerstvolgende Delta
Start vanaf `aaca9c7` plus deze contractdocumentatiecommit(s).

Bouw uitsluitend §7 technisch af:
- pure Estimated-calculator;
- persistence voor handmatige resterende verwachting volgens bestaand patroon;
- concept/frozen lifecycle voor zover nodig om bestaande Estimated-architectuur correct te volgen;
- P&L Estimated-adapter van TECHNISCH_NIET_ONDERSTEUND naar bekende/ONBEKEND-status volgens input;
- tests voor null versus expliciet €0, Actual exact één keer en Budget immutable;
- migratie alleen indien werkelijk nodig.

Start nog geen andere functionele module. Na acceptatie hiervan kan Tranche 10 worden gekozen.


## 8. Vastgestelde Estimated Niet verrekenbare BTW

`Estimated = Werkelijk t/m afgesloten periode + handmatige resterende verwachting`.

- één resterend bedrag op moduleniveau;
- leeg = onbekend;
- expliciet €0 = geldig;
- geen automatische extrapolatie, Budget-minus-Werkelijk, vorig-jaar-formule, percentage van huur/omzet/kosten of pro-rata;
- geen maand-/kwartaalverdeling;
- Budget blijft immutable.

### Eerstvolgende delta
Start vanaf `aaca9c7` plus de actuele docs-HEAD. Bouw uitsluitend deze Estimated-methodiek technisch af (calculator, noodzakelijke persistence/lifecycle, P&L Estimated-adapter en tests). Start nog geen andere functionele module. Daarna kan Tranche 10 worden gekozen.
