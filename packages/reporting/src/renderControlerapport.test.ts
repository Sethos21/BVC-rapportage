import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { renderControlerapportHtml } from "./renderControlerapport.js";
import type { ControlerapportInvoer } from "./types.js";

const basisInvoer: ControlerapportInvoer = {
  administratieNaam: "Rooise Zoom",
  bedrijfsnr: "070",
  gegenereerdOp: new Date("2026-08-13T12:00:00Z"),
  boekingen: [{ grootboeknr: "1010", bedragDebet: new Decimal("1665.54"), bedragCredit: new Decimal("0") }],
  balansstanden: [{ grootboekrekeningnr: "1300", omschrijving: "Bank", eindsaldo: new Decimal("-1487022.79") }],
  servicekosten: [{ kostensoort: "0014", omschrijving: "Onderhoud", bedragDebet: new Decimal("67.5"), bedragCredit: new Decimal("0") }],
  contracten: [{ contract: "C1", complexnummer: "01", unitnummer: "001", huurdernummer: "H1" }],
  units: [{ complexnummer: "01", unitnummer: "001", omschrijving: "Bedrijfsruimte A", vvo: new Decimal("120.5") }],
  rentroll: [{ contractnummer: "C1", complexnummer: "01", prolongatieBedragJaar: new Decimal("19986.48"), gehuurdOppervlak: new Decimal("120.5") }],
  complexTotalen: [{ complexnr: "01", totaalOppervlakte: new Decimal("120.5"), totaalVerhuurd: new Decimal("120.5"), totaalLeegstand: new Decimal("0") }],
  ouderdomsanalyseGeladen: true,
  begrotingGeladen: false,
};

describe("renderControlerapportHtml", () => {
  const html = renderControlerapportHtml(basisInvoer);

  it("bevat de coverpage met administratienaam en Bedrijfsnr", () => {
    expect(html).toContain("Rooise Zoom");
    expect(html).toContain("Bedrijfsnr 070");
  });

  it("bevat alle vereiste secties", () => {
    for (const sectie of ["Grootboek-totalen", "Balans", "Servicekosten per kostensoort", "Contracten, units", "Complex-totalen"]) {
      expect(html).toContain(sectie);
    }
  });

  it("meldt duidelijk dat begroting nog niet gekoppeld is, zonder te blokkeren", () => {
    expect(html).toContain("Begroting");
    expect(html).toContain("blokkeert dit rapport niet");
  });

  it("meldt ouderdomsanalyse NIET als ontbrekend wanneer die wel geladen is", () => {
    expect(html).not.toContain("Ouderdomsanalyse: nog niet geladen");
  });

  it("toont de melding voor ouderdomsanalyse wanneer die niet geladen is", () => {
    const zonderOuderdomsanalyse = renderControlerapportHtml({ ...basisInvoer, ouderdomsanalyseGeladen: false });
    expect(zonderOuderdomsanalyse).toContain("Ouderdomsanalyse: nog niet geladen");
  });

  it("toont een duidelijke melding bij lege bronnen i.p.v. een lege tabel te suggereren", () => {
    const leeg = renderControlerapportHtml({ ...basisInvoer, boekingen: [] });
    expect(leeg).toContain("Geen boekingen in de cache");
  });

  it("escaped HTML-gevoelige tekens", () => {
    const kwaadaardig = renderControlerapportHtml({ ...basisInvoer, administratieNaam: "<script>alert(1)</script>" });
    expect(kwaadaardig).not.toContain("<script>alert(1)</script>");
    expect(kwaadaardig).toContain("&lt;script&gt;");
  });

  it("is geldige, gesloten HTML", () => {
    expect(html.trim().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });
});
