import { describe, expect, it } from 'vitest';
import { simulateExample } from '../../src/simulation/example';
describe('bounded stock example', () => {
  it('matches the defined slot with the example cutter and flags rapid entry', () => {
    expect(simulateExample(2)).toMatchObject({missed:0, excess:0, rapidContacts:[]});
    expect(simulateExample(2, true).rapidContacts).toEqual([1]);
  });
  it('distinguishes undercut from overcut as cutter diameter changes', () => {
    const small=simulateExample(1), large=simulateExample(3);
    expect(small.missed).toBeGreaterThan(0); expect(small.excess).toBe(0);
    expect(large.excess).toBeGreaterThan(0); expect(large.missed).toBe(0);
  });
});
