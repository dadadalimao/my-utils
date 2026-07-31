import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { PromptTemplatesModule } from './prompt-templates/prompt-templates.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [PrismaModule, AuthModule, SyncModule, PromptTemplatesModule],
  controllers: [HealthController],
})
export class AppModule {}
