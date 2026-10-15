export type Checks = { passed: number; failing: number; pending: number; failingNames: string[] }

export type LinkedIssue = { id: string; url: string; title: string }

// An unresolved review thread: where it is, who opened it, and how it starts.
export type ReviewThread = { path: string | null; author: string | null; excerpt: string }

export type PullRequest = {
  number: number
  title: string
  state: string
  isDraft: boolean
  // the PR on linear.review
  url: string
  githubUrl: string
  branch: string
  // null when the PR has no checks
  checks: Checks | null
  // the repository's name, `app` for acme/app
  repo: string | null
  // unresolved review threads; null when GitHub didn't answer
  openThreads: number | null
  threads: ReviewThread[]
  // Linear issues the PR is linked to
  issues: LinkedIssue[]
}

declare module 'claude-code' {
  interface PluginState {
    'linear-review-link': {
      pr: PullRequest | null
      // the pointer is over the desktop row
      isHovered: boolean
      // bumped after each menu pick, so the menu draws again resting on "…"
      menuEpoch: number
    }
  }
}
