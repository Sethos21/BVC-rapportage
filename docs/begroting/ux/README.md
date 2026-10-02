# Begrotingsmodule — vastgestelde UX-set

Status: overdracht van vastgesteld ontwerp  
Datum overdracht: 29 september 2026  
Doelmap: `docs/begroting/ux/`

## Doel

Deze map borgt de reeds vastgestelde UX van de exploitatiebegroting als bouwreferentie. De overdracht introduceert geen nieuwe UX-besluiten en wijzigt geen bestaande businessregels.

## Bronhiërarchie

Bij interpretatie geldt de volgende volgorde:

1. Een expliciet later geaccepteerd besluit in `../BEGROTING_MASTER_CONTRACT.md` en de actuele GitHub-contractset.
2. `FO_Exploitatiebegroting_v1.0.md` en `FO_Exploitatiebegroting_v1.0_ADDENDUM_2026-09-16.md` voor functionele en financiële regels.
3. `09_Begrotingsmodule_UX_Vastgesteld.md` voor de vastgestelde gebruikersflow, schermwerking en invoerregels.
4. `10_Begrotingsmodule_UX_Ontwerpen_Index.md` en de afzonderlijke bestanden in `UX_Ontwerpen/` als visuele referentie.
5. `prototype/` en `11_Begrotingsmodule_Werkend_Prototype.zip` als interactieve en technische referentie.

Het prototype is geen zelfstandige bron van businesslogica. Bij strijd tussen prototype en het vastgestelde UX-contract is `09_Begrotingsmodule_UX_Vastgesteld.md` leidend. Bij strijd met een later expliciet besluit in de actuele `BEGROTING_MASTER_CONTRACT.md` is dat latere besluit leidend.

## Leidende functionele en UX-bestanden

| Bestand | Rol |
|---|---|
| `FO_Exploitatiebegroting_v1.0.md` | Functioneel ontwerp en oorspronkelijke ontwerpbesluiten. |
| `FO_Exploitatiebegroting_v1.0_ADDENDUM_2026-09-16.md` | Latere aanvullingen op het functioneel ontwerp. |
| `09_Begrotingsmodule_UX_Vastgesteld.md` | Vastgesteld UX-contract voor hoofdflow en uitgewerkte modules. |
| `../BEGROTING_MASTER_CONTRACT.md` | Actuele GitHub-contractset; later expliciet geaccepteerde besluiten hebben voorrang. |
| `../BEGROTING_AUTONOMOUS_BUILD_PROTOCOL.md` | Geldend bouw- en gateprotocol. |
| `../BEGROTING_BUILD_MATRIX.md` | Actuele technische bouwstatus en resterende gaten. |

## Visuele referentie

`10_Begrotingsmodule_UX_Ontwerpen_Index.md` beschrijft per ontwerp de bestandsnaam, module, status en het gebruik. De volgende ontwerpen zijn vastgesteld:

1. `UX_Ontwerpen/UX_01_Hoofdscherm_en_Huur.jpg`
2. `UX_Ontwerpen/UX_02_Beheersvergoeding.jpg`
3. `UX_Ontwerpen/UX_03_Managementvergoeding.jpg`
4. `UX_Ontwerpen/UX_04_Gepland_Onderhoud.jpg`
5. `UX_Ontwerpen/UX_05_Correctief_Dagelijks_Onderhoud.jpg`
6. `UX_Ontwerpen/UX_06_Verzekeringen.jpg`
7. `UX_Ontwerpen/UX_07_Verzekeringen_Maandverloop.jpg`
8. `UX_Ontwerpen/UX_08_Gemeentelijke_Lastenen_WOZ.jpg`
9. `UX_Ontwerpen/UX_09_Canon_Erfpacht.jpg`
10. `UX_Ontwerpen/UX_10_Verborgen_Onderdelen.jpg`
11. `UX_Ontwerpen/UX_11_Controle_en_Vaststellen.jpg`
12. `UX_Ontwerpen/UX_12_Vaststellen_Bevestiging.jpg`
13. `UX_Ontwerpen/UX_13_Terugkijken_Vastgesteld.jpg`

Niet-geselecteerde opties, tussentijdse QA-afbeeldingen en oudere captures zijn bewust niet opgenomen. Zij zijn geen actuele ontwerpbron.

## Prototype

- `prototype/` bevat de uitgepakte, rechtstreeks leesbare bron van de werkende referentie.
- `prototype/README.md` beschrijft de inhoud en het lokaal starten van de referentie.
- `11_Begrotingsmodule_Werkend_Prototype.zip` bevat dezelfde opgeschoonde prototypebron als overdrachtsarchief.

De uitgepakte map bevat geen `node_modules`, gegenereerde `dist`-map, build-cache, tijdelijke bestanden, QA-captures of lokale absolute paden. Het prototype gebruikt alleen statische HTML, CSS en JavaScript met een lokale icoonasset.

## Werkinstructie voor Claude

- Lees vóór implementatie de actuele contractset in `docs/begroting/`.
- Lees vervolgens het relevante deel van het FO, addendum en UX-contract.
- Gebruik ontwerpen en prototype uitsluitend voor layout, informatiehiërarchie, interactie en visuele controle.
- Wijzig geen UX-besluit, verwijder geen veld en promoveer geen prototypegedrag tot businessregel.
- Los ontbrekende of tegenstrijdige UX niet zelfstandig op: gebruik `BUSINESSBESLISSING` bij ontbrekende functionele besluitvorming en `CONTRACTCONFLICT` bij echte strijd tussen leidende bronnen.

## Bekende scopepoort

Voor Canon/Erfpacht bestaat een vastgesteld UX-ontwerp in deze set. De actuele `BEGROTING_MASTER_CONTRACT.md` zet Canon/Erfpacht echter op `HOLD/uit scope`. Dit ontwerp blijft daarom uitsluitend geborgd als vastgestelde toekomstige UX-referentie totdat een later expliciet contractbesluit de implementatiescope wijzigt. Dit overdrachtscommit lost die scopepoort niet op.
