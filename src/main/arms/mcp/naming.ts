// MCP 도구 이름 정리: 모델에 보이는 도구 이름은 영문·숫자·_·- 만, 64자까지(Anthropic 규칙).

export const MAX_TOOL_NAME = 64
const SEP = '__'

const slug = (text: string): string => text.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')

/**
 * "<서버>__<도구>" 모양의 이름을 만든다. 서버 이름에 영문·숫자가 하나도 없으면(예: 한글) 서버 id 를 쓴다.
 * 64자를 넘으면 서버 쪽을 먼저 줄이고, 같은 서버 안에서 이름이 겹치면 _2, _3 … 을 붙인다.
 */
export function prefixedToolNames(serverName: string, serverId: string, toolNames: readonly string[]): string[] {
  let prefix = slug(serverName).slice(0, 24).replace(/_+$/, '')
  if (!/[a-zA-Z0-9]/.test(prefix)) prefix = serverId
  const used = new Set<string>()
  return toolNames.map((tool) => {
    const body = slug(tool) || 'tool'
    let name = `${prefix}${SEP}${body}`.slice(0, MAX_TOOL_NAME)
    for (let n = 2; used.has(name); n++) {
      const suffix = `_${n}`
      name = `${prefix}${SEP}${body}`.slice(0, MAX_TOOL_NAME - suffix.length) + suffix
    }
    used.add(name)
    return name
  })
}
