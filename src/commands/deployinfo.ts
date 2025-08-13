import { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { serverUtils } from '../utils/ServerUtils';

export const data = new SlashCommandBuilder()
    .setName('deployinfo')
    .setDescription('Deploy the server information panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    try {
        // Set server type
        const serverType = serverUtils.getServerTypeFromGuildId(interaction.guild!.id);
        serverUtils.setServerType(serverType);

        // Defer reply since this might take a while
        await interaction.deferReply({ ephemeral: true });

        const { embed, buttons } = buildInfoPanel();
        
        // Send embed with buttons
        await (interaction.channel as any).send({
            embeds: [embed],
            components: [buttons]
        });

        await interaction.editReply({
            content: '✅ Successfully deployed the information panel!'
        });

    } catch (error) {
        console.error('[DeployInfo] Error:', error);
        await interaction.editReply({
            content: '❌ An error occurred while deploying the information panel.'
        });
    }
}

function buildInfoPanel(): { embed: EmbedBuilder; buttons: ActionRowBuilder<ButtonBuilder> } {
    const serverInfo = serverUtils.getInfo();
    const theme = serverUtils.getTheme();

    // Create the main embed
    const embed = new EmbedBuilder()
        .setTitle(serverInfo.name)
        .setColor(theme.primary)
        .setDescription([
            `Welcome to ${serverInfo.name}`,
            '',
            `Your hub for updates, support, and community. Stay connected and explore everything ${serverInfo.name} has to offer.`
        ].join('\n'))
        .addFields(
            {
                name: 'Useful Links',
                value: [
                    '🛒 **Store:** ' + serverInfo.store,
                    '🌐 **Website:** ' + serverInfo.website,
                    '🐦 **Twitter:** https://twitter.com/' + (serverInfo.name === 'HolyPvP' ? 'HolyPvPNET' : 'ScalaNetwork'),
                    '🔊 **TeamSpeak:** ' + (serverInfo.name === 'HolyPvP' ? 'ts.holypvp.net' : 'ts.scala.gg')
                ].join('\n'),
                inline: false
            },
            {
                name: 'Why join?',
                value: [
                    '• Announcements, events, and giveaways',
                    '• Support via tickets',
                    '• Community chats and voice channels'
                ].join('\n'),
                inline: false
            }
        )
        .setFooter(serverUtils.getFooter())
        .setTimestamp();

    // Create buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setLabel('Store')
                .setStyle(ButtonStyle.Link)
                .setURL('https://' + serverInfo.store)
                .setEmoji('🛒'),
            new ButtonBuilder()
                .setLabel('Website')
                .setStyle(ButtonStyle.Link)
                .setURL(serverInfo.website)
                .setEmoji('🌐'),
            new ButtonBuilder()
                .setLabel('Twitter')
                .setStyle(ButtonStyle.Link)
                .setURL('https://twitter.com/' + (serverInfo.name === 'HolyPvP' ? 'HolyPvPNET' : 'ScalaNetwork'))
                .setEmoji('🐦')
        );

    return { embed, buttons };
} 