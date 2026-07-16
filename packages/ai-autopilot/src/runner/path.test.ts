import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { norm, safeSegments } from './path.js'
import { RunnerError } from './types.js'

// The guard decides whether an agent can write outside its workspace, so it is
// tested directly: as a pure function it needs no daemon and no browser, unlike
// the runners that use it (docker.test.ts is gated on a live Docker daemon, and
// webcontainer's copy of this had no test at all before it moved here).

describe('norm', () => {
  it('drops a leading ./ or / so every path is workspace-relative', () => {
    assert.equal(norm('./a.txt'), 'a.txt')
    assert.equal(norm('/a.txt'), 'a.txt')
    assert.equal(norm('///a.txt'), 'a.txt')
    assert.equal(norm('.//a.txt'), 'a.txt')
  })

  it('drops trailing slashes', () => {
    assert.equal(norm('dir/'), 'dir')
    assert.equal(norm('dir///'), 'dir')
  })

  it('leaves an already-canonical path alone', () => {
    assert.equal(norm('a/b.txt'), 'a/b.txt')
    assert.equal(norm(''), '')
  })

  it('does not resolve .. — that is the guard s job, not normalization s', () => {
    assert.equal(norm('../evil.txt'), '../evil.txt')
  })
})

describe('safeSegments', () => {
  it('splits a plain path into its segments', () => {
    assert.deepEqual(safeSegments('a/b.txt'), ['a', 'b.txt'])
    assert.deepEqual(safeSegments('plain.txt'), ['plain.txt'])
  })

  it('treats a host-absolute path as workspace-relative rather than escaping', () => {
    assert.deepEqual(safeSegments('/abs.txt'), ['abs.txt'])
  })

  it('drops empty and . segments', () => {
    assert.deepEqual(safeSegments('./a/./b.txt'), ['a', 'b.txt'])
    assert.deepEqual(safeSegments('a//b.txt'), ['a', 'b.txt'])
    assert.deepEqual(safeSegments('trailing/'), ['trailing'])
  })

  it('resolves .. that stays inside the workspace', () => {
    assert.deepEqual(safeSegments('ok/../still-ok.txt'), ['still-ok.txt'])
    assert.deepEqual(safeSegments('a/b/../c.txt'), ['a', 'c.txt'])
    // Down three then up three lands back at the root, which is still inside.
    assert.deepEqual(safeSegments('deep/a/b/../../../out.txt'), ['out.txt'])
  })

  it('yields no segments for the workspace root itself', () => {
    assert.deepEqual(safeSegments('.'), [])
    assert.deepEqual(safeSegments(''), [])
    assert.deepEqual(safeSegments('/'), [])
  })

  it('rejects every path that climbs out of the workspace', () => {
    for (const escape of [
      '../evil.txt',
      '../../etc/passwd',
      'a/../../b',
      './../x',
      '..',
      'a/../..',
      '/../etc/passwd',
      'a/b/../../../c',
    ]) {
      assert.throws(() => safeSegments(escape), RunnerError, `should reject ${escape}`)
    }
  })

  it('names the offending path, unnormalized, so the error says what was asked for', () => {
    assert.throws(() => safeSegments('../../etc/passwd'), {
      message: '[ai-autopilot] path escapes the workspace: ../../etc/passwd',
    })
  })

  it('does not treat a segment merely starting with .. as an escape', () => {
    assert.deepEqual(safeSegments('..hidden.txt'), ['..hidden.txt'])
    assert.deepEqual(safeSegments('a/..b/c.txt'), ['a', '..b', 'c.txt'])
  })
})
