/**
 * CSV Export — Export results to CSV format
 */

const { createObjectCsvWriter } = require('csv-writer');
const path = require('path');
const fs = require('fs');

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, '..', '..', 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

/**
 * Export results as CSV
 * @param {object[]} results - Array of email result objects
 * @param {string} mode - 'email' (email only) or 'full' (all columns)
 * @returns {Promise<string>} Path to the generated CSV file
 */
async function exportCSV(results, mode = 'full') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `emails_${timestamp}.csv`;
  const filepath = path.join(downloadsDir, filename);

  let header;
  let records;

  if (mode === 'email') {
    header = [{ id: 'email', title: 'Email' }];
    records = results.map(r => ({ email: r.email }));
  } else {
    header = [
      { id: 'email', title: 'Email' },
      { id: 'company', title: 'Company' },
      { id: 'keyword', title: 'Keyword' },
      { id: 'status', title: 'Status' },
      { id: 'source', title: 'Source' },
      { id: 'domain', title: 'Domain' }
    ];
    records = results.map(r => ({
      email: r.email,
      company: r.company || '',
      keyword: r.keyword || '',
      status: r.status || '',
      source: r.source || '',
      domain: r.domain || ''
    }));
  }

  const csvWriter = createObjectCsvWriter({
    path: filepath,
    header
  });

  await csvWriter.writeRecords(records);

  return { filepath, filename };
}

module.exports = { exportCSV };
