import { type FaqRow, MonshiDb } from './db';

/** Per-request cache of settings / app_state / FAQs / active connection (rule R2). */
export class MonshiContext {
  private settings = new Map<string, string>();
  private state = new Map<string, string>();
  private loaded = false;
  private faqs?: FaqRow[];
  private conn?: { business_connection_id: string; owner_user_id: number } | null;

  constructor(readonly db: MonshiDb, private readonly ownerUserId: number) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const { settings, state } = await this.db.loadSettingsAndState();
    this.settings = settings;
    this.state = state;
    this.loaded = true;
  }

  async getSetting(key: string): Promise<string | null> {
    await this.load();
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.load();
    await this.db.setSetting(key, value);
    this.settings.set(key, value);
  }

  async getState(key: string): Promise<string | null> {
    await this.load();
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    await this.load();
    await this.db.setAppState(key, value);
    this.state.set(key, value);
  }

  async getEnabledFaqs(): Promise<FaqRow[]> {
    if (!this.faqs) this.faqs = await this.db.getEnabledFaqs();
    return this.faqs;
  }

  invalidateFaqs(): void {
    this.faqs = undefined;
  }

  async getConnection() {
    if (this.conn === undefined) this.conn = await this.db.getActiveConnection(this.ownerUserId);
    return this.conn;
  }

  invalidateConnection(): void {
    this.conn = undefined;
  }

  async getBusinessHours(): Promise<Record<string, string | null>> {
    return JSON.parse((await this.getSetting('business_hours')) || '{}');
  }

  async setBusinessHours(hours: Record<string, string | null>): Promise<void> {
    await this.setSetting('business_hours', JSON.stringify(hours));
  }
}
