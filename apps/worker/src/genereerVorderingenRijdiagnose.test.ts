import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genereerVorderingenRijdiagnose, naarVorderingRijDiagnoseRegel } from "./genereerVorderingenRijdiagnose.js";
import { nieuweAdministratieConfig, schrijfAdministratieConfig } from "./administratie.js";
import { administratieDir, bronGedeeldDir } from "./paths.js";
import { schrijfXlsxFixture } from "./test/fixtures.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bvc-vorderingen-rijdiagnose-"));
  mkdirSync(bronGedeeldDir(root), { recursive: true });
  mkdirSync(administratieDir(root, "070_rooisezoom"), { recursive: true });
  schrijfAdministratieConfig(root, "070_rooisezoom", nieuweAdministratieConfig("070", "Rooise Zoom"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("naarVorderingRijDiagnoseRegel", () => {
  it("houdt alle velden van dezelfde rij samen, inclusief alleen de daadwerkelijk aanwezige VS-kolommen", () => {
    const regel = naarVorderingRijDiagnoseRegel({
      Bedrijfsnr: "070", Huurdernr: "00000001", Contractnr: "0000000001", Complexnummer: "001", Unitnummer: "0001",
      Factuurnummer: "0700000001", Datum_Vordering: "01-01-2026", Vordering_Boekjaar: "2026", Vordering_Boekperiode: "01",
      Omschrijving_Vordering: "Prolongatie januari 2026", Vordering_Totaalbedrag: 1000, Bedrag_afgeboekt: 400, Vordering_openstaand: 600,
      Vordering_afgehandeld_datum: null, Vordering_afgehandeld_jaar: null, Vordering_afgehandeld_periode: null,
      Afgeb_bedrag_vs1: 400, Afgeb_bedrag_vs2: 0, Vordering_bedrag_vs1: 1000,
      // Kolom die NIET aan het VS-patroon voldoet — mag niet in afgebBedragVs/vorderingBedragVs terechtkomen.
      Vordering_bedrag_btw_vs_10: 0,
    });

    expect(regel.factuurnummer).toBe("0700000001");
    expect(regel.vorderingTotaalbedrag).toBe("1000");
    expect(regel.bedragAfgeboekt).toBe("400");
    expect(regel.vorderingOpenstaand).toBe("600");
    expect(regel.afgebBedragVs).toEqual({ Afgeb_bedrag_vs1: "400", Afgeb_bedrag_vs2: "0" });
    expect(regel.vorderingBedragVs).toEqual({ Vordering_bedrag_vs1: "1000" });
    expect(regel.aantalNietNulAfgebVsVelden).toBe(1);
    expect(regel.aantalNietNulVorderingVsVelden).toBe(1);
    expect(regel.rekenverschilHuidigeStand).toBe("0");
  });
});

describe("genereerVorderingenRijdiagnose", () => {
  it("filtert op bedrijfsnr en verdeelt echte, samenhangende rijen over de vier groepen", () => {
    const pad = join(bronGedeeldDir(root), "vorderingen_met_afboekingen.xlsx");
    schrijfXlsxFixture(pad, [
      { Bedrijfsnr: "070", Huurdernr: "00000001", Contractnr: "0000000001", Complexnummer: "001", Unitnummer: "0001", Factuurnummer: "OPEN1", Datum_Vordering: "01-01-2026", Vordering_Boekjaar: "2026", Vordering_Boekperiode: "01", Omschrijving_Vordering: "x", Vordering_Totaalbedrag: 1000, Bedrag_afgeboekt: 0, Vordering_openstaand: 1000 },
      { Bedrijfsnr: "070", Huurdernr: "00000002", Contractnr: "0000000002", Complexnummer: "001", Unitnummer: "0002", Factuurnummer: "VOLLEDIGAFGEHANDELD", Datum_Vordering: "01-02-2026", Vordering_Boekjaar: "2026", Vordering_Boekperiode: "02", Omschrijving_Vordering: "x", Vordering_Totaalbedrag: 500, Bedrag_afgeboekt: 500, Vordering_openstaand: 0, Vordering_afgehandeld_datum: "15-03-2026", Vordering_afgehandeld_jaar: 2026, Vordering_afgehandeld_periode: "03" },
      { Bedrijfsnr: "070", Huurdernr: "00000003", Contractnr: "0000000003", Complexnummer: "001", Unitnummer: "0003", Factuurnummer: "DEEL", Datum_Vordering: "01-03-2026", Vordering_Boekjaar: "2026", Vordering_Boekperiode: "03", Omschrijving_Vordering: "x", Vordering_Totaalbedrag: 1000, Bedrag_afgeboekt: 400, Vordering_openstaand: 600 },
      // Andere administratie (bedrijfsnr) — moet uitgefilterd worden.
      { Bedrijfsnr: "002", Huurdernr: "00000009", Contractnr: "0000000009", Complexnummer: "001", Unitnummer: "0009", Factuurnummer: "ANDEREADMINISTRATIE", Datum_Vordering: "01-01-2026", Vordering_Boekjaar: "2026", Vordering_Boekperiode: "01", Omschrijving_Vordering: "x", Vordering_Totaalbedrag: 1000, Bedrag_afgeboekt: 0, Vordering_openstaand: 1000 },
    ]);
    const mtimeVoor = statSync(pad).mtimeMs;

    const resultaat = genereerVorderingenRijdiagnose(root, "070_rooisezoom");

    expect(resultaat.administratieId).toBe("070_rooisezoom");
    expect(resultaat.aantalOnderzochteRijen).toBe(3);
    expect(resultaat.groepen.volledigOpenKandidaten.map((r) => r.factuurnummer)).toEqual(["OPEN1"]);
    expect(resultaat.groepen.volledigAfgehandeldKandidaten.map((r) => r.factuurnummer)).toEqual(["VOLLEDIGAFGEHANDELD"]);
    expect(resultaat.groepen.gedeeltelijkAfgeboektKandidaten.map((r) => r.factuurnummer)).toEqual(["DEEL"]);
    const alleFactuurnummers = [
      ...resultaat.groepen.volledigOpenKandidaten,
      ...resultaat.groepen.volledigAfgehandeldKandidaten,
      ...resultaat.groepen.gedeeltelijkAfgeboektKandidaten,
      ...resultaat.groepen.afgehandeldNaPeildatumKandidaten,
    ].map((r) => r.factuurnummer);
    expect(alleFactuurnummers).not.toContain("ANDEREADMINISTRATIE");

    // Geen persoonsgegevens: alleen de expliciet toegestane identificatievelden zitten in het regel-object.
    const eersteRegel = resultaat.groepen.volledigOpenKandidaten[0]!;
    expect(Object.keys(eersteRegel)).not.toContain("Huurder_Naam_1");
    expect(Object.keys(eersteRegel)).not.toContain("Huurder_Email");

    // JSON-serialiseerbaar (het commando print dit rechtstreeks via JSON.stringify).
    expect(() => JSON.stringify(resultaat)).not.toThrow();

    // Alleen-lezen: het bronbestand is niet aangeraakt.
    expect(statSync(pad).mtimeMs).toBe(mtimeVoor);
  });

  it("gooit een duidelijke fout als het bronbestand ontbreekt", () => {
    expect(() => genereerVorderingenRijdiagnose(root, "070_rooisezoom")).toThrow(/niet gevonden/);
  });
});
