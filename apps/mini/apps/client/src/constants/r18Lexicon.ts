/**
 * R18 正文用词。选了 R18 模板或勾了伪娘需求时注入 system。
 * 只作默认要求，按句子选词，不搞机械替换。
 */
export function buildR18LexiconInject(): string {
  return [
    '【粗俗用词】情色场面默认用口语脏词，直白、好读。按句子选词，不必每个器官都换成脏词。',
    '',
    '操干、插入、淫语里优先：鸡巴、穴、屁穴、操、插、顶、射。',
    '写外形、触感、分量时可以用：胸部、乳房、乳头、精液、腰、臀。',
    '假鸡巴就写假鸡巴。',
    '',
    '少用空指来躲：那根东西、那玩意、那里、性器、后庭、白浊、爱液。该点名就点名。',
    '写成：他鸡巴抵上她屁眼。精液从她腿根淌下来。他手覆上她胸部。',
    '淫语贴这个角色的嘴，该粗就粗，平时说话软的人不必突然满口脏话。',
  ].join('\n')
}

/** 模板 id 或名称带 R18 即视为成人向 */
export function isR18Template(idOrName: string | undefined | null): boolean {
  return !!idOrName && /r18/i.test(idOrName)
}
