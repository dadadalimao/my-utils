import { Controller, Get } from '@nestjs/common';

/** 无鉴权探活，供客户端 Ping 后端 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { ok: true };
  }
}
