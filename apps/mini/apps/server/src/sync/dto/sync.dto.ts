import { IsObject } from 'class-validator';

export class UpsertSyncDto {
  @IsObject()
  payload!: Record<string, unknown>;
}
