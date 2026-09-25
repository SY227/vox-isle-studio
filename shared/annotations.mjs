/**
 * Fixed-transcript teaching: every occurrence has a stable ID. Never attach a
 * technique to a nearby word, infer it from pitch alone, or invent missing data.
 * Both the server and the UI can inspect coverage without depending on an LLM.
 */
import {TECHNIQUES, ORNAMENTS} from './music.mjs';
import {midi} from './recovery.mjs';
import {normalizeAnalysis} from './schema.mjs';

const clean = (value, max = 700) => typeof value === 'string' ? value.slice(0, max) : '';
export const phraseId = index => `p${index}`;
export const tokenId = (pi, ti) => `p${pi}t${ti}`;

export function teachingCoverage(analysis) {
  const tokens = (analysis?.phrases || []).flatMap(p => p.tokens || []);
  const identified = tokens.filter(t => t.technique && t.technique !== 'unknown' && Object.hasOwn(TECHNIQUES, t.technique)).length;
  const reviewed = tokens.filter(t => ['reviewed','uncertain'].includes(t.annotationStatus)).length;
  const missing = tokens.filter(t => ['missing', 'unavailable'].includes(t.annotationStatus)).length;
  return {total: tokens.length, identified, unknown: tokens.length - identified, reviewed, missing};
}

/** The upper bound is per request, not a cap on how many lyrics are taught. */
export function buildTeachingBatches(transcript, {maxTokens = 120, maxPhrases = 8} = {}) {
  if (!Number.isInteger(maxTokens) || maxTokens < 64 || !Number.isInteger(maxPhrases) || maxPhrases < 1) {
    throw new Error('Invalid teaching batch limits');
  }
  const batches = [];
  let phrases = [], size = 0;
  const flush = () => {
    if (!phrases.length) return;
    batches.push({index: batches.length, start: phrases[0].start,
      end: phrases.at(-1).end, phrases, tokenCount: size});
    phrases = []; size = 0;
  };
  (transcript.phrases || []).forEach((p, pi) => {
    if (phrases.length && (size + p.tokens.length > maxTokens || phrases.length >= maxPhrases)) flush();
    phrases.push({id: phraseId(pi), section: p.section, start: p.start, end: p.end,
      tokens: p.tokens.map((t, ti) => ({id: tokenId(pi, ti), text: t.text,
        romanization: t.romanization, start: t.start, end: t.end}))});
    size += p.tokens.length;
  });
  flush();
  return batches.map(b => ({...b, totalBatches: batches.length}));
}

/** Keep stable IDs when asking once for only the items omitted by a response. */
export function missingTeachingBatch(batch, annotations) {
  const phrases = batch.phrases.map(p => ({...p, tokens: p.tokens.filter(t => !annotations.has(t.id))}))
    .filter(p => p.tokens.length);
  return {...batch, phrases, tokenCount: phrases.reduce((n, p) => n + p.tokens.length, 0), repair: true};
}


/** Convert omitted or unavailable teaching entries into an explicit uncertainty.
 * This never invents a register: it only prevents a processed word from
 * disappearing from the UI after a partial provider response.
 */
export function settleTeachingBatch(batch, result = {}) {
  const annotations = new Map(result.annotations instanceof Map ? result.annotations : []);
  const coaching = new Map(result.coaching instanceof Map ? result.coaching : []);
  for (const p of batch.phrases || []) for (const t of p.tokens || []) {
    if (!annotations.has(t.id)) annotations.set(t.id, {notes:[], technique:'unknown', ornaments:[], confidence:'low', annotationStatus:'uncertain'});
  }
  return {status: result.status === 'ok' ? 'ok' : 'unavailable', annotations, coaching,
    key: clean(result.key, 50), tempo: Number.isFinite(result.tempo) ? result.tempo : null,
    summary: clean(result.summary), warnings: Array.isArray(result.warnings) ? result.warnings.slice(0,4).map(w=>clean(w,400)) : [], missing: []};
}

