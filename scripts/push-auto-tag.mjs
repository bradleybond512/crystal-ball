import { spawnSync } from 'node:child_process';
import { parseReleaseTag } from './release-metadata.mjs';

// Checkout authentication is deliberately not persisted. Only the final push
// receives a command-local header; origin inspection and tag creation do not.
function gitEnvironment(source) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key === 'GITHUB_TOKEN' || key === 'GH_TOKEN' || key === 'AUTO_TAG_HTTP_AUTH'
      || key === 'GIT_CONFIG' || key === 'GIT_CONFIG_PARAMETERS' || key === 'GIT_CONFIG_COUNT'
      || /^GIT_CONFIG_(?:KEY|VALUE)_/.test(key) || key.startsWith('GIT_TRACE')
      || key === 'GIT_CURL_VERBOSE' || key === 'GIT_ASKPASS' || key === 'SSH_ASKPASS'
      || key.startsWith('GIT_SSH')) delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const requestedTag = process.env.TAG;
  if (!token || /[\r\n]/.test(token)) throw new Error('A valid workflow token is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository ?? '')) {
    throw new Error('A valid GitHub repository is required.');
  }
  let tag;
  try {
    tag = parseReleaseTag(requestedTag).tag;
  } catch {
    throw new Error('A valid release tag is required.');
  }
  if (tag !== requestedTag) throw new Error('A canonical release tag is required.');
  const origin = `https://github.com/${repository}.git`;
  const env = gitEnvironment(process.env);
  const config = ['-c', 'credential.helper=', '-c', 'http.extraheader=', '-c', `http.${origin}.extraheader=`];
  const git = (args, childEnv = env, capture = false) => {
    const result = spawnSync('/usr/bin/git', [...config, ...args], {
      env: childEnv,
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
    });
    if (result.error || result.status !== 0) {
      const error = new Error('Git auto-tag operation failed.');
      error.exitCode = result.status > 0 ? result.status : 1;
      throw error;
    }
    return result.stdout;
  };
  // Validate both URLs: a canonical fetch URL alone does not constrain pushurl
  // or Git's insteadOf/pushInsteadOf rewriting. Never print a rejected URL.
  for (const args of [['remote', 'get-url', '--all', 'origin'], ['remote', 'get-url', '--push', '--all', 'origin']]) {
    if (git(args, env, true) !== `${origin}\n`) throw new Error('Origin must be the canonical HTTPS GitHub repository.');
  }
  git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
    'tag', '-a', tag, '-m', `Release ${tag}`]);
  const encodedToken = Buffer.from(`x-access-token:${token}`).toString('base64');
  const pushEnv = { ...env, AUTO_TAG_HTTP_AUTH: `AUTHORIZATION: basic ${encodedToken}` };
  git([`--config-env=http.${origin}.extraheader=AUTO_TAG_HTTP_AUTH`, 'push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], pushEnv);
  console.log(`Created and pushed tag: ${tag}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = error.exitCode ?? 1;
}
