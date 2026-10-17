const { GoogleAuth } = require('google-auth-library');

async function postJson(url, headers, body, provider) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new Error(`${provider} request failed (network error or 120s timeout)`);
  }
  // Do not include upstream bodies: they can echo credentials or private diff data.
  if (!response.ok) throw new Error(`${provider} API returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${provider} API returned invalid JSON`);
  }
}

function nonempty(text, provider) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`${provider} returned no text (possibly blocked or refused)`);
  }
  return text.trim();
}

async function generateSummary(options, prompt) {
  const { provider, model, apiKey, vertexProject, vertexLocation, vertexAccessToken } = options;
  if (provider === 'openai') {
    const data = await postJson('https://api.openai.com/v1/chat/completions', {
      Authorization: `Bearer ${apiKey}`,
    }, {
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }, provider);
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop') throw new Error('openai response was incomplete or blocked');
    return nonempty(choice.message?.content, provider);
  }

  let url;
  let headers;
  if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { 'x-goog-api-key': apiKey };
  } else if (provider === 'vertex') {
    let token = vertexAccessToken;
    if (!token) {
      try {
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        token = await auth.getAccessToken();
      } catch {
        throw new Error('Vertex authentication failed; configure ADC or vertex-access-token');
      }
    }
    if (!token) throw new Error('Vertex authentication returned no access token');
    const host = vertexLocation === 'global' ? 'aiplatform.googleapis.com' : `${vertexLocation}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${encodeURIComponent(vertexProject)}/locations/${encodeURIComponent(vertexLocation)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    headers = { Authorization: `Bearer ${token}` };
  } else {
    throw new Error('Unsupported provider');
  }
  const data = await postJson(url, headers, {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
  }, provider);
  const candidate = data.candidates?.[0];
  if (candidate && candidate.finishReason !== 'STOP') {
    throw new Error(`${provider} response was incomplete or blocked`);
  }
  return nonempty(candidate?.content?.parts?.filter(part => !part.thought)
    .map(part => part.text || '').join('\n'), provider);
}

module.exports = { generateSummary };
