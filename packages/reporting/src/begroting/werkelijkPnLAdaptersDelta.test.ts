import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenWerkelijkOnderhoud, type WerkelijkOnderhoudBoekingRegel } from "./werkelijkOnderhoud.js";
import { onderhoudWerkelijkNaarPnLBovenEbitdaRegels } from "./onderhoudWerkelijkPnLAdapter.js";
import { berekenWerkelijkVerzekeringen, type WerkelijkVerzekeringBoekingRegel } from "./begroteVerzekeringen.js";
import { verzekeringWerkelijkNaarPnLBovenEbitdaRegels } from "./verzekeringWerkelijkPnLAdapter.js";
import { berekenWerkelijkGemeentelijkeLasten, type WerkelijkGemeentelijkeLastenBoekingRegel } from "./begroteGemeentelijkeLasten.js";
import { gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels } from "./gemeentelijkeLastenWerkelijkPnLAdapter.js";
import type { PnLDekkingReden } from "../pnlEngine.js";

/**
 * DELTA BUILD (2026-09-17) — bewijst de drie nieuwe productie-Werkelijk-P&L-
 * adapters (Onderhoud/Verzekeringen/Gemeentelijke Lasten) die GAT-013's
 * eerdere test-lokale bewijs-adapters vervangen. Geen herbewijs van reeds
 * bewezen mapping-/Pure-P&L-invariants — uitsluitend: (1) dezelfde
 * economische bijdrage als de bestaande Werkelijk-uitkomst, (2) completeness
 * behouden.
 */

describe("onderhoudWerkelijkNaarPnLBovenEbitdaRegels", () => {
  it("1. geeft exact dezelfde economische bijdrage als het Werkelijk-resultaat, boven EBITDA in EXPLOITATIE_LASTEN, als KOSTEN", () => {
    const werkelijk = berekenWerkelijkOnderhoud([
      { economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: null, saldo: new Decimal(320.05) } satisfies WerkelijkOnderhoudBoekingRegel,
      { economischeCategorie: "ONDERHOUD_TERREIN", complexnummer: null, saldo: new Decimal(2985.5) },
      { economischeCategorie: "ONDERHOUD_INSTALLATIES", complexnummer: null, saldo: new Decimal(628.09) },
    ]);
    const regels = onderhoudWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);

    expect(regels).toHaveLength(3);
    expect(regels.every((r) => r.boomPositie === "BOVEN_EBITDA" && r.groep === "EXPLOITATIE_LASTEN" && r.contributieAard === "KOSTEN")).toBe(true);
    for (const categorie of werkelijk.perCategorie) {
      const regel = regels.find((r) => r.regelSleutel === categorie.categorie)!;
      expect(regel.waarde).toEqual({ status: "BEKEND", bedrag: categorie.categorieTotaal });
    }
  });

  it("2. completeness: nietGeclassificeerdTotaal != 0 -> vierde ONBEKEND/NIET_GEMAPT-regel; brondekkingBevestigd=false houdt alles ONBEKEND", () => {
    const werkelijk = berekenWerkelijkOnderhoud([
      { economischeCategorie: "ONDERHOUD_GEBOUWEN", complexnummer: null, saldo: new Decimal(100) },
      { economischeCategorie: null, complexnummer: null, saldo: new Decimal(50) },
    ]);
    const regels = onderhoudWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);
    const nietGemapt = regels.find((r) => r.regelSleutel === "ONDERHOUD_NIET_GECLASSIFICEERD")!;
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");

    const zonderDekking = onderhoudWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, false);
    expect(zonderDekking.every((r) => r.waarde.status === "ONBEKEND")).toBe(true);
  });
});

describe("verzekeringWerkelijkNaarPnLBovenEbitdaRegels", () => {
  it("1. geeft exact dezelfde economische bijdrage als het Werkelijk-resultaat, boven EBITDA in EXPLOITATIE_LASTEN, als KOSTEN", () => {
    const werkelijk = berekenWerkelijkVerzekeringen([{ economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: null, saldo: new Decimal(5180.75) } satisfies WerkelijkVerzekeringBoekingRegel]);
    const [regel] = verzekeringWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);

    expect(regel!.boomPositie).toBe("BOVEN_EBITDA");
    expect(regel!.groep).toBe("EXPLOITATIE_LASTEN");
    expect(regel!.contributieAard).toBe("KOSTEN");
    expect(regel!.waarde).toEqual({ status: "BEKEND", bedrag: werkelijk.perCategorie[0]!.categorieTotaal });
  });

  it("2. completeness: nietGeclassificeerdTotaal != 0 -> tweede ONBEKEND/NIET_GEMAPT-regel; brondekkingBevestigd=false houdt alles ONBEKEND", () => {
    const werkelijk = berekenWerkelijkVerzekeringen([
      { economischeCategorie: "BRAND_OPSTALVERZEKERING", complexnummer: null, saldo: new Decimal(100) },
      { economischeCategorie: null, complexnummer: null, saldo: new Decimal(50) },
    ]);
    const regels = verzekeringWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);
    const nietGemapt = regels.find((r) => r.regelSleutel === "VERZEKERINGEN_NIET_GECLASSIFICEERD")!;
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");

    const zonderDekking = verzekeringWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, false);
    expect(zonderDekking.every((r) => r.waarde.status === "ONBEKEND")).toBe(true);
  });
});

describe("gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels", () => {
  it("1. geeft exact dezelfde economische bijdrage als het Werkelijk-resultaat, boven EBITDA in EXPLOITATIE_LASTEN, als KOSTEN", () => {
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([{ economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: null, saldo: new Decimal(14346.9) } satisfies WerkelijkGemeentelijkeLastenBoekingRegel]);
    const [regel] = gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);

    expect(regel!.boomPositie).toBe("BOVEN_EBITDA");
    expect(regel!.groep).toBe("EXPLOITATIE_LASTEN");
    expect(regel!.contributieAard).toBe("KOSTEN");
    expect(regel!.waarde).toEqual({ status: "BEKEND", bedrag: werkelijk.perCategorie[0]!.categorieTotaal });
  });

  it("2. completeness: nietGeclassificeerdTotaal != 0 -> tweede ONBEKEND/NIET_GEMAPT-regel; brondekkingBevestigd=false houdt alles ONBEKEND", () => {
    const werkelijk = berekenWerkelijkGemeentelijkeLasten([
      { economischeCategorie: "GEMEENTELIJKE_LASTEN", complexnummer: null, saldo: new Decimal(100) },
      { economischeCategorie: null, complexnummer: null, saldo: new Decimal(50) },
    ]);
    const regels = gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, true);
    const nietGemapt = regels.find((r) => r.regelSleutel === "GEMEENTELIJKE_LASTEN_NIET_GECLASSIFICEERD")!;
    expect((nietGemapt.waarde as { status: "ONBEKEND"; dekkingReden: PnLDekkingReden }).dekkingReden).toBe("NIET_GEMAPT");

    const zonderDekking = gemeentelijkeLastenWerkelijkNaarPnLBovenEbitdaRegels(werkelijk, false);
    expect(zonderDekking.every((r) => r.waarde.status === "ONBEKEND")).toBe(true);
  });
});
