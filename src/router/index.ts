import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const NO_RESULTS: CallToolResult = {
  content: [{ type: 'text', text: 'No results found across connected services.' }],
  isError: false,
}

const hasContent = (result: CallToolResult): boolean =>
  !result.isError && result.content.length > 0

export interface SearchAllDeps {
  classify: (query: string) => Promise<string[]>
  callBackendSearch: (backend: string, query: string) => Promise<CallToolResult>
}

export const searchAll = async (query: string, deps: SearchAllDeps): Promise<CallToolResult> => {
  const backends = await deps.classify(query)

  for (const backend of backends) {
    try {
      const result = await deps.callBackendSearch(backend, query)
      if (hasContent(result)) return result
    } catch {
      // backend unavailable — try next
    }
  }

  return NO_RESULTS
}
