import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { linkedIssues, plainText } from '../hooks/register'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PR_JSON = JSON.stringify({
  number: 1234,
  title: 'Fix the thing',
  state: 'OPEN',
  isDraft: false,
  url: 'https://github.com/acme/app/pull/1234',
  headRefName: 'fix-the-thing',
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'deploy', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'StatusContext', context: 'ci/circle', state: 'SUCCESS' },
  ],
})

const THREADS_JSON = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              path: 'api/src/flags.ts',
              comments: { nodes: [{ author: { login: 'reviewer-bot' }, body: 'The switch cannot be enabled <!-- linear:meta -->' }] },
            },
            { isResolved: true, path: 'api/src/old.ts', comments: { nodes: [] } },
            { isResolved: false, path: null, comments: { nodes: [{ author: null, body: 'Why?' }] } },
          ],
        },
        comments: {
          nodes: [
            { body: 'Looks good, see https://linear.app/acme/issue/ENG-1/not-a-linkback' },
            {
              body: '<!-- linear-linkback -->\n<details><summary><a href="https://linear.app/acme/issue/ENG-1/add-a-switch">ENG-1 Add a switch</a></summary></details>',
            },
          ],
        },
      },
    },
  },
})

type Answer = { exitCode: number; stdout: string }

function answerGh(on: On, view: Answer, graphql: Answer, opened: string[][] = [], copied: string[] = []) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.copy', ($, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'open') opened.push([...e.argv])
    const { exitCode, stdout } = e.argv.includes('graphql') ? graphql : view
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

test('shows the branch PR with its checks and unresolved threads', async ($, on) => {
  const clock = mock.clock(on)
  answerGh(on, { exitCode: 0, stdout: PR_JSON }, { exitCode: 0, stdout: THREADS_JSON })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'linear-review-link', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: 'Fix the thing' })).toBeDefined()
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: 'app#1234' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'ENG-1' })).toBeDefined()
      expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://linear.review/acme/app/pull/1234')
      expect(await ui.find({ type: 'Text', text: '✗ 1' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '2 unresolved threads' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /✓/ })).toBeUndefined()
    } else {
      const ref = await ui.find({ key: 'ref' })
      const refSvg = (ref?.children as { props: { alt: string; source: string } }[])[0]
      expect(refSvg?.props.alt).toBe('app#1234')
      expect(refSvg?.props.source).toContain('>app#1234</text>')
      const tooltip = async (key: string) => {
        const box = await ui.find({ key })
        const svg = (box?.children as { type: string; props: { source: string; isInteractive?: boolean } }[]).find(
          child => child.type === 'Svg',
        )
        expect(svg?.props.isInteractive).toBe(true)
        return svg?.props.source.match(/<title>([\s\S]*?)<\/title>/)?.[1]
      }
      expect((await ui.find({ key: 'failing' }))?.text).toContain('1')
      expect(await tooltip('failing')).toBe('1 failing check\n• lint\n2 passed, 1 pending')
      expect((await ui.find({ key: 'threads' }))?.text).toContain('2')
      expect(await tooltip('threads')).toBe(
        '2 unresolved review threads\n• api/src/flags.ts · @reviewer-bot: The switch cannot be enabled\n• Conversation: Why?',
      )
      expect((await ui.find({ key: 'issue' }))?.text).toContain('ENG-1')
      expect(await tooltip('issue')).toBe('Linked issue\n• ENG-1 Add a switch')
      expect((await ui.find({ type: 'Select' }))?.props.value).toBe('…')
    }
    await ui.unmount()
  }
})

test('a click anywhere on the desktop row opens the PR on linear.review', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[][] = []
  answerGh(on, { exitCode: 0, stdout: PR_JSON }, { exitCode: 0, stdout: THREADS_JSON }, opened)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'linear-review-link', surface: 'desktop', ...BAND })
  await ui.resize({ columns: 140, rows: 1 })

  // Pressed on the row and dragged off it: nothing opens.
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left' })
  await ui.pointer({ type: 'up', x: 3, y: 4, button: 'left' })
  expect(opened).toEqual([])

  for (const x of [3, 120]) {
    await ui.pointer({ type: 'down', x, y: 0, button: 'left' })
    await ui.pointer({ type: 'up', x, y: 0, button: 'left' })
  }
  expect(opened).toEqual([
    ['open', 'https://linear.review/acme/app/pull/1234'],
    ['open', 'https://linear.review/acme/app/pull/1234'],
  ])
  await ui.unmount()
})

