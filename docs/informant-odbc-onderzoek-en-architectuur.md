# Onderzoek directe Informant-koppeling voor BVC Financiële Rapportage Tool

**Status:** onderzoeksdocument / overdracht aan Claude\
**Datum:** 25 augustus 2026\
**Doel:** vastleggen wat reeds praktisch is onderzocht, wat aantoonbaar
werkt, welke architectuurkeuzes zijn gemaakt en welke routes zijn
uitgesloten.

------------------------------------------------------------------------

## 1. Doel van het onderzoek

De BVC Financiële Rapportage Tool gebruikt momenteel Excel-bestanden als
databron. De gewenste toekomstige situatie is een rechtstreekse,
read-only koppeling met Informant, zodat de Worker financiële en
vastgoeddata rechtstreeks uit Informant kan ophalen.

De architectuur moet modulair blijven. Excel is een bronadapter en mag
niet verweven raken met domeinlogica, KPI-berekeningen of presentatie.

Gewenste conceptuele architectuur:

``` text
ExcelSource ───────────────┐
                          ↓
                    normalisatie
                          ↓
                     validatie
                          ↓
                       cache
                          ↓
                    domein / KPI
                          ↓
                     rapportage

InformantOdbcSource ───────┘
```

Tijdens de migratie moeten Excel en Informant naast elkaar kunnen
bestaan, zodat resultaten per administratie en brontype kunnen worden
vergeleken.

------------------------------------------------------------------------

## 2. Belangrijke randvoorwaarde: PxPlus 64-bit is uitgesloten

Voor dit vervolgonderzoek geldt als expliciete randvoorwaarde:

> **PxPlus 64-bit is geen optie.**

Er moet dus niet verder worden ontworpen vanuit:

``` text
bvc-worker.exe x64
→ PxPlus SQL ODBC Driver 64-bit
→ Informant
```

De hoofd-Worker moet ook **niet uitsluitend vanwege Informant naar
32-bit worden teruggebouwd**.

De gekozen richting is daarom:

``` text
bvc-worker.exe x64
        ↓
32-bit Informant ODBC bridge
        ↓
PxPlus SQL ODBC Driver (32-bit)
        ↓
Informant / IDBC
```

De bridge moet uitsluitend een compatibiliteits- en data-accesslaag
zijn.

------------------------------------------------------------------------

## 3. Waarom de BVC Worker x64 moet blijven

De huidige standalone `bvc-worker.exe` is x64.

Dat is wenselijk omdat de Worker verantwoordelijk is voor zwaardere
verwerking, waaronder:

-   brondata verwerken;
-   normalisatie;
-   validatie;
-   cacheopbouw;
-   SQLite;
-   KPI- en domeinlogica;
-   mogelijk grote datasets.

Bij eerdere praktijktests met de Excel-route liep het geheugengebruik
van de Worker op tot circa **2,8 GB** voordat de Excel-verwerking werd
geoptimaliseerd.

De Excel-import is daarna verbeterd met onder andere:

-   SheetJS `dense: true`;
-   bronnen sequentieel verwerken;
-   per bron direct naar SQLite schrijven;
-   niet alle acht bronnen tegelijk in geheugen vasthouden;
-   voortgangslogging.

Daarom is het onwenselijk om de gehele Worker naar 32-bit terug te
brengen alleen omdat de bestaande Informant ODBC-driver 32-bit is.

De 32-bit component moet klein blijven en data in batches/chunks kunnen
doorgeven aan de x64 Worker.

------------------------------------------------------------------------

## 4. Informant-installatie en IDBC-omgeving

In de Informant-omgeving is een IDBC-directory aanwezig:

``` text
V:\Informant\idbc
```

Daar staan File DSN-bestanden voor administraties.

Voorbeelden die praktisch zijn aangetroffen:

``` text
informant 070 rooise zoom.dsn
informant 002 fergagne bv.dsn
informant alle bedrijven.dsn
```

Dit wijst erop dat Informant per administratie een File DSN kan
aanbieden.

