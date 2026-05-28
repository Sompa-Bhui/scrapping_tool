/**
 * Browser Fallback — Puppeteer-based scraping for JS-rendered pages
 * Used when fast HTML scan finds no emails
 */

const puppeteer = require('puppeteer');
const UserAgent = require('user-agents');
const path = require('path');
const emailExtractor = require('./emailExtractor');
const captchaHandler = require('./captchaHandler');
const { simulateReading, sleep } = require('./delayManager');

let browserInstance = null;

/**
 * Get or create a shared browser instance
 * @returns {Promise<Browser>}
 */
async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  const headless = process.env.BROWSER_HEADLESS === 'true';

  browserInstance = await puppeteer.launch({
    headless,
    userDataDir: path.join(__dirname, '../../chrome-session'),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
      '--disable-web-security',
      '--start-minimized'
    ],
    defaultViewport: {
      width: 1920,
      height: 1080
    },
    timeout: parseInt(process.env.BROWSER_TIMEOUT) || 30000
  });

  return browserInstance;
}

/**
 * Close the shared browser instance
 */
async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (e) {
      // Browser already closed
    }
    browserInstance = null;
  }
}

/**
 * Warm up the browser instance so a window opens early
 * @returns {Promise<Browser>}
 */
async function warmupBrowser() {
  return getBrowser();
}

/**
 * Simulate human-like scrolling and mouse movement behavior
 * @param {Page} page - Puppeteer page
 */
async function simulateScroll(page) {
  try {
    // Random mouse movement to mimic realistic mouse patterns
    const width = page.viewport() ? page.viewport().width : 1280;
    const height = page.viewport() ? page.viewport().height : 800;
    const startX = Math.floor(Math.random() * (width - 100)) + 50;
    const startY = Math.floor(Math.random() * (height - 100)) + 50;
    const steps = 15;
    await page.mouse.move(startX, startY, { steps });

    await page.evaluate(async () => {
      const totalHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      let currentScroll = 0;

      while (currentScroll < totalHeight * 0.7) {
        const scrollAmount = Math.floor(Math.random() * 300) + 100;
        window.scrollBy(0, scrollAmount);
        currentScroll += scrollAmount;
        await new Promise(r => setTimeout(r, Math.random() * 500 + 200));
      }
    });
  } catch {
    // Scroll failed, continue
  }
}

/**
 * Scrape a website using Puppeteer with human-like behavior
 * @param {string} url - URL to scrape
 * @param {object} options
 * @param {string} options.mode - Scraping mode
 * @param {function} options.onLog - Log callback
 * @returns {Promise<object>} Scraping result with emails and metadata
 */
async function scrapeWithBrowser(url, options = {}) {
  const { mode = 'balanced', onLog = () => {} } = options;
  const pageTimeout = parseInt(process.env.PAGE_TIMEOUT) || 60000;

  let page = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Random user agent
    const userAgent = new UserAgent({ deviceCategory: 'desktop' });
    await page.setUserAgent(userAgent.toString());

    // Set random viewport
    const widths = [1366, 1440, 1536, 1920];
    const heights = [768, 900, 864, 1080];
    const idx = Math.floor(Math.random() * widths.length);
    await page.setViewport({ width: widths[idx], height: heights[idx] });

    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });

    onLog(`  🌐 Browser loading: ${new URL(url).hostname}`);

    // Navigate to the page
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: pageTimeout
    });

    // Check for CAPTCHA in response
    const statusCode = response ? response.status() : 200;
    const statusCheck = captchaHandler.detectByStatusCode(statusCode);
    if (statusCheck.detected) {
      return { emails: [], captcha: true, error: statusCheck.pattern };
    }

    // Wait a moment for JS to render
    await sleep(1, 2);

    // Get page content and check for CAPTCHA
    let html = await page.content();
    const contentCheck = captchaHandler.detectInContent(html);
    if (contentCheck.detected) {
      return { emails: [], captcha: true, error: contentCheck.pattern };
    }

    // Simulate human-like scrolling
    await simulateScroll(page);

    // Re-get content after scroll (some pages lazy-load footer)
    html = await page.content();

    // Extract emails from main page
    const mainPageEmails = emailExtractor.extractFromHTML(html);
    let allExtracted = mainPageEmails.map(email => ({ email, source: url }));
    onLog(`  📧 Found ${mainPageEmails.length} emails on main page`);

    // Try to find and visit contact/about pages
    const contactPages = emailExtractor.findContactPages(html, url);
    if (contactPages.length > 0) {
      // Visit at most 3 contact pages
      const pagesToVisit = contactPages.slice(0, 3);

      for (const contactUrl of pagesToVisit) {
        try {
          // Random navigation delay
          await simulateReading(mode);

          onLog(`  📄 Checking: ${new URL(contactUrl).pathname}`);

          await page.goto(contactUrl, {
            waitUntil: 'networkidle2',
            timeout: pageTimeout
          });

          await sleep(1, 2);
          await simulateScroll(page);

          const contactHtml = await page.content();
          const contactEmails = emailExtractor.extractFromHTML(contactHtml);
          
          contactEmails.forEach(email => {
            allExtracted.push({ email, source: contactUrl });
          });

          onLog(`  📧 Found ${contactEmails.length} emails on contact page`);
        } catch (error) {
          onLog(`  ⚠️ Could not load contact page: ${error.message}`);
        }
      }
    }

    return {
      emails: allExtracted, // Now an array of { email, source }
      captcha: false,
      pagesScanned: 1 + Math.min(contactPages.length, 3)
    };

  } catch (error) {
    onLog(`  ❌ Browser error: ${error.message}`);
    return { emails: [], captcha: false, error: error.message };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Page already closed
      }
    }
  }
}








module.exports = {
  scrapeWithBrowser,
  closeBrowser,
  getBrowser,
  warmupBrowser
};
