import { createHash } from "node:crypto";
import type { PrismaClient, ValidatieStatus } from "@bvc/db";
import type { RowIssue } from "@bvc/data-contracts";

export function bestandHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Idempotent op bronbestand-hash + brontabel (AP: "Alle imports zijn
 * idempotent op bronbestand-hash, batch-id en natuurlijke bronsleutel").
 * Een herhaalde import van exact hetzelfde bestand hergebruikt de batch
 * i.p.v. duplicaten aan te maken.
 */
export async function vindOfMaakBatch(
  prisma: PrismaClient,
  input: { bronTabel: string; bronBestandsnaam: string; bronBestandHash: string; administratieCode: string | null },
) {
  const bestaand = await prisma.stgImportBatch.findUnique({
    where: { bronTabel_bronBestandHash: { bronTabel: input.bronTabel, bronBestandHash: input.bronBestandHash } },
  });
  if (bestaand) return bestaand;

  return prisma.stgImportBatch.create({
    data: {
      bronTabel: input.bronTabel,
      bronBestandsnaam: input.bronBestandsnaam,
      bronBestandHash: input.bronBestandHash,
      administratieCode: input.administratieCode,
    },
  });
}

/**
 * Zet de batch op GESLAAGD of GEBLOKKEERD. Activeert de batch NOOIT
 * automatisch als "actieve bronversie" — dat is een expliciete,
 * afzonderlijke stap (AP-15/OB-031: precies één actieve versie per bron,
 * een nieuwe succesvolle import mag een vorige actieve batch niet stil
 * vervangen).
 */
export async function rondBatchAf(
  prisma: PrismaClient,
  batchId: string,
  input: { rowCount: number; issues: RowIssue[] },
) {
  const heeftKritiek = input.issues.some((issue) => issue.ernst === "KRITIEK");
  const status: ValidatieStatus = heeftKritiek ? "GEBLOKKEERD" : "GESLAAGD";
  return prisma.stgImportBatch.update({
    where: { id: batchId },
    data: {
      rowCount: input.rowCount,
      validatieStatus: status,
      validatieIssues: input.issues.length > 0 ? JSON.parse(JSON.stringify(input.issues)) : undefined,
    },
  });
}
