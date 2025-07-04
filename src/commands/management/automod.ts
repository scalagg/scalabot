import { 
    SlashCommandBuilder, 
    ChatInputCommandInteraction, 
    GuildMember, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';
import { autoModerationService } from '../../services/AutoModerationService';
import { config } from '../../config/config';

export const data = new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure auto-moderation settings')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Check auto-moderation status')
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('test')
            .setDescription('Test auto-moderation with a message')
            .addStringOption(option =>
                option
                    .setName('message')
                    .setDescription('Message to test for toxicity')
                    .setRequired(true)
                    .setMaxLength(1000)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('check-logs')
            .setDescription('Check if punishment logs channel is properly configured')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

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

    // Check if user has admin permission
    if (!(interaction.member instanceof GuildMember) || !serverUtils.hasAdminRole(interaction.member)) {
        await interaction.reply({
            content: '❌ You do not have permission to use this command. Admin role required.',
            ephemeral: true
        });
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
        await interaction.deferReply({ ephemeral: true });

        if (subcommand === 'status') {
            await showStatus(interaction);
        } else if (subcommand === 'test') {
            await testMessage(interaction);
        } else if (subcommand === 'check-logs') {
            await checkLogs(interaction);
        }

    } catch (error) {
        console.error('[AutoMod] Error executing command:', error);
        await interaction.editReply({
            content: '❌ An error occurred while executing the command. Please try again.'
        });
    }
}

async function showStatus(interaction: ChatInputCommandInteraction) {
    const geminiConfig = config.geminiConfig;
    let promptDisplay = geminiConfig.generativeAIPrompt;
    let truncated = false;
    if (promptDisplay.length > 1000) {
        promptDisplay = promptDisplay.slice(0, 1000) + '\n... (truncated)';
        truncated = true;
    }
    
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🤖 Auto-Moderation Status')
        .addFields(
            { 
                name: '🟢 Status', 
                value: geminiConfig.enabled ? 'Enabled' : 'Disabled', 
                inline: true 
            },
            { 
                name: '📊 Threshold', 
                value: `${geminiConfig.muteThreshold}/100`, 
                inline: true 
            },
            { 
                name: '🔑 API Keys', 
                value: geminiConfig.apiKey ? `${geminiConfig.apiKey.split(',').length} configured` : 'None configured', 
                inline: true 
            },
            { 
                name: '🌐 API Endpoint', 
                value: geminiConfig.apiEndpoint, 
                inline: false 
            },
            { 
                name: '📝 Prompt', 
                value: `
${promptDisplay}
`, 
                inline: false 
            }
        )
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    if (truncated) {
        embed.addFields({
            name: '\u200B',
            value: '⚠️ Prompt is too long to display in full. The full prompt is still used for moderation.'
        });
    }

    await interaction.editReply({ embeds: [embed] });
}

async function testMessage(interaction: ChatInputCommandInteraction) {
    const testMessage = interaction.options.getString('message', true);
    const geminiConfig = config.geminiConfig;

    if (!geminiConfig.enabled) {
        await interaction.editReply({
            content: '❌ Auto-moderation is currently disabled. Please enable it first.'
        });
        return;
    }

    if (!geminiConfig.apiKey) {
        await interaction.editReply({
            content: '❌ No Gemini API keys configured. Please add API keys to the configuration.'
        });
        return;
    }

    // Create a mock message for testing
    const mockMessage = {
        content: testMessage,
        author: interaction.user,
        member: interaction.member,
        guildId: interaction.guildId!,
        delete: async () => {},
        channel: interaction.channel
    } as any;

    // Test the message
    autoModerationService.submit(mockMessage, async (toxicityScore) => {
        const embed = new EmbedBuilder()
            .setColor(serverUtils.getColor('info'))
            .setTitle('🧪 Auto-Moderation Test Result')
            .addFields(
                { 
                    name: '📝 Test Message', 
                    value: `"${testMessage}"`, 
                    inline: false 
                },
                { 
                    name: '📊 Toxicity Score', 
                    value: `${toxicityScore}/100`, 
                    inline: true 
                },
                { 
                    name: '🎯 Threshold', 
                    value: `${geminiConfig.muteThreshold}/100`, 
                    inline: true 
                },
                { 
                    name: '⚡ Action', 
                    value: toxicityScore >= geminiConfig.muteThreshold ? 'Would timeout user' : 'No action taken', 
                    inline: true 
                }
            )
            .setTimestamp()
            .setFooter(serverUtils.getFooter());

        await interaction.editReply({ embeds: [embed] });
    });
}

async function checkLogs(interaction: ChatInputCommandInteraction) {
    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('info'))
        .setTitle('🔍 Checking Punishment Logs Channel')
        .setDescription('Verifying channel configuration and permissions...')
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    await interaction.editReply({ embeds: [embed] });

    try {
        const channelExists = await autoModerationService.checkLoggingChannel();
        
        if (channelExists) {
            const successEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('success'))
                .setTitle('✅ Punishment Logs Channel Verified')
                .setDescription(`The punishment logs channel is properly configured and accessible.`)
                .addFields(
                    { name: '📝 Channel ID', value: config.punishmentLogsChannelId, inline: true },
                    { name: '🟢 Status', value: 'Ready for logging', inline: true }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await interaction.editReply({ embeds: [successEmbed] });
        } else {
            const errorEmbed = new EmbedBuilder()
                .setColor(serverUtils.getColor('error'))
                .setTitle('❌ Punishment Logs Channel Issue')
                .setDescription(`There's a problem with the punishment logs channel configuration.`)
                .addFields(
                    { name: '📝 Channel ID', value: config.punishmentLogsChannelId, inline: true },
                    { name: '🔴 Status', value: 'Configuration error', inline: true },
                    { name: '💡 Solution', value: 'Check the console logs for detailed error information and ensure the channel exists and the bot has permissions.', inline: false }
                )
                .setTimestamp()
                .setFooter(serverUtils.getFooter());

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    } catch (error) {
        console.error('[AutoMod] Error checking logs channel:', error);
        await interaction.editReply({
            content: '❌ An error occurred while checking the logs channel configuration.'
        });
    }
} 