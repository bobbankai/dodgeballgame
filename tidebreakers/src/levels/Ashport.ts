// Chapter 2 — Ashport (being written).
import { Level } from './Level';
import { GULLS_LOOK } from './GullsRest';

export class Ashport extends Level {
  readonly id = 'ashport';
  readonly beats = ['start'];
  async build(): Promise<void> { this.setLook(GULLS_LOOK); }
  async script(): Promise<void> {
    await this.dir.card('CHAPTER 2', 'Ashport', '');
  }
}
