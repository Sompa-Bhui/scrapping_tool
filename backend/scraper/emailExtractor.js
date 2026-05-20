/**
 * Email Extractor — Smart email extraction and filtering engine
 * Extracts public business emails from HTML content with intelligent filtering
 */

// Master regex for email extraction
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[A-Za-z]{2,}/g;

// Business email prefixes to prioritize
const BUSINESS_PREFIXES = [
  'info', 'sales', 'support', 'contact', 'admin',
  'marketing', 'hr', 'career', 'careers', 'hello',
  'team', 'office', 'billing', 'help', 'service',
  'enquiry', 'inquiry', 'mail', 'business', 'general',
  'feedback', 'media', 'press', 'partnerships', 'legal'
];

// Free email providers to optionally filter out
const FREE_PROVIDERS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
  'zoho.com', 'yandex.com', 'gmx.com', 'live.com'
];

// Domains to always ignore (not real businesses)
const BLACKLISTED_DOMAINS = [
  'example.com', 'test.com', 'localhost', 'sentry.io',
  'wixpress.com', 'wordpress.com', 'squarespace.com',
  'shopify.com', 'godaddy.com', 'cloudflare.com',
  'googleapis.com', 'google.com', 'facebook.com',
  'twitter.com', 'instagram.com', 'linkedin.com',
  'github.com', 'microsoft.com', 'apple.com',
  'amazon.com', 'w3.org', 'schema.org',
  'bootstrapcdn.com', 'jsdelivr.net', 'cdnjs.cloudflare.com'
];

