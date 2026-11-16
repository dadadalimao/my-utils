/** 导出用的松散快照结构，只读取书籍内容，不读 settings。 */
export interface ExportNovel {
  id?: string
  title?: string
  updatedAt?: string
  chapterIds?: string[]
  meta?: {
    intro?: string
    genre?: string
    bible?: string
    writingMode?: string
    bookOutline?: string
    targetWords?: number
  }
}

export interface ExportOutline {
  summary?: string
  beats?: string[]
  characterStates?: string[]
  hangingThreads?: string[]
  notes?: string
  source?: string
  updatedAt?: string
}

export interface ExportChapter {
  id?: string
  novelId?: string
  title?: string
  order?: number
  content?: string
  outline?: ExportOutline
  updatedAt?: string
}

export interface ExportLoreState {
  id?: string
  fromOrder?: number
  label?: string
  content?: string
  updatedAt?: string
}

export interface ExportLoreCard {
  id?: string
  novelId?: string
  kind?: string
  name?: string
  keywords?: string[]
  content?: string
  core?: string
  states?: ExportLoreState[]
  updatedAt?: string
}

export interface ExportLibraryEntry {
  id?: string
  novelId?: string
  title?: string
  content?: string
  sourceUrl?: string
  keywords?: string[]
  updatedAt?: string
}

export interface ExportFile {
  /** 相对导出目录，使用 / 分隔 */
  rel: string
  body: string
}

