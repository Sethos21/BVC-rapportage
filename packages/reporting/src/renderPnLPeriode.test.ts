import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { berekenPnLBoom, type PurePnLBronRegel } from "./pnlEngine.js";
import { renderPnLPeriodeBody } from "./renderPnLPeriode.js";
import { formatBedragHtml } from "./huisstijl.js";
import type { PnLNietMeegenomenGroep } from "./pnlPeriodeOrchestratie.js";

/**
 * DELTA BUILD (2026-09-18) — bewijst uitsluitend het NIEUWE risico van de
 * renderer: (B) toont Totaal exploitatie-opbrengsten/Totaal exploitatiekosten/
 * EBITDA exact zoals `berekenPnLBoom` ze aanlevert, zonder zelf iets te
 * herberekenen; (C) een ONBEKEND-waarde wordt nooit als €0/lege cel getoond.
 * Geen herbewijs van `berekenPnLBoom` zelf (dat is `pnlEngine.test.ts` +
 * GAT-013, ongewijzigd).
 */

const INVOER_BASIS = { administratieNaam: "Test BV", bedrijfsnr: "999", boekjaar: 2026, boekperiodeTotEnMet: "06", gegenereerdOp: new Date("2026-09-18T10:00:00.000Z") };

describe("renderPnLPeriodeBody", () => {
  it("B. toont Totaal exploitatie-opbrengsten/Totaal exploitatiekosten/EBITDA exact zoals berekenPnLBoom ze aanlevert, geen eigen herberekening", () => {
    const regels: PurePnLBronRegel[] = [
      { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: { status: "BEKEND", bedrag: new Decimal("1000.11") } },
      { regelSleutel: "BEHEERKOSTEN", boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde: { status: "BEKEND", bedrag: new Decimal("222.22") } },
    ];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);
    const html = renderPnLPeriodeBody({ ...INVOER_BASIS, resultaat, nietMeegenomen: [] });

    expect(html).toContain(formatBedragHtml(resultaat.totaalOpbrengsten.besteWetenSom));
    expect(html).toContain(formatBedragHtml(resultaat.totaalKosten.besteWetenSom));
    expect(html).toContain(formatBedragHtml(resultaat.ebitda.bedrag));
    expect(resultaat.ebitda.bedrag.toString()).toBe("777.89"); // 1000.11 - 222.22, puur ter documentatie van de fixture — GEEN nieuwe rekenregel
  });

  it("C. een ONBEKEND-regel wordt getoond als 'Onbekend' + reden, NOOIT als €0 of lege cel", () => {
    const regels: PurePnLBronRegel[] = [
      { regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: { status: "BEKEND", bedrag: new Decimal("1000") } },
      { regelSleutel: "BEHEERKOSTEN", boomPositie: "BOVEN_EBITDA", groep: "MANAGEMENT_EN_BEHEER", contributieAard: "KOSTEN", waarde: { status: "ONBEKEND", dekkingReden: "TECHNISCH_NIET_ONDERSTEUND", toelichting: "Nog geen calculator." } },
    ];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);
    const html = renderPnLPeriodeBody({ ...INVOER_BASIS, resultaat, nietMeegenomen: [] });

    expect(resultaat.totaalKosten.volledigheid.status).toBe("ONVOLLEDIG");
    expect(html).toContain("Onbekend");
    expect(html).toContain("technisch nog niet ondersteund");
    expect(html).toContain("Nog geen calculator.");
    // Totaal exploitatiekosten is ONVOLLEDIG (besteWetenSom toevallig 0, want er is geen enkele BEKENDE kostenregel) —
    // de renderer mag dit NOOIT als een kaal "€ 0,00"-totaal tonen, altijd expliciet als "Onvolledig".
    expect(html).not.toContain(`<td>${formatBedragHtml(new Decimal(0))}</td>`);
    expect(html).toContain("Onvolledig — beste weten:");
    expect(html).toContain("ONVOLLEDIG");
  });

  it("toont een lege 'Onder EBITDA'-sectie zonder zelf een regel te verzinnen wanneer de engine er geen teruggeeft", () => {
    const regels: PurePnLBronRegel[] = [{ regelSleutel: "HUUROPBRENGST_BELAST", boomPositie: "BOVEN_EBITDA", groep: "OPBRENGSTEN", contributieAard: "OPBRENGST", waarde: { status: "BEKEND", bedrag: new Decimal("100") } }];
    const resultaat = berekenPnLBoom("WERKELIJK", regels);
    const html = renderPnLPeriodeBody({ ...INVOER_BASIS, resultaat, nietMeegenomen: [] });

    expect(resultaat.onderEbitda).toHaveLength(0);
    expect(html).toContain("Onder EBITDA");
    expect(html).toContain("Geen posten.");
  });

  it("toont een 'Niet meegenomen'-sectie uitsluitend wanneer nietMeegenomen niet leeg is, zichtbaar met totaal + aantal, nooit stilzwijgend weggelaten", () => {
    const resultaat = berekenPnLBoom("WERKELIJK", []);
    const nietMeegenomen: PnLNietMeegenomenGroep[] = [{ economischeModule: "RENTE", totaal: new Decimal("500"), aantalBoekingen: 3 }];
    const htmlMet = renderPnLPeriodeBody({ ...INVOER_BASIS, resultaat, nietMeegenomen });
    const htmlZonder = renderPnLPeriodeBody({ ...INVOER_BASIS, resultaat, nietMeegenomen: [] });

    expect(htmlMet).toContain("Niet meegenomen in dit rapport");
    expect(htmlMet).toContain("Rente");
    expect(htmlMet).toContain(formatBedragHtml(new Decimal("500")));
    expect(htmlZonder).not.toContain("Niet meegenomen in dit rapport");
  });
});
