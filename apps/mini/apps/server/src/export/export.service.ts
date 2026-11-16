import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildNovelMarkdown,
  type ExportChapter,
  type ExportLibraryEntry,
  type ExportLoreCard,
  type ExportNovel,
  safeFileStem,
} from './export.markdown';
import { parseExportDir } from './export.parse';

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按用户名和书名导出一本书。
   * 只写书籍内容的 Markdown，不包含账号设置和 API Key。
   * 同一本书重复导出会先清空该目录再重写。
   */
  async exportNovel(username: string, title: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new NotFoundException(`找不到用户：${username}`);
    }
    const snapshot = await this.prisma.userSnapshot.findUnique({
      where: { userId: user.id },
    });
    if (!snapshot) {
      throw new NotFoundException(`用户 ${username} 没有同步数据`);
    }

    const payload = JSON.parse(snapshot.payloadJson) as Record<string, unknown>;
    const novels = asArray<ExportNovel>(payload.novels);
    const matched = novels.filter((novel) => (novel.title || '').trim() === title);
    if (!matched.length) {
      throw new NotFoundException(`找不到书籍：${title}`);
    }
    if (matched.length > 1) {
      throw new NotFoundException(`书名重复，无法确定：${title}`);
    }
    const novel = matched[0];
    const novelId = novel.id || '';

    const files = buildNovelMarkdown({
      novel,
      chapters: asArray<ExportChapter>(payload.chapters).filter(
        (chapter) => chapter.novelId === novelId,
      ),
      loreCards: asArray<ExportLoreCard>(payload.loreCards).filter(
        (card) => card.novelId === novelId,
      ),
      libraryEntries: asArray<ExportLibraryEntry>(payload.libraryEntries).filter(
        (entry) => entry.novelId === novelId,
      ),
    });

    const dir = path.join(exportRoot(), safeFileStem(username), safeFileStem(title));
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    for (const file of files) {
      const target = path.join(dir, ...file.rel.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.body, 'utf8');
    }

    return {
      username,
      title,
      dir,
      fileCount: files.length,
      files: files.map((file) => file.rel),
    };
  }

  /**
   * 读取 exports 里该书的 Markdown，覆盖写回这本小说。
   * 不改其他书，也不动账号设置和 API Key。
   * 已有章节按章序合并，已有设定卡按名称合并；目录里多出来的会新建。
   */
  async uploadNovel(username: string, title: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new NotFoundException(`找不到用户：${username}`);
    }
    const snapshot = await this.prisma.userSnapshot.findUnique({
      where: { userId: user.id },
    });
    if (!snapshot) {
      throw new NotFoundException(`用户 ${username} 没有同步数据`);
    }

    const dir = path.join(exportRoot(), safeFileStem(username), safeFileStem(title));
    try {
      await fs.access(dir);
    } catch {
      throw new NotFoundException(`找不到导出目录：${dir}`);
    }
    const parsed = await parseExportDir(dir);

    const payload = JSON.parse(snapshot.payloadJson) as Record<string, unknown>;
    const novels = asArray<ExportNovel>(payload.novels);
    const matched = novels.filter((novel) => (novel.title || '').trim() === title);
    if (!matched.length) {
      throw new NotFoundException(`找不到书籍：${title}`);
    }
    if (matched.length > 1) {
      throw new NotFoundException(`书名重复，无法确定：${title}`);
    }
    const novel = matched[0];
    const novelId = novel.id || '';
    const now = new Date().toISOString();

    const meta = { ...(novel.meta || {}) };
    if (parsed.writingMode) meta.writingMode = parsed.writingMode;
    if (parsed.genre !== undefined) meta.genre = parsed.genre;
    if (parsed.targetWords !== undefined) meta.targetWords = parsed.targetWords;
    if (parsed.intro !== undefined) meta.intro = parsed.intro;
    if (parsed.bible !== undefined) meta.bible = parsed.bible;
    if (parsed.bookOutline !== undefined) meta.bookOutline = parsed.bookOutline;
    novel.meta = meta;
    novel.updatedAt = now;

    const chapters = asArray<ExportChapter>(payload.chapters);
    const chapterIds = Array.isArray(novel.chapterIds) ? [...novel.chapterIds] : [];
    let chaptersUpdated = 0;
    let chaptersCreated = 0;
    for (const fileChapter of parsed.chapters) {
      const current = chapters.find(
        (chapter) => chapter.novelId === novelId && Number(chapter.order) === fileChapter.order,
      );
      if (current) {
        if (fileChapter.content !== undefined) current.content = fileChapter.content;
        if (fileChapter.title) current.title = fileChapter.title;
        if (fileChapter.outline) {
          current.outline = { ...(current.outline || {}), ...fileChapter.outline, updatedAt: now };
        }
        current.updatedAt = now;
        chaptersUpdated += 1;
      } else if (fileChapter.content !== undefined) {
        const id = createId('ch_');
        chapters.push({
          id,
          novelId,
          title: fileChapter.title || `第${fileChapter.order}章`,
          order: fileChapter.order,
          content: fileChapter.content,
          outline: {
            summary: '',
            beats: [],
            characterStates: [],
            hangingThreads: [],
            notes: '',
            ...fileChapter.outline,
            updatedAt: now,
          },
          updatedAt: now,
        });
        if (!chapterIds.includes(id)) chapterIds.push(id);
        chaptersCreated += 1;
      }
    }
    novel.chapterIds = chapterIds;
    payload.chapters = chapters;

    const loreCards = asArray<ExportLoreCard>(payload.loreCards);
    let loreUpdated = 0;
    let loreCreated = 0;
    for (const fileCard of parsed.loreCards) {
      const current = loreCards.find(
        (card) =>
          card.novelId === novelId &&
          (card.kind === 'item' ? 'item' : 'character') === fileCard.kind &&
          (card.name || '').trim() === fileCard.name,
      );
      const states = fileCard.states.map((state) => ({
        id: createId('lst_'),
        fromOrder: state.fromOrder,
        ...(state.label ? { label: state.label } : {}),
        content: state.content,
        updatedAt: now,
      }));
      if (current) {
        current.keywords = fileCard.keywords.length ? fileCard.keywords : [fileCard.name];
        current.core = fileCard.core;
        current.content = fileCard.core;
        current.states = states;
        current.updatedAt = now;
        loreUpdated += 1;
      } else {
        loreCards.push({
          id: createId('lore_'),
          novelId,
          kind: fileCard.kind,
          name: fileCard.name,
          keywords: fileCard.keywords.length ? fileCard.keywords : [fileCard.name],
          content: fileCard.core,
          core: fileCard.core,
          states,
          updatedAt: now,
        });
        loreCreated += 1;
      }
    }
    payload.loreCards = loreCards;

    const libraryEntries = asArray<ExportLibraryEntry>(payload.libraryEntries);
    let libraryUpdated = 0;
    let libraryCreated = 0;
    for (const fileEntry of parsed.libraryEntries) {
      const current = libraryEntries.find(
        (entry) => entry.novelId === novelId && (entry.title || '').trim() === fileEntry.title,
      );
      if (current) {
        current.content = fileEntry.content;
        current.keywords = fileEntry.keywords;
        current.sourceUrl = fileEntry.sourceUrl;
        current.updatedAt = now;
        libraryUpdated += 1;
      } else {
        libraryEntries.push({
          id: createId('lib_'),
          novelId,
          title: fileEntry.title,
          content: fileEntry.content,
          keywords: fileEntry.keywords,
          sourceUrl: fileEntry.sourceUrl,
          updatedAt: now,
        });
        libraryCreated += 1;
      }
    }
    payload.libraryEntries = libraryEntries;

    await this.prisma.userSnapshot.update({
      where: { userId: user.id },
      data: { payloadJson: JSON.stringify(payload) },
    });

    return {
      username,
      title,
      dir,
      chaptersUpdated,
      chaptersCreated,
      loreUpdated,
      loreCreated,
      libraryUpdated,
      libraryCreated,
    };
  }
}

/** 导出目录固定在服务进程工作目录下的 exports。 */
function exportRoot(): string {
  return path.resolve(process.cwd(), 'exports');
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function createId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
