# linear-review-link

A Claude Code mod that shows the current branch's pull request in a row above the prompt and opens it on [linear.review](https://linear.review) instead of GitHub.

In the Claude desktop app the row shows:

- the PR's state icon, title and `repo#number`
- failing checks, with a tooltip naming them
- unresolved review threads, with a tooltip listing each one's file, author and first line
- the Linear issue the PR is linked to, read from the comment Linear's GitHub integration posts on the PR
- a `…` menu: Open in Linear review, Open the issue in Linear, Copy review link, Copy the issue ID, Copy branch name, Open on GitHub

Clicking the PR opens it on linear.review. In a terminal session the row is one line of text with the title as a link.

The row refreshes when the session starts, after each of Claude's turns, and every 2 minutes. It shows nothing when the branch has no PR.

## Install

In a Claude Code terminal session:

```
/plugin install linear-review-link --marketplace pekala/linear-review-link
```

Answer `y` to add the marketplace, then pick the user scope. Installed at the user scope, the mod also loads in the desktop app's Code sessions.

## Requirements

- The [GitHub CLI](https://cli.github.com), signed in (`gh auth status`). The mod reads the PR, its checks and its threads through `gh`.
- macOS. Links open in your default browser through `open`.
- A Claude Code build with function hooks (mods). The API is early access; this mod was built against Claude Code 2.1.295.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT. The icons for PR states, failing checks and comments come from [Octicons](https://github.com/primer/octicons) (MIT); see [NOTICE](NOTICE).
