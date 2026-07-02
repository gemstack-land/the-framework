# @gemstack/connector-github

## 0.1.0

### Minor Changes

- f360932: New package: the GitHub connector for GemStack AI orchestration. Read and act on issues, pull requests, and repository files over the GitHub REST API — `get-repo`, `list-issues`, `get-issue`, `list-pull-requests`, `get-pull-request`, `get-file`, `search-issues`, `comment-on-issue`, `create-issue`. Built with `@gemstack/connectors`; consumes a bearer token (PAT or OAuth) via the mount `credentials` seam. First real connector on the contract (epic #86).

### Patch Changes

- Updated dependencies [b0430f9]
  - @gemstack/connectors@0.1.0
