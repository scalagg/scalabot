import { 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ColorResolvable,
    TextChannel,
    ActionRowBuilder
} from 'discord.js';
import { serverUtils } from '../../utils/ServerUtils';

const STAFF_ROLES = [
    'Learner',
    'Trial Mod',
    'Mod',
    'Mod+',
    'Senior Mod',
    'Admin',
    'Senior Admin',
    'System Admin',
    'Platform Admin',
    'Co-Owner',
    'Owner'
];

const ADMIN_ROLES = [
    'Admin',
    'Senior Admin',
    'System Admin',
    'Platform Admin',
    'Co-Owner',
    'Owner'
];

const MANAGER_ROLES = [
    'Platform Admin',
    'System Admin',
    'Co-Owner',
    'Owner'
];

export const data = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Setup the ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return;
    if (!interaction.channel || !(interaction.channel instanceof TextChannel)) {
        await interaction.reply({
            content: '❌ This command can only be used in text channels!',
            ephemeral: true
        });
        return;
    }

    // Set server type based on guild ID
    serverUtils.setServerType(serverUtils.getServerTypeFromGuildId(interaction.guildId!));

    const embed = new EmbedBuilder()
        .setColor(serverUtils.getColor('primary'))
        .setTitle('📝 STAFF SUPPORT')
        .setDescription('We will work to solve all your problems.\n\nCreate a ticket to contact with our staff members.\nIf your request does not receive a response quickly, please be patient.\nRemember that you can also create a ticket on our website.')
        .setTimestamp()
        .setFooter(serverUtils.getFooter());

    // Using Components v2 - create action rows with buttons
    const row1 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_staff_application')
                .setLabel('Staff Application')
                .setEmoji('👑')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_media_application')
                .setLabel('Media Application')
                .setEmoji('📸')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_punishment_appeal')
                .setLabel('Punishment Appeal')
                .setEmoji('⚖️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_bug_report')
                .setLabel('Bug Report')
                .setEmoji('🐛')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_tebex_support')
                .setLabel('Tebex Support')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Secondary),
        );

    const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_head_staff_support')
                .setLabel('Head Staff Support')
                .setEmoji('👨‍💼')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_general_support')
                .setLabel('General Support')
                .setEmoji('🌐')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_other')
                .setLabel('Other')
                .setEmoji('❓')
                .setStyle(ButtonStyle.Secondary),
        );

    await interaction.channel?.send({
        embeds: [embed],
        components: [row1, row2]
    });

    await interaction.reply({
        content: '✅ Ticket system setup complete!',
        ephemeral: true
    });
} 