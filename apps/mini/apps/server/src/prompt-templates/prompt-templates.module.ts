import { Module } from '@nestjs/common';
import { PromptTemplatesController } from './prompt-templates.controller';
import { PromptTemplatesService } from './prompt-templates.service';

@Module({
  controllers: [PromptTemplatesController],
  providers: [PromptTemplatesService],
})
export class PromptTemplatesModule {}
