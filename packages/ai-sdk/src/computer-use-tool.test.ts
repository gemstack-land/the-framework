import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  computerUseTool,
  isComputerUseTool,
  isAnthropicLikeModel,
  ComputerUseProviderError,
  ComputerUseLimitError,
  COMPUTER_USE_MARKER,
  COMPUTER_USE_TOOL_NAME,
  type ComputerAction,
  type PageLike,
} from './computer-use/index.js'

// ─── Mock PageLike ────────────────────────────────────────

function makeMockPage(opts: { screenshotBytes?: Uint8Array; throwOn?: string } = {}): {
  page: PageLike
  calls: { method: string; args: unknown[] }[]
} {
  const calls: { method: string; args: unknown[] }[] = []
  const record = (method: string, args: unknown[]): void => { calls.push({ method, args }) }
  const screenshotBytes = opts.screenshotBytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  const page: PageLike = {
    mouse: {
      async move(x, y, options) { record('mouse.move', [x, y, options]) },
      async click(x, y, options) {
        record('mouse.click', [x, y, options])
        if (opts.throwOn === 'mouse.click') throw new Error('boom in click')
      },
      async down(options) { record('mouse.down', [options]) },
      async up(options) { record('mouse.up', [options]) },
      async wheel(dx, dy) { record('mouse.wheel', [dx, dy]) },
    },
    keyboard: {
      async type(text, options) { record('keyboard.type', [text, options]) },
      async press(key, options) { record('keyboard.press', [key, options]) },
      async down(key) { record('keyboard.down', [key]) },
      async up(key) { record('keyboard.up', [key]) },
    },
    async screenshot(options) {
      record('screenshot', [options])
      if (opts.throwOn === 'screenshot') throw new Error('boom in screenshot')
      return screenshotBytes
    },
  }
  return { page, calls }
}

// ─── isAnthropicLikeModel ─────────────────────────────────

describe('isAnthropicLikeModel', () => {
  it('accepts anthropic/* model ids', () => {
    assert.equal(isAnthropicLikeModel('anthropic/claude-opus-4-7'), true)
    assert.equal(isAnthropicLikeModel('anthropic/claude-sonnet-4-6'), true)
    assert.equal(isAnthropicLikeModel('anthropic/claude-3-5-sonnet'), true)
  })

  it('accepts bedrock/anthropic.* model ids (direct)', () => {
    assert.equal(isAnthropicLikeModel('bedrock/anthropic.claude-opus-4-7-v1:0'), true)
    assert.equal(isAnthropicLikeModel('bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0'), true)
  })

  it('accepts bedrock cross-region inference profiles', () => {
    assert.equal(isAnthropicLikeModel('bedrock/us.anthropic.claude-opus-4-7-v1:0'), true)
    assert.equal(isAnthropicLikeModel('bedrock/eu.anthropic.claude-opus-4-7-v1:0'), true)
    assert.equal(isAnthropicLikeModel('bedrock/apac.anthropic.claude-opus-4-7-v1:0'), true)
  })

  it('rejects non-Anthropic models', () => {
    assert.equal(isAnthropicLikeModel('openai/gpt-4.1'),                  false)
    assert.equal(isAnthropicLikeModel('google/gemini-2.5-pro'),           false)
    assert.equal(isAnthropicLikeModel('groq/llama-3.3-70b'),              false)
    assert.equal(isAnthropicLikeModel('mistral/mistral-large-latest'),    false)
    assert.equal(isAnthropicLikeModel('cohere/command-r-plus'),           false)
  })

  it('rejects OpenRouter-routed Anthropic — wrong API path', () => {
    // OpenRouter goes through openai SDK; native computer_20250124 block can't
    // be sent. Reject so the user picks Anthropic-direct or Bedrock instead.
    assert.equal(isAnthropicLikeModel('openrouter/anthropic/claude-opus-4-7'), false)
  })

  it('rejects bedrock non-anthropic families', () => {
    assert.equal(isAnthropicLikeModel('bedrock/meta.llama3-70b'), false)
    assert.equal(isAnthropicLikeModel('bedrock/amazon.nova-pro'), false)
  })
})

// ─── ComputerUseProviderError + factory upfront check ─────

