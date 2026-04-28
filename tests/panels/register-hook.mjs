/**
 * Registers the panel-smoke loader hook via Node's module API. Used by
 * `npm run test:panels:smoke` via:
 *
 *   tsx --import ./tests/panels/register-hook.mjs --test ...
 *
 * Keeping this small + .mjs so Node can run it without tsx during the
 * worker bootstrap.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(here, 'loader-hook.mjs')));
