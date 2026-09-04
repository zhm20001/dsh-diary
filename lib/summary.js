import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm';
const SYSTEM_PROMPT = [
    '你是用户的私人日记总结助手。基于给出的当天日记全文，严格按以下契约输出，除此之外不要输出任何内容——不要代码围栏、不要寒暄、不要复述契约：',
    '',
    '【今日关键词】2-4 个字的当天核心主题',
    '【一句话总结】一句话概括当天的主要事件或状态变化',
    '【当日 emoji】恰好一枚 emoji，概括今天的整体状态（只输出 emoji 本身，不要文字）',
    '【评注】',
    '有深度的总结性评注（可多行）：今日主题或亮点、情感与思考、建议或反思。必须基于完整原文而非片段；给真实见解，不说客套话。【评注】标记后必须先换行再写正文。',
].join('\n');
/** 从【当日 emoji】行提取恰好一枚 emoji（ZWJ 序列整枚保留）；没有则 undefined。 */
export function parseEmoji(raw) {
    const m = /\p{Extended_Pictographic}(?:\uFE0F|(?:\u200D\p{Extended_Pictographic})+)*/u.exec(raw);
    return m === null ? undefined : m[0];
}
/** 把终态 finish 原因翻译成调用失败（语义同 mytool integrate 的 finishError）。 */
function finishError(finish) {
    switch (finish.kind) {
        case 'stop':
            return undefined;
        case 'error':
        case 'aborted': {
            const error = new Error(finish.failure.message);
            error.code = finish.failure.code;
            return error;
        }
        case 'max-tokens':
            return new Error('diary: 总结输出达到 maxTokens 上限');
        case 'tool-calls':
            return new Error('diary: 模型意外请求了工具调用');
        default:
            return new Error(`diary: 不支持的 finish reason "${String(finish.kind)}"`);
    }
}
function textBlocksContent(blocks) {
    return blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
}
/** 解析模型输出；三段评注字段缺失直接抛错（错误消息带原始输出前缀，便于 UI 提示排查）。
 *  【当日 emoji】为尽力而为：字段缺失或行内没有 emoji 都只是缺省，不抛错。 */
export function parseSummary(raw) {
    const kw = /^【今日关键词】[ \t]*(.+?)[ \t]*$/m.exec(raw);
    const ol = /^【一句话总结】[ \t]*(.+?)[ \t]*$/m.exec(raw);
    // 容忍模型把正文直接写在【评注】同一行而不换行：同行捕获 + s 标志跨行
    const body = /^【评注】[ \t]*(.*)$/ms.exec(raw);
    if (kw === null || ol === null || body === null) {
        const missing = [kw === null ? '【今日关键词】' : null, ol === null ? '【一句话总结】' : null, body === null ? '【评注】' : null]
            .filter((s) => s !== null)
            .join('、');
        throw new Error(`diary: 模型输出缺少字段 ${missing}（原始输出前 120 字：${raw.slice(0, 120)}）`);
    }
    const em = /^【当日 emoji】[ \t]*(.+?)[ \t]*$/m.exec(raw);
    // trimStart：宽容正则会把【评注】后的引导换行一并捕获进来，剥掉它
    return { keyword: kw[1], oneLine: ol[1], comment: body[1].trimStart(), emoji: em === null ? undefined : parseEmoji(em[1]) };
}
/** 执行一次完整总结调用。失败在返回前抛出；本函数无任何磁盘副作用。 */
export async function runSummary(ctx, cfg, diaryText) {
    const messages = [
        createUserMessage({
            content: [{ type: 'text', text: `今天的日记全文如下：\n\n${diaryText}\n\n请按契约输出总结。` }],
            source: { kind: 'plugin', plugin: 'dsh-diary' },
        }),
    ];
    const options = deepFreeze({
        provider: cfg.provider,
        model: cfg.model,
        temperature: cfg.temperature,
        messages,
        system: SYSTEM_PROMPT,
        signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const assembler = new BlockAssembler();
    for await (const chunk of ctx.llm.stream(options)) {
        assembler.push(chunk);
    }
    const terminalError = finishError(assembler.finish);
    if (terminalError !== undefined)
        throw terminalError;
    return parseSummary(textBlocksContent(assembler.blocks()));
}
