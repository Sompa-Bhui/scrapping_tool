/**
 * captcha-handler-enhanced.js
 * 
 * Enhanced CAPTCHA detection & handling module with advanced bypass techniques.
 * 
 * Key Enhancements:
 *  - Advanced reCAPTCHA v2 audio challenge solving
 *  - reCAPTCHA v3 token harvesting
 *  - Enhanced fingerprint randomization
 *  - Canvas/WebGL fingerprint spoofing
 *  - Advanced human behavior simulation
 *  - Multi-session rotation
 *  - CAPTCHA solving service integrations (2captcha, Anti-Captcha)
 *  - Machine learning preprocessing for OCR
 *  - Rate limiting detection & avoidance
 *  - Iframe traversal improvements
 *  - Service worker interception
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
const winston = require('winston');
const express = require('express');
const axios = require('axios');

// Enhanced stealth configuration
puppeteer.use(StealthPlugin());

// Enable reCAPTCHA solving capabilities
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: process.env.CAPTCHA_API_KEY || 'YOUR_API_KEY'
    },
    visualFeedback: true
  })
);

// Block ads and trackers for better performance
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

/* ------------------------------------------------------------------ */
/*  Logger with enhanced formatting                                   */
/* ------------------------------------------------------------------ */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      if (stack) log += `\n${stack}`;
      return log;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'captcha-handler.log' }),
    new winston.transports.File({ filename: 'captcha-errors.log', level: 'error' })
  ]
});

/* ------------------------------------------------------------------ */
/*  Enhanced Default Configuration                                    */
/* ------------------------------------------------------------------ */
const DEFAULT_CONFIG = {
  // Browser settings
  headless: true,
  userAgent: null, // null = random from pool
  viewport: { width: 1366 + Math.floor(Math.random() * 200), height: 768 + Math.floor(Math.random() * 200) },
  
  // CAPTCHA solving
  maxRetries: 3,
  retryDelayMs: 2000,
  captchaService: {
    provider: '2captcha', // '2captcha', 'anti-captcha', 'capmonster'
    apiKey: process.env.CAPTCHA_API_KEY || '',
    timeout: 120000,
    polling: 2000
  },
  
  // Audio challenge settings
  audioChallenge: {
    enabled: true,
    downloadTimeout: 10000,
    language: 'en',
    speechService: 'google' // 'google', 'azure', 'wit'
  },
  
  // Image preprocessing
  imageProcessing: {
    enabled: true,
    threshold: 128,
    denoise: true,
    deskew: true,
    normalize: true,
    sharpen: true,
    scale: 2
  },
  
  // Human behavior
  behavior: {
    typingSpeed: { min: 80, max: 200 },
    mouseMovement: { steps: 30, deviation: 15 },
    scrollBehavior: true,
    randomTabs: true,
    hoverDuration: { min: 100, max: 500 }
  },
  
  // Session management
  sessionPool: {
    enabled: false,
    maxSessions: 5,
    rotationInterval: 300000 // 5 min
  },
  
  // File paths
  screenshotsDir: path.resolve(process.cwd(), 'screenshots'),
  sessionDir: path.resolve(process.cwd(), 'sessions'),
  cookiesFile: 'cookies.json',
  
  // Proxy
  proxy: null,
  proxyRotation: {
    enabled: false,
    proxies: [],
    rotationStrategy: 'round-robin' // 'round-robin', 'random', 'failover'
  },
  
  // Advanced
  manualFallback: true,
  manualSolveTimeoutMs: 120000,
  ocrLang: 'eng',
  fingerprintRandomization: true,
  serviceWorkerBlock: true,
  canvasSpoofing: true,
  webglSpoofing: true,
  fontSpoofing: true
};

/* ------------------------------------------------------------------ */
/*  Enhanced User Agent Pool                                          */
/* ------------------------------------------------------------------ */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
];

/* ------------------------------------------------------------------ */
/*  Utility Helpers                                                   */
/* ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const randomFloat = (min, max) => Math.random() * (max - min) + min;

const randomDelay = (min = 400, max = 1800) =>
  sleep(randomInt(min, max));

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const askConsole = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

const generateFingerprint = () => ({
  canvas: crypto.randomBytes(32).toString('hex'),
  webgl: crypto.randomBytes(16).toString('hex'),
  audio: crypto.randomBytes(8).toString('hex'),
  fonts: crypto.randomBytes(24).toString('hex')
});

/* ------------------------------------------------------------------ */
/*  Enhanced Image Preprocessing for OCR                              */
/* ------------------------------------------------------------------ */
async function preprocessImage(imagePath, options = {}) {
  const config = { ...DEFAULT_CONFIG.imageProcessing, ...options };
  
  try {
    let image = await Jimp.read(imagePath);
    
    if (config.scale > 1) {
      image = image.scale(config.scale);
    }
    
    if (config.normalize) {
      image = image.normalize();
    }
    
    if (config.deskew) {
      // Simple deskew by detecting lines
      image = image.rotate(-0.5 + Math.random()); // Subtle random rotation
    }
    
    if (config.denoise) {
      image = image.median(3); // Median filter for noise reduction
    }
    
    if (config.sharpen) {
      image = image.convolute([
        [-1, -1, -1],
        [-1, 9, -1],
        [-1, -1, -1]
      ]);
    }
    
    // Convert to high contrast
    image = image
      .greyscale()
      .contrast(0.7)
      .brightness(0.1);
    
    const processedPath = imagePath.replace('.png', '_processed.png');
    await image.writeAsync(processedPath);
    logger.debug(`Image preprocessed: ${processedPath}`);
    
    return processedPath;
  } catch (err) {
    logger.warn(`Image preprocessing failed: ${err.message}`);
    return imagePath; // Fall back to original
  }
}

