import Decimal from "decimal.js";
import type { GrootboekMappingRegel } from "@bvc/config";
import { boekingSaldo, kasstroomCategorieVoorRegel, liquideMiddelenVoorRegel, zoekMappingRegel, type Boekingsregel } from "@bvc/domain";

/**
 * Top-N grootste OVERIGE uitgaven (2026-08-25) — aanvullende, puur
 * informatieve uitsplitsing bovenop `berekenKasstroomManagementoverzicht`,
 * bewust in een EIGEN functie i.p.v. die (vastgelegde regressie-)functie
 * te wijzigen. Heeft geen invloed op enige bestaande aansluiting:
 * `ontvangsten`/`uitgaven`/`nettoKasstroom`/`eigenaarOnttrekkingen`/
 * `overigeUitgaven` blijven exact zoals berekend door
 * `berekenKasstroomManagementoverzicht` — deze functie voegt alleen een
 * top-N *lijst* van individuele bankbetalingen toe, telt niets dubbel.
 *
 * "Werkelijke uitgaande bankbetalingen": elke individuele boeking op een
 * bevestigde liquide-middelen-rekening met een negatief saldo (dezelfde
 * regel als `uitgaven` in `berekenKasstroomManagementoverzicht`) — geen
 * boekstukaggregatie.
 *
 * "Exclusief EIGENAARONTTREKKING": een individuele uitgaande bankregel
 * wordt uitgesloten als hetzelfde boekstuk een tegenrekening-regel bevat
 * met een bevestigde `kasstroomCategorie: "EIGENAARONTTREKKING"` én
 * EXACT hetzelfde bedrag (boekstukken balanceren per definitie, en in de
 * praktijk bij 070 heeft elke eigenaaronttrekking-tegenrekeningregel een
 * exact even grote, tegengestelde liquide regel in hetzelfde boekstuk —
 * zie `kasstroomTegenrekeningDiagnose`-onderzoek 2026-08-25). Bedrag-
 * matching per boekstuk (multiset, één-op-één verbruikt) i.p.v. een
 * boekstukbrede aanname, zodat een verzamelboeking met MEERDERE
 * onttrekkingen elk afzonderlijk correct wordt uitgesloten. Een
 * eventuele, zeer onwaarschijnlijke toevalstreffer (een niet-onttrekking-
 * uitgave met exact hetzelfde bedrag als een onttrekking in hetzelfde
 * boekstuk) is een bekende beperking van deze puur informatieve lijst —
 * de aansluitingen zelf zijn hier niet van afhankelijk.
 */

export interface KasstroomTopUitgaveRegel {
  boekdatum: Date;
  bedrag: Decimal;
  omschrijving: string;
}

export function berekenTopOverigeUitgaven(
  boekingen: readonly Boekingsregel[],
  mappingRegels: readonly GrootboekMappingRegel[],
  aantal = 3,
): KasstroomTopUitgaveRegel[] {
  const liquideRekeningen = new Set<string>();
  for (const regel of mappingRegels) {
    if (regel.soort !== "BALANS") continue;
    const liquideResultaat = liquideMiddelenVoorRegel(regel);
    if (liquideResultaat.type === "bekend" && liquideResultaat.waarde) liquideRekeningen.add(regel.grootboekrekening);
  }

  const onttrekkingenPerBoekstuk = new Map<string, Decimal[]>();
  for (const boeking of boekingen) {
    if (liquideRekeningen.has(boeking.grootboeknr)) continue;
    const mappingResultaat = zoekMappingRegel(mappingRegels, boeking.grootboeknr);
    if (mappingResultaat.type === "onbekend") continue;
    const categorieResultaat = kasstroomCategorieVoorRegel(mappingResultaat.waarde);
    if (categorieResultaat.type !== "bekend" || categorieResultaat.waarde !== "EIGENAARONTTREKKING") continue;

    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    const bestaand = onttrekkingenPerBoekstuk.get(key);
    if (bestaand) bestaand.push(boekingSaldo(boeking));
    else onttrekkingenPerBoekstuk.set(key, [boekingSaldo(boeking)]);
  }

  const kandidaten: KasstroomTopUitgaveRegel[] = [];
  for (const boeking of boekingen) {
    if (!liquideRekeningen.has(boeking.grootboeknr)) continue;
    const saldo = boekingSaldo(boeking);
    if (!saldo.isNegative()) continue;

    const key = `${boeking.bedrijfsnr}::${boeking.boekstukSleutel}`;
    const beschikbareOnttrekkingen = onttrekkingenPerBoekstuk.get(key);
    if (beschikbareOnttrekkingen) {
      const matchIndex = beschikbareOnttrekkingen.findIndex((bedrag) => bedrag.equals(saldo.negated()));
      if (matchIndex !== -1) {
        beschikbareOnttrekkingen.splice(matchIndex, 1);
        continue; // toegewezen aan een eigenaaronttrekking, niet meetellen als "overig"
      }
    }

    kandidaten.push({ boekdatum: boeking.boekdatum, bedrag: saldo.negated(), omschrijving: boeking.omschrijving });
  }

  return kandidaten.sort((a, b) => b.bedrag.comparedTo(a.bedrag)).slice(0, aantal);
}
