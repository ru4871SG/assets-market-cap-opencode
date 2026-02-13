---
description: Check cloud sync status and connection info
---

Check the current status of chat history cloud synchronization.

Follow these steps:

1. Check if `.opencode/chat-history-enabled` exists:
   - If yes: "Local logging: ON"
   - If no: "Local logging: OFF"

2. Check if `.opencode/chat-history-cloud-enabled` exists:
   - If yes: "Cloud sync: ON"
   - If no: "Cloud sync: OFF"

3. If cloud sync is ON, read `.opencode/chat-history-cloud-config.json` and display:
   - Cloud Provider: [mongodb or supabase]
   - For MongoDB:
     - Database: [database name]
     - Collection: [collection name]
     - Connection: [mask the connection string - show only the host part, hide username/password]
   - For Supabase:
     - Project URL: [supabase URL]
     - Table: [table name]
     - Key: [show only first 8 characters followed by ****]

4. Provide a summary like:
   ```
   Chat History Logger Status
   -------------------------
   Local logging:  ON/OFF
   Cloud sync:     ON/OFF
   Cloud provider: MongoDB/Supabase/Not configured
   ```

If neither local logging nor cloud sync is enabled, suggest running `/chat-history-on` first, then `/chat-history-cloud-on`.
