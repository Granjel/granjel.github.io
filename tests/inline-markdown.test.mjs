import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInline, plainInline } from '../assets/inline-markdown.js';
import { keywordKey, normalizeKeyword, normalizeKeywords } from '../assets/publication-utils.js';

test('renders scientific emphasis and bold while keeping a plain-text equivalent', () => {
  const source = 'Signals in *Arabidopsis thaliana* show **consistent effects**.';
  assert.equal(formatInline(source), 'Signals in <em>Arabidopsis thaliana</em> show <strong>consistent effects</strong>.');
  assert.equal(plainInline(source), 'Signals in Arabidopsis thaliana show consistent effects.');
  assert.equal(formatInline('**Effects of *Arabidopsis thaliana***'), '<strong>Effects of <em>Arabidopsis thaliana</em></strong>');
  assert.equal(formatInline('*Effects of **warming** on growth*'), '<em>Effects of <strong>warming</strong> on growth</em>');
});

test('raw HTML and Markdown link syntax never create active elements', () => {
  const source = '*<img src=x onerror="alert(1)">* & [click](javascript:alert(1))';
  assert.equal(formatInline(source), '<em>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</em> &amp; [click](javascript:alert(1))');
  assert.equal(formatInline('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(plainInline(source), '<img src=x onerror="alert(1)"> & [click](javascript:alert(1))');
});

test('escaped and unmatched stars stay literal and whitespace-only spans are not formatted', () => {
  assert.equal(formatInline('Use \\*literal stars\\* and *unclosed'), 'Use *literal stars* and *unclosed');
  assert.equal(plainInline('Use \\*literal stars\\* and *unclosed'), 'Use *literal stars* and *unclosed');
  assert.equal(formatInline('2 * 3; * *; ** **'), '2 * 3; * *; ** **');
});

test('italic scientific keywords keep their case, group with plain labels, and remain idempotent', () => {
  assert.equal(normalizeKeyword('*Arabidopsis thaliana*'), '*Arabidopsis thaliana*');
  assert.equal(keywordKey('*Arabidopsis thaliana*'), keywordKey('Arabidopsis thaliana'));
  const labels = normalizeKeywords(['arabidopsis thaliana', '*Arabidopsis thaliana*', '**DNA**', 'dna', '*co-existence*', 'coexistence']);
  assert.deepEqual(labels, ['*Arabidopsis thaliana*', '**DNA**', '*Coexistence*']);
  assert.deepEqual(normalizeKeywords(labels), labels);
});
