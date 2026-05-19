const KNOWN_BACKENDS = ['atlassian', 'firebase', 'teams', 'github', 'figma', 'miro'] as const
export type Backend = (typeof KNOWN_BACKENDS)[number]

const KEYWORDS: Record<Backend, string[]> = {
  firebase: ['crash', 'error', 'exception', 'analytics', 'performance', 'event', 'anr', 'stacktrace', 'firebase'],
  atlassian: ['issue', 'ticket', 'sprint', 'jira', 'confluence', 'page', 'project', 'task', 'bug', 'story', 'epic'],
  teams: ['message', 'channel', 'chat', 'teams', 'meeting', 'post', 'thread', '#'],
  github: ['pr', 'pull request', 'commit', 'repo', 'repository', 'branch', 'merge', 'release', 'workflow', 'action', 'github', 'gist', 'fork', 'star', 'review'],
  figma: ['figma', 'design', 'component', 'frame', 'layer', 'prototype', 'mockup', 'wireframe', 'style', 'asset', 'file', 'node'],
  miro: ['miro', 'whiteboard', 'sticky', 'brainstorm', 'mindmap', 'cluster', 'workshop', 'board', 'canvas'],
}

const score = (query: string, backend: Backend): number => {
  const lower = query.toLowerCase()
  return KEYWORDS[backend].reduce((n, kw) => n + (lower.includes(kw) ? 1 : 0), 0)
}

export const classify = (query: string): Backend[] => {
  const scored = KNOWN_BACKENDS
    .map(b => ({ b, s: score(query, b) }))
    .filter(({ s }) => s > 0)
    .sort((a, z) => z.s - a.s)
    .map(({ b }) => b)

  // no keyword match → try all backends in default order
  return scored.length > 0 ? scored : [...KNOWN_BACKENDS]
}
