/** Scientific pitch notation uses A4=440 Hz and middle C=C4. */
export const NOTE_NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
export const midiToHz = midi => 440 * 2 ** ((midi - 69) / 12);
export const hzToMidi = hz => hz > 0 ? 69 + 12 * Math.log2(hz / 440) : null;
export function noteName(midi) {
  if (!Number.isFinite(midi)) return '—';
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
export function clock(seconds = 0, decimal = false) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}${decimal ? '.' + Math.floor((s % 1) * 10) : ''}`;
}
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const median = a => { const b = [...a].sort((x,y)=>x-y); return b.length ? b[Math.floor(b.length/2)] : null; };
export function parseYouTube(value) {
  let u;
  try { u = new URL(value.trim()); } catch { return null; }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (/^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split('/')[2];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? {id, url:`https://www.youtube.com/watch?v=${id}`} : null;
}
export const TECHNIQUES = {
  chest: {label:'真聲', sub:'輕鬆、自然的聲音', color:'#e36f55'},
  mix: {label:'混聲', sub:'練習平順銜接', color:'#178f78'},
  head: {label:'頭聲', sub:'較輕巧的音色', color:'#7f6bc9'},
  falsetto: {label:'假聲', sub:'輕柔的音色選擇', color:'#3d95c8'},
  unknown: {label:'待確認', sub:'保留不確定性', color:'#7e8f92'}
};
export const ORNAMENTS = {run:'轉音', slide:'滑音', vibrato:'顫音', breath:'換氣', transition:'轉聲'};
export function rangeFromPhrases(phrases) {
  const notes = phrases.flatMap(p=>p.tokens.flatMap(t=>t.notes || [])).filter(Number.isFinite);
  if (!notes.length) return {low:null,high:null,typicalLow:null,typicalHigh:null};
  const sorted = [...notes].sort((a,b)=>a-b);
  return {low:sorted[0],high:sorted.at(-1),typicalLow:sorted[Math.floor(sorted.length*.15)],typicalHigh:sorted[Math.floor(sorted.length*.85)]};
}
