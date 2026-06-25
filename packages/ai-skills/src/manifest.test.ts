import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSkillManifest, SkillManifestError } from './manifest.js'

const VALID = `---
name: refunds
description: Issue and look up customer refunds
license: MIT
appliesTo:
  - acme-app
trigger: handling a refund request
metadata:
  author: acme
---

# Refunds

Look up the order first, then issue the refund.`

describe('parseSkillManifest', () => {
  it('parses frontmatter into a validated manifest + trimmed body', () => {
    const { manifest, instructions } = parseSkillManifest(VALID)
    assert.equal(manifest.name, 'refunds')
    assert.equal(manifest.description, 'Issue and look up customer refunds')
    assert.equal(manifest.license, 'MIT')
    assert.deepEqual(manifest.appliesTo, ['acme-app'])
    assert.equal(manifest.trigger, 'handling a refund request')
    assert.deepEqual(manifest.metadata, { author: 'acme' })
    assert.ok(instructions.startsWith('# Refunds'))
    assert.ok(!instructions.startsWith('\n'))
  })

  it('throws when the frontmatter fence is missing', () => {
    assert.throws(
      () => parseSkillManifest('# Just markdown, no frontmatter'),
      (e: unknown) => e instanceof SkillManifestError && /missing a YAML frontmatter/.test((e as Error).message),
    )
  })

  it('throws with field detail when a required field is absent', () => {
    const md = `---\ndescription: no name here\n---\nbody`
    assert.throws(
      () => parseSkillManifest(md),
      (e: unknown) => e instanceof SkillManifestError && /name/.test((e as Error).message),
    )
  })

  it('throws on invalid YAML frontmatter', () => {
    const md = `---\nname: "unterminated\n---\nbody`
    assert.throws(() => parseSkillManifest(md), SkillManifestError)
  })

  it('tolerates and drops unknown frontmatter keys', () => {
    const md = `---\nname: x\ndescription: y\nfutureField: ignored\n---\nbody`
    const { manifest } = parseSkillManifest(md)
    assert.equal(manifest.name, 'x')
    assert.ok(!('futureField' in manifest))
  })

  it('handles a body-less skill (frontmatter only)', () => {
    const md = `---\nname: x\ndescription: y\n---\n`
    const { instructions } = parseSkillManifest(md)
    assert.equal(instructions, '')
  })

  it('carries the source label into errors', () => {
    try {
      parseSkillManifest('no frontmatter', '/path/to/SKILL.md')
      assert.fail('should have thrown')
    } catch (e) {
      assert.equal((e as SkillManifestError).source, '/path/to/SKILL.md')
    }
  })
})
