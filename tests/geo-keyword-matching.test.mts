import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeForMatch, matchKeyword, matchesAnyKeyword, findMatchingKeywords } from '../src/utils/keyword-match.ts';

// --- Tokenizer tests ---

describe('tokenizeForMatch', () => {
  it('splits on whitespace and lowercases', () => {
 const t = tokenizeForMatch('Assad Forces Advance');
 assert.ok(t.words.has('assad'));
 assert.ok(t.words.has('forces'));
 assert.ok(t.words.has('advance'));
 assert.deepStrictEqual(t.ordered, ['assad', 'forces', 'advance']);
  });

  it('strips leading/trailing punctuation', () => {
 const t = tokenizeForMatch('"Syria!" (conflict)');
 assert.ok(t.words.has('syria'));
 assert.ok(t.words.has('conflict'));
 assert.ok(!t.words.has('"syria!"'));
  });

  it('decomposes possessives', () => {
 const t = tokenizeForMatch("Assad's forces");
 assert.ok(t.words.has("assad's"));
 assert.ok(t.words.has('assad'));
 assert.ok(t.words.has('s'));
 assert.ok(t.words.has('forces'));
  });

  it('decomposes hyphenated words', () => {
 const t = tokenizeForMatch('al-Sham fighters');
 assert.ok(t.words.has('al-sham'));
 assert.ok(t.words.has('al'));
 assert.ok(t.words.has('sham'));
  });

  it('handles empty input', () => {
 const t = tokenizeForMatch('');
 assert.strictEqual(t.words.size, 0);
 assert.strictEqual(t.ordered.length, 0);
  });

  it('handles punctuation-only tokens', () => {
 const t = tokenizeForMatch('--- *** !!!');
 assert.strictEqual(t.words.size, 0);
 assert.strictEqual(t.ordered.length, 0);
  });
});

// --- False positive prevention ---

describe('false positive prevention', () => {
  it('"ambassador" does NOT match "assad"', () => {
 const t = tokenizeForMatch('French Ambassador outlines new strategy');
 assert.ok(!matchKeyword(t, 'assad'));
  });

  it('"rights" does NOT match "hts"', () => {
 const t = tokenizeForMatch('Human rights groups condemn violence');
 assert.ok(!matchKeyword(t, 'hts'));
  });

  it('"Ukrainian" does NOT match "iran"', () => {
 const t = tokenizeForMatch('Ukrainian forces push forward');
 assert.ok(!matchKeyword(t, 'iran'));
  });

  it('"focus" does NOT match "us"', () => {
 const t = tokenizeForMatch('Leaders focus on economy');
 assert.ok(!matchKeyword(t, 'us'));
  });

  it('"housing" does NOT match "house"', () => {
 const t = tokenizeForMatch('Housing prices rise sharply');
 assert.ok(!matchKeyword(t, 'house'));
  });

  it('"warehouse" does NOT match "house"', () => {
 const t = tokenizeForMatch('Amazon warehouse workers strike');
 assert.ok(!matchKeyword(t, 'house'));
  });

  it('"discuss" does NOT match "us"', () => {
 const t = tokenizeForMatch('Leaders discuss trade policy');
 assert.ok(!matchKeyword(t, 'us'));
  });

  it('"bushfire" does NOT match "us"', () => {
 const t = tokenizeForMatch('Bushfire threatens suburbs');
 assert.ok(!matchKeyword(t, 'us'));
  });

  it('"Thailand" does NOT match "ai"', () => {
 const t = tokenizeForMatch('Thailand exports surge');
 assert.ok(!matchKeyword(t, 'ai'));
  });
});

// --- True positive preservation ---

