import { spawn } from 'node:child_process';

// No detached groups, shell, installation or retry. Only this ChildProcess is signaled.
export function runChild(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { ...spec.options, shell: false, detached: false });
    let exited = false, spawned = false, retainedError, timer;
    const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
    const handlers = new Map();
    function cleanup() {
      clearTimeout(timer);
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    }
    for (const signal of signals) {
      const handler = () => {
        if (exited) return;
        child.kill(signal);
        if (!timer) timer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 2000);
      };
      handlers.set(signal, handler); process.on(signal, handler);
    }
    child.once('exit', () => { exited = true; clearTimeout(timer); });
    child.once('spawn', () => { spawned = true; });
    // A failed kill can emit error while the child remains alive. Keep ownership
    // and the bounded escalation until exit/close; repeated errors stay handled.
    child.on('error', (error) => {
      retainedError ??= error;
      if (!spawned && child.pid === undefined) { exited = true; cleanup(); reject(error); }
    });
    child.once('close', (code, signal) => { exited = true; cleanup(); if (retainedError) reject(retainedError); else resolve({ code, signal }); });
  });
}
