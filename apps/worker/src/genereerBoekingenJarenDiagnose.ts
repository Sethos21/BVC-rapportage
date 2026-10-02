import Decimal from "decimal.js";
import { diagnoseerBoekingenJaren, type BoekingenJarenDiagnoseResultaat, type BoekingenJarenRegel } from "@bvc/reporting";
import { resolveBron } from "./sourceResolver.js";
import { ExcelBronAdapter } from "./bronAdapter.js";
import { leesAdministratieConfig } from "./administratie.js";

export interface GenereerBoekingenJarenDiagnoseOpties {
  /** Grootboekrekeningen om op te filteren (bv. ["08830","00166","00167"]) — parameter, niet hardcoded. */
  grootboekrekeningen: string[];
}

function tekst(v: unknown): string {
  return String(v ?? "").trim();
}

function naarBoekingenJarenRegel(row: Record<string, unknown>): BoekingenJarenRegel {
  return {
    grootboeknr: tekst(row["Boeking_Grootboeknr"]),
    boekjaar: Number(tekst(row["Boeking_Boekjaar"])),
    boekperiode: tekst(row["Boeking_Boekperiode"]),
    bedragDebet: new Decimal(tekst(row["Boeking_Bedrag_Debet"]) || "0"),
    bedragCredit: new Decimal(tekst(row["Boeking_Bedrag_Credit"]) || "0"),
  };
}

/**
 * Gerichte, TIJDELIJKE, ALLEEN-LEZEN diagnostiek (2026-09-11): voor één
 * administratie en één of meer grootboekrekeningen, ZONDER boekjaar/periode
 * te gokken, vaststellen in welke boekjaren/periodes er überhaupt boekingen
 * voorkomen — bouwstap om, wanneer een laag-volume rekening (bv. een
 * eenmalige verkooptransactie, zie OB-039-bronfase) in de al geprobeerde
 * boekjaren leeg blijkt, het juiste boekjaar te vinden voor een gerichte
 * vervolgdiagnose zoals `boekingen-onderhoud-diagnose` — zonder verder te
 * gokken. Leest het RUWE boekingen-bronbestand (niet de cache), filtert
 * uitsluitend op bedrijfsnr + de opgegeven grootboekrekeningen — BEWUST GEEN
 * boekjaar/periodefilter, dat is precies het doel van dit commando. Bouwt
 * GEEN classificatie, GEEN begrotingscode — zie `diagnoseerBoekingenJaren`
 * (`@bvc/reporting`) voor de pure aggregatielogica.
 */
export function genereerBoekingenJarenDiagnose(
  root: string,
  administratieId: string,
  opties: GenereerBoekingenJarenDiagnoseOpties,
): BoekingenJarenDiagnoseResultaat {
  const config = leesAdministratieConfig(root, administratieId);
  const doelrekeningen = new Set(opties.grootboekrekeningen.map((r) => r.trim()));

  const bron = resolveBron(root, administratieId, "boekingen");
  if (!bron.bestaat) {
    throw new Error(`Boekingen-bronbestand niet gevonden op "${bron.pad}" — draai eerst rebuild-cache of controleer bronlocaties.json.`);
  }
  const ruweRijen = new ExcelBronAdapter().leesRuweRijen(bron);

  const regels = ruweRijen
    .filter((row) => tekst(row["Bedrijfsnr"]) === config.bedrijfsnr)
    .filter((row) => doelrekeningen.has(tekst(row["Boeking_Grootboeknr"])))
    .map(naarBoekingenJarenRegel);

  return diagnoseerBoekingenJaren(regels);
}
