import { describe, expect, it } from 'vitest'
import { normalizeClavusThreadMarkdown } from './clavusLinks'
import { stripMarkdown } from './homeText'

describe('Clavus thread link text cleanup', () => {
  it('removes sentence punctuation after thread-card markdown links', () => {
    expect(
      normalizeClavusThreadMarkdown('Jane answered this in [another conversation](clavus://thread/thread-1).'),
    ).toBe('Jane answered this in [another conversation](clavus://thread/thread-1)')
  })

  it('turns complete thread markdown links into readable previews', () => {
    expect(
      stripMarkdown('Jane answered this in [another conversation](clavus://thread/thread-1).'),
    ).toBe('Jane answered this in another conversation')
  })

  it('turns truncated thread markdown links into readable previews', () => {
    expect(
      stripMarkdown('Jane answered this in [another conversation](clavus://thread/thread-178213398829'),
    ).toBe('Jane answered this in another conversation')
  })
})
