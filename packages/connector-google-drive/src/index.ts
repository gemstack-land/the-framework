import { defineConnector, McpResponse } from '@gemstack/connectors'
import { z } from 'zod'
import { gd, gdText } from './client.js'

export { GoogleDriveError } from './client.js'

const enc = encodeURIComponent
const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Fields requested for a file listing/metadata, kept to what an agent needs. */
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,owners(emailAddress),webViewLink'

/** Escape a string for use inside a single-quoted Drive query literal. */
const driveStr = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Slim a Drive file resource down to the fields an agent needs. */
function slimFile(f: Record<string, any>) {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: f.mimeType === FOLDER_MIME,
    size: f.size != null ? Number(f.size) : undefined,
    modifiedTime: f.modifiedTime,
    owners: Array.isArray(f.owners) ? f.owners.map((o: any) => o?.emailAddress).filter(Boolean) : undefined,
    url: f.webViewLink,
  }
}

/** Map a Google editor mime type to the text format it can be exported as. */
function exportMimeFor(mime: string): string | undefined {
  switch (mime) {
    case 'application/vnd.google-apps.document':
      return 'text/plain'
    case 'application/vnd.google-apps.spreadsheet':
      return 'text/csv'
    case 'application/vnd.google-apps.presentation':
      return 'text/plain'
    default:
      return undefined
  }
}

/**
 * Google Drive connector: browse, read, and share Drive files.
 *
 * Auth is a Google OAuth 2.0 access token. Drive has no static API key, so the
 * orchestrator supplies a bearer via the mount `credentials` option (the same
 * seam every connector uses).
 */
