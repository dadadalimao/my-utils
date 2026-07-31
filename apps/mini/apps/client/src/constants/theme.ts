/**
 * 主题色 JS 常量（组件属性无法使用 CSS 变量时使用，如 switch color）。
 * 须与 styles/theme.scss 保持一致。
 */
export const THEME = {
  bg: '#f7f4ef',
  surface: '#ffffff',
  surfaceMuted: '#f0ebe3',
  text: '#1c1917',
  textMuted: '#78716c',
  primary: '#1c1917',
  primaryContrast: '#ffffff',
  accent: '#b45309',
  accentSoft: '#fef3c7',
  danger: '#b91c1c',
  warning: '#d97706',
  aiPrompt: '#f5e6d3',
  aiOutput: '#fff7ed',
  chatUser: '#ebe4d8',
  chatAssistant: '#fffcf7',
  mask: 'rgba(28, 25, 23, 0.45)',
} as const

/** switch / 原生控件强调色 */
export const THEME_CONTROL_COLOR = THEME.accent
