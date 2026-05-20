/**
 * Excel Export — Export results to XLSX format with styling
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, '..', '..', 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

/**
 * Export results as XLSX
 * @param {object[]} results - Array of email result objects
 * @param {string} mode - 'email' (email only) or 'full' (all columns)
 * @returns {string} Path to the generated XLSX file
 */
function exportExcel(results, mode = 'full') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `emails_${timestamp}.xlsx`;
  const filepath = path.join(downloadsDir, filename);

  let data;

  if (mode === 'email') {
    data = [
      ['Email'],
      ...results.map(r => [r.email])
    ];
  } else {
    data = [
      ['Email', 'Company', 'Keyword', 'Status', 'Source', 'Domain'],
      ...results.map(r => [
        r.email,
        r.company || '',
        r.keyword || '',
        r.status || '',
        r.source || '',
        r.domain || ''
      ])
    ];
  }

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // Auto-fit column widths
  const maxWidths = data[0].map((_, colIndex) => {
    return Math.max(...data.map(row => {
      const val = row[colIndex] ? row[colIndex].toString() : '';
      return val.length;
    }));
  });

  worksheet['!cols'] = maxWidths.map(w => ({ wch: Math.min(w + 4, 50) }));

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Emails');
  XLSX.writeFile(workbook, filepath);

  return { filepath, filename };
}

module.exports = { exportExcel };
