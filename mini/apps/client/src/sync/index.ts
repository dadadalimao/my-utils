import { apiDownloadSnapshot, apiUploadSnapshot } from '@/api/http'
import { localRepository } from '@/repository/localRepository'

/** 将本地全量数据上传覆盖云端 */
export async function uploadAll(token: string) {
  const payload = localRepository.exportSnapshot()
  return apiUploadSnapshot(token, payload)
}

/** 从云端导入并覆盖本地 */
export async function importAll(token: string) {
  const { payload, updatedAt } = await apiDownloadSnapshot(token)
  localRepository.importSnapshot(payload)
  return updatedAt
}
