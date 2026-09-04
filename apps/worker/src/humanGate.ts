import readline from "node:readline";

/**
 * Waits for the person running the worker to press Enter.
 *
 * This exists because signing in cannot be automated and should not be: the
 * platform never types a password into Google or ChatGPT on someone's behalf,
 * and never tries to get past a CAPTCHA or a 2FA prompt. It opens the tabs,
 * steps back, and waits for a human to say the browser is ready.
 *
 * Only usable when the worker is attached to a terminal. A worker running as a
 * background service has nobody to ask, and blocking there would hang the run
 * forever with no way to tell why — so that case fails immediately and says
 * what to do instead.
 */
export function buildTerminalHumanGate(): (prompt: string) => Promise<void> {
  return (prompt: string) =>
    new Promise<void>((resolve, reject) => {
      if (!process.stdin.isTTY) {
        reject(
          new Error(
            "This run needs someone to sign in by hand, but the worker has no terminal to ask at " +
              "(stdin is not a TTY). Start it interactively with `npm run worker` in a terminal you can type into."
          )
        );
        return;
      }

      process.stdout.write(prompt);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      // question() rather than a raw 'line' listener so the interface owns the
      // stdin pause/resume cycle and hands the terminal back cleanly for the
      // rest of the run's logging.
      rl.question("Press Enter to continue: ", () => {
        rl.close();
        resolve();
      });
      rl.once("close", () => resolve());
    });
}