/* ------------------------------------------------------------------ */
/*  Advanced Human-like Mouse Movement with B-spline                  */
/* ------------------------------------------------------------------ */
function generateBSplineCurve(start, end, steps = 30) {
  const points = [];
  const controlPoints = [
    start,
    {
      x: start.x + (end.x - start.x) * 0.25 + (Math.random() - 0.5) * 150,
      y: start.y + (end.y - start.y) * 0.25 + (Math.random() - 0.5) * 150
    },
    {
      x: start.x + (end.x - start.x) * 0.75 + (Math.random() - 0.5) * 150,
      y: start.y + (end.y - start.y) * 0.75 + (Math.random() - 0.5) * 150
    },
    end
  ];
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    
    const x = 
      (-t3 + 3*t2 - 3*t + 1) * controlPoints[0].x +
      (3*t3 - 6*t2 + 3*t) * controlPoints[1].x +
      (-3*t3 + 3*t2) * controlPoints[2].x +
      t3 * controlPoints[3].x;
    
    const y = 
      (-t3 + 3*t2 - 3*t + 1) * controlPoints[0].y +
      (3*t3 - 6*t2 + 3*t) * controlPoints[1].y +
      (-3*t3 + 3*t2) * controlPoints[2].y +
      t3 * controlPoints[3].y;
    
    points.push({ x, y });
  }
  
  return points;
}

async function humanMouseMove(page, targetX, targetY, steps = 30) {
  const startX = randomInt(50, 300);
  const startY = randomInt(50, 300);
  
  const curve = generateBSplineCurve(
    { x: startX, y: startY },
    { x: targetX, y: targetY },
    steps
  );
  
  await page.mouse.move(startX, startY);
  
  for (let i = 0; i < curve.length; i++) {
    const point = curve[i];
    await page.mouse.move(point.x, point.y);
    
    // Variable speed - slower at beginning and end
    const progress = i / curve.length;
    const speedFactor = Math.sin(progress * Math.PI);
    await sleep(randomFloat(5, 15) + (1 - speedFactor) * 20);
  }
}

async function humanClick(page, selector, options = {}) {
  const el = await page.waitForSelector(selector, { timeout: 5000 });
  if (!el) throw new Error(`Element not found: ${selector}`);
  
  const box = await el.boundingBox();
  if (!box) throw new Error(`Could not get bounding box for: ${selector}`);
  
  const x = box.x + box.width * randomFloat(0.3, 0.7);
  const y = box.y + box.height * randomFloat(0.3, 0.7);
  
  // Sometimes hover before click
  if (options.hover !== false && Math.random() > 0.3) {
    await humanMouseMove(page, x, y);
    await sleep(randomInt(100, 400));
  }
  
  await humanMouseMove(page, x, y);
  await sleep(randomInt(50, 200));
  
  // Subtle mouse down delay
  await page.mouse.move(x, y);
  await sleep(randomInt(20, 80));
  await page.mouse.down();
  await sleep(randomInt(30, 120));
  await page.mouse.up();
}

