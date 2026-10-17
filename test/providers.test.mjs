import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Mock the ADC dependency before loading the CommonJS provider module.
class GoogleAuth {
  async getAccessToken() { throw new Error('ADC must be mocked in tests'); }
}
const originalLoad = Module._load;
const loadSpy = vi.spyOn(Module, '_load').mockImplementation(function (name, ...args) {
  if (name === 'google-auth-library') return { GoogleAuth };
  return originalLoad.call(this, name, ...args);
});
const { generateSummary } = require('../src/providers');
loadSpy.mockRestore();
const prompt = { system: 'review', user: '{"diff":"+hello"}' };
const googleResponse = { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'internal' }, { text: '摘要' }, { text: '風險' }] } }] };
const base = { provider: 'openai', model: 'chosen-model', apiKey: 'test-key', vertexProject: 'test-project', vertexLocation: 'us-central1' };
function reply(data, status = 200) {
  fetch.mockResolvedValue({ ok: status === 200, status, json: vi.fn().mockResolvedValue(data) });
}
function request() {
  const [url, options] = fetch.mock.calls[0];
  return { url, ...options, body: JSON.parse(options.body) };
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('providers', () => {
  it('calls OpenAI chat completions with the selected model and messages', async () => {
    reply({ choices: [{ finish_reason: 'stop', message: { content: ' 摘要 ' } }] });
    expect(await generateSummary(base, prompt)).toBe('摘要');
    expect(request()).toMatchObject({ url: 'https://api.openai.com/v1/chat/completions', method: 'POST', headers: { Authorization: 'Bearer test-key' }, body: { model: 'chosen-model', messages: [{ role: 'system', content: 'review' }, { role: 'user', content: prompt.user }] } });
    expect(request().signal).toBeInstanceOf(AbortSignal);
  });
  it('calls Gemini using a header API key and filters thinking parts', async () => {
    reply(googleResponse);
    expect(await generateSummary({ ...base, provider: 'gemini' }, prompt)).toBe('摘要\n風險');
    expect(request()).toMatchObject({ url: 'https://generativelanguage.googleapis.com/v1beta/models/chosen-model:generateContent', headers: { 'x-goog-api-key': 'test-key' }, body: { systemInstruction: { parts: [{ text: 'review' }] }, contents: [{ role: 'user', parts: [{ text: prompt.user }] }] } });
    expect(request().url).not.toContain('test-key');
  });
  it('uses an explicit Vertex token without ADC', async () => {
    const auth = vi.spyOn(GoogleAuth.prototype, 'getAccessToken');
    reply(googleResponse);
    await generateSummary({ ...base, provider: 'vertex', vertexAccessToken: 'token' }, prompt);
    expect(auth).not.toHaveBeenCalled();
    expect(request()).toMatchObject({ url: 'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/chosen-model:generateContent', headers: { Authorization: 'Bearer token' } });
  });
  it('uses ADC and the global Vertex hostname', async () => {
    vi.spyOn(GoogleAuth.prototype, 'getAccessToken').mockResolvedValue('adc-token');
    reply(googleResponse);
    await generateSummary({ ...base, provider: 'vertex', vertexLocation: 'global' }, prompt);
    expect(request().url).toContain('https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/');
    expect(request().headers.Authorization).toBe('Bearer adc-token');
  });
  it('sanitizes ADC failures', async () => {
    vi.spyOn(GoogleAuth.prototype, 'getAccessToken').mockRejectedValue(new Error('sensitive credentials'));
    await expect(generateSummary({ ...base, provider: 'vertex' }, prompt)).rejects.toThrow('Vertex authentication failed');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 429, 500])('reports HTTP %s without upstream data', async status => {
    reply({ error: 'private diff and key' }, status);
    await expect(generateSummary(base, prompt)).rejects.toThrow(`openai API returned HTTP ${status}`);
  });
  it('sanitizes network failures', async () => {
    fetch.mockRejectedValue(new Error('private URL'));
    await expect(generateSummary(base, prompt)).rejects.toThrow('network error or 120s timeout');
  });
  it('rejects invalid JSON', async () => {
    fetch.mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(new Error('bad')) });
    await expect(generateSummary(base, prompt)).rejects.toThrow('invalid JSON');
  });
  it.each([
    ['openai', { choices: [{ finish_reason: 'stop', message: { content: '' } }] }, 'no text'],
    ['openai', { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, 'incomplete'],
    ['gemini', { promptFeedback: { blockReason: 'SAFETY' } }, 'no text'],
    ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'incomplete'],
  ])('rejects empty, blocked or incomplete %s responses', async (provider, data, message) => {
    reply(data);
    await expect(generateSummary({ ...base, provider }, prompt)).rejects.toThrow(message);
  });
});
