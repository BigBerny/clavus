import { describe, expect, it } from 'vitest'
import { parseChildThreadIntent } from './childThreadIntent'

describe('parseChildThreadIntent', () => {
  it('detects an explicit Swiss-German sub-conversation request', () => {
    const parsed = parseChildThreadIntent('Chasch e neui Sub-Conversation mache zum e Video z mache basierend uf Clavus?')

    expect(parsed).toMatchObject({
      title: 'Clavus Video',
      prompt: expect.stringContaining('Sub-Conversation'),
    })
  })

  it('does not treat ordinary conversation text as a child-thread request', () => {
    expect(parseChildThreadIntent('Can we talk about the Clavus landing page?')).toBeNull()
  })
})
