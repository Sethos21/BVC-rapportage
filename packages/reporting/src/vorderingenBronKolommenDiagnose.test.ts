import { describe, expect, it } from "vitest";
import { inventariseerVorderingenBronKolommen } from "./vorderingenBronKolommenDiagnose.js";

/**
 * DELTA BUILD (2026-09-18) — diagnose-infrastructuur voor de BRONGATE
 * "Historische Ouderdomsanalyse". Test uitsluitend de NIEUWE, puur
 * observationele toevoegingen (`waargenomenFormaat`/`aandachtKolommen`) —
 * de onderliggende kolommen-inventarisatie zelf is al bewezen via
 * `servicekostenBronKolommenDiagnose.test.ts` (ongewijzigd hergebruikt).
 */

describe("inventariseerVorderingenBronKolommen", () => {
  it("herkent een datumachtig patroon puur op basis van de voorbeeldwaarden, zonder de kolom te interpreteren", () => {
    const resultaat = inventariseerVorderingenBronKolommen(
      [
        { Datum_Vordering: "01-09-2026", Vordering_afgehandeld_datum: "15-09-2026" },
        { Datum_Vordering: "01-08-2026", Vordering_afgehandeld_datum: null },
      ],
      ["Datum_Vordering"],
    );

    const datumVordering = resultaat.kolommen.find((k) => k.kolom === "Datum_Vordering")!;
    expect(datumVordering.waargenomenFormaat).toBe("datum (dd-mm-jjjj)");
    expect(datumVordering.reedsGemodelleerd).toBe(true);

    const afgehandeldDatum = resultaat.kolommen.find((k) => k.kolom === "Vordering_afgehandeld_datum")!;
    expect(afgehandeldDatum.waargenomenFormaat).toBe("datum (dd-mm-jjjj)");
    expect(afgehandeldDatum.reedsGemodelleerd).toBe(false); // niet in VorderingMetAfboekingBronSchema
  });

  it("herkent numeriek en tekst correct, en 'leeg' bij uitsluitend lege waarden", () => {
    const resultaat = inventariseerVorderingenBronKolommen(
      [
        { Bedrag_component: "123.45", Omschrijving: "Periode september 2026", Nooit_gevuld: null },
        { Bedrag_component: "-10", Omschrijving: "Service-afrekening", Nooit_gevuld: "" },
      ],
      [],
    );

    expect(resultaat.kolommen.find((k) => k.kolom === "Bedrag_component")!.waargenomenFormaat).toBe("numeriek");
    expect(resultaat.kolommen.find((k) => k.kolom === "Omschrijving")!.waargenomenFormaat).toBe("tekst");
    expect(resultaat.kolommen.find((k) => k.kolom === "Nooit_gevuld")!.waargenomenFormaat).toBe("leeg");
  });

  it("markeert aandachtkolommen puur op naam (case-ongevoelig), zonder de rest te classificeren", () => {
    const resultaat = inventariseerVorderingenBronKolommen(
      [{ VS_01_Bedrag: "100", VS_20_Afgeboekt: "50", Vervaldatum_Kandidaat: "01-09-2026", Contractnr: "C1", Iets_Anders: "x" }],
      [],
    );

    expect(resultaat.aandachtKolommen).toEqual(expect.arrayContaining(["VS_01_Bedrag", "VS_20_Afgeboekt", "Vervaldatum_Kandidaat"]));
    expect(resultaat.aandachtKolommen).not.toContain("Contractnr");
    expect(resultaat.aandachtKolommen).not.toContain("Iets_Anders");
  });

  it("aantalKolommen komt overeen met het aantal geïnventariseerde kolommen", () => {
    const resultaat = inventariseerVorderingenBronKolommen([{ A: "1", B: "2" }, { A: "1", C: "3" }], []);
    expect(resultaat.aantalKolommen).toBe(3);
    expect(resultaat.kolommen).toHaveLength(3);
    expect(resultaat.aantalRijen).toBe(2);
  });
});
