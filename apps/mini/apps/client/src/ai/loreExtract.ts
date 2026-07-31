import { chatCompletion } from './client'
import { localRepository } from '@/repository/localRepository'
import {
  createId,
  getWritingMode,
  type LoreCard,
  type LoreCardOp,
  type LoreStateEntry,
  type Provider,
} from '@/types'

/** 道具卡 content 建议结构（写入提示与编辑页引导） */
export const ITEM_CONTENT_TEMPLATE = `【基础】
类型：
外观：
材质/规格：

【持有与来源】
当前持有者：
来源/获得方式：
存放位置：

【功能与数据】（务必写清可核对的具体数值/条件，勿只写空泛形容）
主要功能：
效果数值：
使用条件：
消耗/冷却：
限制/副作用：

【状态记录】（随剧情变化追加）
-

【备注】
`

export const CHARACTER_CONTENT_HINT =
  '只写人物本体：身份、外貌体态、性格、天赋/能力、自身属性数值、当前状态。装备详情与他人完整设定勿写入。'

/** 人物卡 content 建议结构 */
export const CHARACTER_CONTENT_TEMPLATE = `【身份】
姓名/称呼：
年龄/外形基调：
出身/职业：

【本体特征】
外貌与体态：
性格：
天赋/能力（仅自身）：

【自身属性】（仅人物数值，不含装备词条）
等级：
生命/魔力等：
力量/敏捷/智力等：

【状态】
当前目标/处境：
与关键人物关系（一句话，勿展开对方设定）：

【备注】
`

/** 时间线阶段正文模板（长篇） */
export const LORE_STATE_TEMPLATE = `【当前处境】

【能力/属性变化】

【关系变化】

【持有变化】

【备注】
`

const EXTRACT_SYSTEM_LIGHT = `你是小说设定整理助手。根据正文与已有设定卡，输出需要新建或更新的人物卡/道具卡。

规则：
1. 能对应到已有卡（同名或明显同一实体）则 action=update，并填写已有 id，在原设定上合并补充，不要无端删掉仍有效的旧信息。
2. 新出现的重要人物/道具用 action=create；路过龙套可忽略。
3. keywords 填便于检索的别名/称呼，含本名。
4. 装备、法杖、袍服、道具等必须拆成独立的 kind=item 道具卡；不要把装备词条、特效、攻防数值写进人物卡。
5. 只输出 JSON，不要 markdown 代码围栏以外的解释。格式：
{"ops":[{"action":"create"|"update","id":"仅update必填","kind":"character"|"item","name":"…","keywords":["…"],"content":"完整设定","reason":"简述"}]}
6. 与正文无关不要滥输出；无更新时返回 {"ops":[]}。

【人物卡 content——只记录本体】
允许：身份、外貌体态、性格、自身天赋/能力、自身属性数值（等级、生命、魔力、力量等）、当前处境、与他人关系的极简一句。
禁止塞进人物卡：
- 某件装备的完整数值/特效/获取任务过程（应建道具卡；人物侧最多写「持有：xxx」）
- 冗长的任务流水账、逐次性爱/交易过程
- 其他角色的完整设定或对方属性
若正文同时出现人物与其装备，请分别输出人物卡 + 道具卡（道具卡注明持有者）。

【道具卡 content】
必须记录可核对的具体数据，不要只写外观。建议：基础、持有与来源、功能与数据（数值/条件/消耗）、状态记录、备注。`

const EXTRACT_SYSTEM_LONG = `你是小说设定整理助手（长篇时间线模式）。根据正文与已有设定卡，输出新建或更新操作。

规则：
1. 能对应到已有卡则 action=update 并填 id；新实体 action=create。
2. 稳定信息（身份、外貌基调、固有能力设定）写入 core；随剧情变化的处境/等级/关系/持有写入 stateContent，并填 stateFromOrder=本章章序。
3. content 字段仍必填：可把 core 与 state 拼成完整可读文本，或仅填 core（系统会拆分）。
4. 可选字段：core、stateFromOrder、stateLabel、stateContent。
5. 禁止把任务流水账塞进 core；装备细节用独立道具卡。
6. 只输出 JSON：
{"ops":[{"action":"create"|"update","id":"…","kind":"character"|"item","name":"…","keywords":["…"],"content":"…","core":"可选本体","stateFromOrder":章序,"stateLabel":"可选","stateContent":"可选阶段正文","reason":"…"}]}
无更新返回 {"ops":[]}。`

