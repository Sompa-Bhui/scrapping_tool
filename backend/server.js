/**
 * Email Scraping Tool — Express.js Server
 * Main backend entry point with REST API and Socket.IO
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const QueueManager = require('./scraper/queueManager');
const { exportCSV } = require('./export/csvExport');
const { exportExcel } = require('./export/excelExport');

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, '..', 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Initialize queue manager
let queueManager = new QueueManager(io);

// ────────────────────────────────────────────────────────────
// REST API Endpoints
// ────────────────────────────────────────────────────────────

/**
 * POST /api/scrape/start
 * Start a new scraping session
 */
app.post('/api/scrape/start', async (req, res) => {
  const defaultWorkers = parseInt(process.env.DEFAULT_WORKERS) || 2;
  const defaultDelayMin = parseInt(process.env.DEFAULT_DELAY_MIN) || 8;
  const defaultDelayMax = parseInt(process.env.DEFAULT_DELAY_MAX) || 15;
  const defaultPages = parseInt(process.env.DEFAULT_PAGES) || 2;
  const defaultMode = process.env.DEFAULT_MODE || 'safe';

  const {
    keyword,
    pages = defaultPages,
    workers = defaultWorkers,
    delayMin = defaultDelayMin,
    delayMax = defaultDelayMax,
    mode = defaultMode,
    filterFreeProviders = false
  } = req.body;

  if (!keyword || keyword.trim().length === 0) {
    return res.status(400).json({ error: 'Keyword is required' });
  }

  // Create fresh queue manager for new session
  queueManager = new QueueManager(io);

  // Start scraping in background (non-blocking)
  queueManager.start({
    keyword: keyword.trim(),
    pages: parseInt(pages),
    workers: parseInt(workers),
    delayMin: parseFloat(delayMin),
    delayMax: parseFloat(delayMax),
    mode,
    filterFreeProviders
  }).catch(err => {
    console.error('Scraping error:', err);
    io.emit('log', { message: `❌ Error: ${err.message}`, type: 'error', timestamp: new Date().toISOString() });
  });

  res.json({ success: true, message: 'Scraping started' });
});

/**
 * POST /api/scrape/pause
 * Pause the current scraping session
 */
app.post('/api/scrape/pause', (req, res) => {
  queueManager.pause();
  res.json({ success: true, message: 'Scraping paused' });
});

/**
 * POST /api/scrape/resume
 * Resume the paused scraping session
 */
app.post('/api/scrape/resume', (req, res) => {
  queueManager.resume();
  res.json({ success: true, message: 'Scraping resumed' });
});

/**
 * POST /api/scrape/stop
 * Stop the current scraping session
 */
app.post('/api/scrape/stop', async (req, res) => {
  await queueManager.stop();
  res.json({ success: true, message: 'Scraping stopped' });
});

/**
 * POST /api/scrape/clear
 * Clear all results
 */
app.post('/api/scrape/clear', (req, res) => {
  queueManager.clearResults();
  res.json({ success: true, message: 'Results cleared' });
});

/**
 * GET /api/scrape/status
 * Get current scraping status and stats
 */
app.get('/api/scrape/status', (req, res) => {
  res.json({
    stats: queueManager.getStats(),
    resultCount: queueManager.getResults().length
  });
});

/**
 * GET /api/results
 * Get all current results
 */
app.get('/api/results', (req, res) => {
  res.json({ results: queueManager.getResults() });
});

/**
 * DELETE /api/results/:id
 * Delete a single result
 */
app.delete('/api/results/:id', (req, res) => {
  queueManager.deleteResult(req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/results/bulk-delete
 * Bulk delete results
 */
app.post('/api/results/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  queueManager.bulkDelete(ids);
  res.json({ success: true, deleted: ids.length });
});

/**
 * GET /api/export/csv
 * Export results as CSV
 */
app.get('/api/export/csv', async (req, res) => {
  const results = queueManager.getResults();
  if (results.length === 0) {
    return res.status(400).json({ error: 'No results to export' });
  }

  try {
    const mode = req.query.mode || 'full';
    const { filepath, filename } = await exportCSV(results, mode);
    res.download(filepath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Export failed: ' + error.message });
  }
});

/**
 * GET /api/export/xlsx
 * Export results as XLSX
 */
app.get('/api/export/xlsx', async (req, res) => {
  const results = queueManager.getResults();
  if (results.length === 0) {
    return res.status(400).json({ error: 'No results to export' });
  }

  try {
    const mode = req.query.mode || 'full';
    const { filepath, filename } = exportExcel(results, mode);
    res.download(filepath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Export failed: ' + error.message });
  }
});

// ────────────────────────────────────────────────────────────
// Socket.IO Connections
// ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send current state to newly connected client
  socket.emit('stats', queueManager.getStats());
  socket.emit('log_buffer', queueManager.getLogBuffer());
  const results = queueManager.getResults();
  if (results.length > 0) {
    socket.emit('existing_results', results);
  }

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ────────────────────────────────────────────────────────────
// Catch-all route — serve frontend
// ────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ────────────────────────────────────────────────────────────
// Start Server
// ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   📧 Email Scraping Tool                     ║`);
  console.log(`║   🌐 http://localhost:${PORT}                   ║`);
  console.log(`║   🚀 Server is running...                    ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await queueManager.stop();
  const browserFallback = require('./scraper/browserFallback');
  await browserFallback.closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await queueManager.stop();
  const browserFallback = require('./scraper/browserFallback');
  await browserFallback.closeBrowser();
  process.exit(0);
});