describe('computerUseTool — model validation', () => {
  it('throws ComputerUseProviderError when model is non-Anthropic', () => {
    const { page } = makeMockPage()
    assert.throws(
      () => computerUseTool({ page, model: 'openai/gpt-4.1' }),
      (err: unknown) => {
        if (!(err instanceof ComputerUseProviderError)) return false
        assert.equal(err.code,  'COMPUTER_USE_PROVIDER_MISMATCH')
        assert.equal(err.model, 'openai/gpt-4.1')
        assert.match(err.message, /Anthropic-only/i)
        return true
      },
    )
  })

  it('does not throw for anthropic/*', () => {
    const { page } = makeMockPage()
    assert.doesNotThrow(() => computerUseTool({ page, model: 'anthropic/claude-opus-4-7' }))
  })

  it('does not throw for bedrock anthropic models (direct + cross-region)', () => {
    const { page } = makeMockPage()
    assert.doesNotThrow(() => computerUseTool({ page, model: 'bedrock/anthropic.claude-opus-4-7-v1:0' }))
    assert.doesNotThrow(() => computerUseTool({ page, model: 'bedrock/us.anthropic.claude-opus-4-7-v1:0' }))
  })

  it('skips validation when model is omitted (deferred check)', () => {
    const { page } = makeMockPage()
    assert.doesNotThrow(() => computerUseTool({ page }))
  })

  it('error code field is stable for app instanceof + .code dispatch', () => {
    const err = new ComputerUseProviderError('openai/gpt-4.1')
    assert.equal(err.code, 'COMPUTER_USE_PROVIDER_MISMATCH')
    assert.equal(err.name, 'ComputerUseProviderError')
  })
})

// ─── Tool object shape ────────────────────────────────────

describe('computerUseTool — tool object shape', () => {
  it('carries the COMPUTER_USE_MARKER symbol so adapters can detect it', () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })
    assert.equal(tool[COMPUTER_USE_MARKER], true)
    assert.equal(isComputerUseTool(tool), true)
  })

  it('isComputerUseTool returns false for plain objects, nulls, primitives', () => {
    assert.equal(isComputerUseTool(null),             false)
    assert.equal(isComputerUseTool(undefined),        false)
    assert.equal(isComputerUseTool(42),               false)
    assert.equal(isComputerUseTool('hello'),          false)
    assert.equal(isComputerUseTool({ definition: { name: 'x' } }), false)
  })

  it('uses the fixed name "computer" so Anthropic\'s native tool resolves', () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })
    assert.equal(tool.definition.name, COMPUTER_USE_TOOL_NAME)
    assert.equal(COMPUTER_USE_TOOL_NAME, 'computer')
  })

  it('default needsApproval is true (every action gates through approval)', () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })
    assert.equal(tool.definition.needsApproval, true)
  })

  it('honors explicit needsApproval: false', () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page, needsApproval: false })
    assert.equal(tool.definition.needsApproval, false)
  })

  it('forwards a needsApproval predicate', () => {
    const { page } = makeMockPage()
    const predicate = (action: ComputerAction): boolean =>
      action.action !== 'screenshot' && action.action !== 'mouse_move'
    const tool = computerUseTool({ page, needsApproval: predicate })
    const fn = tool.definition.needsApproval as (a: ComputerAction) => boolean
    assert.equal(typeof fn, 'function')
    assert.equal(fn({ action: 'screenshot' }),                          false)
    assert.equal(fn({ action: 'left_click', coordinate: [10, 10] }),    true)
  })
})

// ─── toSchema — providerHint ──────────────────────────────

describe('computerUseTool — toSchema()', () => {
  it('emits providerHint with type=computer-use and viewport defaults', () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })
    const schema = tool.toSchema()

    assert.equal(schema.name, 'computer')
    assert.deepEqual(schema.providerHint, {
      type:              'computer-use',
      tool:              'computer_20250124',
      display_width_px:  1280,
      display_height_px: 800,
    })
  })

  it('honors explicit viewport in providerHint', () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page, viewport: { width: 1920, height: 1080 } })
    const schema = tool.toSchema()
    assert.equal(schema.providerHint?.['display_width_px'],  1920)
    assert.equal(schema.providerHint?.['display_height_px'], 1080)
  })
})

// ─── execute — normal paths ───────────────────────────────

describe('computerUseTool — execute (image)', () => {
  it('screenshot result becomes a ContentPart[] with one image block (base64)', async () => {
    const { page } = makeMockPage({ screenshotBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) })
    const tool = computerUseTool({ page })

    const result = await tool.execute({ action: 'screenshot' })

    assert.ok(Array.isArray(result), 'expected ContentPart[]')
    if (!Array.isArray(result)) return
    assert.equal(result.length, 1)
    const part = result[0] as { type: string; mimeType: string; data: string }
    assert.equal(part.type,     'image')
    assert.equal(part.mimeType, 'image/png')
    assert.equal(part.data,     '/9j/4A==')   // base64 of [0xff, 0xd8, 0xff, 0xe0]
  })
})

