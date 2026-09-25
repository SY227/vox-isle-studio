import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGeminiApiKey,isPlausibleGeminiApiKey,envAssignment} from '../shared/credentials.mjs';

test('accepts current AQ auth key shape including dot',()=>{
  const key='AQ.Example_Auth-Key.1234567890_abcdefghijklmnopqrstuv';
  assert.equal(isPlausibleGeminiApiKey(key),true);
});

test('accepts legacy AIza key shape',()=>{
  assert.equal(isPlausibleGeminiApiKey('AIzaSyDUMMY1234567890abcdefghijklmnopqrstuvwxyz'),true);
});

test('normalizes pasted env assignment and quotes',()=>{
  assert.equal(normalizeGeminiApiKey(' GEMINI_API_KEY="AQ.example_key-12345678901234567890" '),'AQ.example_key-12345678901234567890');
});

test('rejects whitespace/control characters and short values',()=>{
  assert.equal(isPlausibleGeminiApiKey('short'),false);
  assert.equal(isPlausibleGeminiApiKey('AQ.valid-looking-but has-space-1234567890'),false);
});

test('writes a quoted dotenv assignment',()=>{
  assert.equal(envAssignment('GEMINI_API_KEY','AQ.example_key-123'),'GEMINI_API_KEY="AQ.example_key-123"');
});
