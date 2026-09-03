import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import { openCacheReadonly } from "@bvc/cache";
import { renderControlerapportHtml } from "@bvc/reporting";
import type { ControlerapportInvoer } from "@bvc/reporting";
import { administratieCachePad, administratieRapportenDir } from "./paths.js";
import { leesAdministratieConfig } from "./administratie.js";

const dec = (v: string | null): Decimal | null => (v === null ? null : new Decimal(v));
const decVerplicht = (v: string): Decimal => new Decimal(v);

export interface GenereerControlerapportResultaat {
  html: string;
  pad: string;
}

/**
 * Bouwt het Controlerapport (rauw brondata-overzicht, geen grootboek-
 * mapping/servicekosten-uitsluiting — zie @bvc/reporting/types.ts) uit de
 * al-herbouwde cache van één administratie, en schrijft het weg naar
 * `rapporten/`. Leest de cache read-only — draai eerst `rebuild-cache`.
 */
export function genereerControlerapport(root: string, administratieId: string): GenereerControlerapportResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const db = openCacheReadonly(administratieCachePad(root, administratieId));

  try {
    const boekingen = db.prepare("SELECT grootboeknr, bedrag_debet, bedrag_credit FROM boekingen").all() as {
      grootboeknr: string;
      bedrag_debet: string;
      bedrag_credit: string;
    }[];
    const balansstanden = db.prepare("SELECT grootboekrekeningnr, rekening_omschrijving, eindsaldo FROM balansstanden").all() as {
      grootboekrekeningnr: string;
      rekening_omschrijving: string | null;
      eindsaldo: string;
    }[];
    const servicekosten = db.prepare("SELECT kostensoort, kostensoort_omschrijving, bedrag_debet, bedrag_credit FROM servicekosten").all() as {
      kostensoort: string;
      kostensoort_omschrijving: string | null;
      bedrag_debet: string;
      bedrag_credit: string;
    }[];
    const contracten = db.prepare("SELECT contract, complexnummer, unitnummer, huurdernummer FROM contracten").all() as {
      contract: string;
      complexnummer: string | null;
      unitnummer: string | null;
      huurdernummer: string | null;
    }[];
    const units = db.prepare("SELECT complexnummer, unitnummer, unitomschrijving, unit_vvo FROM units").all() as {
      complexnummer: string;
      unitnummer: string;
      unitomschrijving: string | null;
      unit_vvo: string | null;
    }[];
    const rentroll = db.prepare("SELECT contractnummer, complexnummer, prolongatie_bedrag_jaar, gehuurd_oppervlak FROM rentroll").all() as {
      contractnummer: string;
      complexnummer: string | null;
      prolongatie_bedrag_jaar: string | null;
      gehuurd_oppervlak: string | null;
    }[];
    const complexTotalen = db.prepare("SELECT complexnr, totaal_oppervlakte, totaal_verhuurd, totaal_leegstand FROM complex_totalen").all() as {
      complexnr: string;
      totaal_oppervlakte: string | null;
      totaal_verhuurd: string | null;
      totaal_leegstand: string | null;
    }[];
    const ouderdomsanalyseAantal = (db.prepare("SELECT COUNT(*) AS aantal FROM ouderdomsanalyse").get() as { aantal: number }).aantal;

    const invoer: ControlerapportInvoer = {
      administratieNaam: config.weergavenaam,
      bedrijfsnr: config.bedrijfsnr,
      gegenereerdOp: new Date(),
      boekingen: boekingen.map((r) => ({ grootboeknr: r.grootboeknr, bedragDebet: decVerplicht(r.bedrag_debet), bedragCredit: decVerplicht(r.bedrag_credit) })),
      balansstanden: balansstanden.map((r) => ({ grootboekrekeningnr: r.grootboekrekeningnr, omschrijving: r.rekening_omschrijving, eindsaldo: decVerplicht(r.eindsaldo) })),
      servicekosten: servicekosten.map((r) => ({ kostensoort: r.kostensoort, omschrijving: r.kostensoort_omschrijving, bedragDebet: decVerplicht(r.bedrag_debet), bedragCredit: decVerplicht(r.bedrag_credit) })),
      contracten: contracten.map((r) => ({ contract: r.contract, complexnummer: r.complexnummer, unitnummer: r.unitnummer, huurdernummer: r.huurdernummer })),
      units: units.map((r) => ({ complexnummer: r.complexnummer, unitnummer: r.unitnummer, omschrijving: r.unitomschrijving, vvo: dec(r.unit_vvo) })),
      rentroll: rentroll.map((r) => ({ contractnummer: r.contractnummer, complexnummer: r.complexnummer, prolongatieBedragJaar: dec(r.prolongatie_bedrag_jaar), gehuurdOppervlak: dec(r.gehuurd_oppervlak) })),
      complexTotalen: complexTotalen.map((r) => ({ complexnr: r.complexnr, totaalOppervlakte: dec(r.totaal_oppervlakte), totaalVerhuurd: dec(r.totaal_verhuurd), totaalLeegstand: dec(r.totaal_leegstand) })),
      ouderdomsanalyseGeladen: ouderdomsanalyseAantal > 0,
      begrotingGeladen: false,
    };

    const html = renderControlerapportHtml(invoer);
    const rapportenDir = administratieRapportenDir(root, administratieId);
    mkdirSync(rapportenDir, { recursive: true });
    const tijdstempel = new Date().toISOString().replace(/[:.]/g, "-");
    const pad = join(rapportenDir, `controlerapport-${tijdstempel}.html`);
    writeFileSync(pad, html, "utf-8");

    return { html, pad };
  } finally {
    db.close();
  }
}