describe('true positive preservation', () => {
  it('"Assad regime forces" matches "assad"', () => {
 const t = tokenizeForMatch('Assad regime forces advance in Idlib');
 assert.ok(matchKeyword(t, 'assad'));
  });

  it('"HTS forces advance" matches "hts"', () => {
 const t = tokenizeForMatch('HTS forces advance in northern Syria');
 assert.ok(matchKeyword(t, 'hts'));
  });

  it('"Iran sanctions" matches "iran"', () => {
 const t = tokenizeForMatch('Iran sanctions lifted after talks');
 assert.ok(matchKeyword(t, 'iran'));
  });

  it('"US announces" matches "us"', () => {
 const t = tokenizeForMatch('US announces new trade deal');
 assert.ok(matchKeyword(t, 'us'));
  });

  it('"The House voted" matches "house"', () => {
 const t = tokenizeForMatch('The House voted on the bill');
 assert.ok(matchKeyword(t, 'house'));
  });
});

// --- Possessives ---

describe('possessive matching', () => {
  it('"Assad\'s forces" matches "assad"', () => {
 const t = tokenizeForMatch("Assad's forces advance");
 assert.ok(matchKeyword(t, 'assad'));
  });

  it('"Iran\'s nuclear program" matches "iran"', () => {
 const t = tokenizeForMatch("Iran's nuclear program concerns grow");
 assert.ok(matchKeyword(t, 'iran'));
  });

  it('"Putin\'s war" matches "putin"', () => {
 const t = tokenizeForMatch("Putin's war strategy shifts");
 assert.ok(matchKeyword(t, 'putin'));
  });

  it('"China\'s economy" matches "china"', () => {
 const t = tokenizeForMatch("China's economy slows further");
 assert.ok(matchKeyword(t, 'china'));
  });
});

// --- Inflection / suffix matching (plurals, demonyms) ---

describe('inflection suffix matching', () => {
  it('"houthis" matches keyword "houthi" (plural -s)', () => {
 const t = tokenizeForMatch('Houthis attack Red Sea shipping');
 assert.ok(matchKeyword(t, 'houthi'));
  });

  it('"missiles" matches keyword "missile" (plural -s)', () => {
 const t = tokenizeForMatch('Missiles launched from Yemen');
 assert.ok(matchKeyword(t, 'missile'));
  });

  it('"drones" matches keyword "drone" (plural -s)', () => {
 const t = tokenizeForMatch('Drones spotted over base');
 assert.ok(matchKeyword(t, 'drone'));
  });

  it('"Ukrainian" matches keyword "ukraine" (demonym -ian)', () => {
 const t = tokenizeForMatch('Ukrainian forces push forward');
 assert.ok(matchKeyword(t, 'ukraine'));
  });

  it('"Iranian" matches keyword "iran" (demonym -ian)', () => {
 const t = tokenizeForMatch('Iranian senate debates sanctions');
 assert.ok(matchKeyword(t, 'iran'));
  });

  it('"Israeli" matches keyword "israel" (demonym -i)', () => {
 const t = tokenizeForMatch('Israeli military conducts operation');
 assert.ok(matchKeyword(t, 'israel'));
  });

  it('"Russian" matches keyword "russia" (demonym -n)', () => {
 const t = tokenizeForMatch('Russian forces advance');
 assert.ok(matchKeyword(t, 'russia'));
  });

  it('"Taiwanese" matches keyword "taiwan" (demonym -ese)', () => {
 const t = tokenizeForMatch('Taiwanese military drills begin');
 assert.ok(matchKeyword(t, 'taiwan'));
  });

  it('suffix matching does NOT cause false positives for unrelated words', () => {
 const t = tokenizeForMatch('The situation worsens dramatically');
 assert.ok(!matchKeyword(t, 'situ'));
 assert.ok(!matchKeyword(t, 'drama'));
  });

  it('"Iranians" matches keyword "iran" (plural demonym -ians)', () => {
 assert.ok(matchKeyword(tokenizeForMatch('Iranians protest in Tehran'), 'iran'));
  });

  it('"Ukrainians" matches keyword "ukraine" (plural demonym -ians with e-drop)', () => {
 assert.ok(matchKeyword(tokenizeForMatch('Ukrainians seek aid'), 'ukraine'));
  });

  it('"Russians" matches keyword "russia" (plural demonym -ns)', () => {
 assert.ok(matchKeyword(tokenizeForMatch('Russians advance on front'), 'russia'));
  });

  it('"Israelis" matches keyword "israel" (plural demonym -is)', () => {
 assert.ok(matchKeyword(tokenizeForMatch('Israelis evacuate border towns'), 'israel'));
  });

  it('short keywords (<4 chars) do NOT suffix-match', () => {
 assert.ok(!matchKeyword(tokenizeForMatch('AIS signals disrupted'), 'ai'));
 assert.ok(!matchKeyword(tokenizeForMatch('Russia uses drones'), 'us'));
 assert.ok(!matchKeyword(tokenizeForMatch('The bus arrived'), 'bu'));
  });

  it('short keywords still exact-match', () => {
 assert.ok(matchKeyword(tokenizeForMatch('AI revolution continues'), 'ai'));
 assert.ok(matchKeyword(tokenizeForMatch('US announces deal'), 'us'));
 assert.ok(matchKeyword(tokenizeForMatch('HTS forces advance'), 'hts'));
  });
});

