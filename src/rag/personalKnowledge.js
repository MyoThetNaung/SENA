import { ingestDocument, listKnowledgeDocuments, deleteKnowledgeDocument } from "./ingest.js";

export function personalSourceSlug(userId) {
  return `personal-${Math.floor(Number(userId))}`;
}

export function personalSourceTitle(userId) {
  return `Personal knowledge (user ${Math.floor(Number(userId))})`;
}

/**
 * @param {number} userId
 * @param {object} opts
 */
export async function ingestPersonalDocument(userId, opts) {
  const uid = Math.floor(Number(userId));
  if (!Number.isFinite(uid)) throw new Error("Invalid user id");
  return ingestDocument({
    sourceSlug: personalSourceSlug(uid),
    sourceTitle: personalSourceTitle(uid),
    sourceType: "personal",
    documentTitle: opts.documentTitle,
    content: opts.content,
    externalId: opts.externalId,
    uri: opts.uri,
    metadata: opts.metadata,
    acl: { userIds: [uid] },
  });
}

export async function listPersonalDocuments(userId, limit = 100) {
  const slug = personalSourceSlug(userId);
  const docs = await listKnowledgeDocuments(limit);
  return docs.filter((d) => d.source_slug === slug);
}

export async function deletePersonalDocument(userId, documentId) {
  const uid = Math.floor(Number(userId));
  const docs = await listPersonalDocuments(uid, 500);
  const row = docs.find((d) => Number(d.id) === Number(documentId));
  if (!row) return false;
  return deleteKnowledgeDocument(documentId);
}