Er bestaat daarnaast een DSN voor `alle bedrijven`, maar er is **niet
bewezen** dat deze DSN automatisch alle transactiedata van alle
administraties ontsluit. Zie verder §12.

------------------------------------------------------------------------

## 5. Inhoud van de File DSN voor administratie 070

De DSN van administratie 070 / Rooise Zoom is handmatig geopend en
onderzocht.

Belangrijke configuratie:

``` text
DRIVER=PxPlus SQL ODBC Driver (32-bit)
Directory=V:\Informant\idbc
ViewDLL=V:\Informant\pvx
Logfile=V:\Informant\data\informant_log\idbclog.txt
```

De `Prefix` bevat zowel algemene Informant-data als
administratie-specifieke data voor administratie 070, conceptueel:

``` text
V:\Informant\data\all\
V:\Informant\data\070\
```

Dit ondersteunt het beeld dat een administratie-DSN algemene data
combineert met de administratiecontext.

------------------------------------------------------------------------

## 6. DSN `informant alle bedrijven`

Ook `informant alle bedrijven.dsn` is onderzocht.

Deze gebruikt in de Prefix administratie/context:

``` text
000
```

Belangrijk:

> We hebben **niet bewezen** dat context `000` betekent dat alle
> boekingen/transacties van alle administraties via één query
> beschikbaar zijn.

Daarom mag de implementatie niet aannemen:

``` text
000 == alle administraties in één transactiedataset
```

Dit moet eventueel later apart read-only worden getest.

------------------------------------------------------------------------

## 7. Geïnstalleerde PxPlus ODBC-driver

Via de Windows **32-bit ODBC Data Source Administrator**:

``` text
C:\Windows\SysWOW64\odbcad32.exe
```

is praktisch vastgesteld dat deze driver geïnstalleerd is:

``` text
PxPlus SQL ODBC Driver (32-bit)
versie 7.00.02.00
PVX Plus Technologies Ltd.
```

Deze driver wordt daadwerkelijk gebruikt door de Informant File DSN's.

De gebruiker heeft geen lokale administratorrechten.

Een test met:

``` cmd
net session
```

resulteerde in geen toegang / access denied.

Installatie of wijziging van systeemdrivers vereist daarom IT/beheer en
mag niet als normale gebruikersstap worden aangenomen.

------------------------------------------------------------------------

## 8. Meegeleverde ODBC-componenten in Informant

Een zoekactie in `V:\Informant` liet onder andere de volgende bestanden
zien:

``` text
V:\Informant\install\odbc\iodbc_32.exe
V:\Informant\install\odbc\sql_odbc_driver_7.00.0002_w32.exe
V:\Informant\install\odbc\sql_odbc_driver_7.00.0002_w64.exe
V:\Informant\install\odbc\sql_server_7.00.0002_w32.exe
V:\Informant\install\odbc\sql_server_7.00.0003_W32.exe
```

Verder zijn onder andere aanwezig:

``` text
V:\Informant\pvx\pxplus.exe
V:\Informant\pvx\pxserver.exe
V:\Informant\pvx\PxIO.dll
V:\Informant\pvx\pxpado.dll
V:\Informant\pvx\sqlite3.exe
```

En diverse query/SQL-gerelateerde PxPlus-componenten.

Hoewel er een w64-driverinstaller aanwezig is, geldt voor het
vervolgproject de expliciete randvoorwaarde dat **PxPlus 64-bit geen te
gebruiken optie is**.

Claude moet dus niet proberen het ontwerp alsnog rond de w64-driver te
bouwen.

------------------------------------------------------------------------

## 9. Excel/Microsoft Query als praktische ODBC-testclient

De geïnstalleerde Microsoft Excel is:

``` text
Microsoft Excel 32-bit
```

Dit sluit aan op de bestaande PxPlus ODBC 32-bit driver.

Via:

``` text
Excel
→ Gegevens
→ Gegevens ophalen
→ Uit andere bronnen
→ Microsoft Query
```

zijn de Informant File DSN's zichtbaar.

De DSN:

``` text
informant 070 rooise zoom
```

is succesvol geopend.

