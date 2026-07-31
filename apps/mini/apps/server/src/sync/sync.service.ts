import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptSnapshotPayload,
  encryptSnapshotPayload,
} from '../common/crypto.util';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, payload: Record<string, unknown>) {
    const payloadJson = encryptSnapshotPayload(payload);
    const row = await this.prisma.userSnapshot.upsert({
      where: { userId },
      create: { userId, payloadJson },
      update: { payloadJson },
    });
    return { updatedAt: row.updatedAt };
  }

  async get(userId: string) {
    const row = await this.prisma.userSnapshot.findUnique({
      where: { userId },
    });
    if (!row) {
      throw new NotFoundException('no snapshot found');
    }
    return {
      payload: decryptSnapshotPayload(row.payloadJson),
      updatedAt: row.updatedAt,
    };
  }
}
