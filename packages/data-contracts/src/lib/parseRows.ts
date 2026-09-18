import type { z } from "zod";

export interface RowIssue {
  rowIndex: number;
  bericht: string;
  ernst: "KRITIEK" | "WAARSCHUWING";
}

export interface ParseResult<T> {
  rijen: T[];
  issues: RowIssue[];
}

/**
 * Valideert elke ruwe rij tegen een Zod-contract. Een ongeldige rij blokkeert
 * niet de hele batch (PAR-DQ-002 werkt op ontbrekende verplichte metadata,
 * niet op "de import stopt bij de eerste fout") — de rij verschijnt als
 * KRITIEK issue en de batch als geheel beslist later (StgImportBatch.validatieStatus)
 * of publicatie geblokkeerd wordt.
 */
export function parseRowsWithSchema<Schema extends z.ZodType>(
  ruweRijen: readonly Record<string, unknown>[],
  schema: Schema,
): ParseResult<z.infer<Schema>> {
  const rijen: z.infer<Schema>[] = [];
  const issues: RowIssue[] = [];

  ruweRijen.forEach((ruweRij, index) => {
    const result = schema.safeParse(ruweRij);
    if (result.success) {
      rijen.push(result.data);
    } else {
      issues.push({
        rowIndex: index,
        bericht: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        ernst: "KRITIEK",
      });
    }
  });

  return { rijen, issues };
}

/** PAR-DQ-001 — iedere dubbele natuurlijke sleutel blokkeert import. */
export function vindDubbeleNatuurlijkeSleutels<T>(rijen: readonly T[], sleutelVan: (rij: T) => string): RowIssue[] {
  const gezien = new Map<string, number>();
  const issues: RowIssue[] = [];
  rijen.forEach((rij, index) => {
    const sleutel = sleutelVan(rij);
    const eersteIndex = gezien.get(sleutel);
    if (eersteIndex !== undefined) {
      issues.push({
        rowIndex: index,
        bericht: `Dubbele natuurlijke sleutel "${sleutel}" (eerder op rij ${eersteIndex}) — PAR-DQ-001, blokkeert import.`,
        ernst: "KRITIEK",
      });
    } else {
      gezien.set(sleutel, index);
    }
  });
  return issues;
}