/** Windows 文件名非法字符换成空格，并限制长度。 */
export function safeFileStem(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  return (cleaned || '未命名').slice(0, 80)
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

function section(title: string, body: string): string {
  if (!body) return ''
  return `## ${title}\n\n${body}\n`
}

function bulletSection(title: string, items: string[]): string {
  if (!items.length) return ''
  return `## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}\n`
}

/** 同一目录内重名时追加序号。 */
function uniqueRel(used: Set<string>, rel: string): string {
  if (!used.has(rel)) {
    used.add(rel)
    return rel
  }
  const slash = rel.lastIndexOf('/')
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : ''
  const file = slash >= 0 ? rel.slice(slash + 1) : rel
  const dot = file.lastIndexOf('.')
  const stem = dot >= 0 ? file.slice(0, dot) : file
  const ext = dot >= 0 ? file.slice(dot) : ''
  let n = 2
  let next = `${dir}${stem}-${n}${ext}`
  while (used.has(next)) {
    n += 1
    next = `${dir}${stem}-${n}${ext}`
  }
  used.add(next)
  return next
}

function chapterLabel(order: number, title: string): { heading: string; stem: string } {
  const name = title.trim() || '未命名'
  if (/^第\s*\d+\s*章/.test(name)) {
    return { heading: name, stem: safeFileStem(name) }
  }
  return {
    heading: `第${order}章 ${name}`,
    stem: safeFileStem(`第${order}章-${name}`),
  }
}

function outlineBody(outline: ExportOutline | undefined): string {
  if (!outline) return ''
  return [
    section('摘要', textOf(outline.summary)),
    bulletSection('本章事件', asStringList(outline.beats)),
    bulletSection('人物状态', asStringList(outline.characterStates)),
    bulletSection('未收束线', asStringList(outline.hangingThreads)),
    section('备注', textOf(outline.notes)),
  ]
    .filter(Boolean)
    .join('\n')
}

function loreBody(card: ExportLoreCard): string {
  const kind = card.kind === 'item' ? '道具' : '人物'
  const keywords = asStringList(card.keywords)
  const core = textOf(card.core) || textOf(card.content)
  const states = Array.isArray(card.states) ? card.states : []
  const stateBlocks = states
    .map((state) => {
      const content = textOf(state.content)
      if (!content) return ''
      const order = Number(state.fromOrder)
      const orderText = Number.isFinite(order) ? `自第${Math.floor(order)}章起` : '阶段'
      const label = textOf(state.label)
      return `### ${orderText}${label ? ` · ${label}` : ''}\n\n${content}\n`
    })
    .filter(Boolean)
    .join('\n')
  return [
    `- 类型：${kind}`,
    keywords.length ? `- 关键词：${keywords.join('、')}` : '',
    '',
    section('本体', core).trimEnd(),
    stateBlocks ? `## 时间线\n\n${stateBlocks.trim()}\n` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .trim()
    .concat('\n')
}

/**
 * 把一本书拆成 Markdown 文件。
 * 书籍信息、正文、章纲、设定卡、资料库各自成文；不含账号设置。
 */
export function buildNovelMarkdown(input: {
  novel: ExportNovel
  chapters: ExportChapter[]
  loreCards: ExportLoreCard[]
  libraryEntries: ExportLibraryEntry[]
}): ExportFile[] {
  const used = new Set<string>()
  const files: ExportFile[] = []
  const push = (rel: string, body: string) => {
    const finalRel = uniqueRel(used, rel)
    files.push({ rel: finalRel, body: body.endsWith('\n') ? body : `${body}\n` })
    return finalRel
  }

  const title = textOf(input.novel.title) || '未命名'
  const meta = input.novel.meta || {}
  const mode = meta.writingMode === 'long' ? '长篇' : '轻量'
  const chapters = [...input.chapters].sort(
    (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0),
  )

  const links: string[] = []
  const bible = textOf(meta.bible)
  const bookOutline = textOf(meta.bookOutline)
  if (bible) {
    const rel = push('设定/本书设定.md', `# 本书设定\n\n${bible}\n`)
    links.push(`- [本书设定](${rel})`)
  }
  if (bookOutline) {
    const rel = push('大纲/全书大纲.md', `# 全书大纲\n\n${bookOutline}\n`)
    links.push(`- [全书大纲](${rel})`)
  }

  for (const chapter of chapters) {
    const order = Number(chapter.order) || 0
    const { heading, stem } = chapterLabel(order, textOf(chapter.title))
    const contentRel = push(`正文/${stem}.md`, `# ${heading}\n\n${textOf(chapter.content)}\n`)
    links.push(`- [${heading}](${contentRel})`)
    const outline = outlineBody(chapter.outline)
    if (outline) {
      push(`大纲/${stem}.md`, `# ${heading}\n\n${outline}`)
    }
  }

  const loreDir = (kind: string) => (kind === 'item' ? '设定卡/道具' : '设定卡/人物')
  for (const card of input.loreCards) {
    const name = textOf(card.name) || '未命名'
    const rel = push(
      `${loreDir(card.kind || '')}/${safeFileStem(name)}.md`,
      `# ${name}\n\n${loreBody(card)}`,
    )
    links.push(`- [${name}](${rel})`)
  }

  for (const entry of input.libraryEntries) {
    const name = textOf(entry.title) || '未命名'
    const keywords = asStringList(entry.keywords)
    const source = textOf(entry.sourceUrl)
    const head = [
      keywords.length ? `- 关键词：${keywords.join('、')}` : '',
      source ? `- 来源：${source}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const rel = push(
      `资料库/${safeFileStem(name)}.md`,
      [`# ${name}`, head, '', textOf(entry.content)].filter((part) => part !== '').join('\n').concat('\n'),
    )
    links.push(`- [${name}](${rel})`)
  }

  const intro = textOf(meta.intro)
  const genre = textOf(meta.genre)
  const words = Number(meta.targetWords)
  const metaLines = [
    `- 写作模式：${mode}`,
    genre ? `- 类型：${genre}` : '',
    Number.isFinite(words) && words > 0 ? `- 预计字数：${words}` : '',
    textOf(input.novel.updatedAt) ? `- 更新时间：${textOf(input.novel.updatedAt)}` : '',
    `- 章节：${chapters.length}`,
  ].filter(Boolean)
  const bookParts = [`# ${title}`, '', metaLines.join('\n'), '']
  const introSection = section('简介', intro).trim()
  if (introSection) bookParts.push(introSection, '')
  if (links.length) bookParts.push(`## 目录\n\n${links.join('\n')}`)
  const bookLines = `${bookParts.join('\n').trim()}\n`
  files.unshift({ rel: '书籍.md', body: bookLines })
  return files
}
