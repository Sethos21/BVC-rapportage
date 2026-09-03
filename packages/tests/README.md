# @bvc/tests

Integratie-/pre-flight-tests voor `apps/worker`, tegen de echte publieke API
(`init-administratie`/`status`/`rebuild-cache`), niet tegen mocks. Draait
zonder externe database — elke test bouwt zijn eigen tijdelijke data root
(`mkdtempSync`) met echte `.xlsx`-fixtures (`src/fixtures.ts`), en ruimt
zichzelf op.

`src/worker-preflight.test.ts` dekt:
1. Volledig pad init-administratie → status → rebuild-cache, gedeeld-
   bronmodus met meerdere administraties in dezelfde bronbestanden.
2. Bedrijfsnr-isolatie over alle acht brontypen (niet alleen boekingen).
3. Ontbrekende begroting — niet-blokkerend, expliciet gemeld.
4. Ontbrekende/lege/foutieve bronbestanden, incl. een echt afgebroken
   (getrunceerd) xlsx-bestand — en een expliciet gedocumenteerd bekend
   risico (SheetJS interpreteert willekeurige niet-xlsx-tekst soms
   stilzwijgend als 0 rijen i.p.v. een foutmelding te geven).
5. Nederlandse/echte-notaties: komma-decimaal, negatieve bedragen, en de
   `#REF!`-foutwaarde die bevestigd in de echte Boekingen-export voorkomt.
6. (zie ook de handmatige benchmark in de PR-geschiedenis — geheugen/tijd
   bij een 320 MB/168-kolommen stresstest.)
7. SQLite-cache-inhoud inhoudelijk herleidbaar naar de brondata.
8. Atomiciteit: een fout halverwege een rebuild raakt een bestaande goede
   cache niet, en laat geen tijdelijke bestanden achter.
9. Idempotentie: identieke rebuild geeft identieke rijinhoud.

Fixture-kolomkoppen zijn gebaseerd op de daadwerkelijke IDBC-bronbestanden
(geverifieerd via broninspectie in Google Drive — zie root-README), niet
verzonnen. Waar bewust afgeweken wordt van een letterlijke 1-op-1 kopie
(bv. minder kolommen dan de echte 168 in Boekingen) staat dat in de fixture
toegelicht.
