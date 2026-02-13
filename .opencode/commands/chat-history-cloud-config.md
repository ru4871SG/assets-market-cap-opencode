---
description: Update cloud sync configuration (MongoDB or Supabase)
---

Update the cloud sync configuration for chat history logging.

Follow these steps:

1. Read existing config from `.opencode/chat-history-cloud-config.json` if it exists. Show current settings (mask sensitive values).

2. Ask the user what they want to update:
   - **Switch provider** - Change between MongoDB and Supabase
   - **Update connection details** - Update credentials/URLs for the current provider

3. Based on their choice:

   **For MongoDB:**
   - Ask for: Connection string, Database name, Collection name
   - Show current values as defaults (mask the connection string password)

   **For Supabase:**
   - Ask for: Project URL, API Key, Table name
   - Show current values as defaults (mask the API key)

4. Save the updated configuration to `.opencode/chat-history-cloud-config.json`

   **MongoDB format (use these exact keys):**
   ```json
   {
     "provider": "mongodb",
     "connectionString": "mongodb+srv://username:password@cluster.mongodb.net",
     "database": "your_db_name",
     "collection": "your_collection_name"
   }
   ```

   **Supabase format (use these exact keys):**
   ```json
   {
     "provider": "supabase",
     "supabase_url": "https://your-project.supabase.co",
     "supabase_key": "your-anon-or-service-key",
     "supabase_table": "chat_history"
   }
   ```

5. If cloud sync is currently enabled (enabled here meas `chat-history-cloud-enabled` exists inside `.opencode` folder), inform the user the new settings will take effect on the next hook invocation.

6. If the file `chat-history-cloud-enabled` doesn't exist inside `.opencode` folder, create the file `chat-history-cloud-enabled` inside `.opencode` folder with the content "enabled".

7. Remind the user to keep `.opencode/chat-history-cloud-config.json` in their `.gitignore`.

8. Remind the user that provider in `.opencode/chat-history-cloud-config.json` should only have just one provider at a time, it doesn't support having both supabase and mongodb at the same time.

9.  Remind the user that if they use Supabase in the `.opencode/chat-history-cloud-config.json` as the provider, tell them they need to create the table in Supabase first with this SQL:
   ```sql
   CREATE TABLE chat_history (
     id BIGSERIAL PRIMARY KEY,
     session_id TEXT NOT NULL,
     timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     date TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
     content TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT 'opencode',
     project_path TEXT,
     project_name TEXT,
     local_file TEXT,
     message_id TEXT,
     truncated BOOLEAN DEFAULT FALSE
   );
   ```

After completing, respond with: "Cloud sync configuration updated."

