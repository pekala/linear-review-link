import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register, RenderSurface } from 'claude-code'

import type { Checks, LinkedIssue, PullRequest, ReviewThread } from '../types'

import { ICONS } from './icons'
import type { IconName } from './icons'

const pr = atom({ plugin: 'linear-review-link', key: 'pr' } as const, null)
const isHovered = atom({ plugin: 'linear-review-link', key: 'isHovered' } as const, false)
const menuEpoch = atom({ plugin: 'linear-review-link', key: 'menuEpoch' } as const, 0)

// The desktop app's PATH may not include Homebrew, so fall back to its usual paths.
const GH_PATHS = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']
const POLL_MS = 2 * 60_000

// Unresolved review threads (what the app's own PR row counts), and the comments the
// Linear integration's link-back is among.
const DETAILS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes { isResolved path comments(first: 1) { nodes { author { login } body } } }
      }
      comments(first: 100) { nodes { body } }
    }
  }
}`

// The Linear integration comments on each PR it links: one <details> per issue, the issue's
// link in its <summary>, its description (which may mention other issues) below.
const LINKBACK_MARK = '<!-- linear-linkback -->'
const SUMMARY = /<summary>([\s\S]*?)<\/summary>/g
const ISSUE_URL = /https:\/\/linear\.app\/[^/\s"]+\/issue\/([A-Z][A-Z0-9]*-\d+)[^\s"]*/

export function linkedIssues(commentBodies: readonly string[]): LinkedIssue[] {
  const issues = commentBodies
    .filter(body => body.includes(LINKBACK_MARK))
    .flatMap(body => [...body.matchAll(SUMMARY)].map(summary => summary[1] ?? ''))
    .flatMap(summary => {
      const match = summary.match(ISSUE_URL)
      if (match?.[1] === undefined) return []
      // The summary's link reads "ENG-123 Fix the thing": the issue's title follows its id.
      const text = summary.replace(/<[^>]*>/g, '').trim()
      const title = text.startsWith(match[1]) ? text.slice(match[1].length).trim() : text
      return [{ id: match[1], url: match[0], title }]
    })
  return issues.filter((issue, i) => issues.findIndex(other => other.id === issue.id) === i)
}

export function repoName(url: string): string | null {
  return url.match(/\/\/[^/]+\/[^/]+\/([^/]+)\/pull\//)?.[1] ?? null
}

export function toLinearReview(url: string): string {
  return url.replace(/^https:\/\/github\.com\//, 'https://linear.review/')
}

type CheckItem = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
}

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const PENDING = new Set(['PENDING', 'EXPECTED', ''])

export function summarizeChecks(items: readonly CheckItem[]): Checks | null {
  if (items.length === 0) return null
  const checks = { passed: 0, failing: 0, pending: 0, failingNames: [] as string[] }
  for (const item of items) {
    // A StatusContext has a state; a CheckRun has a conclusion once it completes.
    const result =
      item.__typename === 'StatusContext'
        ? (item.state ?? '')
        : item.status === 'COMPLETED'
          ? (item.conclusion ?? '')
          : 'PENDING'
    if (FAILED.has(result)) {
      checks.failing += 1
      checks.failingNames.push(item.name ?? item.context ?? 'Unnamed check')
    } else if (PENDING.has(result)) checks.pending += 1
    else checks.passed += 1
  }
  return checks
}

// Linear's palette.
const GREEN = '#4cb782'
const RED = '#eb5757'
const INDIGO = '#5e6ad2'
const MUTED = '#8a8f98'

// The theme's subtle background, light or dark: what user messages sit on.
const HOVER_BACKGROUND = 'userMessageBackground'

// The title's hover background, in px: room inside it on each side, its height, and the
// room outside it before the icon and the ref.
const TITLE_PADDING = 10
const TITLE_HEIGHT = 26
const TITLE_GAP = 5

// `color` is a theme key for text; `hex` is for the SVG, which can't read the theme.
type Look = { label: string; color: string; hex: string; icon: IconName }

const STATE_LOOKS = {
  open: { label: 'Open', color: 'success', hex: GREEN, icon: 'open' },
  draft: { label: 'Draft', color: 'inactive', hex: MUTED, icon: 'draft' },
  merged: { label: 'Merged', color: 'merged', hex: INDIGO, icon: 'merged' },
  closed: { label: 'Closed', color: 'error', hex: RED, icon: 'closed' },
} as const satisfies Record<string, Look>

export function stateLook({ state, isDraft }: PullRequest): Look {
  if (state === 'MERGED') return STATE_LOOKS.merged
  if (state === 'CLOSED') return STATE_LOOKS.closed
  return isDraft ? STATE_LOOKS.draft : STATE_LOOKS.open
}

// An icon `size` px tall with `gap` px of empty room on its right: spacing before the
// text beside it that is finer than a Box gap, which is a whole cell.
function iconSvg(name: IconName, hex: string, size: number, gap: number): { source: string; width: number } {
  const { viewBox, body } = ICONS[name]
  const [x = 0, y = 0, width = 16, height = 16] = viewBox.split(' ').map(Number)
  const extra = (gap * height) / size
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width + extra} ${height}" fill="${hex}">${body}</svg>`,
    width: (size * width) / height + gap,
  }
}

