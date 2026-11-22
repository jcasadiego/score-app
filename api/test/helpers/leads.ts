import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Borra leads de prueba con sus envíos al CRM: la FK es `Restrict` (PF-80), así
 * que los eventos van primero.
 */
export async function deleteLeads(
  prisma: PrismaService,
  where: Prisma.LeadWhereInput,
) {
  await prisma.$transaction([
    prisma.crmSyncEvent.deleteMany({ where: { lead: where } }),
    prisma.lead.deleteMany({ where }),
  ]);
}
