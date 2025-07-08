// 增加styleMap，支持段落居中等样式
const styleMap = [
  "p[style-name='Normal'] => p:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
  "p[style-name='List Paragraph'] => p:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "p[style-name='Code'] => pre:fresh",
  "p[style-name='Table'] => table:fresh",
  "p[style-name='Table Header'] => th:fresh",
  "p[style-name='Table Cell'] => td:fresh",
  "p[style-name='居中'] => p.ql-align-center:fresh",
  "p[style-name='Centered'] => p.ql-align-center:fresh",
  "p[style-name='center'] => p.ql-align-center:fresh",
  "p[style-name='Center'] => p.ql-align-center:fresh"
];
let docTitle = "";
const options = {
  styleMap,
  transformDocument: function (element) {
    console.log("🚀 ~ element:", element)
    // 打印完整的文档结构
    if (element.type === "document") {
      let foundFirstBold = false;  // 添加标志来追踪是否找到第一个加粗文本

      // 遍历所有子元素
      element.children = element.children.map(child => {
        // 处理段落元素
        if (child.type === "paragraph") {
          // 检查是否是第一个加粗的段落
          if (!foundFirstBold && child.children) {
            // 找到第一个加粗的run
            const boldRun = child.children.find(run => run.isBold);
            if (boldRun && !foundFirstBold) {
              foundFirstBold = true;
              // 在run的children中找text节点
              const textNode = boldRun.children?.find(c => c.type === "text");
              docTitle = textNode?.value || "";
              console.log("🚀 ~ 找到标题:", docTitle);
            }
          }

          // 处理对齐方式
          if (child.alignment) {
            if (child.alignment === "center") {
              child.styleName = "居中";
            } else if (child.alignment === "right") {
              child.styleName = "右对齐";
            } else if (child.alignment === "justify") {
              child.styleName = "两端对齐";
            }
          }

          // 处理缩进
          if (child.indent && child.indent.firstLine) {
            // 将缩进值转换为样式
            const indentValue = parseInt(child.indent.firstLine) / 20; // 转换为em单位
            child.styleName = `缩进${indentValue}em`;
          }

          // 处理子元素（run）的格式
          if (child.children) {
            child.children = child.children.map(run => {
              if (run.type === "run") {
                // 根据格式设置类名
                const classes = [];
                if (run.isBold) classes.push("ql-bold");
                if (run.isItalic) classes.push("ql-italic");
                if (run.isUnderline) classes.push("ql-underline");
                if (run.isStrikethrough) classes.push("ql-strike");
                if (classes.length > 0) {
                  run.styleName = classes.join(" ");
                }
              }
              return run;
            });
          }
        }
        return child;
      });
      console.log("🚀 ~ docTitle:", docTitle)
    }

    return element;
  }
};
