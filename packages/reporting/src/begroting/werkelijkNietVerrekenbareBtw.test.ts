import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenWerkelijkNietVerrekenbareBtw, type WerkelijkNietVerrekenbareBtwBoekingRegel } from "./werkelijkNietVerrekenbareBtw.js";

const D = (n: string | number) => new Decimal(n);

describe("berekenWerkelijkNietVerrekenbareBtw", () => {
  it("11. som van geclassificeerde boekingen naar de ene categorie", () => {
    const boekingen: WerkelijkNietVerrekenbareBtwBoekingRegel[] = [
      { economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(120) },
      { economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(80) },
    ];
    const r = berekenWerkelijkNietVerrekenbareBtw(boekingen);
    expect(r.moduleTotaal.toString()).toBe("200");
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("0");
  });

  it("12. niet-geclassificeerde boekingen (null) tellen nooit mee in de categorie", () => {
    const boekingen: WerkelijkNietVerrekenbareBtwBoekingRegel[] = [
      { economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(50) },
      { economischeCategorie: null, saldo: D(999) },
    ];
    const r = berekenWerkelijkNietVerrekenbareBtw(boekingen);
    expect(r.moduleTotaal.toString()).toBe("50");
    expect(r.nietGeclassificeerdTotaal.toString()).toBe("999");
    expect(r.nietGeclassificeerdAantalBoekingen).toBe(1);
  });

  it("Werkelijk exact één keer: geen dubbele telling over meerdere aanroepen", () => {
    const boekingen: WerkelijkNietVerrekenbareBtwBoekingRegel[] = [{ economischeCategorie: "NIET_VERREKENBARE_BTW", saldo: D(500) }];
    const r1 = berekenWerkelijkNietVerrekenbareBtw(boekingen);
    const r2 = berekenWerkelijkNietVerrekenbareBtw(boekingen);
    expect(r1.moduleTotaal.toString()).toBe(r2.moduleTotaal.toString());
  });
});
