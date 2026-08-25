// Общий доступ к данным для data.js (PWA) и telegram.js (бот).
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'todo-app';
const DATA_KEY = 'todo-data';

function blobStore() {
  return getStore(STORE_NAME);
}

async function readData() {
  const s = blobStore();
  const raw = await s.get(DATA_KEY, { type: 'json' });
  return raw || { tasks: [], categories: [], theme: 'light' };
}

async function writeData(data) {
  const s = blobStore();
  await s.setJSON(DATA_KEY, data);
}

function uid(prefix) {
  return (prefix || 't') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function sessionGet(chatId) {
  const s = blobStore();
  const raw = await s.get('session:' + chatId, { type: 'json' });
  return raw || null;
}

async function sessionSet(chatId, session) {
  const s = blobStore();
  if (session === null) {
    await s.delete('session:' + chatId);
  } else {
    await s.setJSON('session:' + chatId, session);
  }
}

module.exports = { readData, writeData, uid, sessionGet, sessionSet };
