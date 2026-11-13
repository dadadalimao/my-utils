import * as fs from 'fs/promises';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';

export interface ParsedChapter {
  order: number;
  title: string;
  content?: string;
  outline?: {
    summary: string;
    beats: string[];
    characterStates: string[];
    hangingThreads: string[];
    notes: string;
  };
}

export interface ParsedLore {
  kind: 'character' | 'item';
  name: string;
  keywords: string[];
  core: string;
  states: { fromOrder: number; label?: string; content: string }[];
}

export interface ParsedLibrary {
  title: string;
  keywords: string[];
  sourceUrl?: string;
  content: string;
}

export interface ParsedBook {
  title?: string;
  writingMode?: 'light' | 'long';
  genre?: string;
  targetWords?: number;
  intro?: string;
  bible?: string;
  bookOutline?: string;
  chapters: ParsedChapter[];
  loreCards: ParsedLore[];
  libraryEntries: ParsedLibrary[];
}

/** 去掉导出时加的一级标题，正文里原有的标题保留。 */
export function splitExportHeading(md: string): { heading: string; body: string } {
  const text = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = text.match(/^# ([^\n]*)\n([\s\S]*)$/);
  if (!match) return { heading: '', body: text.replace(/\n+$/, '') };
  let body = match[2];
  if (body.startsWith('\n')) body = body.slice(1);
  return { heading: match[1].trim(), body: body.replace(/\n+$/, '') };
}

function h2Sections(body: string): Map<string, string> {
  const parts = body.split(/^## /m);
  const map = new Map<string, string>();
  for (let i = 1; i < parts.length; i += 1) {
    const chunk = parts[i];
    const nl = chunk.indexOf('\n');
    const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const content = (nl === -1 ? '' : chunk.slice(nl + 1)).trim();
    map.set(title, content);
  }
  return map;
}

function bullets(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function titleFromHeading(order: number, heading: string): string {
  const matched = heading.match(/^第\s*\d+\s*章(?:\s+([\s\S]+))?$/);
  if (!matched) return heading.trim() || `第${order}章`;
  const rest = (matched[1] || '').trim();
  return rest || heading.trim() || `第${order}章`;
}

function orderFromFilename(filename: string): number | null {
  const matched = filename.match(/^第(\d+)章(?:-.*)?\.md$/);
  if (!matched) return null;
  return Number(matched[1]);
}

async function readUtf8(file: string): Promise<string> {
  return fs.readFile(file, 'utf8');
}

async function listMd(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names.filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw error;
  }
}

function parseOutline(md: string): ParsedChapter['outline'] {
  const { body } = splitExportHeading(md);
  const sections = h2Sections(body);
  return {
    summary: sections.get('摘要') || '',
    beats: bullets(sections.get('本章事件') || ''),
    characterStates: bullets(sections.get('人物状态') || ''),
    hangingThreads: bullets(sections.get('未收束线') || ''),
    notes: sections.get('备注') || '',
  };
}

function parseLore(md: string, kind: 'character' | 'item'): ParsedLore {
  const { heading, body } = splitExportHeading(md);
  const sections = h2Sections(body);
  const keywordsLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('- 关键词：'));
  const keywords = keywordsLine
    ? keywordsLine
        .slice('- 关键词：'.length)
        .split('、')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const states: ParsedLore['states'] = [];
  const timeline = sections.get('时间线') || '';
  if (timeline) {
    const blocks = timeline.split(/^### /m).slice(1);
    for (const block of blocks) {
      const nl = block.indexOf('\n');
      const title = (nl === -1 ? block : block.slice(0, nl)).trim();
      const content = (nl === -1 ? '' : block.slice(nl + 1)).trim();
      const matched = title.match(/^自第(\d+)章起(?:\s*·\s*(.*))?$/);
      const fromOrder = matched ? Number(matched[1]) : 1;
      const label = matched?.[2]?.trim();
      states.push({
        fromOrder,
        ...(label ? { label } : {}),
        content,
      });
    }
  }
  return {
    kind,
    name: heading || '未命名',
    keywords,
    core: sections.get('本体') || '',
    states,
  };
}

function parseLibrary(md: string): ParsedLibrary {
  const { heading, body } = splitExportHeading(md);
  const lines = body.split('\n');
  const keywords: string[] = [];
  let sourceUrl: string | undefined;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      break;
    }
    if (line.startsWith('- 关键词：')) {
      keywords.push(
        ...line
          .slice('- 关键词：'.length)
          .split('、')
          .map((item) => item.trim())
          .filter(Boolean),
      );
      index += 1;
      continue;
    }
    if (line.startsWith('- 来源：')) {
      const url = line.slice('- 来源：'.length).trim();
      if (url) sourceUrl = url;
      index += 1;
      continue;
    }
    break;
  }
  return {
    title: heading || '未命名',
    keywords,
    sourceUrl,
    content: lines.slice(index).join('\n').trim(),
  };
}

