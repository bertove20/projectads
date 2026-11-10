import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
}

const SECRET_KEYS = /pass(word)?|secret|token|template|ciphertext|key|hash/i;

/** Hapus field rahasia sebelum disimpan ke audit log. */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value instanceof Prisma.Decimal) return value.toString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          organizationId: entry.organizationId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: (redact(entry.before) ?? undefined) as Prisma.InputJsonValue | undefined,
          after: (redact(entry.after) ?? undefined) as Prisma.InputJsonValue | undefined,
          ipHash: entry.ipHash ?? null,
        },
      });
    } catch (err) {
      if (tx) throw err; // dalam transaksi: gagal audit = gagal operasi
      this.logger.error({ err, action: entry.action }, 'Gagal menulis audit log');
    }
  }
}
