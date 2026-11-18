import { chatCompletion } from './client'
import { chapterOutputFormatHint, parseChapterFence } from './chapterFence'
import { buildOtokonokoInjectContent } from '@/constants/otokonoko'
import { buildR18LexiconInject } from '@/constants/r18Lexicon'
import type { Provider } from '@/types'

/**
 * 一键粗俗扩写：情色场面补细（避免一笔带过），同时改成口语脏词。
 * 情节顺序与非情色主线保持原样，不另起一章。
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
    '你是成人向网文改稿。同一篇正文要同时做完两件事：扩写 R18，以及改成粗俗用词。',
    '扩写：情色场面写细，补动作、身体反应、节奏、感官和对话。凡是一笔带过（一番云雨、做到天亮、发生了关系、做了、略过过程）必须展开成正在发生的过程，不能再跳过。',
    '已经写细的情色保留原有情节，只补明显被跳过的步骤，不要改成另一个玩法。',
    '粗俗：情色场面改成直白好读的口语脏词：鸡巴、穴、屁穴、操、插、顶、射。',
    '写外形、触感、分量时用：胸部、乳房、乳头、精液、腰、臀。',
    '假鸡巴就写假鸡巴。',
    '委婉说法改成点名：那根东西/那玩意/肉棒/阳具/阴茎 → 鸡巴；后庭/后穴/菊穴 → 屁穴；白浊 → 精液；爱液/津液 → 淫水；性器/那里/下体/私处 → 具体部位。',
    '淫语贴这个角色的嘴，平时说话软的人不必突然满口脏话。',
    '人名、情节顺序、场景转换、非情色主线尽量保留。不为加长另写支线，也不要凭空加一段原文没有的无关性爱。',
    '禁止改成另一章，禁止删情节点，禁止只输出摘录。被扩写的情色段落应明显长于原稿。',
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
        content: `请把下面正文做两件事：把一笔带过的情色场面扩写细，并把情色用词改成粗俗直白。输出完整全文。\n\n${raw}`,
      },
    ],
  })

  const { body } = parseChapterFence(out)
  const next = body.trim()
  if (!next) throw new Error('粗俗改写结果为空')
  return next
}
