import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initDocumentTable, saveDocument, getAllDocuments, getDocument, deleteDocument } from './documentStore.ts'

test('save/get/list/delete 往返', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const doc = saveDocument({ filename: '碳酸锂', size_bytes: 100, chunk_count: 5 })
  assert.equal(getDocument(doc.id)?.filename, '碳酸锂')
  assert.equal(getAllDocuments().length, 1)
  deleteDocument(doc.id)
  assert.equal(getAllDocuments().length, 0)
})
