// Chapter 5 — The Sunken Crown (being written).
import { Level } from './Level';
import { GULLS_LOOK } from './GullsRest';

export class SunkenCrown extends Level {
  readonly id = 'crown';
  readonly beats = ['start'];
  async build(): Promise<void> { this.setLook(GULLS_LOOK); }
  async script(): Promise<void> {
    await this.dir.card('CHAPTER 5', 'The Sunken Crown', '');
  }
}