describe('computerUseTool — execute (text)', () => {
  it('text result becomes a plain string (no array wrap)', async () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })

    const result = await tool.execute({ action: 'mouse_move', coordinate: [400, 200] })

    assert.equal(typeof result, 'string')
    assert.match(result as string, /moved to \(400, 200\)/)
  })

  it('cursor_position reads state through the executor', async () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })

    await tool.execute({ action: 'mouse_move', coordinate: [123, 456] })
    const result = await tool.execute({ action: 'cursor_position' })

    assert.equal(result, 'X=123, Y=456')
  })
})

describe('computerUseTool — execute (error)', () => {
  it('throws when the underlying executor returns { type: "error" } so the agent loop sets is_error', async () => {
    const { page } = makeMockPage({ throwOn: 'mouse.click' })
    const tool = computerUseTool({ page })

    await assert.rejects(
      () => tool.execute({ action: 'left_click', coordinate: [10, 20] }),
      (err: unknown) => {
        return err instanceof Error && /boom in click/.test(err.message)
      },
    )
  })
})

// ─── State sharing within a tool instance ─────────────────

describe('computerUseTool — state lifetime', () => {
  it('cursor state persists across executes of the SAME tool instance', async () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })

    await tool.execute({ action: 'mouse_move', coordinate: [50, 50] })
    const r1 = await tool.execute({ action: 'cursor_position' })
    assert.equal(r1, 'X=50, Y=50')

    await tool.execute({ action: 'left_click', coordinate: [100, 200] })
    const r2 = await tool.execute({ action: 'cursor_position' })
    assert.equal(r2, 'X=100, Y=200')
  })

  it('two separate tool instances start with fresh state', async () => {
    const { page: p1 } = makeMockPage()
    const { page: p2 } = makeMockPage()
    const tool1 = computerUseTool({ page: p1 })
    const tool2 = computerUseTool({ page: p2 })

    await tool1.execute({ action: 'mouse_move', coordinate: [999, 999] })
    const r2 = await tool2.execute({ action: 'cursor_position' })

    assert.equal(r2, 'X=0, Y=0', 'tool2 state is independent of tool1')
  })
})

// ─── maxActions limit ─────────────────────────────────────

describe('computerUseTool — maxActions limit', () => {
  it('throws ComputerUseLimitError after maxActions calls', async () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page, maxActions: 3 })

    // 3 successful calls
    await tool.execute({ action: 'screenshot' })
    await tool.execute({ action: 'screenshot' })
    await tool.execute({ action: 'screenshot' })

    // 4th throws
    await assert.rejects(
      () => tool.execute({ action: 'screenshot' }),
      (err: unknown) => {
        if (!(err instanceof ComputerUseLimitError)) return false
        assert.equal(err.code,       'COMPUTER_USE_LIMIT_EXCEEDED')
        assert.equal(err.maxActions, 3)
        return true
      },
    )
  })

  it('default cap is 50 (sanity — no exact assertion on 50 here, just that it\'s generous)', async () => {
    const { page } = makeMockPage()
    const tool = computerUseTool({ page })  // default

    // 10 calls should comfortably pass
    for (let i = 0; i < 10; i++) {
      const r = await tool.execute({ action: 'screenshot' })
      assert.ok(Array.isArray(r), `call ${i + 1} returned a result`)
    }
  })

  it('counter is per-tool-instance (two instances each get their own quota)', async () => {
    const { page: p1 } = makeMockPage()
    const { page: p2 } = makeMockPage()
    const t1 = computerUseTool({ page: p1, maxActions: 2 })
    const t2 = computerUseTool({ page: p2, maxActions: 2 })

    await t1.execute({ action: 'screenshot' })
    await t1.execute({ action: 'screenshot' })
    // t1 is at the limit
    await assert.rejects(() => t1.execute({ action: 'screenshot' }), ComputerUseLimitError)

    // t2 is untouched
    await assert.doesNotReject(() => t2.execute({ action: 'screenshot' }))
    await assert.doesNotReject(() => t2.execute({ action: 'screenshot' }))
  })
})