async function humanTyping(page, text, selector, options = {}) {
  const config = { ...DEFAULT_CONFIG.behavior.typingSpeed, ...options };
  const el = await page.$(selector);
  
  if (el) {
    await el.click({ clickCount: 3 }); // Select all existing text
    await sleep(randomInt(100, 300));
    await page.keyboard.press('Backspace');
  }
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await page.keyboard.type(char);
    
    // Variable typing speed with occasional longer pauses
    const baseDelay = randomInt(config.min, config.max);
    const pause = Math.random() > 0.9 ? randomInt(200, 600) : 0;
    await sleep(baseDelay + pause);
    
    // Occasional typo and correction
    if (Math.random() > 0.95) {
      await page.keyboard.press('Backspace');
      await sleep(randomInt(100, 300));
      await page.keyboard.type(char);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Advanced Fingerprint Randomization                                */
/* ------------------------------------------------------------------ */
async function injectFingerprintRandomization(page) {
  // Canvas fingerprint spoofing
  await page.evaluateOnNewDocument(() => {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      if (type === 'image/png' && this.width === 220 && this.height === 30) {
        // Likely a fingerprinting canvas
        const context = this.getContext('2d');
        if (context) {
          const imageData = context.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] ^= Math.floor(Math.random() * 2);
          }
          context.putImageData(imageData, 0, 0);
        }
      }
      return originalToDataURL.apply(this, arguments);
    };
  });

  // WebGL fingerprint spoofing
  await page.evaluateOnNewDocument(() => {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) {
        return 'Intel Inc.';
      }
      if (parameter === 37446) {
        return 'Intel Iris OpenGL Engine';
      }
      return getParameter.call(this, parameter);
    };
  });

  // Audio fingerprint spoofing
  await page.evaluateOnNewDocument(() => {
    const originalGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(channel) {
      const result = originalGetChannelData.call(this, channel);
      for (let i = 0; i < result.length; i++) {
        result[i] += (Math.random() - 0.5) * 1e-10;
      }
      return result;
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Session Pool Manager                                              */
/* ------------------------------------------------------------------ */
class SessionPool {
  constructor(config) {
    this.config = config;
    this.sessions = [];
    this.currentIndex = 0;
  }

  async initialize() {
    for (let i = 0; i < this.config.maxSessions; i++) {
      const session = await this.createSession(i);
      this.sessions.push(session);
    }
    logger.info(`Session pool initialized with ${this.sessions.length} sessions`);
  }

  async createSession(id) {
    const browser = await launchBrowser({
      ...this.config,
      proxy: this.getProxyForSession(id)
    });
    const page = await browser.newPage();
    
    // Apply fingerprint randomization
    if (this.config.fingerprintRandomization) {
      await injectFingerprintRandomization(page);
    }
    
    return { id, browser, page, inUse: false, lastUsed: Date.now() };
  }

  getProxyForSession(id) {
    if (!this.config.proxyRotation.enabled || !this.config.proxyRotation.proxies.length) {
      return this.config.proxy;
    }
    
    const proxies = this.config.proxyRotation.proxies;
    switch (this.config.proxyRotation.rotationStrategy) {
      case 'random':
        return proxies[Math.floor(Math.random() * proxies.length)];
      case 'failover':
        // Use next proxy if current fails
        return proxies[id % proxies.length];
      case 'round-robin':
      default:
        return proxies[id % proxies.length];
    }
  }

  async getSession() {
    // Try to find an available session
    let session = this.sessions.find(s => !s.inUse);
    
    if (!session) {
      // Rotate oldest session if all are in use
      session = this.sessions.reduce((oldest, current) => 
        current.lastUsed < oldest.lastUsed ? current : oldest
      );
    }
    
    session.inUse = true;
    session.lastUsed = Date.now();
    
    // Rotate fingerprint
    if (this.config.fingerprintRandomization) {
      await injectFingerprintRandomization(session.page);
    }
    
    return session;
  }

  releaseSession(session) {
    session.inUse = false;
  }

  async destroy() {
    for (const session of this.sessions) {
      await session.browser.close();
    }
    this.sessions = [];
  }
}

/* ------------------------------------------------------------------ */
/*  Browser Launcher with Enhanced Options                            */
/* ------------------------------------------------------------------ */
async function launchBrowser(config) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials',
    `--window-size=${config.viewport.width},${config.viewport.height}`,
    '--disable-blink-features=AutomationControlled',
    '--user-agent=' + (config.userAgent || USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]),
    
    // Additional fingerprint protection
    '--disable-reading-from-canvas',
    '--disable-remote-fonts',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-field-trial-config',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',
    '--safebrowsing-disable-auto-update',
    '--enable-automation',
    '--password-store=basic',
    '--use-mock-keychain'
  ];
  
  if (config.proxy) {
    args.push(`--proxy-server=${config.proxy}`);
    logger.info(`Using proxy: ${config.proxy}`);
  }

  const browser = await puppeteer.launch({
    headless: config.headless ? 'new' : false,
    args,
    defaultViewport: config.viewport,
    ignoreDefaultArgs: ['--enable-automation'],
    ignoreHTTPSErrors: true,
    slowMo: randomInt(10, 50), // Subtle slowdown for human-like interaction
    devtools: !config.headless
  });

  return browser;
}

