/** Match min(rows, columns) pairs in a dense, rectangular bounded-cost matrix. */
function dimensions(costs) {
  if (!Array.isArray(costs)) throw new TypeError('Costs must be a matrix.');
  if (!costs.length) return [0, 0];
  if (!Array.isArray(costs[0])) throw new TypeError('Costs must be a matrix.');
  const columns = costs[0].length;
  for (let row = 0; row < costs.length; row += 1) {
    if (!Array.isArray(costs[row]) || costs[row].length !== columns) throw new RangeError('Costs must be dense and rectangular.');
    for (let column = 0; column < columns; column += 1) {
      if (!Number.isFinite(costs[row][column]) || Math.abs(costs[row][column]) > 1e9) {
        throw new RangeError('Every cost must be finite and within ±1,000,000,000.');
      }
    }
  }
  return [costs.length, columns];
}

/** Nearest-pair greedy matching. Ties retain ascending row, then column order. */
export function greedyAssignment(costs) {
  const [rows, columns] = dimensions(costs);
  const usedRows = new Set(), usedColumns = new Set(), pairs = [];
  while (pairs.length < Math.min(rows, columns)) {
    let best = null;
    for (let row = 0; row < rows; row += 1) {
      if (usedRows.has(row)) continue;
      for (let column = 0; column < columns; column += 1) {
        if (!usedColumns.has(column) && (!best || costs[row][column] < best.cost)) best = { row, column, cost: costs[row][column] };
      }
    }
    usedRows.add(best.row); usedColumns.add(best.column); pairs.push([best.row, best.column]);
  }
  return pairs.sort((a, b) => a[0] - b[0]);
}

/** Hungarian algorithm, primal-dual shortest-augmenting-path implementation.
 * Minimizes the sum for this matrix; it does not optimize a multi-stop mission.
 * Deterministic iteration resolves equal-cost choices without random tie breaks.
 */
export function hungarianAssignment(costs) {
  const [rows, columns] = dimensions(costs);
  if (!rows || !columns) return [];
  if (rows > columns) return hungarianAssignment(Array.from({ length: columns }, (_, column) => costs.map((row) => row[column])))
    .map(([column, row]) => [row, column]).sort((a, b) => a[0] - b[0]);
  // p[j] is the row matched to column j. Column zero roots each augmenting path.
  const u = Array(rows + 1).fill(0), v = Array(columns + 1).fill(0);
  const p = Array(columns + 1).fill(0), way = Array(columns + 1).fill(0);
  for (let row = 1; row <= rows; row += 1) {
    p[0] = row;
    let column = 0;
    const minimum = Array(columns + 1).fill(Infinity), visited = Array(columns + 1).fill(false);
    do {
      visited[column] = true;
      const currentRow = p[column];
      let delta = Infinity, nextColumn = 0;
      for (let candidate = 1; candidate <= columns; candidate += 1) {
        if (visited[candidate]) continue;
        const reduced = costs[currentRow - 1][candidate - 1] - u[currentRow] - v[candidate];
        if (reduced < minimum[candidate]) { minimum[candidate] = reduced; way[candidate] = column; }
        if (minimum[candidate] < delta) { delta = minimum[candidate]; nextColumn = candidate; }
      }
      for (let candidate = 0; candidate <= columns; candidate += 1) {
        if (visited[candidate]) { u[p[candidate]] += delta; v[candidate] -= delta; }
        else minimum[candidate] -= delta;
      }
      column = nextColumn;
    } while (p[column] !== 0);
    do {
      const previous = way[column];
      p[column] = p[previous];
      column = previous;
    } while (column !== 0);
  }
  return p.slice(1).flatMap((row, column) => row ? [[row - 1, column]] : []).sort((a, b) => a[0] - b[0]);
}

export const assignmentCost = (costs, pairs) => pairs.reduce((total, [row, column]) => total + costs[row][column], 0);
