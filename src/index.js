const core = require('@actions/core');
const github = require('@actions/github');
const { generateSummary } = require('./providers');
const { run } = require('./action');

run({ core, github, generateSummary }).catch(error => {
  // API errors can contain private request data; report only known local messages
  // and status codes, never arbitrary Octokit/auth error bodies.
  const safe = /^(max-diff-chars |provider must |model is |github-token is |api-key is |vertex-project is |Invalid vertex-location|Unsupported provider|GitHub did not |Vertex authentication |(?:openai|gemini|vertex) (?:request failed|API returned|returned no text|response was))/;
  core.setFailed(safe.test(error.message || '') ? error.message : `Action failed${Number.isInteger(error.status) ? ` (HTTP ${error.status})` : ''}; check token permissions and provider configuration.`);
});