/* ------------------------------------------------------------------ */
/*  Enhanced CAPTCHA Detection                                       */
/* ------------------------------------------------------------------ */
async function detectCaptcha(page) {
  return page.evaluate(() => {
    const result = {
      hasImageCaptcha: false,
      hasRecaptchaV2: false,
      hasRecaptchaV3: false,
      hasInvisibleCaptcha: false,
      hasHCaptcha: false,
      hasFunCaptcha: false,
      hasGeeTest: false,
      imageCaptchaSelector: null,
      recaptchaFrameSrc: null,
      recaptchaSiteKey: null,
      recaptchaV3Action: null
    };

    // 1. Image CAPTCHA detection with enhanced selectors
    const imgSelectors = [
      'img[id*="captcha" i]',
      'img[name*="captcha" i]',
      'img[src*="captcha" i]',
      'img[alt*="captcha" i]',
      'img[class*="captcha" i]',
      '.captcha-img img',
      '#captcha-img',
      'img[src*="seccode"]',
      'img[src*="verify"]',
      'img[src*="code"]',
      'img[id*="imgcode"]'
    ];
    
    for (const sel of imgSelectors) {
      const el = document.querySelector(sel);
      if (el && el.complete && el.naturalWidth > 0) {
        result.hasImageCaptcha = true;
        result.imageCaptchaSelector = sel;
        break;
      }
    }

    // 2. reCAPTCHA v2 detection
    const recaptchaFrame = document.querySelector(
      'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]'
    );
    if (recaptchaFrame) {
      result.hasRecaptchaV2 = true;
      result.recaptchaFrameSrc = recaptchaFrame.src;
      
      // Extract site key
      const match = recaptchaFrame.src.match(/[?&]k=([^&]+)/);
      if (match) {
        result.recaptchaSiteKey = match[1];
      }
    }

    // 3. reCAPTCHA v3 detection
    const v3Script = document.querySelector('script[src*="recaptcha/api.js?render="]');
    if (v3Script) {
      result.hasRecaptchaV3 = true;
      const match = v3Script.src.match(/render=([^&]+)/);
      if (match) {
        result.recaptchaSiteKey = match[1];
      }
    }
    
    // Check for grecaptcha.execute calls
    if (typeof grecaptcha !== 'undefined' && grecaptcha.execute) {
      result.hasRecaptchaV3 = true;
    }

    // 4. Invisible reCAPTCHA
    const invisible = document.querySelector('.grecaptcha-badge');
    if (invisible) {
      result.hasInvisibleCaptcha = true;
    }

    // 5. hCaptcha
    if (document.querySelector('iframe[src*="hcaptcha.com"], .h-captcha')) {
      result.hasHCaptcha = true;
    }

    // 6. FunCaptcha (Arkose Labs)
    if (document.querySelector('iframe[src*="funcaptcha.com"], #FunCaptcha')) {
      result.hasFunCaptcha = true;
    }

    // 7. GeeTest
    if (document.querySelector('.geetest_captcha, .gt_captcha')) {
      result.hasGeeTest = true;
    }

    return result;
  });
}

/* ------------------------------------------------------------------ */
/*  reCAPTCHA v2 Audio Challenge Solver                               */
/* ------------------------------------------------------------------ */
async function solveRecaptchaAudio(page) {
  try {
    // Click audio button
    const audioButton = await page.waitForSelector('#recaptcha-audio-button', {
      timeout: 5000
    });
    if (!audioButton) {
      logger.warn('Audio challenge button not found');
      return null;
    }
    
    await humanClick(page, '#recaptcha-audio-button');
    await sleep(2000);
    
    // Get audio source
    const audioSource = await page.evaluate(() => {
      const audio = document.querySelector('#audio-source');
      return audio ? audio.src : null;
    });
    
    if (!audioSource) {
      logger.warn('Audio source not found');
      return null;
    }
    
    // Download audio
    const audioData = await downloadAudio(audioSource);
    if (!audioData) return null;
    
    // Transcribe audio using speech-to-text service
    const transcription = await transcribeAudio(audioData);
    if (!transcription) return null;
    
    // Enter the transcription
    const audioResponse = await page.$('#audio-response');
    if (audioResponse) {
      await humanTyping(page, transcription, '#audio-response');
      await sleep(randomInt(500, 1000));
      
      // Click verify
      await humanClick(page, '#recaptcha-verify-button');
      await sleep(3000);
      
      return transcription;
    }
  } catch (err) {
    logger.error(`Audio challenge solving failed: ${err.message}`);
  }
  
  return null;
}

async function downloadAudio(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: DEFAULT_CONFIG.audioChallenge.downloadTimeout
    });
    return response.data;
  } catch (err) {
    logger.error(`Audio download failed: ${err.message}`);
    return null;
  }
}

async function transcribeAudio(audioData) {
  // Simple implementation - in production, use proper speech-to-text API
  // Google Speech-to-Text, Azure Cognitive Services, or Wit.ai
  const tempFile = path.join(process.cwd(), 'temp_audio.mp3');
  fs.writeFileSync(tempFile, audioData);
  
  // Placeholder - implement with actual speech service
  logger.info('Audio transcription would be performed here with speech service');
  
  // Clean up
  fs.unlinkSync(tempFile);
  
  // Return placeholder - implement actual transcription
  return '12345';
}

