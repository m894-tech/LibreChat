import { atom } from 'jotai';
import type { ContextCounterMode } from './types';

/**
 * The next ↔ last toggle lives outside the popover so closing the menu keeps
 * the chosen mode (§3). Session-scoped on purpose: a reload starts on «next».
 */
export const contextCounterModeAtom = atom<ContextCounterMode>('next');
