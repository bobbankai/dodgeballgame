/**
 * Vital statistics with regeneration rules shared by the player and enemies.
 *  - Health: lost to damage; restored by flasks, abilities and level-ups.
 *  - Stamina (player): spent by dodges, sprinting, heavy attacks and blocking; regenerates after a
 *    short delay, slower while blocking.
 *  - Poise: depleted by poise damage; at zero the actor staggers (and enemies become executable);
 *    regenerates after not being hit for a while.
 *  - Aether (player): fuels divine abilities; gained by landing hits, parries and executions.
 */
export class Stats {
  maxHealth: number;
  health: number;
  maxStamina: number;
  stamina: number;
  maxPoise: number;
  poise: number;
  maxAether: number;
  aether: number;
  staminaRegen = 38;
  staminaDelay = 0.6;
  poiseRegen = 22;
  poiseDelay = 2.2;
  /** Damage multipliers by element (resistances). */
  resist: Partial<Record<string, number>> = {};
  private staminaCooldown = 0;
  private poiseCooldown = 0;
  /** Time since last damage (for UI health-bar trailing). */
  sinceHit = 99;
  /** Trailing health for the UI's "chip" bar. */
  displayed: number;

  constructor(o: { health: number; stamina?: number; poise?: number; aether?: number }) {
    this.maxHealth = this.health = this.displayed = o.health;
    this.maxStamina = this.stamina = o.stamina ?? 100;
    this.maxPoise = this.poise = o.poise ?? 50;
    this.maxAether = o.aether ?? 100;
    this.aether = 0;
  }

  get alive(): boolean {
    return this.health > 0;
  }

  get healthFrac(): number {
    return this.health / this.maxHealth;
  }

  damage(amount: number): number {
    const d = Math.min(this.health, Math.max(0, amount));
    this.health -= d;
    this.sinceHit = 0;
    return d;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Returns true when poise breaks with this hit. */
  poiseDamage(amount: number): boolean {
    if (this.poise <= 0) return false;
    this.poise = Math.max(0, this.poise - amount);
    this.poiseCooldown = this.poiseDelay;
    return this.poise <= 0;
  }

  resetPoise(): void {
    this.poise = this.maxPoise;
  }

  /** Spends stamina; returns false (and spends nothing) if there is not enough. */
  spend(amount: number, allowNegative = false): boolean {
    if (this.stamina <= 0 || (!allowNegative && this.stamina < amount * 0.5)) return false;
    this.stamina -= amount;
    this.staminaCooldown = this.staminaDelay;
    return true;
  }

  drain(amount: number): void {
    this.stamina = Math.max(-20, this.stamina - amount);
    this.staminaCooldown = this.staminaDelay;
  }

  gainAether(v: number): void {
    this.aether = Math.min(this.maxAether, this.aether + v);
  }

  useAether(v: number): boolean {
    if (this.aether < v) return false;
    this.aether -= v;
    return true;
  }

  update(dt: number, regenScale = 1): void {
    this.sinceHit += dt;
    // regeneration resumes for whatever part of this step remains after the delay runs out
    const st = Math.max(0, dt - Math.max(0, this.staminaCooldown));
    this.staminaCooldown = Math.max(0, this.staminaCooldown - dt);
    if (st > 0) this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * regenScale * st);
    const pt = Math.max(0, dt - Math.max(0, this.poiseCooldown));
    this.poiseCooldown = Math.max(0, this.poiseCooldown - dt);
    if (pt > 0) this.poise = Math.min(this.maxPoise, this.poise + this.poiseRegen * pt);
    // the UI's trailing bar catches up after a short pause
    if (this.displayed > this.health) {
      if (this.sinceHit > 0.6) this.displayed = Math.max(this.health, this.displayed - this.maxHealth * 0.6 * dt);
    } else {
      this.displayed = this.health;
    }
  }
}
