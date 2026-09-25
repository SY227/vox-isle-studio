import {getConfig} from '../server/config.mjs';
import {checkModel} from '../server/gemini.mjs';
try{const r=await checkModel(getConfig());console.log(`✓ 可讀取 ${r.model}\n  generateContent: ${r.generateContent?'支援':'請檢查官方文件'}\n  這是模型權限檢查，不是歌曲分析準確度測試。`);}catch(e){console.error('✕ '+e.message);process.exitCode=1;}
