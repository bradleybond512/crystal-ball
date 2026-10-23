import { statSync } from 'node:fs';
import { resolve } from 'node:path';

// Direct --test mode lists files explicitly. npm modes select their own suites.
export class TestFilePreflight {
  static assertExplicitTestFiles(args, root) {
    if (args[0] !== '--test') return;
    const missing = args.slice(1).filter((file) => {
      if (file.startsWith('-')) return false;
      try {
        return !statSync(resolve(root, file)).isFile();
      } catch {
        return true;
      }
    });
    if (missing.length > 0) {
      throw new Error(`Missing explicit test file(s); refusing fixture creation and test execution:\n${missing.join('\n')}`);
    }
  }
}
