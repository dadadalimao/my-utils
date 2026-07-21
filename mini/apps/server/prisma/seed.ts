import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATES = [
  {
    mode: 'chapter',
    name: '默认章节生成',
    content:
      '你是一位小说作者助手。根据用户需求和提供的章节大纲上下文，撰写连贯、可读的正文章节。只输出正文，不要解释。',
  },
  {
    mode: 'outline',
    name: '默认大纲生成',
    content:
      '你是一位小说策划助手。根据用户需求生成或细化章节大纲。优先输出结构化要点（摘要 + 情节点），便于后续写作。',
  },
  {
    mode: 'advice',
    name: '默认写作建议',
    content:
      '你是一位小说编辑。基于用户描述与大纲上下文，给出剧情、节奏、文风方面的具体建议，条理清晰。',
  },
];

async function main() {
  for (const t of TEMPLATES) {
    const existing = await prisma.promptTemplate.findFirst({
      where: { mode: t.mode, name: t.name },
    });
    if (existing) {
      await prisma.promptTemplate.update({
        where: { id: existing.id },
        data: { content: t.content, enabled: true },
      });
    } else {
      await prisma.promptTemplate.create({ data: t });
    }
  }
  console.log('prompt templates seeded');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
