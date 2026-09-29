# Begrotingsmodule — Vastgesteld UX-ontwerp

> **INSTRUCTIE VOOR CLAUDE — DOCUMENTHIËRARCHIE**
>
> 1. `FO_Exploitatiebegroting_v1.0.md`  
>    Businessregels en functioneel contract.
> 2. `09_Begrotingsmodule_UX_Vastgesteld.md`  
>    Vastgestelde UX, schermwerking en gebruikersinteractie.
> 3. `10_Begrotingsmodule_UX_Ontwerpen_Index.md` en de gekoppelde ontwerpen  
>    Visuele referentie.
> 4. Code/repository  
>    Huidige technische implementatie.
>
> **Bij een echte tegenstrijdigheid:** niet zelf interpreteren of herstellen. Rapporteer exact welke bronnen conflicteren en vraag om een besluit. Laad bij toekomstige taken alleen de relevante secties voor de module waaraan wordt gewerkt.

Status: vastgesteld overdrachtsdocument op basis van de door de gebruiker goedgekeurde UX-gate in de Work-chat.  
Datum overdracht: 15 september 2026.

## 1. Doel en status van dit document

Dit document draagt uitsluitend reeds genomen UX- en interactiebesluiten over. Het is geen nieuw functioneel ontwerp en voegt geen businessregels toe.

- `FO_Exploitatiebegroting_v1.0.md` blijft leidend voor businesslogica en functionele rekenregels.
- Dit document is leidend voor de vastgestelde schermwerking en gebruikersinteractie.
- De gekoppelde ontwerpen en het werkende prototype zijn de visuele referentie.
- Claude mag deze keuzes niet zelfstandig wijzigen of ontbrekende keuzes invullen.
- Bij strijd tussen FO, dit document, een ontwerp en de code moet Claude stoppen, het concrete verschil rapporteren en om een besluit vragen.
- Bedragen, namen en administratieve codes in de ontwerpbestanden zijn illustratieve prototypegegevens. De structuur en interactie zijn leidend; de demo-inhoud niet.

## 2. Hoofdflow begrotingsmodule

De vastgestelde hoofdflow is:

**Nieuwe begroting → invullen → controleren → vaststellen → terugkijken.**

Daarbinnen geldt:

1. De begroting hoort bij één administratie en één begrotingsjaar en start als concept.
2. De gebruiker vult eerst de benodigde uitgangspunten in. Voor huur is één algemeen indexatiepercentage vooraf vastgesteld.
3. De gebruiker behandelt de zichtbare begrotingsonderdelen vanuit één vergelijkende P&L-weergave.
4. Details worden pas geopend wanneer een gebruiker een onderdeel aanklikt.
5. Een onderdeel wordt bewust beoordeeld. Een inhoudelijke waarschuwing mag zichtbaar blijven; ontbrekende verplichte invoer kan beoordeling blokkeren.
6. Na de invoer gaat de gebruiker naar een afzonderlijke controlepagina.
7. Vaststellen kan pas wanneer alle zichtbare en toepasselijke onderdelen bewust zijn beoordeeld.
8. De gebruiker bevestigt vaststellen één keer. Een toelichting bij vaststelling is optioneel.
9. Na vaststellen is de begroting alleen-lezen en blijft de onderbouwing terug te kijken.

Het precieze startscherm voor het aanmaken en selecteren van administratie/jaar en de uiteindelijke algemene rapportage-uitvoer zijn nog niet afzonderlijk visueel vastgesteld; zie hoofdstuk 12.

## 3. Hoofdscherm / vergelijkende P&L

De gekozen richting is **Optie 1: een rustige, tabelgerichte P&L-werkweergave**. Het hoofdscherm en het detailniveau mogen niet opnieuw worden ontworpen zonder nieuw besluit.

Iedere begrotingsregel toont in deze volgorde:

1. Onderdeel, met bron en actualisatiedatum subtiel onder de naam.
2. Begroting vorig jaar.
3. Realisatie huidig jaar tot en met de laatst afgesloten periode.
4. Estimated huidig jaar.
5. Voorstel nieuw begrotingsjaar, of **Handmatig opgebouwd** wanneer geen automatisch voorstel is voorgeschreven.
6. Jouw begroting voor het nieuwe jaar: direct bewerkbaar of afgeleid uit de onderliggende specificatie.
7. Beoordeling in gewone gebruikerstaal.