// Text drawn as an SVG in the system's monospace font: a Text has no font of its own, and a
// Code draws a background. `left` px of room come before it. Sized for SF Mono, whose
// characters are 0.6em wide.
const MONO_SIZE = 13

export function monoSvg(text: string, hex: string, left: number): { source: string; width: number; height: number } {
  const width = Math.ceil(left + text.length * MONO_SIZE * 0.6 + 1)
  const height = Math.ceil(MONO_SIZE * 1.4)
  const baseline = Math.round(MONO_SIZE * 1.05)
  return {
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
      `<text x="${left}" y="${baseline}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" ` +
      `font-size="${MONO_SIZE}" fill="${hex}">${escapeXml(text)}</text></svg>`,
    width,
    height,
  }
}

// Empty room of an exact size, finer than a Box's padding, which is a whole cell.
function spacerSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>'
}

async function runGh($: EngineInterface, args: readonly string[]): Promise<ProcessRunResult | null> {
  for (const gh of GH_PATHS) {
    try {
      return await $.process.run([gh, ...args])
    } catch {
      // gh is not at this path
    }
  }
  return null
}

type Details = { openThreads: number | null; threads: ReviewThread[]; issues: LinkedIssue[] }

type ThreadNode = {
  isResolved: boolean
  path: string | null
  comments: { nodes: { author: { login: string } | null; body: string }[] }
}

// A comment's markdown as one line of plain text: no HTML, images, link targets or emphasis.
export function plainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function unresolvedThreads(nodes: readonly ThreadNode[]): ReviewThread[] {
  return nodes
    .filter(thread => !thread.isResolved)
    .map(thread => {
      const [first] = thread.comments.nodes
      return { path: thread.path, author: first?.author?.login ?? null, excerpt: plainText(first?.body ?? '') }
    })
}

async function fetchDetails($: EngineInterface, url: string, number: number): Promise<Details> {
  const none = { openThreads: null, threads: [], issues: [] }
  const [, owner, name] = url.match(/github\.com\/([^/]+)\/([^/]+)\//) ?? []
  if (owner === undefined || name === undefined) return none
  const ran = await runGh($, [
    'api', 'graphql',
    '-f', `query=${DETAILS_QUERY}`,
    '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`,
  ])
  if (ran === null || ran.exitCode !== 0) return none
  try {
    const found = JSON.parse(ran.stdout).data.repository.pullRequest
    const threads = unresolvedThreads(found.reviewThreads.nodes)
    const comments: { body: string }[] = found.comments.nodes
    return {
      openThreads: threads.length,
      threads,
      issues: linkedIssues(comments.map(comment => comment.body)),
    }
  } catch {
    return none
  }
}

async function findPullRequest($: EngineInterface): Promise<PullRequest | null> {
  const ran = await runGh($, ['pr', 'view', '--json', 'number,title,state,isDraft,url,headRefName,statusCheckRollup'])
  if (ran === null || ran.exitCode !== 0) return null // no PR for this branch, or not a GitHub repo
  let found
  try {
    found = JSON.parse(ran.stdout)
  } catch {
    return null
  }
  const { number, title, state, isDraft, url, headRefName, statusCheckRollup } = found
  return {
    number,
    title,
    state,
    isDraft,
    url: toLinearReview(url),
    githubUrl: url,
    branch: headRefName,
    checks: summarizeChecks(statusCheckRollup ?? []),
    repo: repoName(url),
    ...(await fetchDetails($, url, number)),
  }
}

let isRefreshing = false

async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    const found = await findPullRequest($)
    await update($, pr, () => found)
  } finally {
    isRefreshing = false
  }
}

// Pages open with macOS `open`: a desktop Link can't wrap icons, and its styling is the
// surface's. Only these hosts are opened.
const OPENABLE = ['https://linear.review/', 'https://linear.app/', 'https://github.com/']

async function openInBrowser($: EngineInterface, url: string): Promise<void> {
  if (!OPENABLE.some(prefix => url.startsWith(prefix))) return
  await $.process.run(['open', url])
}

// What the "…" menu offers, in order. The desktop's Select always shows one option as chosen,
// so the first is a "…" that stands for none: the menu rests on it, and picking it does nothing.
const MENU_REST = '…'

