import type { Intent, RoomState, Session } from '../../shared/protocol';
import type { ClientView, Connection } from '../network';
import type { Settings } from '../settings';

export interface GameScreenProps<R extends RoomState> {
  room: R;
  session: Session;
  connection: Connection;
  queue: ClientView['queue'];
  settings: Settings;
  error?: string | null;
  onIntent: (intent: Intent) => void;
}