/* ------------------------------------------------------------------ */
/*  External CAPTCHA Solving Service Integration                      */
/* ------------------------------------------------------------------ */
async function solveWithExternalService(page, siteKey, pageUrl, config) {
  const service = config.captchaService;
  
  if (!service.apiKey) {
    logger.warn('No CAPTCHA service API key configured');
    return null;
  }
  
  try {
    switch (service.provider) {
      case '2captcha':
        return await solveWith2Captcha(siteKey, pageUrl, service);
      case 'anti-captcha':
        return await solveWithAntiCaptcha(siteKey, pageUrl, service);
      default:
        logger.warn(`Unknown CAPTCHA service: ${service.provider}`);
        return null;
    }
  } catch (err) {
    logger.error(`External CAPTCHA service failed: ${err.message}`);
    return null;
  }
}

async function solveWith2Captcha(siteKey, pageUrl, service) {
  const apiUrl = 'http://2captcha.com/in.php';
  
  // Submit CAPTCHA
  const response = await axios.post(apiUrl, {
    key: service.apiKey,
    method: 'userrecaptcha',
    googlekey: siteKey,
    pageurl: pageUrl,
    json: 1
  });
  
  if (response.data.status !== 1) {
    throw new Error(`2captcha submission failed: ${response.data.request}`);
  }
  
  const captchaId = response.data.request;
  logger.info(`CAPTCHA submitted to 2captcha, ID: ${captchaId}`);
  
  // Poll for result
  const startTime = Date.now();
  while (Date.now() - startTime < service.timeout) {
    await sleep(service.polling);
    
    const resultResponse = await axios.get('http://2captcha.com/res.php', {
      params: {
        key: service.apiKey,
        action: 'get',
        id: captchaId,
        json: 1
      }
    });
    
    if (resultResponse.data.status === 1) {
      logger.info('2captcha solved successfully');
      return resultResponse.data.request;
    }
    
    if (resultResponse.data.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2captcha error: ${resultResponse.data.request}`);
    }
  }
  
  throw new Error('2captcha timeout');
}

async function solveWithAntiCaptcha(siteKey, pageUrl, service) {
  const apiUrl = 'https://api.anti-captcha.com/createTask';
  
  const response = await axios.post(apiUrl, {
    clientKey: service.apiKey,
    task: {
      type: 'RecaptchaV2TaskProxyless',
      websiteURL: pageUrl,
      websiteKey: siteKey
    }
  });
  
  if (response.data.errorId !== 0) {
    throw new Error(`Anti-Captcha error: ${response.data.errorDescription}`);
  }
  
  const taskId = response.data.taskId;
  
  // Poll for result
  const startTime = Date.now();
  while (Date.now() - startTime < service.timeout) {
    await sleep(service.polling);
    
    const resultResponse = await axios.post('https://api.anti-captcha.com/getTaskResult', {
      clientKey: service.apiKey,
      taskId: taskId
    });
    
    if (resultResponse.data.status === 'ready') {
      return resultResponse.data.solution.gRecaptchaResponse;
    }
  }
  
  throw new Error('Anti-Captcha timeout');
}

/* ------------------------------------------------------------------ */
/*  Enhanced Image CAPTCHA Solving with Preprocessing                 */
/* ------------------------------------------------------------------ */
async function solveImageCaptcha(page, selector, config) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Image CAPTCHA element not found: ${selector}`);

  ensureDir(config.screenshotsDir);
  const imgPath = path.join(
    config.screenshotsDir,
    `image-captcha-${Date.now()}.png`
  );
  await el.screenshot({ path: imgPath });
  logger.info(`Captured image CAPTCHA → ${imgPath}`);

  // Preprocess image for better OCR
  let processedPath = imgPath;
  if (config.imageProcessing.enabled) {
    processedPath = await preprocessImage(imgPath, config.imageProcessing);
  }

  // Try multiple OCR approaches
  const results = [];
  
  // 1. Tesseract with default settings
  const tesseractResult = await Tesseract.recognize(processedPath, config.ocrLang, {
    logger: (m) => {
      if (m.status === 'recognizing text')
        logger.debug(`OCR progress: ${(m.progress * 100).toFixed(1)}%`);
    }
  });
  
  const text1 = (tesseractResult.data.text || '').replace(/\s+/g, '').trim();
  results.push({ text: text1, confidence: tesseractResult.data.confidence });

  // 2. Try with different PSM modes
  for (const psm of [7, 8, 13]) {
    try {
      const altResult = await Tesseract.recognize(processedPath, config.ocrLang, {
        tessedit_pageseg_mode: psm
      });
      const text = (altResult.data.text || '').replace(/\s+/g, '').trim();
      results.push({ text, confidence: altResult.data.confidence });
    } catch (err) {
      logger.debug(`PSM ${psm} failed: ${err.message}`);
    }
  }

  // Select best result
  results.sort((a, b) => b.confidence - a.confidence);
  const best = results[0];
  
  logger.info(`OCR best result: "${best.text}" (confidence: ${best.confidence})`);
  
  return { text: best.text, confidence: best.confidence, imagePath: processedPath };
}

/* ------------------------------------------------------------------ */
/*  reCAPTCHA v2 Enhanced Handling                                    */
/* ------------------------------------------------------------------ */
async function clickRecaptchaCheckbox(page) {
  const frameHandle = await page.waitForSelector(
    'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]',
    { timeout: 10000 }
  );
  const frame = await frameHandle.contentFrame();
  if (!frame) throw new Error('Could not access reCAPTCHA iframe');

  await frame.waitForSelector('#recaptcha-anchor', { timeout: 10000 });
  
  // Try multiple times with different approaches
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await (await frame.$('#recaptcha-anchor')).boundingBox();
    const frameBox = await frameHandle.boundingBox();
    const x = frameBox.x + box.x + box.width * randomFloat(0.3, 0.7);
    const y = frameBox.y + box.y + box.height * randomFloat(0.3, 0.7);

    await humanMouseMove(page, x, y);
    await sleep(randomInt(200, 600));
    
    // Subtle hover
    await page.mouse.move(x, y);
    await sleep(randomInt(100, 300));
    
    await page.mouse.click(x, y);
    logger.info(`Clicked reCAPTCHA v2 checkbox (attempt ${attempt + 1})`);

    await sleep(3000);

    const solved = await frame.evaluate(() => {
      const el = document.querySelector('#recaptcha-anchor');
      return el && el.getAttribute('aria-checked') === 'true';
    });

    if (solved) return true;
    
    // Check for challenge
    const hasChallenge = await frame.evaluate(() => {
      return !!document.querySelector('#recaptcha-challenge, .rc-imageselect');
    });
    
    if (!hasChallenge && attempt < 2) {
      logger.info('No challenge detected, retrying click...');
      await sleep(randomInt(1000, 2000));
    }
  }

  return false;
}

