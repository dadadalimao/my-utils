import { Controller, Get, Query } from '@nestjs/common';
import { PromptTemplatesService } from './prompt-templates.service';

@Controller('prompt-templates')
export class PromptTemplatesController {
  constructor(private readonly service: PromptTemplatesService) {}

  @Get()
  list(@Query('mode') mode?: string) {
    return this.service.list(mode);
  }
}
