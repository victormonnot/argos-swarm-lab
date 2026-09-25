import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { workshops, themes, difficulties } from '../src/site/workshops.js';

const root = new URL('../', import.meta.url);
const byId = new Map(workshops.map((workshop) => [workshop.id, workshop]));

test('the catalog identifies every workshop once with a unique canonical route', () => {
  assert.deepEqual(workshops.map(({ id }) => id), Array.from({ length: 23 }, (_, index) => String(index + 1).padStart(2, '0')));
  assert.equal(new Set(workshops.map(({ slug }) => slug)).size, workshops.length);
  assert.equal(new Set(workshops.map(({ url }) => url)).size, workshops.length);
  for (const workshop of workshops) {
    assert.match(workshop.slug, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    assert.equal(workshop.url, `/${workshop.slug}/`);
  }
});

test('every catalog entry supports discovery and explicitly separates mode from fidelity', () => {
  assert.equal(new Set(themes).size, themes.length);
  assert.equal(new Set(difficulties).size, difficulties.length);
  for (const workshop of workshops) {
    for (const field of ['title', 'question', 'summary', 'preparation', 'fidelity', 'limitations']) {
      assert.equal(typeof workshop[field], 'string', `${workshop.id}: ${field}`);
      assert.ok(workshop[field].trim().length, `${workshop.id}: empty ${field}`);
    }
    assert.ok(themes.includes(workshop.theme), `${workshop.id}: unknown theme`);
    assert.ok(difficulties.includes(workshop.difficulty), `${workshop.id}: unknown difficulty`);
    assert.equal(workshop.mode, Number(workshop.id) <= 13 ? 'Interactive simulation' : 'Recorded replay');
    assert.ok(Array.isArray(workshop.tags) && workshop.tags.length > 0);
    assert.ok(workshop.tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0));
    assert.equal(new Set(workshop.tags).size, workshop.tags.length);
  }
  assert.deepEqual(new Set(workshops.map(({ theme }) => theme)), new Set(themes));
  assert.deepEqual(new Set(workshops.map(({ difficulty }) => difficulty)), new Set(difficulties));
});

test('recommended preparation references existing workshops without a dependency cycle', () => {
  for (const workshop of workshops) {
    for (const field of ['prerequisites', 'helpfulBefore']) {
      assert.ok(Array.isArray(workshop[field]), `${workshop.id}: ${field}`);
      assert.equal(new Set(workshop[field]).size, workshop[field].length);
      for (const id of workshop[field]) {
        assert.ok(byId.has(id), `${workshop.id}: unknown preparation ${id}`);
        assert.notEqual(id, workshop.id, `${workshop.id}: self-reference`);
      }
    }
    assert.ok(workshop.helpfulBefore.every((id) => !workshop.prerequisites.includes(id)), `${workshop.id}: duplicate preparation category`);
  }

  const visited = new Set();
  const active = new Set();
  function visit(id) {
    assert.ok(!active.has(id), `Preparation cycle includes ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    const workshop = byId.get(id);
    for (const prerequisite of [...workshop.prerequisites, ...workshop.helpfulBefore]) visit(prerequisite);
    active.delete(id);
    visited.add(id);
  }
  for (const workshop of workshops) visit(workshop.id);
});

test('every lesson and evidence link points to an existing public document', async () => {
  const referenced = new Set();
  for (const workshop of workshops) {
    for (const field of ['lessonBrief', 'resultsReference']) {
      const path = workshop[field];
      assert.match(path, /^\/docs\/lessons\/\d{2}-[a-z0-9-]+\.md$/);
      assert.ok(path.startsWith(`/docs/lessons/${workshop.id}-`), `${workshop.id}: mismatched document`);
      assert.ok((await stat(new URL(path.slice(1), root))).isFile(), path);
      assert.ok(!referenced.has(path), `Duplicate document reference: ${path}`);
      referenced.add(path);
    }
    assert.equal(workshop.resultsReference, workshop.lessonBrief.replace(/\.md$/, '-results.md'));
  }
});

test('catalog metadata remains independent of simulation and recording payloads', async () => {
  const source = await readFile(new URL('../src/site/workshops.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:^|\n)\s*import\b|\bimport\s*\(|\bexport\s+[^;\n]*\bfrom\s+['"]/);
  assert.doesNotMatch(source, /\brequire\s*\(|\bfetch\s*\(/);
});
