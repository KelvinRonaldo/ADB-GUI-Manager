import { describe, expect, it } from 'vitest';
import { classifyUpdateError, noteLines, whenText } from './update.svelte';

describe('classifyUpdateError', () => {
  it('lê o código que o Rust devolve', () => {
    expect(classifyUpdateError('UPDATE_NETWORK: timed out').kind).toBe('network');
    expect(classifyUpdateError('Error: UPDATE_INTERRUPTED: reset').kind).toBe('interrupted');
    expect(classifyUpdateError('UPDATE_SIGNATURE: mismatch').kind).toBe('signature');
    expect(classifyUpdateError('UPDATE_PERMISSION: denied').kind).toBe('permission');
    expect(classifyUpdateError('UPDATE_AUTH: pkexec').kind).toBe('auth');
    expect(classifyUpdateError('UPDATE_NO_PACKAGE: windows-x86_64-portable').kind).toBe('noPackage');
    expect(classifyUpdateError('qualquer outra coisa').kind).toBe('generic');
  });
  it('guarda o texto original para os detalhes', () => {
    expect(classifyUpdateError('UPDATE_INSTALL: falhou').raw).toBe('UPDATE_INSTALL: falhou');
  });
});

describe('noteLines', () => {
  it('tira marcadores de lista e títulos e ignora linhas vazias', () => {
    expect(noteLines('## Novidades\n- Um\n\n* Dois\n• Três')).toEqual(['Novidades', 'Um', 'Dois', 'Três']);
    expect(noteLines(null)).toEqual([]);
  });
});

describe('whenText', () => {
  it('diz hoje e ontem', () => {
    const now = new Date(2026, 10, 13, 10, 0).getTime();
    expect(whenText(new Date(2026, 10, 13, 9, 12).getTime(), now)).toMatch(/^hoje, 09:12$/);
    expect(whenText(new Date(2026, 10, 12, 18, 40).getTime(), now)).toMatch(/^ontem, 18:40$/);
  });
});
