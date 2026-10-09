# Discord Security Bot

This project is a legitimate Discord moderation and anti-nuke bot built with `discord.js`.

Features:
- Anti-nuke protections for suspicious role/channel creation
- Mass ban detection and lockdown
- Logging for joins, leaves, deletes, role creation, channel creation
- Vanity invite checking
- Moderation commands: ban, kick, mute, unmute, warn, clear
- Utility commands: help, ping, status
- Ready to be built into a Windows `.exe` using `pkg`

## Install

```bash
npm install
```

## Setup

1. Copy `.env.example` to `.env`
2. Fill in your Discord token, client ID, guild ID, and log channel ID
3. Start the bot:

```bash
npm start
```

## Build Windows EXE

```bash
npm install --save-dev pkg
npm run build:exe
```

This creates a Windows executable in the `dist` folder.

## Notes

- Use the bot only in servers you own or administer.
- Keep your token secret.
- Add your own custom protection rules if needed.
