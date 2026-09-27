import type { QualityProfile } from '../../config/quality';
import type { Arena } from '../Arena';
import { buildGym, GymStyle } from './Gym';
import { buildStreet } from './Street';
import { buildRooftop } from './Rooftop';
import { buildUnderground } from './Underground';
import { buildStadium } from './Stadium';
import { buildEclipse } from './Eclipse';

const REC: GymStyle = {
  id: 'rec',
  name: 'Maplewood Rec Center',
  location: 'Maplewood, Eastside',
  tagline: 'Where it all starts.',
  wallLower: '#274472',
  wallUpper: '#e9e2d0',
  stripe: '#e0452c',
  logo: 'MAPLEWOOD',
  logoSub: 'RECREATION CENTER',
  homeTint: '#27e0d0',
  awayTint: '#ff4a3a',
  crowdDensity: 0.22,
  crowdPalette: [0x3b5b92, 0x8c3b3b, 0x4c7a4c, 0xd9c49a, 0x5a5a66, 0xc97a2e, 0x2e6f73],
  banners: [
    { title: 'REC LEAGUE CHAMPS', sub: '2019 · 2021', bg: '#274472', fg: '#f4efe3' },
    { title: 'PLAY FAIR PLAY HARD', sub: 'MAPLEWOOD REC', bg: '#e0452c', fg: '#fff5e8' },
    { title: 'YOUTH DODGE', sub: 'SATURDAYS 10AM', bg: '#2d6a4f', fg: '#f4efe3' },
    { title: 'NO HANGING ON RIMS', sub: 'MANAGEMENT', bg: '#f4efe3', fg: '#274472' },
  ],
  ads: [
    { text: "GUS'S PIZZA", bg: '#c0392b', fg: '#fff3dc' },
    { text: 'MAPLEWOOD REC', bg: '#274472', fg: '#f4efe3' },
    { text: 'BRIGHT SMILE DENTAL', bg: '#f4efe3', fg: '#274472' },
    { text: 'LEAGUE NIGHT · THURS', bg: '#e0452c', fg: '#1b1b22' },
    { text: 'EASTSIDE HARDWARE', bg: '#2d6a4f', fg: '#f4efe3' },
    { text: 'SPLASH CAR WASH', bg: '#1d6fa5', fg: '#ffffff' },
  ],
  homeName: 'HOME',
  awayName: 'GUEST',
  evening: false,
  bleacherRows: 5,
  hw: 6.5,
  hl: 10,
};

const SCHOOL: GymStyle = {
  ...REC,
  id: 'school',
  name: 'Westbrook High Fieldhouse',
  location: 'Westbrook District',
  tagline: 'Regional Invitational',
  wallLower: '#3b2a6e',
  wallUpper: '#ece7da',
  stripe: '#f2c94c',
  logo: 'WESTBROOK',
  logoSub: 'REGIONAL INVITATIONAL',
  homeTint: '#27e0d0',
  awayTint: '#8b5cf6',
  crowdDensity: 0.85,
  crowdPalette: [0x5b3fb8, 0xf2c94c, 0x5b3fb8, 0xf5f5f5, 0x2e7d32, 0x5b3fb8, 0xf2c94c, 0x3b3b44],
  banners: [
    { title: 'WOLVES STATE FINALISTS', sub: '2022', bg: '#3b2a6e', fg: '#f2c94c' },
    { title: 'REGIONAL INVITATIONAL', sub: 'DODGEBALL', bg: '#f2c94c', fg: '#3b2a6e' },
    { title: 'GO WOLVES', sub: 'WESTBROOK HIGH', bg: '#3b2a6e', fg: '#ffffff' },
    { title: 'EAGLES NEST', sub: 'VISITORS', bg: '#2e7d32', fg: '#ffffff' },
  ],
  ads: [
    { text: 'WESTBROOK WOLVES', bg: '#3b2a6e', fg: '#f2c94c' },
    { text: 'VARSITY SPORTS CO.', bg: '#f2c94c', fg: '#231a44' },
    { text: 'REGIONALS', bg: '#ece7da', fg: '#3b2a6e' },
    { text: 'BOOSTER CLUB', bg: '#7a2e2e', fg: '#ffffff' },
    { text: 'CITY TRANSIT', bg: '#1d4e89', fg: '#ffffff' },
    { text: 'FRESH MART', bg: '#2e7d32', fg: '#ffffff' },
  ],
  homeName: 'OVERTHROW',
  awayName: 'VISITOR',
  evening: true,
  bleacherRows: 8,
};

export interface CourtSize {
  halfWidth: number;
  halfLength: number;
}

export const ARENA_BUILDERS: Record<string, (q: QualityProfile, c: CourtSize | null) => Arena> = {
  rec: (q, c) => buildGym({ ...REC, hw: c?.halfWidth ?? REC.hw, hl: c?.halfLength ?? REC.hl }, q),
  school: (q, c) => buildGym({ ...SCHOOL, hw: c?.halfWidth ?? SCHOOL.hw, hl: c?.halfLength ?? SCHOOL.hl }, q),
  street: (q, c) => buildStreet(q, c?.halfWidth ?? 6.5, c?.halfLength ?? 10),
  rooftop: (q, c) => buildRooftop(q, c?.halfWidth ?? 6.5, c?.halfLength ?? 10),
  underground: (q, c) => buildUnderground(q, c?.halfWidth ?? 6.5, c?.halfLength ?? 10),
  stadium: (q, c) => buildStadium(q, c?.halfWidth ?? 6.5, c?.halfLength ?? 10),
  eclipse: (q, c) => buildEclipse(q, c?.halfWidth ?? 6.5, c?.halfLength ?? 10),
};

export function buildArena(id: string, q: QualityProfile, court: CourtSize | null = null): Arena {
  const b = ARENA_BUILDERS[id] ?? ARENA_BUILDERS.rec;
  return b(q, court);
}
