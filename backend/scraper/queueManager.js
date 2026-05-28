/**
 * Queue Manager — Smart hybrid queue system
 * Manages parallel workers, batch processing, cooldowns, and scraping workflow
 */

const axios = require('axios');
const cheerio = require('cheerio');
const UserAgent = require('user-agents');
const PQueue = require('p-queue').default || require('p-queue');
const emailExtractor = require('./emailExtractor');
const browserFallback = require('./browserFallback');
const captchaHandler = require('./captchaHandler');
const delayManager = require('./delayManager');
const searchEngine = require('./searchEngine');

class QueueManager {
  /**
   * @param {object} io - Socket.IO server instance
   */
  constructor(io) {
    this.io = io;
    this.queue = null;
    this.results = [];
    this.seenEmails = new Set();
    this.logBuffer = [];
    this.logBufferSize = parseInt(process.env.LOG_BUFFER_SIZE) || 200;
    this.stats = {
      totalEmails: 0,
      websitesProcessed: 0,
      queueRemaining: 0,
      failedAttempts: 0,
      startTime: null,
      processingSpeed: 0,
      status: 'idle' // idle, searching, scraping, paused, stopped, cooldown, completed
    };
    this.isPaused = false;
    this.isStopped = false;
    this.processedCount = 0;
    this.cooldownThreshold = parseInt(process.env.COOLDOWN_THRESHOLD) || 20;
    this.config = {};
  }

  /**
   * Emit log message to frontend
   * @param {string} message - Log message
   * @param {string} type - Log type (info, success, warning, error)
   */
  log(message, type = 'info') {
    const logEntry = {
      message,
      type,
      timestamp: new Date().toISOString()
    };
    this.logBuffer.push(logEntry);
    if (this.logBuffer.length > this.logBufferSize) {
      this.logBuffer.shift();
    }
    this.io.emit('log', logEntry);
  }

  /**
   * Return recent logs for new clients
   * @returns {object[]}
   */
  getLogBuffer() {
    return this.logBuffer.slice();
  }

  /**
   * Emit updated stats to frontend
   */
  emitStats() {
    if (this.stats.startTime) {
      const elapsed = (Date.now() - this.stats.startTime) / 1000;
      this.stats.processingSpeed = elapsed > 0
        ? (this.stats.websitesProcessed / elapsed * 60).toFixed(1)
        : 0;
      this.stats.timeElapsed = elapsed;
    }
    this.io.emit('stats', { ...this.stats });
  }

  /**
   * Emit a new email result to frontend
   * @param {object} result - Email result object
   */
  emitResult(result) {
    this.io.emit('result', result);
  }

