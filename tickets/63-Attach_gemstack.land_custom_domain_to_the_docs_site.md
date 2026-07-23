# Attach gemstack.land custom domain to the docs site

The docs site is live on GitHub Pages at https://gemstack-land.github.io/gemstack/ (deployed via `deploy-docs.yml`). Once the `gemstack.land` domain is in place (transfer Hover -> Cloudflare in progress), cut the site over to it.

### Cutover checklist
- [ ] DNS: point `gemstack.land` at GitHub Pages (CNAME/ALIAS to `gemstack-land.github.io`, or per the hosting decision below)
- [ ] Set the Pages custom domain (`gh api -X PUT repos/gemstack-land/the-framework/pages -f cname=gemstack.land`) and wait for GitHub to provision TLS
- [ ] Drop `DOCS_BASE=/gemstack/` from `.github/workflows/deploy-docs.yml` so the VitePress base returns to `/`
- [ ] Re-swap the interim `github.io` links to `gemstack.land`:
  - rudder `docs/guide/ai.md` + `docs/guide/mcp.md` (currently github.io, rudder PR #1465)
  - the package README "Docs" column links
- [ ] Verify the deep pages resolve at the new root

### Out of scope (decided in Discord)
The governance questions (whose Cloudflare account owns the domain, GitHub Pages vs Cloudflare Pages, who controls deploys) are being settled in chat. This issue only tracks the mechanical cutover once that's resolved.

Non-urgent: the github.io URL works today and will redirect once the custom domain is attached.

---
Source: https://github.com/gemstack-land/the-framework/issues/63