test('the desktop row lays a background behind the title while the pointer is over it', async ($, on) => {
  const clock = mock.clock(on)
  answerGh(on, { exitCode: 0, stdout: PR_JSON }, { exitCode: 0, stdout: THREADS_JSON })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'linear-review-link', surface: 'desktop', ...BAND })
  await ui.resize({ columns: 120, rows: 1 })
  expect((await ui.find({ key: 'title' }))?.props.backgroundColor).toBeUndefined()
  await ui.pointer({ type: 'enter', x: 3, y: 0 })
  expect((await ui.find({ key: 'title' }))?.props.backgroundColor).toBe('userMessageBackground')
  await ui.pointer({ type: 'leave', x: 3, y: 0 })
  expect((await ui.find({ key: 'title' }))?.props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

test('the … menu rests on "…" and runs the action picked', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[][] = []
  const copied: string[] = []
  answerGh(on, { exitCode: 0, stdout: PR_JSON }, { exitCode: 0, stdout: THREADS_JSON }, opened, copied)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'linear-review-link', surface: 'desktop', ...BAND })
  const menu = async () => (await ui.find({ type: 'Select' }))!
  const pick = async (value: string) => {
    await ui.select({ key: (await menu()).key ?? '', value })
  }
  const options = (await menu()).props.options as { value: string; label: string }[]
  expect(options.map(option => option.label)).toEqual([
    '…',
    'Open in Linear review',
    'Open ENG-1 in Linear',
    'Copy review link',
    'Copy ENG-1',
    'Copy branch name',
    'Open on GitHub',
  ])

  await pick('…')
  await pick('copy-branch')
  await pick('copy-issue:ENG-1')
  await pick('copy-review-link')
  expect(copied).toEqual(['fix-the-thing', 'ENG-1', 'https://linear.review/acme/app/pull/1234'])

  await pick('open-review')
  await pick('open-issue:ENG-1')
  await pick('open-github')
  expect(opened).toEqual([
    ['open', 'https://linear.review/acme/app/pull/1234'],
    ['open', 'https://linear.app/acme/issue/ENG-1/add-a-switch'],
    ['open', 'https://github.com/acme/app/pull/1234'],
  ])
  // Each pick draws the menu again, resting on "…".
  expect((await menu()).props.value).toBe('…')
  await ui.unmount()
})

test('leaves out threads when GitHub does not answer them', async ($, on) => {
  const clock = mock.clock(on)
  answerGh(on, { exitCode: 0, stdout: PR_JSON }, { exitCode: 1, stdout: '' })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'linear-review-link', surface: 'desktop', ...BAND })
  expect(await ui.find({ key: 'failing' })).toBeDefined()
  expect(await ui.find({ key: 'threads' })).toBeUndefined()
  await ui.unmount()
})

test('draws nothing when the branch has no PR', async ($, on) => {
  const clock = mock.clock(on)
  answerGh(on, { exitCode: 1, stdout: '' }, { exitCode: 1, stdout: '' })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine's own band</Text>
  })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'linear-review-link', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: '#1234' })).toBeUndefined()
    await ui.unmount()
  }
})

test('names the linked issues from the Linear link-back comment only', () => {
  expect(linkedIssues(['see https://linear.app/acme/issue/ENG-1/x'])).toEqual([])
  const details = (issue: string, mentions: string) =>
    `<details>\n<summary><a href="https://linear.app/acme/issue/${issue}/x">${issue} x</a></summary>\n<p>\n${mentions}\n</p>\n</details>`
  expect(
    linkedIssues([
      `<!-- linear-linkback -->\n${details('ENG-1', 'after [ENG-3](https://linear.app/acme/issue/ENG-3/y)')}${details('ENG-2', '')}${details('ENG-1', '')}`,
    ]),
  ).toEqual([
    { id: 'ENG-1', url: 'https://linear.app/acme/issue/ENG-1/x', title: 'x' },
    { id: 'ENG-2', url: 'https://linear.app/acme/issue/ENG-2/x', title: 'x' },
  ])
})

test('turns a bot comment into one line of plain text', () => {
  expect(
    plainText(
      '**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange)</sub></sub> Guard the `webhook` path**\n\nSee [the docs](https://x.y) <!-- meta -->',
    ),
  ).toBe('Guard the webhook path See the docs')
})
