const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());


//  FILE HELPERS

function readJSON(path, defaultValue) {
  try {
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }

    const content = fs.readFileSync(path, 'utf-8').trim();

    if (!content) {
      fs.writeFileSync(path, JSON.stringify(defaultValue, null, 2));
      return defaultValue;
    }

    return JSON.parse(content);
  } catch (err) {
    console.error(`⚠ Error reading ${path}. Resetting file.`);
    fs.writeFileSync(path, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
}

function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function nowUTC() {
  return new Date().toISOString();
}

function isExpired(token) {
  return new Date(token.expiresAt) < new Date();
}

//   PHASE 1 – COUNTER

const COUNTER_FILE = './counter.json';
let counterData = readJSON(COUNTER_FILE, { counter: 0 });

app.post('/v1/counter/increment', (req, res) => {
  if (Object.keys(req.body).length !== 0) {
    return res.status(400).json({
      message: "Invalid request payload",
      timestamp: nowUTC()
    });
  }

  counterData.counter++;
  writeJSON(COUNTER_FILE, counterData);

  res.status(200).json({
    message: "Counter incremented successfully",
    counter: counterData.counter,
    timestamp: nowUTC()
  });
});

//   PHASE 2 – TOKENS (NO EXPIRY)

const TOKENS_FILE = './tokens.json';
let tokens = readJSON(TOKENS_FILE, {});
let tokenCounter = Object.keys(tokens).length + 1;

app.post('/v1/tokens', (req, res) => {
  const { serviceRequestId, requestType, requestedBy } = req.body;

  if (!serviceRequestId || !requestType || !requestedBy) {
    return res.status(400).json({
      message: "Invalid request payload",
      timestamp: nowUTC()
    });
  }

  if (tokens[serviceRequestId]) {
    const t = tokens[serviceRequestId];
    return res.status(409).json({
      message: "Token already exist",
      existingTokenNumber: t.tokenNumber,
      status: t.status,
      timestamp: nowUTC()
    });
  }

  const tokenNumber = `TKN-${String(tokenCounter++).padStart(6, '0')}`;

  tokens[serviceRequestId] = {
    tokenNumber,
    serviceRequestId,
    requestType,
    requestedBy,
    status: "OPEN",
    createdAt: nowUTC()
  };

  writeJSON(TOKENS_FILE, tokens);

  res.status(201).json({
    message: "Token created successfully",
    tokenNumber,
    serviceRequestId,
    status: "OPEN",
    createdAt: tokens[serviceRequestId].createdAt
  });
});

app.post('/v1/tokens/:tokenNumber/close', (req, res) => {
  const tokenEntry = Object.entries(tokens)
    .find(([_, t]) => t.tokenNumber === req.params.tokenNumber);

  if (!tokenEntry) {
    return res.status(404).json({
      message: "Token does not exist",
      tokenNumber: req.params.tokenNumber,
      timestamp: nowUTC()
    });
  }

  const [serviceRequestId, token] = tokenEntry;
  token.status = "CLOSED";
  token.closedAt = nowUTC();

  tokens[serviceRequestId] = token;
  writeJSON(TOKENS_FILE, tokens);

  res.status(200).json({
    message: "Token closed successfully",
    tokenNumber: token.tokenNumber,
    status: "CLOSED",
    closedAt: token.closedAt
  });
});


// PHASE 3 – EXPIRING TOKENS

const EXPIRING_FILE = './expiringTokens.json';
let expiringTokens = readJSON(EXPIRING_FILE, {});
let expiringTokenCounter = Object.keys(expiringTokens).length + 1;
const EXPIRY_HOURS = 24;


for (const key in expiringTokens) {
  if (isExpired(expiringTokens[key])) {
    delete expiringTokens[key];
  }
}
writeJSON(EXPIRING_FILE, expiringTokens);

app.post('/v1/expiring-tokens', (req, res) => {
  const { serviceRequestId, requestType, requestedBy } = req.body;

  if (!serviceRequestId || !requestType || !requestedBy) {
    return res.status(400).json({
      message: "Invalid request payload",
      timestamp: nowUTC()
    });
  }

  const existing = expiringTokens[serviceRequestId];

  if (existing && !isExpired(existing)) {
    return res.status(409).json({
      message: "Token already exist",
      existingTokenNumber: existing.tokenNumber,
      expiresAt: existing.expiresAt
    });
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + EXPIRY_HOURS * 60 * 60 * 1000);
  const tokenNumber = `ETKN-${String(expiringTokenCounter++).padStart(6, '0')}`;

  expiringTokens[serviceRequestId] = {
    tokenNumber,
    serviceRequestId,
    requestType,
    requestedBy,
    status: "OPEN",
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  writeJSON(EXPIRING_FILE, expiringTokens);

  res.status(201).json({
    message: "Token created successfully",
    tokenNumber,
    serviceRequestId,
    status: "OPEN",
    createdAt: createdAt.toISOString(),
    timeoutHours: EXPIRY_HOURS,
    expiresAt: expiresAt.toISOString()
  });
});

app.post('/v1/expiring-tokens/:tokenNumber/close', (req, res) => {
  const tokenEntry = Object.entries(expiringTokens)
    .find(([_, t]) => t.tokenNumber === req.params.tokenNumber);

  if (!tokenEntry) {
    return res.status(404).json({
      message: "Token does not exist",
      tokenNumber: req.params.tokenNumber,
      timestamp: nowUTC()
    });
  }

  const [serviceRequestId, token] = tokenEntry;

  if (isExpired(token)) {
    delete expiringTokens[serviceRequestId];
    writeJSON(EXPIRING_FILE, expiringTokens);
    return res.status(404).json({
      message: "Token does not exist",
      tokenNumber: req.params.tokenNumber,
      timestamp: nowUTC()
    });
  }

  delete expiringTokens[serviceRequestId];
  writeJSON(EXPIRING_FILE, expiringTokens);

  res.status(200).json({
    message: "Token closed and deleted successfully",
    tokenNumber: token.tokenNumber,
    status: "CLOSED",
    closedAt: nowUTC()
  });
});

// SERVER

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
