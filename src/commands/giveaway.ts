import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits,
    TextChannel,
    AttachmentBuilder
} from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';
import { giveawayService } from '../services/GiveawayService';
import { generateGiveawayImage } from '../libs/giveawayCanvas';

export const data = new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    .addSubcommand(subcommand =>
        subcommand
            .setName('create')
            .setDescription('Create a new giveaway')
            .addStringOption(option =>
                option
                    .setName('prize')
                    .setDescription('What is being given away')
                    .setRequired(true)
                    .setMaxLength(200)
            )
            .addStringOption(option =>
                option
                    .setName('duration')
                    .setDescription('How long the giveaway should last (e.g., 1h, 30m, 2d)')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option
                    .setName('winners')
                    .setDescription('Number of winners')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(10)
            )
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription('Channel to post the giveaway in')
                    .setRequired(false)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('end')
            .setDescription('End a giveaway early')
            .addStringOption(option =>
                option
                    .setName('message_id')
                    .setDescription('The message ID of the giveaway to end')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('reroll')
            .setDescription('Reroll winners for a giveaway')
            .addStringOption(option =>
                option
                    .setName('message_id')
                    .setDescription('The message ID of the giveaway to reroll')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List active giveaways')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('info')
            .setDescription('Get information about a giveaway')
            .addStringOption(option =>
                option
                    .setName('message_id')
                    .setDescription('The message ID of the giveaway')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('delete')
            .setDescription('Delete a giveaway')
            .addStringOption(option =>
                option
                    .setName('message_id')
                    .setDescription('The message ID of the giveaway to delete')
                    .setRequired(true)
            )
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
        await interaction.reply({
            content: '❌ This command can only be used in a server.',
            ephemeral: true
        });
        return;
    }

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

    // Check if user has manager role
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasManagerRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Manager role required.',
            ephemeral: true
        });
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
        await interaction.deferReply({ ephemeral: true });

        if (subcommand === 'create') {
            await createGiveaway(interaction);
        } else if (subcommand === 'end') {
            await endGiveaway(interaction);
        } else if (subcommand === 'reroll') {
            await rerollGiveaway(interaction);
        } else if (subcommand === 'list') {
            await listGiveaways(interaction);
        } else if (subcommand === 'info') {
            await getGiveawayInfo(interaction);
        } else if (subcommand === 'delete') {
            await deleteGiveaway(interaction);
        }

    } catch (error) {
        console.error('[Giveaway] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function createGiveaway(interaction: ChatInputCommandInteraction) {
    const prize = interaction.options.getString('prize', true);
    const duration = interaction.options.getString('duration', true);
    const winners = interaction.options.getInteger('winners', true);
    const channel = interaction.options.getChannel('channel') as TextChannel || interaction.channel as TextChannel;

    // Parse duration
    const durationMs = giveawayService.parseDuration(duration);
    if (!durationMs) {
        await interaction.editReply({
            content: '❌ Invalid duration format. Use: 30s, 5m, 2h, 1d'
        });
        return;
    }

    // Check if duration is reasonable (between 1 minute and 30 days)
    if (durationMs < 60000 || durationMs > 30 * 24 * 60 * 60 * 1000) {
        await interaction.editReply({
            content: '❌ Duration must be between 1 minute and 30 days.'
        });
        return;
    }

    try {
        // Create the giveaway embed
        const endsAt = Date.now() + durationMs;
        const tempGiveaway = {
            messageId: '', // Will be set after message is sent
            channelId: channel.id,
            guildId: interaction.guildId!,
            prize,
            durationMs,
            winners,
            participants: [],
            endsAt,
            ended: false
        };

        // Generate the canvas image
        const serverType = serverUtils.getServerTypeFromGuildId(interaction.guildId!);
        const imageBuffer = await generateGiveawayImage({
            prize,
            duration,
            server: serverType
        });
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'giveaway.png' });

        const embed = giveawayService.createGiveawayEmbed(tempGiveaway as any);
        embed.setImage('attachment://giveaway.png');

        // Send the giveaway message first
        const message = await channel.send({
            embeds: [embed],
            files: [attachment],
            components: [] // We'll add buttons after creating the database entry
        });

        // Create the giveaway in the database
        const giveaway = await giveawayService.createGiveaway({
            ...tempGiveaway,
            messageId: message.id
        });

        // Now create buttons with the correct message ID and update the message
        const buttons = giveawayService.createGiveawayButtons(giveaway);
        await message.edit({
            embeds: [embed],
            files: [attachment],
            components: [buttons]
        });

        await interaction.editReply({
            content: `✅ Giveaway created successfully! [View Giveaway](${message.url})`
        });

    } catch (error) {
        console.error('[Giveaway] Error creating giveaway:', error);
        await interaction.editReply({
            content: '❌ Failed to create giveaway. Please try again.'
        });
    }
}

