import { fileURLToPath } from 'node:url';

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
    handover: {
      name: 'Harbour Handover folder',
      root: fileURLToPath(new URL('./demo/harbour-workspace/', import.meta.url)),
      folders: {
        '00-Start': 'Handover inbox and first-shift orientation',
        '01-Funding': 'Grant readiness register, applicant eligibility memo, correspondence log',
        '02-Infrastructure': 'East quay condition handover and harbour railway work package',
        '03-Governance': 'Council crosswalk, reporting procedure and variance ledger',
        '04-Delivery': 'WSV interface register and delivery action log',
      },
      fundingRegister: { folder: '01-Funding', filename: 'Grant readiness register.txt' },
      classification: 'Simulated internal training records. Separate from the public budget and from RAG.',
    },
    ...(driveFolder && { drive: { name: 'Harbour Funding', url: driveFolder } }),
    notes: { app: 'Notepad', defaultFilename: 'Harbour funding brief.txt' },
  };
}