Dit is belangrijk: de ODBC-koppeling is niet alleen theoretisch of op
basis van configuratie onderzocht; er is daadwerkelijk data uit
Informant gelezen.

------------------------------------------------------------------------

## 10. PxPlus Connection Test en Schema Test

Via de configuratie van de 32-bit PxPlus ODBC-driver is voor
administratie 070 getest:

### Test Connection

Resultaat:

``` text
Connection succeeded.
```

### Test Schema

De schema-test duurde relatief lang en Windows meldde tijdelijk dat het
configuratievenster niet reageerde. De test is bewust niet direct
afgebroken.

Uiteindelijk was het resultaat succesvol:

``` text
Schema test succeeded.
281 tables accessible.
```

Conclusie:

-   de File DSN is functioneel;
-   de PxPlus ODBC-driver kan de Informant-data benaderen;
-   het schema kan worden gelezen;
-   **281 tabellen zijn toegankelijk** via deze administratiecontext.

------------------------------------------------------------------------

## 11. `Boekingen` is rechtstreeks via ODBC toegankelijk

Via Microsoft Query is de tabel:

``` text
Boekingen
```

gevonden.

Er zijn daarnaast varianten zichtbaar, waaronder:

``` text
Boekingen
Boekingen alleen bedragen
Boekingen BTW
Boekingen extra
```

`Boekingen` bevat velden die rechtstreeks aansluiten op de financiële
rapportagebehoefte, waaronder onder andere:

``` text
Bedrijfsnr
Bedrijfsnaam
Boeking_Bedrag_Credit
Boeking_Bedrag_Debet
Boeking_Boekdatum
Boeking_Boekjaar
Boeking_Boekperiode
Boeking_Boekstuknr
```

en aanvullende boekingsvelden.

------------------------------------------------------------------------

## 12. `Boekingen` is als Table geclassificeerd

Microsoft Query heeft opties om objecttypen te tonen, waaronder:

-   Tabellen;
-   Weergaven.

Er is praktisch getest met:

``` text
Tabellen    = aan
Weergaven   = uit
```

`Boekingen` bleef zichtbaar.

Daarmee is vastgesteld dat `Boekingen` door deze ODBC-laag als **Table**
wordt aangeboden en niet uitsluitend als View.

Voor de overige BVC-bronnen is niet ieder object afzonderlijk op deze
manier getest, maar de gebruiker kent de Informant-omgeving en verwacht
vrijwel zeker dat deze op dezelfde wijze beschikbaar zijn.

De implementatie mag desondanks geen harde aanname maken dat elk object
altijd een gewone table is als dat technisch relevant is.

------------------------------------------------------------------------

## 13. Eigen SQL-query via PxPlus ODBC werkt

Via Microsoft Query is succesvol een eigen read-only SQL-query
uitgevoerd.

Geteste query:

``` sql
SELECT Bedrijfsnr,
       Bedrijfsnaam,
       Boeking_Boekjaar,
       Boeking_Boekperiode,
       Boeking_Boekdatum
FROM Boekingen
WHERE Bedrijfsnr = '070'
```

Deze query retourneerde daadwerkelijk gegevens van:

``` text
administratie 070
Rooise Zoom
```

Hiermee is praktisch bewezen:

1.  de ODBC-verbinding kan echte Informant-data lezen;
2.  gewone `SELECT`-queries werken;
3.  een beperkte kolomselectie werkt;
4.  `WHERE`-filtering werkt;
5.  filtering op `Bedrijfsnr` kan bij de databron plaatsvinden.

Dit is een belangrijke verbetering ten opzichte van de huidige
Excel-route.

------------------------------------------------------------------------

## 14. Implicatie voor de querystrategie

De huidige Excel-route werkt conceptueel als:

``` text
groot gecombineerd Excelbestand
→ volledig lezen
→ valideren
→ filteren op Bedrijfsnr
→ normaliseren
→ cache
```

De ODBC-route kan veel gerichter werken:

``` text
Informant
→ SELECT alleen benodigde kolommen
→ WHERE alleen benodigde administratie/periode
→ resultaten in batches
→ normalisatie
→ cache
```

