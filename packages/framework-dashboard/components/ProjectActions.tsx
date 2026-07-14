import { useEffect, useState } from 'react'
import { Github } from 'lucide-react'
import { onGithubUrl } from '../server/reads.telefunc.js'
import { Button } from './ui/button.js'

// Project-panel quick actions (#488). For now just "Open on GitHub" (#489): when the repo has
// a github.com origin remote, a one-click link to it. Hidden entirely when there is no GitHub
// remote (or on the relay, where there is no local checkout), so the bar never shows empty.
export function ProjectActions({ projectId }: { projectId: string }) {
  const [githubUrl, setGithubUrl] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setGithubUrl(null)
    void onGithubUrl(projectId).then(url => live && setGithubUrl(url))
    return () => {
      live = false
    }
  }, [projectId])

  if (!githubUrl) return null

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <a href={githubUrl} target="_blank" rel="noreferrer" title={githubUrl}>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Github className="h-4 w-4" /> Open on GitHub
        </Button>
      </a>
    </div>
  )
}
