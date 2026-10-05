(function () {
  'use strict';

  const monthly = [
    ['2024-03', 73, 225.00], ['2024-04', 934, 6366.00], ['2024-05', 3392, 38394.50],
    ['2024-06', 3275, 38187.75], ['2024-07', 5979, 99332.00], ['2024-08', 5383, 89464.00],
    ['2024-09', 2247, 24976.00], ['2024-10', 1660, 16865.25], ['2024-11', 942, 11363.25],
    ['2024-12', 350, 2852.00], ['2025-01', 365, 2932.25], ['2025-02', 435, 4016.50],
    ['2025-03', 698, 5413.00], ['2025-04', 1179, 8586.50], ['2025-05', 1875, 16967.26],
    ['2025-06', 3138, 42909.75], ['2025-07', 4226, 68135.26], ['2025-08', 4628, 78690.50],
    ['2025-09', 1920, 18621.25], ['2025-10', 1335, 15984.75], ['2025-11', 200, 2212.25]
  ].map(([month, transactions, amount]) => ({ month, transactions, amount }));

  const locations = [
    ['SPIRIT CATCHER', 6193, 90745.25, 0, 50, 34],
    ['SOUTHSHORE 1', 5669, 67031.00, 6, 63, 71],
    ['LAKESHORE LOT', 5508, 56372.75, 0, 60, 53],
    ['HERITAGE EAST', 5006, 9421.50, 1470, 48, 46],
    ['MARINA 3', 4053, 84320.75, 1, 56, 27],
    ['NORTH VIC 1', 3693, 69982.00, 0, 38, 22],
    ['NORTH VIC 2', 2998, 53726.01, 3, 42, 18],
    ['HERITAGE NORTH', 2124, 3837.75, 547, 42, 40],
    ['MARINA 2', 2086, 41668.75, 0, 63, 26],
    ['SOUTHSHORE 2', 1214, 17135.00, 0, 68, 76],
    ['MARINA 1', 1143, 21025.75, 0, 52, 20],
    ['NORTH MARINA', 1006, 18094.50, 0, 43, 18],
    ['NORTH CENT LAUNCH', 913, 22812.00, 0, 35, 16],
    ['PARKSIDE 1', 850, 1559.00, 52, 39, 51],
    ['TIFFIN LAUNCH', 696, 26282.75, 0, 73, 83],
    ['LAKESHORE DRIVE 1', 411, 7418.25, 0, 65, 61],
    ['ROSS', 363, 599.25, 47, 33, 44],
    ['PARKSIDE 2', 308, 462.76, 65, 35, 55]
  ].map(([name, transactions, amount, zero, x, y], i) => ({ id: i + 1, name, transactions, amount, zero, x, y }));

  const paymentTypes = [
    ['Credit — Visa', 14805, 244535.02],
    ['Debit', 11137, 165755.75],
    ['Credit — Mastercard', 8997, 146961.50],
    ['Cash', 8579, 23606.25],
    ['Credit — Amex', 712, 11611.50],
    ['Credit — Discover', 4, 25.00]
  ].map(([name, transactions, amount]) => ({ name, transactions, amount }));

  const weekdays = [
    ['Monday', 5394], ['Tuesday', 4843], ['Wednesday', 4935], ['Thursday', 4994],
    ['Friday', 5929], ['Saturday', 9401], ['Sunday', 8738]
  ].map(([name, transactions]) => ({ name, transactions }));

  const hours = [833,323,85,83,35,8,4,7,2,28,161,463,1130,2280,3716,4204,5487,5567,4775,4835,3267,2816,2376,1749];

  const totals = {
    records: 44236,
    amount: 592495.02,
    locations: 18,
    zeroRecords: 2193,
    dateStart: 'March 28, 2024',
    dateEnd: 'November 11, 2025'
  };

  function money(value, decimals = 0) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value);
  }

  function integer(value) {
    return new Intl.NumberFormat('en-CA').format(Math.round(value));
  }

  function icon(name, size = 20) {
    const paths = {
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      chart: '<path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-7"/>',
      database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      dollar: '<circle cx="12" cy="12" r="9"/><path d="M16 8.5c-1-1-2.2-1.5-4-1.5-2.2 0-3.5 1-3.5 2.6 0 3.8 7.5 1.6 7.5 5.4 0 1.4-1.3 2.5-3.7 2.5-1.8 0-3.2-.6-4.3-1.7M12 5v14"/>',
      pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
      alert: '<path d="M10.3 3.8 2.5 17.3A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.7L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
      check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
      download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
      layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
      map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
      filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
      bulb: '<path d="M9 18h6M10 22h4"/><path d="M8.1 14.5A7 7 0 1 1 16 14.6c-.8.7-1 1.3-1 2.4H9c0-1.1-.2-1.8-.9-2.5Z"/>',
      arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
      compare: '<path d="M8 3 4 7l4 4M4 7h13a3 3 0 0 1 3 3v1M16 21l4-4-4-4m4 4H7a3 3 0 0 1-3-3v-1"/>'
    };
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.info) + '</svg>';
  }

  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
    toast('De-identified CSV prepared.');
  }

  function monthLabel(month) {
    const [year, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, m - 1, 1)));
  }

  window.ParkingData = { monthly, locations, paymentTypes, weekdays, hours, totals, money, integer, icon, toast, downloadCsv, monthLabel };
})();
