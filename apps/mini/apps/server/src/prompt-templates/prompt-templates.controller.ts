import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PromptTemplatesService } from './prompt-templates.service';

/** 提示词模板：需登录拉取，客户端应缓存到本地以便登出后仍可用 */
@Controller('prompt-templates')
@UseGuards(JwtAuthGuard)
export class PromptTemplatesController {
  constructor(private readonly service: PromptTemplatesService) {}

  @Get()
  list(@Query('mode') mode?: string) {
    return this.service.list(mode);
  }
}
