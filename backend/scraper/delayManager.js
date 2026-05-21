/**
 * Delay Manager — Human-like delay engine
 * Provides random delays, reading simulation, and mode presets
 */

// Mode presets define delay ranges and recommended worker counts
const MODE_PRESETS = {
  safe: {
    delayMin: 8,
    delayMax: 15,
    readingDelay: { min: 3, max: 6 },
    recommendedWorkers: 2,
    label: 'Safe Mode'
  },
  balanced: {
    delayMin: 2,
    delayMax: 7,
    readingDelay: { min: 1, max: 3 },
    recommendedWorkers: 5,
    label: 'Balanced Mode'
  },
  fast: {
    delayMin: 1,
    delayMax: 3,
    readingDelay: { min: 0.5, max: 1.5 },
    recommendedWorkers: 5,
    label: 'Fast Mode'
  }
};

/**
 * Generate a random delay between min and max (in seconds)
 * @param {number} min - Minimum delay in seconds
 * @param {number} max - Maximum delay in seconds
 * @returns {number} Delay in milliseconds
 */
function randomDelay(min, max) {
  const seconds = min + Math.random() * (max - min);
  return Math.round(seconds * 1000);
}

/**
 * Sleep for a random duration
 * @param {number} min - Minimum delay in seconds
 * @param {number} max - Maximum delay in seconds
 * @returns {Promise<void>}
 */
function sleep(min, max) {
  const ms = randomDelay(min, max);
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get delay settings for a given mode
 * @param {string} mode - 'safe', 'balanced', or 'fast'
 * @returns {object} Mode configuration
 */
function getModeSettings(mode) {
  return MODE_PRESETS[mode] || MODE_PRESETS.balanced;
}

/**
 * Simulate human reading delay
 * @param {string} mode - Current scraping mode
 * @returns {Promise<void>}
 */
async function simulateReading(mode) {
  const settings = getModeSettings(mode);
  const { min, max } = settings.readingDelay;
  await sleep(min, max);
}

/**
 * Get a random cooldown duration (in milliseconds)
 * @param {number} min - Minimum cooldown in seconds (default: 20)
 * @param {number} max - Maximum cooldown in seconds (default: 30)
 * @returns {number}
 */
function getCooldownDuration(min = 20, max = 30) {
  return randomDelay(min, max);
}

/**
 * Generate human-like slow delays for search engine pages
 * @param {string} mode - 'safe', 'balanced', or 'fast'
 * @returns {number} Delay in milliseconds
 */
function getSearchDelay(mode) {
  let min = 6, max = 12; // Balanced fallback
  if (mode === 'safe') {
    min = 10;
    max = 18;
  } else if (mode === 'fast') {
    min = 4;
    max = 8;
  }
  return randomDelay(min, max);
}

/**
 * Execute the main request delay based on custom range or mode
 * @param {object} options
 * @param {number} options.delayMin - Custom min delay (seconds)
 * @param {number} options.delayMax - Custom max delay (seconds)
 * @param {string} options.mode - Scraping mode fallback
 * @returns {Promise<number>} Actual delay used in ms
 */
async function executeDelay(options = {}) {
  let min, max;

  if (options.delayMin !== undefined && options.delayMax !== undefined) {
    min = options.delayMin;
    max = options.delayMax;
  } else {
    const settings = getModeSettings(options.mode || 'balanced');
    min = settings.delayMin;
    max = settings.delayMax;
  }

  const actualDelay = randomDelay(min, max);
  await new Promise(resolve => setTimeout(resolve, actualDelay));
  return actualDelay;
}

module.exports = {
  MODE_PRESETS,
  randomDelay,
  sleep,
  getModeSettings,
  simulateReading,
  getCooldownDuration,
  getSearchDelay,
  executeDelay
};