Gewenste richting, mits ondersteund door de gekozen ODBC-library:

``` sql
SELECT
    Bedrijfsnr,
    Boeking_Boekjaar,
    Boeking_Boekperiode,
    Boeking_Boekdatum,
    ...
FROM Boekingen
WHERE Bedrijfsnr = ?
  AND Boeking_Boekjaar >= ?
```

Onderzoek/implementatie moet waar mogelijk rekening houden met:

-   parameterized queries;
-   alleen benodigde kolommen selecteren;
-   filtering op administratie;
-   filtering op boekjaar/periode;
-   batching/chunking;
-   timeouts;
-   cancellation;
-   duidelijke logging;
-   gecontroleerde retries waar veilig;
-   geen volledige enorme resultsets in het 32-bit bridgeproces
    vasthouden.

------------------------------------------------------------------------

## 15. Benodigde BVC-databronnen

De huidige rapportagetool werkt met brontypen zoals:

-   Boekingen;
-   Balans;
-   RentRoll;
-   Contracten;
-   Units;
-   Complex Totalen;
-   Servicekosten;
-   Ouderdomsanalyse;
-   Begroting.

De gebruiker heeft aangegeven dat de benodigde databronnen in
Informant/IDBC beschikbaar zijn.

Voor de directe koppeling hoeft dus niet eerst bewezen te worden of
Informant überhaupt de relevante informatie kan ontsluiten. De nadruk
ligt nu op:

-   mapping;
-   queryontwerp;
-   normalisatie;
-   validatie tegen de bestaande Excel-uitkomsten.

Begroting kan functioneel een afwijkende bron blijven als die niet uit
Informant komt; dit moet door de bestaande bronconfiguratie kunnen
worden ondersteund.

------------------------------------------------------------------------

## 16. Gekozen architectuurrichting: 32-bit bridge

Omdat PxPlus 64-bit uitgesloten is en de hoofd-Worker x64 moet blijven,
is de voorkeursrichting:

``` text
┌──────────────────────────────────────┐
│ BVC Worker x64                       │
│                                      │
│ normalisatie                         │
│ validatie                            │
│ cache / SQLite                       │
│ domeinlogica                         │
│ KPI-berekeningen                     │
│ rapportagelogica                     │
└─────────────────┬────────────────────┘
                  │
                  │ lokaal protocol / IPC
                  │
┌─────────────────▼────────────────────┐
│ Informant ODBC Bridge 32-bit         │
│                                      │
│ DSN openen                           │
│ parameterized SELECT uitvoeren       │
│ resultaten batchen/streamen          │
│ ODBC/PxPlus fouten vertalen          │
│ read-only afdwingen                  │
└─────────────────┬────────────────────┘
                  │
                  ▼
       PxPlus SQL ODBC Driver 32-bit
                  │
                  ▼
            Informant / IDBC
```

------------------------------------------------------------------------

## 17. Verantwoordelijkheden van de 32-bit bridge

De bridge moet **bewust dom en klein** blijven.

### Wel verantwoordelijk voor

-   verbinden met een Informant File DSN;
-   read-only ODBC-toegang;
-   uitvoeren van vooraf toegestane/geparameteriseerde `SELECT`-queries;
-   resultaten batchgewijs/streamend teruggeven;
-   type-informatie zo betrouwbaar mogelijk doorgeven;
-   timeouts;
-   cancellation;
-   ODBC/PxPlus-fouten vertalen naar een stabiel foutformaat;
-   diagnostische logging zonder gevoelige data onnodig te loggen;
-   resource cleanup;
-   verbinding correct sluiten.

### Niet verantwoordelijk voor

-   KPI-berekeningen;
-   financiële bedrijfslogica;
-   cacheopbouw;
-   SQLite-schema;
-   rapportage;
-   administratieconfiguratie buiten wat nodig is om de juiste DSN te
    kiezen;
-   Excel-logica;
-   normalisatieregels die ook voor andere bronnen gelden;
-   UI.

De bridge is dus geen tweede Worker.

------------------------------------------------------------------------

## 18. Communicatie tussen x64 Worker en 32-bit bridge

