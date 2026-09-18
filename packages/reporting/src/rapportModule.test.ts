import { describe, expect, it } from "vitest";
import { renderSamengesteldRapportHtml, type SamengesteldRapport, type SamengesteldRapportContext } from "./rapportModule.js";

/**
 * DELTA BUILD (2026-09-18) — bewijst uitsluitend het NIEUWE risico van de
 * generieke samengestelde renderer: correcte statusafhandeling en een
 * document zonder dubbele skelet-/coverstructuur. Geen enkele echte
 * module (Pure P&L/Balans/Huurdersoverzicht) wordt hier aangeroepen —
 * uitsluitend synthetische sectie-html's.
 */

const CONTEXT: SamengesteldRapportContext = {
  administratieNaam: "Test BV",
  bedrijfsnr: "999",
  gegenereerdOp: new Date("2026-09-18T10:00:00.000Z"),
  omschrijving: "Boekjaar 2026, periode 01 t/m 06",
};

describe("renderSamengesteldRapportHtml", () => {
  it("plaatst OPGENOMEN-secties ongewijzigd in het document, in de meegegeven volgorde", () => {
    const rapport: SamengesteldRapport = {
      context: CONTEXT,
      secties: [
        { id: "PNL", naam: "Winst- en verliesrekening", resultaat: { status: "OPGENOMEN", html: "<div id='pnl-marker'>PNL-INHOUD</div>" } },
        { id: "BALANS", naam: "Balans", resultaat: { status: "OPGENOMEN", html: "<div id='balans-marker'>BALANS-INHOUD</div>" } },
      ],
    };
    const html = renderSamengesteldRapportHtml(rapport);

    expect(html).toContain("PNL-INHOUD");
    expect(html).toContain("BALANS-INHOUD");
    expect(html.indexOf("PNL-INHOUD")).toBeLessThan(html.indexOf("BALANS-INHOUD"));
    // Eén document, geen dubbel skelet.
    expect((html.match(/<html/g) ?? []).length).toBe(1);
    expect((html.match(/class="cover"/g) ?? []).length).toBe(1);
  });

  it("toont NIET_GESELECTEERD-secties helemaal niet (geen lege sectie, geen kop)", () => {
    const rapport: SamengesteldRapport = {
      context: CONTEXT,
      secties: [
        { id: "PNL", naam: "Winst- en verliesrekening", resultaat: { status: "OPGENOMEN", html: "<div>PNL-INHOUD</div>" } },
        { id: "HUURDERS", naam: "Huurdersoverzicht", resultaat: { status: "NIET_GESELECTEERD" } },
      ],
    };
    const html = renderSamengesteldRapportHtml(rapport);

    expect(html).toContain("PNL-INHOUD");
    expect(html).not.toContain("Huurdersoverzicht");
  });

  it("toont ONBESCHIKBAAR met de exacte reden, nooit als €0 of lege sectie, en blokkeert andere secties niet", () => {
    const rapport: SamengesteldRapport = {
      context: CONTEXT,
      secties: [
        { id: "PNL", naam: "Winst- en verliesrekening", resultaat: { status: "OPGENOMEN", html: "<div>PNL-INHOUD</div>" } },
        { id: "BALANS", naam: "Balans", resultaat: { status: "ONBESCHIKBAAR", reden: "boekperiodeTotEnMet ontbreekt" } },
      ],
    };
    const html = renderSamengesteldRapportHtml(rapport);

    expect(html).toContain("PNL-INHOUD");
    expect(html).toContain("Balans");
    expect(html).toContain("Onbeschikbaar");
    expect(html).toContain("boekperiodeTotEnMet ontbreekt");
    expect(html).not.toContain("€ 0,00");
  });

  it("toont FOUT apart van ONBESCHIKBAAR, met de technische foutmelding zichtbaar", () => {
    const rapport: SamengesteldRapport = {
      context: CONTEXT,
      secties: [{ id: "HUURDERS", naam: "Huurdersoverzicht", resultaat: { status: "FOUT", foutmelding: "Cache niet gevonden" } }],
    };
    const html = renderSamengesteldRapportHtml(rapport);

    expect(html).toContain("Genereren mislukt");
    expect(html).toContain("Cache niet gevonden");
  });

  it("toont ONVOLLEDIG mét de sectie-html én een zichtbare waarschuwing, onderscheiden van OPGENOMEN", () => {
    const rapport: SamengesteldRapport = {
      context: CONTEXT,
      secties: [{ id: "PNL", naam: "Winst- en verliesrekening", resultaat: { status: "ONVOLLEDIG", html: "<div>PNL-INHOUD</div>", toelichting: "1 boeking niet gemapt" } }],
    };
    const html = renderSamengesteldRapportHtml(rapport);

    expect(html).toContain("PNL-INHOUD");
    expect(html).toContain("Onvolledig");
    expect(html).toContain("1 boeking niet gemapt");
  });
});
