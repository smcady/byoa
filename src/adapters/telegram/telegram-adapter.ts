import { Bot } from 'grammy';
import type { ChannelManager } from '../../channel/channel-manager.js';
import type { ChannelStore } from '../../channel/channel-store.js';
import type { Message } from '../../types/channel.js';
import type { PlatformAdapter } from '../adapter-interface.js';
import { hashToken } from '../../auth/tokens.js';

export interface TelegramBinding {
  /** Telegram chat ID (group or supergroup) */
  chatId: number;
  /** Agora channel ID */
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
  /** Track participant IDs for Telegram users (chatId:userId -> participantId) */
  private telegramParticipants = new Map<string, string>();
  private eventCleanups: Array<() => void> = [];

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
      const store = this.channelManager.getOrLoad(binding.channelId);
      this.bindings.set(binding.chatId, { channelId: binding.channelId, store });
      this.reverseBindings.set(binding.channelId, binding.chatId);
    }

    // Telegram → Agora: forward incoming messages to channel
    this.bot.on('message:text', async (ctx) => {
      const chatId = ctx.chat.id;
      const binding = this.bindings.get(chatId);
      if (!binding) return; // Message from unbound chat — ignore

      const telegramUser = ctx.from;
      if (!telegramUser || telegramUser.is_bot) return;

      // Get or create participant for this Telegram user
      const participantId = this.ensureParticipant(binding.store, chatId, telegramUser);
      binding.store.addMessage(participantId, ctx.message.text);
    });

    // Agora → Telegram: forward channel messages to Telegram
    for (const [chatId, { channelId, store }] of this.bindings) {
      const handler = (message: Message) => {
        // Don't echo back messages that came from Telegram
        const senderKey = `${chatId}:${message.participantId}`;
        if (this.telegramParticipants.has(senderKey)) return;

        const name = message.displayName ?? message.participantId;
        const role = message.agentName ? `${message.agentName}` : message.participantType ?? 'unknown';
        const formatted = `<b>${this.escapeHtml(name)}</b> <i>[${this.escapeHtml(role)}]</i>\n${this.escapeHtml(message.content)}`;

        this.bot.api.sendMessage(chatId, formatted, { parse_mode: 'HTML' }).catch((err) => {
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
      },
    });
  }

  async stop(): Promise<void> {
    for (const cleanup of this.eventCleanups) cleanup();
    this.eventCleanups = [];
    this.bot.stop();
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
    return participant.id;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
