// `bun test lib`: the place check against lines as job boards really write them.
import { expect, test } from 'bun:test';
import { nearby } from './place.ts';

const passes = ['', 'Remote', 'Anywhere', 'Remote, Global', 'New York, NY', 'NYC', 'New York, NY, hybrid', 'Stamford, CT', 'Jersey City, NJ', 'Remote - New York',
  'San Francisco, CA | New York City, NY', 'Northeast - United States', 'United States', 'United States (Remote)', 'Remote - USA', 'Remote - US: Select locations',
  'Any location, United States', 'Canada; United States', 'Europe or US', 'Remote (United States | Canada), Remote', 'Home Based - Americas; Home based - EMEA',
  'San Francisco, Remote', 'Austin, TX, Remote', 'San Francisco HQ; Toronto Hub, Remote', 'New Mexico, United States, Remote'];
const fails = ['London, Remote', 'Berlin Office, Remote', 'Singapore, Remote', 'Nantes, Remote', 'Ciudad de México, Remote', 'Toronto, Ontario, Canada, Remote',
  'Remote Canada', 'Remote - India', 'Remote - Mexico', 'Remote, KSA', 'Europe, Remote', 'Remote: EMEA', 'Anywhere in France, Belgium, Spain', 'CAN: Vancouver (333 Seymour St), Remote',
  'Long Beach, California, United States', 'San Mateo, CA, United States', 'San Francisco, CA - US', 'San Francisco, hybrid', 'Colorado, USA', 'Buffalo, New York',
  'Remote - Texas', 'Remote - CA', 'Remote - OR', 'Remote - Seattle', 'Florida-Remote', 'Remote - AZ; Remote - CO; Remote - NM'];

test('a place in or near New York, or remote and open to the United States, passes', () => {
  for (const p of passes) expect([p, nearby(p)]).toEqual([p, true]);
});
test('a far office, remote work abroad and remote work held to other states do not pass', () => {
  for (const p of fails) expect([p, nearby(p)]).toEqual([p, false]);
});
