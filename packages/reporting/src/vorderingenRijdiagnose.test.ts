import { describe, expect, it } from "vitest";
import { selecteerVorderingenRijdiagnose, type VorderingRijDiagnoseRegel } from "./vorderingenRijdiagnose.js";

function regel(overrides: Partial<VorderingRijDiagnoseRegel>): VorderingRijDiagnoseRegel {
  return {
    bedrijfsnr: "070",
    huurdernr: "00000001",
    contractnr: "0000000001",
    complexnummer: "001",
    unitnummer: "0001",
    factuurnummer: "0700000001",
    datumVordering: "01-01-2026",
    vorderingBoekjaar: "2026",
    vorderingBoekperiode: "01",
    omschrijvingVordering: "Prolongatie januari 2026",
    vorderingTotaalbedrag: "1000",
    bedragAfgeboekt: "0",
    vorderingOpenstaand: "1000",
    vorderingAfgehandeldDatum: null,
    vorderingAfgehandeldJaar: null,
    vorderingAfgehandeldPeriode: null,
    afgebBedragVs: {},
    vorderingBedragVs: {},
    aantalNietNulAfgebVsVelden: 0,
    aantalNietNulVorderingVsVelden: 0,
    rekenverschilHuidigeStand: "0",
    ...overrides,
  };
}

describe("selecteerVorderingenRijdiagnose", () => {
  it("houdt het rijverband intact — alle velden van een geselecteerde kandidaat komen uit dezelfde bronrij", () => {
    const r = regel({ factuurnummer: "0700000042", bedragAfgeboekt: "0", vorderingTotaalbedrag: "1234.56", huurdernr: "00000099" });
    const resultaat = selecteerVorderingenRijdiagnose([r]);
    expect(resultaat.groepen.volledigOpenKandidaten).toEqual([r]);
    expect(resultaat.groepen.volledigOpenKandidaten[0]?.factuurnummer).toBe("0700000042");
    expect(resultaat.groepen.volledigOpenKandidaten[0]?.vorderingTotaalbedrag).toBe("1234.56");
    expect(resultaat.groepen.volledigOpenKandidaten[0]?.huurdernr).toBe("00000099");
  });

  it("groep A: volledig open (Bedrag_afgeboekt = 0), groep B en C sluiten deze rij uit", () => {
    const open = regel({ factuurnummer: "A", bedragAfgeboekt: "0", vorderingOpenstaand: "500" });
    const resultaat = selecteerVorderingenRijdiagnose([open]);
    expect(resultaat.groepen.volledigOpenKandidaten).toHaveLength(1);
    expect(resultaat.groepen.volledigAfgehandeldKandidaten).toHaveLength(0);
    expect(resultaat.groepen.gedeeltelijkAfgeboektKandidaten).toHaveLength(0);
  });

  it("groep B: volledig afgehandeld (Vordering_openstaand = 0), zet rijen MET afgehandeld_datum vooraan", () => {
    const zonderDatum = regel({ factuurnummer: "ZonderDatum", vorderingOpenstaand: "0", bedragAfgeboekt: "1000", vorderingAfgehandeldDatum: null });
    const metDatum = regel({ factuurnummer: "MetDatum", vorderingOpenstaand: "0", bedragAfgeboekt: "1000", vorderingAfgehandeldDatum: "15-03-2026" });
    const resultaat = selecteerVorderingenRijdiagnose([zonderDatum, metDatum], { maxVolledigAfgehandeld: 5 });
    expect(resultaat.groepen.volledigAfgehandeldKandidaten.map((r) => r.factuurnummer)).toEqual(["MetDatum", "ZonderDatum"]);
  });

  it("groep C: gedeeltelijk afgeboekt — 0 < |afgeboekt| < |totaal| EN openstaand != 0", () => {
    const gedeeltelijk = regel({ factuurnummer: "Deel", vorderingTotaalbedrag: "1000", bedragAfgeboekt: "400", vorderingOpenstaand: "600" });
    const volledigAfgeboektMaarOpenstaand0 = regel({ factuurnummer: "VolledigMaarSluit", vorderingTotaalbedrag: "1000", bedragAfgeboekt: "1000", vorderingOpenstaand: "0" });
    const negatieveBedragen = regel({ factuurnummer: "Negatief", vorderingTotaalbedrag: "-1000", bedragAfgeboekt: "-400", vorderingOpenstaand: "-600" });
    const resultaat = selecteerVorderingenRijdiagnose([gedeeltelijk, volledigAfgeboektMaarOpenstaand0, negatieveBedragen]);
    const namen = resultaat.groepen.gedeeltelijkAfgeboektKandidaten.map((r) => r.factuurnummer);
    expect(namen).toContain("Deel");
    expect(namen).toContain("Negatief");
    expect(namen).not.toContain("VolledigMaarSluit");
  });

  it("groep D: afgehandeld NA de peildatum (default 30-06-2026), zet 'Datum_Vordering <= peildatum' vooraan", () => {
    const naPeildatumOudeVordering = regel({ factuurnummer: "OudMaarLaatAfgehandeld", datumVordering: "01-01-2026", vorderingAfgehandeldDatum: "15-07-2026" });
    const naPeildatumNieuweVordering = regel({ factuurnummer: "NieuwEnLaatAfgehandeld", datumVordering: "15-07-2026", vorderingAfgehandeldDatum: "20-07-2026" });
    const voorPeildatum = regel({ factuurnummer: "VoorPeildatum", datumVordering: "01-01-2026", vorderingAfgehandeldDatum: "01-06-2026" });
    const resultaat = selecteerVorderingenRijdiagnose([naPeildatumNieuweVordering, voorPeildatum, naPeildatumOudeVordering]);
    expect(resultaat.groepen.afgehandeldNaPeildatumKandidaten.map((r) => r.factuurnummer)).toEqual(["OudMaarLaatAfgehandeld", "NieuwEnLaatAfgehandeld"]);
  });

  it("respecteert een aangepaste peildatum-optie", () => {
    const r = regel({ factuurnummer: "X", vorderingAfgehandeldDatum: "15-01-2025" });
    const resultaat = selecteerVorderingenRijdiagnose([r], { peildatum: new Date(2025, 0, 1) });
    expect(resultaat.groepen.afgehandeldNaPeildatumKandidaten).toHaveLength(1);
    expect(resultaat.peildatum).toBe("01-01-2025");
  });

  it("beperkt elke groep tot het opgegeven maximum", () => {
    const rijen = Array.from({ length: 8 }, (_, i) => regel({ factuurnummer: `Open${i}`, bedragAfgeboekt: "0" }));
    const resultaat = selecteerVorderingenRijdiagnose(rijen, { maxVolledigOpen: 3 });
    expect(resultaat.groepen.volledigOpenKandidaten).toHaveLength(3);
    expect(resultaat.aantalOnderzochteRijen).toBe(8);
  });
});
