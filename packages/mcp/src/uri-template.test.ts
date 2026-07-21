import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { matchUriTemplate } from './uri-template.js'

// ─── matchUriTemplate ─────────────────────────────────────

describe('matchUriTemplate', () => {
  it('extracts a single param and percent-decodes it', () => {
    assert.deepEqual(matchUriTemplate('weather://location/{city}', 'weather://location/paris'), { city: 'paris' })
    assert.deepEqual(matchUriTemplate('doc://{id}', 'doc://a%20b'), { id: 'a b' })
  })

  it('extracts several params in order', () => {
    assert.deepEqual(
      matchUriTemplate('repo://{owner}/{name}/blob', 'repo://acme/widgets/blob'),
      { owner: 'acme', name: 'widgets' },
    )
  })

  it('returns null when the URI does not match the template', () => {
    assert.equal(matchUriTemplate('doc://{id}', 'other://42'), null)
    assert.equal(matchUriTemplate('doc://{id}', 'doc://'), null)
    assert.equal(matchUriTemplate('doc://{id}/x', 'doc://42'), null)
  })

  it('matches a template with no placeholders exactly', () => {
    assert.deepEqual(matchUriTemplate('config://app', 'config://app'), {})
    assert.equal(matchUriTemplate('config://app', 'config://app/extra'), null)
  })

  // ─── #968 defect 1: the separator guard must survive decoding ───

  it('rejects a percent-encoded separator instead of decoding it after the match (#968)', () => {
    assert.equal(matchUriTemplate('file://docs/{name}', 'file://docs/..%2F..%2F..%2Fetc%2Fpasswd'), null)
    assert.equal(matchUriTemplate('file://docs/{name}', 'file://docs/a%2Fb'), null)
    // The literal-slash form was always rejected; the encoded form must agree.
    assert.equal(matchUriTemplate('file://docs/{name}', 'file://docs/../../../etc/passwd'), null)
  })

  it('still allows dot segments that stay inside one path segment (#968)', () => {
    assert.deepEqual(matchUriTemplate('file://docs/{name}', 'file://docs/..'), { name: '..' })
    assert.deepEqual(matchUriTemplate('file://docs/{name}', 'file://docs/a.b'), { name: 'a.b' })
  })

  it('treats a malformed percent-escape as a non-match rather than throwing (#968)', () => {
    assert.equal(matchUriTemplate('file://docs/{name}', 'file://docs/%'), null)
    assert.equal(matchUriTemplate('file://docs/{name}', 'file://docs/%zz'), null)
    assert.equal(matchUriTemplate('file://docs/{name}', 'file://docs/%E0%A4%A'), null)
    // A well-formed URI still matches, so the guard did not swallow the good path with it.
    assert.deepEqual(matchUriTemplate('file://docs/{name}', 'file://docs/ok'), { name: 'ok' })
  })

  // ─── #968 defect 2: literal segments are regex-escaped ───

  it('treats regex metacharacters in the template as literals (#968)', () => {
    assert.equal(matchUriTemplate('weather://a.b/{city}', 'weather://aXb/paris'), null)
    assert.deepEqual(matchUriTemplate('weather://a.b/{city}', 'weather://a.b/paris'), { city: 'paris' })
    assert.equal(matchUriTemplate('doc://a+/{id}', 'doc://aaa/1'), null)
    assert.deepEqual(matchUriTemplate('doc://a+/{id}', 'doc://a+/1'), { id: '1' })
  })

  // ─── #968 defect 3: capture indexes stay aligned with param names ───

  it('keeps params aligned when the template contains a literal group (#968)', () => {
    assert.equal(matchUriTemplate('x://(a|.*)/{p}', 'x://zzzz/v'), null)
    assert.deepEqual(matchUriTemplate('x://(a|.*)/{p}', 'x://(a|.*)/v'), { p: 'v' })
  })
})
