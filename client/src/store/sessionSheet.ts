import { atomFamily } from 'recoil';

/** Mobile SessionSheet open state, keyed by chat index. */
const sessionSheetOpenByIndex = atomFamily<boolean, string | number>({
  key: 'sessionSheetOpenByIndex',
  default: false,
});

export default {
  sessionSheetOpenByIndex,
};