De totalen tonen dezelfde bedragsperspectieven. Op de controlepagina wordt de nieuwe begroting primair vergeleken met Estimated. Verschillen worden in euro's getoond; percentages worden gebruikt waar dat per onderdeel is vastgesteld.

Technische statussen en identifiers, zoals `frozen`, `persistentieId` en `reviewStatus`, blijven buiten beeld.

## 4. Huur

Vastgesteld:

- De gebruiker voert één algemeen indexatiepercentage voor het begrotingsjaar vooraf in.
- Dit percentage geldt standaard voor alle huurcontracten.
- Per contract kan via een secundaire actie **Aanpassen** een uitzondering worden ingevoerd; via **Herstellen** gaat het contract terug naar het algemene percentage.
- De specificatie toont de opbouw van contracthuur via indexatie en leegstand/kortingen naar het netto voorstel.
- De gebruiker kan wisselen tussen een complexweergave en een contractweergave.
- De contractweergave toont herkenbaar welke contracten in het begrotingsjaar aflopen en maakt dit een zichtbaar aandachtspunt.
- Een wijziging maakt het onderdeel opnieuw te beoordelen.
- Begroting vorig jaar, realisatie tot en met de afgesloten periode, Estimated en de nieuwe begroting blijven in de werk- en controleweergave zichtbaar.

Niet als afzonderlijk UX-besluit vastgesteld en daarom niet door Claude zelf in te vullen: een generieke invoerflow voor contractuele indexatiedata, belast/onbelast en nieuwe contracten. Hiervoor blijft de FO leidend totdat een aanvullend UX-besluit is genomen.

## 5. Beheersvergoeding

Vastgesteld:

- Beheersvergoeding bestaat uit een afzonderlijk zichtbaar vast en variabel deel en mag niet worden samengevoegd tot één portefeuilletarief.
- De configuratie is per complex.
- Per complex kunnen vast bedrag, indexatiepercentage, indexatiedatum en variabel percentage verschillen.
- Alleen het vaste deel wordt geïndexeerd; de indexatie geldt vanaf de volledige indexatiemaand.
- Het variabele percentage blijft gelijk en verandert alleen door een expliciete aanpassing.
- Het variabele deel wordt per maand berekend over de netto begrote huur van hetzelfde complex uit de huurmodule. De huurgrondslag wordt niet opnieuw ingevoerd.
- Per complex kunnen alleen vast, alleen variabel, beide of geen van beide van toepassing zijn.
- `Niet ingesteld`, een bewuste waarde €0 en 0% blijven inhoudelijk onderscheiden.
- Aanpassing van een beheerafspraak of van de begrote netto huur herberekent het voorstel en vraagt om herbeoordeling.
- De oorspronkelijke overeenkomst blijft zichtbaar en intact; afwijkingen zijn traceerbaar.
- Niet aan een complex toegewezen netto huur krijgt niet stilzwijgend een gemiddeld tarief, maar wordt als aandachtspunt getoond.
- **Voorstel overnemen** vult de nieuwe begroting met het berekende voorstel; bewuste beoordeling blijft nodig.

## 6. Managementvergoeding

Managementvergoeding blijft nadrukkelijk gescheiden van Beheersvergoeding. Onder beide regels staat het subtotaal **Management en beheer**.

Vastgesteld zijn precies drie invoersituaties:

1. **Bestaand indexeren:** het bestaande bedrag blijft vóór de indexatiemaand gelden; indexatie geldt vanaf de volledige maand. Een negatief indexatiepercentage is toegestaan.
2. **Bestaand wijzigen:** het bestaande bedrag blijft vóór de ingangsmaand gelden; vanaf de volledige ingangsmaand vervangt het nieuwe absolute bedrag het oude bedrag.
3. **Nieuwe vergoeding:** vóór de ingangsmaand is het bedrag werkelijk €0. Een lege ingangsdatum betekent vanaf januari.

Verder geldt:

- Bedragen kunnen per maand of per jaar worden ingevoerd; de andere eenheid wordt direct afgeleid.
- €0 is een bewuste waarde en blijft onderscheiden van **Niet ingevuld**.
- Voor administratie 070 is geen betrouwbare bron, grootboekmapping of complexverdeling aangetoond. De UX verzint die niet.
- De invoer is niet per complex zolang daarvoor geen bron of expliciet besluit bestaat.
- **Niet ingevuld** blokkeert uiteindelijk vaststellen; bewust €0 is wel geldig.
- Wanneer Managementvergoeding niet wordt gebruikt, kan de gebruiker het onderdeel per administratie verbergen. Het blijft herstelbaar onder **Verborgen onderdelen**.

