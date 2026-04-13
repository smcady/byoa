import { Bot } from 'grammy';
import type { ChannelManager } from '../../channel/channel-manager.js';
import type { ChannelStore } from '../../channel/channel-store.js';
import type { Message } from '../../types/channel.js';
import type { PlatformAdapter } from '../adapter-interface.js';
import { hashToken } from '../../auth/tokens.js';

export interface TelegramBinding {
  /** Telegram chat ID (group or supergroup) */
  chatId: number;
  /** BYOA channel ID */
  channelId: string;
}

export interface TelegramAdapterConfig {
  botToken: string;
  bindings: TelegramBinding[];
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram';
  private bot: Bot;
  private bindings: Map<number, { channelId: string; store: ChannelStore }>;
  private reverseBindings: Map<string, number>;
  /** Track participant IDs: chatId:telegramUserId -> byoaParticipantId */
  private telegramParticipants = new Map<string, string>();
  /** Set of BYOA participant IDs that originated from Telegram — for echo suppression */
  private telegramParticipantIds = new Set<string>();
  private eventCleanups: Array<() => void> = [];

  /** Diagnostic stats exposed via getStats() */
  private stats = { messagesReceived: 0, messagesSent: 0, errors: 0, lastError: '' };

  constructor(
    private config: TelegramAdapterConfig,
    private channelManager: ChannelManager
  ) {
    this.bot = new Bot(config.botToken);
    this.bindings = new Map();
    this.reverseBindings = new Map();
  }

  async start(): Promise<void> {
    // Resolve bindings
    for (const binding of this.config.bindings) {
      console.log(`[telegram] Resolving binding: chatId=${binding.chatId} -> channelId=${binding.channelId}`);
      try {
        const store = this.channelManager.getOrLoad(binding.channelId);
        this.bindings.set(binding.chatId, { channelId: binding.channelId, store });
        this.reverseBindings.set(binding.channelId, binding.chatId);
        console.log(`[telegram] Binding resolved successfully`);
      } catch (err) {
        console.error(`[telegram] Failed to resolve binding for channel ${binding.channelId} — skipping:`, err);
        continue;
      }
    }

    // Telegram → BYOA: forward incoming messages to channel
    this.bot.on('message:text', async (ctx) => {
      const chatId = ctx.chat.id;
      const binding = this.bindings.get(chatId);
      if (!binding) {
        console.log(`[telegram] Ignoring message from unbound chat ${chatId}`);
        return;
      }

      const telegramUser = ctx.from;
      if (!telegramUser || telegramUser.is_bot) return;

      this.stats.messagesReceived++;
      console.log(`[telegram] Received message from ${telegramUser.first_name} (tg:${telegramUser.id}) in chat ${chatId}: "${ctx.message.text.slice(0, 50)}..."`);

      try {
        // Get or create participant for this Telegram user
        const participantId = this.ensureParticipant(binding.store, chatId, telegramUser);
        binding.store.addMessage(participantId, ctx.message.text);
        console.log(`[telegram] Message stored as participant ${participantId}`);
      } catch (err) {
        this.stats.errors++;
        this.stats.lastError = String(err);
        console.error(`[telegram] Error processing message from ${telegramUser.first_name}:`, err);
      }
    });

    // BYOA → Telegram: forward channel messages to Telegram
    for (const [chatId, { channelId, store }] of this.bindings) {
      const handler = (message: Message) => {
        // Don't echo back messages that originated from Telegram
        if (this.telegramParticipantIds.has(message.participantId)) return;

        const name = message.displayName ?? message.participantId;
        const role = message.agentName ? `${message.agentName}` : message.participantType ?? 'unknown';
        const formatted = `<b>${this.escapeHtml(name)}</b> <i>[${this.escapeHtml(role)}]</i>\n${this.escapeHtml(message.content)}`;

        this.stats.messagesSent++;
        this.bot.api.sendMessage(chatId, formatted, { parse_mode: 'HTML' }).catch((err) => {
          this.stats.errors++;
          this.stats.lastError = String(err);
          console.error(`[telegram] Failed to send to chat ${chatId}:`, err.message);
        });
      };

      store.on('message:new', handler);
      this.eventCleanups.push(() => store.off('message:new', handler));
    }

    // Start long polling
    this.bot.start({
      onStart: () => {
        console.log(`[telegram] Bot started — ${this.bindings.size} binding(s) active`);
        for (const [chatId, { channelId }] of this.bindings) {
          console.log(`[telegram]   chat ${chatId} <-> ${channelId}`);
        }
      },
    });
  }

  async stop(): Promise<void> {
    for (const cleanup of this.eventCleanups) cleanup();
    this.eventCleanups = [];
    this.bot.stop();
  }

  getStats(): { messagesReceived: number; messagesSent: number; errors: number; lastError: string; bindings: number } {
    return { ...this.stats, bindings: this.bindings.size };
  }

  /**
   * Ensure a Telegram user has a participant record in the channel.
   * Returns the participant ID.
   */
  private ensureParticipant(
    store: ChannelStore,
    chatId: number,
    user: { id: number; first_name: string; last_name?: string; username?: string }
  ): string {
    const key = `${chatId}:${user.id}`;
    const existing = this.telegramParticipants.get(key);
    if (existing) return existing;

    // Check if this Telegram user already has a participant record
    // Use a stable token hash based on platform + user ID
    const stableHash = hashToken(`telegram:${user.id}:${store.channelId}`);
    const found = store.participants.findByTokenHash(stableHash);
    if (found) {
      this.telegramParticipants.set(key, found.id);
      this.telegramParticipantIds.add(found.id);
      console.log(`[telegram] Found existing participant for tg:${user.id} -> ${found.id} (${found.displayName})`);
      return found.id;
    }

    // Create new participant
    const displayName = user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.first_name;

    const participant = store.participants.add({
      userId: `telegram:${user.id}`,
      displayName,
      type: 'human',
      tokenHash: stableHash,
    });

    this.telegramParticipants.set(key, participant.id);
    this.telegramParticipantIds.add(participant.id);
    console.log(`[telegram] Created participant for tg:${user.id} -> ${participant.id} (${displayName})`);
    return participant.id;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