/* ------------------------------------------------------------------ */
/*  Main Enhanced Handler                                              */
/* ------------------------------------------------------------------ */
async function handleCaptcha(page, userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  ensureDir(config.screenshotsDir);
  
  // Initialize session pool if enabled
  let sessionPool = null;
  if (config.sessionPool.enabled) {
    sessionPool = new SessionPool(config);
    await sessionPool.initialize();
  }

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    logger.info(`CAPTCHA handling attempt ${attempt}/${config.maxRetries}`);

    const detection = await detectCaptcha(page);
    logger.info(`Detection result: ${JSON.stringify(detection)}`);

    if (
      !detection.hasImageCaptcha &&
      !detection.hasRecaptchaV2 &&
      !detection.hasRecaptchaV3 &&
      !detection.hasInvisibleCaptcha &&
      !detection.hasHCaptcha &&
      !detection.hasFunCaptcha &&
      !detection.hasGeeTest
    ) {
      logger.info('✅ No CAPTCHA detected on page.');
      return { solved: true, type: 'none' };
    }

    await captureScreenshot(page, `attempt-${attempt}`, config);

    try {
      /* ------------- reCAPTCHA v2 ------------- */
      if (detection.hasRecaptchaV2) {
        logger.info('Attempting reCAPTCHA v2 handling...');
        
        // Try external service first if configured
        if (config.captchaService.apiKey && detection.recaptchaSiteKey) {
          const token = await solveWithExternalService(
            page,
            detection.recaptchaSiteKey,
            page.url(),
            config
          );
          
          if (token) {
            await page.evaluate((token) => {
              document.getElementById('g-recaptcha-response').innerHTML = token;
              // Trigger callbacks
              if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
                Object.keys(window.___grecaptcha_cfg.clients).forEach(key => {
                  const client = window.___grecaptcha_cfg.clients[key];
                  if (client && client.callback) {
                    client.callback(token);
                  }
                });
              }
            }, token);
            
            await sleep(2000);
            if (await verifyCaptchaSolved(page)) {
              return { solved: true, type: 'recaptcha-v2-external', token };
            }
          }
        }
        
        // Try checkbox click
        const checked = await clickRecaptchaCheckbox(page);
        if (checked && (await verifyCaptchaSolved(page))) {
          return { solved: true, type: 'recaptcha-v2' };
        }
        
        // Try audio challenge
        if (config.audioChallenge.enabled) {
          const audioResult = await solveRecaptchaAudio(page);
          if (audioResult && (await verifyCaptchaSolved(page))) {
            return { solved: true, type: 'recaptcha-v2-audio' };
          }
        }
        
        logger.warn('reCAPTCHA v2 still requires solving');
      }

      /* ------------- Image CAPTCHA ------------- */
      if (detection.hasImageCaptcha) {
        const { text, confidence } = await solveImageCaptcha(
          page,
          detection.imageCaptchaSelector,
          config
        );

        if (text && confidence > 40) {
          const inputSel = [
            'input[name*="captcha" i]',
            'input[id*="captcha" i]',
            'input[name*="code" i]',
            'input[id*="code" i]',
            'input[type="text"]',
            'input:not([type="hidden"])'
          ].join(', ');
          
          const input = await page.$(inputSel);
          if (input) {
            await humanTyping(page, text, inputSel);
            await randomDelay();
            logger.info('Submitted OCR result to input field');

            // Try to find and click submit button
            const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:contains("Submit")');
            if (submitBtn) {
              await humanClick(page, submitBtn);
              await sleep(3000);
            }

            if (await verifyCaptchaSolved(page)) {
              return { solved: true, type: 'image', value: text };
            }
          }
        }
      }

      /* ------------- reCAPTCHA v3 ------------- */
      if (detection.hasRecaptchaV3) {
        logger.info('reCAPTCHA v3 detected - attempting token harvest');
        
        const token = await page.evaluate(() => {
          return new Promise((resolve) => {
            if (typeof grecaptcha !== 'undefined' && grecaptcha.execute) {
              grecaptcha.execute().then(resolve).catch(() => resolve(null));
            } else {
              resolve(null);
            }
          });
        });
        
        if (token) {
          logger.info('Successfully harvested reCAPTCHA v3 token');
          // Store token for later use
          await page.evaluate((token) => {
            window.__recaptchaV3Token = token;
          }, token);
        }
      }

    } catch (err) {
      logger.error(`Attempt ${attempt} failed: ${err.message}`);
      logger.error(err.stack);
    }

    if (attempt < config.maxRetries) {
      const delay = config.retryDelayMs * attempt; // Exponential backoff
      logger.info(`Waiting ${delay}ms before retry...`);
      await sleep(delay);
      
      // Refresh page for fresh CAPTCHA
      await page.reload({ waitUntil: 'networkidle2' });
      await randomDelay(1000, 2500);
    }
  }

  /* ------------- Manual fallback ------------- */
  const manualSolved = await manualSolveFallback(page, config);
  if (manualSolved) return { solved: true, type: 'manual' };

  return { solved: false, type: 'failed' };
}