// --- Multi-word phrases ---

describe('multi-word phrase matching', () => {
  it('"White House announces" matches "white house"', () => {
 const t = tokenizeForMatch('White House announces new policy');
 assert.ok(matchKeyword(t, 'white house'));
  });

  it('"The house is painted white" does NOT match "white house"', () => {
 const t = tokenizeForMatch('The house is painted white');
 assert.ok(!matchKeyword(t, 'white house'));
  });

  it('"supreme court" matches multi-word', () => {
 const t = tokenizeForMatch('Supreme Court rules on case');
 assert.ok(matchKeyword(t, 'supreme court'));
  });

  it('"silicon valley" matches multi-word', () => {
 const t = tokenizeForMatch('Silicon Valley startups surge');
 assert.ok(matchKeyword(t, 'silicon valley'));
  });

  it('"South Korean" matches "south korea" (multi-word demonym)', () => {
 const t = tokenizeForMatch('South Korean military drills continue');
 assert.ok(matchKeyword(t, 'south korea'));
  });

  it('"North Korean" matches "north korea" (multi-word demonym)', () => {
 const t = tokenizeForMatch('North Korean missile launch detected');
 assert.ok(matchKeyword(t, 'north korea'));
  });

  it('"South Koreans" matches "south korea" (multi-word plural demonym)', () => {
 const t = tokenizeForMatch('South Koreans vote in election');
 assert.ok(matchKeyword(t, 'south korea'));
  });

  it('"tech layoffs" matches multi-word', () => {
 const t = tokenizeForMatch('Tech layoffs hit record numbers');
 assert.ok(matchKeyword(t, 'tech layoffs'));
  });
});

// --- DC keywords cleanup ---

describe('DC keywords (cleaned)', () => {
  const dcKeywords = ['pentagon', 'white house', 'congress', 'cia', 'nsa', 'washington', 'biden', 'trump', 'senate', 'supreme court', 'vance', 'elon'];

  it('does NOT contain "house" as standalone keyword', () => {
 assert.ok(!dcKeywords.includes('house'));
  });

  it('does NOT contain "us " trailing-space hack', () => {
 assert.ok(!dcKeywords.includes('us '));
  });

  it('"Housing market crashes" does NOT match any DC keyword', () => {
 const t = tokenizeForMatch('Housing market crashes nationwide');
 assert.ok(!matchesAnyKeyword(t, dcKeywords));
  });

  it('"White House announces budget" DOES match DC', () => {
 const t = tokenizeForMatch('White House announces budget cuts');
 assert.ok(matchesAnyKeyword(t, dcKeywords));
  });

  it('"Congress passes bill" DOES match DC', () => {
 const t = tokenizeForMatch('Congress passes new spending bill');
 assert.ok(matchesAnyKeyword(t, dcKeywords));
  });
});

// --- Integration: hub matching end-to-end ---

