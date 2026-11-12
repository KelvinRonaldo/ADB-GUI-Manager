import { describe, expect, it } from 'vitest';
import { ptBR } from './locales/pt-BR';
import { enUS } from './locales/en-US';

describe('dicionários', () => {
  it('têm as mesmas chaves nos dois idiomas', () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(ptBR).sort());
  });
  it('não têm texto vazio', () => {
    for (const [k, v] of [...Object.entries(ptBR), ...Object.entries(enUS)]) {
      expect(v.trim(), k).not.toBe('');
    }
  });
  it('usam os mesmos parâmetros nos dois idiomas', () => {
    const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(ptBR) as (keyof typeof ptBR)[]) {
      expect(params(enUS[k]), k).toBe(params(ptBR[k]));
    }
  });
});
