/**
 * Search Engine — Google search results scraper
 * Collects website URLs from search results for a given keyword
 */

const cheerio = require('cheerio');
const UserAgent = require('user-agents');
const { executeDelay, getSearchDelay } = require('./delayManager');
const captchaHandler = require('./captchaHandler');
const browserFallback = require('./browserFallback');
const emailExtractor = require('./emailExtractor');

// URLs to skip (social media, file types, etc.)
const SKIP_DOMAINS = [
  'youtube.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'linkedin.com', 'pinterest.com',
  'reddit.com', 'tiktok.com', 'wikipedia.org',
  'amazon.com', 'flipkart.com', 'quora.com',
  'maps.google.com', 'play.google.com', 'apps.apple.com',
  'github.com', 'stackoverflow.com', 'medium.com'
];

const SKIP_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.ppt', '.pptx', '.zip', '.rar', '.jpg',
  '.jpeg', '.png', '.gif', '.mp4', '.mp3'
];

/**
 * Check if URL should be skipped
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function shouldSkipUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Skip social media and known non-business sites
    if (SKIP_DOMAINS.some(d => hostname.includes(d))) return true;

    // Skip file downloads
    const path = parsed.pathname.toLowerCase();
    if (SKIP_EXTENSIONS.some(ext => path.endsWith(ext))) return true;

    // Skip Google's own pages
    if (hostname.includes('google.com')) return true;

    return false;
  } catch {
    return true;
  }
}

/**
 * Extract URLs and any snippet emails from a single Google search results page
 * @param {string} html - Google search results HTML
 * @returns {object[]} Array of extracted website result objects containing { url, domain, emails }
 */
function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seenUrls = new Set();

  // Find all links in search results
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    let actualUrl = null;

    if (href.startsWith('http') && !href.includes('google.com') &&
        !href.includes('googleapis.com') && !href.includes('gstatic.com')) {
      if (!shouldSkipUrl(href)) {
        actualUrl = href;
      }
    }

    if (href.startsWith('/url?')) {
      try {
        const params = new URLSearchParams(href.split('?')[1]);
        const q = params.get('q');
        if (q && q.startsWith('http') && !shouldSkipUrl(q)) {
          actualUrl = q;
        }
      } catch {
        // ignore
      }
    }

    if (actualUrl) {
      try {
        const clean = new URL(actualUrl);
        const cleanUrl = clean.origin + clean.pathname.replace(/\/+$/, '');
        
        if (!seenUrls.has(cleanUrl)) {
          seenUrls.add(cleanUrl);

          // Smart snippet text context extraction:
          // Traverse up parent tree to find full container card
          let container = $(element);
          let containerText = '';
          for (let i = 0; i < 6; i++) {
            container = container.parent();
            const txt = container.text() || '';
            if (txt.length > 100) {
              containerText = txt;
              break;
            }
          }

          if (!containerText) {
            containerText = $(element).parent().parent().text() || '';
          }

          // Extract emails from the text of this search result snippet
          const snippetEmails = emailExtractor.extractFromHTML(containerText);

          results.push({
            url: cleanUrl,
            domain: clean.hostname.replace('www.', ''),
            emails: snippetEmails || []
          });
        }
      } catch {
        // ignore
      }
    }
  });

  // --- Global Fallback Scan ---
  // Scan entire search page HTML for any email addresses
  const globalEmails = emailExtractor.extractFromHTML(html) || [];

  for (const email of globalEmails) {
    // See if email is already captured
    let alreadyMatched = false;
    for (const res of results) {
      if (res.emails.includes(email)) {
        alreadyMatched = true;
        break;
      }
    }

    if (!alreadyMatched) {
      // Map it to the best matching domain result on this page
      let bestMatch = results[0]; // fallback to first result
      const localPart = email.split('@')[0].toLowerCase();

      for (const res of results) {
        const cleanDomain = res.domain.toLowerCase();
        const baseDomain = cleanDomain.split('.')[0];
        
        // Smart substring match
        if (cleanDomain.includes(localPart) || 
            localPart.includes(baseDomain) || 
            (baseDomain.length > 3 && localPart.includes(baseDomain.substring(0, 4))) ||
            (localPart.length > 3 && baseDomain.includes(localPart.substring(0, 4)))) {
          bestMatch = res;
          break;
        }
      }

      if (bestMatch) {
        bestMatch.emails.push(email);
      }
    }
  }

  return results;
}

