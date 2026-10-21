const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (!match) continue;

    const name = match[1];
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[name]) process.env[name] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const API_KEY = process.env.CHATTERMATE_API_KEY;
const SYSTEM_PROMPT =
  "You are a hospital report assistant. Answer only from the report data given. Never invent numbers. If the data doesn't have the answer, say so. Money is in Taka (Tk). Keep answers short. You cannot change any data; refuse requests to edit or delete.";

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    req.on('error', reject);
  });
}

function httpsRequest(urlPath, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'chattermate.ai',
      path: urlPath,
      method,
      headers: {
        ...headers,
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        resolve({ statusCode: response.statusCode || 500, body: responseBody });
      });
    });

    request.setTimeout(60_000, () => request.destroy(new Error('ChatterMate request timed out.')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function extractModelChunks(sseText) {
  const chunks = [];
  const events = sseText.replace(/\r\n/g, '\n').split('\n\n');

  for (const eventBlock of events) {
    const lines = eventBlock.split('\n');
    const eventName = lines
      .find(line => line.startsWith('event:'))
      ?.slice('event:'.length)
      .trim();

    if (eventName !== 'model_chunk') continue;

    const data = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trim())
      .join('\n');

    if (!data) continue;

    try {
      const parsed = JSON.parse(data);
      if (typeof parsed.content === 'string') chunks.push(parsed.content);
    } catch {
      // Ignore SSE events that are not JSON model chunks.
    }
  }

  return chunks.join('');
}

async function askChatterMate(question, reportData) {
  if (!API_KEY) {
    throw new Error('CHATTERMATE_API_KEY is missing. Set it in your .env file.');
  }

  const modelsResponse = await httpsRequest('/api/chat/models', {
    headers: { 'X-API-Key': API_KEY }
  });

  if (modelsResponse.statusCode < 200 || modelsResponse.statusCode >= 300) {
    throw new Error(`Could not load ChatterMate models (HTTP ${modelsResponse.statusCode}).`);
  }

  let modelsJson;
  try {
    modelsJson = JSON.parse(modelsResponse.body);
  } catch {
    throw new Error('ChatterMate returned invalid model data.');
  }

  const defaultModelId = modelsJson.default_model_id;
  if (!defaultModelId) throw new Error('ChatterMate did not return default_model_id.');

  const requestBody = JSON.stringify({
    models: [defaultModelId],
    system_prompt: SYSTEM_PROMPT,
    prompt: `Report data: ${JSON.stringify(reportData)} Question: ${question}`
  });

  const chatResponse = await httpsRequest('/api/chat/stream', {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    },
    body: requestBody
  });

  if (chatResponse.statusCode < 200 || chatResponse.statusCode >= 300) {
    throw new Error(`ChatterMate returned HTTP ${chatResponse.statusCode}.`);
  }

  const answer = extractModelChunks(chatResponse.body);
  return answer || "I don't know based on the report data provided.";
}

async function handleAsk(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || !Object.prototype.hasOwnProperty.call(body, 'data')) {
    return sendJson(res, 400, { error: 'Send JSON containing question and data.' });
  }

  try {
    const answer = await askChatterMate(question, body.data);
    return sendJson(res, 200, { answer });
  } catch (error) {
    console.error('AI request failed:', error.message);
    return sendJson(res, 502, { error: 'The AI assistant could not answer. Check the server console.' });
  }
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(status === 404 ? 'Not found' : 'Server error');
    }

    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/ask') {
    handleAsk(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD, POST' });
    return res.end('Method not allowed');
  }

  if (req.method === 'HEAD') {
    res.writeHead(200);
    return res.end();
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Hospital website running at http://localhost:${PORT}`);
});