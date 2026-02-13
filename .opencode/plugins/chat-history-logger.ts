import type { Plugin } from "@opencode-ai/plugin"
import { appendFile, writeFile, readFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join, basename } from "path"

// Content truncation settings
const MAX_CONTENT_SIZE = 14 * 1024 * 1024 // 14MB (leave 2MB buffer for metadata)
const TRUNCATION_SUFFIX = "...."

function truncateContent(content: string): string {
  if (content.length * 1 >= MAX_CONTENT_SIZE) { // *1 for conservative UTF-8 byte estimate
    return content.slice(0, MAX_CONTENT_SIZE - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
  }
  return content
}

// Cloud provider types
interface CloudConfig {
  provider: "mongodb" | "supabase"
  // MongoDB settings
  connectionString?: string
  database?: string
  collection?: string
  // Supabase settings
  supabase_url?: string
  supabase_key?: string
  supabase_table?: string
}

interface ChatDocument {
  session_id: string
  timestamp: string
  date: string
  role: "user" | "assistant"
  content: string
  source: "opencode"
  project_path: string
  project_name: string
  metadata: {
    local_file: string
    message_id: string
    truncated?: boolean
  }
}

// Cloud sync abstraction
interface CloudProvider {
  connect(): Promise<boolean>
  insertMessage(doc: ChatDocument): Promise<boolean>
  disconnect(): Promise<void>
}

// MongoDB provider implementation
class MongoDBProvider implements CloudProvider {
  private client: any = null
  private collection: any = null
  private config: CloudConfig

  constructor(config: CloudConfig) {
    this.config = config
  }

  async connect(): Promise<boolean> {
    try {
      const { MongoClient } = await import("mongodb")
      this.client = new MongoClient(this.config.connectionString || "")
      await this.client.connect()
      const db = this.client.db(this.config.database || "chat_history")
      this.collection = db.collection(this.config.collection || "conversations")
      
      // Create indexes for efficient querying
      await this.collection.createIndex({ date: 1 })
      await this.collection.createIndex({ project_name: 1 })
      await this.collection.createIndex({ timestamp: -1 })
      await this.collection.createIndex({ session_id: 1 })
      
      return true
    } catch (error) {
      console.error("[ChatHistoryLogger] MongoDB connection failed:", error)
      return false
    }
  }

  async insertMessage(doc: ChatDocument): Promise<boolean> {
    try {
      if (!this.collection) return false
      await this.collection.insertOne({
        ...doc,
        _created_at: new Date(),
      })
      return true
    } catch (error) {
      console.error("[ChatHistoryLogger] MongoDB insert failed:", error)
      return false
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close()
        this.client = null
        this.collection = null
      }
    } catch (error) {
      console.error("[ChatHistoryLogger] MongoDB disconnect error:", error)
    }
  }
}

// Supabase provider implementation
class SupabaseProvider implements CloudProvider {
  private client: any = null
  private tableName: string
  private config: CloudConfig

  constructor(config: CloudConfig) {
    this.config = config
    this.tableName = config.supabase_table || "chat_history"
  }

  async connect(): Promise<boolean> {
    try {
      const { createClient } = await import("@supabase/supabase-js")
      this.client = createClient(
        this.config.supabase_url || "",
        this.config.supabase_key || ""
      )
      
      // Verify connection by attempting a simple query
      const { error } = await this.client
        .from(this.tableName)
        .select("*")
        .limit(1)
      
      if (error) {
        console.error("[ChatHistoryLogger] Supabase query test failed:", error.message)
        // Table might not exist yet - that's OK, insert will create it if RLS allows
        // But we still consider connection successful if client was created
      }
      
      return true
    } catch (error) {
      console.error("[ChatHistoryLogger] Supabase connection failed:", error)
      return false
    }
  }

  async insertMessage(doc: ChatDocument): Promise<boolean> {
    try {
      if (!this.client) return false
      
      const { error } = await this.client
        .from(this.tableName)
        .insert({
          session_id: doc.session_id,
          timestamp: doc.timestamp,
          date: doc.date,
          role: doc.role,
          content: doc.content,
          source: doc.source,
          project_path: doc.project_path,
          project_name: doc.project_name,
          local_file: doc.metadata.local_file,
          message_id: doc.metadata.message_id,
          truncated: doc.metadata.truncated || false,
        })
      
      if (error) {
        console.error("[ChatHistoryLogger] Supabase insert failed:", error.message)
        return false
      }
      return true
    } catch (error) {
      console.error("[ChatHistoryLogger] Supabase insert error:", error)
      return false
    }
  }