async function endGiveaway(interaction: ChatInputCommandInteraction) {
    const messageId = interaction.options.getString('message_id', true);

    try {
        const giveaway = await giveawayService.getGiveawayById(messageId);
        if (!giveaway) {
            await interaction.editReply({
                content: '❌ Giveaway not found.'
            });
            return;
        }

        if (giveaway.ended) {
            await interaction.editReply({
                content: '❌ This giveaway has already ended.'
            });
            return;
        }

        // End the giveaway
        const endedGiveaway = await giveawayService.endGiveaway(messageId);
        if (!endedGiveaway) {
            await interaction.editReply({
                content: '❌ Failed to end the giveaway.'
            });
            return;
        }

        // Update the message
        const channel = await interaction.guild!.channels.fetch(giveaway.channelId) as TextChannel;
        let attachment: AttachmentBuilder | undefined = undefined;
        let winnerImageName = 'giveaway-winner.png';
        if (channel) {
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) {
                const embed = giveawayService.createGiveawayEmbed(endedGiveaway, true);
                // Generate winner image if there are winners
                if (endedGiveaway.winnerIds && endedGiveaway.winnerIds.length > 0) {
                    const serverType = serverUtils.getServerTypeFromGuildId(interaction.guildId!);
                    const winnerTags = endedGiveaway.winnerIds.map(id => `<@${id}>`);
                    const imageBuffer = await generateGiveawayImage({
                        prize: giveaway.prize,
                        server: serverType,
                        winners: winnerTags,
                        isWinner: true
                    });
                    attachment = new AttachmentBuilder(imageBuffer, { name: winnerImageName });
                    embed.setImage(`attachment://${winnerImageName}`);
                    await message.edit({ embeds: [embed], files: [attachment], components: [] });
                } else {
                    await message.edit({ embeds: [embed], components: [] });
                }
            }
        }

        // Send winner announcement
        if (endedGiveaway.winnerIds && endedGiveaway.winnerIds.length > 0) {
            const winnerMentions = endedGiveaway.winnerIds.map(id => `<@${id}>`).join(', ');
            const announcementEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('success'))
                .setTitle('🎉 Giveaway Ended!')
                .setDescription(`Congratulations ${winnerMentions}! You won: **${giveaway.prize}**`)
                .addFields({
                    name: '🎫 How to Claim Your Prize',
                    value: 'Please create a ticket to claim your prize. Include the giveaway message ID in your ticket.',
                    inline: false
                })
                .addFields({
                    name: '📝 Giveaway ID',
                    value: giveaway.messageId,
                    inline: true
                })
                .addFields({
                    name: '⏰ Claim Deadline',
                    value: 'Please claim within 8 hours or the prize may be forfeited.',
                    inline: true
                })
                .setTimestamp()
                .setFooter(serverUtils.getFooter());
            if (attachment) announcementEmbed.setImage(`attachment://${winnerImageName}`);

            await interaction.editReply({
                content: `✅ Giveaway ended! Winners: ${winnerMentions}`,
                embeds: [announcementEmbed],
                files: attachment ? [attachment] : []
            });
        } else {
            await interaction.editReply({
                content: '✅ Giveaway ended! No participants.'
            });
        }

    } catch (error) {
        console.error('[Giveaway] Error ending giveaway:', error);
        await interaction.editReply({
            content: '❌ Failed to end the giveaway.'
        });
    }
}

