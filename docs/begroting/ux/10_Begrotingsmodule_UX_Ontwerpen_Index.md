# Begrotingsmodule — Index actuele UX-ontwerpen

Status: overdrachtsindex, 15 september 2026.

## Gebruik door Claude

- Raadpleeg eerst de relevante module in `09_Begrotingsmodule_UX_Vastgesteld.md`.
- Gebruik daarna het bijbehorende bestand hieronder als visuele referentie.
- Gebruik `11_Begrotingsmodule_Werkend_Prototype.zip` wanneer gedrag of interactie moet worden gecontroleerd.
- Bedragen, personen, complexnamen en codes zijn illustratieve prototypegegevens. Layout, informatiehiërarchie en interactie zijn leidend.
- Ontwerp ontbrekende schermen of gedrag niet zelf.

## VASTGESTELDE ontwerpen

| Volgorde | Scherm/onderdeel | Bestand | Status | Wat het visualiseert |
|---:|---|---|---|---|
| 1 | Hoofdscherm en Huur | `UX_Ontwerpen/UX_01_Hoofdscherm_en_Huur.jpg` | VASTGESTELD | Optie 1, vergelijkende P&L, detail onder de hoofdregel, algemeen indexatiepercentage, complexverdeling, broninformatie en aandachtspunt voor aflopende contracten. |
| 2 | Beheersvergoeding | `UX_Ontwerpen/UX_02_Beheersvergoeding.jpg` | VASTGESTELD | Vast en variabel afzonderlijk, tarieven per complex, indexatie alleen op vast, netto huur als variabele grondslag. |
| 3 | Managementvergoeding | `UX_Ontwerpen/UX_03_Managementvergoeding.jpg` | VASTGESTELD | Zelfstandige module, ontbrekende bron zichtbaar, drie invoersituaties, bewust €0 en scheiding van Beheersvergoeding. |
| 4 | Gepland onderhoud | `UX_Ontwerpen/UX_04_Gepland_Onderhoud.jpg` | VASTGESTELD | Handmatige activiteiten, kwartaalbedragen Q1–Q4, status, vorige begroting/Estimated en niet-blokkerende aandachtspunten. |
| 5 | Correctief/dagelijks onderhoud | `UX_Ontwerpen/UX_05_Correctief_Dagelijks_Onderhoud.jpg` | VASTGESTELD | Compacte jaarregels met optioneel complex/NTB, verplicht grootboek, optioneel OGB en geen kwartaal-/maandinvoer. |
| 6 | Verzekeringen | `UX_Ontwerpen/UX_06_Verzekeringen.jpg` | VASTGESTELD | Polisregels, verplichte bronvelden, kwartaaluitkomsten, voorstel versus effectieve begroting en grootboek/OGB. |
| 7 | Verzekeringen — maandverloop | `UX_Ontwerpen/UX_07_Verzekeringen_Maandverloop.jpg` | VASTGESTELD | Uitklapbare januari–decembercontrole met markering van de eerste verlengings-/indexatiemaand. |
| 8 | Gemeentelijke lasten en WOZ | `UX_Ontwerpen/UX_08_Gemeentelijke_Lastenen_WOZ.jpg` | VASTGESTELD | Lege eerste WOZ-registratie, handmatige invoer per complex/unit, twee aannames en grootboekverdeling. |
| 9 | Canon erfpacht | `UX_Ontwerpen/UX_09_Canon_Erfpacht.jpg` | VASTGESTELD | Eén jaarcanon en indexatiepercentage per complex, automatisch jaartotaal, bewust €0 en vaste grootboekkoppeling. |
| 10 | Verborgen onderdelen | `UX_Ontwerpen/UX_10_Verborgen_Onderdelen.jpg` | VASTGESTELD | Per administratie verbergen zonder verwijderen/€0, uitsluiten van voortgang en totalen, en herstel via **Weergeven**. |
| 11 | Controle en vaststellen | `UX_Ontwerpen/UX_11_Controle_en_Vaststellen.jpg` | VASTGESTELD | Tweede pagina met Estimated-vergelijking, afwijkingen, resultaat, modulebeoordeling, aandachtspunten en vaststellingsactie. |
| 12 | Vaststellen — bevestiging | `UX_Ontwerpen/UX_12_Vaststellen_Bevestiging.jpg` | VASTGESTELD | Eenmalige bevestiging vóór definitief vaststellen en zicht op het begrote exploitatieresultaat. |
| 13 | Terugkijken — vastgesteld | `UX_Ontwerpen/UX_13_Terugkijken_Vastgesteld.jpg` | VASTGESTELD | Alleen-lezen weergave na vaststellen, status **Vastgesteld**, vaststellingsdatum en blijvend zichtbare onderbouwing/aandachtspunten. |

## Werkend prototype

| Bestand | Status | Gebruik |
|---|---|---|
| `11_Begrotingsmodule_Werkend_Prototype.zip` | VASTGESTELD | Werkende UX-referentie met de schermen en kerninteracties. Niet rechtstreeks als productiecode behandelen; inpassing moet de bestaande repositoryarchitectuur en FO volgen. |

## WERKONTWERP

Er zijn geen niet-goedgekeurde werkontwerpen als actuele referentie opgenomen.

## VERVALLEN / bewust niet overgedragen

| Ontwerp | Status | Reden |
|---|---|---|
| Visuele optie 2 | VERVALLEN | Niet gekozen; Optie 1 is door de gebruiker geselecteerd. |
| Visuele optie 3 | VERVALLEN | Niet gekozen; Optie 1 is door de gebruiker geselecteerd. |
| Tussentijdse QA-comparisons, crops en oudere captures | VERVALLEN ALS OVERDRACHTSREFERENTIE | Alleen gebruikt tijdens controle; vervangen door de genummerde actuele schermbestanden hierboven. |

Deze vervallen bestanden zijn niet geüpload, zodat Claude ze niet als actuele ontwerpbron kan gebruiken.

## Niet aanwezig als vastgesteld ontwerp

Voor de volgende onderwerpen bestaat in deze overdracht geen vastgesteld afzonderlijk ontwerpbestand:

- startscherm nieuwe begroting / administratie- en jaarselectie;
- algemene uitgangspunten buiten het huurindexatiepercentage;
- volledige begrotingsrapportage/export;
- nieuwe versie maken en versies vergelijken;
- afzonderlijke modules voor Algemene kosten, rente, geplande verkoop of Leegstand.

Zie hoofdstuk 12 van `09_Begrotingsmodule_UX_Vastgesteld.md`. Claude moet hiervoor eerst een besluit vragen.

