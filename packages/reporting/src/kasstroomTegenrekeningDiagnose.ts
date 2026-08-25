import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, kasstroomCategorieVoorRegel, liquideMiddelenVoorRegel, zoekMappingRegel, type Boekingsregel } from "@bvc/domain";

/**
 * Alleen-lezen diagnostiek (2026-08-25) — geen rapport, geen KPI, verandert
 * niets aan `berekenKasstroomManagementoverzicht`. Doel: per boekstuk waarin
 * een opgegeven grootboekrekening voorkomt, tonen of dat boekstuk vandaag
 * meetelt in de eigenaaronttrekkingen-uitsplitsing, en zo niet, waarom niet.
 *
 * Herhaalt bewust dezelfde mechaniek als `berekenKasstroomManagementoverzicht`
 * (herzien 2026-08-25 na een echte productie-run tegen 070_Rooise_Zoom): een
 * boekstuk telt een tegenrekening-bedrag mee zodra (a) het boekstuk ten
 * minste één regel op een bevestigde liquide-middelen-rekening bevat
 * (kasstroom-relevant) EN (b) de opgegeven rekening zelf een bevestigde
 * `kasstroomCategorie: "EIGENAARONTTREKKING"` heeft — geen boekstuk-brede
 * homogeniteitseis of bedrag-matching, zie `kasstroomManagementoverzicht.ts`
 * voor de volledige toelichting waarom dat bij 070 nodig bleek (maandelijkse
 * verzamelboekingen, niet één boekstuk per transactie).
 */

export interface KasstroomTegenrekeningDiagnoseRegel {
  grootboeknr: string;
  bedrag: Decimal;
  isLiquide: boolean;
}

export interface KasstroomTegenrekeningDiagnoseBoekstuk {
  boekstukSleutel: string;
  boekdatum: Date;
  liquideBedrag: Decimal;
  bedragVoorDoelrekening: Decimal;
  teltNuMeeAlsEigenaarOnttrekking: boolean;
  redenNietMeegeteld: string | null;
  regels: KasstroomTegenrekeningDiagnoseRegel[];
}

export interface KasstroomTegenrekeningDiagnoseResultaat {
  doelRekening: string;
  /** Als dit `true` is, wordt de doelrekening zelf als bank/kas behandeld en dus NOOIT als tegenrekening bekeken — vaak de oorzaak als dit onverwacht is. */
  doelRekeningIsAlsLiquideGeclassificeerd: boolean;
  doelRekeningMappingGevonden: boolean;
  doelRekeningActief: boolean | null;
  doelRekeningKasstroomCategorie: string | null;
  boekstukken: KasstroomTegenrekeningDiagnoseBoekstuk[];
  totaalBedragMeegeteld: Decimal;
  totaalBedragNietMeegeteld: Decimal;
}

export function diagnoseerKasstroomTegenrekening(
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
  doelRekening: string,
): KasstroomTegenrekeningDiagnoseResultaat {
  const liquideRekeningen = new Set<string>();
  for (const regel of mappingRegels) {
    if (regel.soort !== "BALANS") continue;
    const liquideResultaat = liquideMiddelenVoorRegel(regel);
    if (liquideResultaat.type === "bekend" && liquideResultaat.waarde) liquideRekeningen.add(regel.grootboekrekening);
  }

  const doelMappingResultaat = zoekMappingRegel(mappingRegels, doelRekening);
  const doelKasstroomCategorieResultaat = doelMappingResultaat.type === "bekend" ? kasstroomCategorieVoorRegel(doelMappingResultaat.waarde) : null;
  const doelIsBevestigdEigenaarOnttrekking = doelKasstroomCategorieResultaat?.type === "bekend" && doelKasstroomCategorieResultaat.waarde === "EIGENAARONTTREKKING";

  interface Groep {
    boekstukSleutel: string;
    boekdatum: Date;
    regels: Boekingsregel[];
  }
  const groepen = new Map<string, Groep>();
  for (const boeking of boekingen) {
    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    const bestaand = groepen.get(key);
    if (bestaand) bestaand.regels.push(boeking);
    else groepen.set(key, { boekstukSleutel: boeking.boekstukSleutel, boekdatum: boeking.boekdatum, regels: [boeking] });
  }

  const boekstukken: KasstroomTegenrekeningDiagnoseBoekstuk[] = [];
  let totaalMeegeteld = new Decimal(0);
  let totaalNietMeegeteld = new Decimal(0);

  for (const groep of groepen.values()) {
    if (!groep.regels.some((r) => r.grootboeknr === doelRekening)) continue;

    const liquideRegels = groep.regels.filter((r) => liquideRekeningen.has(r.grootboeknr));
    const liquideBedrag = liquideRegels.reduce((som, r) => som.plus(boekingSaldo(r)), new Decimal(0));

    let telt: boolean;
    let redenNiet: string | null;

    if (liquideRegels.length === 0) {
      telt = false;
      redenNiet = "Geen enkele regel in dit boekstuk staat op een bevestigde liquide-middelen-rekening — niet kasstroom-relevant.";
    } else if (!doelIsBevestigdEigenaarOnttrekking) {
      telt = false;
      redenNiet = `Kasstroomcategorie van deze rekening resolveert niet naar EIGENAARONTTREKKING (huidige waarde: ${doelKasstroomCategorieResultaat === null ? "rekening niet gevonden in de mapping" : doelKasstroomCategorieResultaat.type === "bekend" ? doelKasstroomCategorieResultaat.waarde : "onbevestigd (null)"}).`;
    } else {
      telt = true;
      redenNiet = null;
    }

    const bedragVoorDoel = groep.regels.filter((r) => r.grootboeknr === doelRekening).reduce((som, r) => som.plus(boekingSaldo(r)), new Decimal(0));
    if (telt) totaalMeegeteld = totaalMeegeteld.plus(bedragVoorDoel);
    else totaalNietMeegeteld = totaalNietMeegeteld.plus(bedragVoorDoel);

    boekstukken.push({
      boekstukSleutel: groep.boekstukSleutel,
      boekdatum: groep.boekdatum,
      liquideBedrag,
      bedragVoorDoelrekening: bedragVoorDoel,
      teltNuMeeAlsEigenaarOnttrekking: telt,
      redenNietMeegeteld: redenNiet,
      regels: groep.regels.map((r) => ({ grootboeknr: r.grootboeknr, bedrag: boekingSaldo(r), isLiquide: liquideRekeningen.has(r.grootboeknr) })),
    });
  }

  boekstukken.sort((a, b) => a.boekdatum.getTime() - b.boekdatum.getTime());

  return {
    doelRekening,
    doelRekeningIsAlsLiquideGeclassificeerd: liquideRekeningen.has(doelRekening),
    doelRekeningMappingGevonden: doelMappingResultaat.type === "bekend",
    doelRekeningActief: doelMappingResultaat.type === "bekend" ? doelMappingResultaat.waarde.actief : null,
    doelRekeningKasstroomCategorie: doelKasstroomCategorieResultaat?.type === "bekend" ? doelKasstroomCategorieResultaat.waarde : null,
    boekstukken,
    totaalBedragMeegeteld: totaalMeegeteld,
    totaalBedragNietMeegeteld: totaalNietMeegeteld,
  };
}