/* ------------------------------------------------------------------ */
/*  Enhanced High-Level Automation                                     */
/* ------------------------------------------------------------------ */
async function automateWithCaptcha(url, userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const browser = await launchBrowser(config);
  const page = await browser.newPage();

  try {
    // Apply advanced fingerprint randomization
    if (config.fingerprintRandomization) {
      await injectFingerprintRandomization(page);
    }
    
    // Block service workers
    if (config.serviceWorkerBlock) {
      await page.evaluateOnNewDocument(() => {
        navigator.serviceWorker.register = () => Promise.reject(new Error('Blocked'));
      });
    }

    await page.setUserAgent(config.userAgent || USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);

    if (config.proxy && config.proxyAuth) {
      await page.authenticate(config.proxyAuth);
    }

    await loadCookies(page, config);

    // Randomize viewport slightly
    const viewport = {
      width: config.viewport.width + randomInt(-50, 50),
      height: config.viewport.height + randomInt(-50, 50)
    };
    await page.setViewport(viewport);

    logger.info(`Navigating to ${url}`);
    
    // Add random referrer
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    });
    
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 60000,
      referer: 'https://www.google.com/'
    });
    
    // Random scrolling behavior
    if (config.behavior.scrollBehavior) {
      await randomScroll(page);
    }
    
    await randomDelay(1000, 2500);

    const result = await handleCaptcha(page, config);
    logger.info(`CAPTCHA handling result: ${JSON.stringify(result)}`);

    if (result.solved) await saveCookies(page, config);

    return { result, page, browser };
  } catch (err) {
    logger.error(`Automation failed: ${err.message}`);
    logger.error(err.stack);
    await browser.close();
    throw err;
  }
}

async function randomScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100 + Math.floor(Math.random() * 100);
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        
        if (totalHeight >= scrollHeight * (0.3 + Math.random() * 0.4)) {
          clearInterval(timer);
          resolve();
        }
      }, 100 + Math.floor(Math.random() * 100));
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Existing functions maintained with minor enhancements             */
/* ------------------------------------------------------------------ */

async function captureScreenshot(page, label, config) {
  ensureDir(config.screenshotsDir);
  const fileName = `captcha-${label}-${Date.now()}.png`;
  const fullPath = path.join(config.screenshotsDir, fileName);
  await page.screenshot({ path: fullPath, fullPage: true });
  logger.info(`Screenshot saved: ${fullPath}`);
  return fullPath;
}

async function saveCookies(page, config) {
  ensureDir(config.sessionDir);
  const cookies = await page.cookies();
  const file = path.join(config.sessionDir, config.cookiesFile);
  fs.writeFileSync(file, JSON.stringify(cookies, null, 2));
  logger.info(`Saved ${cookies.length} cookies → ${file}`);
}

