// Chapter 4 — The Weeping Shoals (being written).
import { Level } from './Level';
import { GULLS_LOOK } from './GullsRest';

export class WeepingShoals extends Level {
  readonly id = 'shoals';
  readonly beats = ['start'];
  async build(): Promise<void> { this.setLook(GULLS_LOOK); }
  async script(): Promise<void> {
    await this.dir.card('CHAPTER 4', 'The Weeping Shoals', '');
  }
}