export function menuOptions(current: PullRequest): { value: string; label: string }[] {
  return [
    { value: MENU_REST, label: '…' },
    { value: 'open-review', label: 'Open in Linear review' },
    ...current.issues.map(issue => ({ value: `open-issue:${issue.id}`, label: `Open ${issue.id} in Linear` })),
    { value: 'copy-review-link', label: 'Copy review link' },
    ...current.issues.map(issue => ({ value: `copy-issue:${issue.id}`, label: `Copy ${issue.id}` })),
    { value: 'copy-branch', label: 'Copy branch name' },
    { value: 'open-github', label: 'Open on GitHub' },
  ]
}

export function issueLabel(current: PullRequest): string {
  const [first] = current.issues
  if (first === undefined) return 'Linear'
  return current.issues.length > 1 ? `${first.id} +${current.issues.length - 1}` : first.id
}

const MAX_TOOLTIP_LINES = 8

function bullets(lines: readonly string[]): string[] {
  const shown = lines.slice(0, MAX_TOOLTIP_LINES).map(line => `• ${line}`)
  return lines.length > MAX_TOOLTIP_LINES ? [...shown, `+${lines.length - MAX_TOOLTIP_LINES} more`] : shown
}

export function checksTooltip(checks: Checks): string {
  const heading = checks.failing === 1 ? '1 failing check' : `${checks.failing} failing checks`
  const others = [`${checks.passed} passed`, ...(checks.pending > 0 ? [`${checks.pending} pending`] : [])].join(', ')
  return [heading, ...bullets(checks.failingNames), others].join('\n')
}

export function threadsTooltip(threads: readonly ReviewThread[]): string {
  const heading = threads.length === 1 ? '1 unresolved review thread' : `${threads.length} unresolved review threads`
  const lines = threads.map(({ path, author, excerpt }) => {
    const where = path ?? 'Conversation'
    const short = excerpt.length > 60 ? `${excerpt.slice(0, 59)}…` : excerpt
    return `${where}${author === null ? '' : ` · @${author}`}${short === '' ? '' : `: ${short}`}`
  })
  return [heading, ...bullets(lines)].join('\n')
}

export function issuesTooltip(issues: readonly LinkedIssue[]): string {
  if (issues.length === 0) return 'Opens in Linear'
  return [issues.length === 1 ? 'Linked issue' : 'Linked issues', ...bullets(issues.map(i => `${i.id} ${i.title}`))].join('\n')
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
}

// An icon whose hover shows `tooltip`: the SVG's own <title>, which only an interactive
// Svg (a sandboxed frame) shows.
function tooltipSvg(name: IconName, hex: string, size: number, gap: number, tooltip: string) {
  const { source, width } = iconSvg(name, hex, size, gap)
  const titled = source.replace('>', `><title>${escapeXml(tooltip)}</title>`)
  return { source: titled, width }
}

async function runMenuAction($: EngineInterface, action: string, surface: RenderSurface): Promise<void> {
  const current = await read($, pr)
  // A new epoch draws the menu again, resting on "…".
  await update($, menuEpoch, n => n + 1)
  if (current === null) return
  const issue = current.issues.find(({ id }) => action.endsWith(`:${id}`))
  if (action === 'open-review') await openInBrowser($, current.url)
  if (action === 'open-github') await openInBrowser($, current.githubUrl)
  if (action === 'copy-review-link') await $.ui.copy({ text: current.url, surface })
  if (action === 'copy-branch') await $.ui.copy({ text: current.branch, surface })
  if (issue !== undefined && action.startsWith('open-issue:')) await openInBrowser($, issue.url)
  if (issue !== undefined && action.startsWith('copy-issue:')) await $.ui.copy({ text: issue.id, surface })
}

