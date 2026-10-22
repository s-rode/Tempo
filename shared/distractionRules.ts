import { ActiveWindowDetails } from './types';

export const isVeryLikelyProductive = (windowDetails: ActiveWindowDetails) => {
  return (
    alwaysProductiveSites.includes(windowDetails.url || '') ||
    alwaysProductiveOwners.includes(windowDetails.ownerName)
  );
};

export const alwaysProductiveSites = [
  'cursor.com',
  'us-east-1.console.aws.amazon.com',
  'figma.com',
];

export const alwaysProductiveOwners = [
  'Cursor',
  'Toggl Track',
  'MongoDB Compass',
  'Postman',
  '1Password',
  'Electron',
];
