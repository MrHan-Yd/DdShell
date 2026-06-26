# AI Agent 终端窗口实现计划

## Implementation Checklist

1. Load project specs before coding
   - `.trellis/spec/guides/index.md`
   - frontend layer specs
   - backend layer specs

2. Backend AI core
   - Add AI agent data types.
   - Add config load/save commands with API Key encryption and redaction.
   - Add provider adapter request builders:
     - OpenAI Chat Completions
     - OpenAI Responses
     - Claude Messages
     - Gemini Generate Content
   - Add response normalizer and parser fallback.
   - Register Tauri commands.

3. Frontend API layer
   - Add TypeScript types for AI config, request, response, commands.
   - Add Tauri wrapper functions.

4. Settings UI
   - Add AI Agent tab/section.
   - Support enable toggle, execution mode, multiple profiles, default profile.
   - Support protocol selector, base URL, model, temperature, max tokens, timeout.
   - Support setting/replacing/clearing API key without displaying stored key.
   - Save through backend config commands.

5. Terminal AI Assist UI
   - Implement right-bottom popover following `ui/terminal.html`.
   - Add open/close control and AI status indicator.
   - Add profile switcher in the popover.
   - Add input submit, loading, error, answer, command cards.
   - Add copy, dismiss, next/previous command navigation.
   - Add Run command confirm flow.
   - Respect execution mode:
     - run: `command + "\n"`
     - insert: `command`

6. Styling and i18n
   - Add localized strings for settings and terminal UI.
   - Add CSS using existing tokens and design conventions.
   - Keep the panel responsive and non-overlapping with terminal content.

7. Validation
   - TypeScript build.
   - Rust check.
   - Manual sanity checks with mocked/invalid config paths if no real API key is available.

## Validation Commands

```bash
cd app && pnpm build
cd app/src-tauri && cargo check
```

## Risk Points

- Provider API details differ and some custom OpenAI-compatible services may not support JSON schema.
- API Key storage must not leak through settings reads or UI state.
- Terminal command execution must target the current active session.
- Large `TerminalPage.tsx` changes risk regressions; keep AI Assist isolated in a component if practical.
- Existing dangerous command protection is tied to terminal input flow; verify AI writes go through the same path or add explicit confirmation before writing.

## Rollback Points

- Backend commands can be disabled independently if provider request handling needs adjustment.
- Terminal AI Assist UI can be hidden behind `aiAgent.enabled`.
- Settings profile data uses key/value settings, so rollback does not require schema migration.