export function normalizeTeachingBatch(raw, batch) {
  if (!raw || typeof raw !== 'object' || !['ok','unavailable'].includes(raw.status)) {
    throw new Error('唱法資料格式不正確。');
  }
  const expected = new Map(batch.phrases.flatMap(p => p.tokens.map(t => [t.id, {...t, phraseId: p.id}])));
  const allowedPhrases = new Set(batch.phrases.map(p => p.id));
  const annotations = new Map(), coaching = new Map(), seen = new Set(), duplicated = new Set();
  if (raw.status === 'ok' && !Array.isArray(raw.phrases)) throw new Error('唱法資料缺少樂句。');
  for (const p of (raw.phrases || []).slice(0, 100)) {
    if (!p || !allowedPhrases.has(p.id)) continue;
    coaching.set(p.id, Object.fromEntries(['focus','instruction','pronunciation','exercise','caution']
      .map(key => [key, clean(p[key], key === 'focus' ? 160 : 700)])));
    for (const t of (Array.isArray(p.tokens) ? p.tokens : []).slice(0, 1200)) {
      const target = expected.get(t?.id);
      if (!target || target.phraseId !== p.id) continue;
      if (seen.has(t.id)) { duplicated.add(t.id); annotations.delete(t.id); continue; }
      seen.add(t.id);
      // Text is an integrity check; identical words in different choruses still
      // have different IDs. Returning the wrong occurrence cannot shift a score.
      if (t.text !== target.text || !Object.hasOwn(TECHNIQUES, t.technique) ||
          !Array.isArray(t.notes) || !Array.isArray(t.ornaments)) continue;
      const notes = t.notes.slice(0, 16).map(midi).filter(n => n !== null);
      annotations.set(t.id, {notes, technique: t.technique,
        ornaments: [...new Set(t.ornaments.filter(o => Object.hasOwn(ORNAMENTS, o)))].slice(0,5),
        confidence: ['low','medium','high'].includes(t.confidence) ? t.confidence : 'low',
        annotationStatus: 'reviewed'});
    }
  }
  for (const id of duplicated) annotations.delete(id);
  return {status: raw.status, annotations, coaching,
    key: clean(raw.key, 50), tempo: Number.isFinite(raw.tempo) && raw.tempo >= 20 && raw.tempo <= 300 ? raw.tempo : null,
    summary: clean(raw.summary), warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).slice(0, 4).map(w => clean(w, 400)),
    missing: [...expected.keys()].filter(id => !annotations.has(id))};
}

export function applyTeachingBatches(transcript, results) {
  const annotations = new Map(), coaching = new Map();
  for (const result of results.filter(Boolean)) {
    for (const [id, value] of result.annotations) annotations.set(id, value);
    for (const [id, value] of result.coaching) coaching.set(id, value);
  }
  const phrases = transcript.phrases.map((p, pi) => {
    const coach = coaching.get(phraseId(pi));
    return {...p,
      ...(coach ? Object.fromEntries(Object.entries(coach).filter(([, value]) => value)) : {}),
      tokens: p.tokens.map((t, ti) => ({...t, ...(annotations.get(tokenId(pi, ti)) || {
        notes: t.notes || [], technique: t.technique || 'unknown', ornaments: t.ornaments || [],
        confidence: t.confidence || 'low', annotationStatus: 'missing'
      })}))};
  });
  const coverage = teachingCoverage({phrases});
  const first = results.find(r => r && (r.key || r.summary));
  const warnings = [...new Set([
    ...(transcript.warnings || []).filter(w => !/未加入音高或唱法/.test(w)),
    ...results.filter(Boolean).flatMap(r => r.warnings || []),
    '唱法是可嘗試的練習建議，不是原唱聲區的生理判定；時間與音高仍需核對。',
    ...(coverage.missing ? [`${coverage.missing} 個字的唱法尚未取得，歌詞與原有時間仍完整保留。`] : []),
    ...(coverage.unknown > coverage.missing ? [`${coverage.unknown - coverage.missing} 個字的唱法仍不確定，未強行標成真聲或假聲。`] : [])
  ])].slice(0, 12);
  // The transcript pass intentionally had no pitch annotations. Recalculate
  // that counter after teaching rather than retaining a stale all-unknown flag.
  const quality = {...transcript.dataQuality,
    unknownPitchTokens: phrases.flatMap(p => p.tokens).filter(t => !t.notes.length).length};
  quality.mode = coverage.unknown || ['untimedTokens','omittedNotes','unknownPitchTokens','croppedTokens','reorderedGroups']
    .some(key => quality[key] > 0) ? 'partial' : 'complete';
  const normalized = normalizeAnalysis({...transcript, phrases, key: first?.key || transcript.key,
    tempo: first?.tempo ?? transcript.tempo, summary: first?.summary || transcript.summary, warnings,
    dataQuality: quality,
    teachingCoverage: coverage});
  return {...normalized, teachingCoverage: coverage};
}
