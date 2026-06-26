import type { AiMessage, ConversationStore, ConversationStoreListEntry, ConversationStoreMeta } from './types.js'

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export class MemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, {
    title: string
    messages: AiMessage[]
    meta?: ConversationStoreMeta | undefined
    createdAt: Date
    updatedAt: Date
  }>()

  async create(title?: string, meta?: ConversationStoreMeta): Promise<string> {
    const id = generateId()
    const now = new Date()
    this.conversations.set(id, {
      title: title ?? 'New conversation',
      messages: [],
      meta,
      createdAt: now,
      updatedAt: now,
    })
    return id
  }

  async load(conversationId: string): Promise<AiMessage[]> {
    const conv = this.conversations.get(conversationId)
    if (!conv) throw new Error(`[ai-sdk] Conversation "${conversationId}" not found.`)
    return [...conv.messages]
  }

  async append(conversationId: string, messages: AiMessage[]): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) throw new Error(`[ai-sdk] Conversation "${conversationId}" not found.`)
    conv.messages.push(...messages)
    conv.updatedAt = new Date()
  }

  async setTitle(conversationId: string, title: string): Promise<void> {
    const conv = this.conversations.get(conversationId)
    if (!conv) throw new Error(`[ai-sdk] Conversation "${conversationId}" not found.`)
    conv.title = title
  }

  async list(userId?: string): Promise<ConversationStoreListEntry[]> {
    return Array.from(this.conversations.entries())
      .filter(([, conv]) => userId == null || conv.meta?.userId === userId)
      .map(([id, conv]) => ({
        id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        ...(conv.meta?.agent ? { agent: conv.meta.agent } : {}),
      }))
      .sort((a, b) => b.updatedAt!.getTime() - a.updatedAt!.getTime())
  }

  async delete(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId)
  }
}
