// netlify/functions/data.js
// Единое хранилище задач/категорий. Используется и PWA, и Telegram-ботом (netlify/functions/telegram.js),
// поэтому в обоих местах видны одни и те же данные.
const { readData, writeData } = require('./_lib/store');

exports.handler = async (event) => {
  const apiKey = process.env.API_KEY;
  const provided = event.headers['x-api-key'] || event.headers['X-Api-Key'];

  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API_KEY is not configured on the server' }) };
  }
  if (provided !== apiKey) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const data = await readData();
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      const incoming = JSON.parse(event.body || '{}');
      const data = {
        tasks: Array.isArray(incoming.tasks) ? incoming.tasks : [],
        categories: Array.isArray(incoming.categories) ? incoming.categories : [],
        theme: incoming.theme === 'dark' ? 'dark' : 'light',
      };
      await writeData(data);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
