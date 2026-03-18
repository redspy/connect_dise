---
name: dev-server
description: Start, stop, and check the status of the development server in the background. Use when the user says "개발서버 켜줘", "서버 시작", "dev server 실행", "서버 꺼줘", "서버 상태", "start dev server", "stop server", "server status", or any similar request to manage the local development server process.
---

# Dev Server

Manage the development server as a background process using the Bash tool's `run_in_background` parameter.

## Commands

### Start the server

Run `npm run dev` in the background from the project root:

```bash
npm run dev
```

Use `run_in_background: true` on the Bash tool call. After starting, confirm the server is running and report the task ID so the user can reference it.

Tell the user:
- The server started successfully
- Vite runs at `http://localhost:5173` (or the port shown in output)
- The Express/Socket.io server runs at `http://localhost:3000` (or as configured)

### Check status

Use `TaskList` to show running background tasks. If the dev server task is listed as running, it's active.

### Stop the server

Use `TaskStop` with the task ID to stop the background process. Confirm it's stopped.

### View logs

Use `TaskOutput` with the task ID to fetch recent output from the background process.

## Notes

- This project uses `concurrently` to run nodemon (Express) + Vite simultaneously
- If port is already in use, check for existing processes: `netstat -ano | findstr :5173` or `:3000`
- On Windows, kill stray processes with `taskkill /PID <pid> /F`
- Do not use `&` suffix — always use `run_in_background: true` on the Bash tool call instead