Dit moet nog definitief worden ontworpen.

Voorkeur voor de PoC: **zo eenvoudig mogelijk**.

Kansrijke opties:

### A. Child process + stdin/stdout

De x64 Worker start de 32-bit bridge als child process.

Bijvoorbeeld:

``` text
Worker
→ start bridge
→ stuurt query/request
→ bridge streamt records terug
→ Worker normaliseert en schrijft naar cache
```

Een formaat als **JSON Lines (JSONL/NDJSON)** is aantrekkelijk voor een
eerste PoC omdat:

-   het eenvoudig te inspecteren is;
-   streaming natuurlijk werkt;
-   één record per regel kan worden verwerkt;
-   geen volledige resultset in geheugen nodig is;
-   debugging eenvoudig is.

### B. Named pipes

Kan later aantrekkelijk zijn voor performance of een langdurig
bridgeproces, maar introduceert meer complexiteit.

### C. Lokale HTTP-service

Waarschijnlijk onnodig zwaar voor de eerste implementatie en brengt
extra lifecycle/security/deployment-vraagstukken mee.

### Voorlopige voorkeur

Voor de PoC:

``` text
x64 Worker
→ child process
→ 32-bit CLI bridge
→ stdout als streaming protocol
```

Claude moet dit toetsen aan de bestaande repository en Windows
deployment-eisen voordat implementatie begint.

------------------------------------------------------------------------

## 19. 32-bit geheugenlimiet beheersen

De bridge mag niet:

``` text
SELECT enorme dataset
→ alles in RAM verzamelen
→ één gigantische JSON-array teruggeven
```

Gewenst:

``` text
ODBC cursor/resultset
→ record/batch lezen
→ direct doorgeven
→ geheugen vrijgeven
→ volgende batch
```

Bijvoorbeeld batches van een configureerbare omvang.

De zware verwerking blijft in de x64 Worker.

Hierdoor is de 32-bit beperking veel minder relevant dan wanneer de
volledige Worker 32-bit zou worden.

------------------------------------------------------------------------

## 20. Read-only is een harde eis

De koppeling is uitsluitend bedoeld voor rapportage.

De ODBC-laag moet daarom defense-in-depth read-only worden ontworpen.

Minimaal onderzoeken/toepassen:

1.  PxPlus/ODBC read-only configuratie waar beschikbaar;
2.  bridge-API biedt uitsluitend leesoperaties;
3.  geen generieke "voer willekeurige SQL uit"-productie-interface;
4.  alleen vooraf gedefinieerde querytypen of strikt gevalideerde
    SELECTs;
5.  parameterized queries;
6.  geen `INSERT`;
7.  geen `UPDATE`;
8.  geen `DELETE`;
9.  geen DDL;
10. geen stored procedures/write calls indien van toepassing.

De x64 Worker hoort überhaupt geen Informant-write-methodes aangeboden
te krijgen.

------------------------------------------------------------------------

## 21. Excel blijft voorlopig de referentie

De bestaande Excel-route mag niet verdwijnen zodra ODBC wordt
toegevoegd.

Tijdens de overgang moet mogelijk zijn:

``` text
ExcelSource ───────────┐
                      ├→ dezelfde normalisatie → vergelijking
InformantOdbcSource ──┘
```

Per administratie/brontype moeten minimaal kunnen worden vergeleken:

-   recordaantallen;
-   unieke sleutels;
-   boekjaren;
-   perioden;
-   financiële totalen;
-   debet;
-   credit;
-   saldo;
-   ontbrekende records;
-   extra records;
-   afwijkende waarden.

Doel:

> aantoonbaar bewijzen dat de ODBC-route functioneel dezelfde dataset
> oplevert als de huidige bewezen Excel-route voordat Excel voor een
> bepaald brontype wordt uitgefaseerd.

------------------------------------------------------------------------

## 22. Eén DSN per administratie versus `alle bedrijven`

Nog open.

### Bewezen

Een administratie-DSN zoals 070 werkt en geeft data van Rooise Zoom
terug.

### Niet bewezen

Dat:

