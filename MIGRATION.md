# Migration record — 2026-09-12

## Migration and privacy


Initial keyword scanning found 14 matching files. After review, the owner explicitly authorized removal of all real company data and commit/push. Real-deal profiles, historical customer examples, numeric transaction details and performance claims were removed from the public knowledge and guides. The question bank now contains generic placeholders. Synthetic persona rationale cells referencing historical deals were removed/replaced; synthetic questions and evidence remain. No original customer Data Room directory or root spreadsheet/presentation was copied.

AGENTS.md now contains the full DD rules, superseding the initially requested compatibility pointer. Seven .codex/agents/*.toml files embed full role instructions; .agents/skills/dd-qlist/SKILL.md is a native discoverable skill. Legacy configuration files are removed. The export script uses an explicit allowlist and excludes runtime files and credentials. The repository root ignore allowlist prevents accidental addition of other case directories; it does not replace review of files in allowed directories.

## Implementation and validation

- OpenAI SDK 7.15.0 and Codex CLI 0.154.0 are pinned. Responses API handles immediate questions; codex exec --json handles headless batches and the no-API-key question path.
- Provider changes cover authentication, model/effort, stdin, event/output parsing and failure lifecycle. A failed run cannot mark preexisting draft output as newly completed.
- UI changes are limited to provider/model/authentication labels and instructions. No DD business logic or UI redesign was introduced.
- index_doc.py, recompute.py, make_xlsx.py and read_xlsx.py were unchanged during provider integration. Synthetic document binaries remain unchanged.
- Python requirements and npm dependencies installed. Seven document indexes built; the synthetic annual report has 520 pages. Recompute dry run succeeded.
- Mock /api/deals contains only 演練資料_AcmeRobotics. /api/page for annual report page 486 contains Note 41. Test servers were stopped.
- Deterministic tests cover OpenAI SDK with local SSE transport, CLI subprocess/stdin/JSONL success and failure, event adaptation, and the server failure completion guard. These are not live model tests.
- HTTP regression checks cover deals, detail, facts, page and search, excluding filesystem timestamps. Unattributed draft sources display AI.
- Native TOML configuration and skill format are validated. Credentials, node_modules, logs and runtime events are excluded from the published tree.

## Live-call limits

**Real Codex call did not complete.** CLI login status reported ChatGPT authentication, but a read-only single-page call timed out after 60 seconds without a model response. A minimal diagnostic also timed out. The precise cause is unconfirmed; authentication status alone does not prove a working live call.

**Real Responses API is unverified:** no OPENAI_API_KEY was available. No host secret was copied or published. The full live multi-agent pipeline remains unverified and must be tested on a host with working authentication and connectivity before claiming a successful live demo.