  /**
   * Start the scraping process
   * @param {object} config - Scraping configuration
   * @param {string} config.keyword - Search keyword
   * @param {number} config.pages - Number of search pages
   * @param {number} config.workers - Number of parallel workers
   * @param {number} config.delayMin - Minimum delay in seconds
   * @param {number} config.delayMax - Maximum delay in seconds
   * @param {string} config.mode - Scraping mode (safe/balanced/fast)
   * @param {boolean} config.filterFreeProviders - Filter free email providers
   */
  async start(config) {
    // Reset state
    this.results = [];
    this.seenEmails = new Set();
    this.logBuffer = [];
    this.isPaused = false;
    this.isStopped = false;
    this.processedCount = 0;
    this.config = config;

    // Apply mode presets if no custom values
    const modeSettings = delayManager.getModeSettings(config.mode);
    if (!config.workers) config.workers = modeSettings.recommendedWorkers;

    this.stats = {
      totalEmails: 0,
      websitesProcessed: 0,
      queueRemaining: 0,
      failedAttempts: 0,
      startTime: Date.now(),
      processingSpeed: 0,
      status: 'searching',
      searchPagesProcessed: 0,
      searchPagesTotal: parseInt(config.pages) || 0
    };
    this.emitStats();

    this.log(`🚀 Starting scraping session`, 'success');
    this.log(`📋 Keyword: "${config.keyword}"`, 'info');
    this.log(`⚙️ Mode: ${config.mode} | Workers: ${config.workers} | Pages: ${config.pages}`, 'info');

    this.log('🧭 Launching browser window for scraping...', 'info');
    await browserFallback.warmupBrowser();

    try {
      // Phase 1: Search Google results (and extract snippet emails)
      const searchData = await searchEngine.search(config.keyword, {
        pages: config.pages,
        mode: config.mode,
        delayMin: config.delayMin,
        delayMax: config.delayMax,
        onLog: (msg) => this.log(msg),
        onCaptcha: (detection) => this.handleCaptcha(detection),
        onProgress: (progress) => {
          this.stats.searchPagesProcessed = progress.current;
          this.stats.searchPagesTotal = progress.total;
          this.emitStats();
        },
        emailOnly: config.emailOnly === true,
        shouldStop: () => this.isStopped,
        isPaused: () => this.isPaused,
        isStopped: () => this.isStopped
      });

      const searchResults = searchData.results || [];
      const pageEmails = searchData.pageEmails || [];
      const emailOnlyMode = config.emailOnly === true;

      if (this.isStopped) {
        this.stats.status = 'stopped';
        this.emitStats();
        return;
      }

      if (searchResults.length === 0 && pageEmails.length === 0) {
        this.log('⚠️ No emails found on search pages. Try a different keyword.', 'warning');
        this.stats.status = 'completed';
        this.emitStats();
        return;
      }

      // Phase 2: Search processing (No longer extracting snippet emails)
      this.stats.status = 'scraping';
      this.emitStats();
      this.log(`\n🔎 Search complete. Starting deep website scans to find verified emails...`, 'info');
      
      if (emailOnlyMode) {
        this.log('⚠️ Email-only mode is active, but we now require website visits for source verification. Proceeding with website scans.', 'info');
      }

      let processedCount = 0;
      this.stats.websitesProcessed = 0;
      this.stats.queueRemaining = searchResults.length;
      this.emitStats();

      if (this.isStopped) {
        return;
      }

      // Phase 3: Visit websites and extract additional emails
      const totalSites = searchResults.length;
      this.stats.status = 'scraping';
      this.stats.websitesProcessed = 0;
      this.stats.queueRemaining = totalSites;
      this.emitStats();

      this.queue = new PQueue({ concurrency: config.workers });

      searchResults.forEach((res, idx) => {
        this.queue.add(() => this.processWebsite(res.url, idx + 1, totalSites));
      });

      if (this.isPaused) {
        this.queue.pause();
      }

      await this.queue.onIdle();

      if (!this.isStopped) {
        this.stats.status = 'completed';
        this.log(`\n✅ Scraping complete!`, 'success');
        this.log(`📊 Total emails found: ${this.stats.totalEmails}`, 'success');
        this.log(`🌐 Websites scanned: ${totalSites}`, 'info');
        this.emitStats();
      }

    } catch (error) {
      this.log(`❌ Fatal error: ${error.message}`, 'error');
      this.stats.status = 'stopped';
      this.emitStats();
    }
  }