``` text
informant alle bedrijven.dsn
```

via context `000` alle benodigde transactiedata voor alle administraties
bevat.

### Veilige eerste implementatie

De bridge/Worker moet daarom probleemloos een mapping kunnen
ondersteunen zoals:

``` text
002 → informant 002 fergagne bv.dsn
070 → informant 070 rooise zoom.dsn
...
```

Dit is functioneel prima en biedt mogelijk zelfs extra
administratiescheiding.

Later kan `alle bedrijven` apart worden onderzocht als optimalisatie.

De architectuur mag niet afhankelijk worden van context `000`.

------------------------------------------------------------------------

## 23. Bestaande administratie-identificatie in BVC

Binnen de huidige BVC-tool is onderscheid belangrijk tussen:

-   `administratieId`, bijvoorbeeld `070_Rooise_Zoom`;
-   `Bedrijfsnr`, bijvoorbeeld `070`.

`Bedrijfsnr` is de inhoudelijke administratiecode waarmee gegevens
kunnen worden gefilterd.

De ODBC-configuratie moet deze bestaande scheiding respecteren.

Voorbeeldconcept:

``` text
administratieId: 070_Rooise_Zoom
bedrijfsnr:      070
source:
  type: informant-odbc
  dsn: informant 070 rooise zoom.dsn
```

De exacte configuratiestructuur moet Claude bepalen op basis van de
actuele repository.

------------------------------------------------------------------------

## 24. Wat expliciet NIET moet gebeuren

Claude moet zonder nieuwe expliciete beslissing **niet**:

-   de hoofd-Worker naar 32-bit ombouwen;
-   PxPlus 64-bit als oplossing ontwerpen;
-   de bestaande Excel-route verwijderen;
-   KPI-logica naar de bridge verplaatsen;
-   cachelogica naar de bridge verplaatsen;
-   de bridge rechtstreeks rapportages laten produceren;
-   willekeurige write-SQL toestaan;
-   bestaande Informant DSN-bestanden wijzigen;
-   aannemen dat `000` alle bedrijven ontsluit;
-   alle records eerst in bridgegeheugen verzamelen;
-   de huidige productie-Worker direct afhankelijk maken van ODBC
    voordat een PoC is gevalideerd;
-   bestaande Informant-bestanden rechtstreeks parsen als de ODBC-laag
    de data correct ontsluit.

------------------------------------------------------------------------

## 25. Aanbevolen gefaseerd vervolg

### Fase 1 --- repositoryanalyse

Claude inspecteert de actuele repository en beschrijft:

-   waar de huidige `ExcelSource`/broninleeslogica zit;
-   waar normalisatie begint;
-   waar validatie plaatsvindt;
-   waar administratie-filtering zit;
-   waar cacheopbouw begint;
-   welke bestaande interfaces herbruikbaar zijn.

Nog geen grote refactor.

### Fase 2 --- bridge PoC

Maak een minimale **32-bit** executable die:

1.  één File DSN kan openen;
2.  uitsluitend read-only werkt;
3.  een vaste testquery tegen `Boekingen` uitvoert;
4.  bijvoorbeeld administratie 070 leest;
5.  resultaten streamend naar stdout schrijft;
6.  duidelijke errors/logging geeft.

Eerste bewezen query kan inhoudelijk aansluiten op:

``` sql
SELECT Bedrijfsnr,
       Bedrijfsnaam,
       Boeking_Boekjaar,
       Boeking_Boekperiode,
       Boeking_Boekdatum
FROM Boekingen
WHERE Bedrijfsnr = '070'
```

### Fase 3 --- x64 Worker ↔ bridge

Laat de bestaande x64 Worker de 32-bit bridge als child process starten.

Test:

-   lifecycle;
-   exit codes;
-   stderr logging;
-   stdout protocol;
-   cancellation;
-   crash van bridge;
-   timeout;
-   grote resultsets;
-   geheugen.

### Fase 4 --- `InformantOdbcSource`

Voeg pas daarna een echte bronadapter toe die de bridge gebruikt en
dezelfde genormaliseerde datastructuren oplevert als de Excel-route.

