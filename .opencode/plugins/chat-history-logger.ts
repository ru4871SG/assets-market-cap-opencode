import type { Plugin } from "@opencode-ai/plugin"
import { appendFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

export const ChatHistoryLogger: Plugin = async ({ directory, client }) => {
  const chatHistoryDir = join(directory, "chat_history")
  const stateFile = join(directory, ".opencode", "chat-history-enabled")
  
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

  const isEnabled = () => existsSync(stateFile)

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
    
    // Clean up message data after logging
    messageData.delete(messageID)
  }

  return {
    // Use the 'event' hook to capture all events
    event: async ({ event }) => {
      try {
        // Check if logging is enabled
        if (!isEnabled()) return

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