  /**
   * Process a single website — fast scan first, browser fallback if needed
   * @param {string} url - Website URL
   * @param {number} index - Current index
   * @param {number} total - Total URLs
   */
  async processWebsite(url, index, total) {
    const hostname = new URL(url).hostname;
    const workerNum = (index % this.config.workers) + 1;

    this.log(`\n👷 Worker ${workerNum} → [${index}/${total}] ${hostname}`);

    const maxRetries = 2; 
    let success = false;
    let attempt = 0;

    while (attempt <= maxRetries && !success) {
      if (this.isStopped) return;
      
      if (attempt > 0) {
        this.log(`  🔄 Retry ${attempt}/${maxRetries} for ${hostname}...`, 'warning');
        await new Promise(r => setTimeout(r, 3000));
      }

      try {
        // --- Phase A: Fast HTML scan (axios + cheerio) ---
        let rawExtracted = []; // Array of { email, source }
        let usedBrowser = false;

        try {
          const userAgent = new UserAgent({ deviceCategory: 'desktop' });
          const response = await axios.get(url, {
            headers: {
              'User-Agent': userAgent.toString(),
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 30000,
            maxRedirects: 3,
            validateStatus: (status) => status < 500
          });

          // Check for CAPTCHA
          const captchaCheck = captchaHandler.fullCheck(response, url);
          if (captchaCheck.detected) {
            this.handleCaptcha(captchaCheck);
            this.stats.failedAttempts++;
            this.stats.queueRemaining--;
            this.emitStats();
            return;
          }

          const html = response.data;
          const mainEmails = emailExtractor.extractFromHTML(html);
          mainEmails.forEach(e => rawExtracted.push({ email: e, source: url }));

          // Always check contact pages in deep mode
          const contactPages = emailExtractor.findContactPages(html, url);
          for (const contactUrl of contactPages.slice(0, 3)) {
            try {
              await delayManager.sleep(0.5, 1.5);
              const contactResponse = await axios.get(contactUrl, {
                headers: { 'User-Agent': userAgent.toString() },
                timeout: 15000,
                maxRedirects: 2,
                validateStatus: (status) => status < 500
              });
              const contactEmails = emailExtractor.extractFromHTML(contactResponse.data);
              contactEmails.forEach(e => rawExtracted.push({ email: e, source: contactUrl }));
            } catch {
              // Contact page failed, skip
            }
          }

          this.log(`  ⚡ Fast scan: ${rawExtracted.length} emails found`);

        } catch (error) {
          // If this was a timeout or network error, we might want to retry rather than going to browser
          // But for now, let's treat it as "try browser fallback"
          this.log(`  ⚠️ Fast scan failed: ${error.message}`, 'warning');
        }

        // --- Phase B: Browser fallback if no emails found ---
        if (rawExtracted.length === 0) {
          this.log(`  🌐 No emails in fast scan, trying browser fallback...`);
          usedBrowser = true;

          const browserResult = await browserFallback.scrapeWithBrowser(url, {
            mode: this.config.mode,
            onLog: (msg) => this.log(msg)
          });

          if (browserResult.captcha) {
            this.handleCaptcha({
              detected: true,
              pattern: browserResult.error || 'Browser CAPTCHA',
              type: 'browser'
            });
            this.stats.failedAttempts++;
            this.stats.queueRemaining--;
            this.emitStats();
            return;
          }

          if (browserResult.error && attempt < maxRetries) {
             // If browser also errored, throw to trigger retry loop
             throw new Error(browserResult.error);
          }

          rawExtracted = browserResult.emails || [];
          this.log(`  🌐 Browser fallback: ${rawExtracted.length} emails found`);
        }

        // --- Phase C: Filter and deduplicate ---
        let newCount = 0;
        const emailStrings = rawExtracted.map(item => item.email);
        const filteredResults = emailExtractor.filterEmails(emailStrings, {
          filterFreeProviders: this.config.filterFreeProviders
        });

        for (const emailObj of filteredResults) {
          if (!this.seenEmails.has(emailObj.email)) {
            this.seenEmails.add(emailObj.email);
            const original = rawExtracted.find(item => item.email === emailObj.email);
            const sourceUrl = original ? original.source : url;

            const result = {
              id: Date.now() + Math.random().toString(36).substr(2, 5),
              email: emailObj.email,
              company: hostname.replace('www.', ''),
              source: sourceUrl,
              keyword: this.config.keyword,
              status: emailObj.isBusiness ? 'Business' : 'General',
              domain: emailObj.domain,
              timestamp: new Date().toISOString()
            };
            this.results.push(result);
            this.emitResult(result);
            newCount++;
          }
        }

        if (newCount > 0) {
          this.log(`  ✅ ${newCount} new unique email(s) saved`, 'success');
          this.stats.totalEmails += newCount;
        } else if (rawExtracted.length > 0) {
          this.log(`  ℹ️ ${rawExtracted.length} email(s) found but all duplicates or invalid`, 'info');
        } else {
          this.log(`  ○ No business emails found`, 'info');
        }

        this.stats.websitesProcessed++;
        this.stats.queueRemaining--;
        this.emitStats();
        success = true;

        // --- Phase D: Cooldown check ---
        this.processedCount++;
        if (this.processedCount > 0 && this.processedCount % this.cooldownThreshold === 0) {
          const cooldownMs = delayManager.getCooldownDuration(20, 30);
          this.stats.status = 'cooldown';
          this.emitStats();
          this.log(`\n❄️ Cooldown for ${(cooldownMs / 1000).toFixed(0)}s (processed ${this.processedCount} sites)...`, 'warning');
          await new Promise(r => setTimeout(r, cooldownMs));
          this.stats.status = 'scraping';
          this.emitStats();
        } else {
          await delayManager.executeDelay({
            delayMin: this.config.delayMin,
            delayMax: this.config.delayMax,
            mode: this.config.mode
          });
        }

      } catch (error) {
        attempt++;
        if (attempt > maxRetries) {
          this.log(`  ❌ Failed after ${maxRetries + 1} attempts: ${error.message}`, 'error');
          this.stats.failedAttempts++;
          this.stats.queueRemaining--;
          this.emitStats();
        }
      }
    }
  }

  /**
   * Handle CAPTCHA detection
   * @param {object} detection - CAPTCHA detection result
   */
  handleCaptcha(detection) {
    this.log(`\n⚠️ CAPTCHA DETECTED: ${detection.pattern}`, 'error');

    this.isPaused = true;
    if (this.queue) this.queue.pause();

    const isRateLimit = detection && typeof detection.pattern === 'string' && detection.pattern.includes('429');

    if (isRateLimit && this.config) {
      const slowWorkers = parseInt(process.env.RATE_LIMIT_WORKERS) || 1;
      const slowDelayMin = parseInt(process.env.RATE_LIMIT_DELAY_MIN) || 10;
      const slowDelayMax = parseInt(process.env.RATE_LIMIT_DELAY_MAX) || 20;

      this.config.mode = 'safe';
      this.config.workers = Math.min(this.config.workers || slowWorkers, slowWorkers);
      this.config.delayMin = Math.max(this.config.delayMin || 0, slowDelayMin);
      this.config.delayMax = Math.max(this.config.delayMax || 0, slowDelayMax);

      if (this.queue) this.queue.concurrency = this.config.workers;
      this.log('Rate limit detected. Switching to safe mode with slower delays.', 'warning');
    }

    const cooldownMin = isRateLimit
      ? parseInt(process.env.RATE_LIMIT_COOLDOWN_MIN) || 300
      : parseInt(process.env.CAPTCHA_COOLDOWN_MIN) || 60;
    const cooldownMax = isRateLimit
      ? parseInt(process.env.RATE_LIMIT_COOLDOWN_MAX) || 600
      : parseInt(process.env.CAPTCHA_COOLDOWN_MAX) || 120;

    const cooldownMs = delayManager.getCooldownDuration(cooldownMin, cooldownMax);

    this.stats.status = 'cooldown';
    this.emitStats();
    this.log(`Cooling down for ${(cooldownMs / 1000).toFixed(0)}s due to CAPTCHA...`, 'warning');

    setTimeout(() => {
      if (this.isStopped) return;
      this.stats.status = 'paused';
      this.emitStats();
      this.log('⏸️ Scraping paused. Complete verification and click Resume.', 'warning');
    }, cooldownMs);

    // Send alert to frontend
    this.io.emit('captcha', captchaHandler.generateAlert(detection));
  }

  /**
   * Pause the queue
   */
  pause() {
    this.isPaused = true;
    this.stats.status = 'paused';
    if (this.queue) this.queue.pause();
    this.log('⏸️ Scraping paused', 'warning');
    this.emitStats();
  }

  /**
   * Resume the queue
   */
  resume() {
    this.isPaused = false;
    this.stats.status = 'scraping';
    if (this.queue) this.queue.start();
    this.log('▶️ Scraping resumed', 'success');
    this.emitStats();
  }

  /**
   * Stop the queue and cleanup
   */
  async stop() {
    this.isStopped = true;
    this.isPaused = false;
    this.stats.status = 'stopped';

    if (this.queue) {
      this.queue.pause();
      this.queue.clear();
    }

    this.log('🛑 Scraping stopped', 'warning');
    this.emitStats();

    // Close browser if open
    await browserFallback.closeBrowser();
  }

  /**
   * Clear all results
   */
  clearResults() {
    this.results = [];
    this.seenEmails = new Set();
    this.stats.totalEmails = 0;
    this.stats.websitesProcessed = 0;
    this.stats.queueRemaining = 0;
    this.stats.failedAttempts = 0;
    this.processedCount = 0;
    this.io.emit('clear');
    this.log('🗑️ Results cleared', 'info');
    this.emitStats();
  }

  /**
   * Get current results
   * @returns {object[]}
   */
  getResults() {
    return this.results;
  }

  /**
   * Get current stats
   * @returns {object}
   */
  getStats() {
    this.emitStats();
    return this.stats;
  }

  /**
   * Delete a single result by ID
   * @param {string} id - Result ID
   */
  deleteResult(id) {
    const idx = this.results.findIndex(r => r.id === id);
    if (idx !== -1) {
      const removed = this.results.splice(idx, 1)[0];
      this.seenEmails.delete(removed.email);
      this.stats.totalEmails = Math.max(0, this.stats.totalEmails - 1);
      this.emitStats();
    }
  }

  /**
   * Bulk delete results by IDs
   * @param {string[]} ids - Array of result IDs
   */
  bulkDelete(ids) {
    const idSet = new Set(ids);
    this.results = this.results.filter(r => {
      if (idSet.has(r.id)) {
        this.seenEmails.delete(r.email);
        return false;
      }
      return true;
    });
    this.stats.totalEmails = this.results.length;
    this.emitStats();
  }
}

module.exports = QueueManager;
