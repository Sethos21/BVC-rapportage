import { describe, expect, it } from "vitest";
import { inventariseerServicekostenBronKolommen } from "./servicekostenBronKolommenDiagnose.js";

describe("inventariseerServicekostenBronKolommen", () => {
  it("vindt alle kolomnamen over alle rijen heen, ook sparse kolommen", () => {
    const resultaat = inventariseerServicekostenBronKolommen(
      [{ Bedrijfsnr: "070", Service_BK_Kostensoort: "4300" }, { Bedrijfsnr: "070", Service_BK_Grootboeknr: "1712" }],
      ["Bedrijfsnr", "Service_BK_Kostensoort"],
    );
    expect(resultaat.kolommen.map((k) => k.kolom)).toEqual(["Bedrijfsnr", "Service_BK_Grootboeknr", "Service_BK_Kostensoort"]);
  });

  it("markeert welke kolommen al gemodelleerd zijn, zonder ze te classificeren", () => {
    const resultaat = inventariseerServicekostenBronKolommen(
      [{ Bedrijfsnr: "070", Service_BK_Grootboeknr: "1712" }],
      ["Bedrijfsnr"],
    );
    const bedrijfsnr = resultaat.kolommen.find((k) => k.kolom === "Bedrijfsnr");
    const grootboek = resultaat.kolommen.find((k) => k.kolom === "Service_BK_Grootboeknr");
    expect(bedrijfsnr?.reedsGemodelleerd).toBe(true);
    expect(grootboek?.reedsGemodelleerd).toBe(false);
  });

  it("telt niet-lege waarden en verzamelt maximaal 5 distincte voorbeeldwaarden, null/lege string niet meegeteld", () => {
    const rijen = [
      { Kolom: "1711" }, { Kolom: "1712" }, { Kolom: "1711" }, { Kolom: null }, { Kolom: "" },
      { Kolom: "1600" }, { Kolom: "1700" }, { Kolom: "9600" }, { Kolom: "2000" }, { Kolom: "2001" },
    ];
    const resultaat = inventariseerServicekostenBronKolommen(rijen, []);
    const kolom = resultaat.kolommen.find((k) => k.kolom === "Kolom")!;
    expect(kolom.aantalNietLegeWaarden).toBe(8);
    expect(kolom.voorbeeldwaarden).toHaveLength(5);
    expect(kolom.voorbeeldwaarden).toEqual(["1711", "1712", "1600", "1700", "9600"]);
  });

  it("geeft aantalRijen en een lege kolommenlijst terug voor een lege bron", () => {
    const resultaat = inventariseerServicekostenBronKolommen([], []);
    expect(resultaat.aantalRijen).toBe(0);
    expect(resultaat.kolommen).toEqual([]);
  });
});
