import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderMarketResearchPrompt, MARKET_RESEARCH_PRESET_NAME } from './market-research-preset.js'

test('the market research preset carries #694: research, then queue the follow-up', () => {
  const prompt = renderMarketResearchPrompt()
  assert.match(prompt, /thorough market research/)
  assert.match(prompt, /MARKET_RESEARCH\.md/)
  assert.match(prompt, /TODO_AGENTS\.md entry/)
  assert.match(prompt, /suggest new tickets/)
})

test('the session name is deferred to the agent, not interpolated (#694)', () => {
  const prompt = renderMarketResearchPrompt()
  // The catch-22: the session name does not exist when the preset renders, so an interpolation
  // here would always resolve to nothing. The placeholder is left for the agent to fill.
  assert.ok(!prompt.includes('${{'), 'no template interpolation should survive rendering')
  assert.match(prompt, /<SESSION_NAME>/)
  // Defined in the preset itself, so it still resolves with no system prompt (--vanilla).
  assert.match(prompt, /^SESSION_NAME: /m)
})

test('the preset name is the id the menu uses (#694)', () => {
  assert.equal(MARKET_RESEARCH_PRESET_NAME, 'market-research')
})
