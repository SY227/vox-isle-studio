export function normalizeGeminiApiKey(value=''){
  let key=String(value).trim();
  if(/^GEMINI_API_KEY\s*=/.test(key)) key=key.replace(/^GEMINI_API_KEY\s*=\s*/,'').trim();
  if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'"))) key=key.slice(1,-1).trim();
  return key;
}

export function isPlausibleGeminiApiKey(value){
  const key=normalizeGeminiApiKey(value);
  if(key.length<20||key.length>512) return false;
  if(/[\u0000-\u0020\u007f]/.test(key)) return false;
  return true;
}

export function envAssignment(name,value){
  return `${name}=${JSON.stringify(String(value))}`;
}