const UPDATE_ONE_SYSTEM_LIGHT = `你是小说设定修订助手。根据给定章节范围内的正文，更新「目标设定卡」。

规则：
1. 以目标卡现有内容为底，合并正文中出现的新信息；勿无端删除仍有效的旧信息。
2. 若存在【用户额外要求】，在不违背本系统规则硬约束的前提下优先满足用户要求（例如精简、只保留本体、强调某字段）。
3. 若 kind=item（道具）：必须补充/修正具体数据（效果数值、使用条件、消耗、持有者、状态变化等），禁止只写空泛外观形容。
4. 若 kind=character（人物）：只更新人物本体信息（身份、外貌体态、性格、自身天赋、自身属性数值、当前状态、极简人际关系）。
   - 禁止把装备词条、特效、攻防数值、任务流水、他人完整设定写进人物卡。
   - 新装备只在人物卡用「持有：装备名」带过；装备细节应假设由道具卡维护，不要在人物 content 里展开。
5. 可顺带更新 keywords（别名）。
6. 只输出 JSON（不要代码围栏外解释）：
{"name":"…","keywords":["…"],"content":"完整设定正文","reason":"简述本轮根据章节补充了什么"}`

const UPDATE_ONE_SYSTEM_LONG = `你是小说设定修订助手（长篇时间线）。根据章节正文更新目标卡。

规则：
1. 拆分输出：core=稳定本体；stateContent=本范围末章时点的可变状态；stateFromOrder=范围结束章序（可被用户覆盖）。
2. 勿把成长流水账写进 core；勿删仍有效的旧本体信息。
3. 人物禁止写入装备详情；道具须含可核对数值。
4. 只输出 JSON：
{"name":"…","keywords":["…"],"content":"可读全文（可等于 core+state）","core":"本体","stateFromOrder":数字,"stateLabel":"可选","stateContent":"阶段正文","reason":"…"}`

export interface ExtractLoreResult {
  ops: LoreCardOp[]
  raw: string
}

export interface UpdateOneLoreResult {
  name: string
  keywords: string[]
  content: string
  core?: string
  stateFromOrder?: number
  stateLabel?: string
  stateContent?: string
  reason: string
  raw: string
}

function parseOps(text: string): LoreCardOp[] {
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const obj = JSON.parse(raw) as { ops?: unknown }
  if (!Array.isArray(obj.ops)) return []
  const out: LoreCardOp[] = []
  for (const item of obj.ops) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const action = o.action === 'update' ? 'update' : o.action === 'create' ? 'create' : null
    const kind = o.kind === 'item' ? 'item' : o.kind === 'character' ? 'character' : null
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const content = typeof o.content === 'string' ? o.content : ''
    const core = typeof o.core === 'string' ? o.core.trim() : undefined
    const stateContent = typeof o.stateContent === 'string' ? o.stateContent.trim() : undefined
    if (!action || !kind || !name) continue
    if (!content.trim() && !core && !stateContent) continue
    const keywords = Array.isArray(o.keywords)
      ? o.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean)
      : [name]
    const stateFromOrder =
      o.stateFromOrder != null && Number.isFinite(Number(o.stateFromOrder))
        ? Math.floor(Number(o.stateFromOrder))
        : undefined
    out.push({
      action,
      id: typeof o.id === 'string' ? o.id : undefined,
      kind,
      name,
      keywords: keywords.length ? keywords : [name],
      content: (content || core || stateContent || '').trim(),
      core,
      stateFromOrder,
      stateLabel: typeof o.stateLabel === 'string' ? o.stateLabel : undefined,
      stateContent,
      reason: typeof o.reason === 'string' ? o.reason : '',
    })
  }
  return out
}

function parseUpdateOne(text: string): Omit<UpdateOneLoreResult, 'raw'> {
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const o = JSON.parse(raw) as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  const content = typeof o.content === 'string' ? o.content.trim() : ''
  const core = typeof o.core === 'string' ? o.core.trim() : undefined
  const stateContent = typeof o.stateContent === 'string' ? o.stateContent.trim() : undefined
  if (!name || (!content && !core && !stateContent)) throw new Error('缺少 name/content')
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean)
    : [name]
  return {
    name,
    keywords: keywords.length ? keywords : [name],
    content: content || [core, stateContent].filter(Boolean).join('\n\n'),
    core,
    stateFromOrder:
      o.stateFromOrder != null && Number.isFinite(Number(o.stateFromOrder))
        ? Math.floor(Number(o.stateFromOrder))
        : undefined,
    stateLabel: typeof o.stateLabel === 'string' ? o.stateLabel : undefined,
    stateContent,
    reason: typeof o.reason === 'string' ? o.reason : '',
  }
}