function parseBookMeta(md: string, book: ParsedBook) {
  const { heading, body } = splitExportHeading(md);
  if (heading) book.title = heading;
  const introAt = body.search(/^## 简介\s*$/m);
  const head = introAt >= 0 ? body.slice(0, introAt) : body.split(/^## /m)[0];
  for (const raw of head.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('- 写作模式：')) {
      const mode = line.slice('- 写作模式：'.length).trim();
      if (mode === '长篇') book.writingMode = 'long';
      if (mode === '轻量') book.writingMode = 'light';
    } else if (line.startsWith('- 类型：')) {
      book.genre = line.slice('- 类型：'.length).trim();
    } else if (line.startsWith('- 预计字数：')) {
      const words = Number(line.slice('- 预计字数：'.length).trim());
      if (Number.isFinite(words)) book.targetWords = Math.floor(words);
    }
  }
  const sections = h2Sections(body);
  if (sections.has('简介')) book.intro = sections.get('简介') || '';
}

/**
 * 读取一本书的导出目录，还原成可写回快照的结构。
 * 只认导出时使用的固定相对路径，忽略目录外文件。
 */
export async function parseExportDir(dir: string): Promise<ParsedBook> {
  const book: ParsedBook = { chapters: [], loreCards: [], libraryEntries: [] };
  const byOrder = new Map<number, ParsedChapter>();

  const bookFile = path.join(dir, '书籍.md');
  try {
    parseBookMeta(await readUtf8(bookFile), book);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const bibleFile = path.join(dir, '设定', '本书设定.md');
  try {
    book.bible = splitExportHeading(await readUtf8(bibleFile)).body;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const outlineDir = path.join(dir, '大纲');
  for (const name of await listMd(outlineDir)) {
    const full = path.join(outlineDir, name);
    if (name === '全书大纲.md') {
      book.bookOutline = splitExportHeading(await readUtf8(full)).body;
      continue;
    }
    const order = orderFromFilename(name);
    if (order == null) continue;
    const chapter = byOrder.get(order) || { order, title: titleFromHeading(order, '') };
    chapter.outline = parseOutline(await readUtf8(full));
    byOrder.set(order, chapter);
  }

  const contentDir = path.join(dir, '正文');
  for (const name of await listMd(contentDir)) {
    const order = orderFromFilename(name);
    if (order == null) continue;
    if (byOrder.has(order) && byOrder.get(order)?.content !== undefined) {
      throw new BadRequestException(`正文章序重复：第${order}章`);
    }
    const { heading, body } = splitExportHeading(await readUtf8(path.join(contentDir, name)));
    const chapter = byOrder.get(order) || { order, title: '' };
    chapter.title = titleFromHeading(order, heading);
    chapter.content = body;
    byOrder.set(order, chapter);
  }

  book.chapters = [...byOrder.values()].sort((a, b) => a.order - b.order);

  for (const [folder, kind] of [
    ['人物', 'character'],
    ['道具', 'item'],
  ] as const) {
    const loreDir = path.join(dir, '设定卡', folder);
    for (const name of await listMd(loreDir)) {
      book.loreCards.push(parseLore(await readUtf8(path.join(loreDir, name)), kind));
    }
  }

  const libraryDir = path.join(dir, '资料库');
  for (const name of await listMd(libraryDir)) {
    book.libraryEntries.push(parseLibrary(await readUtf8(path.join(libraryDir, name))));
  }

  return book;
}
