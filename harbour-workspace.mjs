import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const budgetFilename = '00_haushaltsplan_2026_2027_gesamt.pdf';
const handoverRoot = fileURLToPath(new URL('./demo/harbour-workspace/', import.meta.url));
const handoverFiles = {
  '00-Start': ['Harbour handover inbox.txt'],
  '01-Funding': ['Grant readiness register.txt', 'Applicant eligibility working memo.txt', 'Funding correspondence log.txt'],
  '02-Infrastructure': ['East quay condition handover.txt', 'Harbour railway work package.txt'],
  '03-Governance': ['Council decision crosswalk.txt', 'Project reporting procedure.txt', 'Cost variance sample ledger.csv'],
  '04-Delivery': ['WSV interface register.txt', 'Delivery action log.csv'],
};
const fundingRegister = 'Grant readiness register.txt';

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
    source: {
      name: 'Hildesheim 2026–2027 budget',
      filename: budgetFilename,
      ...(localFolder && { path: join(localFolder, budgetFilename) }),
    },
    ...(localFolder && { local: { name: 'Harbour source folder', path: localFolder } }),
    handover: {
      name: 'Harbour Handover folder',
      root: handoverRoot,
      folders: Object.fromEntries(Object.entries(handoverFiles).map(([folder, files]) => {
        const path = join(handoverRoot, folder);
        return [folder, { path, files: files.map(filename => join(path, filename)) }];
      })),
      fundingRegister: {
        folder: '01-Funding',
        filename: fundingRegister,
        path: join(handoverRoot, '01-Funding', fundingRegister),
      },
      classification: 'Simulated internal training records. Separate from the public budget and from RAG.',
    },
    ...(driveFolder && { drive: { name: 'Harbour Funding', url: driveFolder } }),
    notes: { app: 'Notepad', defaultFilename: 'Harbour funding brief.txt' },
  };
}
