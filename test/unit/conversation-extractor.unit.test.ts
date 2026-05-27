import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js';
import { ApiDiagnosticsWriter } from '../../src/utils/api-diagnostics.js';
import type { BrowserContext } from '@playwright/test';

vi.mock('../../src/utils/api-diagnostics.js', () => ({
  ApiDiagnosticsWriter: {
    writeFailure: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('ConversationExtractor (Unit)', () => {
  let extractor: ConversationExtractor;
  let mockContext: BrowserContext;

  beforeEach(() => {
    mockContext = {
      newPage: vi.fn(),
      pages: vi.fn(),
    } as unknown as BrowserContext;
    extractor = new ConversationExtractor(mockContext);
    vi.clearAllMocks();
  });

  describe('ensureEntriesFormat', () => {
    it('should return array if input is array', () => {
      const data = [{ query_str: 'test' }];
      const result = (extractor as any).ensureEntriesFormat(data, 'http://test.com');
      expect(result).toEqual(data);
      expect(ApiDiagnosticsWriter.writeFailure).not.toHaveBeenCalled();
    });

    it('should return data.entries if input has entries array', () => {
      const data = { entries: [{ query_str: 'test' }] };
      const result = (extractor as any).ensureEntriesFormat(data, 'http://test.com');
      expect(result).toEqual(data.entries);
      expect(ApiDiagnosticsWriter.writeFailure).not.toHaveBeenCalled();
    });

    it('should return [data] if input has query_str', () => {
      const data = { query_str: 'test' };
      const result = (extractor as any).ensureEntriesFormat(data, 'http://test.com');
      expect(result).toEqual([data]);
      expect(ApiDiagnosticsWriter.writeFailure).not.toHaveBeenCalled();
    });

    it('should return empty array and call diagnostics for unknown shape', () => {
      const data = { foo: 'bar' };
      const result = (extractor as any).ensureEntriesFormat(data, 'http://test.com');
      expect(result).toEqual([]);
      expect(ApiDiagnosticsWriter.writeFailure).toHaveBeenCalledWith({
        url: 'http://test.com',
        errorType: 'unknown_shape',
      });
    });
  });

  describe('parseConversationData', () => {
    it('should return null and call diagnostics if entries are empty', () => {
      const data = { entries: [] };
      const result = extractor.parseConversationData(data, 'http://test.com');
      expect(result).toBeNull();
      expect(ApiDiagnosticsWriter.writeFailure).toHaveBeenCalledWith({
        url: 'http://test.com',
        errorType: 'empty_entries',
      });
    });

    it('should parse valid entries correctly', () => {
      const data = {
        entries: [
          {
            thread_title: 'Test Thread',
            query_str: 'What is 1+1?',
            blocks: [{ markdown_block: { answer: '2' } }],
          },
        ],
      };
      const result = extractor.parseConversationData(data, 'https://perplexity.ai/search/uuid');
      expect(result).not.toBeNull();
      expect(result?.title).toBe('Test Thread');
      expect(result?.content).toContain('What is 1+1?');
      expect(result?.content).toContain('2');
    });
  });
});

describe('ApiDiagnosticsWriter (Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should exist and have writeFailure method', () => {
    expect(ApiDiagnosticsWriter.writeFailure).toBeDefined();
  });
});
