# Contributing

Small, reproducible data failures are welcome. Include synthetic or anonymized CSV input, the plan, expected and actual results. Never attach API keys or private datasets.

Use Node.js 24 and Python 3.10+. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. Set `TEST_PYTHON` to an executable if needed. The test runner defaults to `py -3.12` on Windows and `python3` elsewhere.

Changes to processing semantics should include independent expected results and a TypeScript / Python bundle parity case. Update `docs/methods.md` for changed rules. Keep AI output as constrained data, never executable code.

`npm run format` formats project-owned source, leaving vendored starter UI intact. `npm run example` regenerates the synthetic demo. Inspect its report and reproduction output.

Priorities: anonymized real-world failures, usability, explanations of sample changes and localization. New automatic cleaning operations need explicit controls and documented effects.
