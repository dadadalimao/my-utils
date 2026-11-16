import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { ExportService } from './export.service';

/**
 * 本地导出和回写，故意不登录。
 * 导出写入 exports；上传直接读该目录，覆盖指定用户的这一本书，不含密钥。
 */
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('novel')
  exportNovel(
    @Query('username') username?: string,
    @Query('title') title?: string,
  ) {
    const name = username?.trim();
    const book = title?.trim();
    if (!name || !book) {
      throw new BadRequestException('需要查询参数 username 和 title');
    }
    return this.exportService.exportNovel(name, book);
  }

  @Post('novel')
  uploadNovel(
    @Query('username') username?: string,
    @Query('title') title?: string,
  ) {
    const name = username?.trim();
    const book = title?.trim();
    if (!name || !book) {
      throw new BadRequestException('需要查询参数 username 和 title');
    }
    return this.exportService.uploadNovel(name, book);
  }
}
