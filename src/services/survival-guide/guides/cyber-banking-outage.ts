import type { SurvivalGuide } from '../guide-types';

export const CYBER_BANKING_OUTAGE_GUIDE: SurvivalGuide = {
  id: 'cyber_banking_outage',
  kind: 'hazard',
  title: 'Cyber / Banking Outage',
  summary:
    'A disruption to card networks, banking systems, or a cyberattack on financial ' +
    'infrastructure that leaves cards and ATMs unreliable for hours to days. A small cash ' +
    'reserve turns an inconvenience into a non-event. The other major risk is not the ' +
    'outage itself but the scam wave that follows it — attackers impersonate banks with ' +
    '"your account is locked, click here" messages during exactly this kind of event.',
  signs: [
    'Card declines, ATM failures, or banking app outages reported widely, not just for you',
    'Official notice from your bank or a payment network about a system disruption',
    'News reports of a cyberattack or major outage affecting financial infrastructure',
    'A surge of unsolicited "your account is locked" texts, calls, or emails during a known outage',
  ],
  prepare: [
    { label: 'Keep a small cash reserve on hand', detail: 'Enough for a few days of essentials — fuel and groceries are the first things to become hard to buy when card systems are down.' },
    { label: 'Keep an offline record of key account and contact info', detail: 'Bank phone numbers, account numbers, and emergency contacts written down or saved offline — not only in an app that needs connectivity.' },
    { label: 'Maintain a secondary payment method', detail: 'A card from a different bank or network reduces the chance a single outage locks you out completely.' },
    { label: 'Enable multi-factor authentication on financial accounts', detail: 'MFA limits the damage if credentials are exposed during a breach tied to the outage.' },
  ],
  during: [
    { label: 'Use your cash reserve for essential purchases', detail: 'Don\'t assume card systems will recover quickly — plan for the outage to last through your immediate needs.' },
    { label: 'Verify "account locked" messages independently — never click the link', detail: 'Call your bank using a number you already have on file, not one from the message itself.' },
    { label: 'Avoid entering banking credentials on any page reached via an unsolicited link or call', detail: 'Scammers specifically target outage confusion; go directly to your bank\'s known app or site instead.' },
    { label: 'Track which merchants and services are still accepting your available payment methods', detail: 'Some systems recover before others — adapt rather than assuming a total blackout.' },
  ],
  after: [
    { label: 'Review account statements for unauthorized activity', detail: 'Outages and the scams that follow them are a common window for fraud — check closely once systems are back.' },
    { label: 'Change passwords if you interacted with any suspicious message', detail: 'Even if you didn\'t enter details, treat any click on a suspicious link as a signal to rotate credentials.' },
    { label: 'Replenish your cash reserve', detail: 'Restore the buffer you used so you\'re ready for the next disruption.' },
  ],
  recovery: [
    'Report any fraud or phishing attempts to your bank and to the FTC/IC3.',
    'Reassess your cash reserve and secondary payment method for adequacy.',
  ],
  mistakes: [
    'Clicking a link in an unsolicited "your account is locked" message during the outage.',
    'Having no cash on hand and no plan for when cards simply don\'t work.',
    'Giving out banking credentials over the phone to an unverified caller claiming to be the bank.',
    'Assuming a single bank or card network outage means all payment methods are down.',
  ],
  checklist: [
    { id: 'cyber_banking_outage.cash_reserve', label: 'Cash reserve on hand', weight: 3 },
    { id: 'cyber_banking_outage.offline_records', label: 'Offline record of key accounts/contacts', weight: 1 },
    { id: 'cyber_banking_outage.secondary_payment', label: 'Secondary payment method available', weight: 2 },
    { id: 'cyber_banking_outage.mfa', label: 'MFA enabled on financial accounts', weight: 2 },
  ],
  relatedGuides: ['power_grid_outage'],
  sources: ['CISA', 'FDIC — Consumer Guidance', 'Ready.gov'],
};