async function onRowMessage($: EngineInterface, data: unknown): Promise<void> {
  const message = (data ?? {}) as { type?: string; isHovered?: boolean }
  if (message.type === 'hover') await update($, isHovered, () => message.isHovered === true)
  if (message.type !== 'open') return
  const current = await read($, pr)
  if (current !== null) await openInBrowser($, current.url)
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    $.clock.after(0, () => void refresh($))
    $.clock.every(POLL_MS, () => void refresh($))
    return next(e)
  })

  // A turn may have opened a PR, pushed new commits or switched branches.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(0, () => void refresh($))
    return result
  })

  // The region laid over the desktop row: the pointer entering or leaving it, or a click.
  on('ui.message', async ($, e, next) => {
    if (e.element !== 'linear-review-click') return next(e)
    await onRowMessage($, e.data)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, pr)
    if (current === null || e.props.hasSurvey) return next(e)

    const state = stateLook(current)
    const failing = current.checks?.failing ?? 0
    const { openThreads } = current
    const threadsLabel = openThreads === 1 ? '1 unresolved thread' : `${openThreads} unresolved threads`

    // The terminal has no Svg, and its links are OSC 8, so it gets glyphs and a plain link.
    if (e.surface === 'terminal') {
      const { Box, Text, Link } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" justifyContent="space-between" gap={2} width={e.props.bodyColumns}>
          <Box flexDirection="row" gap={1} flexShrink={1}>
            <Text color={state.color}>●</Text>
            <Box flexShrink={1}>
              <Text wrap="truncate-end">
                <Link href={current.url}>{current.title}</Link>
              </Text>
            </Box>
            <Text dimColor>
              {current.repo ?? ''}#{current.number}
            </Text>
          </Box>
          <Box flexDirection="row" gap={2} flexShrink={0}>
            {failing > 0 && <Text color="error">✗ {failing}</Text>}
            {openThreads !== null && openThreads > 0 && <Text dimColor>{threadsLabel}</Text>}
            {current.issues.length > 0 && <Text dimColor>{issueLabel(current)}</Text>}
          </Box>
        </Box>
      )
    }

    // The band is raised on the terminal and desktop only.
    if (e.surface !== 'desktop') return next(e)

    // Laid out like the app's own PR row: the PR on the left, the rest on the right, with
    // counts drawn as Linear's PR view draws them (a colored icon, a muted number). An
    // invisible region over the PR part makes it one click target and reports the hover,
    // which lays the theme's subtle background (the one user messages sit on) behind the
    // title. The counts and the menu sit outside the region, so their tooltips and clicks
    // reach them.
    const hovered = await read($, isHovered)
    const epoch = await read($, menuEpoch)
    const { Box, Text, Svg, Client, Select } = $.ui.resolve(e)
    const icon = (name: IconName, hex: string, alt: string, size = 14, gap = 0) => {
      const { source, width } = iconSvg(name, hex, size, gap)
      return <Svg source={source} alt={alt} width={width} height={size} />
    }
    const tipped = (name: IconName, hex: string, alt: string, tooltip: string, size = 14, gap = 0) => {
      const { source, width } = tooltipSvg(name, hex, size, gap, tooltip)
      return <Svg source={source} alt={alt} width={width} height={size} isInteractive />
    }
    const ref = `${current.repo ?? ''}#${current.number}`
    const mono = monoSvg(ref, MUTED, TITLE_GAP)
    // The title's background is the hover state: room inside it on every side, and a little
    // room outside it before the icon and the ref.
    const pad = <Svg source={spacerSvg()} alt="" width={TITLE_PADDING} height={TITLE_HEIGHT} />

    return (
      <Box key="row" flexDirection="row" alignItems="center" gap={2} width="100%">
        <Box key="pr" position="relative" flexDirection="row" alignItems="center" flexGrow={1} flexShrink={1}>
          {icon(state.icon, state.hex, `${state.label} pull request`, 14, TITLE_GAP)}
          <Box
            key="title"
            flexDirection="row"
            alignItems="center"
            flexShrink={1}
            backgroundColor={hovered ? HOVER_BACKGROUND : undefined}
          >
            {pad}
            <Box flexShrink={1}>
              <Text wrap="truncate-end">{current.title}</Text>
            </Box>
            {pad}
          </Box>
          <Box key="ref" flexShrink={0}>
            <Svg source={mono.source} alt={ref} width={mono.width} height={mono.height} />
          </Box>
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            <Client key="linear-review-click" module="./click-area.tsx" width="100%" height="100%" />
          </Box>
        </Box>
        <Box key="meta" flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
          {current.checks !== null && failing > 0 && (
            <Box key="failing" flexDirection="row" alignItems="center">
              {tipped('cross', RED, 'Failing checks', checksTooltip(current.checks), 12, 4)}
              <Text dimColor>{failing}</Text>
            </Box>
          )}
          {openThreads !== null && openThreads > 0 && (
            <Box key="threads" flexDirection="row" alignItems="center">
              {tipped('comment', MUTED, threadsLabel, threadsTooltip(current.threads), 14, 4)}
              <Text dimColor>{openThreads}</Text>
            </Box>
          )}
          <Box key="issue" flexDirection="row" alignItems="center">
            {tipped('linear', MUTED, 'Linear', issuesTooltip(current.issues), 13, current.issues.length > 0 ? 5 : 0)}
            {current.issues.length > 0 && <Text dimColor>{issueLabel(current)}</Text>}
          </Box>
        </Box>
        <Select
          key={`menu-${epoch}`}
          value={MENU_REST}
          options={menuOptions(current)}
          onSelect={(value, picked) => void runMenuAction($, value, picked.surface)}
        />
      </Box>
    )
  })
}
