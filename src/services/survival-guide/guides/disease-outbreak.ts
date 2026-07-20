import type { SurvivalGuide } from '../guide-types';

export const DISEASE_OUTBREAK_GUIDE: SurvivalGuide = {
  id: 'disease_outbreak',
  kind: 'hazard',
  title: 'Disease Outbreak',
  summary:
    'A localized or widespread infectious disease event, from a seasonal surge to a novel ' +
    'pathogen. The fundamentals barely change across outbreaks: hand hygiene, staying home ' +
    'when sick, and following official public-health guidance rather than rumor. A basic ' +
    'buffer of medication and a plan to isolate a sick household member go a long way.',
  signs: [
    'Local or national public-health alert about a rising case count or new pathogen',
    'CDC, WHO, or local health department guidance recommending precautions',
    'Visible community impact: school/workplace closures, hospital strain reports',
    'Symptoms consistent with the outbreak appearing in your household or community',
  ],
  prepare: [
    { label: 'Maintain a 2-4 week supply of regular medications', detail: 'Pharmacy access and supply chains can be disrupted during a significant outbreak — don\'t let a refill lapse during one.' },
    { label: 'Plan a sick-room isolation setup', detail: 'Identify a room and bathroom a sick household member can use to reduce exposure to others.' },
    { label: 'Stock hygiene supplies', detail: 'Soap, hand sanitizer, and masks — hand hygiene remains one of the most effective, low-cost protections.' },
    { label: 'Bookmark a trusted information source', detail: 'CDC and your local health department, not social media, should drive your decisions.' },
  ],
  during: [
    { label: 'Follow official public-health guidance for your area', detail: 'Recommendations vary by pathogen and local conditions — defer to CDC/WHO/local health authorities over rumor.' },
    { label: 'Practice hand hygiene and respiratory etiquette', detail: 'Wash hands frequently, cover coughs, and avoid touching your face — simple and consistently effective.' },
    { label: 'Stay home when sick', detail: 'This is the single most effective thing an individual can do to slow spread to others.' },
    { label: 'Isolate a sick household member where possible', detail: 'Use the sick-room plan; separate dishes, towels, and bedding if feasible.' },
  ],
  after: [
    { label: 'Continue monitoring official guidance as the situation evolves', detail: 'Recommendations change as outbreaks develop — don\'t assume day-one guidance is still current.' },
    { label: 'Restock medication, hygiene, and isolation supplies used', detail: 'Be ready for a possible second wave or a different outbreak.' },
    { label: 'Check on vulnerable neighbors and family', detail: 'The elderly, immunocompromised, and very young are typically at highest risk.' },
  ],
  recovery: [
    'Follow medical guidance on returning to normal activity after illness.',
    'Restock the medication and hygiene buffer to full before the next season or event.',
  ],
  mistakes: [
    'Relying on social media rumor instead of CDC/WHO/local health department guidance.',
    'Going to work or school while symptomatic "because it\'s probably nothing."',
    'Letting a chronic medication supply run down with no buffer during an active outbreak.',
    'Panic-buying medical supplies that first responders and vulnerable patients need more urgently.',
  ],
  checklist: [
    { id: 'disease_outbreak.med_supply', label: '2-4 week medication supply on hand', weight: 3 },
    { id: 'disease_outbreak.sick_room', label: 'Sick-room isolation plan identified', weight: 2 },
    { id: 'disease_outbreak.hygiene_supplies', label: 'Hygiene supplies (soap, sanitizer, masks) stocked', weight: 2 },
    { id: 'disease_outbreak.trusted_source', label: 'Trusted info source (CDC/local health dept) bookmarked', weight: 1 },
  ],
  relatedGuides: ['first_aid_basics', 'shelter_in_place'],
  sources: ['CDC', 'Ready.gov — Pandemic', 'World Health Organization'],
};
