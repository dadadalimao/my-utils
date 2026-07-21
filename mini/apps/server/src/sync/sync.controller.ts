import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpsertSyncDto } from './dto/sync.dto';
import { SyncService } from './sync.service';

@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Put()
  upsert(@Req() req: { user: { userId: string } }, @Body() dto: UpsertSyncDto) {
    return this.syncService.upsert(req.user.userId, dto.payload);
  }

  @Get()
  get(@Req() req: { user: { userId: string } }) {
    return this.syncService.get(req.user.userId);
  }
}