// Patterns indicating fake/placeholder emails
const FAKE_PATTERNS = [
  /^(test|demo|sample|placeholder|no[._-]?reply|do[._-]?not[._-]?reply|mailer-daemon)/i,
  /^(user|username|email|name)@/i,
  /^(your|my|the)[\.\-]?email/i,
  /@(your|my|the)?domain/i,
  /example\.(com|org|net)/i
];

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeHtmlEntities(value) {
  if (!value || typeof value !== 'string') return value;
  return value
    .replace(/&#64;|&#x40;|&commat;/gi, '@')
    .replace(/&#46;|&#x2e;|&period;|&dot;/gi, '.')
    .replace(/&nbsp;|&#160;/gi, ' ');
}

function decodeCfEmail(encoded) {
  if (!encoded || encoded.length < 4) return null;
  const key = parseInt(encoded.slice(0, 2), 16);
  if (Number.isNaN(key)) return null;
  let email = '';
  for (let i = 2; i < encoded.length; i += 2) {
    const code = parseInt(encoded.slice(i, i + 2), 16);
    if (Number.isNaN(code)) return null;
    email += String.fromCharCode(code ^ key);
  }
  return email || null;
}

function extractCloudflareEmails(html, emails) {
  const cfRegex = /data-cfemail=["']([0-9a-fA-F]+)["']/g;
  let match;
  while ((match = cfRegex.exec(html)) !== null) {
    const decoded = decodeCfEmail(match[1]);
    if (decoded) emails.add(decoded.toLowerCase().trim());
  }
}

function extractDataAttributeEmails(html, emails) {
  const dataAttrRegex = /data-(?:email|mail|contact)=["']([^"']+)["']/gi;
  let match;
  while ((match = dataAttrRegex.exec(html)) !== null) {
    const raw = decodeHtmlEntities(match[1]);
    const decoded = safeDecodeURIComponent(raw);
    const found = decoded.match(EMAIL_REGEX) || [];
    found.forEach(e => emails.add(e.toLowerCase().trim()));
  }
}

/**
 * Extract all emails from HTML content
 * @param {string} html - Raw HTML content
 * @returns {string[]} Array of extracted email strings
 */
function extractFromHTML(html) {
  if (!html || typeof html !== 'string') return [];

  // 1. Strip formatting tags completely so bold/strong tags don't split email addresses
  const noFormatTags = html
    .replace(/<\/?(b|strong|span|i|em|mark|ins|del)[^>]*>/gi, '');
  const decodedSource = decodeHtmlEntities(noFormatTags);

  // 2. De-obfuscate common anti-bot email formats
  const cleanSource = decodedSource
    .replace(/\s*(?:\{at\}|\[at\]|\(at\))\s*/gi, '@')
    .replace(/\s*(?:\{dot\}|\[dot\]|\(dot\))\s*/gi, '.')
    .replace(/(\w+)\s+at\s+(\w+\.\w+)/gi, '$1@$2');

  const emails = new Set();

  // 3. Extract from Cloudflare and data attributes
  extractCloudflareEmails(decodedSource, emails);
  extractDataAttributeEmails(decodedSource, emails);

  // 4. Extract from mailto links
  const mailtoRegex = /mailto:([^"'\s>]+)/gi;
  let match;
  while ((match = mailtoRegex.exec(cleanSource)) !== null) {
    const decoded = safeDecodeURIComponent(match[1]);
    const target = decoded.split('?')[0];
    const found = target.match(EMAIL_REGEX) || [];
    found.forEach(e => emails.add(e.toLowerCase().trim()));
  }

  // 5. Extract from JSON-LD structured data
  const jsonLdRegex = /<script[^>]*type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = jsonLdRegex.exec(cleanSource)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      extractFromObject(data, emails);
    } catch (e) {
      // Invalid JSON-LD, skip
    }
  }

  // 6. Extract from visible text and attributes after stripping other tags
  const cleanHtml = cleanSource
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '); // Replace all other HTML tags with spaces

  const bodyEmails = cleanHtml.match(EMAIL_REGEX) || [];
  bodyEmails.forEach(e => emails.add(e.toLowerCase().trim()));

  // 7. Extract common obfuscated patterns like "name at domain dot com"
  const obfuscatedRegex = /([a-zA-Z0-9._%+\-]+)\s+(?:at|AT)\s+([a-zA-Z0-9.\-]+(?:\s+(?:dot|DOT)\s+[a-zA-Z]{2,})+)/g;
  let obMatch;
  while ((obMatch = obfuscatedRegex.exec(cleanHtml)) !== null) {
    const local = obMatch[1].toLowerCase().trim();
    const domain = obMatch[2].replace(/\s+(?:dot|DOT)\s+/g, '.').toLowerCase().trim();
    emails.add(`${local}@${domain}`);
  }

  // 7b. Extract patterns like "name @ domain . com"
  const spacedAtRegex = /([a-zA-Z0-9._%+\-]+)\s*@\s*([a-zA-Z0-9.\-]+(?:\s*\.\s*[A-Za-z]{2,})+)/g;
  let spacedMatch;
  while ((spacedMatch = spacedAtRegex.exec(cleanHtml)) !== null) {
    const local = spacedMatch[1].toLowerCase().trim();
    const domain = spacedMatch[2].replace(/\s*\.\s*/g, '.').toLowerCase().trim();
    emails.add(`${local}@${domain}`);
  }

  // 8. Permissive matches & Auto-repair for truncated Google snippet emails (e.g. name@gmail...)
  const truncatedRegex = /([a-zA-Z0-9._%+\-]+)@([a-zA-Z0-9.\-]+)/g;
  let trMatch;
  while ((trMatch = truncatedRegex.exec(cleanHtml)) !== null) {
    const local = trMatch[1].toLowerCase().trim();
    let domain = trMatch[2].toLowerCase().trim();

    // Clean trailing dots/punctuation
    domain = domain.replace(/[^a-zA-Z0-9.\-]/g, '').replace(/\.+$/, '');

    // Auto-repair common domains if truncated or partial
    if (domain === 'gmail' || domain === 'gmail.c' || domain === 'gmail.co') {
      domain = 'gmail.com';
    } else if (domain === 'yahoo' || domain === 'yahoo.c' || domain === 'yahoo.co') {
      domain = 'yahoo.com';
    } else if (domain === 'hotmail' || domain === 'hotmail.c' || domain === 'hotmail.co') {
      domain = 'hotmail.com';
    } else if (domain === 'outlook' || domain === 'outlook.c' || domain === 'outlook.co') {
      domain = 'outlook.com';
    }

    if (domain.includes('.') && domain.split('.')[1].length >= 2) {
      emails.add(`${local}@${domain}`);
    }
  }

  // 9. Extract from href attributes specifically
  const hrefRegex = /href=["']([^"']*@[^"']*)/gi;
  while ((match = hrefRegex.exec(cleanSource)) !== null) {
    const decoded = safeDecodeURIComponent(match[1]);
    const hrefEmails = decoded.match(EMAIL_REGEX) || [];
    hrefEmails.forEach(e => emails.add(e.toLowerCase().trim()));
  }

  return Array.from(emails);
}

/**
 * Recursively extract emails from structured data objects
 * @param {*} obj - Object to search
 * @param {Set} emails - Set to add found emails to
 */
function extractFromObject(obj, emails) {
  if (!obj) return;
  if (typeof obj === 'string') {
    const found = obj.match(EMAIL_REGEX) || [];
    found.forEach(e => emails.add(e.toLowerCase().trim()));
  } else if (Array.isArray(obj)) {
    obj.forEach(item => extractFromObject(item, emails));
  } else if (typeof obj === 'object') {
    Object.values(obj).forEach(val => extractFromObject(val, emails));
  }
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
function isValidEmail(email) {
  if (!email || email.length < 5 || email.length > 254) return false;

  // Must have exactly one @
  const parts = email.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;

  // Local part checks
  if (local.length === 0 || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;

  // Domain checks
  if (domain.length === 0 || domain.length > 253) return false;
  if (domain.startsWith('.') || domain.startsWith('-')) return false;
  if (domain.includes('..')) return false;

  // Must have at least one dot in domain
  const domainParts = domain.split('.');
  if (domainParts.length < 2) return false;

  // TLD must be at least 2 chars
  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2 || tld.length > 24) return false;

  // No spaces or special chars in domain
  if (/[^a-zA-Z0-9.\-]/.test(domain)) return false;

  return true;
}

/**
 * Check if email is likely fake/placeholder
 * @param {string} email - Email to check
 * @returns {boolean} True if email appears fake
 */
function isFakeEmail(email) {
  return FAKE_PATTERNS.some(pattern => pattern.test(email));
}

/**
 * Check if email is from a blacklisted domain
 * @param {string} email - Email to check
 * @returns {boolean}
 */
function isBlacklistedDomain(email) {
  const domain = email.split('@')[1];
  return BLACKLISTED_DOMAINS.some(bd => domain === bd || domain.endsWith('.' + bd));
}

/**
 * Check if email is from a free provider
 * @param {string} email - Email to check
 * @returns {boolean}
 */
function isFreeProvider(email) {
  const domain = email.split('@')[1];
  return FREE_PROVIDERS.includes(domain);
}

/**
 * Check if email has a business-friendly prefix
 * @param {string} email - Email to check
 * @returns {boolean}
 */
function isBusinessPrefix(email) {
  const local = email.split('@')[0].toLowerCase();
  return BUSINESS_PREFIXES.some(prefix => local === prefix || local.startsWith(prefix + '.'));
}

/**
 * Filter and clean extracted emails
 * @param {string[]} emails - Raw extracted emails
 * @param {object} options - Filter options
 * @param {boolean} options.filterFreeProviders - Remove free email providers
 * @param {boolean} options.businessOnly - Only keep business-prefix emails
 * @returns {object[]} Filtered email objects with metadata
 */
function filterEmails(emails, options = {}) {
  const { filterFreeProviders = false, businessOnly = false } = options;
  const results = [];
  const seen = new Set();

  for (const email of emails) {
    const cleaned = email.toLowerCase().trim();

    // Skip duplicates
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);

    // Skip invalid
    if (!isValidEmail(cleaned)) continue;

    // Skip fake/placeholder
    if (isFakeEmail(cleaned)) continue;

    // Skip blacklisted domains
    if (isBlacklistedDomain(cleaned)) continue;

    // Optional: skip free providers
    if (filterFreeProviders && isFreeProvider(cleaned)) continue;

    // Determine type
    const isBusiness = isBusinessPrefix(cleaned);

    // Optional: only keep business emails
    if (businessOnly && !isBusiness) continue;

    results.push({
      email: cleaned,
      domain: cleaned.split('@')[1],
      isBusiness,
      isFreeProvider: isFreeProvider(cleaned)
    });
  }

  // Sort: business emails first, then alphabetically
  results.sort((a, b) => {
    if (a.isBusiness && !b.isBusiness) return -1;
    if (!a.isBusiness && b.isBusiness) return 1;
    return a.email.localeCompare(b.email);
  });

  return results;
}

/**
 * Find contact/about page URLs from HTML
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {string[]} Array of contact/about page URLs
 */
function findContactPages(html, baseUrl) {
  const contactPatterns = [
    /href=["']([^"']*(?:contact|contact-us|contactus|about|about-us|aboutus|company|team|office|connect|reach|get-in-touch|support|help|customer-service|service)[^"']*)/gi,
    /href=["']([^"']*(?:impressum|legal|privacy|terms)[^"']*)/gi,
    /href=["']([^"']*(?:kontakt|contato|contacto|suporte|assistance|assistenza)[^"']*)/gi
  ];

  const urls = new Set();

  for (const pattern of contactPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1];

      // Skip anchors, javascript, mailto, tel links
      if (url.startsWith('#') || url.startsWith('javascript:') ||
          url.startsWith('mailto:') || url.startsWith('tel:')) continue;

      // Resolve relative URLs
      try {
        const resolved = new URL(url, baseUrl).href;
        // Only keep same-domain URLs
        if (new URL(resolved).hostname === new URL(baseUrl).hostname) {
          urls.add(resolved);
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  }

  return Array.from(urls).slice(0, 4); // Max 4 contact pages
}

module.exports = {
  extractFromHTML,
  filterEmails,
  findContactPages,
  isValidEmail,
  isFakeEmail,
  isFreeProvider,
  isBusinessPrefix,
  BUSINESS_PREFIXES,
  FREE_PROVIDERS
};
