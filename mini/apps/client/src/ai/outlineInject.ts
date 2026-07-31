import { localRepository } from '@/repository/localRepository'
import type { OutlineRange } from '@/types'
import type { ChatCompletionMessage } from './client'

/** 上一章结尾注入字数（从章末往前截） */
const PREV_ENDING_CHARS = 1200

/** 本次生成锚定的写作目标章 */
export interface WritingTarget {
  order: number
  title: string
  /** 展示用，如「第9章 xxx」或「第9章（新建，尚未落库）」 */
  label: string
  /** new=未选章将新建；empty=已选空章；existing=已有正文 */
  kind: 'new' | 'empty' | 'existing'
}

/**
 * 解析本次应对准的写作目标章。
 * 无当前章时视为接在已有最后一章之后新建。
 */
export function resolveWritingTarget(
  novelId: string,
  currentChapterId?: string | null,
): WritingTarget {
  const chapters = localRepository.listChapters(novelId)
  const current = currentChapterId
    ? chapters.find((c) => c.id === currentChapterId)
    : undefined
  if (current) {
    const empty = !current.content?.trim()
    return {
      order: current.order,
      title: current.title,
      label: `第${current.order}章 ${current.title || '（无标题）'}`,
      kind: empty ? 'empty' : 'existing',
    }
  }
  const nextOrder = chapters.length ? chapters[chapters.length - 1].order + 1 : 1
  return {
    order: nextOrder,
    title: '',
    label: `第${nextOrder}章（新建，尚未落库）`,
    kind: 'new',
  }
}

/**
 * 写作目标 system 文案（硬约束锚定本章，防写串上一章）。
 * 修订模式下无论空章/新建，都以底稿为准改本章，勿改成「从零新写」。
 */
export function buildWritingTargetMessage(
  target: WritingTarget,
  options?: { revise?: boolean; draftSource?: 'lastReply' | 'chapter' | 'none' },
): string {
  const revise = !!options?.revise
  let status: string
  if (revise) {
    const draftHint =
      options?.draftSource === 'lastReply'
        ? '底稿来自「最近生成」（通常即本章上一版 AI 正文）'
        : options?.draftSource === 'chapter'
          ? '底稿来自「当前章已保存正文」'
          : '请严格按所附底稿修订'
    status = [
      '当前为修订模式：只修订【底稿】对应的本章正文，输出修订后的完整本章。',
      draftHint + '。',
      '不要抛开底稿去重写上一章，也不要把上一章结尾续写成另一章。',
    ].join('')
  } else if (target.kind === 'new' || target.kind === 'empty') {
    status = '本章为新建/空章，请从零撰写本章正文。'
  } else {
    status = '本章已有正文，请按用户要求撰写或续写本章。'
  }
  return [
    `【本章写作目标】${target.label}`,
    status,
    '硬约束：只输出本章正文；禁止重写、扩写或复述上一章已有段落；上一章内容（含工具查阅结果）仅作衔接参考，不得以上一章正文为主体交差。',
  ].join('\n')
}

/**
 * 将选定范围大纲注入为 system 上下文。
 * continuity：前文摘要 + 上一章完整大纲 + 上一章结尾正文。
 */
export function buildOutlineContextMessage(
  novelId: string,
  range: OutlineRange,
  preferSummaryOnly = false,
): ChatCompletionMessage | null {
  if (range.type === 'continuity') {
    return buildContinuityContextMessage(novelId, range.currentChapterId)
  }
  const items = localRepository.getOutlines(novelId, range)
  if (!items.length) return null
  const text = localRepository.serializeOutlines(items, preferSummaryOnly)
  return {
    role: 'system',
    content: `以下是当前小说的相关章节大纲（仅大纲，无正文），请结合其保持连贯：\n\n${text}`,
  }
}

/**
 * 衔接模式：前文各章摘要（含未收束线）+ 上一章完整大纲 + 上一章结尾正文。
 * 以「当前章」为锚点；无当前章时视为接在已有最后一章之后。
 */
export function buildContinuityContextMessage(
  novelId: string,
  currentChapterId?: string | null,
): ChatCompletionMessage | null {
  const chapters = localRepository.listChapters(novelId)
  if (!chapters.length) return null

  const target = resolveWritingTarget(novelId, currentChapterId)
  const previous = [...chapters].reverse().find((c) => c.order < target.order)
  if (!previous) return null

  const earlier = chapters.filter((c) => c.order < previous.order)
  const parts: string[] = [
    `写作衔接上下文（目标章：${target.label}）：下列均为前文/上一章参考，不是本章正文。请保持人物状态、时间线与未收束伏笔一致，勿无故改设或跳过关键因果。`,
    `最终只输出「${target.label}」的正文；禁止重写或扩写上一章已有内容。`,
  ]

  if (earlier.length) {
    parts.push('【前文摘要】')
    parts.push(
      localRepository.serializeOutlines(
        earlier.map((c) => ({ order: c.order, title: c.title, outline: c.outline })),
        true,
      ),
    )
  }

  parts.push('【上一章完整大纲（仅参考，非本章）】')
  parts.push(
    localRepository.serializeOutlines(
      [{ order: previous.order, title: previous.title, outline: previous.outline }],
      false,
    ),
  )

  const ending = previous.content?.trim()
  if (ending) {
    const snippet =
      ending.length > PREV_ENDING_CHARS ? ending.slice(-PREV_ENDING_CHARS) : ending
    parts.push(
      `【上一章结尾参考（第${previous.order}章末尾约 ${Math.min(PREV_ENDING_CHARS, ending.length)} 字；仅供衔接，勿复述）】`,
    )
    parts.push(
      `请从上一章结束处之后开启「${target.label}」的情节，勿重复上一章已写内容。`,
    )
    parts.push(snippet)
  }

  return { role: 'system', content: parts.join('\n\n') }
}
