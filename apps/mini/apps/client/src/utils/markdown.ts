/**
 * Markdown → HTML（供 mp-html 渲染）。
 * 使用 mp-html 插件自带的 marked。
 */
// @ts-expect-error marked.min.js 无类型声明
import { marked } from './marked.min.js'

marked.setOptions({
  gfm: true,
  breaks: true,
})

export function markdownToHtml(src: string): string {
  if (!src) return ''
  try {
    const html = marked.parse(src)
    return typeof html === 'string' ? html : String(html)
  } catch {
    // 解析失败时按纯文本转义，避免白屏
    return src
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>')
  }
}