export default defineConnector({
  id: 'google-drive',
  name: 'Google Drive',
  instructions: 'Browse, read, and share files in Google Drive.',
  auth: {
    type: 'oauth',
    scopes: ['https://www.googleapis.com/auth/drive'],
    description:
      'Google OAuth 2.0 access token with a Drive scope (`drive` for full access, `drive.readonly` for read-only).',
  },
  tools: [
    {
      name: 'get-about',
      description: "Get the authenticated user's identity and Drive storage usage.",
      schema: z.object({}),
      annotations: { readOnly: true, openWorld: true },
      handle: async (_input: Record<string, never>, ctx) => {
        const a = await gd<Record<string, any>>(
          ctx,
          'GET',
          '/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)',
        )
        return {
          user: a.user?.displayName,
          email: a.user?.emailAddress,
          storageUsage: a.storageQuota?.usage != null ? Number(a.storageQuota.usage) : undefined,
          storageLimit: a.storageQuota?.limit != null ? Number(a.storageQuota.limit) : undefined,
        }
      },
    },
    {
      name: 'list-files',
      description:
        'List files (newest first). Optionally scope to a folder, or pass a raw Drive `query` expression. Trashed files are excluded by default.',
      schema: z.object({
        folderId: z.string().min(1).optional(),
        query: z.string().min(1).optional(),
        includeTrashed: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (
        input: { folderId?: string; query?: string; includeTrashed?: boolean; limit?: number },
        ctx,
      ) => {
        const clauses: string[] = []
        if (input.folderId) clauses.push(`'${driveStr(input.folderId)}' in parents`)
        if (!input.includeTrashed) clauses.push('trashed = false')
        if (input.query) clauses.push(`(${input.query})`)
        const params = new URLSearchParams({
          pageSize: String(input.limit ?? 30),
          orderBy: 'modifiedTime desc',
          fields: `files(${FILE_FIELDS})`,
        })
        if (clauses.length) params.set('q', clauses.join(' and '))
        const res = await gd<{ files?: Record<string, any>[] }>(ctx, 'GET', `/files?${params}`)
        return (res.files ?? []).map(slimFile)
      },
    },
    {
      name: 'search-files',
      description: 'Search Drive by file name and full-text content. Trashed files are excluded.',
      schema: z.object({ text: z.string().min(1), limit: z.number().int().min(1).max(100).optional() }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { text: string; limit?: number }, ctx) => {
        const t = driveStr(input.text)
        const params = new URLSearchParams({
          q: `(name contains '${t}' or fullText contains '${t}') and trashed = false`,
          pageSize: String(input.limit ?? 20),
          orderBy: 'modifiedTime desc',
          fields: `files(${FILE_FIELDS})`,
        })
        const res = await gd<{ files?: Record<string, any>[] }>(ctx, 'GET', `/files?${params}`)
        return (res.files ?? []).map(slimFile)
      },
    },
    {
      name: 'get-file',
      description: 'Get metadata for a single file or folder by id.',
      schema: z.object({ fileId: z.string().min(1) }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { fileId: string }, ctx) => {
        const f = await gd<Record<string, any>>(
          ctx,
          'GET',
          `/files/${enc(input.fileId)}?fields=${FILE_FIELDS},parents,description`,
        )
        return { ...slimFile(f), parents: f.parents, description: f.description }
      },
    },
    {
      name: 'get-file-content',
      description:
        'Read a file as text. Google Docs/Sheets/Slides are exported (to text/CSV); other files are downloaded directly.',
      schema: z.object({ fileId: z.string().min(1) }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { fileId: string }, ctx) => {
        const id = enc(input.fileId)
        const meta = await gd<Record<string, any>>(ctx, 'GET', `/files/${id}?fields=id,name,mimeType`)
        const mime: string = meta.mimeType ?? ''
        if (mime === FOLDER_MIME) return McpResponse.error(`"${meta.name}" is a folder, not a file`)
        let content: string
        if (mime.startsWith('application/vnd.google-apps.')) {
          const exportMime = exportMimeFor(mime)
          if (!exportMime) return McpResponse.error(`cannot export ${mime} as text`)
          content = await gdText(ctx, `/files/${id}/export?mimeType=${enc(exportMime)}`)
        } else {
          content = await gdText(ctx, `/files/${id}?alt=media`)
        }
        return { id: meta.id, name: meta.name, mimeType: mime, content }
      },
    },
    {
      name: 'list-permissions',
      description: 'List who has access to a file or folder.',
      schema: z.object({ fileId: z.string().min(1) }),
      annotations: { readOnly: true, openWorld: true },
      handle: async (input: { fileId: string }, ctx) => {
        const res = await gd<{ permissions?: Record<string, any>[] }>(
          ctx,
          'GET',
          `/files/${enc(input.fileId)}/permissions?fields=permissions(id,type,role,emailAddress,domain)`,
        )
        return (res.permissions ?? []).map((p) => ({
          id: p.id,
          type: p.type,
          role: p.role,
          emailAddress: p.emailAddress,
          domain: p.domain,
        }))
      },
    },
    {
      name: 'create-folder',
      description: 'Create a new folder, optionally inside a parent folder.',
      schema: z.object({ name: z.string().min(1), parentId: z.string().min(1).optional() }),
      annotations: { openWorld: true },
      handle: async (input: { name: string; parentId?: string }, ctx) => {
        const payload: Record<string, unknown> = { name: input.name, mimeType: FOLDER_MIME }
        if (input.parentId) payload.parents = [input.parentId]
        const f = await gd<Record<string, any>>(ctx, 'POST', `/files?fields=id,name,webViewLink`, payload)
        return { id: f.id, name: f.name, url: f.webViewLink }
      },
    },
    {
      name: 'share-file',
      description: 'Grant access to a file or folder by creating a permission.',
      schema: z.object({
        fileId: z.string().min(1),
        role: z.enum(['reader', 'commenter', 'writer', 'owner']).optional(),
        type: z.enum(['user', 'group', 'domain', 'anyone']).optional(),
        emailAddress: z.string().min(1).optional(),
        domain: z.string().min(1).optional(),
      }),
      annotations: { openWorld: true },
      handle: async (
        input: { fileId: string; role?: string; type?: string; emailAddress?: string; domain?: string },
        ctx,
      ) => {
        const type = input.type ?? 'user'
        if ((type === 'user' || type === 'group') && !input.emailAddress) {
          return McpResponse.error(`type "${type}" requires an emailAddress`)
        }
        if (type === 'domain' && !input.domain) return McpResponse.error('type "domain" requires a domain')
        const payload: Record<string, unknown> = { role: input.role ?? 'reader', type }
        if (input.emailAddress) payload.emailAddress = input.emailAddress
        if (input.domain) payload.domain = input.domain
        const p = await gd<Record<string, any>>(
          ctx,
          'POST',
          `/files/${enc(input.fileId)}/permissions?fields=id,role,type`,
          payload,
        )
        return { id: p.id, role: p.role, type: p.type }
      },
    },
    {
      name: 'trash-file',
      description: 'Move a file or folder to the trash (reversible).',
      schema: z.object({ fileId: z.string().min(1) }),
      annotations: { destructive: true, openWorld: true },
      handle: async (input: { fileId: string }, ctx) => {
        const f = await gd<Record<string, any>>(
          ctx,
          'PATCH',
          `/files/${enc(input.fileId)}?fields=id,name,trashed`,
          { trashed: true },
        )
        return { id: f.id, name: f.name, trashed: f.trashed }
      },
    },
  ],
})
