/** 把终态 finish 原因翻译成调用失败；label 进错误消息，区分是哪条调用失败。 */
export function finishError(finish, label) {
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
            return new Error(`diary: ${label}输出达到 maxTokens 上限`);
        case 'tool-calls':
            return new Error('diary: 模型意外请求了工具调用');
        default:
            return new Error(`diary: 不支持的 finish reason "${String(finish.kind)}"`);
    }
}
/** 拼接一条消息里的全部文本块（其余块类型本插件不消费）。 */
export function textBlocksContent(blocks) {
    return blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
}
