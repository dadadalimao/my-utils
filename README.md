# my-utils

自用前端工具集合，支持以下功能：

## 目录

- [工具列表](#工具列表)
  - [🗺️ 地址解析工具](#-stringgetcityhtml)
  - [🖼️ SVG 转换工具](#-svg-pnghtml)
  - [📄 Word 文档转换器](#-wordtohtmlhtml)
  - [✍️ 富文本转换器](#-wordtorichhtml)
  - [📊 数组转 Excel 生成器](#-objarraytoexcelhtml)
  - [🖌️ 图片批量画布处理器](#-批量画布调整html)
- [使用说明](#使用说明)
- [注意事项](#注意事项)

## 工具列表

### 🗺️ stringGetCity.html

**地址解析工具**

- 功能：从中文地址字符串中提取省、市、区/县三级行政区划
- 特性：
  - 支持正则匹配省级（省/自治区/特别行政区）
  - 识别市级（市/自治州/地区/盟）
  - 匹配区县级（区/县/旗/市辖区/自治县/林区）
  - 自动处理重复信息，保留详细地址

### 🖼️ svg-png.html

**SVG 转换工具**

- 核心功能：
  - 实时预览 SVG 代码渲染效果
  - 支持拖放 SVG 文件/直接粘贴代码
  - PNG 导出（支持 1x/2x/3x 多倍图）
  - SVG 源码导出
- 技术特性：
  - 基于 Canvas 实现高清导出
  - 自动保持原始宽高比

### 📄 wordToHtml.html

**Word 文档转换器**

- 功能亮点：
  - 完整保留 Word 样式（表格/列表/标题等）
  - 生成独立 HTML 文件
  - 自动添加响应式样式
  - 支持.docx 文件拖放操作
- 样式映射：
  - 保留段落行高（1.5 倍）
  - 表格自动 100%宽度
  - 列表缩进与项目符号

### ✍️ wordToRich.html

**富文本转换器**

- 特色功能：
  - 集成 Quill 富文本编辑器
  - 实时预览转换结果
  - 支持二次编辑
  - 保留基础格式（加粗/斜体/下划线）
- 技术栈：
  - Mammoth.js 文档解析
  - Quill 编辑器集成

### 📊 objArrayToExcel.html

**数组转 Excel 生成器**

- 核心功能：
  - 将 JSON 格式对象数组转换为 Excel 文件
  - 自动提取对象键作为表头
  - 支持数组类型值的智能处理（自动用"、"连接）
  - 一键导出.xlsx 格式文件
- 技术特性：
  - 基于 SheetJS 库实现
  - 纯前端处理，无需服务器
  - 友好的错误提示
  - 支持复杂数据结构

### 🖌️ 批量画布调整.html

**图片批量画布处理器**

- 核心功能：
  - 批量将图片置于指定尺寸画布中
  - 灵活的九宫格对齐方式（左上/居中/右下等）
  - 实时预览处理效果
  - 一键批量下载处理后图片
- 技术特性：
  - 支持拖放/点击选择多图片上传
  - 单图删除与一键清空功能
  - 自定义画布尺寸与输出文件名
  - 可调背景色预览功能
  - 基于 Canvas 绘制与 PNG 导出

## 使用说明

1. 直接双击打开对应 HTML 文件
2. 所有工具均无需后端服务，纯浏览器运行
3. 推荐使用 Chrome/Edge 等现代浏览器

## 注意事项

⚠️ 文件操作限制：

- Word 文件需为.docx 格式（2007+版本）
- SVG 文件需符合 XML 规范
- 地址解析工具暂不支持港澳台地区简称