## 7. Gepland onderhoud

Vastgesteld:

- De module bevat alleen eigenaar-betaald exploitatieonderhoud; huurdersdoorbelasting hoort bij Servicekosten.
- De nieuwe begroting wordt handmatig per activiteit opgebouwd. Er is geen automatisch onderhoudsvoorstel.
- Het bedrag op de hoofdregel is de som van de activiteiten en is niet los bewerkbaar.
- Iedere activiteit hoort bij precies één complex.
- Verplicht per activiteit: complex, omschrijving, één grootboekrekening, bron/aanleiding met toelichting, Q1–Q4 en status.
- Bronnen: MJOP, inspectie, offerte of overig.
- Optioneel: OGB-kostensoort, leverancier, offertebedrag en notitie.
- Statussen: Gepland, In uitvoering, Uitgesteld, Vervallen, Afgerond en Onvoorzien. Status verandert de financiële optelling niet.
- Bedragen worden per kwartaal vastgelegd; maandinvoer hoort niet in deze module.
- Een hulpmiddel mag een jaartotaal gelijkmatig over Q1–Q4 verdelen.
- Negatieve kwartaalbedragen zijn toegestaan met een niet-blokkerende waarschuwing.
- Ontbrekende verplichte velden blokkeren beoordeling.
- Begroting vorig jaar is referentie en wordt niet automatisch doorgeschoven. Een afzonderlijke activiteit kan bewust worden gekopieerd en daarna als nieuwe activiteit worden gecontroleerd.
- Estimated bestaat uit realisatie tot en met de afgesloten periode plus een handmatig bijgestelde resterende kwartaalverwachting.
- Estimated-only activiteiten zijn toegestaan.
- Zonder betrouwbare match worden boekingen niet automatisch of kunstmatig aan activiteiten gekoppeld; realisatie blijft dan op moduleniveau zichtbaar.
- Geen activiteiten of activiteiten met totaal €0 kunnen bewust als €0 worden beoordeeld.

## 8. Correctief / dagelijks onderhoud

Deze module is bewust eenvoudiger dan Gepland onderhoud en blijft een afzonderlijke P&L-post.

Vastgesteld per begrotingsregel:

- complex optioneel, met **NTB · nader te bepalen** als geldige keuze;
- omschrijving verplicht;
- één grootboekrekening verplicht;
- OGB-kostensoort optioneel;
- één jaarbedrag verplicht.

Bewust niet gevraagd: kwartalen, maanden, status, bron/aanleiding, leverancier, offerte en notitie.

Verder geldt:

- Boekingen worden niet automatisch aan begrotingsregels gekoppeld wanneer gepland en correctief niet betrouwbaar uit de bron zijn te onderscheiden.
- Een leeg bedrag is **Niet ingevuld**, niet €0. Het draagt veilig €0 bij aan het concepttotaal maar blokkeert beoordeling.
- Een ontbrekende omschrijving of grootboekrekening blokkeert beoordeling zonder een ingevuld bedrag uit het concepttotaal te verwijderen.
- Een negatief jaarbedrag is geldig en geeft alleen een waarschuwing.
- De hoofdregel is de som van de detailregels en is niet los bewerkbaar.
- Regels kunnen worden toegevoegd, gewijzigd en verwijderd.
- Geen regels en bewust beoordeeld betekent bewust €0.
- Estimated bestaat uit realisatie plus handmatige resterende verwachtingen; Estimated-only regels zijn toegestaan.
- Begroting vorig jaar blijft uitsluitend referentie; er wordt niets automatisch doorgeschoven of gemiddeld.

## 9. Overige reeds ontworpen begrotingsonderdelen

### 9.1 Verzekeringen

