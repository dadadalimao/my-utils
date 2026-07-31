import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PromptTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(mode?: string) {
    return this.prisma.promptTemplate.findMany({
      where: {
        enabled: true,
        ...(mode ? { mode } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        mode: true,
        name: true,
        content: true,
        updatedAt: true,
      },
    });
  }
}