function formatExistingCards(novelId: string): string {
  const existing = localRepository.listLoreCards(novelId)
  if (!existing.length) return '（尚无设定卡）'
  return existing
    .map((c) => {
      const stateHint = (c.states || [])
        .map((s) => `state@${s.fromOrder}${s.label ? `(${s.label})` : ''}`)
        .join(', ')
      return `- id=${c.id} kind=${c.kind} name=${c.name} keywords=[${(c.keywords || []).join('、')}]\n  core: ${c.core || c.content}${stateHint ? `\n  states: ${stateHint}` : ''}`
    })
    .join('\n')
}

/**
 * 合并或新建时间线阶段。
 */
export function upsertLoreState(
  states: LoreStateEntry[],
  entry: { fromOrder: number; label?: string; content: string },
): LoreStateEntry[] {
  const fromOrder = Math.floor(entry.fromOrder)
  const list = [...states]
  const idx = list.findIndex((s) => s.fromOrder === fromOrder)
  const next: LoreStateEntry = {
    id: idx >= 0 ? list[idx].id : createId('lst_'),
    fromOrder,
    label: entry.label,
    content: entry.content,
    updatedAt: new Date().toISOString(),
  }
  if (idx >= 0) list[idx] = next
  else list.push(next)
  return list.sort((a, b) => a.fromOrder - b.fromOrder || a.id.localeCompare(b.id))
}

/**
 * 拼接章节范围内正文（按章拼接，总长截断）。
 */
export function buildChapterRangeText(
  novelId: string,
  fromOrder: number,
  toOrder: number,
  maxTotalChars = 12000,
): { text: string; chaptersUsed: number; truncated: boolean } {
  const from = Math.min(fromOrder, toOrder)
  const to = Math.max(fromOrder, toOrder)
  const chapters = localRepository
    .listChapters(novelId)
    .filter((c) => c.order >= from && c.order <= to)
  if (!chapters.length) {
    return { text: '', chaptersUsed: 0, truncated: false }
  }
  const parts: string[] = []
  let total = 0
  let truncated = false
  for (const ch of chapters) {
    const header = `【第${ch.order}章 ${ch.title}】\n`
    const body = ch.content?.trim() || '（无正文）'
    const piece = header + body
    if (total + piece.length > maxTotalChars) {
      const remain = maxTotalChars - total - header.length
      if (remain > 100) {
        parts.push(header + body.slice(0, remain) + '\n…（截断）')
      }
      truncated = true
      break
    }
    parts.push(piece)
    total += piece.length
  }
  return { text: parts.join('\n\n'), chaptersUsed: parts.length, truncated }
}

/**
 * 根据章节正文抽取设定卡操作列表（不落库）。
 */
export async function extractLoreOpsFromChapter(options: {
  novelId: string
  chapterId: string
  provider: Provider
  apiKey: string
  model: string
  maxContentChars?: number
}): Promise<ExtractLoreResult> {
  const { novelId, chapterId, provider, apiKey, model } = options
  const maxChars = options.maxContentChars ?? 8000
  const chapter = localRepository.getChapter(chapterId)
  if (!chapter || chapter.novelId !== novelId) {
    throw new Error('章节不存在')
  }
  let body = chapter.content || ''
  const truncated = body.length > maxChars
  if (truncated) body = body.slice(0, maxChars)

  const isLong = getWritingMode(localRepository.getNovel(novelId)?.meta) === 'long'

  const user = [
    `章节：第${chapter.order}章 ${chapter.title}`,
    truncated ? `（正文已截断至 ${maxChars} 字）` : '',
    isLong ? `本章章序（写入 stateFromOrder）：${chapter.order}` : '',
    '',
    '【本章正文】',
    body || '（空）',
    '',
    '【已有设定卡】',
    formatExistingCards(novelId),
  ]
    .filter(Boolean)
    .join('\n')

  const raw = await chatCompletion({
    provider,
    apiKey,
    model,
    messages: [
      { role: 'system', content: isLong ? EXTRACT_SYSTEM_LONG : EXTRACT_SYSTEM_LIGHT },
      { role: 'user', content: user },
    ],
  })

  try {
    const ops = parseOps(raw).map((op) => {
      if (isLong && op.stateContent && op.stateFromOrder == null) {
        return { ...op, stateFromOrder: chapter.order }
      }
      return op
    })
    return { ops, raw }
  } catch {
    throw new Error('AI 返回无法解析为设定卡 JSON')
  }
}