describe('integration: hub keyword matching', () => {
  const damascusKeywords = ['syria', 'damascus', 'assad', 'syrian', 'hts'];

  it('matches Damascus for Syrian conflict news', () => {
 const t = tokenizeForMatch("Assad's forces clash with HTS near Damascus");
 const matched = findMatchingKeywords(t, damascusKeywords);
 assert.ok(matched.length >= 2);
 assert.ok(matched.includes('assad'));
 assert.ok(matched.includes('hts'));
 assert.ok(matched.includes('damascus'));
  });

  it('does NOT match Damascus for "ambassador rights" headline', () => {
 const t = tokenizeForMatch('French Ambassador discusses human rights in Geneva');
 const matched = findMatchingKeywords(t, damascusKeywords);
 assert.strictEqual(matched.length, 0);
  });

  it('matches Damascus for "Syrian" as standalone word', () => {
 const t = tokenizeForMatch('Syrian refugees seek asylum');
 const matched = findMatchingKeywords(t, damascusKeywords);
 assert.ok(matched.includes('syrian'));
  });

  it('matches conflict zone keywords with plural forms', () => {
 const redSeaKeywords = ['houthi', 'red sea', 'yemen', 'missile', 'drone', 'ship'];
 const t = tokenizeForMatch('Houthis launch missiles at ships in Red Sea');
 const matched = findMatchingKeywords(t, redSeaKeywords);
 assert.ok(matched.includes('houthi'));
 assert.ok(matched.includes('missile'));
 assert.ok(matched.includes('ship'));
 assert.ok(matched.includes('red sea'));
  });
});

// --- matchesAnyKeyword ---

describe('matchesAnyKeyword', () => {
  it('returns true when any keyword matches', () => {
 const t = tokenizeForMatch('Pentagon releases new report');
 assert.ok(matchesAnyKeyword(t, ['pentagon', 'white house']));
  });

  it('returns false when no keyword matches', () => {
 const t = tokenizeForMatch('Local farmer wins award');
 assert.ok(!matchesAnyKeyword(t, ['pentagon', 'white house']));
  });
});

// --- findMatchingKeywords ---

describe('findMatchingKeywords', () => {
  it('returns all matching keywords', () => {
 const t = tokenizeForMatch('Trump meets with CIA director at Pentagon');
 const matched = findMatchingKeywords(t, ['trump', 'cia', 'pentagon', 'nsa']);
 assert.deepStrictEqual(matched.sort(), ['cia', 'pentagon', 'trump']);
  });

  it('returns empty array when nothing matches', () => {
 const t = tokenizeForMatch('Weather forecast looks sunny');
 const matched = findMatchingKeywords(t, ['trump', 'cia', 'pentagon']);
 assert.strictEqual(matched.length, 0);
  });
});

// --- Edge cases ---

describe('edge cases', () => {
  it('empty keyword returns false', () => {
 const t = tokenizeForMatch('Some title');
 assert.ok(!matchKeyword(t, ''));
 assert.ok(!matchKeyword(t, ' '));
  });

  it('numbers in tokens work', () => {
 const t = tokenizeForMatch('F-35 crashes in test flight');
 assert.ok(t.words.has('f-35'));
 assert.ok(t.words.has('35'));
 assert.ok(t.words.has('f'));
  });

  it('case insensitive matching', () => {
 const t = tokenizeForMatch('IRAN LAUNCHES MISSILE');
 assert.ok(matchKeyword(t, 'iran'));
 assert.ok(matchKeyword(t, 'IRAN'));
 assert.ok(matchKeyword(t, 'Iran'));
  });
});

