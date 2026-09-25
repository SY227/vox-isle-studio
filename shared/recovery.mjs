/** Deterministic recovery of AI output. Never invent notes, timings, or lyrics.
 * Strict schema validation still runs AFTER recovery and on manual edits/imports.
 */
import {TECHNIQUES, ORNAMENTS} from './music.mjs';
import {normalizeAnalysis} from './schema.mjs';

export function seconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (/^[-+]?\d+(?:\.\d+)?s?$/.test(s)) return Number(s.replace(/s$/, ''));
  if (/^\d{1,3}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(s)) {
    const parts = s.split(':').map(Number);
    if (parts.slice(1).some(n => n >= 60)) return null;
    return parts.reduce((n, p) => n * 60 + p, 0);
  }
  return null;
}

export function midi(value) {
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(s)) value = Number(s);
    else {
      const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(s);
      if (!m) return null;
      value = (Number(m[3]) + 1) * 12 + {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1].toUpperCase()] +
        (['#','♯'].includes(m[2]) ? 1 : ['b','♭'].includes(m[2]) ? -1 : 0);
    }
  }
  // 440 is NOT assumed to mean Hz. Out-of-range notes are unknown, not clamped.
  return typeof value === 'number' && Number.isFinite(value) && value >= 24 && value <= 108 ? value : null;
}

export function recoverAnalysis(raw, {sourceDuration, limit = 360} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('沒有收到可用的分析物件。');
  if (raw.status !== 'ok') return normalizeAnalysis(raw);
  if (!Array.isArray(raw.phrases)) throw new Error('分析未包含樂句資料。');
  const ceiling = Math.min(360, Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : limit);
  const quality = {version:1, normalizedFields:0, omittedNotes:0, unknownPitchTokens:0,
    untimedTokens:0, timedTokens:0, croppedTokens:0, reorderedGroups:0, mode:'complete'};
  const text = (v, max = 700) => {
    if (typeof v !== 'string') { quality.normalizedFields++; return ''; }
    if (v.length > max) quality.normalizedFields++;
    return v.slice(0, max);
  };
  const time = v => { const n = seconds(v); if (n !== null && typeof v !== 'number') quality.normalizedFields++; return n; };
  const unalignedLyrics = [], phrases = [];
  let processed = 0;
  for (const p of raw.phrases.slice(0, 100)) {
    if (!p || !Array.isArray(p.tokens)) continue;
    const tokens = [], untimed = [];
    for (const t of p.tokens.slice(0, 64)) {
      if (++processed > 1200) break;
      if (!t || typeof t.text !== 'string' || !t.text.trim()) continue;
      const word = text(t.text, 20);
      let start = time(t.start), end = time(t.end);
      // Only sub-frame negative roundoff is repaired; real negative/missing/reversed
      // timestamps stay untimed. We never distribute words evenly over a phrase.
      if (start !== null && start < 0 && start >= -0.05) { start = 0; quality.normalizedFields++; }
      if (start !== null && start >= ceiling) { quality.croppedTokens++; continue; }
      if (start === null || end === null || start < 0 || end <= start || end < 0) {
        untimed.push(word); quality.untimedTokens++; continue;
      }
      if (end > ceiling) { end = ceiling; quality.croppedTokens++; }
      if (end - start < 0.001) { untimed.push(word); quality.untimedTokens++; continue; }
      const sourceNotes = Array.isArray(t.notes) ? t.notes : t.notes == null ? [] : [t.notes];
      const notes = [];
      for (const n of sourceNotes.slice(0, 16)) {
        const converted = midi(n);
        if (converted === null) quality.omittedNotes++;
        else { notes.push(converted); if (typeof n !== 'number') quality.normalizedFields++; }
      }
      if (sourceNotes.length > 16) quality.omittedNotes += sourceNotes.length - 16;
      const technique = Object.hasOwn(TECHNIQUES, t.technique) ? t.technique : 'unknown';
      if (technique !== t.technique) quality.normalizedFields++;
      const ornaments = [...new Set((Array.isArray(t.ornaments) ? t.ornaments : []).filter(o => Object.hasOwn(ORNAMENTS, o)))].slice(0,5);
      if (!notes.length) quality.unknownPitchTokens++;
      tokens.push({text:word, romanization:text(t.romanization,90), start, end, notes, technique, ornaments,
        confidence: notes.length && ['low','medium','high'].includes(t.confidence) ? t.confidence : 'low'});
    }
    if (untimed.length) unalignedLyrics.push(untimed.join(''));
    if (!tokens.length) continue;
    if (tokens.some((t, i) => i && t.start < tokens[i-1].start)) quality.reorderedGroups++;
    tokens.sort((a,b) => a.start-b.start);
    const first = tokens[0].start, last = Math.max(...tokens.map(t=>t.end));
    const ps = time(p.start), pe = time(p.end);
    // Expand a phrase envelope to contain its actual token timestamps. No word moves.
    const start = ps !== null && ps >= 0 && ps <= first ? ps : first;
    const end = pe !== null && pe >= last && pe <= ceiling ? pe : last;
    if (start !== ps || end !== pe) quality.normalizedFields++;
    phrases.push({start, end, section:text(p.section,40), tokens, focus:text(p.focus,160),
      instruction:text(p.instruction), pronunciation:text(p.pronunciation), exercise:text(p.exercise), caution:text(p.caution)});
    quality.timedTokens += tokens.length;
    if (processed >= 1200) break;
  }
  if (!phrases.length && !unalignedLyrics.length) throw new Error('沒有辨識出可保留的主唱歌詞。');
  const rawDuration = time(raw.duration);
  const last = Math.max(0, ...phrases.map(p=>p.end));
  // This is the ANALYSIS horizon, not a verified media duration. The player uses its own duration.
  const duration = Math.min(ceiling, Math.max(last, rawDuration > 0 ? rawDuration : ceiling));
  const tempoValue = typeof raw.tempo === 'string' && /^\d+(\.\d+)?$/.test(raw.tempo.trim()) ? Number(raw.tempo) : raw.tempo;
  const tempo = Number.isFinite(tempoValue) && tempoValue >= 20 && tempoValue <= 300 ? tempoValue : null;
  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : []).slice(0,7).map(w=>text(w,400));
  if (quality.normalizedFields) warnings.push('已整理數字／音名格式與樂句範圍；這不代表音訊辨識已驗證。');
  if (quality.omittedNotes) warnings.push(`已移除 ${quality.omittedNotes} 個無效音高，保留歌詞並標示待確認；未替換成猜測音符。`);
  if (quality.untimedTokens) warnings.push(`${quality.untimedTokens} 個字缺少可靠時間，保留在「待對齊歌詞」，不參與同步亮字。`);
  if (quality.croppedTokens || rawDuration > ceiling) warnings.push(`本次教學範圍最多到 ${ceiling} 秒；原片仍可正常播放，不會被此範圍截停。`);
  if (quality.reorderedGroups) warnings.push('部分時間順序已整理，請核對歌詞順序與原片。');
  quality.mode = quality.untimedTokens || quality.omittedNotes || quality.unknownPitchTokens || quality.croppedTokens || quality.reorderedGroups ? 'partial' : 'complete';
  const normalized = normalizeAnalysis({status:'ok',reason:'',title:text(raw.title,160)||'未命名歌曲',artist:text(raw.artist,160),
    language:['cantonese','mandarin','mixed','unknown'].includes(raw.language)?raw.language:'unknown', duration,
    key:text(raw.key,50)||'待確認',tempo, summary:text(raw.summary),warnings:warnings.slice(0,12),phrases,
    unalignedLyrics, dataQuality:quality});
  return normalized;
}
