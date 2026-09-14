import test from 'node:test';
import assert from 'node:assert/strict';
import { greedyAssignment, hungarianAssignment, assignmentCost } from '../src/assignment.js';

// Independent exhaustive oracle, deliberately unrelated to dual potentials.
function minimumCost(costs) {
  if (!costs.length || !costs[0].length) return 0;
  if (costs.length > costs[0].length) return minimumCost(costs[0].map((_, column) => costs.map((row) => row[column])));
  function visit(row, used, total) {
    if (row === costs.length) return total;
    let best = Infinity;
    for (let column = 0; column < costs[0].length; column += 1) {
      if (!used.has(column)) best = Math.min(best, visit(row + 1, new Set([...used, column]), total + costs[row][column]));
    }
    return best;
  }
  return visit(0, new Set(), 0);
}

test('Hungarian matches an exhaustive oracle for rectangular matrices in both orientations', () => {
  let seed = 619;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let rows = 1; rows <= 5; rows += 1) for (let columns = 1; columns <= 5; columns += 1) {
    for (let trial = 0; trial < 8; trial += 1) {
      const costs = Array.from({ length: rows }, () => Array.from({ length: columns }, () => Math.floor(random() * 17) - 5 + random() / 10));
      const pairs = hungarianAssignment(costs);
      assert.equal(pairs.length, Math.min(rows, columns));
      assert.equal(new Set(pairs.map(([row]) => row)).size, pairs.length);
      assert.equal(new Set(pairs.map(([, column]) => column)).size, pairs.length);
      assert.ok(Math.abs(assignmentCost(costs, pairs) - minimumCost(costs)) < 1e-10);
    }
  }
});

test('a nearest pair can force a worse overall matching', () => {
  const costs = [[0.8, 2], [1.2, 4]];
  assert.deepEqual(greedyAssignment(costs), [[0, 0], [1, 1]]);
  assert.deepEqual(hungarianAssignment(costs), [[0, 1], [1, 0]]);
  assert.ok(assignmentCost(costs, hungarianAssignment(costs)) < assignmentCost(costs, greedyAssignment(costs)));
});

test('ties and empty sides are deterministic and do not mutate the matrix', () => {
  const costs = [[1, 1, 1], [1, 1, 1]], original = structuredClone(costs);
  for (const algorithm of [greedyAssignment, hungarianAssignment]) {
    assert.deepEqual(algorithm([]), []);
    assert.deepEqual(algorithm([[], []]), []);
    assert.deepEqual(algorithm(costs), algorithm(costs));
    assert.equal(assignmentCost(costs, algorithm(costs)), 2);
    assert.deepEqual(costs, original);
  }
});

test('ragged, sparse, nonfinite and overflowing inputs fail explicitly', () => {
  for (const algorithm of [greedyAssignment, hungarianAssignment]) {
    for (const costs of [[[1], [1, 2]], [[NaN]], [[Infinity]], [[1e300]], [Array(1)], [[1], , [2]], Array(1)]) {
      assert.throws(() => algorithm(costs));
    }
  }
});