/**
 * 按章节范围分析并生成「单张设定卡」的更新稿（不落库）。
 */
export async function updateLoreCardFromChapterRange(options: {
  novelId: string
  cardId: string
  fromOrder: number
  toOrder: number
  provider: Provider
  apiKey: string
  model: string
  /** 用户额外提示，优先服从其合理要求 */
  userPrompt?: string
}): Promise<UpdateOneLoreResult> {
  const { novelId, cardId, fromOrder, toOrder, provider, apiKey, model } = options
  const userPrompt = options.userPrompt?.trim() || ''
  const card = localRepository.getLoreCard(cardId)
  if (!card || card.novelId !== novelId) throw new Error('设定卡不存在')

  const { text, chaptersUsed, truncated } = buildChapterRangeText(novelId, fromOrder, toOrder)
  if (!chaptersUsed) throw new Error('所选范围内没有章节')

  const isLong = getWritingMode(localRepository.getNovel(novelId)?.meta) === 'long'
  const endOrder = Math.max(fromOrder, toOrder)

  const user = [
    `目标卡：id=${card.id} kind=${card.kind} name=${card.name}`,
    `关键词：${(card.keywords || []).join('、') || '无'}`,
    '',
    '【当前本体 core】',
    card.core || card.content || '（空）',
    '',
    isLong && card.states?.length
      ? `【已有阶段】\n${card.states.map((s) => `第${s.fromOrder}章 ${s.label || ''}：${s.content.slice(0, 200)}`).join('\n')}\n`
      : '',
    `【章节范围】第 ${Math.min(fromOrder, toOrder)}–${endOrder} 章` +
      `（实际纳入 ${chaptersUsed} 章${truncated ? '，正文已截断' : ''}）`,
    isLong ? `建议 stateFromOrder=${endOrder}` : '',
    '',
    '【范围内正文】',
    text || '（空）',
    '',
    userPrompt ? `【用户额外要求】\n${userPrompt}\n` : '',
    card.kind === 'item'
      ? '请按道具卡数据结构输出（含功能与数据、持有等）。'
      : '请只输出人物本体/阶段：勿写入装备词条/特效/任务流水；装备最多「持有：名称」。',
  ]
    .filter(Boolean)
    .join('\n')

  const raw = await chatCompletion({
    provider,
    apiKey,
    model,
    messages: [
      { role: 'system', content: isLong ? UPDATE_ONE_SYSTEM_LONG : UPDATE_ONE_SYSTEM_LIGHT },
      { role: 'user', content: user },
    ],
  })

  try {
    const parsed = parseUpdateOne(raw)
    if (isLong && parsed.stateContent && parsed.stateFromOrder == null) {
      parsed.stateFromOrder = endOrder
    }
    return { ...parsed, raw }
  } catch {
    throw new Error('AI 返回无法解析为设定更新 JSON')
  }
}

/** 将确认后的 ops 写入本地 */
export function applyLoreOps(novelId: string, ops: LoreCardOp[]): LoreCard[] {
  const isLong = getWritingMode(localRepository.getNovel(novelId)?.meta) === 'long'
  const saved: LoreCard[] = []
  for (const op of ops) {
    const old =
      op.action === 'update' && op.id ? localRepository.getLoreCard(op.id) : undefined
    if (op.action === 'update' && op.id && (!old || old.novelId !== novelId)) continue

    let core = op.core ?? op.content
    let states = old?.states ? [...old.states] : []
    if (isLong && op.stateContent?.trim() && op.stateFromOrder != null) {
      if (op.core == null && old?.core) {
        core = old.core
      }
      states = upsertLoreState(states, {
        fromOrder: op.stateFromOrder,
        label: op.stateLabel,
        content: op.stateContent.trim(),
      })
    } else if (!isLong) {
      states = []
    }

    saved.push(
      localRepository.saveLoreCard({
        id: old?.id,
        novelId,
        kind: op.kind,
        name: op.name,
        keywords: op.keywords,
        core,
        content: core,
        states,
      }),
    )
  }
  return saved
}