// Boundary trimming is ASCII-only; punctuation inside the trimmed span is retained.
describe('keyword boundary scan semantics', () => {
  it('preserves exact UTF-16, lowercase, internal punctuation and token ordering', () => {
    const fixtures: Array<[string, string[], string[]]> = [
      ['!!!A---B???', ['a---b'], ['a---b', 'a', 'b']],
      ['éFOOéBARé', ['fooébar'], ['fooébar', 'foo', 'bar']],
      ['😀A😀B😀', ['a😀b'], ['a😀b', 'a', 'b']],
      ['\ud800A\udc00', ['a'], ['a']],
      ['\ud800\udc00', [], []],
      ['İA', ['i\u0307a'], ['i\u0307a', 'i', 'a']],
      ['K!İ', ['k!i'], ['k!i', 'k', 'i']],
      ['０1２', ['1'], ['1']],
      ['A---B a---b\u00a0C', ['a---b', 'a---b', 'c'], ['a---b', 'a', 'b', 'c']],
      ['\u200bA\u200b', ['a'], ['a']],
      ['\u2028---\t!?\n', [], []],
    ];
    for (const [input, ordered, words] of fixtures) {
      const tokens = tokenizeForMatch(input);
      assert.deepEqual(tokens.ordered, ordered, JSON.stringify(input));
      assert.deepEqual([...tokens.words], words, JSON.stringify(input));
    }
  });

  it('bounds long internal punctuation work without truncating or changing tokens', async () => {
    const { spawn } = await import('node:child_process');
    const source = new URL('../src/utils/keyword-match.ts', import.meta.url).href;
    const script = `
      import assert from 'node:assert/strict';
      import { tokenizeForMatch, matchKeyword } from ${JSON.stringify(source)};
      console.log('READY');
      await new Promise(resolve => process.stdin.once('data', resolve));
      const title = 'A' + '!'.repeat(200_000) + 'B';
      const started = performance.now();
      const tokens = tokenizeForMatch(title);
      assert.deepEqual(tokens.ordered, [title.toLowerCase()]);
      assert.deepEqual([...tokens.words], [title.toLowerCase(), 'a', 'b']);
      assert.equal(matchKeyword(tokens, 'a'), true);
      assert.equal(matchKeyword(tokens, 'ab'), false);
      console.log(JSON.stringify({elapsedMs:performance.now()-started,length:tokens.ordered[0].length}));
    `;
    // Startup/import readiness has its own limit; the 4s work budget starts only after READY.
    const result = await new Promise<{
      ready: boolean; status: number | null; stdout: string; stderr: string; error: string | undefined;
    }>((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script]);
      let ready = false;
      let stdout = '';
      let stderr = '';
      let error: string | undefined;
      let timer = setTimeout(() => {
        error = 'child import/startup exceeded separate 15s budget';
        child.kill('SIGKILL');
      }, 15_000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (!ready && stdout.includes('READY\n')) {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => {
            error = 'tokenizer work exceeded explicit 4s budget after successful import';
            child.kill('SIGKILL');
          }, 4000);
          child.stdin.end('go\n');
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once('error', (cause) => { error = cause.message; });
      child.once('close', (status) => {
        clearTimeout(timer);
        resolve({ready, status, stdout, stderr, error});
      });
    });
    assert.equal(result.ready, true, result.stderr || result.error);
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.status, 0, result.stderr);
    const summary = result.stdout.trim().split('\n').at(-1) ?? '';
    assert.equal(JSON.parse(summary).length, 200_002);
  });
});

it('routes both keyword source and regression fixture through the real CI selector', async () => {
  const { readFileSync } = await import('node:fs');
  const { deriveScriptIndex, selectScripts, mergeOverrides, OVERRIDES, prDeclaredOverrides, commandToStages } = await import('../scripts/targeted-tests.mjs');
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  const command = scripts['test:keyword-match'];
  assert.equal(command, 'node --test --import tsx tests/geo-keyword-matching.test.mts');
  const index = deriveScriptIndex(scripts);
  assert.ok(index.has('test:keyword-match'), 'keyword runner must be accepted, not silently skipped');
  const overrides = mergeOverrides(OVERRIDES, prDeclaredOverrides());
  for (const changed of ['src/utils/keyword-match.ts', 'tests/geo-keyword-matching.test.mts']) {
    const selected = selectScripts([changed], index, overrides);
    assert.ok(selected.scripts.includes('test:keyword-match'), `${changed} must select keyword behavior`);
    assert.deepEqual(selected.unmapped, []);
  }
  assert.deepEqual(commandToStages(command), [{bin: process.execPath, args: ['--test', '--import', 'tsx', 'tests/geo-keyword-matching.test.mts']}]);
});
