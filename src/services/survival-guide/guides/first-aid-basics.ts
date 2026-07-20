import type { SurvivalGuide } from '../guide-types';

export const FIRST_AID_BASICS_GUIDE: SurvivalGuide = {
  id: 'first_aid_basics',
  kind: 'preparedness',
  title: 'First Aid Basics',
  summary:
    'The knowledge and supplies to keep someone alive and stable until professional help ' +
    'arrives or you can reach it. Severe bleeding and cardiac arrest kill in minutes, faster ' +
    'than an ambulance can usually respond — knowing how to control bleeding, perform CPR, ' +
    'and recognize shock, stroke, and heart attack is the difference a bystander can make.',
  signs: [
    'An injury, sudden collapse, or medical event in your household or nearby',
    'A disaster that has caused physical injuries (severe weather, structural collapse, vehicle accident)',
    'You realize your first-aid kit is unstocked, expired, or you\'ve never opened it',
    'Nobody in the household has current CPR or first-aid training',
  ],
  prepare: [
    { label: 'Stock and check a first-aid kit regularly', detail: 'Bandages, gauze, tape, antiseptic, gloves, and any household-specific items — check and restock at least twice a year.' },
    { label: 'Add dedicated bleeding-control supplies', detail: 'Trauma dressings and a commercial tourniquet; severe bleeding can be fatal in minutes, faster than most kits are equipped for.' },
    { label: 'Get trained in CPR and basic first aid', detail: 'A one-day American Red Cross or equivalent course teaches hands-on skills that reading alone cannot replace.' },
    { label: 'Keep a written medication and allergy list for everyone in the household', detail: 'Responders and ER staff need this immediately — do not rely on memory under stress.' },
    { label: 'Know your nearest ER and urgent care before you need them', detail: 'Confirm the route and roughly how long it takes so you\'re not searching for it during an emergency.' },
  ],
  during: [
    { label: 'Control severe bleeding first', detail: 'Apply firm, direct pressure with gauze or cloth; if bleeding continues from a limb, apply a tourniquet high and tight above the wound.' },
    { label: 'Call for emergency help immediately for anything life-threatening', detail: 'Start care while help is en route — do not delay calling to attempt care alone first.' },
    { label: 'Start CPR immediately if someone is unresponsive and not breathing normally', detail: 'Push hard and fast in the center of the chest; do not wait for a defibrillator to start compressions.' },
    { label: 'Recognize the signs of shock, stroke, and heart attack', detail: 'Shock: pale, clammy, rapid pulse. Stroke: face drooping, arm weakness, speech difficulty — act fast. Heart attack: chest pressure, pain radiating to arm/jaw, shortness of breath.' },
    { label: 'Keep the person still and calm while help arrives', detail: 'Unnecessary movement can worsen injuries, especially with a suspected spinal or fracture injury.' },
  ],
  after: [
    { label: 'Restock anything used from the kit', detail: 'Replace dressings, gloves, and supplies before the kit is needed again.' },
    { label: 'Follow up on any injury that seemed minor at the time', detail: 'Some injuries (concussions, internal bleeding) don\'t show full symptoms immediately.' },
  ],
  recovery: [
    'Debrief what supplies or skills were missing and close the gap.',
    'Renew CPR/first-aid certification before it expires.',
    'Update the medication and allergy list if anything changed.',
  ],
  mistakes: [
    'Hesitating to start CPR out of fear of doing it wrong — some action is better than none for someone in cardiac arrest.',
    'Applying a tourniquet loosely "to not hurt them" — it must be tight enough to actually stop arterial bleeding.',
    'Never actually training, so the first time anyone uses the kit is during a real emergency.',
    'Letting the kit expire or run down without anyone noticing.',
  ],
  checklist: [
    { id: 'first_aid_basics.kit_stocked', label: 'Stocked, current first-aid kit', weight: 3 },
    { id: 'first_aid_basics.bleeding_control', label: 'Bleeding-control supplies (tourniquet, trauma dressing)', weight: 3 },
    { id: 'first_aid_basics.cpr_training', label: 'At least one household member CPR-trained', weight: 2 },
    { id: 'first_aid_basics.med_list', label: 'Medication + allergy list on hand', weight: 2 },
    { id: 'first_aid_basics.nearest_er', label: 'Nearest ER / urgent care known', weight: 1 },
  ],
  relatedGuides: ['disease_outbreak', 'go_bag'],
  sources: ['American Red Cross', 'CDC', 'Ready.gov'],
};
