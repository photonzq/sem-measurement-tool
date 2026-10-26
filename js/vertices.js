"use strict";
/* exported moveSelected, dropSelected, makeFirst, reverseContour, selectionRange */
/*
 * Operations on the vertex list of a contour, as the vertex window applies them.  Each takes the
 * points (stored coordinates) and the selected indices, and returns new ones; the arguments are
 * left untouched, so that the caller can record the state before for undo.
 */

/**
 * The selected vertices moved one place earlier (step -1) or later (+1) in the order, as blocks:
 * a vertex moves only into a place that is not selected, so neighbouring selected vertices keep
 * their order, and a block already at the start (or end) stays.
 * @param {Point[]} points
 * @param {number[]} selected
 * @param {number} step       -1 or 1
 * @returns {{points: Point[], selected: number[]}}
 */
function moveSelected(points, selected, step) {
  const out = points.slice();
  const sel = new Set(selected);
  const order = [...sel].sort((a, b) => (step < 0 ? a - b : b - a));     // the leading end first
  for (const i of order) {
    const j = i + step;
    if (j >= 0 && j < out.length && !sel.has(j)) {
      [out[i], out[j]] = [out[j], out[i]];
      sel.delete(i);
      sel.add(j);
    }
  }
  return { points: out, selected: [...sel].sort((a, b) => a - b) };
}

/**
 * The points without the selected ones.
 * @param {Point[]} points
 * @param {number[]} selected
 * @returns {Point[]}
 */
function dropSelected(points, selected) {
  const sel = new Set(selected);
  return points.filter((_, i) => !sel.has(i));
}

/**
 * A closed contour renumbered to start at vertex ``index``: the same polygon.
 * @param {Point[]} points
 * @param {number} index
 * @returns {Point[]}
 */
function makeFirst(points, index) {
  return [...points.slice(index), ...points.slice(0, index)];
}

/**
 * The contour run the other way.  A closed one keeps its first vertex, [p0, p(n-1), ..., p1]; an
 * open one swaps its ends.  The selected indices follow their vertices.
 * @param {Point[]} points
 * @param {boolean} closed
 * @param {number[]} selected
 * @returns {{points: Point[], selected: number[]}}
 */
function reverseContour(points, closed, selected) {
  const n = points.length;
  /** @param {number} i */
  const to = (i) => (closed ? (n - i) % n : n - 1 - i);
  /** @type {Point[]} */
  const out = new Array(n);
  points.forEach((p, i) => {
    out[to(i)] = p;
  });
  return { points: out, selected: selected.map(to).sort((a, b) => a - b) };
}

/**
 * The indices from ``a`` to ``b``, both included, in either order.
 * @param {number} a
 * @param {number} b
 * @returns {number[]}
 */
function selectionRange(a, b) {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
}
