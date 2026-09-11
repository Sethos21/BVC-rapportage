import Decimal from "decimal.js";
import { budgetafwijking } from "@bvc/domain";
import type { KasstroomManagementoverzichtResultaat } from "./kasstroomManagementoverzicht.js";

/**
 * Vergelijkt een berekend Kasstroom-managementoverzicht met eerder
 * bevestigde ("verwachte") bedragen — zelfde rol als
 * `plPeriodeBerekening.ts`'s `vergelijkMetGereconcilieerd`, maar op de
 * vaste set kasstroom-KPI's in plaats van een dynamische lijst
 * rapportageposten (die bestaat hier niet: het managementoverzicht heeft
 * een klein, vast aantal velden + vier kwartalen).
 *
 * Bedoeld als regressiepunt: zodra een administratie+periode eenmaal
 * handmatig geverifieerd is (zoals 070_Rooise_Zoom, boekjaar 2026 t/m
 * periode 06 — zie packages/reporting/README.md "Kasstroom"), legt een
 * `verwacht.json`-bestand die uitkomst vast. Een latere wijziging aan de
 * berekening die deze aansluiting breekt, wordt hiermee zichtbaar zonder
 * dat iemand de cijfers opnieuw met de hand hoeft na te rekenen.
 */

export interface KasstroomKwartaalVerwacht {
  kwartaal: 1 | 2 | 3 | 4;
  ontvangsten: Decimal;
  uitgaven: Decimal;
  eigenaarOnttrekkingen: Decimal;
  nettoKasstroom: Decimal;
}

export interface KasstroomManagementoverzichtVerwacht {
  bankstandBegin: Decimal;
  bankstandEind: Decimal;
  ontvangsten: Decimal;
  uitgaven: Decimal;
  nettoKasstroom: Decimal;
  eigenaarOnttrekkingen: Decimal;
  overigeUitgaven: Decimal;
  perKwartaal: readonly KasstroomKwartaalVerwacht[];
}

export interface KasstroomManagementoverzichtVergelijkingsregel {
  label: string;
  berekend: Decimal;
  verwacht: Decimal;
  verschil: Decimal;
  sluitBinnenTolerantie: boolean;
}

export interface KasstroomManagementoverzichtVergelijkingsResultaat {
  regels: KasstroomManagementoverzichtVergelijkingsregel[];
  alleSluitenBinnenTolerantie: boolean;
}

export function vergelijkKasstroomManagementoverzichtMetVerwacht(
  resultaat: KasstroomManagementoverzichtResultaat,
  verwacht: KasstroomManagementoverzichtVerwacht,
  toleranceEuro: Decimal,
): KasstroomManagementoverzichtVergelijkingsResultaat {
  const paren: { label: string; berekend: Decimal; verwacht: Decimal }[] = [
    { label: "Bankstand begin", berekend: resultaat.bankstandBegin, verwacht: verwacht.bankstandBegin },
    { label: "Bankstand eind", berekend: resultaat.bankstandEind, verwacht: verwacht.bankstandEind },
    { label: "Ontvangsten", berekend: resultaat.ontvangsten, verwacht: verwacht.ontvangsten },
    { label: "Uitgaven", berekend: resultaat.uitgaven, verwacht: verwacht.uitgaven },
    { label: "Netto kasstroom", berekend: resultaat.nettoKasstroom, verwacht: verwacht.nettoKasstroom },
    { label: "Eigenaaronttrekkingen", berekend: resultaat.eigenaarOnttrekkingen, verwacht: verwacht.eigenaarOnttrekkingen },
    { label: "Overige uitgaven", berekend: resultaat.overigeUitgaven, verwacht: verwacht.overigeUitgaven },
  ];

  for (const kwartaal of [1, 2, 3, 4] as const) {
    const berekendKw = resultaat.perKwartaal.find((k) => k.kwartaal === kwartaal);
    const verwachtKw = verwacht.perKwartaal.find((k) => k.kwartaal === kwartaal);
    if (!berekendKw || !verwachtKw) continue;
    paren.push(
      { label: `Q${kwartaal} ontvangsten`, berekend: berekendKw.ontvangsten, verwacht: verwachtKw.ontvangsten },
      { label: `Q${kwartaal} uitgaven`, berekend: berekendKw.uitgaven, verwacht: verwachtKw.uitgaven },
      { label: `Q${kwartaal} eigenaaronttrekkingen`, berekend: berekendKw.eigenaarOnttrekkingen, verwacht: verwachtKw.eigenaarOnttrekkingen },
      { label: `Q${kwartaal} netto kasstroom`, berekend: berekendKw.nettoKasstroom, verwacht: verwachtKw.nettoKasstroom },
    );
  }

  const regels: KasstroomManagementoverzichtVergelijkingsregel[] = paren.map(({ label, berekend, verwacht: verwachtBedrag }) => {
    const verschil = budgetafwijking(berekend, verwachtBedrag);
    return { label, berekend, verwacht: verwachtBedrag, verschil, sluitBinnenTolerantie: verschil.abs().lessThanOrEqualTo(toleranceEuro) };
  });

  return { regels, alleSluitenBinnenTolerantie: regels.every((r) => r.sluitBinnenTolerantie) };
}
