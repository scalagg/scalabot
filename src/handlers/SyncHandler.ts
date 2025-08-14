import { Message, Events } from 'discord.js';
import { sentryService } from '../services/SentryService';
import { syncService } from '../services/SyncService';
import { serverUtils } from '../utils/ServerUtils';
import { config } from '../config/config';

export class SyncHandler {
    private syncChannelId: string = config.syncChannelId || ''; // Use config or empty string for auto-creation
    private syncPrefix: string = '!';

    public handleMessage(message: Message): void {
        try {
            // Ignore bot messages
            if (message.author.bot) return;

            // Check if message is in sync channel
            if (message.channel.id !== this.syncChannelId) return;

            // Check if user is already performing sync
            if (syncService.isPerforming(message.author.id)) {
                message.delete().catch(() => {});
                return;
            }

            const content = message.content.trim();

            // Check if it's a sync command
            if (!content.startsWith(`${this.syncPrefix}sync `)) {
                message.delete().catch(() => {});
                syncService.sendTemporaryMessage(
                    message.channel as any,
                    `Usage: ${this.syncPrefix}sync <code> ${message.author}`,
                    5000
                );
                return;
            }

            // Delete the message
            message.delete().catch(() => {});

            // Extract the code
            const code = content.substring(6).trim();

            if (!code || code.length !== 8) {
                syncService.sendTemporaryMessage(
                    message.channel as any,
                    `Invalid code format. Please provide an 8-digit code ${message.author}`,
                    5000
                );
                return;
            }

            // Start sync process
            this.processSync(message, code);

        } catch (error) {
            console.error('[SyncHandler] Error handling message:', error);
            sentryService.captureException(error as Error, {
                context: 'sync_message_handler',
                user_id: message.author.id,
                guild_id: message.guild?.id,
                channel_id: message.channel.id
            });
        }
    }

    private async processSync(message: Message, code: string): Promise<void> {
        try {
            syncService.addPerforming(message.author.id);

            const request = {
                code: code,
                discordId: message.author.id,
                timestamp: Date.now(),
                discriminator: message.author.discriminator || '0'
            };

            const response = await syncService.requestSync(request);

            if (!response) {
                syncService.sendTemporaryMessage(
                    message.channel as any,
                    `❌ Failed to sync account. Please try again later ${message.author}`,
                    5000
                );
                return;
            }

            if (!response.success) {
                syncService.sendTemporaryMessage(
                    message.channel as any,
                    `❌ This code is invalid ${message.author}`,
                    5000
                );
                return;
            }

            const syncData = response.value;
            let responseMessage = `✅ Your account has been synced to **${syncData.username}**!`;

            // Add role if provided
            if (syncData.role && message.guild) {
                const member = message.guild.members.cache.get(message.author.id);
                if (member) {
                    const success = await syncService.addRoleToMember(member, syncData.role);
                    if (success) {
                        const role = message.guild.roles.cache.get(syncData.role);
                        responseMessage = `✅ Your account has been synced to **${syncData.username}**, and you received **${role?.name}** role!`;
                    }
                }
            }

            syncService.sendTemporaryMessage(
                message.channel as any,
                responseMessage,
                5000
            );

        } catch (error) {
            console.error('[SyncHandler] Error processing sync:', error);
            sentryService.captureException(error as Error, {
                context: 'sync_process',
                user_id: message.author.id,
                guild_id: message.guild?.id,
                code: code
            });

            syncService.sendTemporaryMessage(
                message.channel as any,
                `❌ An error occurred during sync. Please try again later ${message.author}`,
                5000
            );
        } finally {
            syncService.removePerforming(message.author.id);
        }
    }

    public async setupSyncChannel(guild: any): Promise<void> {
        try {
            let syncChannel = guild.channels.cache.get(this.syncChannelId);

            // Create sync channel if it doesn't exist
            if (!syncChannel) {
                syncChannel = await guild.channels.create({
                    name: '💻sync',
                    type: 0, // Text channel
                    permissionOverwrites: [
                        {
                            id: guild.id, // @everyone
                            deny: ['SendMessages'],
                            allow: ['ViewChannel', 'ReadMessageHistory']
                        }
                    ]
                });
                this.syncChannelId = syncChannel.id;
                console.log(`[SyncHandler] Created sync channel: ${syncChannel.name} (${syncChannel.id})`);
            }

            // Check if channel is empty and send sync embed
            const messages = await syncChannel.messages.fetch({ limit: 1 });
            if (messages.size === 0) {
                const syncEmbed = syncService.createSyncEmbed();
                await syncChannel.send({ embeds: [syncEmbed] });
                console.log(`[SyncHandler] Sent sync embed to channel: ${syncChannel.name}`);
            }

        } catch (error) {
            console.error('[SyncHandler] Error setting up sync channel:', error);
            sentryService.captureException(error as Error, {
                context: 'sync_channel_setup',
                guild_id: guild.id
            });
        }
    }
}

export const syncHandler = new SyncHandler();
