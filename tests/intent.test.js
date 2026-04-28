import { describe, it, expect } from 'vitest';
import { keywordIntentHint } from '../src/core/intent.js';

describe('keywordIntentHint', () => {
  it('returns CALENDAR for schedule-related phrases', () => {
    expect(keywordIntentHint('What is my schedule today?')).toBe('CALENDAR');
    expect(keywordIntentHint('Add a meeting for tomorrow')).toBe('CALENDAR');
    expect(keywordIntentHint('Set a reminder for 3pm')).toBe('CALENDAR');
    expect(keywordIntentHint('Show me my calendar')).toBe('CALENDAR');
    expect(keywordIntentHint('I have an appointment tomorrow')).toBe('CALENDAR');
  });

  it('returns CALENDAR for natural calendar phrases', () => {
    expect(keywordIntentHint("what's on my schedule")).toBe('CALENDAR');
    expect(keywordIntentHint('what do I have tomorrow at 5pm')).toBe('CALENDAR');
  });

  it('returns null for plain chat messages', () => {
    expect(keywordIntentHint('Hello there')).toBeNull();
    expect(keywordIntentHint('Explain quantum physics')).toBeNull();
    expect(keywordIntentHint('Write me a poem')).toBeNull();
  });

  it('returns SEARCH for web-search phrases when enabled', () => {
    const origEnabled = process.env.WEB_SEARCH;
    process.env.WEB_SEARCH = '1';
    expect(keywordIntentHint('search for latest news about AI')).toBe('SEARCH');
    expect(keywordIntentHint('look up information about climate change')).toBe('SEARCH');
    expect(keywordIntentHint('google the current price of bitcoin')).toBe('SEARCH');
    process.env.WEB_SEARCH = origEnabled;
  });
});