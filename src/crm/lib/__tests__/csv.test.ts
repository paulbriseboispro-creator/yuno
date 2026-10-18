import { describe, expect, it } from 'vitest';
import { csvCell } from '@/crm/lib/csv';

// Audit du 18/10, SEC-05 : pas d'injection de formule dans les exports CSV.
describe('csvCell', () => {
  it('neutralise un texte lu comme une formule', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csvCell('+33612345678')).toBe("'+33612345678");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });
  it('laisse le reste tel quel', () => {
    expect(csvCell('Léa Martin')).toBe('Léa Martin');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(true)).toBe('1');
    expect(csvCell(null)).toBe('');
    expect(csvCell('a;b')).toBe('"a;b"');
  });
});