async function rerollGiveaway(interaction: ChatInputCommandInteraction) {
    const messageId = interaction.options.getString('message_id', true);

    try {
        const giveaway = await giveawayService.getGiveawayById(messageId);
        if (!giveaway) {
            await interaction.editReply({
                content: '❌ Giveaway not found.'
            });
            return;
        }

        if (!giveaway.ended) {
            await interaction.editReply({
                content: '❌ This giveaway has not ended yet.'
            });
            return;
        }

        // Reroll the giveaway
        const rerolledGiveaway = await giveawayService.rerollGiveaway(messageId);
        if (!rerolledGiveaway) {
            await interaction.editReply({
                content: '❌ Failed to reroll the giveaway.'
            });
            return;
        }

        // Update the message
        const channel = await interaction.guild!.channels.fetch(giveaway.channelId) as TextChannel;
        let attachment: AttachmentBuilder | undefined = undefined;
        let rerollImageName = 'giveaway-reroll.png';
        if (channel) {
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) {
                const embed = giveawayService.createGiveawayEmbed(rerolledGiveaway, true);
                if (rerolledGiveaway.winnerIds && rerolledGiveaway.winnerIds.length > 0) {
                    const serverType = serverUtils.getServerTypeFromGuildId(interaction.guildId!);
                    const winnerTags = rerolledGiveaway.winnerIds.map(id => `<@${id}>`);
                    const imageBuffer = await generateGiveawayImage({
                        prize: giveaway.prize,
                        server: serverType,
                        winners: winnerTags,
                        isWinner: true,
                        isReroll: true
                    });
                    attachment = new AttachmentBuilder(imageBuffer, { name: rerollImageName });
                    embed.setImage(`attachment://${rerollImageName}`);
                    await message.edit({ embeds: [embed], files: [attachment], components: [] });
                } else {
                    await message.edit({ embeds: [embed], components: [] });
                }
            }
        }

        // Send reroll announcement
        if (rerolledGiveaway.winnerIds && rerolledGiveaway.winnerIds.length > 0) {
            const winnerMentions = rerolledGiveaway.winnerIds.map(id => `<@${id}>`).join(', ');
            const announcementEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('success'))
                .setTitle('🎉 Giveaway Rerolled!')
                .setDescription(`Congratulations ${winnerMentions}! You won: **${giveaway.prize}**`)
                .addFields({
                    name: '🎫 How to Claim Your Prize',
                    value: 'Please create a ticket to claim your prize. Include the giveaway message ID in your ticket.',
                    inline: false
                })
                .addFields({
                    name: '📝 Giveaway ID',
                    value: giveaway.messageId,
                    inline: true
                })
                .addFields({
                    name: '⏰ Claim Deadline',
                    value: 'Please claim within 8 hours or the prize may be forfeited.',
                    inline: true
                })
                .setTimestamp()
                .setFooter(serverUtils.getFooter());
            if (attachment) announcementEmbed.setImage(`attachment://${rerollImageName}`);

            await interaction.editReply({
                content: `✅ Giveaway rerolled! New winners: ${winnerMentions}`,
                embeds: [announcementEmbed],
                files: attachment ? [attachment] : []
            });
        } else {
            await interaction.editReply({
                content: '✅ Giveaway rerolled! No participants.'
            });
        }

    } catch (error) {
        console.error('[Giveaway] Error rerolling giveaway:', error);
        await interaction.editReply({
            content: '❌ Failed to reroll the giveaway.'
        });
    }
}

