import { afterEach, describe, expect, it } from 'vitest';
import { errorText, setLocale, t } from '../src/lib/i18n.svelte';
import { SteamApiError } from '../src/lib/steam/api';

describe('i18n', () => {
  afterEach(() => setLocale('de'));

  it('switches language and fills in params', () => {
    setLocale('de');
    expect(t('library.count', { n: 3 })).toBe('3 Spiele');
    setLocale('en');
    expect(t('library.count', { n: 3 })).toBe('3 games');
  });

  it('picks singular or plural by the count', () => {
    setLocale('en');
    expect(t('library.count', { n: 1 })).toBe('1 game');
    expect(t('notify.missable', { game: 'X', n: 1 })).toBe('⚠ X: 1 missable achievement open');
    expect(t('focus.count', { n: 2, g: 1 })).toBe('2 achievements in 1 game');
    setLocale('de');
    expect(t('notify.newAch', { game: 'X', n: 1 })).toBe('✨ X: 1 neues Achievement');
    expect(t('sync.failedGames', { n: 2 })).toMatch(/^2 Spiele konnten/);
  });

  it('translates Steam errors by kind and keeps other messages', () => {
    setLocale('en');
    expect(errorText(new SteamApiError('private', 'raw'))).toMatch(/private/i);
    expect(errorText(new SteamApiError('parse', 'GetSchemaForGame 1: unexpected response'))).toBe('GetSchemaForGame 1: unexpected response');
    expect(errorText(new Error('boom'))).toBe('boom');
  });
});
