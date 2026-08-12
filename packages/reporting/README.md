# @bvc/reporting

## P&L-exploitatierapportage (eerste rapportonderdeel)

`renderPLRapportHtml` rendert een exploitatierapport per vastgoedobject in
BVC-huisstijl: coverpage, samenvatting, inkomsten, kosten, netto
exploitatieresultaat, een eenvoudige staafdiagram (inline SVG, geen
externe grafiekbibliotheek) en toelichting. Alle berekeningen staan in
`plRapport.ts` (hergebruikt `@bvc/domain`); `renderHtml.ts` rekent zelf
niets uit, alleen formatteren (`financieleberekeningen.md`: "geen
berekeningen in de UI-laag").

Testcase: object 070 "Rooise Zoom" (zie `*.test.ts`).

Nog niet gebouwd: PDF/DOCX-export (alleen HTML nu), en het bredere
rapportmodel uit het grote dossier (`def_rapportregel`/`def_kpi` uit
`04_Rapporten/`), dat voortbouwt op een **goedgekeurde** grootboekmapping
die er nog niet is (zie root-README). Dit P&L-rapport werkt met al
gevalideerde jaarcijfers als invoer, niet rechtstreeks met ruwe
Boekingen-rijen — die koppeling volgt in een latere fase.
