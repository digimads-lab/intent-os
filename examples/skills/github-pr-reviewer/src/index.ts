/**
 * GitHub PR Reviewer — Skill entry point
 * IntentOS will use this as the skill's capability definition.
 */

export const skillMeta = {
  name: 'github-pr-reviewer',
  version: '1.0.0',
}

/**
 * Fetch basic PR info from GitHub API.
 * @param prUrl Full GitHub PR URL, e.g. https://github.com/owner/repo/pull/123
 */
export async function fetchPRInfo(prUrl: string) {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) throw new Error(`Invalid GitHub PR URL: ${prUrl}`)
  const [, owner, repo, prNumber] = match

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`)
  return res.json()
}

/**
 * Fetch the unified diff for a PR.
 */
export async function fetchPRDiff(prUrl: string): Promise<string> {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) throw new Error(`Invalid GitHub PR URL: ${prUrl}`)
  const [, owner, repo, prNumber] = match

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github.diff' },
  })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`)
  return res.text()
}