- Eén compacte regel per polis; geen vrij totaal zonder polisonderbouwing als standaardflow.
- Handmatige, traceerbare invoer van complex, verzekeraar, ingangsdatum, looptijd in maanden, huidige jaarpremie en indexpercentage.
- Eén verplichte grootboekrekening; OGB optioneel.
- De jaarpremie blijft een jaarbedrag. Looptijd bepaalt alleen het verlengritme.
- De ingangsdatum is niet automatisch een verlengmoment. Indexatie geldt vanaf de eerste echte verlenging in het begrotingsjaar en wordt dat jaar niet opnieuw gecomponeerd.
- Een polis die later start telt vóór de startmaand als €0; een polis die na het begrotingsjaar start draagt dat jaar geldig €0 bij.
- Ontbrekende rekenvelden geven een veilige €0-bijdrage maar blokkeren beoordeling.
- Negatieve premie, index of override is geldig met waarschuwing.
- Het berekende voorstel blijft zichtbaar naast een optionele handmatige jaaroverride; een override van €0 is geldig.
- Per polis worden Q1–Q4 afgeleid. **Maandverloop** opent januari–december en markeert de eerste verlengings-/indexatiemaand.
- Maand- en kwartaalbedragen zijn controle-informatie, geen extra invoer.
- Estimated is realisatie plus automatisch berekende resterende premie, handmatig aanpasbaar.
- Begroting vorig jaar is alleen-lezen; een ontbrekende historische polisspecificatie wordt niet uit boekingen gereconstrueerd.

### 9.2 Gemeentelijke lasten en WOZ

- Eén P&L-regel **Gemeentelijke lasten pand** voor OZB, watersysteem- en rioolheffing samen.
- De administratie levert de werkelijke lasten, maar geen bruikbare WOZ-waarden.
- De WOZ-specificatie start daarom leeg. De gebruiker voert werkelijke waarden handmatig over van beschikkingen.
- Een WOZ-waarde wordt gekoppeld aan een bestaand complex en daarna aan **Geheel complex** of een bestaande unit; geen vrij adres-/objectveld.
- Verplicht: aanslagjaar, waardepeildatum en positieve werkelijke WOZ.
- De gebruiker bevestigt bewust wanneer de set compleet is. Voor die bevestiging wordt geen historisch lastenpercentage of voorstel berekend.
- De historie bewaart per complex/unit de jaarlijkse waarde en ontwikkeling in euro's en procenten.
- De WOZ-historie kan naar CSV worden geëxporteerd, filterbaar op complex en periode. Zonder bevestigde historie blijft export zichtbaar maar uitgeschakeld.
- Het historische lastenpercentage wordt pas na een complete set berekend als totale werkelijke gemeentelijke lasten gedeeld door totale werkelijke WOZ.
- Voor het nieuwe begrotingsjaar zijn twee onafhankelijke aannames: verwachte WOZ-stijging en verwachte stijging van het gemiddelde lastenpercentage.
- Per complex/unit kan de verwachte WOZ handmatig worden overschreven terwijl het automatische voorstel zichtbaar blijft.
- Estimated is de realisatie tot en met de afgesloten periode plus alleen een handmatige bekende aanvullende aanslag/correctie.
- Het ene P&L-totaal wordt sluitend verdeeld over verplichte grootboekrekeningen; OGB blijft optioneel.

### 9.3 Canon erfpacht

- Eén P&L-regel met één compacte regel per bestaand complex.
- Alleen jaarcanon en indexatiepercentage worden ingevoerd.
- Geen omschrijving, looptijd, ingangsdatum, frequentie of contractvelden.
- Begroot bedrag per complex: `jaarcanon × (1 + indexering)` voor het volledige jaar.
- Een expliciete jaarcanon van €0 betekent bewust geen erfpacht; indexering is dan niet nodig.
- De vaste grootboekrekening blijft zichtbaar, verplicht en leidend; OGB blijft optioneel.
- Als geen enkel pand in een administratie Canon of erfpacht heeft, kan de hele module worden verborgen. Zij telt dan niet mee in voortgang, controle of totalen en blijft met behoud van invoer/status herstelbaar onder **Verborgen onderdelen**.

Andere posten, zoals Algemene kosten, rente, geplande verkoop of een aparte Leegstand-module, zijn in deze UX-gate niet als afzonderlijke module vastgesteld en worden hier niet ontworpen.

## 10. Generieke UX-regels

