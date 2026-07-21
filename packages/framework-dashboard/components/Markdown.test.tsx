import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Markdown } from './Markdown.js'

afterEach(cleanup)

// #869 + #948: the dependency-free renderer grew pipe tables and links without giving up
// the no-injected-HTML property.
describe('Markdown tables (#869)', () => {
  test('a pipe table renders as a real table', () => {
    render(<Markdown text={'| col a | col b |\n| --- | --- |\n| one | two |'} />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'col a' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'two' })).toBeTruthy()
  })

  test('pipes without a separator row stay prose, not a mangled table', () => {
    render(<Markdown text={'| just | pipes |\n| in prose |'} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('| just | pipes |')).toBeTruthy()
  })

  test('a short row leaves its missing cells empty instead of collapsing the column', () => {
    render(<Markdown text={'| a | b |\n| --- | --- |\n| only |'} />)
    expect(screen.getAllByRole('cell')).toHaveLength(2)
  })
})

describe('Markdown links (#948)', () => {
  test('[text](url) renders an anchor', () => {
    render(<Markdown text={'See [the PR](https://github.com/x/y/pull/1) for detail'} />)
    const a = screen.getByRole('link', { name: 'the PR' })
    expect(a.getAttribute('href')).toBe('https://github.com/x/y/pull/1')
    expect(a.getAttribute('rel')).toContain('noreferrer')
  })

  test('a bare URL autolinks', () => {
    render(<Markdown text={'Deployed at https://example.com/app now'} />)
    expect(screen.getByRole('link', { name: 'https://example.com/app' })).toBeTruthy()
  })

  test('a javascript: target stays plain text', () => {
    render(<Markdown text={'[click](javascript:alert(1))'} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  test('a URL inside backticks stays literal code', () => {
    render(<Markdown text={'run `curl https://example.com` locally'} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('curl https://example.com')).toBeTruthy()
  })
})
