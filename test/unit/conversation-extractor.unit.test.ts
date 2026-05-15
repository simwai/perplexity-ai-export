import { describe, expect, it } from 'vitest'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'

describe('ConversationExtractor normalization', () => {
  it('only accepts the target thread detail API response', () => {
    const extractor = new ConversationExtractor({} as any)

    expect(
      (extractor as any).isThreadDetailApiResponse(
        'https://www.perplexity.ai/rest/thread/thread-123?version=2.18',
        'thread-123'
      )
    ).toBe(true)
    expect(
      (extractor as any).isThreadDetailApiResponse(
        'https://www.perplexity.ai/rest/thread/list_recent?version=2.18',
        'thread-123'
      )
    ).toBe(false)
    expect(
      (extractor as any).isThreadDetailApiResponse(
        'https://www.perplexity.ai/rest/thread/other-thread?version=2.18',
        'thread-123'
      )
    ).toBe(false)
  })

  it('normalizes Perplexity entries into ITIR-ready user and assistant messages', () => {
    const extractor = new ConversationExtractor({} as any)
    const apiResponse = {
      entries: [
        {
          thread_title: 'Thread title',
          collection_info: { title: 'Research' },
          updated_datetime: '2026-05-15T10:00:00.000Z',
          query_str: 'What is the plan?',
          blocks: [
            { markdown_block: { answer: 'First answer.' } },
            { markdown_block: { answer: 'Second answer.' } },
          ],
        },
        {
          query_str: 'Follow-up question',
          blocks: [{ markdown_block: { answer: 'Follow-up answer.' } }],
        },
      ],
    }

    const parsed = (extractor as any).parseConversationData(
      apiResponse,
      'https://www.perplexity.ai/search/thread-123'
    )

    expect(parsed).not.toBeNull()
    expect(parsed.id).toBe('thread-123')
    expect(parsed.url).toBe('https://www.perplexity.ai/search/thread-123')
    expect(parsed.spaceName).toBe('Research')
    expect(parsed.messages).toEqual([
      {
        id: '1-user',
        role: 'user',
        content: 'What is the plan?',
        index: 0,
        entryIndex: 0,
      },
      {
        id: '1-assistant',
        role: 'assistant',
        content: 'First answer.\n\nSecond answer.',
        index: 1,
        entryIndex: 0,
      },
      {
        id: '2-user',
        role: 'user',
        content: 'Follow-up question',
        index: 2,
        entryIndex: 1,
      },
      {
        id: '2-assistant',
        role: 'assistant',
        content: 'Follow-up answer.',
        index: 3,
        entryIndex: 1,
      },
    ])
    expect(parsed.rawApiResponse).toBe(apiResponse)
    expect(parsed.rawEntries).toEqual(apiResponse.entries)
  })

  it('combines paginated Perplexity API entries', async () => {
    const extractor = new ConversationExtractor({} as any)
    const firstPage = {
      has_next_page: true,
      next_cursor: 'cursor-1',
      entries: [{ query_str: 'First', blocks: [{ markdown_block: { answer: 'Answer 1' } }] }],
    }
    const secondPage = {
      has_next_page: false,
      entries: [{ query_str: 'Second', blocks: [{ markdown_block: { answer: 'Answer 2' } }] }],
    }
    const page = {
      evaluate: async (_fn: unknown, args: { cursor: string }) => {
        expect(args.cursor).toBe('cursor-1')
        return secondPage
      },
    }

    const combined = await (extractor as any).fetchAllConversationPages(
      page,
      firstPage,
      'https://www.perplexity.ai/rest/thread/thread-123?offset=0&limit=10'
    )

    expect(combined.entries).toHaveLength(2)
    expect(combined.entries[0].query_str).toBe('First')
    expect(combined.entries[1].query_str).toBe('Second')
    expect(combined.has_next_page).toBe(false)
  })

  it('stops paginating when Perplexity replays the same page', async () => {
    const extractor = new ConversationExtractor({} as any)
    const firstPage = {
      has_next_page: true,
      next_cursor: 'cursor-1',
      entries: [
        {
          uuid: 'entry-1',
          query_str: 'First',
          blocks: [{ markdown_block: { answer: 'Answer 1' } }],
        },
      ],
    }
    const page = {
      evaluate: async () => firstPage,
    }

    const combined = await (extractor as any).fetchAllConversationPages(
      page,
      firstPage,
      'https://www.perplexity.ai/rest/thread/thread-123?offset=0&limit=10'
    )

    expect(combined).toBe(firstPage)
  })
})
