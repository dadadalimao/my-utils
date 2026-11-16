import { chatCompletion } from './client'
import { localRepository } from '@/repository/localRepository'
import {
  createId,
  getWritingMode,
  type LoreCard,
  type LoreCardKind,
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
  '只写人物本体：身份、外貌体态、性格、天赋/能力、自身属性数值、当前状态。用设定短句概括，勿整句摘抄正文。装备详情请建道具卡。'

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

const EXTRACT_SYSTEM_LIGHT = `你是小说设定卡编辑。根据正文与已有卡，输出需要新建或更新的人物卡/道具卡。

【写法】
- 设定卡给后续写作核对，写成短句分节条目，用设定语言概括。
- 正文只作情报来源。对白、动作长句、场面描写、性爱过程一律改写成事实条目（身份、体态、能力数值、持有、关系一句）。
- content 里只留概括后的设定，原文句子整句搬进卡里一律视为失败。
- 仍有效的旧信息保留并与新事实合并。路过龙套可忽略。

【对应】
- 已有卡（同名或同一实体）：action=update，填写已有 id。
- 新出场的重要人物/道具：action=create。
- keywords 含本名与常用称呼。
- 装备、法杖、袍服等拆成独立 kind=item；人物卡最多写「持有：名称」。

【人物卡】
写成：身份、外貌体态、性格、自身能力与数值、当前处境、关系一句、持有名称。
装备数值、特效、获取过程写进道具卡。他人完整设定留在对方卡上。

【道具卡】
写成：类型与外观要点、持有者、功能数值、使用条件、消耗、限制。

无更新返回 {"ops":[]}。只输出 JSON：
{"ops":[{"action":"create"|"update","id":"仅update必填","kind":"character"|"item","name":"…","keywords":["…"],"content":"完整设定","reason":"简述"}]}`

const EXTRACT_SYSTEM_LONG = `你是小说设定卡编辑（长篇时间线）。根据正文与已有卡，输出新建或更新操作。

【写法】
- 设定卡写成短句分节条目。正文只作情报来源，对白与场面描写改写成事实。
- content/core/stateContent 只留概括后的设定，原文句子整句搬进卡里一律视为失败。
- 稳定信息写入 core：身份、外貌基调、固有能力。
- 可变信息写入 stateContent，并填 stateFromOrder=本章章序：处境、等级、关系、持有。
- content 必填，可等于 core，或 core+state 拼写。

【对应】
- 已有卡 update 并填 id；新实体 create。
- 装备拆独立道具卡；人物卡最多「持有：名称」。
- keywords 含本名与称呼。

无更新返回 {"ops":[]}。只输出 JSON：
{"ops":[{"action":"create"|"update","id":"…","kind":"character"|"item","name":"…","keywords":["…"],"content":"…","core":"可选本体","stateFromOrder":章序,"stateLabel":"可选","stateContent":"可选阶段正文","reason":"…"}]}`

const UPDATE_ONE_SYSTEM_LIGHT = `你是小说设定卡修订助手。根据给定章节范围内的正文，更新「目标设定卡」。

【写法】
- 以现有卡为底，合并正文里的新事实，仍有效的旧信息保留。
- 用设定语言重写全文：短句分节。对白、场面描写、一次性情节改写成事实条目。
- 输出的 content 是概括后的设定，原文句子整句搬进卡里一律视为失败。
- 若有【用户额外要求】，在上述写法之内优先满足（精简、只留本体、强调某字段）。

【人物】身份、外貌体态、性格、自身能力与数值、当前状态、关系一句、持有名称。装备详情留在道具卡。
【道具】效果数值、使用条件、消耗、持有者、状态变化。
可更新 keywords。只输出 JSON：
{"name":"…","keywords":["…"],"content":"完整设定正文","reason":"本轮补了什么"}`

const UPDATE_ONE_SYSTEM_LONG = `你是小说设定卡修订助手（长篇时间线）。根据章节正文更新目标卡。

【写法】
- core=稳定本体（身份、外貌基调、固有能力）；stateContent=本范围末章时点的可变状态；stateFromOrder=范围结束章序。
- 用设定语言重写。对白与场面描写改写成事实。core/stateContent 里原文整句搬入一律视为失败。
- 仍有效的旧本体保留。人物卡最多「持有：名称」；道具含可核对数值。

只输出 JSON：
{"name":"…","keywords":["…"],"content":"可读全文（可等于 core+state）","core":"本体","stateFromOrder":数字,"stateLabel":"可选","stateContent":"阶段正文","reason":"…"}`

const COMPACT_SYSTEM = `你是设定卡精简助手。把已有设定卡改写成更短、可核对的条目。

【写法】
- 保留仍有效的事实：名称、身份、体态、性格、能力数值、持有、关系结论。
- 用设定语言重写，短句分节。对白、场面描写、任务流水、性爱过程复述、原文摘抄全部改写成一条事实或删掉。
- 人物卡只留本体；装备详情留在道具卡，人物侧最多「持有：名称」。
- 道具卡只留可核对数据：功能数值、条件、消耗、持有者。
- 每张卡 action=update，id 必须与输入一致。本轮未改动的卡可省略。

只输出 JSON：
{"ops":[{"action":"update","id":"…","kind":"character"|"item","name":"…","keywords":["…"],"content":"精简后全文","core":"精简后本体（可与 content 相同）","reason":"精简了什么"}]}
无改动返回 {"ops":[]}。`

const COMPACT_BATCH_SIZE = 5

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
 * @param options.kind 传入则本轮只新建/更新该类型
 */
export async function extractLoreOpsFromChapter(options: {
  novelId: string
  chapterId: string
  provider: Provider
  apiKey: string
  model: string
  maxContentChars?: number
  kind?: LoreCardKind
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
  const kindHint =
    options.kind === 'character'
      ? '本轮只输出人物卡（kind=character）。道具卡本轮忽略。'
      : options.kind === 'item'
        ? '本轮只输出道具卡（kind=item）。人物卡本轮忽略。'
        : '人物与道具都可输出。'

  const user = [
    `章节：第${chapter.order}章 ${chapter.title}`,
    truncated ? `（正文已截断至 ${maxChars} 字）` : '',
    isLong ? `本章章序（写入 stateFromOrder）：${chapter.order}` : '',
    kindHint,
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
    }).filter((op) => !options.kind || op.kind === options.kind)
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
      ? '请按道具卡数据结构输出（功能与数据、持有）。用设定语言概括，原文句子整句搬入视为失败。'
      : '请只输出人物本体/阶段：装备最多「持有：名称」。用设定语言概括，原文句子整句搬入视为失败。',
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

function formatCardsForCompact(cards: LoreCard[]): string {
  return cards
    .map((c) => {
      const states = (c.states || [])
        .map((s) => `  阶段@第${s.fromOrder}章${s.label ? `（${s.label}）` : ''}：${s.content}`)
        .join('\n')
      return [
        `id=${c.id} kind=${c.kind} name=${c.name}`,
        `keywords=[${(c.keywords || []).join('、')}]`,
        `core:\n${c.core || c.content || '（空）'}`,
        states ? `states:\n${states}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n---\n\n')
}

/**
 * 按类型精简已有设定卡（去掉原文摘抄与流水账，不落库）。
 * 长篇只改 core，时间线阶段原样保留。
 */
export async function compactLoreCards(options: {
  novelId: string
  kind: LoreCardKind
  provider: Provider
  apiKey: string
  model: string
}): Promise<ExtractLoreResult> {
  const { novelId, kind, provider, apiKey, model } = options
  const cards = localRepository.listLoreCards(novelId).filter((c) => c.kind === kind)
  if (!cards.length) {
    throw new Error(kind === 'character' ? '暂无人物卡' : '暂无道具卡')
  }

  const kindLabel = kind === 'character' ? '人物卡' : '道具卡'
  const allOps: LoreCardOp[] = []
  const rawParts: string[] = []
  const idSet = new Set(cards.map((c) => c.id))

  for (let i = 0; i < cards.length; i += COMPACT_BATCH_SIZE) {
    const batch = cards.slice(i, i + COMPACT_BATCH_SIZE)
    const user = [
      `本轮只精简 kind=${kind} 的${kindLabel}。`,
      '每张卡 action=update，id 必须与下面一致。不要输出 stateContent（时间线保持原样）。',
      '',
      '【待精简设定卡】',
      formatCardsForCompact(batch),
    ].join('\n')

    const raw = await chatCompletion({
      provider,
      apiKey,
      model,
      thinkingEffort: 'off',
      timeoutMs: 120000,
      messages: [
        { role: 'system', content: COMPACT_SYSTEM },
        { role: 'user', content: user },
      ],
    })
    rawParts.push(raw)

    let ops: LoreCardOp[]
    try {
      ops = parseOps(raw)
    } catch {
      throw new Error('AI 返回无法解析为精简 JSON')
    }

    for (const op of ops) {
      if (op.action !== 'update' || !op.id || !idSet.has(op.id)) continue
      if (op.kind !== kind) continue
      allOps.push({
        ...op,
        action: 'update',
        kind,
        stateContent: undefined,
        stateFromOrder: undefined,
        stateLabel: undefined,
      })
    }
  }

  const seen = new Set<string>()
  const deduped = allOps.filter((op) => {
    if (!op.id || seen.has(op.id)) return false
    seen.add(op.id)
    return true
  })

  return { ops: deduped, raw: rawParts.join('\n\n') }
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
