const budgetFilename = '00_haushaltsplan_2026_2027_gesamt.pdf';

export function harbourWorkspaceMap(localFolder, driveValue) {
  let driveFolder;
  if (driveValue?.trim()) {
    try {
      const url = new URL(driveValue.trim());
      if (url.origin === 'https://drive.google.com' && !url.username && !url.password &&
          /^\/drive\/(?:u\/\d+\/)?folders\/[\w-]+\/?$/.test(url.pathname) && !url.hash) {
        driveFolder = url.href;
      }
    } catch {
      // A malformed configuration leaves Drive unmapped.
    }
  }
  return {
    source: { name: 'Hildesheim 2026–2027 budget', filename: budgetFilename },
    ...(localFolder && { local: { name: 'Harbour source folder', path: localFolder } }),
    ...(driveFolder && { drive: { name: 'Harbour Funding', url: driveFolder } }),
    notes: { app: 'Notepad', defaultFilename: 'Harbour funding brief.txt' },
  };
}