### Fase 5 --- parallelle validatie

Voor één administratie, bij voorkeur 070 Rooise Zoom:

``` text
ExcelSource(070)
vs.
InformantOdbcSource(070)
```

Vergelijk boekingen inhoudelijk.

Daarna één voor één andere brontypen toevoegen.

### Fase 6 --- bredere uitrol

Pas wanneer resultaten aantoonbaar overeenkomen:

-   meer administraties;
-   meer brontypen;
-   performanceoptimalisatie;
-   eventueel onderzoek naar `alle bedrijven`;
-   operationele deployment.

------------------------------------------------------------------------

## 26. Belangrijkste reeds bewezen conclusie

De belangrijkste uitkomst van het onderzoek is:

> Een directe read-only koppeling met Informant is technisch haalbaar
> via de bestaande PxPlus SQL ODBC 32-bit infrastructuur.

Dit is praktisch bewezen met administratie 070 / Rooise Zoom.

We hebben succesvol:

``` text
Informant
→ File DSN 070
→ PxPlus SQL ODBC 32-bit
→ Microsoft Query
→ SQL SELECT
→ echte Rooise Zoom-data
```

uitgevoerd.

Het openstaande probleem is daarom niet meer **of Informant-data
bereikbaar is**, maar hoe de bestaande x64 BVC Worker daar op een
onderhoudbare en veilige manier gebruik van maakt.

Omdat PxPlus 64-bit geen optie is, is de gekozen oplossingsrichting een
**kleine 32-bit ODBC bridge naast de x64 Worker**.

------------------------------------------------------------------------

## 27. Opdracht aan Claude voor het vervolg

Gebruik dit document als vastgestelde onderzoekscontext.

### Eerst doen

1.  Inspecteer de actuele repository.
2.  Bevestig waar de juiste bronadaptergrens ligt.
3.  Ontwerp de minimale 32-bit bridge.
4.  Bepaal welk Windows/ODBC-technologiepakket geschikt is om
    daadwerkelijk een **32-bit executable** te produceren.
5.  Ontwerp een eenvoudig streaming protocol tussen bridge en Worker.
6.  Ontwerp read-only afdwinging.
7.  Beschrijf teststrategie en foutafhandeling.
8.  Beschrijf hoe Excel en ODBC parallel kunnen worden gevalideerd.

### Nog niet doen

Voer nog geen brede productie-implementatie of refactor uit voordat
bovenstaande ontwerpkeuzes zijn beoordeeld.

### Bij iedere technische keuze expliciet beantwoorden

-   Waarom deze keuze?
-   Welke alternatieven zijn overwogen?
-   Hoe blijft de bridge 32-bit terwijl de Worker x64 blijft?
-   Hoe wordt voorkomen dat de 32-bit bridge veel geheugen gebruikt?
-   Hoe wordt read-only technisch afgedwongen?
-   Hoe worden ODBC/PxPlus-fouten zichtbaar in de Worker?
-   Hoe wordt voorkomen dat Informant-specifieke logica naar
    KPI/cache/domein lekt?
-   Hoe testen we dezelfde administratie via Excel en ODBC tegen elkaar?

------------------------------------------------------------------------

## 28. Samenvatting in één schema

``` text
HUIDIG

Gecombineerde Excelbronnen
        ↓
ExcelSource
        ↓
normalisatie / validatie
        ↓
BVC Worker x64
        ↓
SQLite cache
        ↓
KPI / rapportage


DOELSITUATIE

                         ┌── ExcelSource ───────────────┐
                         │                             │
Informant                │                             ↓
   ↓                     │                       normalisatie
File DSN per adm.        │                             ↓
   ↓                     │                         validatie
PxPlus ODBC 32-bit       │                             ↓
   ↓                     │                       BVC Worker x64
32-bit ODBC bridge ──────┘                             ↓
                                                   SQLite cache
                                                       ↓
                                                  KPI / rapportage
```

**Kernregel:** Informant/PxPlus/ODBC eindigt bij de bronadaptergrens. De
rest van BVC blijft databron-onafhankelijk.