async function listGiveaways(interaction: ChatInputCommandInteraction) {
    try {
        const activeGiveaways = await giveawayService.getActiveGiveawaysByGuild(interaction.guildId!);

        if (activeGiveaways.length === 0) {
            await interaction.editReply({
                content: '📝 No active giveaways found.'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('🎉 Active Giveaways')
            .setDescription(`Found ${activeGiveaways.length} active giveaway(s)`)
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        for (const giveaway of activeGiveaways.slice(0, 10)) { // Limit to 10
            const timeRemaining = await giveawayService.getTimeRemaining(giveaway.messageId);
            const timeText = timeRemaining > 0 
                ? `<t:${Math.floor(giveaway.endsAt / 1000)}:R>`
                : 'Ending...';

            embed.addFields({
                name: `🎁 ${giveaway.prize}`,
                value: `Participants: ${giveaway.participants.length} | Winners: ${giveaway.winners} | Ends: ${timeText}\n[View Giveaway](https://discord.com/channels/${interaction.guildId}/${giveaway.channelId}/${giveaway.messageId})`,
                inline: false
            });
        }

        if (activeGiveaways.length > 10) {
            embed.addFields({
                name: '📝 Note',
                value: `Showing first 10 giveaways. Total: ${activeGiveaways.length}`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Giveaway] Error listing giveaways:', error);
        await interaction.editReply({
            content: '❌ Failed to list giveaways.'
        });
    }
}

async function getGiveawayInfo(interaction: ChatInputCommandInteraction) {
    const messageId = interaction.options.getString('message_id', true);

    try {
        const giveaway = await giveawayService.getGiveawayById(messageId);
        if (!giveaway) {
            await interaction.editReply({
                content: '❌ Giveaway not found.'
            });
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(giveaway.ended ? serverUtils.getColor('success') : serverUtils.getColor('primary'))
            .setTitle('🎉 Giveaway Information')
            .addFields(
                { name: '🎁 Prize', value: giveaway.prize, inline: true },
                { name: '🏆 Winners', value: giveaway.winners.toString(), inline: true },
                { name: '👥 Participants', value: giveaway.participants.length.toString(), inline: true },
                { name: '📅 Created', value: `<t:${Math.floor(giveaway.createdAt.getTime() / 1000)}:F>`, inline: true },
                { name: '📅 Ends', value: `<t:${Math.floor(giveaway.endsAt / 1000)}:F>`, inline: true },
                { name: '⏰ Duration', value: giveawayService.formatDuration(giveaway.durationMs), inline: true },
                { name: '📝 Status', value: giveaway.ended ? 'Ended' : 'Active', inline: true }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        if (giveaway.ended && giveaway.winnerIds && giveaway.winnerIds.length > 0) {
            const winnerMentions = giveaway.winnerIds.map(id => `<@${id}>`).join(', ');
            embed.addFields({
                name: '🎊 Winners',
                value: winnerMentions,
                inline: false
            });
        }

        if (!giveaway.ended) {
            const timeRemaining = await giveawayService.getTimeRemaining(messageId);
            if (timeRemaining > 0) {
                embed.addFields({
                    name: '⏰ Time Remaining',
                    value: `<t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
                    inline: false
                });
            }
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[Giveaway] Error getting giveaway info:', error);
        await interaction.editReply({
            content: '❌ Failed to get giveaway information.'
        });
    }
}

async function deleteGiveaway(interaction: ChatInputCommandInteraction) {
    const messageId = interaction.options.getString('message_id', true);

    try {
        const giveaway = await giveawayService.getGiveawayById(messageId);
        if (!giveaway) {
            await interaction.editReply({
                content: '❌ Giveaway not found.'
            });
            return;
        }

        // Delete the message if possible
        try {
            const channel = await interaction.guild!.channels.fetch(giveaway.channelId) as TextChannel;
            if (channel) {
                const message = await channel.messages.fetch(messageId).catch(() => null);
                if (message) {
                    await message.delete();
                }
            }
        } catch (error) {
            console.warn('[Giveaway] Could not delete giveaway message:', error);
        }

        // Delete from database
        const deleted = await giveawayService.deleteGiveaway(messageId);
        if (!deleted) {
            await interaction.editReply({
                content: '❌ Failed to delete the giveaway.'
            });
            return;
        }

        await interaction.editReply({
            content: '✅ Giveaway deleted successfully.'
        });

    } catch (error) {
        console.error('[Giveaway] Error deleting giveaway:', error);
        await interaction.editReply({
            content: '❌ Failed to delete the giveaway.'
        });
    }
} 