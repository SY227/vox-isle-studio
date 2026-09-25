/** Bounded-concurrency annotation orchestration. Transport retries live in gemini.mjs. */
import {buildTeachingBatches, missingTeachingBatch, applyTeachingBatches} from '../shared/annotations.mjs';

function stopOnAbort(signal, error) {
  if (signal?.aborted || ['CANCELLED', 'TIMEOUT', 'GEMINI_401', 'GEMINI_403', 'GEMINI_404'].includes(error?.code)) {
    throw error || signal.reason || new DOMException('Cancelled', 'AbortError');
  }
}

export async function annotateTranscript(transcript, requestBatch, {signal, onProgress = () => {}, concurrency = 2} = {}) {
  const batches = buildTeachingBatches(transcript);
  if (!batches.length) return transcript;
  const results = new Array(batches.length), usage = [], failures = [];
  let next = 0, completed = 0, examined = 0, fatalError;
  const stop = error => {
    try { stopOnAbort(signal, error); } catch (fatal) { fatalError = fatal; throw fatal; }
  };
  const total = batches.reduce((n, b) => n + b.tokenCount, 0);
  const emit = () => onProgress({phase: 'analyzing', message: `正在整理全曲唱法 · ${examined} / ${total} 字`,
    detail: {stage: 'teaching', completedBatches: completed, totalBatches: batches.length, examinedTokens: examined, totalTokens: total}});
  emit();
  const worker = async () => {
    while (next < batches.length && !fatalError) {
      if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
      const index = next++, batch = batches[index];
      let result;
      try {
        result = await requestBatch(batch);
        if (fatalError) return; // Another worker failed; schedule nothing further.
        if (result.usage) usage.push(result.usage);
        // A complete, explicitly uncertain response is NOT forced into a class.
        // Only omitted/malformed IDs get a single bounded repair request.
        const missing = missingTeachingBatch(batch, result.annotations);
        if (result.status === 'ok' && missing.tokenCount) {
          try {
            const repair = await requestBatch(missing);
            if (fatalError) return;
            if (repair.usage) usage.push(repair.usage);
            for (const [id, annotation] of repair.annotations) result.annotations.set(id, annotation);
            for (const [id, coach] of repair.coaching) result.coaching.set(id, coach);
          } catch (e) { stop(e); failures.push({batch: index, stage: 'repair', code: e.code || 'INVALID_TEACHING'}); }
        }
        results[index] = result;
      } catch (e) {
        stop(e);
        failures.push({batch: index, stage: 'annotation', code: e.code || 'INVALID_TEACHING'});
      }
      if (fatalError) return;
      completed++; examined += batch.tokenCount; emit();
    }
  };
  await Promise.all(Array.from({length: Math.max(1, Math.min(2, concurrency, batches.length))}, () => worker()));
  const analysis = applyTeachingBatches(transcript, results);
  return {...analysis, provenance: {...transcript.provenance, kind: 'ai-estimate',
      transport: transcript.provenance?.pipeline==='audio-first-v1'?'recording-first-listen-review-teaching':'youtube-transcript-id-teaching', coverage: 'fixed-transcript; all-occurrences-scheduled',
      teachingBatches: batches.length, failedTeachingBatches: failures.length},
    usage: {inputTokens: (transcript.usage?.inputTokens || 0) + usage.reduce((n, u) => n + (u.inputTokens || 0), 0),
      outputTokens: (transcript.usage?.outputTokens || 0) + usage.reduce((n, u) => n + (u.outputTokens || 0), 0)}};
}
