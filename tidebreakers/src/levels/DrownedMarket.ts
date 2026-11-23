// Chapter 3 — The Drowned Market (being written).
import { Level } from './Level';
import { GULLS_LOOK } from './GullsRest';

export class DrownedMarket extends Level {
  readonly id = 'market';
  readonly beats = ['start'];
  async build(): Promise<void> { this.setLook(GULLS_LOOK); }
  async script(): Promise<void> {
    await this.dir.card('CHAPTER 3', 'The Drowned Market', '');
  }
}