- Hoofdscherm en detail volgen progressive disclosure: overzicht eerst, specificatie pas na openen.
- Bronnen en actualisatiedata blijven zichtbaar zonder de financiële hoofdtaak te overheersen.
- **Bewust €0** is een expliciete gebruikersactie en verschilt van leeg of onbekend.
- Waarschuwingen zijn concreet en niet-blokkerend, tenzij verplichte invoer ontbreekt.
- Een aanpassing maakt het betrokken onderdeel opnieuw te beoordelen.
- Alleen zichtbare, toepasselijke onderdelen tellen mee in voortgang, controle en totalen.
- Verbergen is geen verwijderen en geen bewuste €0. Verborgen onderdelen blijven vindbaar en herstelbaar.
- De grootboekrekening is op concrete begrotingsregels verplicht en leidend voor de P&L-post.
- OGB-kostensoort is optioneel en onafhankelijk. Eén grootboekrekening kan meerdere OGB-codes bevatten en dezelfde OGB-code kan op meerdere rekeningen voorkomen.
- De gebruiker kiest eerst grootboek. Een eventueel vernauwde OGB-lijst is invoerhulp, geen alternatieve P&L-mapping.
- Zonder OGB blijft een regel geldig; vergelijking vindt dan plaats op grootboek-/P&L-niveau.
- Code is de sleutel; koppeling op omschrijving of een verzonnen OGB-toewijzing is niet toegestaan.
- De controlepagina is een afzonderlijke tweede pagina, geen technisch statuspaneel.
- Vaststellen vereist bewuste beoordeling van alle zichtbare onderdelen. Aandachtspunten mogen blijven bestaan.
- Na vaststellen is alles alleen-lezen. De huidige UX toont de vaststellingsdatum en geen naam van een beoordelaar of vaststeller.
- De huidige werkweergave toont een opgeslagen-status en **Opslaan en sluiten**. Exact autosavegedrag en gelijktijdigheids-/vergrendelingsregels zijn in deze UX-gate niet nader vastgesteld.

## 11. Relatie Begroting — Werkelijk — Estimated

### Wat de gebruiker ziet

- Begroting vorig jaar als referentie.
- Realisatie huidig jaar tot en met de laatst afgesloten periode.
- Estimated huidig jaar.
- Voorstel voor het nieuwe jaar of **Handmatig opgebouwd**.
- Jouw begroting voor het nieuwe jaar.
- Op controle: verschil van de nieuwe begroting ten opzichte van Estimated en het effect op het exploitatieresultaat.

### Functioneel reeds besloten

- Estimated bestaat in beginsel uit realisatie over afgesloten perioden plus een verwachting voor resterende perioden.
- De precieze opbouw van de resterende verwachting verschilt per module en volgt de FO en de vastgestelde modulebesluiten hierboven.
- Begroting vorig jaar is referentie en wordt bij onderhoud en verzekeringen niet stilzwijgend als nieuwe detailregistratie gereconstrueerd.
- Realisatie wordt niet kunstmatig over detailregels verdeeld wanneer stabiele bronkoppeling ontbreekt.
- Grootboek is de leidende vergelijkingsdimensie; OGB kan alleen aanvullende detailvergelijking ondersteunen als dezelfde stabiele code ook in de werkelijke bron voorkomt.

### Nog geen besluit

- Deze UX-gate stelt geen nieuwe EBITDA-rekenregels, mapping of rapportageformules vast.
- De exacte plaats en presentatie van deze begrotingsgegevens in de komende EBITDA-implementatie is nog niet vastgesteld.
- Claude moet voor financiële definities en berekeningen de FO en bestaande architectuur raadplegen en conflicten melden.

## 12. OPEN / NIET VASTGESTELD

Claude mag onderstaande punten niet zelfstandig oplossen:

1. De exacte visuele startflow voor een nieuwe begroting, inclusief administratie-/jaarselectie en alle algemene uitgangspunten buiten het huurindexatiepercentage.
2. Een aanvullende huur-UX voor contractuele indexatiedata, belast/onbelast en het opvoeren van nieuwe contracten, voor zover de FO daarvoor businessregels bevat maar deze Work-UX geen afzonderlijk schermbesluit heeft vastgelegd.
3. Exact autosavegedrag, overname na inactiviteit en één-bewerker-vergrendeling voor deze exploitatiebegroting.
4. De algemene rapportage- en exportlayout van de volledige begroting. Alleen de WOZ-historie-CSV is inhoudelijk vastgesteld.
5. Het maken, vergelijken en beheren van een nieuwe begrotingsversie na vaststelling.
6. De precieze technische/datamodeluitbreiding voor OGB buiten reeds ondersteunde bronclassificaties.
7. Afzonderlijke UX voor niet uitgewerkte posten zoals Algemene kosten, rente, geplande verkoop en een zelfstandige Leegstand-module.
8. De exacte inpassing in de toekomstige EBITDA-implementatie.