  async disconnect(): Promise<void> {
    // Supabase client doesn't need explicit disconnect
    this.client = null
  }
}

export const ChatHistoryLogger: Plugin = async ({ directory, client }) => {
  const chatHistoryDir = join(directory, "chat_history")
  const stateFile = join(directory, ".opencode", "chat-history-enabled")
  const cloudStateFile = join(directory, ".opencode", "chat-history-cloud-enabled")
  const cloudConfigFile = join(directory, ".opencode", "chat-history-cloud-config.json")
  
  // Ensure chat_history directory exists
  if (!existsSync(chatHistoryDir)) {
    await mkdir(chatHistoryDir, { recursive: true })
  }

  // Create enabled state file if it doesn't exist (ON by default)
  if (!existsSync(stateFile)) {
    await writeFile(stateFile, "enabled", "utf-8")
  }

  // Track message info (role, parts content) by messageID
  const messageData = new Map<string, {
    role: "user" | "assistant"
    parts: Map<number, string>  // partIndex -> latest content
    logged: boolean
  }>()

  // Track which messages we've already logged
  const loggedMessages = new Set<string>()

  // Cloud provider instance
  let cloudProvider: CloudProvider | null = null
  let cloudConnected = false
  let sessionId = `opencode_${Date.now()}`

  const isEnabled = () => existsSync(stateFile)
  const isCloudEnabled = () => existsSync(cloudStateFile)

  // Load cloud configuration
  const loadCloudConfig = async (): Promise<CloudConfig | null> => {
    try {
      if (!existsSync(cloudConfigFile)) return null
      const raw = await readFile(cloudConfigFile, "utf-8")
      return JSON.parse(raw) as CloudConfig
    } catch (error) {
      console.error("[ChatHistoryLogger] Failed to load cloud config:", error)
      return null
    }
  }

  // Initialize cloud provider
  const initCloudProvider = async (): Promise<void> => {
    if (!isCloudEnabled()) return
    
    const config = await loadCloudConfig()
    if (!config) {
      console.error("[ChatHistoryLogger] Cloud sync enabled but no config found. Create .opencode/chat-history-cloud-config.json")
      return
    }

    try {
      if (config.provider === "mongodb") {
        cloudProvider = new MongoDBProvider(config)
      } else if (config.provider === "supabase") {
        cloudProvider = new SupabaseProvider(config)
      } else {
        console.error(`[ChatHistoryLogger] Unknown cloud provider: ${config.provider}`)
        return
      }

      cloudConnected = await cloudProvider.connect()
      if (cloudConnected) {
        console.log(`[ChatHistoryLogger] Connected to ${config.provider} cloud sync`)
      } else {
        console.error(`[ChatHistoryLogger] Failed to connect to ${config.provider}`)
      }
    } catch (error) {
      console.error("[ChatHistoryLogger] Cloud provider init failed:", error)
      cloudConnected = false
    }
  }

  // Sync message to cloud
  const syncToCloud = async (messageID: string, role: "user" | "assistant", content: string): Promise<void> => {
    if (!cloudConnected || !cloudProvider) return

    try {
      const truncatedContent = truncateContent(content)
      const wasTruncated = truncatedContent !== content

      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, "0")
      const day = String(now.getDate()).padStart(2, "0")
      const dateStr = `${year}_${month}_${day}`

      const doc: ChatDocument = {
        session_id: sessionId,
        timestamp: now.toISOString(),
        date: dateStr,
        role,
        content: truncatedContent,
        source: "opencode",
        project_path: directory,
        project_name: basename(directory),
        metadata: {
          local_file: `chat_history/${dateStr}.md`,
          message_id: messageID,
          truncated: wasTruncated,
        },
      }

      const success = await cloudProvider.insertMessage(doc)
      if (!success) {
        console.error("[ChatHistoryLogger] Failed to sync message to cloud")
      }
    } catch (error) {
      console.error("[ChatHistoryLogger] Cloud sync error:", error)
    }
  }

  // Initialize cloud on startup
  await initCloudProvider()

  const getFilePath = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    return join(chatHistoryDir, `${year}_${month}_${day}.md`)
  }

  const formatTimestamp = () => {
    const now = new Date()
    return now.toLocaleTimeString("en-US", { 
      hour: "2-digit", 
      minute: "2-digit",
      hour12: false 
    })
  }

  const appendToFile = async (content: string) => {
    const filePath = getFilePath()
    
    // Check if file exists, if not create with header
    if (!existsSync(filePath)) {
      const now = new Date()
      const header = `# Chat History - ${now.toLocaleDateString("en-US", { 
        weekday: "long", 
        year: "numeric", 
        month: "long", 
        day: "numeric" 
      })}\n\n---\n\n`
      await writeFile(filePath, header, "utf-8")
    }

    await appendFile(filePath, content, "utf-8")
  }

  const logMessage = async (messageID: string) => {
    // Don't log the same message twice
    if (loggedMessages.has(messageID)) return
    
    const data = messageData.get(messageID)
    if (!data) return
    
    // Combine all text parts into final content
    const sortedParts = Array.from(data.parts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, content]) => content)
    
    const content = sortedParts.join("\n").trim()
    if (!content) return
    
    // Mark as logged
    loggedMessages.add(messageID)
    
    const roleLabel = data.role === "user" ? "User" : "Assistant"
    const timestamp = formatTimestamp()
    const formattedMessage = `### ${roleLabel} [${timestamp}]\n\n${content}\n\n---\n\n`
    
    await appendToFile(formattedMessage)

    // Cloud sync (non-blocking - errors won't break local logging)
    syncToCloud(messageID, data.role, content).catch(() => {})
    
    // Clean up message data after logging
    messageData.delete(messageID)
  }

  return {
    // Use the 'event' hook to capture all events
    event: async ({ event }) => {
      try {
        // Check if logging is enabled
        if (!isEnabled()) return

        // Re-check cloud connection status on each event cycle
        // This handles cases where cloud config was changed at runtime
        if (isCloudEnabled() && !cloudConnected) {
          await initCloudProvider()
        } else if (!isCloudEnabled() && cloudConnected) {
          // Cloud was disabled, disconnect
          if (cloudProvider) {
            await cloudProvider.disconnect()
            cloudProvider = null
            cloudConnected = false
          }
        }

        // Track message role and initialize data structure
        if (event.type === "message.updated") {
          const message = event.properties.info
          
          if (!messageData.has(message.id)) {
            messageData.set(message.id, {
              role: message.role,
              parts: new Map(),
              logged: false
            })
          }
          
          // Check if message is complete (has metadata indicating completion)
          // User messages are complete immediately, assistant messages complete when streaming ends
          if (message.role === "user") {
            // User messages don't stream, log them right away on first update
            // But wait for part content to arrive
          }
        }
        
        // Track the latest content for each part (streaming updates)
        if (event.type === "message.part.updated") {
          const part = event.properties.part
          
          // Only log text parts
          if (part.type !== "text") return
          
          // Skip synthetic or ignored parts
          if (part.synthetic || part.ignored) return
          
          const content = part.text?.trim() || ""
          if (!content) return
          
          // Initialize message data if not exists
          if (!messageData.has(part.messageID)) {
            messageData.set(part.messageID, {
              role: "assistant", // Default, will be updated by message.updated
              parts: new Map(),
              logged: false
            })
          }
          
          // Update the latest content for this part (overwrites previous streaming content)
          const data = messageData.get(part.messageID)!
          data.parts.set((part as any).index || 0, content)
        }
        
        // Update session ID when a new session starts
        if (event.type === "session.created") {
          sessionId = `opencode_${Date.now()}`
        }

        // Log all pending messages when session becomes idle (conversation turn complete)
        if (event.type === "session.idle") {
          // Log all unlogged messages
          for (const [messageID] of messageData.entries()) {
            if (!loggedMessages.has(messageID)) {
              await logMessage(messageID)
            }
          }
          
          // Clear tracking data for next conversation turn
          messageData.clear()
        }
      } catch (error) {
        console.error("[ChatHistoryLogger] Error:", error)
      }
    },
  }
}
