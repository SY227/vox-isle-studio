/** Timing state is orthogonal to technique/color and always uses source seconds. */
export function lyricState(start, end, mediaTime, offset = 0) {
  const time = Math.max(0, (Number.isFinite(mediaTime) ? mediaTime : 0) - offset);
  return time >= end ? 'played' : time < start ? 'upcoming' : 'current';
}

/** Unknown word boundaries follow only their parent line. No made-up gold word. */
export function tokenLyricState(token,phrase,mediaTime,offset=0){
  if(Number.isFinite(token.start)&&Number.isFinite(token.end))return lyricState(token.start,token.end,mediaTime,offset);
  return lyricState(phrase.start,phrase.end,mediaTime,offset)==='played'?'played':'upcoming';
}