/**
 * Search Google for a keyword and collect website URLs
 * @param {string} keyword - Search keyword
 * @param {object} options - Search options
 * @param {number} options.pages - Number of search pages to process (default: 5)
 * @param {string} options.mode - Scraping mode for delays
 * @param {number} options.delayMin - Custom minimum delay
 * @param {number} options.delayMax - Custom maximum delay
 * @param {function} options.onLog - Callback for logging
 * @param {function} options.onCaptcha - Callback for CAPTCHA detection
 * @param {function} options.shouldStop - Function that returns true if scraping should stop
 * @param {function} options.isPaused - Function that returns true if scraping is paused
 * @param {function} options.isStopped - Function that returns true if scraping is stopped
 * @returns {Promise<object[]>} Array of discovered website results containing emails
 */
async function search(keyword, options = {}) {
  const {
    pages = 5,
    mode = 'balanced',
    delayMin,
    delayMax,
    onLog = () => {},
    onCaptcha = () => {},
     onProgress = () => {},
    shouldStop = () => false,
    isPaused = () => false,
    isStopped = () => false
  } = options;

  const allResults = [];
  const seenDomains = new Set();

  onLog(`🔍 Searching: "${keyword}"`);
  onLog(`🕵️ Search running sequentially (1 sequential worker) with slower human-like delays for safety.`);

  try {
    const browser = await browserFallback.getBrowser();

    for (let page = 0; page < pages; page++) {
      if (shouldStop()) {
        onLog('🛑 Search stopped by user');
        break;
      }

      // Wait while paused
      while (isPaused() && !isStopped()) {
        await new Promise(r => setTimeout(r, 1000));
      }

      if (isStopped()) {
        onLog('🛑 Search stopped by user');
        break;
      }

      const start = page * 10;
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&start=${start}&num=10&hl=en`;

      onLog(`📄 Fetching search page ${page + 1}/${pages}...`);

      let searchPage = null;

      try {
        searchPage = await browser.newPage();

        const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        await searchPage.setUserAgent(userAgent.toString());

        const response = await searchPage.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });

        const statusCode = response ? response.status() : 200;
        const finalUrl = searchPage.url();
        const html = await searchPage.content();

        // Check for CAPTCHA
        let captchaCheck = { detected: false };

        const statusCheck = captchaHandler.detectByStatusCode(statusCode);
        if (statusCheck.detected) captchaCheck = statusCheck;

        if (!captchaCheck.detected) {
          const contentCheck = captchaHandler.detectInContent(html);
          if (contentCheck.detected) captchaCheck = contentCheck;
        }

        if (!captchaCheck.detected) {
          const redirectCheck = captchaHandler.detectByRedirect(searchUrl, finalUrl);
          if (redirectCheck.detected) captchaCheck = redirectCheck;
        }

        if (captchaCheck.detected) {
          onLog(`⚠️ CAPTCHA detected on search page ${page + 1}: ${captchaCheck.pattern}`);
          onCaptcha(captchaCheck);
          
          // Wait while paused for manual verification
          onLog('⏸️ Search paused. Solve challenge in browser and click Resume Scraping.');
          while (isPaused() && !isStopped()) {
            await new Promise(r => setTimeout(r, 1000));
          }
          
          if (isStopped()) {
            onLog('🛑 Search stopped by user');
            break;
          }
          
          // Retry current search page
          onLog(`▶️ Resuming search on page ${page + 1}...`);
          page--;
          continue;
        }

        // Parse results
        const pageResults = parseSearchResults(html);
        onLog(`  Found ${pageResults.length} websites on search page ${page + 1}`);

        onProgress({ current: page + 1, total: pages });

        // Extract and record emails found directly on the search page snippets
        for (const res of pageResults) {
          if (!seenDomains.has(res.domain)) {
            seenDomains.add(res.domain);
            allResults.push(res);
          } else {
            // Merge emails if domain seen already
            const existing = allResults.find(r => r.domain === res.domain);
            if (existing && res.emails.length > 0) {
              existing.emails = [...new Set([...existing.emails, ...res.emails])];
            }
          }
        }

        // Delay between pages (not after last page) - Using slow dedicated search delays
        if (page < pages - 1) {
          const delay = getSearchDelay(mode);
          onLog(`  ⏳ Waiting ${(delay / 1000).toFixed(1)}s before next page...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

      } catch (error) {
        onLog(`❌ Error on search page ${page + 1}: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        onProgress({ current: page + 1, total: pages });
      } finally {
        if (searchPage) {
          try {
            await searchPage.close();
          } catch {
            // ignore
          }
        }
      }
    }
  } catch (err) {
    onLog(`❌ Browser search failed to initialize: ${err.message}`);
  }

  onLog(`✅ Search complete. Found ${allResults.length} unique websites in search results.`);
  return allResults;
}

module.exports = { search, parseSearchResults, shouldSkipUrl };
