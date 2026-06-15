# Task Checklist: Lobby Rejoin Bugfix and Rule Specification

- [x] Modify `games/hidden-agent/host/main.js` to send `lobbyState` during the lobby phase rejoin.
- [x] Modify `games/hidden-agent/mobile/main.js` to handle `lobbyState` and transition the screen appropriately.
- [x] Append "Lobby Rejoin Rules" to the platform guidelines in `AGENTS.md`.
- [x] Document the prevention guidelines in `docs/multi-agent-process-guide.md`.
- [x] Verify build and run E2E test suites (`npm run build`, `npx playwright test`).
- [x] Run the archiving script and push all modifications to the repository.
