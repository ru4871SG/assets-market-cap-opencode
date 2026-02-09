# Chat History Logger Plugin

A plugin for OpenCode that automatically logs all chat messages to daily markdown files.

## How It Works

The plugin hooks into OpenCode's event system to capture messages:

1. **Event Tracking** - Listens to `message.updated` and `message.part.updated` events to collect message content as it streams
2. **Session Idle Detection** - When `session.idle` fires (conversation turn complete), it logs all pending messages
3. **Streaming Support** - Handles streaming responses by tracking the latest content for each message part
4. **State File Toggle** - Uses a simple file-based state (`.opencode/chat-history-enabled`) to enable/disable logging without restart

### Key Features

- **ON by default** - Creates the state file automatically on first run
- **No restart needed** - Toggling works immediately since the plugin checks the file on each message
- **Daily files** - Messages are organized into `chat_history/YYYY_MM_DD.md`
- **Timestamps** - Each message includes a 24-hour timestamp
- **Deduplication** - Tracks logged messages to avoid duplicates

## Installation

### 1. Install dependencies

Navigate to the `.opencode` folder and install the required packages:

```bash
cd .opencode
bun install
```

This installs `@opencode-ai/plugin` (currently v1.1.42) from the package.json.

### 2. Register the plugin

Create `.opencode/opencode.json` with:

```json
{
  "plugin": ["./plugins/chat-history-logger.ts"]
}
```

and package.json with:

```json
{
  "dependencies": {
    "@opencode-ai/plugin": "1.1.42"
  }
}
```

### 3. Approve the plugin

When you first start OpenCode with the plugin, you'll be prompted to approve it. The plugin needs approval because it:

- Writes files to the filesystem (`chat_history/` directory)
- Accesses the OpenCode client API

To approve:
1. Start OpenCode
2. When prompted, review the plugin capabilities
3. Type `y` or select "Approve" to allow the plugin to run

### 4. Restart OpenCode

After installation and approval, restart OpenCode for the plugin to load.

## Files

| File | Purpose |
|------|---------|
| `.opencode/plugins/chat-history-logger.ts` | Main plugin that auto-logs messages |
| `.opencode/package.json` | Plugin dependencies |
| `.opencode/opencode.json` | Plugin registration config |
| `.opencode/commands/chat-history-on.md` | `/chat-history-on` command |
| `.opencode/commands/chat-history-off.md` | `/chat-history-off` command |
| `.opencode/chat-history-enabled` | State file (presence = enabled) |
| `chat_history/YYYY_MM_DD.md` | Daily log files |

## Usage

### Commands

| Command | What it does |
|---------|--------------|
| `/chat-history-on` | Creates the state file to enable logging |
| `/chat-history-off` | Deletes the state file to disable logging |

### Behavior

- **Automatic start** - Logging begins immediately when plugin loads
- **Toggle anytime** - Use commands to turn on/off without restarting
- **State persists** - Your on/off preference stays until you change it
- **Creates directories** - Automatically creates `chat_history/` if missing

## Output Format

Messages are logged to `chat_history/YYYY_MM_DD.md` with timestamps:

```markdown
# Chat History - Thursday, January 29, 2026

---

### User [14:30]

Your message here

---

### Assistant [14:31]

Response here

---
```

## Troubleshooting

### Plugin not loading
- Check that `.opencode/opencode.json` exists with the correct plugin path
- Verify dependencies are installed: `cd .opencode && bun install`
- Look for `[ChatHistoryLogger] Plugin initialized successfully!` in console

### Messages not being logged
- Check if state file exists: `ls .opencode/chat-history-enabled`
- Run `/chat-history-on` to enable logging
- Check console for `[ChatHistoryLogger]` debug messages

### Permission errors
- Ensure the plugin has been approved in OpenCode
- Check write permissions for the project directory
