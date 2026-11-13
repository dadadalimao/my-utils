import { chatCompletion } from './client'
import { chapterOutputFormatHint, parseChapterFence } from './chapterFence'
import { buildOtokonokoInjectContent } from '@/constants/otokonoko'
import { buildR18LexiconInject } from '@/constants/r18Lexicon'
import type { Provider } from '@/types'

/**
 * 把已有章节正文改成更直白的口语脏词，情节与顺序保持原样。
 */
export async function vulgarizeChapterContent(options: {
  text: string
  provider: Provider
  apiKey: string
  model: string
  injectOtokonoko?: boolean
  onAbortHandle?: (handle: { abort: () => void }) => void
}): Promise<string> {
  const raw = options.text.trim()
  if (!raw) throw new Error('没有可改写的正文')

  const systemParts = [
    '你是成人向网文改稿。任务是把已有正文的情色用词改成口语脏词，不是重写故事。',
    '人名、情节顺序、场景转换、对白意图、非情色段落尽量原句保留。',
    '情色场面改成直白好读：鸡巴、穴、屁穴、操、插、顶、射。',
    '写外形、触感、分量时用：胸部、乳房、乳头、精液、腰、臀。',
    '假鸡巴就写假鸡巴。',
    '委婉说法改成点名：那根东西/那玩意/肉棒/阳具/阴茎 → 鸡巴；后庭/后穴/菊穴 → 屁穴；白浊 → 精液；爱液/津液 → 淫水；性器/那里/下体/私处 → 具体部位。',
    '淫语贴这个角色的嘴，平时说话软的人不必突然满口脏话。',
    '禁止扩写成另一章，禁止删情节点，禁止只输出摘录。',
    '只输出改完的全文，不要改动说明。',
    chapterOutputFormatHint(),
    buildR18LexiconInject(),
  ]
  if (options.injectOtokonoko) {
    systemParts.push(buildOtokonokoInjectContent())
  }

  const out = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    thinkingEffort: 'off',
    timeoutMs: 300000,
    onAbortHandle: options.onAbortHandle,
    messages: [
      { role: 'system', content: systemParts.join('\n\n') },
      {
        role: 'user',
        content: `请把下面正文改成更粗俗直白的情色用词，输出完整改写稿。\n\n${raw}`,
      },
    ],
  })

  const { body } = parseChapterFence(out)
  const next = body.trim()
  if (!next) throw new Error('粗俗改写结果为空')
  return next
}