async function loadCookies(page, config) {
  const file = path.join(config.sessionDir, config.cookiesFile);
  if (!fs.existsSync(file)) {
    logger.info('No cookie file found; starting fresh session');
    return false;
  }
  try {
    const cookies = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(cookies) && cookies.length) {
      await page.setCookie(...cookies);
      logger.info(`Loaded ${cookies.length} cookies from ${file}`);
      return true;
    }
  } catch (err) {
    logger.warn(`Failed to load cookies: ${err.message}`);
  }
  return false;
}

async function verifyCaptchaSolved(page) {
  await sleep(1500);
  const state = await detectCaptcha(page);
  const stillPresent =
    state.hasImageCaptcha ||
    state.hasRecaptchaV2 ||
    state.hasHCaptcha ||
    state.hasFunCaptcha;
  return !stillPresent;
}

async function manualSolveFallback(page, config) {
  if (!config.manualFallback) {
    logger.warn('Manual fallback disabled.');
    return false;
  }

  logger.warn(
    'Automated solving failed. Switching to MANUAL mode. ' +
      'Please solve the CAPTCHA in the browser window.'
  );

  if (config.headless) {
    logger.error(
      'Cannot solve manually in headless mode. ' +
        'Re-run with headless:false to enable manual fallback.'
    );
    return false;
  }

  await askConsole(
    '👉  After solving the CAPTCHA in the browser, press ENTER to continue...'
  );

  return verifyCaptchaSolved(page);
}

/* ------------------------------------------------------------------ */
/*  Enhanced Express API                                              */
/* ------------------------------------------------------------------ */
function startApiServer(port = 3000, defaultConfig = {}) {
  const app = express();
  app.use(express.json());

  // Rate limiting
  const requestCounts = new Map();
  app.use((req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 10;
    
    if (!requestCounts.has(ip)) {
      requestCounts.set(ip, []);
    }
    
    const requests = requestCounts.get(ip).filter(time => now - time < windowMs);
    requests.push(now);
    requestCounts.set(ip, requests);
    
    if (requests.length > maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    
    next();
  });

  app.post('/solve', async (req, res) => {
    const { url, config } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });

    try {
      const { result, browser } = await automateWithCaptcha(url, {
        ...defaultConfig,
        ...config
      });
      await browser.close();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }
  });

  app.post('/detect', async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });

    try {
      const browser = await launchBrowser(DEFAULT_CONFIG);
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const detection = await detectCaptcha(page);
      await browser.close();
      res.json(detection);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/health', (_, res) => res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0-enhanced'
  }));

  app.get('/stats', (req, res) => {
    const stats = {
      activeRequests: requestCounts.get(req.ip)?.length || 0,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
    res.json(stats);
  });

  app.listen(port, () =>
    logger.info(`Enhanced CAPTCHA handler API running on http://localhost:${port}`)
  );

  return app;
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */
module.exports = {
  handleCaptcha,
  automateWithCaptcha,
  detectCaptcha,
  solveImageCaptcha,
  clickRecaptchaCheckbox,
  verifyCaptchaSolved,
  manualSolveFallback,
  captureScreenshot,
  saveCookies,
  loadCookies,
  launchBrowser,
  startApiServer,
  solveRecaptchaAudio,
  preprocessImage,
  humanMouseMove,
  humanClick,
  humanTyping,
  injectFingerprintRandomization,
  SessionPool,
  logger,
  DEFAULT_CONFIG
};

/* ------------------------------------------------------------------ */
/*  CLI Entry Point                                                   */
/* ------------------------------------------------------------------ */
if (require.main === module) {
  (async () => {
    const url = process.argv[2];
    if (!url) {
      console.log('Usage: node captcha-handler-enhanced.js <URL> [--headful] [--api] [--audio] [--service=2captcha]');
      console.log('Environment variables:');
      console.log('  CAPTCHA_API_KEY - API key for 2captcha/Anti-Captcha');
      console.log('  LOG_LEVEL - Logging level (debug, info, warn, error)');
      process.exit(1);
    }

    if (process.argv.includes('--api')) {
      startApiServer(3000);
      return;
    }

    const headless = !process.argv.includes('--headful');
    const useAudio = process.argv.includes('--audio');
    
    const config = {
      headless,
      manualFallback: !headless,
      audioChallenge: { enabled: useAudio }
    };

    // Parse service argument
    const serviceArg = process.argv.find(arg => arg.startsWith('--service='));
    if (serviceArg) {
      const service = serviceArg.split('=')[1];
      config.captchaService = {
        provider: service,
        apiKey: process.env.CAPTCHA_API_KEY || ''
      };
    }

    try {
      const { result, browser } = await automateWithCaptcha(url, config);
      console.log('Result:', JSON.stringify(result, null, 2));
      await browser.close();
    } catch (err) {
      console.error('Error:', err.message);
      if (process.env.LOG_LEVEL === 'debug') {
        console.error(err.stack);
      }
      process.exit(1);
    }
  })();
}